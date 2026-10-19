/* Shared page chrome: sidebar, top bar clock + user, logout, alert badge, modals.
   Every page calls Chrome.init({ page: "dashboard" }) once when it loads.        */

const NAV_ITEMS = [
  { key: "dashboard", label: "Dashboard", href: "dashboard.html", icon: "grid" },
  { key: "monitor", label: "Real-time Monitor", icon: "pulse", soon: true },
  { key: "history", label: "History / Records", icon: "history", soon: true },
  { key: "reports", label: "Reports", icon: "report", soon: true },
  { key: "alerts", label: "Alerts", href: "alerts.html", icon: "bell", badge: true },
  { key: "patients", label: "Patients", href: "patients.html", icon: "users" },
  { key: "settings", label: "Settings", icon: "settings", soon: true },
  { key: "profile", label: "Profile", icon: "user", soon: true },
];

const BADGE_POLL_MS = 15000;

const Chrome = {
  init({ page }) {
    this.renderSidebar(page);
    this.paintTopbar();
    this.bindLogout();
    this.bindMenuButton();
    this.startClock();
    this.startBadgePolling();
  },

  renderSidebar(page) {
    const aside = document.getElementById("sidebar");
    if (!aside) return;

    const items = NAV_ITEMS.map((item) => {
      const inner = `<span>${icon(item.icon)}</span>${item.label}`;
      if (item.soon) {
        return `<li><span class="nav-link disabled" aria-disabled="true">${inner}<span class="soon-tag">Soon</span></span></li>`;
      }
      const active = item.key === page ? " active" : "";
      const current = item.key === page ? ' aria-current="page"' : "";
      const badge = item.badge ? '<span class="badge-count hidden" id="sidebarAlertBadge">0</span>' : "";
      return `<li><a class="nav-link${active}" href="${item.href}"${current}>${inner}${badge}</a></li>`;
    }).join("");

    aside.innerHTML = `
      <div class="brand">
        <div class="brand-mark">${icon("logo")}</div>
        <div class="brand-text">
          <div class="brand-name"><span class="accent-green">VITAL</span>-TRACK</div>
          <div class="brand-tag">Health Monitoring System</div>
        </div>
      </div>
      <ul class="nav-group">${items}</ul>
      <div class="sidebar-footer">
        <div id="sidebarExtra"></div>
        <a class="logout-link" href="#" id="logoutBtn"><span>${icon("logout")}</span>Logout</a>
      </div>`;
  },

  paintTopbar() {
    const set = (id, html) => { const el = document.getElementById(id); if (el) el.innerHTML = html; };
    set("iconCalendar", icon("calendar"));
    set("iconClock", icon("clock"));
    set("iconWifi", icon("wifi"));
    set("hamburger", icon("menu"));

    const user = getStoredUser();
    const name = user?.full_name || user?.username || "User";
    const nameEl = document.getElementById("adminName");
    const avatarEl = document.getElementById("adminAvatar");
    if (nameEl) nameEl.textContent = name;
    if (avatarEl) avatarEl.textContent = name.slice(0, 1).toUpperCase();
  },

  bindLogout() {
    const btn = document.getElementById("logoutBtn");
    if (!btn) return;
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      clearSession();
      window.location.href = "index.html";
    });
  },

  bindMenuButton() {
    const btn = document.getElementById("hamburger");
    if (!btn) return;
    const backdrop = document.createElement("div");
    backdrop.className = "nav-backdrop";
    document.body.appendChild(backdrop);

    const isMobile = () => window.matchMedia("(max-width: 860px)").matches;
    btn.addEventListener("click", () => {
      document.body.classList.toggle(isMobile() ? "nav-open" : "sidebar-collapsed");
    });
    backdrop.addEventListener("click", () => document.body.classList.remove("nav-open"));
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") document.body.classList.remove("nav-open");
    });
  },

  startClock() {
    const dateEl = document.getElementById("topDate");
    const clockEl = document.getElementById("topClock");
    if (!dateEl || !clockEl) return;
    const tick = () => {
      const now = new Date();
      dateEl.textContent = now.toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" });
      clockEl.textContent = now.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" });
    };
    tick();
    setInterval(tick, 1000);
  },

  setAlertBadge(count) {
    const badge = document.getElementById("sidebarAlertBadge");
    if (!badge) return;
    if (count > 0) {
      badge.textContent = count > 99 ? "99+" : String(count);
      badge.classList.remove("hidden");
    } else {
      badge.classList.add("hidden");
    }
  },

  async refreshAlertBadge() {
    try {
      const data = await api("/api/alerts?limit=1");
      this.setAlertBadge(data.unread_count);
    } catch { /* the badge is not important enough to show an error */ }
  },

  startBadgePolling() {
    this.refreshAlertBadge();
    setInterval(() => { if (!document.hidden) this.refreshAlertBadge(); }, BADGE_POLL_MS);
  },
};

/* ------------------------------ modals ------------------------------ */

const Modal = {
  _stack: [],

  open(backdrop) {
    if (!backdrop.dataset.bound) {
      backdrop.dataset.bound = "1";
      // close when the dark area outside the dialog is clicked
      backdrop.addEventListener("mousedown", (e) => { if (e.target === backdrop) Modal.close(backdrop); });
    }
    backdrop.classList.remove("hidden");
    this._stack.push({ backdrop, previous: document.activeElement });
    const first = backdrop.querySelector("input:not([type=hidden]), select, textarea, button");
    if (first) setTimeout(() => first.focus(), 0);
  },

  close(backdrop) {
    backdrop.classList.add("hidden");
    const index = this._stack.findIndex((entry) => entry.backdrop === backdrop);
    if (index !== -1) {
      const [entry] = this._stack.splice(index, 1);
      if (entry.previous && entry.previous.focus) entry.previous.focus();
    }
  },
};

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && Modal._stack.length) {
    Modal.close(Modal._stack[Modal._stack.length - 1].backdrop);
  }
});