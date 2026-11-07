const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { publicDir } = require("./config");

const MIME = { ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".svg": "image/svg+xml", ".json": "application/json; charset=utf-8" };

function json(res, code, data) {
  const body = JSON.stringify(data);
  res.writeHead(code, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    "Content-Length": Buffer.byteLength(body),
  });
  res.end(body);
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (c) => {
      body += c;
      if (body.length > 8192) { reject(new Error("Request is too large.")); req.destroy(); }
    });
    req.on("end", () => { try { resolve(body ? JSON.parse(body) : {}); } catch { reject(new Error("Invalid request.")); } });
    req.on("error", reject);
  });
}
const clientIp = (req) => (req.socket.remoteAddress || "").replace(/^::ffff:/, "");
const isLoopback = (req) => ["127.0.0.1", "::1"].includes(clientIp(req));
// DNS rebinding lets a web page in the PC's own browser reach 127.0.0.1 under an attacker's hostname,
// so the QR request also requires a Host header that names the loopback address itself.
const hasLoopbackHost = (req) => ["localhost", "127.0.0.1", "[::1]"].includes(String(req.headers.host || "").toLowerCase().replace(/:\d+$/, ""));

function localAddresses() {
  const rank = (name) => (/wi-?fi|wlan|wireless/i.test(name) ? 0 : /^ethernet$/i.test(name) ? 1 : 2);
  return Object.entries(os.networkInterfaces())
    .flatMap(([name, entries]) => (entries || []).filter((x) => x && x.family === "IPv4" && !x.internal).map((x) => ({ address: x.address, rank: rank(name) })))
    .sort((a, b) => a.rank - b.rank)
    .map((x) => x.address);
}

function serveStatic(req, res, url) {
  let rel;
  try {
    rel = url.pathname === "/" ? "index.html" : url.pathname === "/pair-qr" ? "pair-qr.html" : decodeURIComponent(url.pathname.slice(1));
  } catch { return json(res, 400, { error: "Bad request." }); }
  if (rel.includes("\0")) return json(res, 400, { error: "Bad request." });
  const file = path.resolve(publicDir, rel);
  if (!file.startsWith(publicDir + path.sep)) return json(res, 403, { error: "Forbidden." });
  fs.readFile(file, (err, data) => {
    if (err) return json(res, 404, { error: "Not found." });
    res.writeHead(200, { "Content-Type": MIME[path.extname(file)] || "application/octet-stream", "Cache-Control": "no-cache", "X-Content-Type-Options": "nosniff" });
    res.end(req.method === "HEAD" ? undefined : data);
  });
}

module.exports = { json, readBody, clientIp, isLoopback, hasLoopbackHost, localAddresses, serveStatic };
