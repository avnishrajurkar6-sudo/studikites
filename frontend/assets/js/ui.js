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
    aiWidget();
    try { window.SK.fb.presenceBeat(); } catch (e) {}
    watchForce();
  }
  /* Inject Posts (everyone) + Messages (signed-in) + Admin (admins). */
  function injectLinks() {
    [".nav-links", "#mobile-menu"].forEach(function (sel) {
      var host = document.querySelector(sel);
      if (!host || host.querySelector('a[href="posts.html"]')) return;
      var anchor = host.querySelector('a[href="index.html"]');
      var posts = document.createElement("a");
      posts.href = "posts.html"; posts.textContent = "Posts";
      var msgs = document.createElement("a");
      msgs.href = "msgs.html"; msgs.textContent = "Messages";
      if (anchor) { host.insertBefore(posts, anchor.nextSibling); host.insertBefore(msgs, posts.nextSibling); }
      else { host.appendChild(posts); host.appendChild(msgs); }
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
      document.querySelectorAll('a[href="dashboard.html"], a[href="focus.html"], a[href="msgs.html"]').forEach(function (a) {
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
  /* Floating AI assistant — hovers on every page, answers site + study queries,
     summarizes the current topic/video/PDF. Sign-in required to ask. */
  var aiS = { mode: "doubt", busy: false, lastAsk: 0, hist: [], user: null };
  function aiWidget() {
    if (document.getElementById("ai-bubble")) return;
    var b = document.createElement("button");
    b.id = "ai-bubble"; b.setAttribute("aria-label", "Ask StudiKitEZ AI");
    b.innerHTML = '<span class="bear mini" aria-hidden="true"><span class="ear l"></span><span class="ear r"></span><span class="head"></span><span class="eye l"></span><span class="eye r"></span><span class="muzzle"></span><span class="book"><span class="page"></span></span></span>';
    b.addEventListener("click", function () { toggleAiPanel(); });
    document.body.appendChild(b);
    window.SK.fb.currentUser().then(function (u) { aiS.user = u || null; }).catch(function () {});
  }
  function aiContext() {
    var page = "";
    try { page = location.pathname.split("/").pop() + location.search; } catch (e) {}
    return { page: page.slice(0, 80), title: String(document.title || "").slice(0, 120) };
  }
  function toggleAiPanel(force) {
    var p = document.getElementById("ai-panel");
    if (!p) {
      p = document.createElement("div");
      p.id = "ai-panel";
      p.className = "panel";
      p.setAttribute("role", "dialog");
      p.setAttribute("aria-label", "StudiKitEZ AI");
      p.innerHTML =
        '<div class="row-head" style="justify-content:space-between;margin-bottom:.5rem">' +
          '<span class="kicker" style="margin:0">✨ Ask AI</span>' +
          '<button class="btn btn-ghost btn-sm" id="ai-x" aria-label="Close">×</button></div>' +
        '<div class="seg" id="ai-modes" style="flex-wrap:wrap">' +
          '<button data-m="doubt" class="on">Doubt</button>' +
          '<button data-m="explain">Explain</button>' +
          '<button data-m="notes">Notes</button>' +
          '<button data-m="summarize">Summarize</button></div>' +
        '<div id="ai-thread" style="margin-top:.6rem"></div>' +
        '<div id="ai-guest" style="display:none;margin-top:.6rem"><p class="muted" style="font-size:.82rem;margin:0 0 .6rem">Sign in to ask the AI anything.</p>' +
          '<a class="btn btn-primary btn-sm" id="ai-login">Sign in →</a></div>' +
        '<div id="ai-box" style="margin-top:.6rem">' +
          '<button class="btn btn-secondary btn-sm btn-block" id="ai-sum" style="margin-bottom:.45rem">📄 Summarize this page</button>' +
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
      if (gl) gl.href = "login.html?next=" + encodeURIComponent(location.pathname.split("/").pop() + location.search);
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
        }).catch(function () {});
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
    if (Date.now() - aiS.lastAsk < 8000) { toast("Slow down", "One question every 8 seconds"); return; }
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
    host.appendChild(wait);
    host.scrollTop = host.scrollHeight;
    try {
      var headers = await window.SK.fb.authHeaders().catch(function () { return {}; });
      var reply = await window.SK.api.aiChat(text, mode, aiS.hist.slice(0, -1).slice(-6), headers, aiContext());
      aiS.hist.push({ role: "assistant", content: reply });
      aiS.hist = aiS.hist.slice(-12);
      wait.remove();
      aiBubble("ai", reply);
    } catch (e) {
      wait.remove();
      toast("AI failed", (e && e.message) || "Try again in a bit");
    }
    aiS.busy = false;
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
    if (show) {
      try { document.body.classList.add("booting"); } catch (e) {}
      var el = document.getElementById("boot-splash");
      if (!el) {
        el = document.createElement("div");
        el.id = "boot-splash";
        el.setAttribute("aria-hidden", "true");
        el.innerHTML = '<div class="splash-card"><div class="bear" aria-hidden="true">' +
          '<span class="ear l"></span><span class="ear r"></span>' +
          '<span class="head"></span>' +
          '<span class="eye l"></span><span class="eye r"></span>' +
          '<span class="muzzle"></span>' +
          '<span class="book"><span class="page"></span></span></div>' +
          '<div class="splash-name">StudiKitEZ</div>' +
          '<div class="splash-bar"><span></span></div>' +
          '<div class="splash-status mono"></div></div>';
        var main = document.querySelector("main");
        if (main) main.prepend(el); else document.body.appendChild(el);
      }
      var st = el.querySelector(".splash-status");
      if (st && status) st.textContent = status;
      if (splashTimer) clearTimeout(splashTimer);
      splashTimer = setTimeout(function () { splash(false); }, 20000);
      return;
    }
    if (splashTimer) { clearTimeout(splashTimer); splashTimer = null; }
    try { document.body.classList.remove("booting"); } catch (e) {}
    var gone = document.getElementById("boot-splash");
    if (gone) gone.remove();
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
