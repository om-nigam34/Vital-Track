(function () {
  if (!requireAuth()) return;

  const state = { patients: [], devices: [], statusFilter: "", deleteTargetId: null };
  const $ = (id) => document.getElementById(id);

  function initialsFor(name) {
    if (!name) return "--";
    return name.split(" ").filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join("");
  }

  function setFormError(message) {
    const el = $("patientFormError");
    el.textContent = message || "";
    el.classList.toggle("hidden", !message);
  }

  /* ------------------------------ data ------------------------------ */

  async function loadPatients() {
    const qs = state.statusFilter ? `?status=${encodeURIComponent(state.statusFilter)}&include_latest=1` : "?include_latest=1";
    const data = await api(`/api/patients${qs}`);
    state.patients = data.patients;
    renderTable();
  }

  async function loadDevices() {
    const data = await api("/api/devices");
    state.devices = data.devices;
  }

  /* ------------------------------ table ------------------------------ */

  function renderTable() {
    const body = $("patientsTableBody");
    const empty = $("patientsEmpty");

    if (!state.patients.length) {
      body.innerHTML = "";
      empty.textContent = state.statusFilter
        ? `No ${state.statusFilter} patients.`
        : "No patients yet. Add your first patient to get started.";
      empty.classList.remove("hidden");
      return;
    }
    empty.classList.add("hidden");

    body.innerHTML = state.patients.map((p) => {
      const device = p.device;
      const connDot = device ? `<span class="dot ${device.connected ? "online" : "offline"}"></span>` : "";
      const deviceLabel = device ? esc(device.device_uid) : "Not assigned";
      return `
      <tr>
        <td>
          <div style="display:flex;align-items:center;gap:10px;">
            <div class="avatar">${esc(initialsFor(p.name))}</div>
            <div>
              <div style="font-weight:600;">${esc(p.name)}</div>
              <div style="color:var(--text-muted);font-size:12px;">${esc(p.patient_code)}</div>
            </div>
          </div>
        </td>
        <td>${p.age ?? "--"} / ${esc(p.gender || "--")}</td>
        <td>${esc(p.ward || "--")}</td>
        <td><span class="badge ${p.status === "active" ? "normal" : "warning"}">${esc(p.status)}</span></td>
        <td><span class="device-cell">${connDot}${deviceLabel}</span></td>
        <td style="text-align:right;white-space:nowrap;">
          <button type="button" class="icon-btn" data-action="device" data-id="${p.id}" title="Manage device" aria-label="Manage device for ${esc(p.name)}">${icon("chip")}</button>
          <button type="button" class="icon-btn" data-action="edit" data-id="${p.id}" title="Edit patient" aria-label="Edit ${esc(p.name)}">${icon("edit")}</button>
          <button type="button" class="icon-btn danger" data-action="delete" data-id="${p.id}" title="Delete patient" aria-label="Delete ${esc(p.name)}">${icon("trash")}</button>
        </td>
      </tr>`;
    }).join("");
  }

  $("patientsTableBody").addEventListener("click", (e) => {
    const btn = e.target.closest("[data-action]");
    if (!btn) return;
    const id = parseInt(btn.dataset.id, 10);
    if (btn.dataset.action === "edit") openPatientModal(id);
    if (btn.dataset.action === "delete") openDeleteModal(id);
    if (btn.dataset.action === "device") openDeviceModal(id);
  });

  $("filterTabs").addEventListener("click", (e) => {
    const tab = e.target.closest(".filter-tab");
    if (!tab) return;
    document.querySelectorAll(".filter-tab").forEach((t) => {
      t.classList.toggle("active", t === tab);
      t.setAttribute("aria-selected", t === tab ? "true" : "false");
    });
    state.statusFilter = tab.dataset.status;
    loadPatients().catch((err) => showToast(err.message, "error"));
  });

  /* ------------------------------ add / edit ------------------------------ */

  const patientModal = $("patientModalBackdrop");

  function openPatientModal(id = null) {
    const patient = id ? state.patients.find((p) => p.id === id) : null;
    $("patientModalTitle").textContent = patient ? "Edit Patient" : "Add Patient";
    $("patientId").value = patient ? patient.id : "";
    $("pName").value = patient?.name || "";
    $("pAge").value = patient?.age ?? "";
    $("pGender").value = patient?.gender || "Male";
    $("pWard").value = patient?.ward || "";
    $("pStatus").value = patient?.status || "active";
    setFormError(null);
    Modal.open(patientModal);
  }

  function closePatientModal() {
    Modal.close(patientModal);
    $("patientForm").reset();
  }

  $("addPatientBtn").addEventListener("click", () => openPatientModal());
  $("patientCancelBtn").addEventListener("click", closePatientModal);

  $("patientForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const id = $("patientId").value;
    const name = $("pName").value.trim();
    const ageText = $("pAge").value.trim();

    if (!name) return setFormError("Enter the patient's name");
    if (ageText !== "" && (!/^\d+$/.test(ageText) || +ageText > 130)) {
      return setFormError("Age must be a whole number between 0 and 130");
    }
    setFormError(null);

    const payload = {
      name,
      age: ageText === "" ? null : parseInt(ageText, 10),
      gender: $("pGender").value,
      ward: $("pWard").value.trim(),
      status: $("pStatus").value,
    };

    const btn = $("patientSaveBtn");
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
      setFormError(err.message);
    } finally {
      btn.disabled = false;
    }
  });

  /* ------------------------------ delete ------------------------------ */

  const deleteModal = $("deleteModalBackdrop");

  function openDeleteModal(id) {
    const patient = state.patients.find((p) => p.id === id);
    state.deleteTargetId = id;
    $("deleteModalText").textContent =
      `${patient ? patient.name : "This patient"} will be removed together with all stored readings and alerts. ` +
      `Their device is kept and becomes unassigned. This cannot be undone.`;
    Modal.open(deleteModal);
  }

  function closeDeleteModal() {
    Modal.close(deleteModal);
    state.deleteTargetId = null;
  }

  $("deleteCancelBtn").addEventListener("click", closeDeleteModal);

  $("deleteConfirmBtn").addEventListener("click", async () => {
    if (!state.deleteTargetId) return;
    const btn = $("deleteConfirmBtn");
    btn.disabled = true;
    try {
      await api(`/api/patients/${state.deleteTargetId}`, { method: "DELETE" });
      showToast("Patient deleted");
      closeDeleteModal();
      await loadPatients();
      Chrome.refreshAlertBadge();
    } catch (err) {
      showToast(err.message, "error");
    } finally {
      btn.disabled = false;
    }
  });

  /* ------------------------------ devices ------------------------------ */

  const deviceModal = $("deviceModalBackdrop");

  function showKeyPanel(device, apiKey) {
    $("deviceModalBody").innerHTML = `
      <p style="font-size:13.5px;color:var(--text-secondary);margin-top:0;">
        <strong style="color:var(--text-primary);">${esc(device.device_uid)}</strong> is registered.
      </p>
      <div class="key-box" role="status">
        <strong>Save this API key now</strong> - it is shown only once.<br/>
        Use it in <code>firmware/secrets.h</code> (real ESP32) or <code>python esp32_simulator.py --key ...</code>
        <div class="key-value" id="newKeyValue">${esc(apiKey)}</div>
        <button type="button" class="btn btn-sm" id="copyKeyBtn" style="margin-top:10px;">Copy key</button>
      </div>`;

    $("copyKeyBtn").addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(apiKey);
        showToast("Key copied");
      } catch {
        const range = document.createRange();
        range.selectNodeContents($("newKeyValue"));
        const selection = window.getSelection();
        selection.removeAllRanges();
        selection.addRange(range);
        showToast("Press Ctrl+C to copy the selected key", "success");
      }
    });
  }

  async function openDeviceModal(patientId) {
    try {
      await loadDevices();
    } catch (err) {
      showToast(err.message, "error");
      return;
    }

    const patient = state.patients.find((p) => p.id === patientId);
    const assigned = state.devices.find((d) => d.patient_id === patientId);
    const unassigned = state.devices.filter((d) => !d.patient_id);
    const body = $("deviceModalBody");

    if (assigned) {
      body.innerHTML = `
        <p style="font-size:13.5px;color:var(--text-secondary);margin-top:0;">
          <strong style="color:var(--text-primary);">${esc(assigned.device_uid)}</strong> is assigned to ${esc(patient?.name)}.
        </p>
        <div class="device-row"><span class="label">Status</span><span class="value-col"><span class="dot ${assigned.connected ? "online" : "offline"}"></span>${assigned.connected ? "Connected" : "Disconnected"}</span></div>
        <div class="device-row"><span class="label">Firmware</span><span class="value-col">${esc(assigned.firmware_version)}</span></div>
        <p style="font-size:12px;color:var(--text-muted);">The API key was shown once when this device was registered. For the demo device it is saved in <code>firmware/device_key.txt</code>.</p>
        <button type="button" class="btn btn-outline" id="unassignBtn">Unassign this device</button>`;

      $("unassignBtn").addEventListener("click", async () => {
        try {
          await api(`/api/devices/${assigned.id}/assign`, { method: "PUT", body: { patient_id: null } });
          showToast("Device unassigned");
          await loadPatients();
          await openDeviceModal(patientId);
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
              ${unassigned.map((d) => `<option value="${d.id}">${esc(d.device_uid)}</option>`).join("")}
            </select>
          </div>
          <button type="button" class="btn" id="assignExistingBtn">Assign Selected Device</button>
          <p style="text-align:center;color:var(--text-muted);font-size:12px;margin:14px 0;">or register a new one</p>
        ` : `<p style="font-size:13px;color:var(--text-secondary);margin-top:0;">No unassigned devices yet. Register a new ESP32 below.</p>`}
        <div class="form-row">
          <label for="newDeviceUid">New device ID</label>
          <input type="text" id="newDeviceUid" maxlength="64" placeholder="e.g. ESP32-WARD3-02" />
        </div>
        <button type="button" class="btn" id="registerDeviceBtn">Register &amp; Assign</button>`;

      const assignBtn = $("assignExistingBtn");
      if (assignBtn) {
        assignBtn.addEventListener("click", async () => {
          try {
            await api(`/api/devices/${$("existingDeviceSelect").value}/assign`, { method: "PUT", body: { patient_id: patientId } });
            showToast("Device assigned");
            closeDeviceModal();
            await loadPatients();
          } catch (err) {
            showToast(err.message, "error");
          }
        });
      }

      $("registerDeviceBtn").addEventListener("click", async () => {
        const uid = $("newDeviceUid").value.trim();
        if (!uid) return showToast("Enter a device ID first", "error");
        try {
          const data = await api("/api/devices", { method: "POST", body: { device_uid: uid, patient_id: patientId } });
          showKeyPanel(data.device, data.api_key);
          await loadPatients();
        } catch (err) {
          showToast(err.message, "error");
        }
      });
    }

    if (deviceModal.classList.contains("hidden")) Modal.open(deviceModal);
  }

  function closeDeviceModal() {
    Modal.close(deviceModal);
  }
  $("deviceCancelBtn").addEventListener("click", closeDeviceModal);

  /* ------------------------------ start ------------------------------ */

  async function init() {
    Chrome.init({ page: "patients" });
    $("iconPlus").innerHTML = icon("plus");
    try {
      await loadPatients();
    } catch (err) {
      if (err.status !== 401) showToast(err.message, "error");
    }
  }

  init();
})();