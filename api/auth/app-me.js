/* GET /api/auth/app-me — current signed-in user for app + web clients.
   Uses authorize(): Firebase ID token (Bearer) OR backend-signed x-sk-session. */
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
  if (v.nullValue !== undefined) return null;
  if (v.timestampValue !== undefined) return v.timestampValue;
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
    const doc = await firestore.getDocument('users', identity.uid);
    const user = doc && doc.fields ? decodeFields(doc.fields) : {};
    user.uid = identity.uid;
    user.provider = user.provider || identity.via || '';
    return sendJson(req, res, 200, { success: true, user });
  } catch (err) {
    const status = err.status || 500;
    return sendJson(req, res, status, { success: false, error: status < 500 ? err.message || 'Could not load profile' : 'Profile is temporarily unavailable' });
  }
};
