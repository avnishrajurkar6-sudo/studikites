/* GET /api/diag — deployment health WITHOUT secrets.
   Reports only booleans, hosts and latencies. Paste this output when reporting bugs. */
const { sendJson, sendOptions, requireMethod, mediaRoutes, fetchUpstream, otpBase, mirrorNig } = require("../lib/http");

module.exports = async function handler(req, res) {
  if (req.method === "OPTIONS") return sendOptions(req, res);
  if (!requireMethod(req, res, ["GET"])) return;
  const out = {
    ok: true,
    time: new Date().toISOString(),
    env: {
      sessionSecret: !!process.env.SESSION_SECRET,
      studikiKey: !!process.env.FIREBASE_STUDIKI_API_KEY,
      smexgodKey: !!process.env.FIREBASE_SMEXGOD_API_KEY,
      adsense: !!(process.env.ADSENSE_CLIENT || "ca-pub-7694333485336687"),
      rtdb: !!process.env.FIREBASE_STUDIKI_DATABASE_URL,
    },
    checks: {},
  };
  async function check(name, fn) {
    const t0 = Date.now();
    try {
      out.checks[name] = Object.assign({ ok: true, ms: Date.now() - t0 }, await fn());
    } catch (e) {
      out.checks[name] = { ok: false, ms: Date.now() - t0, error: (e && e.message) || "failed" };
    }
  }
  let routes = null;
  try { routes = mediaRoutes(); } catch (e) { routes = null; }
  await Promise.all([
    check("otp", async () => {
      const r = await fetchUpstream(`${otpBase()}/api/check-user`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ping: 1 }), timeout: 4000,
      });
      return { status: r.status, reachable: true };
    }),
    check("nig", async () => {
      if (!routes) throw new Error("routes unconfigured");
      const r = await fetchUpstream(`${routes.nig}?content=105&folder=0`, { timeout: 4000 });
      return { status: r.status, hasData: !!(r.json && r.json.data) };
    }),
    check("mirror", async () => {
      const r = await fetchUpstream(`${mirrorNig()}/?content=105&folder=0`, { timeout: 4000 });
      return { status: r.status, hasData: !!(r.json && r.json.data) };
    }),
    check("play", async () => {
      if (!routes) throw new Error("routes unconfigured");
      const r = await fetchUpstream(`${routes.play}?action=classes&type=1&course_id=105&key=DIAG&device_id=diag`, { timeout: 4000 });
      return { status: r.status, json: !!r.json };
    }),
  ]);
  return sendJson(req, res, 200, out);
};
