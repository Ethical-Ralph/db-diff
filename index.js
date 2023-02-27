const fs = require("fs");
const config = require("./config");
const generateMigration = require("./generate-migration");
const sqlConnectionPool = require("./mssql-connection-pool");
const parsed = require("./parse-stored");

const database = config.DATABASE_NAME

const db1Config = {
  server: config.DB1_HOST,
  user: config.DB1_USER,
  password: config.DB1_PASSWORD,
  database,
  options: { encrypt: true, trustServerCertificate: false },
};

const db2Config = {
  server: config.DB2_HOST,
  user: config.DB2_USER,
  password: config.DB2_PASSWORD,
  database,
  options: { encrypt: true, trustServerCertificate: false },
};

const getStoredProcedures = `
    SELECT ROUTINE_DEFINITION FROM INFORMATION_SCHEMA.ROUTINES WHERE ROUTINE_TYPE = 'PROCEDURE';
`;

const getTablesSql = `
    SELECT 
        SCHEMA_NAME(schema_id) AS schema_name, 
        name AS table_name
    FROM 
        sys.tables
    WHERE schema_id = SCHEMA_ID('dbo')
    ORDER BY 
        schema_name, 
        table_name;
    
`;

const getTableColumnSql = (schema, table) => `
    SELECT 
        c.name AS column_name, 
        t.name AS data_type, 
        c.max_length,
        dc.definition AS default_value,
        c.is_nullable
    FROM 
        sys.columns c
        INNER JOIN sys.types t ON c.system_type_id = t.system_type_id
        LEFT OUTER JOIN sys.objects o ON c.default_object_id = o.object_id AND o.type = 'D'
        LEFT OUTER JOIN sys.default_constraints dc ON o.object_id = dc.object_id    
    WHERE 
        c.object_id = OBJECT_ID('${schema}.${table}');
`;

const run = async () => {
  try {
    const connection = await Promise.all([
      sqlConnectionPool.GetCreateIfNotExistPool(db1Config),
      sqlConnectionPool.GetCreateIfNotExistPool(db2Config),
    ]);

    const [spRes, tabRes] = await Promise.all([
      await getStoredProcedureD(connection),
      await getTablesInfo(connection),
    ]);

    connection.forEach((c) => c.close());

    await generateMigration(tabRes, spRes);
  } catch (err) {
    console.log(err);
    process.exit(1);
  }
};

const getTablesInfo = async (connection) => {
  const tables1 = new Map();
  const tables2 = new Map();

  const getTables = await Promise.all([
    connection[0].query(getTablesSql),
    connection[1].query(getTablesSql),
  ]);

  const { recordset: allTables1 } = getTables[0];
  const { recordset: allTables2 } = getTables[1];

  await Promise.all(
    allTables1.map(async (t) => {
      const { recordset } = await getTableColumn(
        connection[0],
        t.schema_name,
        t.table_name
      );

      tables1.set(t.table_name, {
        ...t,
        columns: recordset,
      });
    })
  );

  await Promise.all(
    allTables2.map(async (t) => {
      const { recordset } = await getTableColumn(
        connection[1],
        t.schema_name,
        t.table_name
      );

      tables2.set(t.table_name, {
        ...t,
        columns: recordset,
      });
    })
  );

  const db1TableDifference = [];
  const db2TableDifference = [];

  const existInBoth = [];

  tables1.forEach((value, name) => {
    if (!tables2.has(name)) {
      db1TableDifference.push(value);
    } else {
      existInBoth.push(name);
    }
  });

  tables2.forEach((value, name) => {
    if (!tables1.has(name)) {
      db2TableDifference.push(value);
    } else {
      existInBoth.push(name);
    }
  });

  const uniqueExistInBoth = Array.from(new Set([...existInBoth]).keys());
  const existingTablesDifferences = [];

  uniqueExistInBoth.forEach((name) => {
    const table1 = tables1.get(name);
    const table2 = tables2.get(name);

    const table1Columns = new Map();
    const table2Columns = new Map();

    table1.columns.forEach((column) => {
      table1Columns.set(column.column_name, column);
    });

    table2.columns.forEach((column) => {
      table2Columns.set(column.column_name, column);
    });

    const table1ColumnDifference = [];
    const table2ColumnDifference = [];

    table1Columns.forEach((value, name) => {
      if (!table2Columns.has(name)) {
        table1ColumnDifference.push(value);
      }
    });

    table2Columns.forEach((value, name) => {
      if (!table1Columns.has(name)) {
        table2ColumnDifference.push(value);
      }
    });

    if (table1ColumnDifference.length || table2ColumnDifference.length) {
      existingTablesDifferences.push({
        table_name: table1.table_name,
        missingColumnsInDB2: table1ColumnDifference,
        missingColumnsInDB1: table2ColumnDifference,
      });
    }
  });

  const resData = {
    stats: {
      totalMissingTableInDb2: db1TableDifference.length,
      totalMissingTableInDb1: db2TableDifference.length,
      totalDifferenceBetweenDBs: existingTablesDifferences.length,
    },
    missingTableInDb2: db1TableDifference,
    missingTableInDb1: db2TableDifference,
    existingTablesDifferences,
  };

  fs.writeFile("tables.json", JSON.stringify(resData, null, 2), (err) => {
    if (err) {
      console.log(err);
    }

    console.log("Table differences processed");
  });

  return resData;
};

const getTableColumn = (connection, schema, table) => {
  return connection.query(getTableColumnSql(schema, table));
};

const getStoredProcedureD = async (connection) => {
  const stored1 = new Map();
  const stored2 = new Map();

  const storedPresult = await Promise.all([
    connection[0].query(getStoredProcedures),
    connection[1].query(getStoredProcedures),
  ]);

  const { recordset: storedProcedures1 } = storedPresult[0];
  const { recordset: storedProcedures2 } = storedPresult[1];

  storedProcedures1.forEach((stored) => {
    const { name, noWhite, raw } = parsed(
      stored.ROUTINE_DEFINITION
    );

    if (name === "dbo") return;

    stored1.set(name, { noWhite, raw });
  });

  storedProcedures2.forEach((stored) => {
    const { name,  noWhite, raw } = parsed(
      stored.ROUTINE_DEFINITION
    );

    if (name === "dbo") return;

    stored2.set(name, {  noWhite, raw });
  });

  const db1StoredProceduresNamesDifference = [];
  const db2StoredProceduresNamesSetDifference = [];

  const existInBoth = [];

  stored1.forEach(({ raw }, name) => {
    if (!stored2.has(name)) {
      db1StoredProceduresNamesDifference.push({ name, raw });
    } else {
      existInBoth.push(name);
    }
  });

  stored2.forEach(({ raw }, name) => {
    if (!stored1.has(name)) {
      db2StoredProceduresNamesSetDifference.push({ name, raw });
    } else {
      existInBoth.push(name);
    }
  });

  const uniqueExistInBoth = Array.from(new Set([...existInBoth]).keys());
  const differenceExist = [];

  uniqueExistInBoth.forEach((k) => {
    const {
      noWhite: noWhite1,
      raw: raw1,
    } = stored1.get(k);
    const {
      noWhite: noWhite2,
      raw: raw2,
    } = stored2.get(k);

    if (noWhite1 !== noWhite2) {
      differenceExist.push({
        name: k,
        db1Raw: raw1,
        db2Raw: raw2,
      });
    }
  });

  const resData = {
    stats: {
      totalMissingInDB2: db1StoredProceduresNamesDifference.length,
      totalMissingInDB1: db2StoredProceduresNamesSetDifference.length,
      totalExistInBothButUpdatedFunction: differenceExist.length,
    },
    missingInDB2: db1StoredProceduresNamesDifference,
    missingInDB1: db2StoredProceduresNamesSetDifference,
    existInBothButUpdatedFunction: differenceExist,
  };

  fs.writeFile("stored-p.json", JSON.stringify(resData, null, 2), (err) => {
    if (err) {
      console.log(err);
    }
    console.log("stored procedures differences processed");
  });

  return resData;
};

run();
