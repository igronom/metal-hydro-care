const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool(
  process.env.DATABASE_URL
    ? {
        connectionString: process.env.DATABASE_URL,
        ssl: { rejectUnauthorized: false }
      }
    : {
        host:     process.env.DB_HOST,
        port:     process.env.DB_PORT,
        database: process.env.DB_NAME,
        user:     process.env.DB_USER,
        password: process.env.DB_PASSWORD,
        ssl: false
      }
);

async function initDB() {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        id          SERIAL PRIMARY KEY,
        name        VARCHAR(100) NOT NULL,
        email       VARCHAR(255) UNIQUE NOT NULL,
        password    VARCHAR(255) NOT NULL,
        created_at  TIMESTAMP DEFAULT NOW()
      );
\      CREATE TABLE IF NOT EXISTS profiles (
        id            SERIAL PRIMARY KEY,
        user_id       INTEGER REFERENCES users(id) ON DELETE CASCADE,
        name          VARCHAR(200) NOT NULL,
        river         VARCHAR(200) NOT NULL,
        latitude      NUMERIC(9,6),
        longitude     NUMERIC(9,6),
        sample_date   DATE NOT NULL,
        depth_from    NUMERIC(5,1) DEFAULT 0,
        depth_to      NUMERIC(5,1) DEFAULT 20,
        horizons      INTEGER DEFAULT 10,
        depth_step    NUMERIC(4,1) DEFAULT 2,
        status        VARCHAR(20) DEFAULT 'ok',
        created_at    TIMESTAMP DEFAULT NOW(),
        updated_at    TIMESTAMP DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS concentrations_c0 (
        id          SERIAL PRIMARY KEY,
        profile_id  INTEGER REFERENCES profiles(id) ON DELETE CASCADE,
        metal       VARCHAR(10) NOT NULL,
        value       NUMERIC(12,4) NOT NULL,
        UNIQUE(profile_id, metal)
      );
      CREATE TABLE IF NOT EXISTS probes (
        id          SERIAL PRIMARY KEY,
        profile_id  INTEGER REFERENCES profiles(id) ON DELETE CASCADE,
        depth_cm    NUMERIC(5,1) NOT NULL,
        time_days   NUMERIC(5,1) NOT NULL,
        created_at  TIMESTAMP DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS probe_values (
        id        SERIAL PRIMARY KEY,
        probe_id  INTEGER REFERENCES probes(id) ON DELETE CASCADE,
        metal     VARCHAR(10) NOT NULL,
        value     NUMERIC(12,4) NOT NULL,
        UNIQUE(probe_id, metal)
      );
      CREATE TABLE IF NOT EXISTS diffusion_coefficients (
        id          SERIAL PRIMARY KEY,
        profile_id  INTEGER REFERENCES profiles(id) ON DELETE CASCADE,
        metal       VARCHAR(10) NOT NULL,
        d_value     NUMERIC(12,6) NOT NULL,
        rmse        NUMERIC(12,6),
        r_squared   NUMERIC(10,6),
        UNIQUE(profile_id, metal)
      );
    `);
    await client.query(`
      ALTER TABLE diffusion_coefficients
        ADD COLUMN IF NOT EXISTS rmse      NUMERIC(12,6),
        ADD COLUMN IF NOT EXISTS r_squared NUMERIC(10,6);
    `);
    console.log('✅ База даних ініціалізована');
  } finally {
    client.release();
  }
}

module.exports = { pool, initDB };