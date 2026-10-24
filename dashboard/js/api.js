/* Shared by every page: login session + a small wrapper around fetch().
   Flask serves both the API and these files from the same address, so there is
   no base URL and no CORS - just call api("/api/..."). */

const TOKEN_KEY = "vt_token";
const USER_KEY = "vt_user";
const PATIENT_KEY = "vt_selected_patient";

// Pages a login may send you back to (anything else goes to the dashboard)
const PAGES = ["dashboard.html", "patients.html", "alerts.html"];

// session

function getToken() {
  try { return localStorage.getItem(TOKEN_KEY); } catch { return null; }
}

function getStoredUser() {
  try { return JSON.parse(localStorage.getItem(USER_KEY) || "null"); } catch { return null; }
}

function setSession(token, user) {
  localStorage.setItem(TOKEN_KEY, token);
  localStorage.setItem(USER_KEY, JSON.stringify(user));
}

function clearSession() {
  try {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
  } catch {}  // storage unavailable
}

// The token's expiry time in ms (read from the token itself), or null if unreadable.
function tokenExpiry(token) {
  try {
    const part = token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
    const payload = JSON.parse(atob(part));
    return payload.exp ? payload.exp * 1000 : null;
  } catch {
    return null;
  }
}

function hasValidSession() {
  const token = getToken();
  if (!token) return false;
  const exp = tokenExpiry(token);
  return exp === null || exp > Date.now();
}

function currentPage() {
  return window.location.pathname.split("/").pop() || "index.html";
}

let redirecting = false;
function goToLogin({ expired = false } = {}) {
  clearSession();
  if (currentPage() === "index.html") return;   // already on the login page: nothing to redirect
  if (redirecting) return;
  redirecting = true;
  const params = new URLSearchParams();
  const page = currentPage();
  if (PAGES.includes(page)) params.set("next", page);
  if (expired) params.set("expired", "1");
  const query = params.toString();
  window.location.replace("index.html" + (query ? "?" + query : ""));
}

// Call at the top of every page except the login page.
function requireAuth() {
  if (!hasValidSession()) {
    goToLogin({ expired: !!getToken() });
    return false;
  }
  return true;
}

// Where to go after logging in: the page you were on, if it is one of ours.
function nextPageAfterLogin() {
  const next = new URLSearchParams(window.location.search).get("next");
  return PAGES.includes(next) ? next : "dashboard.html";
}

function getSelectedPatientId() {
  const v = localStorage.getItem(PATIENT_KEY);
  return v ? parseInt(v, 10) : null;
}

function setSelectedPatientId(id) {
  localStorage.setItem(PATIENT_KEY, String(id));
}

// requests 

class ApiError extends Error {
  constructor(message, status) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

/**
 * api(path, { method, body, auth })
 *  - adds the login token and JSON-encodes the body
 *  - throws ApiError with the server's message on any failure
 *  - auth:false is for login/register, where a 401 just means "wrong password"
 *    (it must NOT log you out or reload the page)
 */
async function api(path, { method = "GET", body, auth = true } = {}) {
  const headers = { "Content-Type": "application/json" };
  const token = getToken();
  if (auth && token) headers["Authorization"] = "Bearer " + token;

  let res;
  try {
    res = await fetch(path, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      cache: "no-store",
    });
  } catch {
    throw new ApiError("Cannot reach the VitalTrack server. Is it running?", 0);
  }

  let data = null;
  const text = await res.text();
  if (text) {
    try { data = JSON.parse(text); } catch { data = null; }
  }

  if (res.status === 401 && auth) {
    goToLogin({ expired: true });
    throw new ApiError("Session expired. Please sign in again.", 401);
  }

  if (!res.ok) {
    throw new ApiError((data && data.error) || `Request failed (${res.status})`, res.status);
  }
  return data;
}

// small helpers

// Escape text before putting it inside innerHTML (stops names like <img onerror=...> from running).

function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, (c) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
  ));
}

let toastTimer = null;
function showToast(message, type = "success") {
  const existing = document.querySelector(".toast");
  if (existing) existing.remove();
  clearTimeout(toastTimer);

  const el = document.createElement("div");
  el.className = `toast ${type}`;
  el.setAttribute("role", type === "error" ? "alert" : "status");
  el.textContent = message;
  document.body.appendChild(el);
  toastTimer = setTimeout(() => el.remove(), 4000);
}

function timeAgo(isoString) {
  if (!isoString) return "";
  const diffMs = Date.now() - new Date(isoString).getTime();
  const secs = Math.floor(diffMs / 1000);
  if (secs < 10) return "just now";
  if (secs < 60) return `${secs}s ago`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return new Date(isoString).toLocaleDateString();
}

function formatClockTime(isoString) {
  if (!isoString) return "--:--";
  return new Date(isoString).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function formatDateTime(isoString) {
  if (!isoString) return "--";
  return new Date(isoString).toLocaleString([], {
    day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit",
  });
}