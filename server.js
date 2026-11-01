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
const PIN = (() => {
  const supplied = String(process.env.REMOTE_MEDIA_PIN || process.argv[2] || "")
    .replace(/\D/g, "")
    .slice(0, 6);
  // A missing or short code would be trivially guessable (or even empty),
  // so anything that is not exactly six digits is replaced by a random code.
  return supplied.length === 6
    ? supplied
    : crypto.randomInt(100000, 1000000).toString();
})();
const runtimeDir = path.join(
  process.env.LOCALAPPDATA || os.tmpdir(),
  "RemoteMediaControl",
);
const pidFile = path.join(runtimeDir, "listener.pid");
const sessionFile = path.join(runtimeDir, "paired-devices.json");
const sessionTtl = 365 * 24 * 60 * 60 * 1000;
fs.mkdirSync(runtimeDir, { recursive: true });
let ownsPidFile = false;
function writePidFile() {
  try {
    fs.writeFileSync(pidFile, String(process.pid));
    ownsPidFile = true;
  } catch {}
}
process.on("exit", () => {
  // A second instance that failed to bind the port must not delete the pid
  // file of the instance that is actually running.
  if (!ownsPidFile) return;
  try {
    if (fs.readFileSync(pidFile, "utf8").trim() === String(process.pid))
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
  try {
    const temporary = `${sessionFile}.${process.pid}.tmp`;
    fs.writeFileSync(temporary, JSON.stringify([...sessions]), { mode: 0o600 });
    fs.renameSync(temporary, sessionFile);
  } catch (e) {
    console.error("Could not save paired devices:", e.message);
  }
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
let browsersCache = null,
  browsersCheckedAt = 0;
const browserCacheMs = 5 * 60 * 1000;
const appCacheMs = 5 * 60 * 1000;
let appCache = { at: 0, list: [], byId: new Map() },
  appLoading = null;
const pairAttempts = new Map();
const pairMaxFailures = 8,
  pairWindowMs = 10 * 60 * 1000,
  pairLockMs = 5 * 60 * 1000;
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

function ps(action, payload = {}, timeoutMs = 30000) {
  return new Promise((resolve, reject) => {
    let settled = false,
      timer = null;
    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn(value);
    };
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
    timer = setTimeout(() => {
      try {
        child.kill();
      } catch {}
      finish(reject, new Error("Windows did not respond in time."));
    }, timeoutMs);
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (x) => (out += x));
    child.stderr.on("data", (x) => (err += x));
    child.on("error", (e) => finish(reject, e));
    child.on("close", (code) =>
      code === 0
        ? finish(resolve, out.trim())
        : finish(
            reject,
            new Error(err.trim() || `PowerShell exited ${code}`),
          ),
    );
    child.stdin.on("error", () => {});
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
  // Writing to a worker that has just died raises EPIPE on stdin; without a
  // listener that is an uncaught exception and takes the whole listener down.
  child.stdin.on("error", (error) => failMouseWorker(child, error));
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
// Safety net: if the phone vanishes mid-drag, release the left button after 30 s of silence.
function armMouseRelease() {
  clearTimeout(mouseReleaseTimer);
  mouseReleaseTimer = setTimeout(() => {
    mouseControl("mouseLeftUp").catch(() => {});
    mouseDragging = false;
    mouseReleaseTimer = null;
  }, 30000);
  mouseReleaseTimer.unref?.();
}
function mouseControl(action, payload = {}) {
  const child = startMouseWorker(),
    id = String(++mouseSequence);
  return new Promise((resolve, reject) => {
    // The first call compiles the native helper, so allow a generous timeout.
    // A worker that stays silent is killed so the next call starts a new one.
    const timer = setTimeout(() => {
      if (!mouseRequests.delete(id)) return;
      if (mouseWorker === child) {
        mouseWorker = null;
        try {
          child.kill();
        } catch {}
      }
      reject(new Error("Mouse input timed out."));
    }, 20000);
    mouseRequests.set(id, {
      resolve: () => {
        clearTimeout(timer);
        resolve();
      },
      reject: (error) => {
        clearTimeout(timer);
        reject(error);
      },
    });
    child.stdin.write(
      JSON.stringify({ id, action, ...payload }) + "\n",
      (error) => {
        if (error && mouseRequests.has(id)) {
          const pending = mouseRequests.get(id);
          mouseRequests.delete(id);
          pending.reject(error);
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
      if (body.length > 8192) {
        reject(new Error("Request is too large."));
        req.destroy();
      }
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
function clientIp(req) {
  return (req.socket.remoteAddress || "").replace(/^::ffff:/, "");
}
function isLoopback(req) {
  const ip = clientIp(req);
  return ip === "127.0.0.1" || ip === "::1";
}
// DNS rebinding lets a web page in the PC's own browser reach 127.0.0.1 under
// an attacker-controlled hostname. Only answer the QR request when the Host
// header names the loopback address itself.
function hasLoopbackHost(req) {
  const host = String(req.headers.host || "")
    .toLowerCase()
    .replace(/:\d+$/, "");
  return host === "localhost" || host === "127.0.0.1" || host === "[::1]";
}
function pinMatches(candidate) {
  const a = Buffer.from(String(candidate ?? "")),
    b = Buffer.from(PIN);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
function pairLockRemaining(ip) {
  const entry = pairAttempts.get(ip),
    now = Date.now();
  if (!entry) return 0;
  if (entry.lockedUntil > now) return entry.lockedUntil - now;
  if (now - entry.first > pairWindowMs) pairAttempts.delete(ip);
  return 0;
}
function recordPairFailure(ip) {
  const now = Date.now();
  let entry = pairAttempts.get(ip);
  if (!entry || now - entry.first > pairWindowMs)
    entry = { count: 0, first: now, lockedUntil: 0 };
  entry.count++;
  if (entry.count >= pairMaxFailures) {
    entry.lockedUntil = now + pairLockMs;
    entry.count = 0;
    entry.first = now;
  }
  pairAttempts.set(ip, entry);
  if (pairAttempts.size > 500)
    for (const [key, value] of pairAttempts)
      if (value.lockedUntil < now && now - value.first > pairWindowMs)
        pairAttempts.delete(key);
}

// Installed apps come from the Windows Start menu. The phone only ever sees a
// short opaque id; the real launch id stays here, so a paired device can start
// an app that was listed but cannot pass an arbitrary command to Windows.
async function loadApps(force = false) {
  if (!force && appCache.list.length && Date.now() - appCache.at < appCacheMs)
    return appCache;
  if (!appLoading) {
    appLoading = ps("apps", {}, 60000)
      .then((text) => {
        const parsed = JSON.parse(text || "[]");
        const rows = Array.isArray(parsed) ? parsed : [parsed];
        const byId = new Map(),
          list = [];
        for (const row of rows) {
          const name = String(row?.name || "").trim(),
            appId = String(row?.appId || "").trim();
          if (!name || !appId) continue;
          const id = crypto
            .createHash("sha1")
            .update(appId)
            .digest("hex")
            .slice(0, 16);
          if (byId.has(id)) continue;
          byId.set(id, { name, appId });
          list.push({ id, name });
        }
        list.sort((a, b) =>
          a.name.localeCompare(b.name, undefined, {
            sensitivity: "base",
            numeric: true,
          }),
        );
        appCache = { at: Date.now(), list, byId };
        return appCache;
      })
      .finally(() => {
        appLoading = null;
      });
  }
  return appLoading;
}

async function handleRequest(req, res) {
  let url;
  try {
    url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  } catch {
    return json(res, 400, { error: "Bad request." });
  }
  if (req.method === "POST" && url.pathname === "/api/pair") {
    const ip = clientIp(req);
    const locked = pairLockRemaining(ip);
    if (locked > 0) {
      res.setHeader("Retry-After", String(Math.ceil(locked / 1000)));
      return json(res, 429, {
        error: `Too many wrong codes. Try again in ${Math.ceil(locked / 60000)} minute(s).`,
      });
    }
    try {
      const body = await readBody(req);
      if (!pinMatches(body.pin)) {
        recordPairFailure(ip);
        return json(res, 401, { error: "That code did not match." });
      }
      pairAttempts.delete(ip);
      const token = crypto.randomBytes(24).toString("hex");
      sessions.set(token, Date.now() + sessionTtl);
      saveSessions();
      return json(res, 200, { token });
    } catch (e) {
      return json(res, 400, { error: e.message });
    }
  }
  if (req.method === "GET" && url.pathname === "/api/pair-qr") {
    if (!isLoopback(req) || !hasLoopbackHost(req))
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
      if (req.method === "GET" && url.pathname === "/api/apps") {
        const data = await loadApps(url.searchParams.get("refresh") === "1");
        return json(res, 200, { apps: data.list, loadedAt: data.at });
      }
      if (req.method === "GET" && url.pathname === "/api/state") {
        const detectBrowsers =
          url.searchParams.get("full") === "1" ||
          !browsersCache ||
          Date.now() - browsersCheckedAt > browserCacheMs;
        const state = JSON.parse(
          await ps("state", {
            targetWindow: defaultWindow,
            explorerWindow,
            detectBrowsers,
          }),
        );
        if (Array.isArray(state.browsers)) {
          browsersCache = state.browsers;
          browsersCheckedAt = Date.now();
        } else {
          state.browsers = browsersCache || ["default"];
        }
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
          "mouseHome",
          "mouseEnd",
          "mouseZoomIn",
          "mouseZoomOut",
          "mouseZoomReset",
          "mouseGestureZoomIn",
          "mouseGestureZoomOut",
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
          "openApp",
        ];
        if (!allowed.includes(body.action))
          return json(res, 400, { error: "Unknown control." });
        if (body.action === "openApp") {
          const id = String(body.id || "");
          let entry = appCache.byId.get(id);
          // The list may have changed since the phone loaded it; look once more.
          if (!entry) entry = (await loadApps(true)).byId.get(id);
          if (!entry)
            return json(res, 404, {
              error: "That app is no longer in the list. Reload the list and try again.",
            });
          await ps("control", { action: "openApp", appId: entry.appId });
          return json(res, 200, { ok: true, name: entry.name });
        }
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
          armMouseRelease();
        }
        // A drag that is still moving is not idle, so keep the safety release away.
        if (body.action === "mouseMove" && mouseDragging) armMouseRelease();
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
  let rel;
  try {
    rel =
      url.pathname === "/"
        ? "index.html"
        : url.pathname === "/pair-qr"
          ? "pair-qr.html"
          : decodeURIComponent(url.pathname.slice(1));
  } catch {
    return json(res, 400, { error: "Bad request." });
  }
  if (rel.includes("\0")) return json(res, 400, { error: "Bad request." });
  const file = path.resolve(ROOT, "public", rel);
  if (!file.startsWith(path.resolve(ROOT, "public") + path.sep))
    return json(res, 403, { error: "Forbidden." });
  fs.readFile(file, (err, data) => {
    if (err) return json(res, 404, { error: "Not found." });
    res.writeHead(200, {
      "Content-Type": mime[path.extname(file)] || "application/octet-stream",
      "Cache-Control": "no-cache",
      "X-Content-Type-Options": "nosniff",
    });
    res.end(req.method === "HEAD" ? undefined : data);
  });
}

// Any error thrown inside a request must answer that request, not crash the
// listener (an unhandled rejection terminates Node).
const server = http.createServer((req, res) => {
  handleRequest(req, res).catch((e) => {
    console.error("Request failed:", e);
    try {
      if (!res.headersSent)
        json(res, 500, { error: e.message || "Server error." });
      else res.end();
    } catch {}
  });
});
server.on("error", (e) => {
  console.error(
    e.code === "EADDRINUSE"
      ? `\n  Port ${PORT} is already in use. Is RemoteDeck already running?\n`
      : `\n  Could not start the listener: ${e.message}\n`,
  );
  process.exit(1);
});

server.listen(PORT, HOST, () => {
  writePidFile();
  console.log("\n  REMOTE MEDIA CONTROL");
  console.log(`  Pairing code: ${PIN}`);
  console.log(`  On this PC:   http://localhost:${PORT}`);
  for (const ip of localAddresses())
    console.log(`  On your phone: http://${ip}:${PORT}`);
  console.log("\n  Keep this window open while using the remote.\n");
});
