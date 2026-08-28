/* Small fetch wrapper shared by every page.
   Same-origin (Flask serves both the API and these static files), so no
   base URL or CORS handling is needed - just call api('/api/...'). */

const TOKEN_KEY = "vt_token";
const USER_KEY = "vt_user";
const PATIENT_KEY = "vt_selected_patient";

function getToken() {
  return localStorage.getItem(TOKEN_KEY);
}

function getStoredUser() {
  try {
    return JSON.parse(localStorage.getItem(USER_KEY) || "null");
  } catch {
    return null;
  }
}

function setSession(token, user) {
  localStorage.setItem(TOKEN_KEY, token);
  localStorage.setItem(USER_KEY, JSON.stringify(user));
}

function clearSession() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
}

function requireAuth() {
  if (!getToken()) {
    window.location.href = "index.html";
  }
}

function getSelectedPatientId() {
  const v = localStorage.getItem(PATIENT_KEY);
  return v ? parseInt(v, 10) : null;
}

function setSelectedPatientId(id) {
  localStorage.setItem(PATIENT_KEY, String(id));
}

/**
 * api(path, { method, body })
 * Adds the Authorization header, JSON-encodes the body, and throws a
 * readable Error on non-2xx responses (with the server's error message
 * when available) so callers can just try/catch.
 */
async function api(path, { method = "GET", body } = {}) {
  const headers = { "Content-Type": "application/json" };
  const token = getToken();
  if (token) headers["Authorization"] = "Bearer " + token;

  let res;
  try {
    res = await fetch(path, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch (networkErr) {
    throw new Error("Could not reach the VitalTrack server. Is the Flask backend running?");
  }

  if (res.status === 401) {
    clearSession();
    window.location.href = "index.html";
    throw new Error("Session expired");
  }

  let data = null;
  const text = await res.text();
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = null;
    }
  }

  if (!res.ok) {
    const message = (data && data.error) || `Request failed (${res.status})`;
    throw new Error(message);
  }

  return data;
}

function showToast(message, type = "success") {
  const existing = document.querySelector(".toast");
  if (existing) existing.remove();

  const el = document.createElement("div");
  el.className = `toast ${type}`;
  el.textContent = message;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 3500);
}

function timeAgo(isoString) {
  if (!isoString) return "";
  const diffMs = Date.now() - new Date(isoString).getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return new Date(isoString).toLocaleDateString();
}

function formatClockTime(isoString) {
  if (!isoString) return "--:--";
  return new Date(isoString).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}