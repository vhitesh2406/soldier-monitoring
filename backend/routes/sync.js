const express = require('express');
const router = express.Router();
const cloudSync = require('../config/cloudSync');

router.get('/status', async (req, res) => {
  const isOnline = await cloudSync.checkConnection();
  res.json({
    success: true,
    sync_enabled: cloudSync.enabled,
    cloud_reachable: isOnline,
    mode: isOnline ? 'online' : 'offline',
    sync_interval: cloudSync.syncInterval
  });
});

router.post('/now', async (req, res) => {
  try {
    await cloudSync.syncToCloud();
    res.json({ success: true, message: 'Sync completed' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;