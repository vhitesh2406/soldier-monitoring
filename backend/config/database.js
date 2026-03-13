const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool(
  process.env.DATABASE_URL
    ? {
        connectionString: process.env.DATABASE_URL,
        ssl: { rejectUnauthorized: false }
      }
    : {
        host:                    process.env.DB_HOST,
        port:                    parseInt(process.env.DATABASE_PORT) || 5432,
        database:                process.env.DB_NAME,
        user:                    process.env.DB_USER,
        password:                process.env.DB_PASSWORD,
        max:                     20,
        idleTimeoutMillis:       30000,
        connectionTimeoutMillis: 2000,
        ssl: false
      }
);

pool.on('connect', () => {
  console.log('✅ PostgreSQL connected');
});

pool.on('error', (err) => {
  console.error('❌ PostgreSQL error:', err.message);
});

// Auto create tables on startup
async function createTables() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS sensor_data (
        id SERIAL PRIMARY KEY,
        device_id VARCHAR(50),
        timestamp BIGINT,
        command VARCHAR(50),
        channel INTEGER,
        heart_rate INTEGER,
        spo2 INTEGER,
        gps_lat DOUBLE PRECISION,
        gps_lng DOUBLE PRECISION,
        gps_speed DOUBLE PRECISION,
        gps_satellites INTEGER,
        temperature DOUBLE PRECISION,
        pressure DOUBLE PRECISION,
        accel_x DOUBLE PRECISION,
        accel_y DOUBLE PRECISION,
        accel_z DOUBLE PRECISION,
        gyro_x DOUBLE PRECISION,
        gyro_y DOUBLE PRECISION,
        gyro_z DOUBLE PRECISION,
        created_at TIMESTAMP DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS alerts (
        id SERIAL PRIMARY KEY,
        device_id VARCHAR(50),
        severity VARCHAR(20),
        alert_message TEXT,
        acknowledged BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMP DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS system_status (
        id SERIAL PRIMARY KEY,
        device_id VARCHAR(50) UNIQUE,
        last_seen TIMESTAMP,
        is_online BOOLEAN DEFAULT FALSE,
        packets_received INTEGER DEFAULT 0
      );
    `);
    console.log('✅ Tables created/verified');
  } catch (err) {
    console.error('❌ Table creation error:', err.message);
  }
}

createTables();

module.exports = pool;