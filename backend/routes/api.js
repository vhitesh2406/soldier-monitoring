const express = require('express');
const router = express.Router();
const SensorData = require('../models/SensorData');
const Alert = require('../models/Alert');

router.get('/latest', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 10;
    const deviceId = req.query.device_id || null;
    const data = await SensorData.getLatest(limit, deviceId);
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.get('/stats', async (req, res) => {
  try {
    const deviceId = req.query.device_id || null;
    const stats = await SensorData.getStats(deviceId);
    res.json({ success: true, stats });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.get('/alerts', async (req, res) => {
  try {
    const deviceId = req.query.device_id || null;
    const alerts = await Alert.getUnacknowledged(deviceId);
    res.json({ success: true, alerts });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/alerts/:id/acknowledge', async (req, res) => {
  try {
    const alert = await Alert.acknowledge(req.params.id);
    res.json({ success: true, alert });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;