/* Shared helpers for Vercel Node serverless functions (CommonJS, no deps).
   AVkings Engine — every response is branded and hardened. */
'use strict';

const BRAND = "AVkings";
const VERSION = "2.0.0";

/* ------------------------------------------------------------------ CORS */
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
  if (origin && list.includes(origin.replace(/\/+$/, ""))) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
  } else if (!origin) {
    /* Non-browser callers (curl/health checks) get a sane value. */
    res.setHeader("Access-Control-Allow-Origin", list[0] || "*");
  }
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, Accept, Authorization, x-sk-session, x-sk-sitekey, x-requested-with"
  );
  res.setHeader("Access-Control-Expose-Headers", "X-Request-Id, X-RateLimit-Remaining, Retry-After, X-Powered-By");
  res.setHeader("Access-Control-Max-Age", "86400");
}

/* --------------------------------------------------------------- headers */
function securityHeaders(req, res) {
  res.setHeader("X-Powered-By", BRAND);
  res.setHeader("X-StudiKitEZ-Engine", `${BRAND}/${VERSION}`);
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=()");
  res.setHeader("Cross-Origin-Resource-Policy", "same-site");
  res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
  res.setHeader("Strict-Transport-Security", "max-age=63072000; includeSubDomains; preload");
  res.setHeader("X-Request-Id", requestId(req));
}

function requestId(req) {
  const incoming = String((req && req.headers && (req.headers["x-request-id"] || req.headers["x-vercel-id"])) || "");
  if (incoming && incoming.length <= 80) return incoming;
  return "sk_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function sendJson(req, res, status, obj) {
  applyCors(req, res);
  securityHeaders(req, res);
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.statusCode = status;
  res.end(JSON.stringify(obj));
}

function sendOptions(req, res) {
  applyCors(req, res);
  securityHeaders(req, res);
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

/* ------------------------------------------------------------ body parse */
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

/* ------------------------------------------------------------- validation */
function sanitizeText(value, max = 200) {
  const s = String(value == null ? "" : value)
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
    .trim();
  return max ? s.slice(0, max) : s;
}

function validIndianMobile(value) {
  const digits = String(value || "").replace(/\D/g, "").slice(-10);
  return /^[6-9]\d{9}$/.test(digits) ? digits : null;
}

function validEmail(value) {
  const s = sanitizeText(value, 200).toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(s) ? s : "";
}

function asId(value, max = 32) {
  const s = String(value || "");
  return s && s.length <= max ? s : "";
}

function asDigits(value, max = 12) {
  const s = String(value || "").replace(/[^0-9]/g, "");
  return s && s.length <= max ? s : "";
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

/* ------------------------------------------------------------- rate limit */
const buckets = new Map();
function clientIp(req) {
  const h = (req && req.headers) || {};
  const forwarded = String(h["x-forwarded-for"] || "").split(",")[0].trim();
  return forwarded || String(h["x-real-ip"] || h["cf-connecting-ip"] || "unknown");
}
function rateLimit(req, res, name, max, windowMs) {
  const key = `${name}:${clientIp(req)}`;
  const now = Date.now();
  let entry = buckets.get(key);
  if (!entry || now - entry.at > windowMs) entry = { at: now, n: 0 };
  entry.n += 1;
  buckets.set(key, entry);
  if (buckets.size > 5000) {
    for (const [k, v] of buckets) if (now - v.at > 600_000) buckets.delete(k);
  }
  const remaining = Math.max(0, max - entry.n);
  res.setHeader("X-RateLimit-Limit", String(max));
  res.setHeader("X-RateLimit-Remaining", String(remaining));
  if (entry.n > max) {
    res.setHeader("Retry-After", String(Math.ceil(windowMs / 1000)));
    sendJson(req, res, 429, { success: false, error: "Too many requests. Please slow down." });
    return false;
  }
  return true;
}

/* ---------------------------------------------------------------- upstream */
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

function batchesUrl() {
  return assertHttpsUrl(
    process.env.BATCHES_URL || "https://nt.studybeepro.site/batches.json",
    "BATCHES_URL"
  );
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

async function fetchUpstream(url, { method = "GET", headers = {}, body, timeout } = {}) {
  const target = assertHttpsUrl(url, "upstream URL");
  const controller = new AbortController();
  const budget = Number(timeout) > 0 ? Math.min(Number(timeout), 25000) : timeoutMs();
  const timer = setTimeout(() => controller.abort(), budget);
  try {
    const res = await fetch(target, {
      method,
      headers: { Accept: "application/json", "User-Agent": `StudiKitEZ-server/${VERSION} (${BRAND})`, ...headers },
      body,
      signal: controller.signal,
    });
    const text = await res.text();
    const contentType = res.headers.get("content-type") || "";
    let json = null;
    if (contentType.includes("json") || text.trim().startsWith("{") || text.trim().startsWith("[")) {
      try {
        json = JSON.parse(text);
      } catch {
        json = null;
      }
    }
    return { ok: res.ok, status: res.status, json, text };
  } catch (e) {
    if (e && e.name === "AbortError") throw Object.assign(new Error("Upstream timed out"), { status: 504 });
    throw Object.assign(new Error("Upstream unreachable"), { status: 502 });
  } finally {
    clearTimeout(timer);
  }
}

module.exports = {
  BRAND,
  VERSION,
  allowedOrigins,
  applyCors,
  securityHeaders,
  requestId,
  sendJson,
  sendOptions,
  requireMethod,
  readJsonBody,
  sanitizeText,
  validIndianMobile,
  validEmail,
  asId,
  asDigits,
  assertHttpsUrl,
  rateLimit,
  clientIp,
  mediaRoutes,
  batchesUrl,
  timeoutMs,
  otpBase,
  mirrorNig,
  fetchUpstream,
};
