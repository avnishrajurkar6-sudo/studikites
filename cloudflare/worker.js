/* Cloudflare Worker backend for StudiKitEZ. Reuses api/** Vercel-style handlers
   via Vercel req/res adapter. No Vercel 12-function limit. */
import health from '../api/health.js';
import config from '../api/config.js';
import avkings from '../api/avkings.js';
import diag from '../api/diag.js';

import isAdmin from '../api/auth/is-admin.js';
import profile from '../api/auth/profile.js';
import sendOtp from '../api/auth/send-otp.js';
import verifyOtp from '../api/auth/verify-otp.js';
import strike from '../api/auth/strike.js';
import leaderboard from '../api/auth/leaderboard.js';
import appLogin from '../api/auth/app-login.js';
import appMe from '../api/auth/app-me.js';
import appOnboarding from '../api/auth/app-onboarding.js';
import appLeaderboard from '../api/auth/app-leaderboard.js';

import telegramLink from '../api/telegram/link.js';
import telegramVerify from '../api/telegram/verify.js';

import coursesBatches from '../api/courses/batches.js';
import coursesContent from '../api/courses/content.js';
import mediaLive from '../api/media/live.js';
import mediaPlay from '../api/media/play.js';
import aiChat from '../api/ai/chat.js';
import cronMaintenance from '../api/cron/maintenance.js';

const routes = new Map([
  ['/api/health', health], ['/api/config', config], ['/api/avkings', avkings], ['/api/diag', diag],
  ['/api/auth/is-admin', isAdmin], ['/api/auth/profile', profile], ['/api/auth/send-otp', sendOtp],
  ['/api/auth/verify-otp', verifyOtp], ['/api/auth/strike', strike], ['/api/auth/leaderboard', leaderboard],
  ['/api/auth/app-login', appLogin], ['/api/auth/app-me', appMe], ['/api/auth/app-onboarding', appOnboarding],
  ['/api/auth/app-leaderboard', appLeaderboard],
  ['/api/telegram/link', telegramLink], ['/api/telegram/verify', telegramVerify],
  ['/api/courses/batches', coursesBatches], ['/api/courses/content', coursesContent],
  ['/api/media/live', mediaLive], ['/api/media/play', mediaPlay], ['/api/ai/chat', aiChat],
  ['/api/cron/maintenance', cronMaintenance],
]);

const CORS_ALLOW_HEADERS = 'Content-Type, Accept, Authorization, x-sk-session, x-sk-sitekey, x-requested-with, x-sk-bot-secret, x-telegram-bot-api-secret-token';
function pickHandler(mod) { return mod && (mod.default || mod); }
function headersToObject(h) { const out = {}; for (const [k, v] of h.entries()) out[k.toLowerCase()] = v; return out; }

class WorkerRes {
  constructor() { this.statusCode = 200; this.headers = new Headers(); this.body = ''; this._ended = false; }
  setHeader(k, v) { this.headers.set(String(k).toLowerCase(), String(v)); }
  getHeader(k) { return this.headers.get(String(k).toLowerCase()); }
  removeHeader(k) { this.headers.delete(String(k).toLowerCase()); }
  writeHead(s, h) { this.statusCode = s; if (h) for (const k of Object.keys(h)) this.setHeader(k, h[k]); return this; }
  status(s) { this.statusCode = s; return this; }
  end(d) { if (d !== undefined) this.body = d; this._ended = true; return this; }
  send(d) { return this.end(d); }
  json(o) { this.setHeader('content-type', 'application/json; charset=utf-8'); return this.end(JSON.stringify(o)); }
}

async function runHandler(handler, request, url) {
  let body; const method = request.method || 'GET';
  if (method !== 'GET' && method !== 'HEAD' && method !== 'OPTIONS') {
    const text = await request.text().catch(() => '');
    if (text) { try { body = JSON.parse(text); } catch { body = text; } }
  }
  const query = {}; for (const [k, v] of url.searchParams.entries()) query[k] = v;
  const req = { method, url: request.url, headers: headersToObject(request.headers), query, body, readableEnded: true, complete: true, on() {}, once() {}, removeListener() {}, destroy() {}, pipe() {} };
  const res = new WorkerRes();
  await handler(req, res);
  if (!res._ended) res.end('');
  return new Response(res.body, { status: res.statusCode, headers: res.headers });
}

function applyEnv(env) {
  try {
    const target = (globalThis.process && globalThis.process.env) ? globalThis.process.env : {};
    for (const [k, v] of Object.entries(env || {})) if (typeof v === 'string' && target[k] === undefined) target[k] = v;
    if (globalThis.process) globalThis.process.env = target;
  } catch {}
}

export default {
  async fetch(request, env, ctx) {
    applyEnv(env);
    const url = new URL(request.url);
    const pathname = url.pathname.replace(/\/+$/, '') || '/';
    if (pathname.startsWith('/api/') && request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': CORS_ALLOW_HEADERS, 'Access-Control-Max-Age': '86400' } });
    }
    if (pathname.startsWith('/api/')) {
      const handler = pickHandler(routes.get(pathname));
      if (handler) return runHandler(handler, request, url);
      return new Response(JSON.stringify({ success: false, error: 'Not found' }), { status: 404, headers: { 'content-type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' } });
    }
    return new Response('Not found', { status: 404 });
  },
  async scheduled(event, env, ctx) {
    applyEnv(env); const handler = pickHandler(cronMaintenance); if (!handler) return;
    const req = { method: 'POST', url: 'https://internal/api/cron/maintenance', headers: {}, query: {}, body: {}, readableEnded: true, complete: true, on() {}, once() {}, removeListener() {}, destroy() {}, pipe() {} };
    const res = new WorkerRes(); ctx.waitUntil(handler(req, res).catch(() => {}));
  },
};
