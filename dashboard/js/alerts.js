requireAuth();

const state = { patients: [], alerts: [], unreadOnly: false, patientId: "" };

/* chrome */

function paintIcons() {
  document.getElementById("brandMark").innerHTML = icon("logo");
  const navOrder = ["grid", "pulse", "history", "report", "bell", "users", "settings", "user"];
  document.querySelectorAll(".nav-link > span:first-child").forEach((span, i) => {
    span.innerHTML = icon(navOrder[i] || "grid");
  });
  document.querySelector(".logout-link > span:first-child").innerHTML = icon("logout");
  document.getElementById("iconCalendar").innerHTML = icon("calendar");
  document.getElementById("iconClock").innerHTML = icon("clock");
  document.querySelector(".hamburger").innerHTML = icon("menu");
  document.getElementById("iconCheck").innerHTML = icon("check");
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

/* data */

async function loadPatientFilter() {
  const data = await api("/api/patients");
  state.patients = data.patients;
  const select = document.getElementById("patientFilter");
  select.innerHTML =
    `<option value="">All Patients</option>` +
    state.patients.map((p) => `<option value="${p.id}">${p.name} (${p.patient_code})</option>`).join("");
  select.addEventListener("change", () => {
    state.patientId = select.value;
    loadAlerts();
  });
}

function patientNameFor(id) {
  const p = state.patients.find((p) => p.id === id);
  return p ? `${p.name} (${p.patient_code})` : `Patient #${id}`;
}

async function loadAlerts() {
  const params = new URLSearchParams({ limit: "100" });
  if (state.patientId) params.set("patient_id", state.patientId);
  if (state.unreadOnly) params.set("unread_only", "1");

  const data = await api(`/api/alerts?${params.toString()}`);
  state.alerts = data.alerts;
  renderAlerts();
  updateBadge(data.unread_count);
}

function updateBadge(count) {
  const badge = document.getElementById("sidebarAlertBadge");
  if (count > 0) {
    badge.textContent = count > 99 ? "99+" : String(count);
    badge.classList.remove("hidden");
  } else {
    badge.classList.add("hidden");
  }
}

/* render */

function alertIconFor(type) {
  return { heart_rate: "heart", spo2: "droplet", temperature: "thermometer" }[type] || "chip";
}
function alertColorFor(sev) {
  return { critical: "red", warning: "amber" }[sev] || "blue";
}

function renderAlerts() {
  const list = document.getElementById("alertsList");
  const empty = document.getElementById("alertsEmpty");

  if (!state.alerts.length) {
    list.innerHTML = "";
    empty.classList.remove("hidden");
    return;
  }
  empty.classList.add("hidden");

  list.innerHTML = state.alerts
    .map((a) => {
      const color = alertColorFor(a.severity);
      return `<div class="alert-row" style="align-items:flex-start;">
        <div class="row-icon" style="background:var(--${color}-soft);color:var(--${color});margin-top:2px;">${icon(alertIconFor(a.vital_type))}</div>
        <div class="txt">
          <div class="t">${a.title} <span style="color:var(--text-muted);font-weight:500;">&middot; ${patientNameFor(a.patient_id)}</span></div>
          <div class="m">${a.message}</div>
        </div>
        <div style="margin-left:auto;display:flex;align-items:center;gap:10px;">
          <span class="badge ${a.severity === "critical" ? "critical" : "warning"}">${a.severity}</span>
          ${a.is_read ? "" : `<button class="icon-btn" data-id="${a.id}" title="Mark as read">${icon("check")}</button>`}
          <span class="time">${formatClockTime(a.created_at)}</span>
        </div>
      </div>`;
    })
    .join("");

  list.querySelectorAll("[data-id]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      try {
        await api(`/api/alerts/${btn.dataset.id}/read`, { method: "POST" });
        await loadAlerts();
      } catch (err) {
        showToast(err.message, "error");
      }
    });
  });
}

/* filters / actions */

document.querySelectorAll(".filter-tab").forEach((tab) => {
  tab.addEventListener("click", () => {
    document.querySelectorAll(".filter-tab").forEach((t) => t.classList.remove("active"));
    tab.classList.add("active");
    state.unreadOnly = tab.dataset.filter === "unread";
    loadAlerts().catch((err) => showToast(err.message, "error"));
  });
});

document.getElementById("markAllReadBtn").addEventListener("click", async () => {
  try {
    const params = state.patientId ? `?patient_id=${state.patientId}` : "";
    await api(`/api/alerts/read-all${params}`, { method: "POST" });
    showToast("All alerts marked as read");
    await loadAlerts();
  } catch (err) {
    showToast(err.message, "error");
  }
});

document.getElementById("logoutBtn").addEventListener("click", (e) => {
  e.preventDefault();
  clearSession();
  window.location.href = "index.html";
});

/* init */

(async function init() {
  paintIcons();
  paintUser();
  startClock();
  try {
    await loadPatientFilter();
    await loadAlerts();
  } catch (err) {
    showToast(err.message, "error");
  }
})();