/* Shared UI: toasts, nav, auth area, telegram widget. No popups, no tracking. */
window.SK = window.SK || {};
window.SK.ui = (function () {
  function esc(s) {
    return String(s === null || s === undefined ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }
  function toast(title, msg) {
    var root = document.getElementById("toast-root");
    if (!root) return;
    var el = document.createElement("div");
    el.className = "toast"; el.setAttribute("role", "status");
    el.innerHTML = "<b></b><p></p>";
    el.querySelector("b").textContent = title;
    el.querySelector("p").textContent = msg || "";
    root.appendChild(el);
    setTimeout(function () { el.remove(); }, 3600);
  }
  function nav() {
    var btn = document.getElementById("menu-btn"), menu = document.getElementById("mobile-menu");
    if (btn && menu) {
      btn.addEventListener("click", function () {
        var open = menu.classList.toggle("open");
        btn.setAttribute("aria-expanded", open ? "true" : "false");
      });
      menu.querySelectorAll("a").forEach(function (a) {
        a.addEventListener("click", function () { menu.classList.remove("open"); });
      });
    }
    injectLinks();
    gateNav();
    try { window.SK.fb.presenceBeat(); } catch (e) {}
    watchForce();
  }
  /* Inject Posts (everyone) + Messages/Generate (signed-in) + Admin (admins). */
  function injectLinks() {
    [".nav-links", "#mobile-menu"].forEach(function (sel) {
      var host = document.querySelector(sel);
      if (!host || host.querySelector('a[href="posts.html"]')) return;
      var anchor = host.querySelector('a[href="index.html"]');
      var posts = document.createElement("a");
      posts.href = "posts.html"; posts.textContent = "Posts";
      var msgs = document.createElement("a");
      msgs.href = "msgs.html"; msgs.textContent = "Messages";
      var gen = document.createElement("a");
      gen.href = "generate.html"; gen.textContent = "✨ AI";
      if (anchor) { host.insertBefore(posts, anchor.nextSibling); host.insertBefore(msgs, posts.nextSibling); host.insertBefore(gen, msgs.nextSibling); }
      else { host.appendChild(posts); host.appendChild(msgs); host.appendChild(gen); }
    });
    window.SK.fb.currentUser().then(function (u) {
      if (!u) return;
      return window.SK.fb.isAdmin(u.uid).then(function (ok) {
        if (!ok) return;
        document.querySelectorAll(".nav-links, #mobile-menu").forEach(function (host) {
          if (host.querySelector('a[href="admin.html"]')) return;
          var a = document.createElement("a");
          a.href = "admin.html"; a.textContent = "Admin";
          host.appendChild(a);
        });
      });
    }).catch(function () {});
  }
  /* Guests never see Dashboard / Focus / Messages / AI links anywhere. */
  function gateNav() {
    window.SK.fb.currentUser().then(function (u) {
      rewriteTelegramLinks(u);
      if (u) return;
      document.querySelectorAll('a[href="dashboard.html"], a[href="focus.html"], a[href="msgs.html"], a[href="generate.html"]').forEach(function (a) {
        a.style.display = "none";
      });
    }).catch(function () {});
  }
  /* Every Telegram link on the site points at the bot. Logged-in users get a
     deep link so the bot knows them: /vme {userid} via ?start=vme_{userid}. */
  function botUrl(u) {
    var base = (window.__SK__ && window.__SK__.telegramUrl) || "https://t.me/Studikitesbot";
    if (!u || !u.uid) return base;
    var tag = "vme_" + String(u.uid).replace(/[^A-Za-z0-9_]/g, "").slice(0, 48);
    return base.replace(/\/+$/, "") + "?start=" + tag;
  }
  function rewriteTelegramLinks(u) {
    var url = botUrl(u);
    if (window.__SK__) window.__SK__.telegramUrl = url;
    document.querySelectorAll('a[href*="t.me/"]').forEach(function (a) {
      try { a.href = url; } catch (e) {}
    });
  }
  /* Force-message relay: if an admin has an active force msg for this user,
     every page bounces them to forcemsg.html until released. */
  function watchForce() {
    window.SK.fb.currentUser().then(function (u) {
      if (!u) return;
      if (location.pathname.indexOf("forcemsg.html") >= 0) return;
      window.SK.fb.watchForce(u.uid, function (f) {
        if (window.SK.fb.forceActive(f)) location.href = "forcemsg.html";
      });
    }).catch(function () {});
  }
  /* Announcement popup — every unseen announcement, one after another. */
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
    } catch (e) {}
  }
  function nextAnn() {
    if (!annQueue.length) { annBusy = false; return; }
    annBusy = true;
    var a = annQueue.shift();
    try { localStorage.setItem("sk_ann_" + a.id, "1"); } catch (e) {}
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
  /* Telegram nag — asks to join on every page view (dismiss lasts this visit). */
  function telegramNag() {
    if (document.querySelector(".modal-card")) { setTimeout(telegramNag, 6000); return; }
    var dismissed = false;
    try { dismissed = sessionStorage.getItem("sk_tg_nag") === "1"; } catch (e) {}
    if (dismissed) return;
    setTimeout(function () {
      if (document.querySelector(".modal-card")) { setTimeout(telegramNag, 6000); return; }
      var url = (window.__SK__ && window.__SK__.telegramUrl) || "https://t.me/Studikitesbot";
      var m = modal(
        '<span class="kicker">Stay updated</span><h3 style="margin:.5rem 0 .35rem">Join our Telegram</h3>' +
        '<p class="muted" style="margin:0;font-size:.95rem;line-height:1.55">New batches, live classes and exam alerts — pushed instantly to the channel.</p>' +
        '<div style="display:flex;gap:.6rem;margin-top:1.1rem;flex-wrap:wrap">' +
        '<a class="btn btn-primary btn-sm" id="tg-join" target="_blank" rel="noopener">Join channel →</a>' +
        '<button class="btn btn-ghost btn-sm" id="tg-x">Not now</button></div>');
      m.querySelector("#tg-join").href = url;
      m.querySelector("#tg-x").addEventListener("click", function () {
        try { sessionStorage.setItem("sk_tg_nag", "1"); } catch (e) {}
        closeModal();
      });
    }, 7000);
  }
  var modalHost = null;
  function modal(html) {
    closeModal();
    modalHost = document.createElement("div");
    modalHost.className = "modal anim-rise";
    modalHost.setAttribute("role", "dialog");
    modalHost.setAttribute("aria-modal", "true");
    modalHost.innerHTML = '<div class="modal-card panel">' + html + "</div>";
    modalHost.addEventListener("click", function (e) { if (e.target === modalHost) closeModal(); });
    document.body.appendChild(modalHost);
    return modalHost;
  }
  function closeModal() {
    if (modalHost && modalHost.parentNode) modalHost.remove();
    modalHost = null;
  }
  /* Full-screen boot splash (brand pulse + shimmer bar — never a spinner).
     Every page shows this FIRST and reveals content only after the user,
     ban state, subscription and (for admin pages) role are all verified,
     so gated skeletons never flash for a split second. */
  var booted = false, splashTimer = null;
  function splash(show, status) {
    var el = document.getElementById("boot-splash");
    if (show) {
      if (!el) {
        el = document.createElement("div");
        el.id = "boot-splash";
        el.setAttribute("aria-hidden", "true");
        el.innerHTML = '<div class="splash-card"><span class="splash-mark">S</span>' +
          '<div class="splash-name">StudiKitEZ</div>' +
          '<div class="splash-bar"><span></span></div>' +
          '<div class="splash-status mono"></div></div>';
        document.body.appendChild(el);
      }
      el.classList.add("on");
      var st = el.querySelector(".splash-status");
      if (st && status) st.textContent = status;
      if (splashTimer) clearTimeout(splashTimer);
      splashTimer = setTimeout(function () { splash(false); }, 20000);
      return;
    }
    if (splashTimer) { clearTimeout(splashTimer); splashTimer = null; }
    if (el) el.classList.remove("on");
    booted = true;
  }
  function reveal() { splash(false); }
  /* opts: { login, admin, status } — resolves after verification. */
  async function boot(opts) {
    opts = opts || {};
    splash(true, opts.status || "Verifying your session…");
    var user = null, adFree = false, admin = false;
    try { user = await window.SK.fb.currentUser(); } catch (e) { user = null; }
    if (!user && opts.login) {
      location.href = "login.html?next=" + encodeURIComponent(location.pathname.split("/").pop() + location.search);
      throw new Error("redirect-login");
    }
    if (user) {
      splash(true, "Checking account…");
      try { await window.SK.fb.banCheck(user.uid); }
      catch (e) {
        if (String(e.message).indexOf("BANNED:") === 0) { location.href = "banned.html"; throw e; }
        /* transient read failure: don't strand the user, continue */
      }
      if (opts.admin) {
        splash(true, "Checking access…");
        try { admin = await window.SK.fb.isAdmin(user.uid); } catch (e) { admin = false; }
        if (!admin) { location.href = "404.html"; throw new Error("not-admin"); }
      }
      try { adFree = await window.SK.ads.adFree(); } catch (e) { adFree = false; }
    }
    splash(false);
    return { user: user, adFree: adFree, admin: admin };
  }
  /* Shared page boot: loader on, login check, ban check, ad-free check.
     strict=false redirects guests to login; strict pages pass allowGuest. */
  async function gatePage(opts) {
    opts = opts || {};
    load(true);
    var user = null, adFree = false;
    try { user = await window.SK.fb.currentUser(); } catch (e) { user = null; }
    if (!user && !opts.allowGuest) {
      location.href = "login.html?next=" + encodeURIComponent(location.pathname.split("/").pop() + location.search);
      throw new Error("redirect-login");
    }
    if (user) {
      try { await window.SK.fb.banCheck(user.uid); }
      catch (e) {
        if (String(e.message).indexOf("BANNED:") === 0) { location.href = "banned.html"; throw e; }
      }
      try { adFree = await window.SK.ads.adFree(); } catch (e) { adFree = false; }
    }
    load(false);
    return { user: user, adFree: adFree };
  }
  function telegram() {
    if (document.getElementById("tg-widget")) return;
    var w = document.createElement("div");
    w.className = "tg-widget"; w.id = "tg-widget";
    w.innerHTML = '<span>Study updates on <a href="https://t.me/Studikitesbot" target="_blank" rel="noopener">Telegram</a></span><button aria-label="Dismiss">×</button>';
    w.querySelector("a").href = (window.__SK__ && window.__SK__.telegramUrl) || "https://t.me/Studikitesbot";
    w.querySelector("button").addEventListener("click", function () { w.remove(); });
    document.body.appendChild(w);
  }
  async function authArea() {
    var host = document.getElementById("auth-area");
    if (!host) return;
    var u = null;
    try { u = await window.SK.fb.currentUser(); } catch (e) { u = null; }
    host.innerHTML = "";
    if (u) {
      var a = document.createElement("a");
      a.className = "btn btn-secondary btn-sm"; a.href = "dashboard.html";
      a.textContent = u.displayName || u.email || "Dashboard";
      host.appendChild(a);
      var out = document.createElement("button");
      out.className = "btn btn-ghost btn-sm"; out.textContent = "Sign out";
      out.addEventListener("click", function () {
        window.SK.fb.signOut().then(function () { location.href = "index.html"; });
      });
      host.appendChild(out);
    } else {
      var s = document.createElement("a");
      s.className = "btn btn-primary btn-sm";
      s.href = "login.html?next=" + encodeURIComponent(location.pathname.split("/").pop() + location.search);
      s.textContent = "Sign in";
      host.appendChild(s);
    }
  }
  function skeleton(host, rows) {    if (!host) return;
    host.innerHTML = "";
    for (var i = 0; i < (rows || 6); i++) {
      var d = document.createElement("div");
      d.className = "bcard";
      d.innerHTML = '<div class="thumb skel" style="min-height:120px"></div><div class="body"><div class="skel"></div><div class="skel" style="width:60%"></div></div>';
      host.appendChild(d);
    }
  }
  var loadCount = 0;
  function load(on) {
    var bar = document.getElementById("top-loader");
    if (!bar) {
      bar = document.createElement("div");
      bar.id = "top-loader";
      bar.setAttribute("aria-hidden", "true");
      document.body.prepend(bar);
    }
    loadCount = Math.max(0, loadCount + (on ? 1 : -1));
    bar.classList.toggle("on", loadCount > 0);
  }
  function countUp(el, target, dur) {
    if (!el) return;
    target = Math.max(0, Math.round(Number(target) || 0));
    try {
      if (window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches) { el.textContent = target; return; }
    } catch (e) {}
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
  return { esc: esc, toast: toast, nav: nav, gateNav: gateNav, gatePage: gatePage, boot: boot, reveal: reveal, botUrl: botUrl, telegram: telegram, telegramNag: telegramNag, announcePopup: announcePopup, modal: modal, closeModal: closeModal, authArea: authArea, skeleton: skeleton, load: load, countUp: countUp };
})();
