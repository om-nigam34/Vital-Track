requireAuth();

/* Mirrors backend/config.py Config.THRESHOLDS - kept in sync manually since
   this is a plain static frontend with no shared config import. */
const THRESHOLDS = {
  heart_rate: { low: 60, high: 100 },
  spo2: { low: 95, high: 100 },
  temperature: { low: 36.1, high: 37.2 },
};

const POLL_MS = 3000;
const SPARK_POINTS = 20;

const state = {
  patients: [],
  patientId: null,
  manualDisconnect: {}, // { [patientId]: true } - client-side pause only, see renderDevice()
  charts: {},
  ecg: null,
  pollTimer: null,
};

// icons & static chrome

function paintIcons() {
  document.getElementById("brandMark").innerHTML = icon("logo");

  const navOrder = ["grid", "pulse", "history", "report", "bell", "users", "settings", "user"];
  document.querySelectorAll(".nav-link > span:first-child").forEach((span, i) => {
    span.innerHTML = icon(navOrder[i] || "grid");
  });
  document.querySelector(".logout-link > span:first-child").innerHTML = icon("logout");

  document.getElementById("iconCalendar").innerHTML = icon("calendar");
  document.getElementById("iconClock").innerHTML = icon("clock");
  document.getElementById("iconWifi").innerHTML = icon("wifi");
  document.getElementById("iconChevron").innerHTML = icon("chevronDown");
  document.querySelector(".hamburger").innerHTML = icon("menu");

  document.getElementById("bannerIcon").innerHTML = icon("alertTriangle");
  document.getElementById("iconHr").innerHTML = icon("heart");
  document.getElementById("iconSpo2").innerHTML = icon("droplet");
  document.getElementById("iconTemp").innerHTML = icon("thermometer");
  document.getElementById("iconEcg").innerHTML = icon("activity");
  document.getElementById("iconEcgTitle").innerHTML = icon("activity");
  document.getElementById("iconTrendTitle").innerHTML = icon("trending");
  document.getElementById("iconPower").innerHTML = icon("power");
}

function paintUser() {
  const user = getStoredUser();
  const displayName = user?.full_name || user?.username || "Admin";
  document.getElementById("adminName").textContent = displayName;
  document.getElementById("adminAvatar").textContent = displayName.slice(0, 1).toUpperCase();
}

function startClock() {
  const dateEl = document.getElementById("topDate");
  const clockEl = document.getElementById("topClock");
  function tick() {
    const now = new Date();
    dateEl.textContent = now.toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" });
    clockEl.textContent = now.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  }
  tick();
  setInterval(tick, 1000);
}

// helpers

function statusFor(type, value) {
  if (value === null || value === undefined) return { label: "--", cls: "normal" };
  const t = THRESHOLDS[type];
  if (value < t.low) return { label: "Low", cls: "low" };
  if (value > t.high) return { label: "High", cls: "high" };
  return { label: "Normal", cls: "normal" };
}

function downsample(arr, maxPoints) {
  if (arr.length <= maxPoints) return arr;
  const step = Math.ceil(arr.length / maxPoints);
  return arr.filter((_, i) => i % step === 0);
}

function initialsFor(name) {
  if (!name) return "--";
  return name.split(" ").filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join("");
}

// patient list / selector

async function loadPatients() {
  const data = await api("/api/patients?include_latest=1");
  state.patients = data.patients;

  const select = document.getElementById("patientSelect");
  select.innerHTML = state.patients
    .map((p) => `<option value="${p.id}">${p.name} (${p.patient_code})</option>`)
    .join("");

  const stored = getSelectedPatientId();
  const validStored = stored && state.patients.some((p) => p.id === stored);
  state.patientId = validStored ? stored : state.patients[0]?.id || null;

  if (state.patientId) {
    select.value = String(state.patientId);
    setSelectedPatientId(state.patientId);
  }

  select.addEventListener("change", () => {
    state.patientId = parseInt(select.value, 10);
    setSelectedPatientId(state.patientId);
    refreshAll(true);
  });
}

function renderSidebarPatientCard(patient) {
  document.getElementById("patientAvatar").textContent = initialsFor(patient?.name);
  document.getElementById("patientCardName").textContent = patient?.name || "No patient";
  document.getElementById("patientCardMeta").textContent = patient
    ? `${patient.patient_code} \u00b7 ${patient.gender || "-"}, ${patient.age ?? "-"} Yrs`
    : "Add a patient to get started";

  const manuallyOff = !!state.manualDisconnect[patient?.id];
  const connected = !manuallyOff && !!patient?.device?.connected;
  document.getElementById("patientConnDot").className = `dot ${connected ? "online" : "offline"}`;
  document.getElementById("patientConnLabel").textContent = patient?.device
    ? (connected ? "Device Connected" : "Device Disconnected")
    : "No device assigned";
}

// charts

function initCharts() {
  state.charts.hrSpark = makeSparkline(document.getElementById("hrSpark"), Array(SPARK_POINTS).fill(null), "#f0546a");
  state.charts.spo2Spark = makeSparkline(document.getElementById("spo2Spark"), Array(SPARK_POINTS).fill(null), "#2e9bff");
  state.charts.tempSpark = makeSparkline(document.getElementById("tempSpark"), Array(SPARK_POINTS).fill(null), "#34d399");
  state.charts.trend = makeTrendChart(document.getElementById("trendCanvas"), [], [], [], []);

  state.ecg = new ECGMonitor(document.getElementById("ecgCanvas"), { color: "#34d399" });
  state.ecg.start();
}

// render pieces

function renderStatCards(reading) {
  const hr = reading?.heart_rate ?? null;
  const spo2 = reading?.spo2 ?? null;
  const temp = reading?.temperature ?? null;

  document.getElementById("hrValue").textContent = hr != null ? Math.round(hr) : "--";
  document.getElementById("spo2Value").textContent = spo2 != null ? Math.round(spo2) : "--";
  document.getElementById("tempValue").textContent = temp != null ? temp.toFixed(1) : "--";

  const ecgStatus = reading?.ecg_status || "--";
  const ecgEl = document.getElementById("ecgValue");
  ecgEl.textContent = ecgStatus;
  ecgEl.style.color = ecgStatus === "Irregular" ? "var(--red)" : "var(--purple)";
  document.getElementById("ecgSub").textContent = ecgStatus === "Irregular" ? "Irregular rhythm - check patient" : "Sinus Rhythm";

  if (hr != null) state.ecg?.setHeartRate(hr);
}

function renderLatestReadings(reading) {
  const el = document.getElementById("latestReadingsList");
  if (!reading) {
    el.innerHTML = `<div class="empty-state">No readings yet. Run firmware/esp32_simulator.py (or flash the real ESP32) to start streaming data.</div>`;
    document.getElementById("lastUpdated").textContent = "Last updated: --";
    return;
  }

  const rows = [
    { key: "heart_rate", label: "Heart Rate", value: reading.heart_rate, unit: "BPM", ic: "heart", color: "red" },
    { key: "spo2", label: "SpO2", value: reading.spo2, unit: "%", ic: "droplet", color: "blue" },
    { key: "temperature", label: "Temperature", value: reading.temperature, unit: "°C", ic: "thermometer", color: "green" },
  ];

  let html = rows
    .map((r) => {
      const st = statusFor(r.key, r.value);
      const shown = r.value != null ? (r.key === "temperature" ? r.value.toFixed(1) : Math.round(r.value)) : "--";
      return `<div class="reading-row">
        <div class="row-icon" style="background:var(--${r.color}-soft);color:var(--${r.color})">${icon(r.ic)}</div>
        <div class="label">${r.label}</div>
        <div class="value-col"><span class="value">${shown} ${r.unit}</span><span class="badge ${st.cls}">${st.label}</span></div>
      </div>`;
    })
    .join("");

  const ecgOk = reading.ecg_status !== "Irregular";
  html += `<div class="reading-row">
    <div class="row-icon" style="background:var(--purple-soft);color:var(--purple)">${icon("activity")}</div>
    <div class="label">ECG Status</div>
    <div class="value-col"><span class="value">${reading.ecg_status}</span><span class="badge ${ecgOk ? "normal" : "critical"}">${ecgOk ? "Normal" : "Alert"}</span></div>
  </div>`;

  el.innerHTML = html;
  document.getElementById("lastUpdated").textContent = "Last updated: " + new Date(reading.recorded_at).toLocaleString();
}

function alertIconFor(type) {
  return { heart_rate: "heart", spo2: "droplet", temperature: "thermometer" }[type] || "chip";
}
function alertColorFor(sev) {
  return { critical: "red", warning: "amber" }[sev] || "blue";
}

function renderAlertsPanel(alerts) {
  const el = document.getElementById("recentAlertsList");
  if (!alerts.length) {
    el.innerHTML = `<div class="empty-state">No alerts for this patient yet.</div>`;
  } else {
    el.innerHTML = alerts
      .slice(0, 6)
      .map((a) => {
        const color = alertColorFor(a.severity);
        return `<div class="alert-row">
          <div class="row-icon" style="background:var(--${color}-soft);color:var(--${color})">${icon(alertIconFor(a.vital_type))}</div>
          <div class="txt"><div class="t">${a.title}</div><div class="m">${a.message}</div></div>
          <div class="time">${formatClockTime(a.created_at)}</div>
        </div>`;
      })
      .join("");
  }

  const unread = alerts.filter((a) => !a.is_read);
  const banner = document.getElementById("alertBanner");
  if (unread.length) {
    document.getElementById("bannerText").textContent = unread[0].message;
    banner.classList.remove("hidden");
  } else {
    banner.classList.add("hidden");
  }
}

function updateSidebarAlertBadge(count) {
  const badge = document.getElementById("sidebarAlertBadge");
  if (count > 0) {
    badge.textContent = count > 99 ? "99+" : String(count);
    badge.classList.remove("hidden");
  } else {
    badge.classList.add("hidden");
  }
}

function wifiLabelFor(pct) {
  if (pct >= 80) return "Strong";
  if (pct >= 50) return "Good";
  if (pct >= 25) return "Weak";
  return "Poor";
}

function renderDevice(patient) {
  const el = document.getElementById("deviceInfoList");
  const device = patient?.device;
  const toggleBtn = document.getElementById("deviceToggleBtn");
  const toggleLabel = document.getElementById("deviceToggleLabel");

  if (!device) {
    el.innerHTML = `<div class="empty-state">No device assigned to this patient yet. Register one from the Patients page or via seed.py.</div>`;
    toggleBtn.disabled = true;
    return;
  }
  toggleBtn.disabled = false;

  const manuallyOff = !!state.manualDisconnect[patient.id];
  const connected = !manuallyOff && device.connected;

  el.innerHTML = `
    <div class="device-row"><span class="label">Device Status</span>
      <span class="value-col"><span class="dot ${connected ? "online" : "offline"}"></span>${connected ? "Connected" : "Disconnected"}</span></div>
    <div class="device-row"><span class="label">Wi-Fi Signal</span>
      <span class="value-col">${icon("wifi")}${wifiLabelFor(device.wifi_signal)} (${device.wifi_signal}%)</span></div>
    <div class="device-row"><span class="label">Battery Level</span>
      <span class="value-col">${icon("battery")}${device.battery_level}%</span></div>
    <div class="device-row"><span class="label">Firmware Version</span>
      <span class="value-col">${device.firmware_version}</span></div>
  `;
  toggleLabel.textContent = manuallyOff ? "Reconnect Device" : "Disconnect Device";
}

// data refresh

async function refreshAll(resetCharts = false) {
  if (!state.patientId) return;

  try {
    const [{ patient }, alertsData] = await Promise.all([
      api(`/api/patients/${state.patientId}`),
      api(`/api/alerts?patient_id=${state.patientId}&limit=8`),
    ]);

    renderSidebarPatientCard(patient);
    renderDevice(patient);
    renderStatCards(patient.latest_reading);
    renderLatestReadings(patient.latest_reading);
    renderAlertsPanel(alertsData.alerts);
    updateSidebarAlertBadge(alertsData.unread_count);

    const rangeMinutes = parseInt(document.getElementById("trendRange").value, 10);
    const historyData = await api(`/api/vitals/history?patient_id=${state.patientId}&minutes=${rangeMinutes}`);
    const readings = historyData.readings;

    if (resetCharts || readings.length) {
      const trimmed = downsample(readings, 120);
      const labels = trimmed.map((r) => new Date(r.recorded_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }));
      updateTrendChart(
        state.charts.trend,
        labels,
        trimmed.map((r) => r.heart_rate),
        trimmed.map((r) => r.spo2),
        trimmed.map((r) => r.temperature)
      );

      const last = readings.slice(-SPARK_POINTS);
      updateSparkline(state.charts.hrSpark, last.map((r) => r.heart_rate));
      updateSparkline(state.charts.spo2Spark, last.map((r) => r.spo2));
      updateSparkline(state.charts.tempSpark, last.map((r) => r.temperature));
    }
  } catch (err) {
    console.error(err);
    showToast(err.message, "error");
  }
}

// events

function bindEvents() {
  document.getElementById("logoutBtn").addEventListener("click", (e) => {
    e.preventDefault();
    clearSession();
    window.location.href = "index.html";
  });

  document.getElementById("trendRange").addEventListener("change", () => refreshAll(true));

  document.getElementById("deviceToggleBtn").addEventListener("click", () => {
    if (!state.patientId) return;
    state.manualDisconnect[state.patientId] = !state.manualDisconnect[state.patientId];
    refreshAll();
    showToast(
      state.manualDisconnect[state.patientId]
        ? "Device paused for this session (view only, no hardware change)."
        : "Device reconnected.",
      "success"
    );
  });
}

// init

(async function init() {
  paintIcons();
  paintUser();
  startClock();
  initCharts();
  bindEvents();

  try {
    await loadPatients();
    await refreshAll(true);
  } catch (err) {
    showToast(err.message, "error");
  }

  state.pollTimer = setInterval(() => refreshAll(false), POLL_MS);
})();