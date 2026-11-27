/* StudiKitEZ API layer — the browser only calls stable /api/* routes.
   Vendor URLs and admin allowlists live in backend env, never here.
   AVkings engine · v2 */
window.SK = window.SK || {};
window.SK.api = (function () {
  function base() { return (window.__SK__ && window.__SK__.backendBaseUrl) || ""; }

  async function req(method, path, opts) {
    opts = opts || {};
    var url = base() + path;
    if (opts.params) {
      var qs = new URLSearchParams(opts.params).toString();
      if (qs) url += (url.indexOf("?") >= 0 ? "&" : "?") + qs;
    }
    var c = new AbortController();
    var timer = setTimeout(function () { c.abort(); }, opts.timeout || 20000);
    try {
      var res = await fetch(url, {
        method: method,
        headers: Object.assign(
          { Accept: "application/json" },
          opts.body !== undefined ? { "Content-Type": "application/json" } : {},
          opts.headers || {}
        ),
        body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
        signal: c.signal,
        credentials: "omit",
        cache: "no-store"
      });
      var text = await res.text();
      var json = null;
      try { json = text ? JSON.parse(text) : null; } catch (e) { json = null; }
      if (!res.ok || !json) {
        var msg = (json && (json.error || json.message || json.reason)) || ("HTTP " + res.status);
        if (msg && typeof msg === "object") msg = msg.message || ("HTTP " + res.status);
        var err = new Error(String(msg));
        err.status = res.status;
        err.code = (json && json.code) || "";
        err.detail = (json && json.detail) || "";
        err.retryable = res.status === 429 || res.status >= 502;
        throw err;
      }
      return json;
    } catch (e) {
      if (e && e.name === "AbortError") {
        var te = new Error("Request timed out"); te.status = 504; te.retryable = true; throw te;
      }
      if (e && e.status) throw e;
      var ne = new Error("Network unavailable"); ne.status = 0; ne.retryable = true; throw ne;
    } finally { clearTimeout(timer); }
  }

  var configCache = null;
  async function getConfig(force) {
    if (configCache && !force) return configCache;
    configCache = await req("GET", "/api/config");
    return configCache;
  }

  /* Backend-first catalog with a durable local snapshot so the site always
     renders, even when the vendor feed is down. */
  var catalogCache = null;
  async function catalog(force) {
    if (catalogCache && !force) return catalogCache;
    try {
      var j = await req("GET", "/api/courses/batches", { params: force ? { refresh: "1", _t: String(Date.now()) } : {} });
      var data = (j && Array.isArray(j.new)) ? j : null;
      if (!data || !data.new.length) throw new Error("empty catalog");
      catalogCache = data;
      try { localStorage.setItem("sk_catalog", JSON.stringify(data)); } catch (e) {}
      return data;
    } catch (e) {
      try {
        var cached = JSON.parse(localStorage.getItem("sk_catalog") || "null");
        if (cached && Array.isArray(cached.new) && cached.new.length) { catalogCache = cached; return cached; }
      } catch (e2) {}
      var res = await fetch((window.__SK__ && window.__SK__.batchesUrl) || "batches.json", { cache: "no-store" });
      if (!res.ok) throw new Error("Catalog unavailable");
      catalogCache = await res.json();
      return catalogCache;
    }
  }
  async function allBatches(force) {
    var c = await catalog(force);
    var seen = {}, out = [];
    [].concat(c.new || [], c.old || []).forEach(function (b) {
      var id = String(b && b.id || "");
      if (!id || seen[id]) return;
      seen[id] = 1;
      out.push({ id: id, title: String(b.title || ""), thumbnail: String(b.thumbnail || "") });
    });
    return out;
  }

  function content(courseId, folderId) {
    var attempts = 0, maxAttempts = 3;
    function attempt() {
      return req("GET", "/api/courses/content", {
        params: { content: String(courseId), folder: String(folderId || "0"), _t: String(Date.now()) }
      }).then(function (j) {
        var data = Array.isArray(j.data) ? j.data : (Array.isArray(j) ? j : null);
        if (!data) throw new Error("Content API returned an unexpected shape");
        return data;
      }).catch(function (e) {
        attempts++;
        if (e.retryable && attempts < maxAttempts) {
          return new Promise(function (r) { setTimeout(r, attempts * 1200); }).then(attempt);
        }
        throw e;
      });
    }
    return attempt();
  }

  function play(courseId, contentId, key, deviceId, headers, vdcId, title, forceRefresh) {
    var attempts = 0, maxAttempts = 3;
    function attempt(refresh) {
      var params = {
        course_id: String(courseId || ""),
        content_id: String(contentId || ""),
        key: key,
        device_id: deviceId,
        vdc_id: vdcId || "",
        title: title || ""
      };
      if (refresh || forceRefresh) params.refresh = "1";
      params._t = String(Date.now());
      return req("GET", "/api/media/play", { params: params, headers: headers })
        .then(function (j) {
          var data = j.decryptedData || j;
          if (!data || !data.file_url) throw new Error((j && j.error) || "No media link returned");
          return data;
        }).catch(function (e) {
          attempts++;
          if (e.retryable && attempts < maxAttempts) {
            return new Promise(function (r) { setTimeout(r, attempts * 1200); }).then(function () { return attempt(true); });
          }
          throw e;
        });
    }
    return attempt(false);
  }

  function live(courseId, type, key, deviceId, headers) {
    return req("GET", "/api/media/live", {
      params: { course_id: String(courseId), type: String(type || "1"), key: key, device_id: deviceId },
      headers: headers
    }).then(function (j) { return Array.isArray(j.data) ? j.data : []; });
  }

  function sendOtp(mobile, deviceId) { return req("POST", "/api/auth/send-otp", { body: { mobile: mobile, deviceId: deviceId } }); }
  function verifyOtp(mobile, otp, deviceId) { return req("POST", "/api/auth/verify-otp", { body: { mobile: mobile, otp: otp, deviceId: deviceId } }); }
  function isAdmin(headers) { return req("POST", "/api/auth/is-admin", { headers: headers, body: {}, timeout: 10000 }); }
  async function createTelegramLink(headers) {
    headers = headers || (window.SK.fb ? await window.SK.fb.authHeaders().catch(function () { return {}; }) : {});
    return req("POST", "/api/telegram/link", {
      headers: headers,
      body: { action: "create" },
      timeout: 12000
    });
  }
  function phoneProfile(action, data) {
    var session = window.SK.fb && window.SK.fb.phoneSession();
    if (!session) return Promise.reject(new Error("Phone sign-in required"));
    var headers = { "x-sk-session": session };
    if (action === "get" || action === "inbox") {
      return req("GET", "/api/auth/profile", {
        params: action === "inbox" ? { action: "inbox", limit: String((data && data.limit) || 30) } : {},
        headers: headers
      });
    }
    return req("POST", "/api/auth/profile", {
      headers: headers,
      body: Object.assign({}, data || {}, { action: action })
    });
  }
  function aiChat(prompt, mode, history, headers, context) {
    return req("POST", "/api/ai/chat", {
      body: { prompt: prompt, mode: mode, history: history || [], context: context || {} },
      headers: headers, timeout: 30000
    }).then(function (j) {
      if (!j.reply) throw new Error(j.error || "AI gave no answer");
      return j.reply;
    });
  }
  function brand() { return req("GET", "/api/avkings"); }

  /* Free preview: first file at root, else first file one folder down. */
  async function freePreviewId(courseId) {
    var ck = "sk_free_" + courseId, cached = null;
    try { cached = sessionStorage.getItem(ck); } catch (e) {}
    if (cached) return cached;
    var root = await content(courseId, "0");
    var f = root.find(function (x) { return x.type === "file"; }) || null;
    if (!f) {
      var folder = root.find(function (x) { return x.type === "folder"; });
      if (folder) {
        var sub = await content(courseId, String(folder.entity_id));
        f = sub.find(function (x) { return x.type === "file"; }) || null;
      }
    }
    var id = f ? String(f.entity_id) : null;
    try { if (id) sessionStorage.setItem(ck, id); } catch (e) {}
    return id;
  }
  async function isFreePreview(courseId, contentId) {
    if (!courseId || !contentId) return false;
    try { return String(await freePreviewId(courseId)) === String(contentId); } catch (e) { return false; }
  }

  function deviceId() {
    try {
      var id = localStorage.getItem("sk_device_id");
      if (!id) {
        id = (crypto.randomUUID && crypto.randomUUID()) || ("dev-" + Date.now() + "-" + Math.random().toString(36).slice(2));
        localStorage.setItem("sk_device_id", id);
      }
      return id;
    } catch (e) { return "dev-fallback"; }
  }
  function validMobile(m) {
    var d = String(m || "").replace(/\D/g, "").slice(-10);
    return /^[6-9]\d{9}$/.test(d) ? d : null;
  }
  function fmtDur(v) {
    if (v === null || v === undefined || v === "") return "--:--";
    var s = typeof v === "string" ? parseInt(v, 10) : v;
    if (isNaN(s)) return String(v);
    return Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0");
  }
  function parseLinks(d) {
    if (!d || !d.download_urls) return [];
    try {
      var arr = typeof d.download_urls === "string" ? JSON.parse(d.download_urls) : d.download_urls;
      if (!Array.isArray(arr)) return [];
      var order = { 720: 0, 480: 1, 360: 2, 240: 3 };
      return arr.filter(function (x) { return x && x.url; }).map(function (x) {
        return { label: String(x.title || "").replace("p", "") + "p", url: x.url, rank: order[String(x.title)] === undefined ? 9 : order[String(x.title)] };
      }).sort(function (a, b) { return a.rank - b.rank; });
    } catch (e) { return []; }
  }

  /* Server-side strike counter (devtools guard). */
  async function strike(reason) {
    var headers = window.SK.fb ? await window.SK.fb.authHeaders().catch(function () { return {}; }) : {};
    return req("POST", "/api/auth/strike", {
      headers: headers,
      body: { reason: String(reason || "devtools").slice(0, 80) },
      timeout: 12000
    });
  }

  return {
    request: req, getConfig: getConfig, catalog: catalog, allBatches: allBatches,
    content: content, play: play, live: live,
    sendOtp: sendOtp, verifyOtp: verifyOtp, isAdmin: isAdmin, createTelegramLink: createTelegramLink,
    phoneProfile: phoneProfile, aiChat: aiChat, brand: brand, strike: strike,
    freePreviewId: freePreviewId, isFreePreview: isFreePreview,
    deviceId: deviceId, validMobile: validMobile, fmtDur: fmtDur, parseLinks: parseLinks
  };
})();
