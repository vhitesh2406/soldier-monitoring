const socket = io(window.location.origin);

// Store all units data
const units = {};
const unitStats = {};
const unitHistories = {};
const unitHRData = {};
const unitTempData = {};
let sessionStart = Date.now();
let modalHRChart = null;
let modalTempChart = null;
let currentModalUnit = null;
let totalUnits = 0;

document.addEventListener('DOMContentLoaded', () => {
  startSessionTimer();
  document.getElementById('dismissAlert').addEventListener('click', () => {
    document.getElementById('alertsBar').classList.add('hidden');
  });
  document.getElementById('closeModal').addEventListener('click', closeModal);
});

// =====================
// SOCKET EVENTS
// =====================
socket.on('connect', () => {
  setStatus('connectionStatus', true);
  socket.emit('requestLatest');
  socket.emit('requestAlerts');
});

socket.on('disconnect', () => setStatus('connectionStatus', false));

socket.on('sensorData', (data) => processData(data));

socket.on('alert', (alert) => showAlert(alert.alert_message, alert.severity));

socket.on('deviceStatus', (status) => {
  const devBadge = document.getElementById('deviceStatus');
  if (status.connected) {
    devBadge.textContent = 'CONNECTED';
    devBadge.className = 'status-badge status-online';
  } else {
    devBadge.textContent = 'DISCONNECTED';
    devBadge.className = 'status-badge status-offline';
  }
});

// =====================
// PROCESS DATA
// =====================
function processData(data) {
  const deviceId = data.device_id;
  if (!deviceId || deviceId === 'unknown') return;

  // First time seeing this device - create card
  if (!units[deviceId]) {
    units[deviceId] = {};
    unitHistories[deviceId] = [];
    unitHRData[deviceId] = { labels: [], data: [] };
    unitTempData[deviceId] = { labels: [], data: [] };
    unitStats[deviceId] = { hrSum: 0, hrCount: 0, tempSum: 0, tempCount: 0, packets: 0 };
    createUnitCard(deviceId);
    totalUnits++;
    document.getElementById('activeUnits').textContent = totalUnits;
    document.getElementById('totalUnits').textContent = totalUnits;
  }

  // Save latest data
  units[deviceId] = data;
  unitStats[deviceId].packets++;

  // Update stats
  const hr = data.health?.hr || 0;
  const temp = data.environment?.temp || 0;
  if (hr > 0 && hr < 250) {
    unitStats[deviceId].hrSum += hr;
    unitStats[deviceId].hrCount++;
    addChartPoint(unitHRData[deviceId], hr);
  }
  if (temp > 0) {
    unitStats[deviceId].tempSum += temp;
    unitStats[deviceId].tempCount++;
    addChartPoint(unitTempData[deviceId], temp);
  }

  // Command history
  if (data.command) {
    unitHistories[deviceId].unshift({
      command: data.command,
      time: new Date().toLocaleTimeString(),
      channel: data.channel
    });
    if (unitHistories[deviceId].length > 15) unitHistories[deviceId].pop();
  }

  // Update card
  updateUnitCard(deviceId, data);

  // Update modal if open for this unit
  if (currentModalUnit === deviceId) updateModal(deviceId, data);

  // Update summary
  updateSummary();

  document.getElementById('lastUpdate').textContent = new Date().toLocaleTimeString();
}

// =====================
// CREATE UNIT CARD
// =====================
function createUnitCard(deviceId) {
  const waiting = document.querySelector('.waiting-message');
  if (waiting) waiting.remove();

  const grid = document.getElementById('unitsGrid');
  const isCommander = deviceId.toLowerCase().includes('commander');
  const unitType = isCommander ? 'commander' : 'soldier';
  const unitLabel = isCommander ? '👑 Commander' : '🎖️ Soldier';
  const displayName = deviceId.replace(/_/g, ' ').toUpperCase();

  const card = document.createElement('div');
  card.className = `unit-card ${unitType}`;
  card.id = `card-${deviceId}`;
  card.innerHTML = `
    <div class="unit-live-dot"></div>
    <div class="unit-header">
      <div class="unit-name">${displayName}</div>
      <span class="unit-type type-${unitType}">${unitLabel}</span>
    </div>
    <div class="unit-vitals">
      <div class="vital-box hr">
        <div class="vital-box-label">❤️ Heart Rate</div>
        <div class="vital-box-value" id="hr-${deviceId}">--</div>
        <div class="vital-box-unit">BPM</div>
      </div>
      <div class="vital-box temp">
        <div class="vital-box-label">🌡️ Temperature</div>
        <div class="vital-box-value" id="temp-${deviceId}">--</div>
        <div class="vital-box-unit">°C</div>
      </div>
      <div class="vital-box gps">
        <div class="vital-box-label">📍 Satellites</div>
        <div class="vital-box-value" id="sats-${deviceId}">--</div>
        <div class="vital-box-unit">GPS sats</div>
      </div>
      <div class="vital-box cmd">
        <div class="vital-box-label">🎤 Command</div>
        <div class="vital-box-value" id="cmd-${deviceId}" style="font-size:14px">--</div>
        <div class="vital-box-unit">last cmd</div>
      </div>
    </div>
    <div class="unit-health-bar health-normal" id="health-${deviceId}">
      ⏳ Waiting for data...
    </div>
    <div class="unit-footer">
      <span id="time-${deviceId}">Never</span>
      <span id="ch-${deviceId}">CH: --</span>
    </div>
    <button class="view-detail-btn" onclick="openModal('${deviceId}')">
      🔍 View Full Details
    </button>
  `;
  grid.appendChild(card);
}

// =====================
// UPDATE UNIT CARD
// =====================
function updateUnitCard(deviceId, data) {
  const hr = data.health?.hr || 0;
  const temp = data.environment?.temp;
  const sats = data.gps?.satellites || 0;
  const cmd = data.command || '--';
  const isCommander = deviceId.toLowerCase().includes('commander');

  const set = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };

  set(`hr-${deviceId}`, hr || '--');
  set(`temp-${deviceId}`, temp ? temp.toFixed(1) : '--');
  set(`sats-${deviceId}`, sats);
  set(`cmd-${deviceId}`, cmd);
  set(`time-${deviceId}`, new Date().toLocaleTimeString());
  set(`ch-${deviceId}`, `CH: ${data.channel || '--'}`);

  // Health status
  const healthEl = document.getElementById(`health-${deviceId}`);
  const card = document.getElementById(`card-${deviceId}`);
  if (healthEl && card) {
    const baseClass = `unit-card ${isCommander ? 'commander' : 'soldier'}`;
    if (hr === 0) {
      healthEl.className = 'unit-health-bar health-normal';
      healthEl.textContent = '⏳ Waiting for data...';
      card.className = baseClass;
    } else if (hr < 50 || hr > 150) {
      healthEl.className = 'unit-health-bar health-critical';
      healthEl.textContent = '🚨 CRITICAL - Immediate attention!';
      card.className = baseClass + ' critical';
    } else if (hr > 120) {
      healthEl.className = 'unit-health-bar health-warning';
      healthEl.textContent = '⚠️ WARNING - Heart rate elevated';
      card.className = baseClass + ' warning';
    } else {
      healthEl.className = 'unit-health-bar health-normal';
      healthEl.textContent = '✅ NORMAL - All vitals good';
      card.className = baseClass;
    }
  }
}

// =====================
// MODAL
// =====================
function openModal(deviceId) {
  currentModalUnit = deviceId;
  const displayName = deviceId.replace(/_/g, ' ').toUpperCase();
  document.getElementById('modalTitle').textContent = `🎖️ ${displayName} — Full Details`;
  document.getElementById('detailModal').classList.remove('hidden');

  // Destroy old charts
  if (modalHRChart) { modalHRChart.destroy(); modalHRChart = null; }
  if (modalTempChart) { modalTempChart.destroy(); modalTempChart = null; }

  // HR Chart
  modalHRChart = new Chart(document.getElementById('modalHRChart'), {
    type: 'line',
    data: {
      labels: [...unitHRData[deviceId].labels],
      datasets: [{
        label: 'Heart Rate (BPM)',
        data: [...unitHRData[deviceId].data],
        borderColor: '#f5576c',
        backgroundColor: 'rgba(245,87,108,0.1)',
        tension: 0.4, fill: true, borderWidth: 2, pointRadius: 3
      }]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: { y: { min: 40, max: 180 }, x: { grid: { display: false } } },
      animation: { duration: 300 }
    }
  });

  // Temp Chart
  modalTempChart = new Chart(document.getElementById('modalTempChart'), {
    type: 'line',
    data: {
      labels: [...unitTempData[deviceId].labels],
      datasets: [{
        label: 'Temperature (°C)',
        data: [...unitTempData[deviceId].data],
        borderColor: '#f59e0b',
        backgroundColor: 'rgba(245,158,11,0.1)',
        tension: 0.4, fill: true, borderWidth: 2, pointRadius: 3
      }]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: { y: { min: 0, max: 50 }, x: { grid: { display: false } } },
      animation: { duration: 300 }
    }
  });

  // Update with current data
  const data = units[deviceId];
  if (data) updateModal(deviceId, data);
  updateModalHistory(deviceId);
}

function updateModal(deviceId, data) {
  const hr = data.health?.hr || 0;
  const temp = data.environment?.temp;
  const sats = data.gps?.satellites || 0;
  const stats = unitStats[deviceId];

  const set = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };

  set('modalHR', hr || '--');
  set('modalLat', data.gps?.lat ? data.gps.lat.toFixed(6) : '--');
  set('modalLng', data.gps?.lng ? data.gps.lng.toFixed(6) : '--');
  set('modalSpeed', data.gps?.speed ? data.gps.speed.toFixed(1) + ' km/h' : '--');
  set('modalSats', sats);
  set('modalTemp', temp ? temp.toFixed(1) + '°C' : '--');
  set('modalPressure', data.environment?.pressure ? data.environment.pressure.toFixed(1) + ' hPa' : '--');
  set('modalAX', data.motion?.ax?.toFixed(2) || '--');
  set('modalAY', data.motion?.ay?.toFixed(2) || '--');
  set('modalAZ', data.motion?.az?.toFixed(2) || '--');
  set('modalGX', data.motion?.gx?.toFixed(2) || '--');
  set('modalGY', data.motion?.gy?.toFixed(2) || '--');
  set('modalGZ', data.motion?.gz?.toFixed(2) || '--');
  set('modalCommand', data.command || 'WAITING...');
  set('modalCmdTime', data.timestamp ? new Date(data.timestamp).toLocaleTimeString() : '--');
  set('modalCmdCh', `CH: ${data.channel || '--'}`);
  set('modalPackets', stats?.packets || 0);
  set('modalAvgHR', stats?.hrCount > 0 ? Math.round(stats.hrSum / stats.hrCount) + ' BPM' : '--');
  set('modalAvgTemp', stats?.tempCount > 0 ? (stats.tempSum / stats.tempCount).toFixed(1) + '°C' : '--');
  set('modalGPSLabel', sats >= 4 ? '✅ Fixed' : sats > 0 ? '⚠️ Weak' : '❌ No Fix');

  // GPS status
  const gpsEl = document.getElementById('modalGpsStatus');
  if (gpsEl) gpsEl.textContent = sats >= 4 ? `✅ GPS Fix: ${sats} satellites` : sats > 0 ? `⚠️ Weak: ${sats} satellites` : '❌ No GPS fix';

  // Temp bar
  if (temp) {
    const pct = Math.min(100, Math.max(0, (temp / 50) * 100));
    const fill = document.getElementById('modalTempFill');
    if (fill) fill.style.width = pct + '%';
  }

  // Health status
  const statusEl = document.getElementById('modalHealthStatus');
  if (statusEl) {
    if (hr === 0) {
      statusEl.textContent = '⏳ Waiting for data...';
      statusEl.style.cssText = 'background:#dcfce7;color:#166534';
    } else if (hr < 50 || hr > 150) {
      statusEl.textContent = '🚨 CRITICAL - Immediate attention required!';
      statusEl.style.cssText = 'background:#fee2e2;color:#991b1b';
    } else if (hr > 120) {
      statusEl.textContent = '⚠️ WARNING - Heart rate elevated';
      statusEl.style.cssText = 'background:#fef9c3;color:#854d0e';
    } else {
      statusEl.textContent = '✅ NORMAL - All vitals within range';
      statusEl.style.cssText = 'background:#dcfce7;color:#166534';
    }
  }

  // Update charts
  if (modalHRChart && hr > 0) {
    modalHRChart.data.labels = [...unitHRData[deviceId].labels];
    modalHRChart.data.datasets[0].data = [...unitHRData[deviceId].data];
    modalHRChart.update('none');
  }
  if (modalTempChart && temp) {
    modalTempChart.data.labels = [...unitTempData[deviceId].labels];
    modalTempChart.data.datasets[0].data = [...unitTempData[deviceId].data];
    modalTempChart.update('none');
  }
}

function updateModalHistory(deviceId) {
  const history = unitHistories[deviceId] || [];
  const el = document.getElementById('modalHistory');
  if (!el) return;
  el.innerHTML = history.length === 0
    ? '<div class="history-empty">No commands yet</div>'
    : history.map(h => `
        <div class="history-item">
          <span class="history-command">${h.command}</span>
          <div class="history-meta">
            <span class="history-time">${h.time}</span>
            <span class="history-ch">CH: ${h.channel || '--'}</span>
          </div>
        </div>`).join('');
}

function closeModal() {
  document.getElementById('detailModal').classList.add('hidden');
  currentModalUnit = null;
  if (modalHRChart) { modalHRChart.destroy(); modalHRChart = null; }
  if (modalTempChart) { modalTempChart.destroy(); modalTempChart = null; }
}

// =====================
// SUMMARY
// =====================
function updateSummary() {
  let normal = 0, warning = 0, critical = 0;
  let hrTotal = 0, hrCount = 0, tempTotal = 0, tempCount = 0;

  Object.entries(units).forEach(([id, data]) => {
    const hr = data.health?.hr || 0;
    const temp = data.environment?.temp || 0;
    if (hr > 0) {
      hrTotal += hr; hrCount++;
      if (hr < 50 || hr > 150) critical++;
      else if (hr > 120) warning++;
      else normal++;
    }
    if (temp > 0) { tempTotal += temp; tempCount++; }
  });

  const set = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
  set('normalUnits', normal);
  set('warningUnits', warning);
  set('criticalUnits', critical);
  set('avgHR', hrCount > 0 ? Math.round(hrTotal / hrCount) + ' BPM' : '-- BPM');
  set('avgTemp', tempCount > 0 ? (tempTotal / tempCount).toFixed(1) + '°C' : '--°C');
}

// =====================
// HELPERS
// =====================
function addChartPoint(chartData, value) {
  chartData.labels.push(new Date().toLocaleTimeString());
  chartData.data.push(value);
  if (chartData.labels.length > 20) {
    chartData.labels.shift();
    chartData.data.shift();
  }
}

function showAlert(message, severity = 'warning') {
  const bar = document.getElementById('alertsBar');
  document.getElementById('alertMessage').textContent = message;
  bar.classList.remove('hidden');
  if (severity === 'critical') bar.style.background = 'linear-gradient(135deg,#dc2626,#ef4444)';
  else if (severity === 'warning') bar.style.background = 'linear-gradient(135deg,#d97706,#f59e0b)';
  else bar.style.background = 'linear-gradient(135deg,#1d4ed8,#3b82f6)';
  setTimeout(() => bar.classList.add('hidden'), 15000);
}

function setStatus(id, connected) {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = connected ? 'ONLINE' : 'OFFLINE';
  el.className = `status-badge ${connected ? 'status-online' : 'status-offline'}`;
}

function startSessionTimer() {
  setInterval(() => {
    const e = Math.floor((Date.now() - sessionStart) / 1000);
    const el = document.getElementById('sessionTime');
    if (el) el.textContent = `${pad(Math.floor(e/3600))}:${pad(Math.floor((e%3600)/60))}:${pad(e%60)}`;
  }, 1000);
}

function pad(n) { return n.toString().padStart(2, '0'); }

console.log('🎖️ Central Monitoring Station v3.0 Loaded');