const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');
const { SerialPort } = require('serialport');
const { ReadlineParser } = require('@serialport/parser-readline');
const path = require('path');
require('dotenv').config();

const db = require('./config/database');
const SensorData = require('./models/SensorData');
const Alert = require('./models/Alert');
const apiRoutes = require('./routes/api');
const syncRoutes = require('./routes/sync');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] }
});

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '../frontend')));

// ═══════════════════════════════════════════════════════════════════
// ESP32 WiFi HTTP POST ENDPOINT
// Receives data from Commander ESP32 via WiFi
// ═══════════════════════════════════════════════════════════════════

app.post('/api/esp32data', async (req, res) => {
  try {
    const data = req.body;

    if (!data || !data.device_id) {
      return res.status(400).json({ error: 'Invalid data' });
    }

    console.log(`📡 [WiFi] Data from ${data.device_id} | CMD: ${data.command} | HR: ${data.health?.hr}`);

    // Send to dashboard via WebSocket
    io.emit('sensorData', data);

    // Save to database
    await SensorData.create(data);

    // Check alerts
    await checkAlerts(data, io);

    // Update device status
    io.emit('deviceStatus', { connected: true, packetsReceived: ++packetCount });

    res.status(200).json({ success: true, message: 'Data received' });

  } catch (err) {
    console.error('❌ ESP32 data error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════════
// API ROUTES
// ═══════════════════════════════════════════════════════════════════

app.use('/api', apiRoutes);
app.use('/api/sync', syncRoutes);

// Serve dashboard
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '../frontend/index.html'));
});

// ═══════════════════════════════════════════════════════════════════
// PACKET COUNTER
// ═══════════════════════════════════════════════════════════════════

let packetCount = 0;

// ═══════════════════════════════════════════════════════════════════
// SERIAL PORT (USB fallback - when ESP32 connected via USB)
// ═══════════════════════════════════════════════════════════════════

let serialConnected = false;

function setupSerial() {
  const portName = process.env.SERIAL_PORT || 'COM5';

  try {
    const port = new SerialPort({
      path: portName,
      baudRate: 115200,
      autoOpen: false
    });

    const parser = port.pipe(new ReadlineParser({ delimiter: '\n' }));

    port.open((err) => {
      if (err) {
        console.log(`⚠️  Serial port ${portName} not available (USB fallback inactive)`);
        console.log('📡 WiFi mode active — waiting for ESP32 HTTP POST');
        return;
      }
      serialConnected = true;
      console.log(`✅ Serial Port opened: ${portName} (USB fallback active)`);
      io.emit('deviceStatus', { connected: true, packetsReceived: packetCount });
    });

    parser.on('data', async (line) => {
      try {
        const trimmed = line.trim();
        if (!trimmed.startsWith('{')) return;

        const data = JSON.parse(trimmed);
        if (!data.device_id) return;

        console.log(`📊 [USB] ${data.device_id} | CMD: ${data.command} | HR: ${data.health?.hr}`);

        packetCount++;
        io.emit('sensorData', data);
        io.emit('deviceStatus', { connected: true, packetsReceived: packetCount });

        await SensorData.create(data);
        await checkAlerts(data, io);

      } catch (e) {
        // Not JSON - skip
      }
    });

    port.on('close', () => {
      serialConnected = false;
      console.log('⚠️  Serial port closed');
      io.emit('deviceStatus', { connected: false, packetsReceived: packetCount });
    });

    port.on('error', (err) => {
      console.log(`⚠️  Serial error: ${err.message}`);
    });

  } catch (err) {
    console.log('⚠️  Serial setup failed — WiFi mode only');
  }
}

// ═══════════════════════════════════════════════════════════════════
// ALERT CHECKER
// ═══════════════════════════════════════════════════════════════════

async function checkAlerts(data, io) {
  try {
    const hr   = data.health?.hr   || 0;
    const temp = data.environment?.temp || 0;
    const sats = data.gps?.satellites  || 0;
    const id   = data.device_id;

    if (hr > 0 && hr < 50) {
      const alert = await Alert.create(id, 'critical', `❤️ ${id}: Heart rate critically low: ${hr} BPM`);
      if (alert) io.emit('alert', alert);
    } else if (hr > 150) {
      const alert = await Alert.create(id, 'warning', `❤️ ${id}: Heart rate high: ${hr} BPM`);
      if (alert) io.emit('alert', alert);
    }

    if (temp > 0 && temp > 40) {
      const alert = await Alert.create(id, 'warning', `🌡️ ${id}: High temperature: ${temp}°C`);
      if (alert) io.emit('alert', alert);
    }

    if (sats > 0 && sats < 4) {
      const alert = await Alert.create(id, 'info', `📍 ${id}: Weak GPS signal: ${sats} satellites`);
      if (alert) io.emit('alert', alert);
    }

    if (data.command === 'EMERGENCY') {
      const alert = await Alert.create(id, 'critical', `🚨 EMERGENCY signal from ${id}!`);
      if (alert) io.emit('alert', alert);
    }

  } catch (err) {
    console.error('Alert check error:', err.message);
  }
}

// ═══════════════════════════════════════════════════════════════════
// WEBSOCKET
// ═══════════════════════════════════════════════════════════════════

io.on('connection', (socket) => {
  console.log('👁️  Dashboard connected:', socket.id);

  socket.on('requestLatest', async () => {
    try {
      const latest = await SensorData.getLatest();
      if (latest) socket.emit('sensorData', latest);
    } catch (e) {}
  });

  socket.on('requestAlerts', async () => {
    try {
      const alerts = await Alert.getRecent();
      alerts.forEach(a => socket.emit('alert', a));
    } catch (e) {}
  });

  socket.on('disconnect', () => {
    console.log('👁️  Dashboard disconnected:', socket.id);
  });
});

// ═══════════════════════════════════════════════════════════════════
// START SERVER
// ═══════════════════════════════════════════════════════════════════

const PORT = process.env.PORT || 3000;

server.listen(PORT, '0.0.0.0', async () => {
  console.log('\n═══════════════════════════════════════════════════════════');
  console.log('🎖️  TACTICAL SOLDIER MONITORING — CENTRAL STATION');
  console.log('═══════════════════════════════════════════════════════════');
  console.log(`🌐 Dashboard:     http://localhost:${PORT}`);
  console.log(`📡 ESP32 WiFi:    http://YOUR_IP:${PORT}/api/esp32data`);
  console.log(`🔌 Serial (USB):  ${process.env.SERIAL_PORT || 'COM5'} (fallback)`);
  console.log('═══════════════════════════════════════════════════════════\n');

  try {
    await db.query('SELECT 1');
    console.log('✅ PostgreSQL connected');
  } catch (err) {
    console.log('⚠️  PostgreSQL error:', err.message);
  }

  setupSerial();
});
