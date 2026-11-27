/* Verified-requests-only gate (CommonJS, no deps). */
'use strict';

const crypto = require("crypto");

// ---- Safe module loading ----
let http, firestore;
try { http = require("./http"); } catch (e) { http = null; }
try { firestore = require("./firestore-admin"); } catch (e) { firestore = null; }

// ---- Fallbacks for http helpers ----
function mediaRoutes() {
  if (http && typeof http.mediaRoutes === 'function') return http.mediaRoutes();
  return { nig: 'https://nt.studybeepro.site/api/nig' };
}
function mirrorNig() {
  if (http && typeof http.mirrorNig === 'function') return http.mirrorNig();
  return 'https://nt.studybeepro.site';
}
async function fetchUpstream(url, opts) {
  if (http && typeof http.fetchUpstream === 'function') return http.fetchUpstream(url, opts);
  // Minimal fallback
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), (opts && opts.timeout) || 8000);
  try {
    const res = await fetch(url, { headers: (opts && opts.headers) || {}, signal: ctrl.signal });
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* ignore */ }
    return { ok: res.ok, status: res.status, json, text };
  } catch (e) {
    return { ok: false, status: 0, json: null, text: String(e.message) };
  } finally {
    clearTimeout(timer);
  }
}
async function getDocument(coll, id) {
  if (firestore && typeof firestore.getDocument === 'function') return firestore.getDocument(coll, id);
  throw new Error("firestore-admin module missing");
}

// ---- Config helpers ----
function firebaseKey() {
  return process.env.FIREBASE_STUDIKI_API_KEY || process.env.STUDIKI_API_KEY ||
    "AIzaSyCG2zFEsE5Fr8Vx-5of_PL0xQeP773MNFM";
}

function firebaseProject() {
  return process.env.FIREBASE_STUDIKI_PROJECT_ID || "studiki";
}

function sessionSecret() {
  const secret = process.env.SESSION_SECRET;
  if (!secret) {
    // Fallback so the app doesn't crash, but logs a warning.
    // In production, you MUST set SESSION_SECRET in Vercel.
    console.warn("[VERIFY] WARNING: SESSION_SECRET is not set. Using insecure default.");
    return "insecure_default_secret_change_me";
  }
  return secret;
}

// ---- Session Management ----
function mintSession(uid, provider, ttlMs) {
  const exp = Date.now() + (ttlMs || 30 * 24 * 3600 * 1000);
  const body = `${uid}.${provider}.${exp}`;
  const sig = crypto.createHmac("sha256", sessionSecret()).update(body).digest("base64url");
  return `${Buffer.from(uid).toString("base64url")}.${Buffer.from(provider).toString("base64url")}.${exp}.${sig}`;
}

function checkSession(token) {
  const parts = String(token || "").split(".");
  if (parts.length !== 4) throw Object.assign(new Error("Invalid session"), { status: 401 });
  
  let uid, provider;
  try {
    uid = Buffer.from(parts[0], "base64url").toString();
    provider = Buffer.from(parts[1], "base64url").toString();
  } catch {
    throw Object.assign(new Error("Invalid session"), { status: 401 });
  }
  
  const exp = Number(parts[2]);
  if (!uid || !provider || !Number.isFinite(exp) || exp <= Date.now()) {
    throw Object.assign(new Error("Session expired — sign in again"), { status: 401 });
  }
  
  // Fixed: Guard against a missing part[3] before Buffer conversion
  if (!parts[3]) throw Object.assign(new Error("Invalid session"), { status: 401 });
  
  const sig = crypto.createHmac("sha256", sessionSecret()).update(`${uid}.${provider}.${exp}`).digest("base64url");
  const a = Buffer.from(sig), b = Buffer.from(parts[3]);
  
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    throw Object.assign(new Error("Invalid session"), { status: 401 });
  }
  return { uid, provider };
}

// ---- Firebase Token Verification ----
async function checkIdToken(idToken) {
  if (!idToken || String(idToken).split(".").length !== 3) {
    throw Object.assign(new Error("Invalid sign-in"), { status: 401 });
  }
  const key = firebaseKey();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const res = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${key}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ idToken }),
      signal: controller.signal,
    });
    const j = await res.json().catch(() => null);
    const user = j && j.users && j.users[0];
    const uid = user && user.localId;
    if (!res.ok || !uid || user.disabled === true) throw Object.assign(new Error("Invalid sign-in"), { status: 401 });
    return {
      uid,
      provider: "google",
      email: String(user.email || "").toLowerCase(),
      idToken,
    };
  } catch (e) {
    if (e && e.status === 401) throw e;
    throw Object.assign(new Error("Sign-in check failed"), { status: 503 });
  } finally {
    clearTimeout(timer);
  }
}

async function userRecord(uid, idToken) {
  let json;
  try {
    if (!idToken) {
      json = await getDocument("users", uid);
    } else {
      const url = `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(firebaseProject())}/databases/(default)/documents/users/${encodeURIComponent(uid)}?key=${encodeURIComponent(firebaseKey())}`;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 5000);
      try {
        const res = await fetch(url, { headers: { Authorization: `Bearer ${idToken}` }, signal: controller.signal });
        if (res.status === 404) return null;
        if (!res.ok) throw Object.assign(new Error("Account status could not be verified"), { status: 503 });
        json = await res.json();
      } finally {
        clearTimeout(timer);
      }
    }
  } catch (error) {
    if (error && error.status) throw error;
    throw Object.assign(new Error("Account status could not be verified"), { status: 503 });
  }
  const fields = json && json.fields;
  if (!fields) return null;
  const value = (name) => {
    const field = fields[name];
    if (!field) return undefined;
    if (Object.prototype.hasOwnProperty.call(field, "booleanValue")) return field.booleanValue;
    if (Object.prototype.hasOwnProperty.call(field, "integerValue")) return Number(field.integerValue);
    if (Object.prototype.hasOwnProperty.call(field, "stringValue")) return field.stringValue;
    return undefined;
  };
  return { banned: value("banned") === true, role: String(value("role") || "").toLowerCase() };
}

async function assertNotBanned(uid, idToken) {
  const user = await userRecord(uid, idToken);
  if (user && user.banned) throw Object.assign(new Error("This account is banned"), { status: 403 });
  return user;
}

// ---- Admin Access ----
function adminEmails() {
  return String(process.env.ADMIN_EMAILS || "")
    .split(",")
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);
}

async function requireAdmin(req) {
  const headers = (req && req.headers) || {};
  // 1) App/backend-signed session (x-sk-session). Admin = users/{uid}.role == 'admin'.
  const sess = headers["x-sk-session"] || (req.query && req.query.session);
  if (sess && !/^Bearer\s+\S+$/i.test(String(headers.authorization || ""))) {
    const u = checkSession(sess);
    const user = await userRecord(u.uid);
    if (user && user.banned) throw Object.assign(new Error("This account is banned"), { status: 403 });
    if (!user || user.role !== "admin") throw Object.assign(new Error("Admin access required"), { status: 403 });
    return { uid: u.uid, provider: u.provider, email: "", via: "session" };
  }
  // 2) Firebase ID token (website admin).
  const authorization = String(headers.authorization || "");
  const match = authorization.match(/^Bearer\s+(\S+)$/i);
  if (!match) throw Object.assign(new Error("Admin sign-in required"), { status: 401 });
  const identity = await checkIdToken(match[1]);
  const user = await userRecord(identity.uid, match[1]);
  if (user && user.banned) throw Object.assign(new Error("This account is banned"), { status: 403 });
  if (!adminEmails().includes(identity.email) && (!user || user.role !== "admin")) {
    throw Object.assign(new Error("Admin access required"), { status: 403 });
  }
  return identity;
}

// ---- Free Preview Logic ----
const previewCache = new Map();
async function freePreviewId(courseId) {
  const id = String(courseId || "");
  const hit = previewCache.get(id);
  if (hit && Date.now() - hit.at < 600_000) return hit.value;
  const value = await resolvePreview(id);
  if (value) previewCache.set(id, { at: Date.now(), value });
  if (previewCache.size > 500) previewCache.clear();
  return value;
}

async function resolvePreview(courseId) {
  const routes = mediaRoutes();
  const mirror = mirrorNig();
  const get = async (url) => {
    const r = await fetchUpstream(url, { timeout: 8000 });
    if (!r.json) return null;
    const data = Array.isArray(r.json.data) ? r.json.data : (Array.isArray(r.json) ? r.json : null);
    return data;
  };
  const fetchFolder = async (folder) => {
    const nigUrl = `${routes.nig}?content=${encodeURIComponent(courseId)}&folder=${encodeURIComponent(folder)}`;
    let data = await get(nigUrl).catch(() => null);
    if (!data) data = await get(`${mirror}/?content=${encodeURIComponent(courseId)}&folder=${encodeURIComponent(folder)}`).catch(() => null);
    return data;
  };
  const root = await fetchFolder("0");
  if (!root) return null;
  let f = root.find((x) => x && x.type === "file") || null;
  if (!f) {
    const folder = root.find((x) => x && x.type === "folder");
    if (folder) {
      const sub = await fetchFolder(String(folder.entity_id));
      if (sub) f = sub.find((x) => x && x.type === "file") || null;
    }
  }
  return f ? String(f.entity_id) : null;
}

// ---- Authorize Playback ----
async function authorize(req, { courseId, contentId } = {}) {
  const headers = req.headers || {};
  const bearer = String(headers.authorization || "");
  
  // 1. Google Firebase ID Token
  if (/^Bearer\s+\S+$/i.test(bearer)) {
    const u = await checkIdToken(bearer.replace(/^Bearer\s+/i, ""));
    await assertNotBanned(u.uid, u.idToken);
    return { uid: u.uid, via: "google" };
  }
  
  // 2. Phone Session (HMAC)
  const sess = headers["x-sk-session"] || (req.query && req.query.session);
  if (sess) {
    const u = checkSession(sess);
    await assertNotBanned(u.uid);
    return { uid: u.uid, via: u.provider };
  }
  
  // 3. Free Preview
  if (courseId && contentId) {
    const free = await freePreviewId(courseId).catch(() => null);
    if (free && free === String(contentId)) return { preview: true };
  }
  
  throw Object.assign(new Error("Sign in required — this lecture is not free"), { status: 401 });
}

function validAppKey(key, deviceId) {
  return /^SB-[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(String(key || "")) && String(deviceId || "").length >= 3 && String(deviceId).length <= 128;
}

module.exports = {
  mintSession,
  checkSession,
  checkIdToken,
  requireAdmin,
  userRecord,
  assertNotBanned,
  authorize,
  freePreviewId,
  validAppKey,
};