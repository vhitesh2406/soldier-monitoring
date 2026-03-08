const pool = require('../config/database');

class Alert {
  static async create(deviceId, alertType, message, severity = 'warning') {
    const query = `
      INSERT INTO alerts (device_id, alert_type, alert_message, severity)
      VALUES ($1, $2, $3, $4)
      RETURNING *;
    `;
    try {
      const result = await pool.query(query, [deviceId, alertType, message, severity]);
      return result.rows[0];
    } catch (err) {
      console.error('❌ Alert error:', err.message);
      return null;
    }
  }

  static async getUnacknowledged(deviceId = null) {
    let query = `SELECT * FROM alerts WHERE acknowledged = FALSE`;
    const params = [];
    if (deviceId) {
      query += ` AND device_id = $1`;
      params.push(deviceId);
    }
    query += ` ORDER BY created_at DESC`;
    try {
      const result = await pool.query(query, params);
      return result.rows;
    } catch (err) {
      console.error('❌ Alert query error:', err.message);
      return [];
    }
  }

  static async acknowledge(alertId) {
    const query = `
      UPDATE alerts
      SET acknowledged = TRUE
      WHERE id = $1
      RETURNING *;
    `;
    try {
      const result = await pool.query(query, [alertId]);
      return result.rows[0];
    } catch (err) {
      console.error('❌ Acknowledge error:', err.message);
      return null;
    }
  }

  static checkConditions(data) {
    const alerts = [];
    if (data.health?.hr) {
      if (data.health.hr < 50)
        alerts.push({ type: 'low_heart_rate', message: `❤️ Heart rate critically low: ${data.health.hr} BPM`, severity: 'critical' });
      else if (data.health.hr > 150)
        alerts.push({ type: 'very_high_heart_rate', message: `❤️ Heart rate very high: ${data.health.hr} BPM`, severity: 'critical' });
      else if (data.health.hr > 120)
        alerts.push({ type: 'high_heart_rate', message: `❤️ Heart rate elevated: ${data.health.hr} BPM`, severity: 'warning' });
    }
    if (data.health?.spo2) {
      if (data.health.spo2 < 90)
        alerts.push({ type: 'low_spo2', message: `🫁 Blood oxygen critically low: ${data.health.spo2}%`, severity: 'critical' });
      else if (data.health.spo2 < 94)
        alerts.push({ type: 'low_spo2_warning', message: `🫁 Blood oxygen low: ${data.health.spo2}%`, severity: 'warning' });
    }
    if (data.environment?.temp) {
      if (data.environment.temp < 0)
        alerts.push({ type: 'extreme_cold', message: `🥶 Extreme cold: ${data.environment.temp.toFixed(1)}°C`, severity: 'critical' });
      else if (data.environment.temp < 10)
        alerts.push({ type: 'hypothermia_risk', message: `❄️ Low temperature: ${data.environment.temp.toFixed(1)}°C`, severity: 'warning' });
      else if (data.environment.temp > 45)
        alerts.push({ type: 'extreme_heat', message: `🔥 Extreme heat: ${data.environment.temp.toFixed(1)}°C`, severity: 'critical' });
      else if (data.environment.temp > 40)
        alerts.push({ type: 'hyperthermia_risk', message: `🌡️ High temperature: ${data.environment.temp.toFixed(1)}°C`, severity: 'warning' });
    }
    if (data.gps?.satellites !== undefined && data.gps.satellites < 4)
      alerts.push({ type: 'gps_weak', message: `📡 GPS signal weak: ${data.gps.satellites} satellites`, severity: 'info' });
    if (data.command === 'EMERGENCY')
      alerts.push({ type: 'emergency_command', message: `🚨 EMERGENCY COMMAND ISSUED!`, severity: 'critical' });
    return alerts;
  }
}

module.exports = Alert;