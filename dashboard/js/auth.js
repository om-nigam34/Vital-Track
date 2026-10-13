const loginPane = document.getElementById("loginPane");
const registerPane = document.getElementById("registerPane");
const notice = document.getElementById("authNotice");

document.getElementById("brandMark").innerHTML = icon("logo");

function showNotice(message) {
  notice.textContent = message;
  notice.classList.remove("hidden");
}

function setError(el, message) {
  el.textContent = message || "";
  el.classList.toggle("hidden", !message);
}

function showPane(name) {
  loginPane.classList.toggle("hidden", name !== "login");
  registerPane.classList.toggle("hidden", name !== "register");
  const first = (name === "login" ? loginPane : registerPane).querySelector("input");
  if (first) first.focus();
}

document.getElementById("showRegister").addEventListener("click", () => showPane("register"));
document.getElementById("showLogin").addEventListener("click", () => showPane("login"));

async function submitAuth({ form, button, errorEl, busyText, idleText, path, body }) {
  setError(errorEl, null);
  button.disabled = true;
  button.textContent = busyText;
  try {
    const data = await api(path, { method: "POST", body, auth: false });
    setSession(data.token, data.user);
    window.location.replace(nextPageAfterLogin());
  } catch (err) {
    setError(errorEl, err.message);
    button.disabled = false;
    button.textContent = idleText;
  }
}

document.getElementById("loginForm").addEventListener("submit", (e) => {
  e.preventDefault();
  const username = document.getElementById("loginUsername").value.trim();
  const password = document.getElementById("loginPassword").value;
  const errorEl = document.getElementById("loginError");
  if (!username || !password) {
    setError(errorEl, "Enter your username and password");
    return;
  }
  submitAuth({
    button: document.getElementById("loginBtn"),
    errorEl,
    busyText: "Signing in...",
    idleText: "Sign In",
    path: "/api/auth/login",
    body: { username, password },
  });
});

document.getElementById("registerForm").addEventListener("submit", (e) => {
  e.preventDefault();
  const errorEl = document.getElementById("registerError");
  const full_name = document.getElementById("regName").value.trim();
  const username = document.getElementById("regUsername").value.trim();
  const password = document.getElementById("regPassword").value;
  if (!full_name || !username || !password) {
    setError(errorEl, "Fill in all three fields");
    return;
  }
  if (password.length < 8) {
    setError(errorEl, "Password must be at least 8 characters");
    return;
  }
  submitAuth({
    button: document.getElementById("registerBtn"),
    errorEl,
    busyText: "Creating account...",
    idleText: "Create Account",
    path: "/api/auth/register",
    body: { full_name, username, password },
  });
});

(async function boot() {
  const params = new URLSearchParams(window.location.search);
  if (params.get("expired")) showNotice("Your session ended. Please sign in again.");

  // Already signed in? Ask the server first. A stale token must never bounce you
  // between this page and the dashboard.
  if (hasValidSession()) {
    try {
      await api("/api/auth/me");
      window.location.replace(nextPageAfterLogin());
      return;
    } catch {
      clearSession();
    }
  }

  try {
    const meta = await api("/api/meta", { auth: false });
    if (!meta.registration_enabled) {
      document.getElementById("registerLinkRow").classList.add("hidden");
    }
  } catch {
    showNotice("Cannot reach the VitalTrack server. Is it running?");
  }
})();