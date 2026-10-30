const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const crypto = require("node:crypto");
const { spawn } = require("node:child_process");
const QRCode = require("qrcode");

const PORT = Number(process.env.PORT || 8765);
const HOST = process.env.HOST || "0.0.0.0";
const ROOT = __dirname;
const PIN = (
  process.env.REMOTE_MEDIA_PIN ||
  process.argv[2] ||
  crypto.randomInt(100000, 1000000).toString()
)
  .replace(/\D/g, "")
  .slice(0, 6);
const runtimeDir = path.join(
  process.env.LOCALAPPDATA || os.tmpdir(),
  "RemoteMediaControl",
);
const pidFile = path.join(runtimeDir, "listener.pid");
const sessionFile = path.join(runtimeDir, "paired-devices.json");
const sessionTtl = 365 * 24 * 60 * 60 * 1000;
fs.mkdirSync(runtimeDir, { recursive: true });
fs.writeFileSync(pidFile, String(process.pid));
process.on("exit", () => {
  try {
    if (fs.readFileSync(pidFile, "utf8") === String(process.pid))
      fs.unlinkSync(pidFile);
  } catch {}
});
const sessions = new Map();
try {
  const stored = JSON.parse(fs.readFileSync(sessionFile, "utf8"));
  const now = Date.now();
  for (const [token, expiresAt] of Array.isArray(stored) ? stored : []) {
    if (
      /^[a-f0-9]{48}$/i.test(token) &&
      Number.isFinite(expiresAt) &&
      expiresAt > now
    )
      sessions.set(token, expiresAt);
  }
} catch {}
function saveSessions() {
  const temporary = `${sessionFile}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify([...sessions]), { mode: 0o600 });
  fs.renameSync(temporary, sessionFile);
}
let defaultWindow = 0;
let explorerWindow = 0;
let browserWindow = 0;
let mouseDragging = false;
let mouseReleaseTimer = null;
let mouseWorker = null,
  mouseOutput = "",
  mouseSequence = 0;
const mouseRequests = new Map();
const players = [
  "vlc",
  "musicbee",
  "potplayer",
  "mpc-hc",
  "mpc-hc64",
  "wmplayer",
];
const mediaExtensions = new Set([
  ".mp3",
  ".mp4",
  ".m4a",
  ".m4v",
  ".mkv",
  ".avi",
  ".mov",
  ".wmv",
  ".mpeg",
  ".mpg",
  ".webm",
  ".ts",
  ".flac",
  ".wav",
  ".aac",
  ".ogg",
  ".opus",
  ".wma",
]);

function ps(action, payload = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      "powershell.exe",
      [
        "-NoLogo",
        "-NoProfile",
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        path.join(ROOT, "windows.ps1"),
        "-Action",
        action,
      ],
      { windowsHide: true },
    );
    let out = "",
      err = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (x) => (out += x));
    child.stderr.on("data", (x) => (err += x));
    child.on("error", reject);
    child.on("close", (code) =>
      code === 0
        ? resolve(out.trim())
        : reject(new Error(err.trim() || `PowerShell exited ${code}`)),
    );
    child.stdin.end(JSON.stringify(payload));
  });
}
function startMouseWorker() {
  if (mouseWorker && !mouseWorker.killed) return mouseWorker;
  const child = spawn(
    "powershell.exe",
    [
      "-NoLogo",
      "-NoProfile",
      "-NonInteractive",
      "-ExecutionPolicy",
      "Bypass",
      "-File",
      path.join(ROOT, "mouse-worker.ps1"),
    ],
    { windowsHide: true },
  );
  mouseWorker = child;
  mouseOutput = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk) => {
    mouseOutput += chunk;
    let newline;
    while ((newline = mouseOutput.indexOf("\n")) >= 0) {
      const line = mouseOutput.slice(0, newline).trim();
      mouseOutput = mouseOutput.slice(newline + 1);
      if (!line) continue;
      try {
        const response = JSON.parse(line),
          pending = mouseRequests.get(response.id);
        if (!pending) continue;
        mouseRequests.delete(response.id);
        response.ok
          ? pending.resolve()
          : pending.reject(new Error(response.error || "Mouse input failed."));
      } catch {}
    }
  });
  child.stderr.on("data", (chunk) => {
    child.lastError = (child.lastError || "") + chunk;
  });
  child.on("error", (error) => failMouseWorker(child, error));
  child.on("close", (code) =>
    failMouseWorker(
      child,
      new Error(child.lastError?.trim() || `Mouse worker exited (${code}).`),
    ),
  );
  return child;
}
function failMouseWorker(child, error) {
  if (mouseWorker === child) mouseWorker = null;
  for (const [id, pending] of mouseRequests) {
    mouseRequests.delete(id);
    pending.reject(error);
  }
}
function mouseControl(action, payload = {}) {
  const child = startMouseWorker(),
    id = String(++mouseSequence);
  return new Promise((resolve, reject) => {
    mouseRequests.set(id, { resolve, reject });
    child.stdin.write(
      JSON.stringify({ id, action, ...payload }) + "\n",
      (error) => {
        if (error && mouseRequests.has(id)) {
          mouseRequests.delete(id);
          reject(error);
        }
      },
    );
  });
}
process.on("exit", () => {
  if (mouseWorker && !mouseWorker.killed) mouseWorker.kill();
});

function json(res, code, data) {
  const body = JSON.stringify(data);
  res.writeHead(code, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "Content-Length": Buffer.byteLength(body),
  });
  res.end(body);
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (c) => {
      body += c;
      if (body.length > 8192) req.destroy();
    });
    req.on("end", () => {
      try {
        resolve(JSON.parse(body || "{}"));
      } catch {
        reject(new Error("Invalid JSON"));
      }
    });
    req.on("error", reject);
  });
}
function paired(req) {
  const id = req.headers.authorization?.replace(/^Bearer\s+/i, "");
  if (!id || !sessions.has(id)) return false;
  const expiresAt = sessions.get(id),
    now = Date.now();
  if (expiresAt <= now) {
    sessions.delete(id);
    saveSessions();
    return false;
  }
  if (expiresAt - now < sessionTtl / 2) {
    sessions.set(id, now + sessionTtl);
    saveSessions();
  }
  return true;
}
function localAddresses() {
  const rank = (name) =>
    /wi-?fi|wlan|wireless/i.test(name) ? 0 : /^ethernet$/i.test(name) ? 1 : 2;
  return Object.entries(os.networkInterfaces())
    .flatMap(([name, entries]) =>
      (entries || [])
        .filter((x) => x && x.family === "IPv4" && !x.internal)
        .map((x) => ({ address: x.address, rank: rank(name) })),
    )
    .sort((a, b) => a.rank - b.rank)
    .map((x) => x.address);
}
const mime = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
};
function isLoopback(req) {
  const ip = (req.socket.remoteAddress || "").replace(/^::ffff:/, "");
  return ip === "127.0.0.1" || ip === "::1";
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  if (req.method === "POST" && url.pathname === "/api/pair") {
    try {
      const body = await readBody(req);
      if (body.pin !== PIN)
        return json(res, 401, { error: "That code did not match." });
      const token = crypto.randomBytes(24).toString("hex");
      sessions.set(token, Date.now() + sessionTtl);
      saveSessions();
      return json(res, 200, { token });
    } catch (e) {
      return json(res, 400, { error: e.message });
    }
  }
  if (req.method === "GET" && url.pathname === "/api/pair-qr") {
    if (!isLoopback(req))
      return json(res, 403, {
        error:
          "Open the QR page on the Windows PC to protect the pairing code.",
      });
    try {
      const host = localAddresses()[0];
      if (!host)
        return json(res, 503, {
          error: "No active Wi-Fi or Ethernet IPv4 address was found.",
        });
      const pairing = {
        type: "remote-media-control-pairing",
        version: 1,
        host,
        port: PORT,
        pairing_code: PIN,
      };
      const svg = await QRCode.toString(JSON.stringify(pairing), {
        type: "svg",
        errorCorrectionLevel: "Q",
        margin: 3,
        color: { dark: "#12151e", light: "#ffffff" },
      });
      return json(res, 200, { ...pairing, svg });
    } catch (e) {
      return json(res, 500, {
        error: e.message || "Could not create the pairing QR.",
      });
    }
  }
  if (url.pathname.startsWith("/api/")) {
    if (!paired(req))
      return json(res, 401, { error: "Pair this device first." });
    try {
      if (req.method === "GET" && url.pathname === "/api/files") {
        const requested = url.searchParams.get("path") || "";
        return json(
          res,
          200,
          JSON.parse(
            await ps("browse", {
              path: requested,
              mediaExtensions: [...mediaExtensions],
            }),
          ),
        );
      }
      if (req.method === "GET" && url.pathname === "/api/state") {
        const state = JSON.parse(
          await ps("state", {
            targetWindow: defaultWindow,
            explorerWindow,
          }),
        );
        if (Number.isSafeInteger(state.foregroundWindow) && state.foregroundWindow > 0) {
          defaultWindow = state.foregroundWindow;
        } else if (!state.targetWindowExists) {
          defaultWindow = 0;
        }
        if (Number.isSafeInteger(state.foregroundExplorerWindow) && state.foregroundExplorerWindow > 0) {
          explorerWindow = state.foregroundExplorerWindow;
        } else if (!state.explorerTargetWindowExists) {
          explorerWindow = 0;
        }
        state.explorerReady = !!explorerWindow;
        state.defaultAppReady = !!defaultWindow;
        state.browserReady = !!browserWindow;
        state.mouseDragging = mouseDragging;
        return json(res, 200, state);
      }
      if (req.method === "POST" && url.pathname === "/api/control") {
        const body = await readBody(req);
        const allowed = [
          "playPause",
          "play",
          "pause",
          "next",
          "previous",
          "seekForward",
          "seekBackward",
          "seekSmallForward",
          "seekSmallBackward",
          "seekLargeForward",
          "seekLargeBackward",
          "toggleFullscreen",
          "defaultScrollUp",
          "defaultScrollDown",
          "defaultPrevious",
          "defaultNext",
          "defaultArrowUp",
          "defaultArrowDown",
          "defaultArrowLeft",
          "defaultArrowRight",
          "defaultHome",
          "defaultEnd",
          "defaultMinimize",
          "defaultMaximize",
          "defaultFullscreen",
          "defaultRestore",
          "defaultClose",
          "explorerUp",
          "explorerDown",
          "explorerLeft",
          "explorerRight",
          "explorerTab",
          "explorerShiftTab",
          "explorerEnter",
          "explorerClose",
          "browserOpen",
          "browserBack",
          "browserForward",
          "browserReload",
          "browserHome",
          "browserMinimize",
          "browserMaximize",
          "browserFullscreen",
          "browserRestore",
          "browserClose",
          "browserArrowUp",
          "browserArrowDown",
          "browserArrowLeft",
          "browserArrowRight",
          "browserScrollUp",
          "browserScrollDown",
          "browserTab",
          "browserShiftTab",
          "browserEnter",
          "browserEscape",
          "browserCloseTab",
          "mouseMove",
          "mouseLeftDown",
          "mouseLeftUp",
          "mouseLeftClick",
          "mouseRightClick",
          "mouseDoubleClick",
          "mouseMiddleClick",
          "mouseScrollUp",
          "mouseScrollDown",
          "keyboardPress",
          "systemVolume",
          "systemMute",
          "playerVolume",
          "playerMute",
          "openPlayer",
          "closePlayer",
          "openFile",
          "openDefaultFile",
          "openFolder",
        ];
        if (!allowed.includes(body.action))
          return json(res, 400, { error: "Unknown control." });
        const player = players.includes(String(body.player || "").toLowerCase())
          ? String(body.player).toLowerCase()
          : "";
        const value = Number.isFinite(Number(body.value))
          ? Math.max(0, Math.min(100, Number(body.value)))
          : 0;
        const filePath = String(body.path || "").slice(0, 2048);
        if (body.action === "keyboardPress") {
          const key = String(body.key || "");
          const validKey =
            /^(?:[A-Z]|[0-9]|F(?:[1-9]|1[0-9]|2[0-4])|NUM[0-9]|NUMADD|NUMSUBTRACT|NUMMULTIPLY|NUMDIVIDE|NUMDECIMAL|NUMENTER|SPACE|ENTER|TAB|ESCAPE|BACKSPACE|DELETE|INSERT|HOME|END|PAGEUP|PAGEDOWN|UP|DOWN|LEFT|RIGHT|CAPSLOCK|NUMLOCK|SCROLLLOCK|PRINTSCREEN|PAUSE|EQUALS|MINUS|COMMA|PERIOD|SLASH|BACKSLASH|SEMICOLON|QUOTE|LBRACKET|RBRACKET|BACKQUOTE|WIN|ALTGR|MENU)$/;
          if (!validKey.test(key))
            return json(res, 400, { error: "Unsupported keyboard key." });
        }
        if (
          ["openPlayer", "closePlayer", "openFile"].includes(body.action) &&
          !player
        )
          return json(res, 400, { error: "Choose a player first." });
        const explorerAction = String(body.action).startsWith("explorer");
        const browserAction =
          String(body.action).startsWith("browser") &&
          body.action !== "browserOpen";
        const targetWindow = explorerAction
          ? explorerWindow
          : browserAction
            ? browserWindow
            : Number.isSafeInteger(defaultWindow)
              ? defaultWindow
              : 0;
        const browser = [
          "default",
          "edge",
          "chrome",
          "firefox",
          "brave",
        ].includes(String(body.browser || "").toLowerCase())
          ? String(body.browser).toLowerCase()
          : "default";
        const browserUrl = String(body.url || "")
          .trim()
          .slice(0, 2048);
        const deltaX = Math.max(-1200, Math.min(1200, Number(body.dx) || 0));
        const deltaY = Math.max(-1200, Math.min(1200, Number(body.dy) || 0));
        const result = String(body.action).startsWith("mouse")
          ? await mouseControl(body.action, { dx: deltaX, dy: deltaY })
          : await ps("control", {
              action: body.action,
              key: String(body.key || ""),
              modifiers: {
                ctrl: body.modifiers?.ctrl === true,
                alt: body.modifiers?.alt === true,
                shift: body.modifiers?.shift === true,
                win: body.modifiers?.win === true,
              },
              player,
              value,
              path: filePath,
              targetWindow,
              browser,
              url: browserUrl,
              dx: deltaX,
              dy: deltaY,
              mediaExtensions: [...mediaExtensions],
            });
        if (body.action === "openDefaultFile") {
          defaultWindow = Number.parseInt(result, 10) || 0;
          if (!defaultWindow)
            return json(res, 500, {
              error:
                "The default app opened, but its window could not be targeted.",
            });
        }
        if (body.action === "defaultClose") defaultWindow = 0;
        if (body.action === "openFolder") {
          explorerWindow = Number.parseInt(result, 10) || 0;
          if (!explorerWindow)
            return json(res, 500, {
              error: "Explorer opened, but its window could not be targeted.",
            });
        }
        if (body.action === "explorerClose") explorerWindow = 0;
        if (body.action === "browserOpen") {
          browserWindow = Number.parseInt(result, 10) || 0;
          if (!browserWindow)
            return json(res, 500, {
              error:
                "The browser opened, but its window could not be targeted.",
            });
        }
        if (body.action === "browserClose") browserWindow = 0;
        if (body.action === "mouseLeftDown") {
          mouseDragging = true;
          clearTimeout(mouseReleaseTimer);
          mouseReleaseTimer = setTimeout(() => {
            mouseControl("mouseLeftUp").catch(() => {});
            mouseDragging = false;
            mouseReleaseTimer = null;
          }, 30000);
          mouseReleaseTimer.unref?.();
        }
        if (body.action === "mouseLeftUp") {
          mouseDragging = false;
          clearTimeout(mouseReleaseTimer);
          mouseReleaseTimer = null;
        }
        return json(res, 200, { ok: true });
      }
      if (req.method === "POST" && url.pathname === "/api/unpair") {
        if (
          sessions.delete(req.headers.authorization?.replace(/^Bearer\s+/i, ""))
        )
          saveSessions();
        return json(res, 200, { ok: true });
      }
      return json(res, 404, { error: "Not found." });
    } catch (e) {
      return json(res, 500, { error: e.message || "Windows control failed." });
    }
  }
  if (req.method !== "GET" && req.method !== "HEAD")
    return json(res, 405, { error: "Method not allowed." });
  const rel =
    url.pathname === "/"
      ? "index.html"
      : url.pathname === "/pair-qr"
        ? "pair-qr.html"
        : decodeURIComponent(url.pathname.slice(1));
  const file = path.resolve(ROOT, "public", rel);
  if (!file.startsWith(path.resolve(ROOT, "public") + path.sep))
    return json(res, 403, { error: "Forbidden." });
  fs.readFile(file, (err, data) => {
    if (err) return json(res, 404, { error: "Not found." });
    res.writeHead(200, {
      "Content-Type": mime[path.extname(file)] || "application/octet-stream",
      "Cache-Control": "no-cache",
    });
    res.end(req.method === "HEAD" ? undefined : data);
  });
});

server.listen(PORT, HOST, () => {
  console.log("\n  REMOTE MEDIA CONTROL");
  console.log(`  Pairing code: ${PIN}`);
  console.log(`  On this PC:   http://localhost:${PORT}`);
  for (const ip of localAddresses())
    console.log(`  On your phone: http://${ip}:${PORT}`);
  console.log("\n  Keep this window open while using the remote.\n");
});
