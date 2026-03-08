const axios = require('axios');
const pool = require('./database');
require('dotenv').config();

class CloudSync {
  constructor() {
    this.enabled = process.env.SYNC_ENABLED === 'true';
    this.cloudUrl = process.env.CLOUD_API_URL;
    this.apiKey = process.env.CLOUD_API_KEY;
    this.syncInterval = parseInt(process.env.SYNC_INTERVAL) || 30000;
    this.syncing = false;
  }

  async syncToCloud() {
    if (!this.enabled || this.syncing) return;
    this.syncing = true;
    try {
      const result = await pool.query(`
        SELECT * FROM sensor_data 
        WHERE synced_to_cloud = FALSE 
        ORDER BY created_at ASC 
        LIMIT 100
      `);
      const unsyncedData = result.rows;
      if (unsyncedData.length === 0) { this.syncing = false; return; }
      console.log(`📡 Syncing ${unsyncedData.length} records to cloud...`);
      const response = await axios.post(
        `${this.cloudUrl}/sync`,
        { data: unsyncedData, source: 'commander_device_1' },
        {
          headers: {
            'Authorization': `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json'
          },
          timeout: 10000
        }
      );
      if (response.status === 200) {
        const ids = unsyncedData.map(d => d.id);
        await pool.query(`
          UPDATE sensor_data 
          SET synced_to_cloud = TRUE 
          WHERE id = ANY($1)
        `, [ids]);
        console.log(`✅ Synced ${unsyncedData.length} records`);
      }
    } catch (error) {
      if (error.code === 'ECONNREFUSED' || error.code === 'ETIMEDOUT') {
        console.log('⚠️  Cloud unreachable - staying offline');
      } else {
        console.error('❌ Sync error:', error.message);
      }
    } finally {
      this.syncing = false;
    }
  }

  startAutoSync() {
    if (!this.enabled) {
      console.log('📡 Cloud sync disabled - offline mode');
      return;
    }
    console.log(`📡 Cloud sync enabled - every ${this.syncInterval/1000}s`);
    this.syncToCloud();
    setInterval(() => this.syncToCloud(), this.syncInterval);
  }

  async checkConnection() {
    try {
      const response = await axios.get(`${this.cloudUrl}/health`, { timeout: 5000 });
      return response.status === 200;
    } catch {
      return false;
    }
  }
}

module.exports = new CloudSync();