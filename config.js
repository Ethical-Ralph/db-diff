const dotEnv = require('dotenv');
dotEnv.config();

const config = {
    DB1_HOST: process.env.DB1_HOST,
    DB1_USER: process.env.DB1_USER,
    DB1_PASSWORD: process.env.DB1_PASSWORD,

    DB2_HOST: process.env.DB2_HOST,
    DB2_USER: process.env.DB2_USER,
    DB2_PASSWORD: process.env.DB2_PASSWORD,

    DATABASE_NAME: process.env.DATABASE_NAME,
}

module.exports = config;