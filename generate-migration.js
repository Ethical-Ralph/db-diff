const fs = require("fs");
const path = require("path");

const ignoreMaxLength = [
  "int",
  "datetime",
  "date",
  "time",
  "float",
  "double",
  "decimal",
  "bit",
  "bigint",
  "tinyint",
  "smallint",
  "real",
  "money",
  "smallmoney",
  "numeric",
  "smallmoney",
  "uniqueidentifier",
];

const timestamp = String(Date.now());

const createMigrationDir = async (db) => {
  const dir1 = path.join(__dirname, "migrations", timestamp, db);

  return new Promise((resolve, reject) => {
    if (!fs.existsSync(dir1)) {
      fs.mkdir(dir1, { recursive: true }, (err) => {
        if (err) {
          reject(err);
        } else {
          resolve(`${db} migration dir created successsfully`);
        }
      });
    }
  });
};

const writeFile = async (dir, fileName, data) => {
  const fP = path.join(__dirname, "migrations", timestamp, dir, fileName);

  return new Promise((resolve, reject) => {
    fs.writeFile(fP, data, (err) => {
      if (err) {
        reject(err);
      } else {
        resolve("file saved");
      }
    });
  });
};

const createMigration = async (tableData) => {
  const { missingTableInDb1, missingTableInDb2 } = tableData;

  const generate = (tables) => {
    let migrations = [];

    tables.forEach((table) => {
      let migration = `CREATE TABLE "${table.table_name}" (`;

      table.columns.forEach((column, i) => {
        if (column.column_name === "id") {
          migration += `"${column.column_name}" ${column.data_type} IDENTITY(1,1) PRIMARY KEY, `;
          return;
        }

        migration += `"${column.column_name}" ${column.data_type}`;
        if (
          !ignoreMaxLength.includes(column.data_type) &&
          column.max_length > 0
        ) {
          migration += `(${column.max_length}) `;
        } else {
          migration += " ";
        }

        // handle is_nullable
        if (column.is_nullable) {
          migration += `NULL`;
        } else {
          migration += `NOT NULL`;
        }

        // handle default value
        if (column.default_value) {
          migration += ` DEFAULT ${column.default_value}, `;
        } else {
          migration += i === table.columns.length - 1 ? "" : ", ";
        }
      });

      migration += `);`;

      migrations.push(migration);
    });

    return migrations;
  };

  const migrations = generate(missingTableInDb1);
  const migrations2 = generate(missingTableInDb2);

  await Promise.all([
    writeFile("db1", "create.sql", migrations.join("\r")),
    writeFile("db2", "create.sql", migrations2.join("\r")),
  ]);
  console.log("Generated new tables migration for db1 and db2");
};

const alterMigration = async (tableData) => {
  const migration1 = [];
  const migration2 = [];

  const { existingTablesDifferences } = tableData;

  const generate = (table, missingColumns) => {
    let migrations = [];

    missingColumns.forEach((column) => {
      let migration = `ALTER TABLE "${table.table_name}" ADD "${column.column_name}" ${column.data_type}`;
      if (
        !ignoreMaxLength.includes(column.data_type) &&
        column.max_length > 0
      ) {
        migration += `(${column.max_length}) `;
      } else {
        migration += " ";
      }

      // handle is_nullable
      if (column.is_nullable) {
        migration += `NULL`;
      } else {
        migration += `NOT NULL`;
      }

      // handle default value
      if (column.default_value) {
        migration += ` DEFAULT ${column.default_value}`;
      }

      migration += ";";

      migrations.push(migration);
    });

    return migrations;
  };

  existingTablesDifferences.forEach((table) => {
    const { missingColumnsInDB1, missingColumnsInDB2 } = table;

    const migrations = generate(table, missingColumnsInDB1);
    const migrations2 = generate(table, missingColumnsInDB2);

    migration1.push(...migrations);
    migration2.push(...migrations2);
  });

  await Promise.all([
    writeFile("db1", "alter.sql", migration1.join("\r")),
    writeFile("db2", "alter.sql", migration2.join("\r")),
  ]);
  console.log("Generated new columns migration for db1 and db2");
};

const generateStoredP = async (storedP) => {
  const { missingInDB1, missingInDB2 } = storedP;
  const promise = [];

  missingInDB1.forEach(({ raw, name }) => {
   promise.push(writeFile("db1", `${name}.sql`, raw));
  });

  missingInDB2.forEach(({ raw, name }) => {
    promise.push(writeFile("db2", `${name}.sql`, raw));
  });

  await Promise.all(promise);
  console.log("Generated missing store proceedure for db1 and db2");
};

const generateSPExisting = async (storedP) => {
  const { existInBothButUpdatedFunction } = storedP;
  const promises = [];

  existInBothButUpdatedFunction.forEach(({ db1Raw, db2Raw, name }) => {
    db1Raw = db1Raw.replace(/CREATE\s+PROCEDURE/, "ALTER PROCEDURE");
    db2Raw = db2Raw.replace(/CREATE\s+PROCEDURE/, "ALTER PROCEDURE");

    // handle lowercase
    db1Raw = db1Raw.replace(/create\s+procedure/i, "alter procedure");
    db2Raw = db2Raw.replace(/create\s+procedure/i, "alter procedure");

    promises.push(writeFile("db1", `update-${name}.sql`, db2Raw));
    promises.push(writeFile("db2", `update-${name}.sql`, db1Raw));
  });

  await Promise.all(promises);
  console.log("Generated exising stored proceedure update for db1 and db2");
};

const generateMigration = async (tableData, storedP) => {
  const migDir = ["db1", "db2"];

  await Promise.all(migDir.map(createMigrationDir));

  console.log("Generating migration data");

  await Promise.all([
    createMigration(tableData),
    alterMigration(tableData),
    generateStoredP(storedP),
    generateSPExisting(storedP),
  ]);

  console.log("Migration generatation done");
};

module.exports = generateMigration;
