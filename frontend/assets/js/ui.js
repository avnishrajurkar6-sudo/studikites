/* StudiKitEZ — shared UI v3
   One shell for every page: sticky nav, mobile dock, notification bell,
   force-message overlay, devtools guard (3 strikes -> ban), motion, toasts.
   No trackers. No redirect loops. */
window.SK = window.SK || {};
window.SK.ui = (function () {
  "use strict";
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  var shellReady = false, shellUser = null, shellAdmin = false;
  var PAGE = (function () {
    try {
      if (/^\/course\/[^/]+\/?$/.test(location.pathname)) return "content.html";
      return (location.pathname.split("/").pop() || "index.html").toLowerCase();
    } catch (e) { return "index.html"; }
  })();

  function esc(s) {
    return String(s === null || s === undefined ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }
  function courseSlug(title) {
    return String(title || "course").normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
      .toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "course";
  }
  function courseUrl(title, id, path) {
    if (!title && id) {
      try {
        var catalog = JSON.parse(localStorage.getItem("sk_catalog") || "null");
        var batch = [].concat(catalog && catalog.new || [], catalog && catalog.old || [])
          .find(function (entry) { return String(entry.id) === String(id); });
        if (batch) title = batch.title;
      } catch (e) { }
      if (!title) {
        try { title = sessionStorage.getItem("sk_title_" + id); } catch (e) { }
      }
      if (!title) title = "Course " + id;
    }
    return "/course/" + courseSlug(title) + (path ? "?path=" + encodeURIComponent(path) : "");
  }
  function nextTarget() {
    return /^\/course\/[^/]+\/?$/.test(location.pathname) ? location.pathname + location.search : PAGE + location.search;
  }
  function isAuthPage() {
    return /^(login|onboarding|banned|404|maintenance|forcemsg)\.html$/.test(PAGE);
  }
  function isAdminPage() { return PAGE === "admin.html"; }
  function store(k, v) { try { if (v === undefined) return localStorage.getItem(k); localStorage.setItem(k, v); } catch (e) { } return null; }
  function sstore(k, v) { try { if (v === undefined) return sessionStorage.getItem(k); sessionStorage.setItem(k, v); } catch (e) { } return null; }
  function reduced() { try { return matchMedia("(prefers-reduced-motion: reduce)").matches; } catch (e) { return false; } }

  /* ---------------- toasts ---------------- */
  function toast(title, msg, icon) {
    var root = document.getElementById("toast-root");
    if (!root) {
      root = document.createElement("div");
      root.id = "toast-root"; root.setAttribute("aria-live", "polite");
      document.body.appendChild(root);
    }
    var el = document.createElement("div");
    el.className = "toast"; el.setAttribute("role", "status");
    el.innerHTML = '<span class="t-ico" aria-hidden="true"></span><div style="min-width:0"><b></b><p></p></div>';
    el.querySelector(".t-ico").textContent = icon || (/fail|error|couldn|denied|unavailable/i.test(String(title)) ? "!" : "✓");
    el.querySelector("b").textContent = title;
    el.querySelector("p").textContent = msg || "";
    if (!msg) el.querySelector("p").remove();
    root.appendChild(el);
    var kill = function () { el.style.opacity = "0"; el.style.transform = "translateY(8px)"; setTimeout(function () { el.remove(); }, 220); };
    el.addEventListener("click", kill);
    setTimeout(kill, 4200);
  }

  /* ---------------- top progress ---------------- */
  var loadCount = 0;
  function load(on) {
    var bar = document.getElementById("top-loader");
    if (!bar) {
      bar = document.createElement("div"); bar.id = "top-loader"; bar.setAttribute("aria-hidden", "true");
      document.body.prepend(bar);
    }
    loadCount = Math.max(0, loadCount + (on ? 1 : -1));
    bar.classList.toggle("on", loadCount > 0);
  }
  function scrollProgress() {
    if (window.__skScrollBar) return;
    var bar = document.getElementById("scroll-progress");
    if (!bar) { bar = document.createElement("div"); bar.id = "scroll-progress"; bar.setAttribute("aria-hidden", "true"); document.body.appendChild(bar); }
    var tick = function () {
      var h = document.documentElement.scrollHeight - window.innerHeight;
      var p = h > 0 ? Math.min(1, Math.max(0, window.scrollY / h)) : 0;
      bar.style.transform = "scaleX(" + p + ")";
      var head = document.querySelector(".site-header");
      if (head) head.classList.toggle("scrolled", window.scrollY > 8);
    };
    window.addEventListener("scroll", tick, { passive: true });
    window.addEventListener("resize", tick);
    tick();
    window.__skScrollBar = true;
  }

  /* ---------------- ripple + reveal ---------------- */
  function ripple(e) {
    var b = e.target && e.target.closest ? e.target.closest(".btn, .iconbtn, .dock a, .pick-card, .qpill") : null;
    if (!b || b.disabled) return;
    var r = b.getBoundingClientRect();
    b.style.setProperty("--rx", ((e.clientX - r.left) / r.width) * 100 + "%");
    b.style.setProperty("--ry", ((e.clientY - r.top) / r.height) * 100 + "%");
    b.classList.add("ripple");
    clearTimeout(b.__ripple);
    b.__ripple = setTimeout(function () { b.classList.remove("ripple"); }, 360);
  }
  function revealObserver() {
    if (window.__skReveal) return;
    window.__skReveal = true;
    var io = null;
    if ("IntersectionObserver" in window) {
      io = new IntersectionObserver(function (rows) {
        rows.forEach(function (r) { if (r.isIntersecting) { r.target.classList.add("in"); io.unobserve(r.target); } });
      }, { rootMargin: "0px 0px -8% 0px", threshold: 0.02 });
    }
    var scan = function () {
      $$(".reveal:not(.in)").forEach(function (el) { if (io) io.observe(el); else el.classList.add("in"); });
    };
    scan();
    setTimeout(scan, 600);
    window.__skRevealScan = scan;
  }

  /* ---------------- confetti ---------------- */
  function confetti(opts) {
    if (reduced()) return;
    opts = opts || {};
    var cv = document.getElementById("confetti-canvas");
    if (!cv) { cv = document.createElement("canvas"); cv.id = "confetti-canvas"; cv.setAttribute("aria-hidden", "true"); document.body.appendChild(cv); }
    var ctx = cv.getContext("2d"), W = cv.width = innerWidth, H = cv.height = innerHeight;
    var colors = opts.colors || ["#6d5ef8", "#ff5c8a", "#ff9f1c", "#16b364", "#22d3ee"];
    var n = Math.min(180, opts.count || 90), ps = [];
    for (var i = 0; i < n; i++) {
      ps.push({
        x: W * (0.2 + Math.random() * 0.6), y: H * (0.18 + Math.random() * 0.12),
        vx: (Math.random() - 0.5) * 9, vy: -4 - Math.random() * 9,
        w: 5 + Math.random() * 7, h: 3 + Math.random() * 5,
        c: colors[i % colors.length], rot: Math.random() * 6.28, vr: (Math.random() - 0.5) * 0.3, life: 1
      });
    }
    var start = performance.now();
    (function frame(t) {
      var dt = Math.min(32, t - start); start = t;
      ctx.clearRect(0, 0, W, H);
      var alive = false;
      ps.forEach(function (p) {
        p.vy += 0.22 * (dt / 16); p.x += p.vx * (dt / 16); p.y += p.vy * (dt / 16);
        p.rot += p.vr; p.life -= 0.006 * (dt / 16);
        if (p.y < H + 30 && p.life > 0) alive = true;
        ctx.save(); ctx.globalAlpha = Math.max(0, p.life); ctx.translate(p.x, p.y); ctx.rotate(p.rot);
        ctx.fillStyle = p.c; ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h); ctx.restore();
      });
      if (alive) requestAnimationFrame(frame);
      else { ctx.clearRect(0, 0, W, H); }
    })(performance.now());
  }

  /* ---------------- modal ---------------- */
  var modalHost = null;
  function modal(html, opts) {
    closeModal();
    opts = opts || {};
    modalHost = document.createElement("div");
    modalHost.className = "modal";
    modalHost.setAttribute("role", "dialog");
    modalHost.setAttribute("aria-modal", "true");
    modalHost.innerHTML = '<div class="modal-card panel anim-rise">' + html + "</div>";
    if (!opts.locked) modalHost.addEventListener("click", function (e) { if (e.target === modalHost) closeModal(); });
    document.body.appendChild(modalHost);
    var focus = modalHost.querySelector("[autofocus],input,textarea,button");
    if (focus) setTimeout(function () { try { focus.focus(); } catch (e) { } }, 80);
    return modalHost;
  }
  function closeModal() {
    if (modalHost && modalHost.parentNode) modalHost.remove();
    modalHost = null;
  }

  /* ---------------- skeleton loading state ---------------- */
  var splashTimer = null;
  function splash(show, status) {
    if (show) {
      document.body.classList.add("booting");
      var el = document.getElementById("boot-splash");
      if (!el) {
        el = document.createElement("div");
        el.id = "boot-splash"; el.setAttribute("role", "status"); el.setAttribute("aria-label", "Loading page");
        el.innerHTML = '<div class="splash-card"><div class="splash-status"></div>' +
          '<div class="splash-skeleton title"></div><div class="splash-skeleton line"></div>' +
          '<div class="splash-skeleton line short"></div><div class="splash-grid">' +
          '<div class="splash-skeleton tile"></div><div class="splash-skeleton tile"></div>' +
          '<div class="splash-skeleton tile"></div></div></div>';
        var main = document.querySelector("main");
        if (main) main.prepend(el); else document.body.appendChild(el);
      }
      var st = el.querySelector(".splash-status");
      if (st && status) st.textContent = status;
      if (splashTimer) clearTimeout(splashTimer);
      splashTimer = setTimeout(function () { splash(false); }, 18000);
      return;
    }
    if (splashTimer) { clearTimeout(splashTimer); splashTimer = null; }
    document.body.classList.remove("booting");
    var gone = document.getElementById("boot-splash");
    if (gone) gone.remove();
  }
  function reveal() { splash(false); }

  /* ---------------- auth area / avatar menu ---------------- */
  function avatarLetter(name) {
    var s = String(name || "?").replace(/^\+91\s*/, "").trim();
    return (s.charAt(0) || "?").toUpperCase();
  }
  async function authArea() {
    var host = document.getElementById("auth-area");
    if (!host) return;
    var u = shellUser;
    if (!u) { try { u = await window.SK.fb.currentUser(); } catch (e) { u = null; } }
    if (!u) {
      host.innerHTML = '<a class="btn btn-ghost btn-sm" href="login.html?next=' + encodeURIComponent(nextTarget()) + '">Sign in</a>' +
        '<a class="btn btn-primary btn-sm" href="login.html?next=' + encodeURIComponent(nextTarget()) + '">Join free</a>';
      return;
    }
    shellUser = u;
    var name = String(u.displayName || u.email || (u.mobile ? "+91 " + u.mobile : "Learner"));
    host.innerHTML = '<div class="av-menu">' +
      '<button class="av-btn" id="av-btn" aria-haspopup="menu" aria-expanded="false">' +
      '<span class="ava">' + esc(avatarLetter(name)) + '</span><span class="av-name">' + esc(name.split(" ")[0].slice(0, 14)) + '</span><span aria-hidden="true" style="opacity:.6">▾</span></button>' +
      '<div class="av-pop" id="av-pop" role="menu">' +
      '<a href="dashboard.html" role="menuitem">Dashboard</a>' +
      '<a href="msgs.html" role="menuitem">Messages</a>' +
      '<a href="focus.html" role="menuitem">Focus room</a>' +
      '<a href="onboarding.html?edit=1" role="menuitem">My batches</a>' +
      '<div class="sep"></div>' +
      '<button id="av-out" role="menuitem">↪ Sign out</button></div></div>';
    var btn = host.querySelector("#av-btn"), pop = host.querySelector("#av-pop");
    btn.addEventListener("click", function (e) {
      e.stopPropagation();
      var on = pop.classList.toggle("open");
      btn.setAttribute("aria-expanded", on ? "true" : "false");
    });
    document.addEventListener("click", function () { pop.classList.remove("open"); btn.setAttribute("aria-expanded", "false"); });
    host.querySelector("#av-out").addEventListener("click", function () {
      window.SK.fb.signOut().then(function () { location.href = "index.html"; });
    });
    try {
      var isAdmin = await window.SK.fb.isAdmin(u.uid);
      if (isAdmin && !pop.querySelector('a[href="admin.html"]')) {
        var a = document.createElement("a"); a.href = "admin.html"; a.setAttribute("role", "menuitem"); a.textContent = "Admin console";
        pop.insertBefore(a, pop.querySelector(".sep"));
      }
    } catch (e) { }
  }

  /* ---------------- nav links ---------------- */
  function injectLinks() {
    [".nav-links", "#mobile-menu"].forEach(function (sel) {
      var host = $(sel);
      if (!host) return;
      if (!host.querySelector('a[href="posts.html"]')) {
        var anchor = host.querySelector('a[href="index.html"]');
        var posts = document.createElement("a"); posts.href = "posts.html"; posts.textContent = "Community";
        var msgs = document.createElement("a"); msgs.href = "msgs.html"; msgs.textContent = "Messages";
        if (anchor) { host.insertBefore(posts, anchor.nextSibling); host.insertBefore(msgs, posts.nextSibling); }
        else { host.appendChild(posts); host.appendChild(msgs); }
      }
      if (!host.querySelector('a[href="dashboard.html"]') && host.classList.contains("nav-links")) {
        var d = document.createElement("a"); d.href = "dashboard.html"; d.textContent = "Dashboard"; host.appendChild(d);
      }
    });
  }
  function gateNav() {
    var memberLinks = $$('.nav-links a[href="dashboard.html"], .nav-links a[href="focus.html"], .nav-links a[href="msgs.html"], #mobile-menu a[href="dashboard.html"], #mobile-menu a[href="focus.html"], #mobile-menu a[href="msgs.html"], #mobile-menu a[href="onboarding.html"]');
    memberLinks.forEach(function (a) { a.hidden = true; });
    window.SK.fb.currentUser().then(function (u) {
      rewriteTelegramLinks(u);
      memberLinks.forEach(function (a) {
        a.hidden = false;
        if (!u) a.style.display = "none";
      });
      var dock = document.getElementById("sk-dock");
      if (dock) {
        if (!u) $$('.dock-link[href="dashboard.html"], .dock-link[href="msgs.html"], .dock-link[href="focus.html"], .dock-link[href="dashboard.html#profile"]', dock).forEach(function (a) { a.remove(); });
        dock.hidden = false;
      }
      var bell = document.getElementById("notice-bell");
      if (bell) {
        if (!u) bell.closest(".bell-wrap").remove();
        else bell.closest(".bell-wrap").hidden = false;
      }
    }).catch(function () {
      memberLinks.forEach(function (a) { a.hidden = false; a.style.display = "none"; });
      var dock = document.getElementById("sk-dock");
      if (dock) {
        $$('.dock-link[href="dashboard.html"], .dock-link[href="msgs.html"], .dock-link[href="focus.html"], .dock-link[href="dashboard.html#profile"]', dock).forEach(function (a) { a.remove(); });
        dock.hidden = false;
      }
      var bell = document.getElementById("notice-bell");
      if (bell) bell.closest(".bell-wrap").remove();
    });
  }

  /* ---------------- telegram ---------------- */
  function botUrl(u) {
    var base = (window.__SK__ && window.__SK__.telegramUrl) || "https://t.me/Studikitesbot";
    if (!u || !u.uid) return base;
    var tag = "vme_" + String(u.uid).replace(/[^A-Za-z0-9_]/g, "").slice(0, 48);
    return base.replace(/\/+$/, "") + "?start=" + tag;
  }
  function rewriteTelegramLinks(u) {
    var url = botUrl(u);
    if (window.__SK__) window.__SK__.telegramUrl = url;
    $$('a[href*="t.me/"]').forEach(function (a) { try { a.href = url; } catch (e) { } });
  }
  function telegram() {
    if (document.getElementById("tg-widget") || isAuthPage()) return;
    var w = document.createElement("div");
    w.className = "tg-widget"; w.id = "tg-widget";
    w.innerHTML = '<span>New batches on <a href="https://t.me/Studikitesbot" target="_blank" rel="noopener">Telegram</a></span><button aria-label="Dismiss">×</button>';
    w.querySelector("a").href = (window.__SK__ && window.__SK__.telegramUrl) || "https://t.me/Studikitesbot";
    w.querySelector("button").addEventListener("click", function () { w.remove(); });
    document.body.appendChild(w);
  }
  function telegramNag() {
    if (isAuthPage()) return;
    if (sstore("sk_tg_nag") === "1") return;
    setTimeout(function () {
      if (modalHost) { setTimeout(telegramNag, 8000); return; }
      var url = (window.__SK__ && window.__SK__.telegramUrl) || "https://t.me/Studikitesbot";
      var m = modal(
        '<span class="kicker">Stay updated</span><h3 style="margin:.5rem 0 .35rem">Join our Telegram</h3>' +
        '<p class="muted" style="margin:0;font-size:.95rem;line-height:1.55">New batches, live classes and exam alerts — pushed instantly.</p>' +
        '<div style="display:flex;gap:.6rem;margin-top:1.1rem;flex-wrap:wrap">' +
        '<a class="btn btn-primary btn-sm" id="tg-join" target="_blank" rel="noopener">Join channel →</a>' +
        '<button class="btn btn-ghost btn-sm" id="tg-x">Not now</button></div>');
      m.querySelector("#tg-join").href = url;
      m.querySelector("#tg-x").addEventListener("click", function () { sstore("sk_tg_nag", "1"); closeModal(); });
    }, 9000);
  }

  /* ---------------- notification bell ---------------- */
  var bellBadge = 0;
  function mountBell() {
    if (document.getElementById("notice-bell") || isAuthPage()) return;
    var host = document.querySelector(".nav-actions") || document.getElementById("auth-area");
    if (!host) return;
    var wrap = document.createElement("div");
    wrap.className = "bell-wrap";
    wrap.hidden = true;
    wrap.innerHTML = '<button class="iconbtn bell-btn" id="notice-bell" aria-label="Notifications" aria-haspopup="dialog">Alerts<span class="notice-dot" hidden></span></button>';
    if (host.id === "auth-area") host.parentNode.insertBefore(wrap, host);
    else host.insertBefore(wrap, host.firstChild);
    wrap.querySelector("#notice-bell").addEventListener("click", openNoticePanel);
    refreshBell();
  }
  async function refreshBell() {
    try {
      var u = shellUser || await window.SK.fb.currentUser();
      if (!u) {
        var guestBell = document.querySelector(".bell-wrap");
        if (guestBell) guestBell.remove();
        return;
      }
      var counts = await window.SK.fb.unreadCount(u.uid);
      bellBadge = counts || 0;
      var dot = document.querySelector("#notice-bell .notice-dot");
      if (dot) dot.hidden = bellBadge <= 0;
      var dockBadge = document.getElementById("dock-badge");
      if (dockBadge) { dockBadge.hidden = bellBadge <= 0; dockBadge.textContent = bellBadge > 9 ? "9+" : String(bellBadge); }
    } catch (e) { }
  }
  async function openNoticePanel() {
    var u = null;
    try { u = await window.SK.fb.currentUser(); } catch (e) { }
    if (!u) { location.href = "login.html?next=" + encodeURIComponent(PAGE); return; }
    var scrim = document.createElement("div");
    scrim.className = "notice-scrim";
    var panel = document.createElement("aside");
    panel.className = "notice-panel panel";
    panel.setAttribute("role", "dialog"); panel.setAttribute("aria-label", "Notifications");
    panel.innerHTML = '<div class="row-head" style="justify-content:space-between;margin-bottom:.6rem">' +
      '<span class="kicker" style="margin:0">Notifications</span>' +
      '<button class="iconbtn" id="nt-x" aria-label="Close">×</button></div>' +
      '<div id="nt-body"><div class="spinner" style="margin:1.5rem auto"></div></div>';
    scrim.appendChild(panel);
    document.body.appendChild(scrim);
    var close = function () { scrim.remove(); document.removeEventListener("keydown", onKey); };
    var onKey = function (e) { if (e.key === "Escape") close(); };
    document.addEventListener("keydown", onKey);
    scrim.addEventListener("click", function (e) { if (e.target === scrim) close(); });
    panel.querySelector("#nt-x").addEventListener("click", close);
    renderNoticeBody(panel.querySelector("#nt-body"), u, close);
  }
  async function renderNoticeBody(host, u, close) {
    var parts = [];
    try {
      var notices = await window.SK.fb.notices(u.uid).catch(function () { return []; });
      var inbox = await window.SK.fb.inbox(u.uid, 12).catch(function () { return []; });
      var anns = await window.SK.fb.announcements(4).catch(function () { return []; });
      if (notices.length) {
        parts.push('<div class="mono muted" style="font-size:.62rem;letter-spacing:.12em;margin:0 0 .4rem">FROM THE TEAM</div>');
        notices.slice(0, 8).forEach(function (n) {
          parts.push('<div class="row-card notice-card" data-nid="' + esc(n.id) + '" style="margin-bottom:.5rem">' +
            '<div style="font-weight:800;font-size:.86rem">' + esc(n.title || "Notice") + '</div>' +
            '<div class="muted" style="font-size:.82rem;white-space:pre-wrap;margin:.15rem 0">' + esc(n.body || "") + '</div>' +
            '<div class="row-head" style="justify-content:space-between"><span class="mono muted" style="font-size:.62rem">' + timeAgo(n.createdAt) + '</span>' +
            '<span style="display:flex;gap:.3rem">' + (n.link ? '<a class="btn btn-secondary btn-sm" href="' + esc(n.link) + '">Open</a>' : "") +
            '<button class="btn btn-ghost btn-sm" data-dismiss="' + esc(n.id) + '">Dismiss</button></span></div></div>');
        });
      }
      if (inbox.length) {
        parts.push('<div class="mono muted" style="font-size:.62rem;letter-spacing:.12em;margin:.8rem 0 .4rem">INBOX</div>');
        inbox.slice(0, 8).forEach(function (m) {
          parts.push('<div class="row-card" style="margin-bottom:.45rem;' + (m.read ? "opacity:.7" : "border-left:3px solid var(--pink)") + '">' +
            '<div class="row-head" style="justify-content:space-between"><strong style="font-size:.8rem">' + esc(m.fromName || "Admin") + '</strong>' +
            '<span class="mono muted" style="font-size:.6rem">' + timeAgo(m.at) + '</span></div>' +
            '<div class="muted" style="font-size:.8rem;white-space:pre-wrap">' + esc(m.text || "") + '</div>' +
            '<div style="display:flex;gap:.35rem;margin-top:.35rem"><a class="btn btn-ghost btn-sm" href="msgs.html">Reply</a>' +
            (m.read ? "" : '<button class="btn btn-ghost btn-sm" data-read="' + esc(m.id) + '">Mark read</button>') + '</div></div>');
        });
      }
      if (anns.length) {
        parts.push('<div class="mono muted" style="font-size:.62rem;letter-spacing:.12em;margin:.8rem 0 .4rem">ANNOUNCEMENTS</div>');
        anns.forEach(function (a) {
          parts.push('<div class="ann-item" style="margin-bottom:.45rem"><div style="min-width:0"><div style="font-weight:700;font-size:.83rem">' + esc(a.title) + '</div><div class="muted" style="font-size:.8rem">' + esc(a.body || "") + '</div></div></div>');
        });
      }
      if (!parts.length) parts.push('<div class="empty" style="padding:2rem 1rem"><h3>All clear</h3><p>No new notices. Keep learning.</p></div>');
      host.innerHTML = parts.join("");
      host.querySelectorAll("[data-dismiss]").forEach(function (b) {
        b.addEventListener("click", function () {
          window.SK.fb.dismissNotice(u.uid, b.getAttribute("data-dismiss")).catch(function () { });
          var card = b.closest(".row-card"); if (card) card.remove();
          refreshBell();
        });
      });
      host.querySelectorAll("[data-read]").forEach(function (b) {
        b.addEventListener("click", function () {
          window.SK.fb.markInboxRead(u.uid, b.getAttribute("data-read")).catch(function () { });
          b.textContent = "Read ✓"; b.disabled = true; refreshBell();
        });
      });
      host.querySelectorAll("[data-nid]").forEach(function (card) {
        window.SK.fb.markNoticeView(u.uid, card.getAttribute("data-nid")).catch(function () { });
      });
      refreshBell();
    } catch (e) {
      host.innerHTML = '<div class="empty" style="padding:2rem 1rem"><h3>Couldn\'t load</h3><p>Check your connection and try again.</p></div>';
    }
  }
  function timeAgo(ms) {
    if (!ms) return "just now";
    var s = Math.floor((Date.now() - Number(ms)) / 1000);
    if (s < 60) return "just now";
    if (s < 3600) return Math.floor(s / 60) + "m ago";
    if (s < 86400) return Math.floor(s / 3600) + "h ago";
    if (s < 604800) return Math.floor(s / 86400) + "d ago";
    return new Date(Number(ms)).toLocaleDateString("en-IN", { day: "numeric", month: "short" });
  }

  /* ---------------- mobile dock ---------------- */
  function mountDock() {
    if (document.getElementById("sk-dock") || isAuthPage()) return;
    var items = [
      { href: "index.html", label: "Catalog" },
      { href: "dashboard.html", label: "Dashboard" },
      { href: "msgs.html", label: "Messages", badge: true },
      { href: "focus.html", label: "Focus" },
      { href: "dashboard.html#profile", label: "Profile" }
    ];
    var nav = document.createElement("nav");
    nav.className = "dock"; nav.id = "sk-dock"; nav.setAttribute("aria-label", "App navigation");
    nav.hidden = true;
    nav.innerHTML = items.map(function (it) {
      var on = it.href.split("#")[0] === PAGE ? " on" : "";
      return '<a href="' + it.href + '" class="dock-link' + on + '">' + it.label +
        (it.badge ? '<span class="d-badge" id="dock-badge" hidden></span>' : "") + '</a>';
    }).join("");
    document.body.appendChild(nav);
  }

  /* ---------------- force-message overlay ---------------- */
  var forceUnsub = null, forceId = null, forceLatest = null, forceTick = null;
  function watchForce() {
    if (PAGE === "forcemsg.html") return;
    if (!forceTick) {
      /* Timers and view limits can end a notice without a Firestore change. */
      forceTick = setInterval(function () {
        if (!forceLatest) return;
        if (!window.SK.fb.forceActive(forceLatest)) removeForce();
        else paintForce(forceLatest, forceLatest._u);
      }, 2500);
    }
    window.SK.fb.currentUser().then(function (u) {
      if (!u) return;
      if (forceUnsub) { try { forceUnsub(); } catch (e) { } }
      forceUnsub = window.SK.fb.watchForce(u.uid, function (f) {
        if (!f || !window.SK.fb.forceActive(f)) { forceLatest = null; removeForce(); return; }
        f._u = u;
        forceLatest = f;
        paintForce(f, u);
      });
    }).catch(function () { });
  }
  function removeForce() {
    var el = document.getElementById("force-block");
    if (!el) return;
    el.style.opacity = "0";
    setTimeout(function () { el.remove(); }, 220);
    document.body.classList.remove("force-locked");
    forceId = null;
  }
  function paintForce(f, u) {
    var active = window.SK.fb.forceActive(f);
    if (!active) { removeForce(); return; }
    var text = String(f.text || "(empty message)");
    var id = String(f.adminAt || 0) + ":" + text;
    var el = document.getElementById("force-block");
    if (!el) {
      el = document.createElement("div");
      el.id = "force-block"; el.className = "notice-block force-block";
      el.setAttribute("role", "alertdialog"); el.setAttribute("aria-modal", "true");
      el.innerHTML = '<div class="panel force-card">' +
        '<span class="kicker warm">Priority message</span>' +
        '<div class="force-head"><span class="ava admin lg">A</span><div><strong>Studio team</strong><div class="mono muted" style="font-size:.64rem">AVKINGS · STUDYKITEZ</div></div></div>' +
        '<h3 id="force-title" style="margin:.8rem 0 .2rem"></h3>' +
        '<p id="force-text" style="font-size:1.05rem;line-height:1.6;white-space:pre-wrap;margin:.9rem 0"></p>' +
        '<div class="mono muted" id="force-state" style="font-size:.7rem">Please read this message.</div>' +
        '<div style="display:flex;gap:.5rem;margin-top:1rem;flex-wrap:wrap">' +
        '<button class="btn btn-primary btn-sm" id="force-ack">I understand</button>' +
        '<a class="btn btn-ghost btn-sm" href="forcemsg.html">Open full page</a></div>' +
        '<p class="mono muted" style="font-size:.6rem;margin:.9rem 0 0">This notice stays until the admin closes it, its timer ends, or its view limit is reached.</p></div>';
      document.body.appendChild(el);
      document.body.classList.add("force-locked");
      el.querySelector("#force-ack").addEventListener("click", function () {
        window.SK.fb.ackForce(u.uid, f).then(function (r) {
          if (r && r.released) removeForce();
          else {
            el.querySelector("#force-state").textContent = "Message acknowledged — waiting for the admin to release you.";
            el.querySelector("#force-ack").disabled = true;
          }
        }).catch(function () {
          el.querySelector("#force-state").textContent = "Acknowledged. This message stays until the admin releases it.";
          el.querySelector("#force-ack").disabled = true;
        });
      });
      if (f.id && sstore("sk_force_view_" + f.id) !== "1") {
        sstore("sk_force_view_" + f.id, "1");
        window.SK.fb.bumpForceView(u.uid, f).catch(function () { });
      }
    }
    if (forceId !== id) {
      forceId = id;
      el.querySelector("#force-title").textContent = String(f.title || "A message for you");
      el.querySelector("#force-text").textContent = text;
      var exp = Number(f.expiresAt) || 0, max = Number(f.maxViews) || 0;
      var state = "Please read this message.";
      if (exp > 0) state += " · ends " + new Date(exp).toLocaleString("en-IN", { hour: "numeric", minute: "2-digit", day: "numeric", month: "short" });
      if (max > 0) state += " · " + Math.max(0, max - (window.SK.fb.forceViewCount(f) || 0)) + " view(s) left";
      el.querySelector("#force-state").textContent = state;
      var ack = el.querySelector("#force-ack");
      ack.disabled = false;
      el.querySelector(".force-card").classList.remove("anim-rise");
      void el.offsetWidth;
      el.querySelector(".force-card").classList.add("anim-rise");
    }
  }
  function ackForce() {
    var el = document.getElementById("force-block");
    if (!el) return;
    el.querySelector("#force-state").textContent = "Waiting for the admin…";
  }

  /* ---------------- devtools guard: 3 warnings -> auto-ban ---------------- */
  var guardStarted = false, guardHits = 0, guardWarned = false, guardKnown = false;
  function startGuard() {
    if (guardStarted || reduced()) return;
    guardStarted = true;
    if (shellAdmin || sstore("sk_guard_off") === "1") return;
    var baseW = window.outerWidth, baseH = window.outerHeight;
    var lastW = baseW, lastH = baseH;
    var timer = setInterval(function () {
      if (document.hidden) return;
      var w = window.outerWidth, h = window.outerHeight;
      var docked = Math.abs(w - lastW) > 150 || Math.abs(h - lastH) > 150;
      lastW = w; lastH = h;
      var t0 = 0, dt = 0;
      try { t0 = performance.now(); /* eslint-disable no-debugger */ debugger; dt = performance.now() - t0; } catch (e) { dt = 0; }
      var open = docked || dt > 260;
      if (open) guardHits++; else guardHits = Math.max(0, guardHits - 1);
      if (guardHits >= 2 && !guardWarned) {
        guardHits = 0;
        guardWarned = true;
        onDevtools();
        setTimeout(function () { guardWarned = false; }, 2500);
      }
    }, 1800);
    window.addEventListener("pagehide", function () { clearInterval(timer); });
  }
  async function onDevtools() {
    var u = shellUser;
    if (!u) { try { u = await window.SK.fb.currentUser(); } catch (e) { } }
    if (!u) return;
    if (isAdminPage() || shellAdmin) return;
    var localKey = "sk_strikes_" + u.uid;
    var localN = parseInt(store(localKey) || "0", 10) || 0;
    var res = null;
    try { res = await window.SK.fb.recordStrike(u.uid, "devtools"); } catch (e) { res = null; }
    var n = res && res.strikes ? res.strikes : Math.min(3, localN + 1);
    store(localKey, String(n));
    if ((res && res.banned) || n >= 3) {
      showGuardBan();
      return;
    }
    var m = modal(
      '<div style="text-align:center">' +
      '<span class="kicker" style="border-color:var(--danger);color:var(--danger)">Security warning ' + n + ' of 3</span>' +
      '<h3 style="margin:.6rem 0 .4rem">Developer tools detected</h3>' +
      '<p class="muted" style="margin:0;font-size:.9rem;line-height:1.55">StudiKitEZ protects lectures and notes. Opening developer tools on protected pages is recorded as a strike. ' +
      '<b style="color:var(--danger)">3 strikes suspends your account automatically.</b></p>' +
      '<button class="btn btn-primary btn-sm" id="guard-ok" style="margin-top:1rem">I understand</button></div>', { locked: true });
    m.querySelector("#guard-ok").addEventListener("click", function () { closeModal(); });
  }
  function showGuardBan() {
    var m = modal(
      '<div style="text-align:center">' +
      '<span class="kicker" style="border-color:var(--danger);color:var(--danger)">Account suspended</span>' +
      '<h3 style="margin:.6rem 0 .4rem">Too many security warnings</h3>' +
      '<p class="muted" style="margin:0;font-size:.9rem;line-height:1.55">Your account was automatically suspended after 3 developer-tools warnings. Contact support if you believe this is a mistake.</p>' +
      '<a class="btn btn-primary btn-sm" href="banned.html" style="margin-top:1rem">See details</a></div>', { locked: true });
    setTimeout(function () { location.href = "banned.html"; }, 1800);
    void m;
  }

  /* ---------------- reminders ---------------- */
  async function maybeRemind() {
    var u = shellUser || (await window.SK.fb.currentUser().catch(function () { return null; }));
    if (!u) return;
    if (sstore("sk_reminded") === "1") return;
    try {
      var d = await window.SK.fb.userDoc(u.uid);
      var prefs = (d && d.onboarding) || {};
      if (prefs.reminders === false) return;
      var st = (d && d.gamification && d.gamification.streak) || {};
      var today = window.SK.fb.dayKey();
      if (st.lastActiveDay === today) return;
      var hour = new Date().getHours();
      if (hour < 16) return;
      sstore("sk_reminded", "1");
      setTimeout(function () {
        toast("Keep your streak going", "One lesson today keeps " + (st.current || 0) + " day" + ((st.current || 0) === 1 ? "" : "s") + " going.");
      }, 4500);
    } catch (e) { }
  }

  /* ---------------- shell ---------------- */
  function initShell(opts) {
    opts = opts || {};
    if (opts.user) shellUser = opts.user;
    if (opts.admin !== undefined) shellAdmin = !!opts.admin;
    scrollProgress();
    revealObserver();
    mountBell();
    mountDock();
    watchForce();
    if (!shellReady) {
      shellReady = true;
      document.addEventListener("pointerdown", ripple, { passive: true });
      window.addEventListener("scroll", function () { if ($$(".reveal:not(.in)").length && window.__skRevealScan) window.__skRevealScan(); }, { passive: true });
      setTimeout(startGuard, 5000);
      setTimeout(maybeRemind, 6500);
    }
  }

  function nav() {
    var btn = document.getElementById("menu-btn"), menu = document.getElementById("mobile-menu");
    if (btn && menu) {
      btn.addEventListener("click", function () {
        var open = menu.classList.toggle("open");
        btn.setAttribute("aria-expanded", open ? "true" : "false");
      });
      $$("a", menu).forEach(function (a) { a.addEventListener("click", function () { menu.classList.remove("open"); }); });
    }
    injectLinks();
    gateNav();
    aiWidget();
    initShell({});
    if (window.SK.fb && typeof window.SK.fb.presenceBeat === "function") Promise.resolve(window.SK.fb.presenceBeat()).catch(function () { });
  }

  /* ---------------- boot / gate ---------------- */
  function nextUrl() { return encodeURIComponent(nextTarget()); }
  async function boot(opts) {
    opts = opts || {};
    splash(true, opts.status || "Verifying your session…");
    var user = null, admin = false;
    try { user = await window.SK.fb.currentUser(); } catch (e) { user = null; }
    if (!user && opts.login) {
      location.replace("login.html?next=" + nextUrl());
      throw new Error("redirect-login");
    }
    if (user) {
      shellUser = user;
      splash(true, "Checking account…");
      try { await window.SK.fb.banCheck(user.uid); }
      catch (e) {
        if (String(e.message).indexOf("BANNED:") === 0) { location.replace("banned.html"); throw e; }
      }
      if (opts.admin) {
        splash(true, "Checking access…");
        try { admin = await window.SK.fb.isAdmin(user.uid); } catch (e) { admin = false; }
        if (!admin) { location.replace("404.html?admin=1"); throw new Error("not-admin"); }
      }
      if (!opts.onboarding && !admin && !isAuthPage() && !isAdminPage()) {
        splash(true, "Checking your batches…");
        var prefs = null;
        try { prefs = await window.SK.fb.prefs(user.uid); } catch (e) { prefs = null; }
        if (prefs === false) {
          location.replace("onboarding.html?next=" + nextUrl());
          throw new Error("redirect-onboarding");
        }
      }
    }
    splash(false);
    initShell({ user: user, admin: admin });
    return { user: user, admin: admin };
  }
  async function gatePage(opts) {
    opts = opts || {};
    load(true);
    var user = null;
    try { user = await window.SK.fb.currentUser(); } catch (e) { user = null; }
    if (!user && !opts.allowGuest) {
      location.replace("login.html?next=" + nextUrl());
      throw new Error("redirect-login");
    }
    if (user) {
      try { await window.SK.fb.banCheck(user.uid); }
      catch (e) { if (String(e.message).indexOf("BANNED:") === 0) location.replace("banned.html"); }
    }
    load(false);
    initShell({ user: user });
    return { user: user };
  }

  /* ---------------- announcements ---------------- */
  var annQueue = [], annBusy = false;
  async function announcePopup() {
    try {
      var list = await window.SK.fb.announcements(8);
      if (!list.length) return;
      annQueue = list.filter(function (a) {
        try { return !localStorage.getItem("sk_ann_" + a.id); } catch (e) { return true; }
      });
      if (!annQueue.length) return;
      if (!annBusy) nextAnn();
    } catch (e) { }
  }
  function nextAnn() {
    if (!annQueue.length) { annBusy = false; return; }
    annBusy = true;
    var a = annQueue.shift();
    try { localStorage.setItem("sk_ann_" + a.id, "1"); } catch (e) { }
    var m = modal(
      '<span class="kicker">Announcement' + (annQueue.length ? " · " + (annQueue.length + 1) + " more" : "") + "</span>" +
      '<h3 style="margin:.5rem 0 .35rem">' + esc(a.title) + "</h3>" +
      '<p class="muted" style="margin:0;font-size:.95rem;line-height:1.55;white-space:pre-wrap"></p>' +
      '<div style="display:flex;gap:.6rem;margin-top:1.1rem;flex-wrap:wrap">' +
      (a.link ? '<a class="btn btn-primary btn-sm" id="ann-go">Open →</a>' : "") +
      '<button class="btn btn-ghost btn-sm" id="ann-x">' + (annQueue.length ? "Next →" : "Got it") + "</button></div>");
    m.querySelector("p").textContent = a.body || "";
    if (a.link) m.querySelector("#ann-go").addEventListener("click", function () { closeModal(); nextAnn(); location.href = a.link; });
    m.querySelector("#ann-x").addEventListener("click", function () { closeModal(); nextAnn(); });
  }

  /* ---------------- AI widget ---------------- */
  var aiS = { mode: "doubt", busy: false, lastAsk: 0, hist: [], user: null };
  function aiWidget() {
    if (document.getElementById("ai-bubble") || isAuthPage()) return;
    var b = document.createElement("button");
    b.id = "ai-bubble"; b.setAttribute("aria-label", "Ask StudiKitEZ AI");
    b.textContent = "AI";
    b.addEventListener("click", function () { toggleAiPanel(); });
    document.body.appendChild(b);
    b.hidden = true;
    window.SK.fb.currentUser().then(function (u) { aiS.user = u || null; b.hidden = !u; }).catch(function () { });
  }
  function aiContext() {
    var page = "";
    try { page = location.pathname.split("/").pop() + location.search; } catch (e) { }
    return { page: page.slice(0, 80), title: String(document.title || "").slice(0, 120) };
  }
  function toggleAiPanel(force) {
    var p = document.getElementById("ai-panel");
    if (!p) {
      p = document.createElement("div");
      p.id = "ai-panel"; p.className = "panel";
      p.setAttribute("role", "dialog"); p.setAttribute("aria-label", "StudiKitEZ AI");
      p.innerHTML =
        '<div class="row-head" style="justify-content:space-between;margin-bottom:.5rem">' +
        '<span class="kicker" style="margin:0"> Ask AI</span><button class="btn btn-ghost btn-sm" id="ai-x" aria-label="Close">×</button></div>' +
        '<div class="seg" id="ai-modes" style="flex-wrap:wrap">' +
        '<button data-m="doubt" class="on">Doubt</button><button data-m="explain">Explain</button>' +
        '<button data-m="notes">Notes</button><button data-m="summarize">Summarize</button></div>' +
        '<div id="ai-thread" style="margin-top:.6rem"></div>' +
        '<div id="ai-guest" style="display:none;margin-top:.6rem"><p class="muted" style="font-size:.82rem;margin:0 0 .6rem">Sign in to ask the AI anything.</p><a class="btn btn-primary btn-sm" id="ai-login">Sign in →</a></div>' +
        '<div id="ai-box" style="margin-top:.6rem"><button class="btn btn-secondary btn-sm btn-block" id="ai-sum" style="margin-bottom:.45rem"> Summarize this page</button>' +
        '<div style="display:flex;gap:.4rem"><input class="input" id="ai-in" maxlength="2000" placeholder="Ask anything…" aria-label="Ask AI" style="flex:1;font-size:.85rem" />' +
        '<button class="btn btn-primary btn-sm" id="ai-send" aria-label="Send">➤</button></div></div>';
      document.body.appendChild(p);
      p.querySelector("#ai-x").addEventListener("click", function () { p.classList.remove("open"); });
      p.querySelectorAll("#ai-modes button").forEach(function (x) {
        x.addEventListener("click", function () {
          p.querySelectorAll("#ai-modes button").forEach(function (y) { y.classList.toggle("on", y === x); });
          aiS.mode = x.dataset.m;
        });
      });
      p.querySelector("#ai-send").addEventListener("click", function () { aiAsk(); });
      p.querySelector("#ai-in").addEventListener("keydown", function (e) { if (e.key === "Enter") aiAsk(); });
      p.querySelector("#ai-sum").addEventListener("click", function () { aiAsk(true); });
      var gl = p.querySelector("#ai-login");
      if (gl) gl.href = "login.html?next=" + nextUrl();
    }
    var show = force !== undefined ? force : !p.classList.contains("open");
    p.classList.toggle("open", show);
    if (show) {
      var has = !!aiS.user;
      p.querySelector("#ai-guest").style.display = has ? "none" : "block";
      p.querySelector("#ai-box").style.display = has ? "block" : "none";
      if (!has) {
        window.SK.fb.currentUser().then(function (u) {
          aiS.user = u || null;
          if (aiS.user) { p.querySelector("#ai-guest").style.display = "none"; p.querySelector("#ai-box").style.display = "block"; }
        }).catch(function () { });
      }
      var inp = p.querySelector("#ai-in");
      if (inp && has) inp.focus();
    }
  }
  function aiBubble(who, text) {
    var host = document.getElementById("ai-thread");
    if (!host) return;
    var el = document.createElement("div");
    el.className = "chat-row" + (who === "you" ? " mine" : "");
    el.innerHTML = '<div class="bubble"><span></span></div>';
    el.querySelector("span").textContent = text;
    host.appendChild(el);
    host.scrollTop = host.scrollHeight;
  }
  async function aiAsk(summarize) {
    if (aiS.busy) return;
    if (!aiS.user) {
      try { aiS.user = await window.SK.fb.currentUser(); } catch (e) { aiS.user = null; }
      if (!aiS.user) { toggleAiPanel(true); toast("Sign in required", "Sign in to use the AI"); return; }
    }
    var inp = document.getElementById("ai-in");
    var text = summarize ? ("Summarize this for me: " + (document.title || location.pathname)) : (inp ? inp.value.trim() : "");
    if (!text) return;
    if (Date.now() - aiS.lastAsk < 6000) { toast("Slow down", "One question every 6 seconds"); return; }
    aiS.lastAsk = Date.now();
    aiS.busy = true;
    var mode = summarize ? "summarize" : aiS.mode;
    aiBubble("you", text);
    aiS.hist.push({ role: "user", content: text });
    if (inp) inp.value = "";
    var host = document.getElementById("ai-thread");
    var wait = document.createElement("div");
    wait.className = "chat-row";
    wait.innerHTML = '<div class="bubble"><span class="ai-typing"><span></span><span></span><span></span></span></div>';
    host.appendChild(wait); host.scrollTop = host.scrollHeight;
    try {
      var headers = await window.SK.fb.authHeaders().catch(function () { return {}; });
      var reply = await window.SK.api.aiChat(text, mode, aiS.hist.slice(0, -1).slice(-6), headers, aiContext());
      aiS.hist.push({ role: "assistant", content: reply });
      aiS.hist = aiS.hist.slice(-12);
      wait.remove(); aiBubble("ai", reply);
    } catch (e) {
      wait.remove(); toast("AI failed", (e && e.message) || "Try again in a bit");
    }
    aiS.busy = false;
  }

  function skeleton(host, rows) {
    if (!host) return;
    host.innerHTML = "";
    for (var i = 0; i < (rows || 6); i++) {
      var d = document.createElement("div");
      d.className = "bcard";
      d.innerHTML = '<div class="thumb skel" style="min-height:120px"></div><div class="body"><div class="skel"></div><div class="skel" style="width:60%"></div></div>';
      host.appendChild(d);
    }
  }
  function countUp(el, target, dur) {
    if (!el) return;
    target = Math.max(0, Math.round(Number(target) || 0));
    if (reduced()) { el.textContent = target; return; }
    var start = null, D = dur || 800;
    function step(ts) {
      if (!document.body.contains(el)) return;
      if (!start) start = ts;
      var p = Math.min(1, (ts - start) / D), e = 1 - Math.pow(1 - p, 3);
      el.textContent = Math.round(target * e);
      if (p < 1) requestAnimationFrame(step);
    }
    requestAnimationFrame(step);
  }

  return {
    esc: esc, toast: toast, nav: nav, gateNav: gateNav, gatePage: gatePage, boot: boot,
    reveal: reveal, botUrl: botUrl, telegram: telegram, telegramNag: telegramNag,
    announcePopup: announcePopup, modal: modal, closeModal: closeModal, authArea: authArea,
    skeleton: skeleton, load: load, countUp: countUp, confetti: confetti, initShell: initShell,
    courseSlug: courseSlug, courseUrl: courseUrl,
    refreshBell: refreshBell, openNoticePanel: openNoticePanel, timeAgo: timeAgo,
    page: PAGE, isAuthPage: isAuthPage
  };
})();
