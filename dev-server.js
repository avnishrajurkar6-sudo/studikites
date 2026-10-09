/* Local dev only: serves frontend/ as web root. Never serves dotfiles.
   /api/* requests are proxied to the backend so localhost works end-to-end.
   Usage: node dev-server.js [port]   (default 8090)
   Env: BACKEND=https://...  (default https://studikites.vercel.app) */
const http = require("http");
const https = require("https");
const fs = require("fs");
const path = require("path");
const ROOT = path.join(__dirname, "frontend");
const BACKEND = (process.env.BACKEND || "https://studikites.vercel.app").replace(/\/+$/, "");
const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
};
const server = http.createServer((req, res) => {
  try {
    const u = new URL(req.url, "http://localhost");
    let p = decodeURIComponent(u.pathname);
    if (p.split("/").some((s) => s.startsWith(".") && s.length > 1)) {
      res.writeHead(404, { "Content-Type": "text/plain" });
      res.end("not found");
      return;
    }
    if (p === "/") p = "/index.html";
    if (p === "/api" || p.startsWith("/api/")) return proxyApi(req, res, p);
    let file = path.normalize(path.join(ROOT, p));
    if (!file.startsWith(ROOT)) {
      res.writeHead(403, { "Content-Type": "text/plain" });
      res.end("forbidden");
      return;
    }
    if (!path.extname(file)) file += ".html";
    fs.readFile(file, (err, data) => {
      if (err) {
        res.writeHead(404, { "Content-Type": "text/plain" });
        res.end("not found");
        return;
      }
      res.writeHead(200, {
        "Content-Type": MIME[path.extname(file).toLowerCase()] || "application/octet-stream",
        "Cache-Control": "no-store",
      });
      res.end(data);
    });
  } catch {
    res.writeHead(500, { "Content-Type": "text/plain" });
    res.end("server error");
  }
});
const PORT = Number(process.argv[2] || 8090);
server.listen(PORT, "127.0.0.1", () => console.log(`StudiKitEZ v2 on http://localhost:${PORT}/ (api -> ${BACKEND})`));

/* Minimal reverse proxy: forward /api/* to the backend, stream back verbatim. */
function proxyApi(req, res, p) {
  const u = new URL(req.url, "http://localhost");
  const target = new URL(BACKEND + p + u.search);
  const body = [];
  req.on("data", (c) => body.push(c));
  req.on("end", () => {
    const out = https.request(
      {
        hostname: target.hostname,
        path: target.pathname + target.search,
        method: req.method,
        headers: { Accept: "application/json", "Content-Type": "application/json" },
      },
      (up) => {
        res.writeHead(up.statusCode, {
          "Content-Type": up.headers["content-type"] || "application/json",
          "Cache-Control": "no-store",
          "Access-Control-Allow-Origin": "*",
        });
        up.pipe(res);
      }
    );
    out.on("error", () => {
      res.writeHead(502, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ success: false, error: "Backend unreachable" }));
    });
    out.setTimeout(25000, () => out.destroy());
    out.end(body.length ? Buffer.concat(body) : undefined);
  });
}
