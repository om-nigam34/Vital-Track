(function () {
  if (!requireAuth()) return;

  const LIMIT = 100;
  const REFRESH_MS = 10000;

  const state = { patients: [], alerts: [], unreadOnly: false, patientId: "" };
  const $ = (id) => document.getElementById(id);

  async function loadPatientFilter() {
    const data = await api("/api/patients");
    state.patients = data.patients;
    $("patientFilter").innerHTML =
      `<option value="">All Patients</option>` +
      state.patients.map((p) => `<option value="${p.id}">${esc(p.name)} (${esc(p.patient_code)})</option>`).join("");
  }

  function patientNameFor(id) {
    const p = state.patients.find((p) => p.id === id);
    return p ? `${p.name} (${p.patient_code})` : `Patient #${id}`;
  }

  async function loadAlerts() {
    const params = new URLSearchParams({ limit: String(LIMIT) });
    if (state.patientId) params.set("patient_id", state.patientId);
    if (state.unreadOnly) params.set("unread_only", "1");

    const data = await api(`/api/alerts?${params.toString()}`);
    state.alerts = data.alerts;
    renderAlerts();
    Chrome.setAlertBadge(data.unread_count);
  }

  function alertIconFor(type) {
    return { heart_rate: "heart", spo2: "droplet", temperature: "thermometer" }[type] || "chip";
  }

  function alertColorFor(severity) {
    return { critical: "red", warning: "amber" }[severity] || "blue";
  }

  function renderAlerts() {
    const list = $("alertsList");
    const empty = $("alertsEmpty");
    const note = $("alertsNote");

    if (!state.alerts.length) {
      list.innerHTML = "";
      empty.textContent = state.unreadOnly ? "No unread alerts. You are all caught up." : "No alerts to show.";
      empty.classList.remove("hidden");
      note.classList.add("hidden");
      return;
    }
    empty.classList.add("hidden");

    list.innerHTML = state.alerts.map((a) => {
      const color = alertColorFor(a.severity);
      return `<div class="alert-row${a.is_read ? " is-read" : ""}" style="align-items:flex-start;">
        <div class="row-icon" style="background:var(--${color}-soft);color:var(--${color});margin-top:2px;">${icon(alertIconFor(a.vital_type))}</div>
        <div class="txt">
          <div class="t">${esc(a.title)} <span class="alert-patient">&middot; ${esc(patientNameFor(a.patient_id))}</span></div>
          <div class="m">${esc(a.message)}</div>
        </div>
        <div class="alert-meta">
          <span class="badge ${a.severity === "critical" ? "critical" : "warning"}">${esc(a.severity)}</span>
          ${a.is_read ? "" : `<button type="button" class="icon-btn" data-id="${a.id}" title="Mark as read" aria-label="Mark as read">${icon("check")}</button>`}
          <span class="time" title="${esc(formatDateTime(a.created_at))}">${esc(timeAgo(a.created_at))}</span>
        </div>
      </div>`;
    }).join("");

    if (state.alerts.length >= LIMIT) {
      note.textContent = `Showing the latest ${LIMIT} alerts.`;
      note.classList.remove("hidden");
    } else {
      note.classList.add("hidden");
    }
  }

  $("alertsList").addEventListener("click", async (e) => {
    const btn = e.target.closest("[data-id]");
    if (!btn) return;
    btn.disabled = true;
    try {
      await api(`/api/alerts/${btn.dataset.id}/read`, { method: "POST" });
      await loadAlerts();
    } catch (err) {
      btn.disabled = false;
      showToast(err.message, "error");
    }
  });

  $("filterTabs").addEventListener("click", (e) => {
    const tab = e.target.closest(".filter-tab");
    if (!tab) return;
    document.querySelectorAll(".filter-tab").forEach((t) => {
      t.classList.toggle("active", t === tab);
      t.setAttribute("aria-selected", t === tab ? "true" : "false");
    });
    state.unreadOnly = tab.dataset.filter === "unread";
    loadAlerts().catch((err) => showToast(err.message, "error"));
  });

  $("patientFilter").addEventListener("change", () => {
    state.patientId = $("patientFilter").value;
    loadAlerts().catch((err) => showToast(err.message, "error"));
  });

  $("markAllReadBtn").addEventListener("click", async () => {
    try {
      const params = state.patientId ? `?patient_id=${encodeURIComponent(state.patientId)}` : "";
      await api(`/api/alerts/read-all${params}`, { method: "POST" });
      showToast("All alerts marked as read");
      await loadAlerts();
    } catch (err) {
      showToast(err.message, "error");
    }
  });

  async function init() {
    Chrome.init({ page: "alerts" });
    $("iconCheck").innerHTML = icon("check");
    try {
      await loadPatientFilter();
      await loadAlerts();
    } catch (err) {
      if (err.status !== 401) showToast(err.message, "error");
    }

    // New alerts arrive while the page is open, so refresh the list quietly
    setInterval(() => {
      if (!document.hidden) loadAlerts().catch(() => {});
    }, REFRESH_MS);
  }

  init();
})();