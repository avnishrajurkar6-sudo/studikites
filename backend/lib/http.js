/* Shared helpers for Vercel Node serverless functions (CommonJS, no deps). */

function allowedOrigins() {
  return String(process.env.ALLOWED_ORIGINS || "")
    .split(",")
    .map((s) => s.trim().replace(/\/+$/, ""))
    .filter(Boolean);
}

function applyCors(req, res) {
  const origin = req && req.headers ? String(req.headers.origin || "") : "";
  const list = allowedOrigins();
  if (!list.length || list.includes("*")) {
    res.setHeader("Access-Control-Allow-Origin", "*");
  } else if (origin && list.includes(origin.replace(/\/+$/, ""))) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
  }
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Accept, Authorization, x-sk-session");
  res.setHeader("Access-Control-Max-Age", "86400");
}

function sendJson(req, res, status, obj) {
  applyCors(req, res);
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.statusCode = status;
  res.end(JSON.stringify(obj));
}

function sendOptions(req, res) {
  applyCors(req, res);
  res.statusCode = 204;
  res.end();
}

function requireMethod(req, res, methods) {
  if (!methods.includes(req.method)) {
    sendJson(req, res, 405, { success: false, error: `Use ${methods.join(" or ")}` });
    return false;
  }
  return true;
}

function readJsonBody(req, limit = 32 * 1024) {
  if (req.body !== undefined) {
    if (typeof req.body === "string") {
      try {
        return Promise.resolve(req.body ? JSON.parse(req.body) : {});
      } catch {
        return Promise.reject(Object.assign(new Error("Invalid JSON body"), { status: 400 }));
      }
    }
    if (typeof req.body === "object" && req.body !== null) return Promise.resolve(req.body);
  }
  // Stream already consumed upstream (some runtimes pre-read it): don't hang.
  if (req.readableEnded || req.complete) return Promise.resolve({});
  return new Promise((resolve, reject) => {
    const cap = setTimeout(() => reject(Object.assign(new Error("Body read timed out"), { status: 408 })), 5000);
    let size = 0;
    let raw = "";
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > limit) {
        clearTimeout(cap);
        reject(Object.assign(new Error("Body too large"), { status: 413 }));
        req.destroy();
        return;
      }
      raw += chunk;
    });
    req.on("end", () => {
      clearTimeout(cap);
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(Object.assign(new Error("Invalid JSON body"), { status: 400 }));
      }
    });
    req.on("error", () => {
      clearTimeout(cap);
      reject(Object.assign(new Error("Unreadable body"), { status: 400 }));
    });
  });
}

function assertHttpsUrl(value, name) {
  let u;
  try {
    u = new URL(String(value || ""));
  } catch {
    throw Object.assign(new Error(`${name} is not configured`), { status: 500 });
  }
  if (u.protocol !== "https:") {
    throw Object.assign(new Error(`${name} must use https`), { status: 500 });
  }
  return u.toString().replace(/\/+$/, "");
}

function mediaRoutes() {
  let routes = null;
  try {
    routes = process.env.MEDIA_ROUTES_JSON ? JSON.parse(process.env.MEDIA_ROUTES_JSON) : null;
  } catch {
    throw Object.assign(new Error("MEDIA_ROUTES_JSON is invalid"), { status: 500 });
  }
  const nig = routes && routes.nig ? routes.nig : "https://nt.studybeepro.site/api/nig";
  const play = routes && routes.play ? routes.play : "https://nt.studybeepro.site/api/play";
  return { nig: assertHttpsUrl(nig, "media route nig"), play: assertHttpsUrl(play, "media route play") };
}

function timeoutMs() {
  // Keep under serverless execution caps so WE answer (JSON), never the platform.
  const n = Number(process.env.UPSTREAM_TIMEOUT_MS || 8000);
  return Number.isFinite(n) && n > 0 ? Math.min(n, 25000) : 8000;
}

/* Public worker URLs with safe defaults so the API works with zero env setup. */
function otpBase() {
  if (process.env.OTP_BASE_URL) return assertHttpsUrl(process.env.OTP_BASE_URL, "OTP_BASE_URL");
  return "https://chutapi.smexfot.workers.dev";
}

function mirrorNig() {
  if (process.env.MIRROR_NIG_URL) return assertHttpsUrl(process.env.MIRROR_NIG_URL, "MIRROR_NIG_URL");
  return "https://nts.khatikgaurav38.workers.dev";
}

async function fetchUpstream(url, { method = "GET", headers = {}, body, timeout } = {}) {
  const target = assertHttpsUrl(url, "upstream URL");
  const controller = new AbortController();
  const budget = Number(timeout) > 0 ? Math.min(Number(timeout), 25000) : timeoutMs();
  const timer = setTimeout(() => controller.abort(), budget);
  try {
    const res = await fetch(target, {
      method,
      headers: { Accept: "application/json", "User-Agent": "StudiKitEZ-backend/1.0", ...headers },
      body,
      signal: controller.signal,
    });
    const text = await res.text();
    const contentType = res.headers.get("content-type") || "";
    let json = null;
    if (contentType.includes("json") || text.trim().startsWith("{")) {
      try {
        json = JSON.parse(text);
      } catch {
        json = null;
      }
    }
    return { ok: res.ok, status: res.status, json, text };
  } catch (e) {
    if (e && e.name === "AbortError") {
      throw Object.assign(new Error("Upstream timed out"), { status: 504 });
    }
    throw Object.assign(new Error("Upstream unreachable"), { status: 502 });
  } finally {
    clearTimeout(timer);
  }
}

function validIndianMobile(value) {
  const digits = String(value || "").replace(/\D/g, "").slice(-10);
  return /^[6-9]\d{9}$/.test(digits) ? digits : null;
}

function asId(value, max = 32) {
  const s = String(value || "");
  return s && s.length <= max ? s : "";
}

module.exports = {
  sendJson,
  sendOptions,
  requireMethod,
  readJsonBody,
  assertHttpsUrl,
  mediaRoutes,
  otpBase,
  mirrorNig,
  fetchUpstream,
  validIndianMobile,
  asId,
};
