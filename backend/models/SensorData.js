const pool = require('../config/database');

class SensorData {
  static async create(data) {
    const query = `
      INSERT INTO sensor_data (
        timestamp, device_id, command,
        gps_lat, gps_lng, gps_speed, gps_satellites,
        motion_ax, motion_ay, motion_az, motion_gx, motion_gy, motion_gz,
        heart_rate, spo2, temperature, pressure, channel
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
      RETURNING *;
    `;
    const values = [
      data.timestamp,
      data.device_id || 'soldier_1',
      data.command,
      data.gps?.lat || null,
      data.gps?.lng || null,
      data.gps?.speed || null,
      data.gps?.satellites || null,
      data.motion?.ax || null,
      data.motion?.ay || null,
      data.motion?.az || null,
      data.motion?.gx || null,
      data.motion?.gy || null,
      data.motion?.gz || null,
      data.health?.hr || null,
      data.health?.spo2 || null,
      data.environment?.temp || null,
      data.environment?.pressure || null,
      data.channel || null,
    ];
    try {
      const result = await pool.query(query, values);
      return result.rows[0];
    } catch (err) {
      console.error('❌ Insert error:', err.message);
      throw err;
    }
  }

  static async getLatest(limit = 10, deviceId = null) {
    let query = `SELECT * FROM sensor_data `;
    const params = [];
    if (deviceId) {
      query += `WHERE device_id = $1 `;
      params.push(deviceId);
    }
    query += `ORDER BY created_at DESC LIMIT $${params.length + 1}`;
    params.push(limit);
    try {
      const result = await pool.query(query, params);
      return result.rows;
    } catch (err) {
      console.error('❌ Query error:', err.message);
      return [];
    }
  }

  static async getStats(deviceId = null) {
    let query = `
      SELECT
        COUNT(*) as total_records,
        AVG(heart_rate) as avg_heart_rate,
        AVG(spo2) as avg_spo2,
        AVG(temperature) as avg_temperature,
        MAX(created_at) as last_update,
        COUNT(CASE WHEN synced_to_cloud = FALSE THEN 1 END) as unsynced_count
      FROM sensor_data
      WHERE created_at > NOW() - INTERVAL '1 hour'
    `;
    const params = [];
    if (deviceId) {
      query += ` AND device_id = $1`;
      params.push(deviceId);
    }
    try {
      const result = await pool.query(query, params);
      return result.rows[0];
    } catch (err) {
      console.error('❌ Stats error:', err.message);
      return null;
    }
  }
}

module.exports = SensorData;