const http = require("node:http");
const fs = require("node:fs");
const { PORT, HOST, PIN, pidFile } = require("./config");
const { json, readBody, localAddresses, serveStatic } = require("./http-util");
const sessions = require("./sessions");
const system = require("./system");
const input = require("./input");
const routes = require("./routes");

// The pid file lets the tray find this process; a second copy that lost the port must not touch it.
let ownsPidFile = false;
process.on("exit", () => {
  system.stop();
  input.stop();
  if (!ownsPidFile) return;
  try { if (fs.readFileSync(pidFile, "utf8").trim() === String(process.pid)) fs.unlinkSync(pidFile); } catch {}
});

async function handleRequest(req, res) {
  let url;
  try { url = new URL(req.url, `http://${req.headers.host || "localhost"}`); } catch { return json(res, 400, { error: "Bad request." }); }
  const route = routes.find((r) => r.method === req.method && r.path === url.pathname);
  if (route) {
    if (route.auth && !sessions.isPaired(req)) return json(res, 401, { error: "Pair this device first." });
    try {
      const body = req.method === "POST" ? await readBody(req) : undefined;
      return await route.handler({ req, res, url, body });
    } catch (e) {
      const unreadable = e.message === "Request is too large." || e.message === "Invalid request.";
      return json(res, unreadable ? 400 : 500, { error: e.message || "Windows control failed." });
    }
  }
  if (url.pathname.startsWith("/api/")) return sessions.isPaired(req) ? json(res, 404, { error: "Not found." }) : json(res, 401, { error: "Pair this device first." });
  if (req.method !== "GET" && req.method !== "HEAD") return json(res, 405, { error: "Method not allowed." });
  return serveStatic(req, res, url);
}

function start() {
  // Any error thrown inside a request must answer that request, not crash the listener.
  const server = http.createServer((req, res) => {
    handleRequest(req, res).catch((e) => {
      console.error("Request failed:", e);
      try { if (!res.headersSent) json(res, 500, { error: e.message || "Server error." }); else res.end(); } catch {}
    });
  });
  server.on("error", (e) => {
    console.error(e.code === "EADDRINUSE" ? `\n  Port ${PORT} is already in use. Is RemoteDeck already running?\n` : `\n  Could not start the listener: ${e.message}\n`);
    process.exit(1);
  });
  server.listen(PORT, HOST, () => {
    try { fs.writeFileSync(pidFile, String(process.pid)); ownsPidFile = true; } catch {}
    system.prewarm();
    console.log("\n  REMOTE MEDIA CONTROL");
    console.log(`  Pairing code: ${PIN}`);
    console.log(`  On this PC:   http://localhost:${PORT}`);
    for (const ip of localAddresses()) console.log(`  On your phone: http://${ip}:${PORT}`);
    console.log("\n  Keep this window open while using the remote.\n");
  });
}

module.exports = { start };
