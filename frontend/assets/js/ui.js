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
    gateNav();
  }
  /* Guests never see Dashboard / Focus Rooms links anywhere. */
  function gateNav() {
    window.SK.fb.currentUser().then(function (u) {
      if (u) return;
      document.querySelectorAll('a[href="dashboard.html"], a[href="focus.html"]').forEach(function (a) {
        a.style.display = "none";
      });
    }).catch(function () {});
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
    w.innerHTML = '<span>Study updates on <a href="https://t.me/studikitez" target="_blank" rel="noopener">Telegram</a></span><button aria-label="Dismiss">×</button>';
    w.querySelector("a").href = (window.__SK__ && window.__SK__.telegramUrl) || "https://t.me/studikitez";
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
  return { esc: esc, toast: toast, nav: nav, gateNav: gateNav, gatePage: gatePage, telegram: telegram, authArea: authArea, skeleton: skeleton, load: load, countUp: countUp };
})();
