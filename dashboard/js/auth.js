document.getElementById("brandMark").innerHTML = icon("activity").replace('stroke="currentColor"', 'stroke="#0a0d16"');

// Already logged in? skip straight to the dashboard.
if (getToken()) {
  window.location.href = "dashboard.html";
}

const loginPane = document.getElementById("loginPane");
const registerPane = document.getElementById("registerPane");

document.getElementById("showRegister").addEventListener("click", () => {
  loginPane.classList.add("hidden");
  registerPane.classList.remove("hidden");
});

document.getElementById("showLogin").addEventListener("click", () => {
  registerPane.classList.add("hidden");
  loginPane.classList.remove("hidden");
});

function setError(el, message) {
  if (!message) {
    el.classList.add("hidden");
    el.textContent = "";
    return;
  }
  el.textContent = message;
  el.classList.remove("hidden");
}

document.getElementById("loginForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const errEl = document.getElementById("loginError");
  const btn = document.getElementById("loginBtn");
  setError(errEl, null);

  const username = document.getElementById("loginUsername").value.trim();
  const password = document.getElementById("loginPassword").value;

  btn.disabled = true;
  btn.textContent = "Signing in...";
  try {
    const data = await api("/api/auth/login", { method: "POST", body: { username, password } });
    setSession(data.token, data.user);
    window.location.href = "dashboard.html";
  } catch (err) {
    setError(errEl, err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = "Sign In";
  }
});

document.getElementById("registerForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const errEl = document.getElementById("registerError");
  const btn = document.getElementById("registerBtn");
  setError(errEl, null);

  const full_name = document.getElementById("regName").value.trim();
  const username = document.getElementById("regUsername").value.trim();
  const password = document.getElementById("regPassword").value;

  btn.disabled = true;
  btn.textContent = "Creating account...";
  try {
    const data = await api("/api/auth/register", { method: "POST", body: { full_name, username, password } });
    setSession(data.token, data.user);
    window.location.href = "dashboard.html";
  } catch (err) {
    setError(errEl, err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = "Create Account";
  }
});