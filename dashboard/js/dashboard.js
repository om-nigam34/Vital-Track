(function () {
  if (!requireAuth()) return;

  const POLL_MS = 3000;          // how often the page asks the server for new data
  const SPARK_POINTS = 20;       // points shown in the small charts
  const STALE_AFTER_MS = 15000;  // no new reading for this long = "waiting for data"

  const state = {
    patients: [],
    patientId: null,
    thresholds: {
      heart_rate: { low: 60, high: 100, unit: "BPM" },
      spo2: { low: 95, high: 100, unit: "%" },
      temperature: { low: 36.1, high: 37.2, unit: "\u00b0C" },
    },
    charts: {},
    ecg: null,
    timer: null,
    busy: false,
    again: false,
    paused: false,
    offline: false,
    lastReading: null,
    hasDevice: false,
  };

  const $ = (id) => document.getElementById(id);

  /* ------------------------------ small helpers ------------------------------ */

  function statusFor(type, value) {
    if (value === null || value === undefined) return { label: "--", cls: "normal" };
    const t = state.thresholds[type];
    if (value < t.low) return { label: "Low", cls: "low" };
    if (value > t.high) return { label: "High", cls: "high" };
    return { label: "Normal", cls: "normal" };
  }

  function initialsFor(name) {
    if (!name) return "--";
    return name.split(" ").filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join("");
  }

  function alertIconFor(type) {
    return { heart_rate: "heart", spo2: "droplet", temperature: "thermometer" }[type] || "chip";
  }

  function alertColorFor(severity) {
    return { critical: "red", warning: "amber" }[severity] || "blue";
  }

  function wifiLabelFor(pct) {
    if (pct >= 80) return "Strong";
    if (pct >= 50) return "Good";
    if (pct >= 25) return "Weak";
    return "Poor";
  }

  function rangeText(type) {
    const t = state.thresholds[type];
    return `Normal: ${t.low} - ${t.high} ${t.unit}`;
  }

  /* ------------------------------ one-time setup ------------------------------ */

  function paintStaticIcons() {
    $("bannerIcon").innerHTML = icon("alertTriangle");
    $("iconHr").innerHTML = icon("heart");
    $("iconSpo2").innerHTML = icon("droplet");
    $("iconTemp").innerHTML = icon("thermometer");
    $("iconEcg").innerHTML = icon("activity");
    $("iconEcgTitle").innerHTML = icon("activity");
    $("iconTrendTitle").innerHTML = icon("trending");
    $("pauseIcon").innerHTML = icon("pause");
  }

  function paintSidebarCard() {
    $("sidebarExtra").innerHTML = `
      <div class="patient-card">
        <div class="avatar" id="patientAvatar">--</div>
        <div class="who">
          <div class="name" id="patientCardName">Loading...</div>
          <div class="meta" id="patientCardMeta">-</div>
        </div>
      </div>
      <div class="conn-dot-row">
        <span class="dot" id="patientConnDot"></span>
        <span id="patientConnLabel">Checking device...</span>
      </div>`;
  }

  function applyThresholdLabels() {
    $("hrRange").textContent = rangeText("heart_rate");
    $("spo2Range").textContent = rangeText("spo2");
    $("tempRange").textContent = rangeText("temperature");
  }

  async function loadThresholds() {
    try {
      const meta = await api("/api/meta", { auth: false });
      if (meta.thresholds) state.thresholds = meta.thresholds;
    } catch { /* keep the built-in defaults */ }
    applyThresholdLabels();
  }

  function initCharts() {
    // Chart.js comes from dashboard/js/vendor (no internet needed). If it is missing for any
    // reason, skip the charts and keep the rest of the page working.
    if (typeof Chart === "undefined") {
      console.warn("Chart.js did not load - the small charts and the trend chart are skipped.");
    } else {
      try {
        const empty = () => Array(SPARK_POINTS).fill(null);
        state.charts.hr = makeSparkline($("hrSpark"), empty(), "#f0546a");
        state.charts.spo2 = makeSparkline($("spo2Spark"), empty(), "#2e9bff");
        state.charts.temp = makeSparkline($("tempSpark"), empty(), "#34d399");
        state.charts.trend = makeTrendChart($("trendCanvas"), [], [], [], []);
      } catch (err) {
        console.warn("Chart setup failed, continuing without charts:", err);
      }
    }
    try {
      state.ecg = new ECGMonitor($("ecgCanvas"), { color: "#34d399" });
      state.ecg.start();
    } catch (err) {
      console.warn("ECG canvas setup failed:", err);
    }
  }

  /* ------------------------------ patients ------------------------------ */

  /** First visit: open the patient who actually has live data, not just the newest one added. */
  function pickDefaultPatient(patients) {
    const active = patients.filter((p) => p.status === "active");
    const best =
      active.find((p) => p.device && p.device.connected) ||
      active.find((p) => p.latest_reading) ||
      active[0] ||
      patients.find((p) => p.latest_reading) ||
      patients[0];
    return best ? best.id : null;
  }

  async function loadPatients() {
    const data = await api("/api/patients?include_latest=1");
    state.patients = data.patients;

    const select = $("patientSelect");
    select.innerHTML = state.patients
      .map((p) => `<option value="${p.id}">${esc(p.name)} (${esc(p.patient_code)})${p.status === "discharged" ? " - discharged" : ""}</option>`)
      .join("");

    const stored = getSelectedPatientId();
    const remembered = stored && state.patients.some((p) => p.id === stored);
    state.patientId = remembered ? stored : pickDefaultPatient(state.patients);

    const hasPatients = state.patients.length > 0;
    $("noPatients").classList.toggle("hidden", hasPatients);
    $("dashboardBody").classList.toggle("hidden", !hasPatients);
    select.classList.toggle("hidden", !hasPatients);

    if (state.patientId) {
      select.value = String(state.patientId);
      setSelectedPatientId(state.patientId);
    }
  }

  function resetForPatientChange() {
    state.lastReading = null;
    renderStatCards(null);
    renderLatestReadings(null);
    for (const key of ["hr", "spo2", "temp"]) {
      if (state.charts[key]) updateSparkline(state.charts[key], Array(SPARK_POINTS).fill(null));
    }
    if (state.charts.trend) updateTrendChart(state.charts.trend, [], [], [], []);
  }

  /* ------------------------------ rendering ------------------------------ */

  function renderSidebarPatientCard(patient) {
    $("patientAvatar").textContent = initialsFor(patient?.name);
    $("patientCardName").textContent = patient?.name || "No patient";
    $("patientCardMeta").textContent = patient
      ? `${patient.patient_code} \u00b7 ${patient.gender || "-"}, ${patient.age ?? "-"} Yrs`
      : "Add a patient to get started";

    const connected = !!patient?.device?.connected;
    $("patientConnDot").className = `dot ${connected ? "online" : "offline"}`;
    $("patientConnLabel").textContent = patient?.device
      ? (connected ? "Device Connected" : "Device Disconnected")
      : "No device assigned";
  }

  function renderStatCards(reading) {
    const hr = reading?.heart_rate ?? null;
    const spo2 = reading?.spo2 ?? null;
    const temp = reading?.temperature ?? null;

    $("hrValue").textContent = hr != null ? Math.round(hr) : "--";
    $("spo2Value").textContent = spo2 != null ? Math.round(spo2) : "--";
    $("tempValue").textContent = temp != null ? temp.toFixed(1) : "--";

    const ecg = reading?.ecg_status || null;
    const ecgEl = $("ecgValue");
    ecgEl.textContent = ecg || "--";
    ecgEl.style.color = ecg === "Irregular" ? "var(--red)" : "var(--purple)";
    $("ecgSub").textContent = !ecg ? "Waiting for data"
      : ecg === "Irregular" ? "Heart rate outside normal range" : "Sinus Rhythm";

    if (hr != null && state.ecg) state.ecg.setHeartRate(hr);
  }

  function renderLatestReadings(reading) {
    const el = $("latestReadingsList");
    if (!reading) {
      el.innerHTML = `<div class="empty-state">No readings yet. Start <code>firmware/esp32_simulator.py</code> (or switch on the ESP32) to see live data.</div>`;
      $("lastUpdated").textContent = "Last updated: --";
      return;
    }

    const rows = [
      { key: "heart_rate", label: "Heart Rate", value: reading.heart_rate, unit: "BPM", ic: "heart", color: "red" },
      { key: "spo2", label: "SpO2", value: reading.spo2, unit: "%", ic: "droplet", color: "blue" },
      { key: "temperature", label: "Temperature", value: reading.temperature, unit: "\u00b0C", ic: "thermometer", color: "green" },
    ];

    let html = rows.map((r) => {
      const st = statusFor(r.key, r.value);
      const shown = r.value == null ? "--" : r.key === "temperature" ? r.value.toFixed(1) : Math.round(r.value);
      return `<div class="reading-row">
        <div class="row-icon" style="background:var(--${r.color}-soft);color:var(--${r.color})">${icon(r.ic)}</div>
        <div class="label">${r.label}</div>
        <div class="value-col"><span class="value">${shown} ${r.unit}</span><span class="badge ${st.cls}">${st.label}</span></div>
      </div>`;
    }).join("");

    const ecgOk = reading.ecg_status !== "Irregular";
    html += `<div class="reading-row">
      <div class="row-icon" style="background:var(--purple-soft);color:var(--purple)">${icon("activity")}</div>
      <div class="label">ECG Status</div>
      <div class="value-col"><span class="value">${esc(reading.ecg_status)}</span><span class="badge ${ecgOk ? "normal" : "critical"}">${ecgOk ? "Normal" : "Alert"}</span></div>
    </div>`;

    el.innerHTML = html;
    $("lastUpdated").textContent = "Last updated: " + formatDateTime(reading.recorded_at);
  }

  function renderAlertsPanel(alerts) {
    const el = $("recentAlertsList");
    if (!alerts.length) {
      el.innerHTML = `<div class="empty-state">No alerts for this patient yet.</div>`;
    } else {
      el.innerHTML = alerts.slice(0, 6).map((a) => {
        const color = alertColorFor(a.severity);
        return `<div class="alert-row${a.is_read ? " is-read" : ""}">
          <div class="row-icon" style="background:var(--${color}-soft);color:var(--${color})">${icon(alertIconFor(a.vital_type))}</div>
          <div class="txt"><div class="t">${esc(a.title)}</div><div class="m">${esc(a.message)}</div></div>
          <div class="time">${formatClockTime(a.created_at)}</div>
        </div>`;
      }).join("");
    }

    const unread = alerts.filter((a) => !a.is_read);
    const banner = $("alertBanner");
    if (unread.length) {
      const extra = unread.length > 1 ? ` (+${unread.length - 1} more)` : "";
      $("bannerText").textContent = unread[0].message + extra;
      banner.classList.remove("hidden");
    } else {
      banner.classList.add("hidden");
    }
  }

  function renderDevice(patient) {
    const el = $("deviceInfoList");
    const device = patient?.device;
    state.hasDevice = !!device;

    if (!device) {
      el.innerHTML = `<div class="empty-state">No device assigned to this patient yet. Assign one on the Patients page.</div>`;
      return;
    }

    const connected = device.connected;
    el.innerHTML = `
      <div class="device-row"><span class="label">Device Status</span>
        <span class="value-col"><span class="dot ${connected ? "online" : "offline"}"></span>${connected ? "Connected" : "Disconnected"}</span></div>
      <div class="device-row"><span class="label">Wi-Fi Signal</span>
        <span class="value-col">${icon("wifi")}${wifiLabelFor(device.wifi_signal)} (${device.wifi_signal}%)</span></div>
      <div class="device-row"><span class="label">Battery Level</span>
        <span class="value-col">${icon("battery")}${device.battery_level}%</span></div>
      <div class="device-row"><span class="label">Firmware Version</span>
        <span class="value-col">${esc(device.firmware_version)}</span></div>
      <div class="device-row"><span class="label">Last Seen</span>
        <span class="value-col">${device.last_seen ? timeAgo(device.last_seen) : "never"}</span></div>`;
  }

  function renderCharts(readings) {
    if (!state.charts.trend) return;
    const labels = readings.map((r) => formatClockTime(r.recorded_at));
    updateTrendChart(
      state.charts.trend, labels,
      readings.map((r) => r.heart_rate),
      readings.map((r) => r.spo2),
      readings.map((r) => r.temperature)
    );
    const last = readings.slice(-SPARK_POINTS);
    updateSparkline(state.charts.hr, last.map((r) => r.heart_rate));
    updateSparkline(state.charts.spo2, last.map((r) => r.spo2));
    updateSparkline(state.charts.temp, last.map((r) => r.temperature));
  }

  /** The green "Live" light: tells you whether data is really arriving. */
  function updateLiveChip() {
    const chip = $("liveChip");
    const text = $("liveText");
    let mode = "stale";
    let label = "Waiting for data";

    if (state.paused) {
      mode = "paused";
      label = "Paused";
    } else if (state.offline) {
      mode = "offline";
      label = "Server not reachable";
    } else if (state.lastReading) {
      const age = Date.now() - new Date(state.lastReading.recorded_at).getTime();
      if (age <= STALE_AFTER_MS) {
        mode = "live";
        label = "Live";
      } else {
        label = `No new data for ${timeAgo(state.lastReading.recorded_at).replace(" ago", "")}`;
      }
    } else if (!state.hasDevice) {
      label = "No device assigned";
    }
    chip.className = `live-chip ${mode}`;
    text.textContent = label;
  }

  /* ------------------------------ data refresh ------------------------------ */

  async function refresh() {
    if (!state.patientId) return;
    if (state.busy) { state.again = true; return; }
    state.busy = true;
    const requestedId = state.patientId;

    try {
      const minutes = parseInt($("trendRange").value, 10);
      const [{ patient }, alertsData, history] = await Promise.all([
        api(`/api/patients/${requestedId}`),
        api(`/api/alerts?patient_id=${requestedId}&limit=8`),
        api(`/api/vitals/history?patient_id=${requestedId}&minutes=${minutes}`),
      ]);

      if (requestedId !== state.patientId) return; // patient was switched while loading

      state.lastReading = patient.latest_reading;
      renderSidebarPatientCard(patient);
      renderDevice(patient);
      renderStatCards(patient.latest_reading);
      renderLatestReadings(patient.latest_reading);
      renderAlertsPanel(alertsData.alerts);
      Chrome.setAlertBadge(alertsData.unread_count);
      renderCharts(history.readings);

      if (state.offline) {
        state.offline = false;
        showToast("Back online");
      }
    } catch (err) {
      if (err.status === 401) return;  // api.js is already sending you to the login page
      console.error(err);
      if (!state.offline) {
        state.offline = true;
        showToast(err.message, "error");   // shown once, not on every retry
      }
    } finally {
      state.busy = false;
      updateLiveChip();
      if (state.again) {
        state.again = false;
        refresh();
      }
    }
  }

  function scheduleNext() {
    clearTimeout(state.timer);
    if (state.paused) return;
    state.timer = setTimeout(async () => {
      if (!document.hidden) await refresh();   // do not poll while the tab is in the background
      scheduleNext();
    }, POLL_MS);
  }

  function setPaused(paused) {
    state.paused = paused;
    $("pauseIcon").innerHTML = icon(paused ? "play" : "pause");
    $("pauseLabel").textContent = paused ? "Resume Live View" : "Pause Live View";
    if (state.ecg) (paused ? state.ecg.stop() : state.ecg.start());
    if (paused) {
      clearTimeout(state.timer);
    } else {
      refresh().then(scheduleNext);
    }
    updateLiveChip();
  }

  /* ------------------------------ events ------------------------------ */

  function bindEvents() {
    $("patientSelect").addEventListener("change", () => {
      state.patientId = parseInt($("patientSelect").value, 10);
      setSelectedPatientId(state.patientId);
      resetForPatientChange();
      refresh();
    });

    $("trendRange").addEventListener("change", () => refresh());

    $("pauseBtn").addEventListener("click", () => setPaused(!state.paused));

    $("bannerDismiss").addEventListener("click", async () => {
      try {
        await api(`/api/alerts/read-all?patient_id=${state.patientId}`, { method: "POST" });
        await refresh();
      } catch (err) {
        showToast(err.message, "error");
      }
    });

    // Coming back to the tab: update straight away instead of waiting for the next tick
    document.addEventListener("visibilitychange", () => {
      if (!document.hidden && !state.paused) refresh();
    });

    setInterval(updateLiveChip, 1000);
  }

  /* ------------------------------ start ------------------------------ */

  async function init() {
    Chrome.init({ page: "dashboard" });
    paintSidebarCard();
    paintStaticIcons();
    initCharts();
    bindEvents();

    await loadThresholds();
    try {
      await loadPatients();
      if (state.patientId) await refresh();
    } catch (err) {
      if (err.status !== 401) showToast(err.message, "error");
    }
    updateLiveChip();
    scheduleNext();
  }

  init();
})();