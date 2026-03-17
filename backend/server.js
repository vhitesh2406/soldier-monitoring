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
// PACKET COUNTER
// ═══════════════════════════════════════════════════════════════════

let packetCount = 0;

// ═══════════════════════════════════════════════════════════════════
// ESP32 WiFi HTTP POST ENDPOINT
// ═══════════════════════════════════════════════════════════════════

app.post('/api/esp32data', async (req, res) => {
  try {
    const data = req.body;

    if (!data || !data.device_id) {
      return res.status(400).json({ error: 'Invalid data' });
    }

    console.log(`📡 [WiFi] Data from ${data.device_id} | CMD: ${data.command} | HR: ${data.health?.hr}`);

    packetCount++;

    // ✅ Emit deviceStatus FIRST before anything else!
    io.emit('deviceStatus', {
      connected: true,
      packetsReceived: packetCount,
      lastDevice: data.device_id,
      mode: 'WiFi'
    });

    // ✅ Emit sensor data to dashboard
    io.emit('sensorData', data);

    // ✅ Save to database — non-fatal!
    try {
      await SensorData.create(data);
    } catch (dbErr) {
      console.error('⚠️  DB error (non-fatal):', dbErr.message);
    }

    // ✅ Check alerts — non-fatal!
    try {
      await checkAlerts(data, io);
    } catch (alertErr) {
      console.error('⚠️  Alert error (non-fatal):', alertErr.message);
    }

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
// SERIAL PORT (USB fallback)
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
        io.emit('deviceStatus', { connected: true, packetsReceived: packetCount });
        io.emit('sensorData', data);

        try { await SensorData.create(data); }
        catch (dbErr) { console.error('⚠️  DB error:', dbErr.message); }

        try { await checkAlerts(data, io); }
        catch (alertErr) { console.error('⚠️  Alert error:', alertErr.message); }

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
      const alert = await Alert.create(id, 'low_heart_rate',
        `❤️ ${id}: Heart rate critically low: ${hr} BPM`, 'critical');
      if (alert) io.emit('alert', alert);
    } else if (hr > 150) {
      const alert = await Alert.create(id, 'high_heart_rate',
        `❤️ ${id}: Heart rate high: ${hr} BPM`, 'warning');
      if (alert) io.emit('alert', alert);
    }

    if (temp > 0 && temp > 40) {
      const alert = await Alert.create(id, 'high_temp',
        `🌡️ ${id}: High temperature: ${temp}°C`, 'warning');
      if (alert) io.emit('alert', alert);
    }

    if (sats > 0 && sats < 4) {
      const alert = await Alert.create(id, 'weak_gps',
        `📍 ${id}: Weak GPS signal: ${sats} satellites`, 'info');
      if (alert) io.emit('alert', alert);
    }

    if (data.command === 'EMERGENCY') {
      const alert = await Alert.create(id, 'emergency',
        `🚨 EMERGENCY signal from ${id}!`, 'critical');
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

  // ✅ Send current status immediately on connect
  socket.emit('deviceStatus', {
    connected: packetCount > 0,
    packetsReceived: packetCount
  });

  socket.on('requestLatest', async () => {
    try {
      const latest = await SensorData.getLatest(10);
      if (latest && latest.length > 0) {
        latest.forEach(record => {
          // Reconstruct data format for dashboard
          const data = {
            device_id: record.device_id,
            command: record.command,
            channel: record.channel,
            timestamp: record.timestamp,
            health: {
              hr: record.heart_rate,
              spo2: record.spo2
            },
            gps: {
              lat: record.gps_lat,
              lng: record.gps_lng,
              speed: record.gps_speed,
              satellites: record.gps_satellites
            },
            environment: {
              temp: record.temperature,
              pressure: record.pressure
            },
            motion: {
              ax: record.accel_x,
              ay: record.accel_y,
              az: record.accel_z,
              gx: record.gyro_x,
              gy: record.gyro_y,
              gz: record.gyro_z
            }
          };
          socket.emit('sensorData', data);
        });
      }
    } catch (e) {
      console.error('requestLatest error:', e.message);
    }
  });

  socket.on('requestAlerts', async () => {
    try {
      const alerts = await Alert.getUnacknowledged();
      alerts.forEach(a => socket.emit('alert', a));
    } catch (e) {
      console.error('requestAlerts error:', e.message);
    }
  });

  socket.on('disconnect', () => {
    console.log('👁️  Dashboard disconnected:', socket.id);
  });
});

// ═══════════════════════════════════════════════════════════════════
// HEALTH CHECK ENDPOINT
// ═══════════════════════════════════════════════════════════════════

app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    packets: packetCount,
    uptime: process.uptime(),
    timestamp: new Date().toISOString()
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