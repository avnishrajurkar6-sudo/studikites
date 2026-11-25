/* Shared helpers for Vercel Node serverless functions (CommonJS, no deps).
 *
 * Hardened response layer:
 *   - Every API response carries the AVkings brand + strict security headers.
 *   - Per-instance sliding-window rate limits (defence in depth; edge/WAF still
 *     recommended for distributed abuse).
 *   - No stack traces, no upstream URLs, no secrets ever leave this module.
 */

const BRAND = "AVkings";
const VERSION = "2.0.0";

/* ------------------------------ security ------------------------------ */

function allowedOrigins() {
  const defaults = [
    "https://studikitesz.pages.dev",
    "https://studikites.vercel.app",
    "http://localhost:8090",
    "http://127.0.0.1:8090",
  ];
  return defaults
    .concat(
      String(process.env.ALLOWED_ORIGINS || "")
        .split(",")
        .map((s) => s.trim().replace(/\/+$/, ""))
        .filter(Boolean)
    )
    .filter((v, i, a) => a.indexOf(v) === i);
}

function applyCors(req, res) {
  const origin = req && req.headers ? String(req.headers.origin || "") : "";
  const list = allowedOrigins();
  if (list.includes("*")) {
    res.setHeader("Access-Control-Allow-Origin", "*");
  } else if (origin && list.includes(origin.replace(/\/+$/, ""))) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
  }
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, Accept, Authorization, x-sk-session, x-sk-sitekey, x-requested-with"
  );
  res.setHeader("Access-Control-Expose-Headers", "X-Request-Id, X-RateLimit-Remaining, Retry-After");
  res.setHeader("Access-Control-Max-Age", "86400");
}

function applySecurityHeaders(req, res) {
  res.setHeader("X-Powered-By", BRAND);
  res.setHeader("X-StudiKitEZ-Engine", `${BRAND}/${VERSION}`);
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=()");
  res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
  res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
  res.setHeader("Strict-Transport-Security", "max-age=63072000; includeSubDomains; preload");
  if (!res.getHeader("X-Request-Id")) {
    res.setHeader("X-Request-Id", requestId());
  }
}

function requestId() {
  return (
    Date.now().toString(36) +
    "-" +
    Math.random().toString(36).slice(2, 10)
  );
}

function clientIp(req) {
  const h = (req && req.headers) || {};
  const fwd = String(h["x-forwarded-for"] || "").split(",")[0].trim();
  return fwd || String(h["x-real-ip"] || "") || (req && req.socket && req.socket.remoteAddress) || "unknown";
}

/* ------------------------------ rate limit ------------------------------ */

const buckets = new Map();
let lastSweep = 0;

function sweep(now) {
  if (now - lastSweep < 60_000) return;
  lastSweep = now;
  for (const [key, b] of buckets) {
    if (now - b.start > b.window * 2) buckets.delete(key);
  }
  if (buckets.size > 10_000) buckets.clear();
}

/**
 * Sliding-window-ish fixed window limit. Returns true when allowed; when not,
 * sends a clean 429 JSON response and returns false.
 */
function rateLimit(req, res, name, limit, windowMs) {
  try {
    const now = Date.now();
    sweep(now);
    const window = Math.max(1000, Number(windowMs) || 60_000);
    const max = Math.max(1, Number(limit) || 60);
    const key = `${name}:${clientIp(req)}`;
    let b = buckets.get(key);
    if (!b || now - b.start >= window) {
      b = { start: now, count: 0, window };
      buckets.set(key, b);
    }
    b.count += 1;
    const remaining = Math.max(0, max - b.count);
    res.setHeader("X-RateLimit-Limit", String(max));
    res.setHeader("X-RateLimit-Remaining", String(remaining));
    if (b.count > max) {
      const retry = Math.max(1, Math.ceil((b.start + window - now) / 1000));
      res.setHeader("Retry-After", String(retry));
      sendJson(req, res, 429, {
        success: false,
        error: "Too many requests. Please slow down and retry shortly.",
        retryAfter: retry,
        brand: BRAND,
      });
      return false;
    }
    return true;
  } catch {
    return true; // never fail closed on limiter bugs
  }
}

/* ------------------------------ responses ------------------------------ */

function sendJson(req, res, status, obj) {
  applyCors(req, res);
  applySecurityHeaders(req, res);
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store, max-age=0");
  res.statusCode = status;
  const payload = obj && typeof obj === "object" && !Array.isArray(obj)
    ? Object.assign({ brand: BRAND }, obj)
    : obj;
  res.end(JSON.stringify(payload));
}

function sendOptions(req, res) {
  applyCors(req, res);
  applySecurityHeaders(req, res);
  res.statusCode = 204;
  res.end();
}

function requireMethod(req, res, methods) {
  if (!methods.includes(req.method)) {
    res.setHeader("Allow", methods.join(", "));
    sendJson(req, res, 405, { success: false, error: `Use ${methods.join(" or ")}` });
    return false;
  }
  return true;
}

/* ------------------------------ body parsing ------------------------------ */

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

/* ------------------------------ validation ------------------------------ */

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

function isValidHttpUrl(value) {
  try {
    const u = new URL(String(value || ""));
    return u.protocol === "https:" || u.protocol === "http:";
  } catch {
    return false;
  }
}

function sanitizeText(value, max = 500) {
  return String(value === null || value === undefined ? "" : value)
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "")
    .slice(0, Math.max(0, Number(max) || 500))
    .trim();
}

function validIndianMobile(value) {
  const digits = String(value || "").replace(/\D/g, "").slice(-10);
  return /^[6-9]\d{9}$/.test(digits) ? digits : null;
}

function asId(value, max = 32) {
  const s = String(value || "");
  return s && s.length <= max ? s : "";
}

function asInt(value, max = 1_000_000) {
  const n = Number(value);
  return Number.isInteger(n) && n >= 0 && n <= max ? n : null;
}

/* ------------------------------ upstream ------------------------------ */

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
  const n = Number(process.env.UPSTREAM_TIMEOUT_MS || 8000);
  return Number.isFinite(n) && n > 0 ? Math.min(n, 25000) : 8000;
}

function otpBase() {
  if (process.env.OTP_BASE_URL) return assertHttpsUrl(process.env.OTP_BASE_URL, "OTP_BASE_URL");
  return "https://chutapi.smexfot.workers.dev";
}

function mirrorNig() {
  if (process.env.MIRROR_NIG_URL) return assertHttpsUrl(process.env.MIRROR_NIG_URL, "MIRROR_NIG_URL");
  return "https://nts.khatikgaurav38.workers.dev";
}

function batchesUrl() {
  if (process.env.BATCHES_URL) return assertHttpsUrl(process.env.BATCHES_URL, "BATCHES_URL");
  return "https://nt.studybeepro.site/batches.json";
}

async function fetchUpstream(url, { method = "GET", headers = {}, body, timeout } = {}) {
  const target = assertHttpsUrl(url, "upstream URL");
  const controller = new AbortController();
  const budget = Number(timeout) > 0 ? Math.min(Number(timeout), 25000) : timeoutMs();
  const timer = setTimeout(() => controller.abort(), budget);
  try {
    const res = await fetch(target, {
      method,
      headers: {
        Accept: "application/json",
        "User-Agent": `${BRAND}-backend/${VERSION}`,
        ...headers,
      },
      body,
      signal: controller.signal,
      redirect: "follow",
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

module.exports = {
  BRAND,
  VERSION,
  sendJson,
  sendOptions,
  requireMethod,
  readJsonBody,
  assertHttpsUrl,
  isValidHttpUrl,
  sanitizeText,
  mediaRoutes,
  otpBase,
  mirrorNig,
  batchesUrl,
  fetchUpstream,
  validIndianMobile,
  asId,
  asInt,
  clientIp,
  rateLimit,
  requestId,
};
