/* StudiKitEZ API layer — frontend calls ONLY stable backend routes (/api/*).
   Vendor URLs live in backend env (MEDIA_ROUTES_JSON), so frontend never breaks. */
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
          opts.body ? { "Content-Type": "application/json" } : {},
          opts.headers || {}
        ),
        body: opts.body ? JSON.stringify(opts.body) : undefined,
        signal: c.signal,
      });
      var text = await res.text();
      var json = null;
      try { json = text ? JSON.parse(text) : null; } catch (e) { json = null; }
      if (!res.ok || !json) {
        let msg = (json && (json.error || json.message || json.reason)) || ("HTTP " + res.status);
        if (msg && typeof msg === "object") msg = msg.message || ("HTTP " + res.status);
        throw new Error(msg);
      }
      return json;
    } catch (e) {
      if (e && e.name === "AbortError") throw new Error("Request timed out");
      throw e;
    } finally { clearTimeout(timer); }
  }

  var configCache = null;
  async function getConfig(force) {
    if (configCache && !force) return configCache;
    configCache = await req("GET", "/api/config");
    return configCache;
  }

  async function catalog() {
    var url = (window.__SK__ && window.__SK__.batchesUrl) || "batches.json";
    var res = await fetch(url, { headers: { Accept: "application/json" } });
    if (!res.ok) throw new Error("Catalog failed to load");
    return res.json();
  }
  async function allBatches() {
    var c = await catalog();
    return [].concat(c.new || [], c.old || []);
  }

  function content(courseId, folderId) {
    return req("GET", "/api/courses/content", { params: { content: String(courseId), folder: String(folderId || "0") } })
      .then(function (j) {
        var data = Array.isArray(j.data) ? j.data : (Array.isArray(j) ? j : null);
        if (!data) throw new Error("Content API returned an unexpected shape");
        return data;
      });
  }
  function play(courseId, contentId, key, deviceId, headers, vdcId) {
    return req("GET", "/api/media/play", { params: { course_id: String(courseId), content_id: String(contentId), key: key, device_id: deviceId, vdc_id: vdcId || "" }, headers: headers })
      .then(function (j) {
        if (!j.decryptedData || !j.decryptedData.file_url) throw new Error(j.reason || j.error || "Play API rejected request");
        return j.decryptedData;
      });
  }
  function live(courseId, type, key, deviceId, headers) {
    return req("GET", "/api/media/live", { params: { course_id: String(courseId), type: String(type || "1"), key: key, device_id: deviceId }, headers: headers })
      .then(function (j) { return Array.isArray(j.data) ? j.data : []; });
  }
  function sendOtp(mobile, deviceId) { return req("POST", "/api/auth/send-otp", { body: { mobile: mobile, deviceId: deviceId } }); }
  function verifyOtp(mobile, otp, deviceId) { return req("POST", "/api/auth/verify-otp", { body: { mobile: mobile, otp: otp, deviceId: deviceId } }); }
  function aiChat(prompt, mode, history, headers, context) {
    return req("POST", "/api/ai/chat", { body: { prompt: prompt, mode: mode, history: history || [], context: context || {} }, headers: headers, timeout: 30000 })
      .then(function (j) {
        if (!j.reply) throw new Error(j.error || "AI gave no answer");
        return j.reply;
      });
  }

  /* Free preview: first file at root, else first file one folder down. */
  async function freePreviewId(courseId) {
    var ck = "sk_free_" + courseId, cached = null;
    try { cached = sessionStorage.getItem(ck); } catch (e) {}
    if (cached) return cached;
    var root = await content(courseId, "0"), f = root.find(function (x) { return x.type === "file"; }) || null;
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

  return { getConfig: getConfig, catalog: catalog, allBatches: allBatches, content: content, play: play, live: live, sendOtp: sendOtp, verifyOtp: verifyOtp, aiChat: aiChat, freePreviewId: freePreviewId, isFreePreview: isFreePreview, deviceId: deviceId, validMobile: validMobile, fmtDur: fmtDur, parseLinks: parseLinks };
})();
