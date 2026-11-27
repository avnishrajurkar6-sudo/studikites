/* POST /api/auth/app-onboarding — compulsory onboarding for app + web.
   Works for BOTH providers (google + phone). `authorize` derives uid from a
   Firebase ID token or backend-signed x-sk-session; the client never sends uid.
   Required: displayName (>=2), contactMobile (10-digit Indian, does NOT change
   sign-in number), batches (>=1). Phone-number users CAN fill contactMobile. */
'use strict';

const { sendJson, sendOptions, requireMethod, readJsonBody, sanitizeText, validIndianMobile } = require('../../lib/http');
const { authorize } = require('../../lib/verify');
const firestore = require('../../lib/firestore-admin');

function encString(s) { return { stringValue: String(s) }; }

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return sendOptions(req, res);
  if (!requireMethod(req, res, ['POST'])) return;
  try {
    const identity = await authorize(req, {});
    if (!identity || !identity.uid) return sendJson(req, res, 401, { success: false, error: 'Sign in required' });
    const body = await readJsonBody(req);

    const displayName = sanitizeText(body.displayName, 40).replace(/\s+/g, ' ');
    const contactMobile = validIndianMobile(body.contactMobile || body.mobile || '');
    const batches = Array.isArray(body.batches)
      ? body.batches.map((id) => sanitizeText(id, 20)).filter(Boolean).slice(0, 12)
      : [];

    if (displayName.length < 2) throw Object.assign(new Error('Enter your name to finish onboarding'), { status: 400 });
    if (!contactMobile) throw Object.assign(new Error('Enter a valid 10-digit Indian contact number'), { status: 400 });
    if (!batches.length) throw Object.assign(new Error('Choose at least one batch to finish onboarding'), { status: 400 });

    const now = Date.now();
    const onboarding = {
      done: true,
      batches,
      mainBatch: sanitizeText(body.mainBatch || batches[0] || '', 20),
      goal: sanitizeText(body.goal || 'board', 40),
      dailyMinutes: Math.max(10, Math.min(240, Number(body.dailyMinutes) || 30)),
      reminders: body.reminders !== false,
      level: sanitizeText(body.level || 'beginner', 40),
      contactMobile,
      updatedAt: now,
    };

    await firestore.patchDocument('users', identity.uid, {
      displayName: encString(displayName),
      name: encString(displayName),
      contactMobile: encString(contactMobile),
      onboarding: {
        mapValue: {
          fields: {
            done: { booleanValue: true },
            batches: { arrayValue: { values: batches.map(encString) } },
            mainBatch: encString(onboarding.mainBatch),
            goal: encString(onboarding.goal),
            dailyMinutes: { integerValue: String(onboarding.dailyMinutes) },
            reminders: { booleanValue: onboarding.reminders },
            level: encString(onboarding.level),
            contactMobile: encString(contactMobile),
            updatedAt: { integerValue: String(now) },
          },
        },
      },
      updatedAt: { integerValue: String(now) },
    }, ['displayName', 'name', 'contactMobile', 'onboarding', 'updatedAt']);

    return sendJson(req, res, 200, { success: true, onboarding });
  } catch (err) {
    const status = err.status || 500;
    return sendJson(req, res, status, { success: false, error: status < 500 ? err.message || 'Could not save onboarding' : 'Onboarding is temporarily unavailable' });
  }
};
