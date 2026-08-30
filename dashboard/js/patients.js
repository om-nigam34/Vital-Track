requireAuth();

const state = { patients: [], devices: [], statusFilter: "", deleteTargetId: null };

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
  document.getElementById("iconPlus").innerHTML = icon("plus");
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

async function refreshAlertBadge() {
  try {
    const data = await api("/api/alerts?limit=1");
    const badge = document.getElementById("sidebarAlertBadge");
    if (data.unread_count > 0) {
      badge.textContent = data.unread_count > 99 ? "99+" : String(data.unread_count);
      badge.classList.remove("hidden");
    } else {
      badge.classList.add("hidden");
    }
  } catch { /* non-critical */ }
}

function initialsFor(name) {
  if (!name) return "--";
  return name.split(" ").filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join("");
}

/* data */

async function loadPatients() {
  const qs = state.statusFilter ? `?status=${state.statusFilter}&include_latest=1` : "?include_latest=1";
  const data = await api(`/api/patients${qs}`);
  state.patients = data.patients;
  renderTable();
}

async function loadDevices() {
  const data = await api("/api/devices");
  state.devices = data.devices;
}

/* table */

function renderTable() {
  const body = document.getElementById("patientsTableBody");
  const empty = document.getElementById("patientsEmpty");

  if (!state.patients.length) {
    body.innerHTML = "";
    empty.classList.remove("hidden");
    return;
  }
  empty.classList.add("hidden");

  body.innerHTML = state.patients
    .map((p) => {
      const device = p.device;
      const connDot = device ? `<span class="dot ${device.connected ? "online" : "offline"}"></span>` : "";
      const deviceLabel = device ? device.device_uid : "Not assigned";
      return `
      <tr>
        <td>
          <div style="display:flex;align-items:center;gap:10px;">
            <div class="avatar">${initialsFor(p.name)}</div>
            <div>
              <div style="font-weight:600;">${p.name}</div>
              <div style="color:var(--text-muted);font-size:12px;">${p.patient_code}</div>
            </div>
          </div>
        </td>
        <td>${p.age ?? "--"} / ${p.gender || "--"}</td>
        <td>${p.ward || "--"}</td>
        <td><span class="badge ${p.status === "active" ? "normal" : "warning"}">${p.status}</span></td>
        <td>${connDot}${deviceLabel}</td>
        <td style="text-align:right;">
          <button class="icon-btn" data-action="device" data-id="${p.id}" title="Manage device">${icon("chip")}</button>
          <button class="icon-btn" data-action="edit" data-id="${p.id}" title="Edit patient">${icon("edit")}</button>
          <button class="icon-btn danger" data-action="delete" data-id="${p.id}" title="Delete patient">${icon("trash")}</button>
        </td>
      </tr>`;
    })
    .join("");

  body.querySelectorAll("[data-action]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = parseInt(btn.dataset.id, 10);
      const action = btn.dataset.action;
      if (action === "edit") openPatientModal(id);
      if (action === "delete") openDeleteModal(id);
      if (action === "device") openDeviceModal(id);
    });
  });
}

document.querySelectorAll(".filter-tab").forEach((tab) => {
  tab.addEventListener("click", () => {
    document.querySelectorAll(".filter-tab").forEach((t) => t.classList.remove("active"));
    tab.classList.add("active");
    state.statusFilter = tab.dataset.status;
    loadPatients().catch((err) => showToast(err.message, "error"));
  });
});

/* add / edit modal */

const patientModal = document.getElementById("patientModalBackdrop");

function openPatientModal(id = null) {
  const patient = id ? state.patients.find((p) => p.id === id) : null;
  document.getElementById("patientModalTitle").textContent = patient ? "Edit Patient" : "Add Patient";
  document.getElementById("patientId").value = patient ? patient.id : "";
  document.getElementById("pName").value = patient?.name || "";
  document.getElementById("pAge").value = patient?.age ?? "";
  document.getElementById("pGender").value = patient?.gender || "Male";
  document.getElementById("pWard").value = patient?.ward || "";
  document.getElementById("pStatus").value = patient?.status || "active";
  patientModal.classList.remove("hidden");
}

function closePatientModal() {
  patientModal.classList.add("hidden");
  document.getElementById("patientForm").reset();
}

document.getElementById("addPatientBtn").addEventListener("click", () => openPatientModal());
document.getElementById("patientCancelBtn").addEventListener("click", closePatientModal);
patientModal.addEventListener("click", (e) => { if (e.target === patientModal) closePatientModal(); });

document.getElementById("patientForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const id = document.getElementById("patientId").value;
  const payload = {
    name: document.getElementById("pName").value.trim(),
    age: document.getElementById("pAge").value ? parseInt(document.getElementById("pAge").value, 10) : null,
    gender: document.getElementById("pGender").value,
    ward: document.getElementById("pWard").value.trim(),
    status: document.getElementById("pStatus").value,
  };

  const btn = document.getElementById("patientSaveBtn");
  btn.disabled = true;
  try {
    if (id) {
      await api(`/api/patients/${id}`, { method: "PUT", body: payload });
      showToast("Patient updated");
    } else {
      await api("/api/patients", { method: "POST", body: payload });
      showToast("Patient added");
    }
    closePatientModal();
    await loadPatients();
  } catch (err) {
    showToast(err.message, "error");
  } finally {
    btn.disabled = false;
  }
});

/* delete modal */

const deleteModal = document.getElementById("deleteModalBackdrop");

function openDeleteModal(id) {
  state.deleteTargetId = id;
  deleteModal.classList.remove("hidden");
}
function closeDeleteModal() {
  deleteModal.classList.add("hidden");
  state.deleteTargetId = null;
}

document.getElementById("deleteCancelBtn").addEventListener("click", closeDeleteModal);
deleteModal.addEventListener("click", (e) => { if (e.target === deleteModal) closeDeleteModal(); });

document.getElementById("deleteConfirmBtn").addEventListener("click", async () => {
  if (!state.deleteTargetId) return;
  try {
    await api(`/api/patients/${state.deleteTargetId}`, { method: "DELETE" });
    showToast("Patient deleted");
    closeDeleteModal();
    await loadPatients();
  } catch (err) {
    showToast(err.message, "error");
  }
});

/* device modal */

const deviceModal = document.getElementById("deviceModalBackdrop");

async function openDeviceModal(patientId) {
  await loadDevices();
  const patient = state.patients.find((p) => p.id === patientId);
  const assigned = state.devices.find((d) => d.patient_id === patientId);
  const unassigned = state.devices.filter((d) => !d.patient_id);
  const body = document.getElementById("deviceModalBody");

  if (assigned) {
    body.innerHTML = `
      <p style="font-size:13.5px;color:var(--text-secondary);">
        <strong style="color:var(--text-primary);">${assigned.device_uid}</strong> is assigned to ${patient.name}.
      </p>
      <div class="device-row"><span class="label">Status</span><span class="value-col"><span class="dot ${assigned.connected ? "online" : "offline"}"></span>${assigned.connected ? "Connected" : "Disconnected"}</span></div>
      <div class="device-row"><span class="label">Firmware</span><span class="value-col">${assigned.firmware_version}</span></div>
      <p style="font-size:12px;color:var(--text-muted);margin-top:12px;">The device's API key was shown once when it was registered - check firmware/device_key.txt if this is the seeded demo device.</p>
      <button class="btn btn-outline" id="unassignBtn" style="margin-top:6px;">Unassign this device</button>
    `;
    document.getElementById("unassignBtn").addEventListener("click", async () => {
      try {
        await api(`/api/devices/${assigned.id}/assign`, { method: "PUT", body: { patient_id: null } });
        showToast("Device unassigned");
        await loadPatients();
        openDeviceModal(patientId);
      } catch (err) {
        showToast(err.message, "error");
      }
    });
  } else {
    body.innerHTML = `
      ${unassigned.length ? `
        <div class="form-row">
          <label for="existingDeviceSelect">Assign an existing device</label>
          <select id="existingDeviceSelect">
            ${unassigned.map((d) => `<option value="${d.id}">${d.device_uid}</option>`).join("")}
          </select>
        </div>
        <button class="btn" id="assignExistingBtn">Assign Selected Device</button>
        <p style="text-align:center;color:var(--text-muted);font-size:12px;margin:14px 0;">or register a new one</p>
      ` : `<p style="font-size:13px;color:var(--text-secondary);">No unassigned devices yet - register a new ESP32 below.</p>`}
      <div class="form-row">
        <label for="newDeviceUid">New device ID</label>
        <input type="text" id="newDeviceUid" placeholder="e.g. ESP32-WARD3-02" />
      </div>
      <button class="btn" id="registerDeviceBtn">Register &amp; Assign</button>
      <div id="newKeyBox" class="hidden" style="margin-top:14px;background:var(--bg-card-soft);border:1px solid var(--border);border-radius:var(--radius-sm);padding:12px;font-size:12.5px;word-break:break-all;"></div>
    `;

    document.getElementById("assignExistingBtn")?.addEventListener("click", async () => {
      const deviceId = document.getElementById("existingDeviceSelect").value;
      try {
        await api(`/api/devices/${deviceId}/assign`, { method: "PUT", body: { patient_id: patientId } });
        showToast("Device assigned");
        await loadPatients();
        closeDeviceModal();
      } catch (err) {
        showToast(err.message, "error");
      }
    });

    document.getElementById("registerDeviceBtn").addEventListener("click", async () => {
      const uid = document.getElementById("newDeviceUid").value.trim();
      if (!uid) { showToast("Enter a device ID first", "error"); return; }
      try {
        const data = await api("/api/devices", { method: "POST", body: { device_uid: uid, patient_id: patientId } });
        const box = document.getElementById("newKeyBox");
        box.classList.remove("hidden");
        box.innerHTML = `<strong>Save this API key now</strong> - it won't be shown again.<br/>Paste it into <code>firmware/esp32_simulator.py --key</code> or the firmware sketch:<br/><br/><span style="color:var(--green);">${data.api_key}</span>`;
        showToast("Device registered and assigned");
        await loadPatients();
      } catch (err) {
        showToast(err.message, "error");
      }
    });
  }

  deviceModal.classList.remove("hidden");
}

function closeDeviceModal() {
  deviceModal.classList.add("hidden");
}
document.getElementById("deviceCancelBtn").addEventListener("click", closeDeviceModal);
deviceModal.addEventListener("click", (e) => { if (e.target === deviceModal) closeDeviceModal(); });

/* logout */

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
  refreshAlertBadge();
  try {
    await loadPatients();
  } catch (err) {
    showToast(err.message, "error");
  }
})();