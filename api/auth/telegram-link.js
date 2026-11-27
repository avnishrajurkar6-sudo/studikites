module.exports = function handler(req, res) {
  res.statusCode = 200;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify({
    success: true,
    message: 'TEST OK — the function is deployed and reachable.',
    method: req.method,
    url: req.url,
    timestamp: Date.now(),
    env: {
      hasFirebaseJson: !!process.env.FIREBASE_SERVICE_ACCOUNT_JSON,
      hasSessionSecret: !!process.env.SESSION_SECRET,
      vercelEnv: process.env.VERCEL_ENV || 'unknown'
    }
  }));
};