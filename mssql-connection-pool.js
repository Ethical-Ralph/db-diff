const { ConnectionPool } = require("mssql");
const pools = {};

// create a new connection pool
const CreatePool = (config) => {
  let key = JSON.stringify(config);

  if (GetPool(key)) throw new Error("Pool already exists");

  pools[key] = new ConnectionPool(config).connect();
  return pools[key];
};

// get a connection pool from all pools
const GetPool = (name) => {
  if (pools[name]) return pools[name];
  else return null;
};

// if pool already exists, return it, otherwise create it
const GetCreateIfNotExistPool = (config) => {
  let key = JSON.stringify(config);

  let pool = GetPool(key);
  if (pool) return pool;
  else return CreatePool(config);
};

module.exports = {
  CreatePool,
  GetPool,
  GetCreateIfNotExistPool,
};
