/* Public runtime config only. Browser keys must reach the client to init Firebase;
   real protection is Firestore rules + Firebase API-key restrictions + App Check.
   Values below are public browser identifiers (same as the old committed env.js);
   every field is overridable via env without redeploying code. */
const { sendJson, sendOptions, requireMethod } = require("../lib/http");

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
  SITE_URL: "https://studikites.vercel.app",
  TELEGRAM_URL: "https://t.me/studikitez",
};

module.exports = async function handler(req, res) {
  if (req.method === "OPTIONS") return sendOptions(req, res);
  if (!requireMethod(req, res, ["GET"])) return;
  try {
    const e = process.env;
    const pick = (v, d) => (v === undefined || v === "" ? d : v);
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
        messagingSenderId: pick(e.FIREBASE_STUDIKI_SENDER_ID, DEFAULTS.STUDIKI.senderId || DEFAULTS.STUDIKI.messagingSenderId),
        appId: pick(e.FIREBASE_STUDIKI_APP_ID, DEFAULTS.STUDIKI.appId),
        measurementId: pick(e.FIREBASE_STUDIKI_MEASUREMENT_ID, DEFAULTS.STUDIKI.measurementId),
        databaseURL: pick(e.FIREBASE_STUDIKI_DATABASE_URL, ""),
      },
      SITE_URL: pick(e.SITE_URL, DEFAULTS.SITE_URL),
      TELEGRAM_URL: pick(e.TELEGRAM_URL, DEFAULTS.TELEGRAM_URL),
      ADSENSE_CLIENT: pick(e.ADSENSE_CLIENT, "ca-pub-7694333485336687"),
      ADSENSE_SLOTS: {
        banner: pick(e.ADSENSE_SLOT_BANNER, "1840322518"),
        feed: pick(e.ADSENSE_SLOT_FEED, "3696329666"),
        inarticle: pick(e.ADSENSE_SLOT_INARTICLE, "6026979535"),
        multiplex: pick(e.ADSENSE_SLOT_MULTIPLEX, "7502133723"),
      },
      ADSENSE_FEED_KEY: pick(e.ADSENSE_FEED_KEY, "-fb+5w+4e-db+86"),
    };
    return sendJson(req, res, 200, config);
  } catch (err) {
    return sendJson(req, res, err.status || 500, { success: false, error: err.message || "Config unavailable" });
  }
};
