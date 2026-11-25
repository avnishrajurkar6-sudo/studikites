/* Public identity, runtime config, and health endpoints. */
const { BRAND, VERSION, sendJson, sendOptions, requireMethod, rateLimit } = require("../lib/http");

const DEFAULTS = {
  SMEXGOD: {
    apiKey: "AIzaSyAzxBCRdwK4NIyGwkzBrV9ev_53MJIfsOM",
    authDomain: "smexgod.firebaseapp.com",
    projectId: "smexgod",
    storageBucket: "smexgod.firebasestorage.app",
    messagingSenderId: "34615632505",
    appId: "1:34615632505:web:6e7b5c39e847854ded6aa8",
  },
  STUDIKI: {
    apiKey: "AIzaSyCG2zFEsE5Fr8Vx-5of_PL0xQeP773MNFM",
    authDomain: "studiki.firebaseapp.com",
    projectId: "studiki",
    storageBucket: "studiki.firebasestorage.app",
    messagingSenderId: "730581787323",
    appId: "1:730581787323:web:934a0c33400c0b8c14bf9e",
    measurementId: "G-X0ZH9VYZ9B",
  },
  SITE_URL: "https://studikitesz.pages.dev",
  TELEGRAM_URL: "https://t.me/studikitez",
};

function sendRuntimeConfig(req, res) {
  if (!rateLimit(req, res, "config", 120, 60_000)) return;
  const e = process.env;
  const pick = (value, fallback) => value === undefined || value === "" ? fallback : value;
  const config = {
    SMEXGOD: {
      apiKey: pick(e.FIREBASE_SMEXGOD_API_KEY, DEFAULTS.SMEXGOD.apiKey),
      authDomain: pick(e.FIREBASE_SMEXGOD_AUTH_DOMAIN, DEFAULTS.SMEXGOD.authDomain),
      projectId: pick(e.FIREBASE_SMEXGOD_PROJECT_ID, DEFAULTS.SMEXGOD.projectId),
      storageBucket: pick(e.FIREBASE_SMEXGOD_STORAGE_BUCKET, DEFAULTS.SMEXGOD.storageBucket),
      messagingSenderId: pick(e.FIREBASE_SMEXGOD_SENDER_ID, DEFAULTS.SMEXGOD.messagingSenderId),
      appId: pick(e.FIREBASE_SMEXGOD_APP_ID, DEFAULTS.SMEXGOD.appId),
    },
    STUDIKI: {
      apiKey: pick(e.FIREBASE_STUDIKI_API_KEY, DEFAULTS.STUDIKI.apiKey),
      authDomain: pick(e.FIREBASE_STUDIKI_AUTH_DOMAIN, DEFAULTS.STUDIKI.authDomain),
      projectId: pick(e.FIREBASE_STUDIKI_PROJECT_ID, DEFAULTS.STUDIKI.projectId),
      storageBucket: pick(e.FIREBASE_STUDIKI_STORAGE_BUCKET, DEFAULTS.STUDIKI.storageBucket),
      messagingSenderId: pick(e.FIREBASE_STUDIKI_SENDER_ID, DEFAULTS.STUDIKI.messagingSenderId),
      appId: pick(e.FIREBASE_STUDIKI_APP_ID, DEFAULTS.STUDIKI.appId),
      measurementId: pick(e.FIREBASE_STUDIKI_MEASUREMENT_ID, DEFAULTS.STUDIKI.measurementId),
      databaseURL: pick(e.FIREBASE_STUDIKI_DATABASE_URL, ""),
    },
    SITE_URL: pick(e.SITE_URL, DEFAULTS.SITE_URL),
    TELEGRAM_URL: pick(e.TELEGRAM_URL, DEFAULTS.TELEGRAM_URL),
    BATCHES_URL: "https://nt.studybeepro.site/batches.json",
    BRAND: { name: BRAND, engine: `${BRAND} Engine`, version: VERSION },
  };
  return sendJson(req, res, 200, config);
}

module.exports = async function handler(req, res) {
  if (req.method === "OPTIONS") return sendOptions(req, res);
  if (!requireMethod(req, res, ["GET"])) return;
  const route = req.query && req.query.__route;
  if (route === "health") {
    if (!rateLimit(req, res, "health", 120, 60_000)) return;
    return sendJson(req, res, 200, {
      ok: true,
      service: "studikitez-backend",
      engine: `${BRAND} Engine`,
      brand: BRAND,
      time: new Date().toISOString(),
    });
  }
  if (route === "config") {
    try {
      return sendRuntimeConfig(req, res);
    } catch (err) {
      return sendJson(req, res, err.status || 500, { success: false, error: "Config unavailable" });
    }
  }
  if (!rateLimit(req, res, "avkings", 60, 60_000)) return;
  return sendJson(req, res, 200, {
    success: true,
    brand: BRAND,
    engine: `${BRAND} Engine`,
    version: VERSION,
    product: "StudiKitEZ",
    tagline: "Learn calmly. Built by AVkings.",
    endpoints: [
      "/api/config",
      "/api/health",
      "/api/courses/batches",
      "/api/courses/content",
      "/api/media/play",
      "/api/media/live",
      "/api/auth/send-otp",
      "/api/auth/verify-otp",
      "/api/auth/is-admin",
      "/api/auth/profile",
      "/api/auth/telegram-link",
    ],
    time: new Date().toISOString(),
  });
};
