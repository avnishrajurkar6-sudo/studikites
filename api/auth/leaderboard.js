/* POST /api/auth/leaderboard
   Learners can update only their own public leaderboard name/visibility.
   Administrators can separately suspend a learner from leaderboard display. */
'use strict';

const { sendJson, sendOptions, requireMethod, readJsonBody, rateLimit, sanitizeText } = require('../../lib/http');
const { authorize, requireAdmin } = require('../../lib/verify');

let firestore = null;
try { firestore = require('../../lib/firestore-admin'); } catch { firestore = null; }

function unavailable(req, res) {
  return sendJson(req, res, 503, { success: false, error: 'Leaderboard settings are unavailable' });
}

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return sendOptions(req, res);
  if (!requireMethod(req, res, ['POST'])) return;
  if (!rateLimit(req, res, 'leaderboard-settings', 30, 60_000)) return;
  if (!firestore) return unavailable(req, res);

  try {
    const body = await readJsonBody(req);
    if (body.action === 'update') {
      const identity = await authorize(req, {});
      const displayName = sanitizeText(body.displayName, 40);
      if (displayName.length < 2) {
        return sendJson(req, res, 400, { success: false, error: 'Name must be at least 2 characters' });
      }
      if (typeof body.hidden !== 'boolean') {
        return sendJson(req, res, 400, { success: false, error: 'Choose whether your profile appears on the leaderboard' });
      }

      const fields = {
        displayName: { stringValue: displayName },
        name: { stringValue: displayName },
        leaderboardHidden: { booleanValue: body.hidden },
        updatedAt: { integerValue: String(Date.now()) },
      };
      await firestore.patchDocument('users', identity.uid, fields, Object.keys(fields));
      return sendJson(req, res, 200, { success: true, displayName, hidden: body.hidden });
    }

    if (body.action === 'suspend') {
      await requireAdmin(req);
      const uid = sanitizeText(body.uid, 128);
      if (!/^[A-Za-z0-9_-]+$/.test(uid)) {
        return sendJson(req, res, 400, { success: false, error: 'Invalid user ID' });
      }
      if (typeof body.suspended !== 'boolean') {
        return sendJson(req, res, 400, { success: false, error: 'Invalid suspension state' });
      }
      const user = await firestore.getDocument('users', uid);
      if (!user || !user.fields) {
        return sendJson(req, res, 404, { success: false, error: 'User not found' });
      }
      const role = user.fields.role && user.fields.role.stringValue;
      if (role === 'admin') {
        return sendJson(req, res, 403, { success: false, error: 'Administrators cannot be suspended from the leaderboard' });
      }

      const fields = {
        leaderboardSuspended: { booleanValue: body.suspended },
        leaderboardSuspendedAt: { integerValue: String(body.suspended ? Date.now() : 0) },
      };
      await firestore.patchDocument('users', uid, fields, Object.keys(fields));
      return sendJson(req, res, 200, { success: true, uid, suspended: body.suspended });
    }

    return sendJson(req, res, 400, { success: false, error: 'Unsupported leaderboard action' });
  } catch (error) {
    const status = error.status || 500;
    return sendJson(req, res, status, {
      success: false,
      error: status < 500 ? error.message : 'Leaderboard settings are unavailable',
    });
  }
};
