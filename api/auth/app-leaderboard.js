/* GET /api/auth/app-leaderboard?limit=40 — leaderboard for app + web.
   Hides users with leaderboardHidden, leaderboardSuspended, or banned.
   Returns { rows: [{uid,name,xp,streak,hidden,suspended,role}] }. */
'use strict';

const { sendJson, sendOptions, requireMethod } = require('../../lib/http');
const { authorize } = require('../../lib/verify');
const firestore = require('../../lib/firestore-admin');

function decodeValue(v) {
  if (!v) return undefined;
  if (v.stringValue !== undefined) return v.stringValue;
  if (v.integerValue !== undefined) return Number(v.integerValue);
  if (v.doubleValue !== undefined) return Number(v.doubleValue);
  if (v.booleanValue !== undefined) return v.booleanValue;
  if (v.arrayValue) return (v.arrayValue.values || []).map(decodeValue);
  if (v.mapValue) return decodeFields(v.mapValue.fields || {});
  return undefined;
}
function decodeFields(fields) {
  const out = {};
  for (const k of Object.keys(fields || {})) out[k] = decodeValue(fields[k]);
  return out;
}

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return sendOptions(req, res);
  if (!requireMethod(req, res, ['GET'])) return;
  try {
    const identity = await authorize(req, {});
    if (!identity || !identity.uid) return sendJson(req, res, 401, { success: false, error: 'Sign in required' });
    const limit = Math.max(3, Math.min(50, Number(req.query && req.query.limit) || 40));
    // Fetch extra so hidden/suspended don't consume visible slots.
    const docs = await firestore.listDocuments('users', 50, 'gamification.xp desc');
    const rows = [];
    for (const doc of docs) {
      const d = doc.fields ? decodeFields(doc.fields) : {};
      if (d.banned === true) continue;
      if (d.leaderboardHidden === true || d.hidden === true) continue;
      if (d.leaderboardSuspended === true || d.suspended === true) continue;
      const id = (doc.name || '').split('/').pop();
      const g = d.gamification || {};
      const name = String(d.displayName || d.name || (d.mobile ? '+91 ' + String(d.mobile).replace(/^\+91\s*/, '') : 'Learner') || 'Learner').replace(/^\+91\s*/, '').slice(0, 40) || 'Learner';
      rows.push({
        uid: id,
        name,
        xp: Number(g.xp || 0) || 0,
        streak: Number((g.streak && g.streak.current) || 0) || 0,
        hidden: false,
        suspended: false,
        role: String(d.role || '').toLowerCase(),
      });
      if (rows.length >= limit) break;
    }
    rows.sort((a, b) => b.xp - a.xp);
    return sendJson(req, res, 200, { success: true, rows });
  } catch (err) {
    const status = err.status || 500;
    return sendJson(req, res, status, { success: false, error: status < 500 ? err.message || 'Could not load leaderboard' : 'Leaderboard is temporarily unavailable' });
  }
};
