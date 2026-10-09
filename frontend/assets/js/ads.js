/* Display ads only: responsive AdSense units, gated by subscription/freeUntil.
   No popunders, no social bars, no smartlinks, no ad floods. */
window.SK = window.SK || {};
window.SK.ads = (function () {
  var checked = null, loader = null;

  async function adFree() {
    if (checked !== null) return checked;
    try {
      var u = await window.SK.fb.currentUser();
      if (!u) { checked = false; return checked; }
      var d = await window.SK.fb.userDoc(u.uid);
      var sub = (d && d.subscription) || null;
      var active = !!(sub && sub.active === true && (sub.expiry === null || sub.expiry === undefined || sub.expiry > Date.now()));
      var freeUntil = (d && d.freeUntil) || 0;
      checked = active || (typeof freeUntil === "number" && freeUntil > Date.now());
    } catch (e) { checked = false; }
    return checked;
  }
  function loadScript(client) {
    if (loader) return loader;
    loader = new Promise(function (resolve) {
      if (!client) return resolve(false);
      if (document.querySelector('script[src*="pagead2.googlesyndication.com"]')) return resolve(true);
      var s = document.createElement("script");
      s.async = true; s.crossOrigin = "anonymous";
      s.src = "https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=" + client;
      s.onload = function () { resolve(true); };
      s.onerror = function () { resolve(false); };
      setTimeout(function () { resolve(!!window.adsbygoogle); }, 4000);
      document.head.appendChild(s);
    });
    return loader;
  }
  async function render() {
    var slots = document.querySelectorAll(".ad-slot[data-ad]");
    if (!slots.length) return;
    var free = await adFree();
    var cfg = null;
    try { cfg = await window.SK.api.getConfig(); } catch (e) { cfg = null; }
    if (free || !cfg || !cfg.ADSENSE_CLIENT) {
      slots.forEach(function (s) { s.style.display = "none"; });
      return;
    }
    var ok = await loadScript(cfg.ADSENSE_CLIENT);
    if (!ok) return;
    slots.forEach(function (host) {
      if (host.dataset.done) return;
      host.dataset.done = "1";
      var kind = host.dataset.ad || "banner";
      var slot = (cfg.ADSENSE_SLOTS && cfg.ADSENSE_SLOTS[kind]) || cfg.ADSENSE_SLOTS.banner;
      if (!slot) { host.style.display = "none"; return; }
      var ins = document.createElement("ins");
      ins.className = "adsbygoogle"; ins.style.display = "block";
      ins.setAttribute("data-ad-client", cfg.ADSENSE_CLIENT);
      ins.setAttribute("data-ad-slot", slot);
      if (kind === "feed") {
        ins.setAttribute("data-ad-format", "fluid");
        if (cfg.ADSENSE_FEED_KEY) ins.setAttribute("data-ad-layout-key", cfg.ADSENSE_FEED_KEY);
      } else if (kind === "inarticle") {
        ins.setAttribute("data-ad-format", "fluid");
        ins.setAttribute("data-ad-layout", "in-article");
      } else if (kind === "multiplex") {
        ins.setAttribute("data-ad-format", "autorelaxed");
      } else {
        ins.setAttribute("data-ad-format", "auto");
        ins.setAttribute("data-full-width-responsive", "true");
      }
      host.appendChild(ins);
      try { (window.adsbygoogle = window.adsbygoogle || []).push({}); } catch (e) {}
    });
  }
  return { render: render, adFree: adFree };
})();
