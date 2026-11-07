// Everything that needs Windows itself: volume, windows, files, apps, power.
const path = require("node:path");
const { spawn } = require("node:child_process");
const { JsonLineWorker, cleanMessage } = require("./json-worker");
const { windowsDir } = require("./config");

// Slow, I/O heavy requests get their own process so they never delay status checks and volume changes.
const SLOW_ACTIONS = new Set(["browse", "apps", "diagnostics"]);
const mainHost = new JsonLineWorker({ name: "System host", script: path.join(windowsDir, "host.ps1") });
const slowHost = new JsonLineWorker({ name: "File host", script: path.join(windowsDir, "host.ps1"), timeoutMs: 60000 });
let persistent = true;

function runOnce(action, payload, timeoutMs) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      "powershell.exe",
      ["-NoLogo", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", path.join(windowsDir, "once.ps1"), "-Action", action],
      { windowsHide: true },
    );
    let out = "", err = "", done = false;
    const finish = (fn, value) => { if (!done) { done = true; clearTimeout(timer); fn(value); } };
    const timer = setTimeout(() => { try { child.kill(); } catch {} finish(reject, new Error("Windows did not respond in time.")); }, timeoutMs);
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (x) => (out += x));
    child.stderr.on("data", (x) => (err += x));
    child.on("error", (e) => finish(reject, e));
    child.on("close", (code) => code === 0 ? finish(resolve, out.trim()) : finish(reject, new Error(cleanMessage(err) || `PowerShell exited ${code}`)));
    child.stdin.on("error", () => {});
    child.stdin.end(JSON.stringify(payload));
  });
}

async function ps(action, payload = {}, timeoutMs = 30000) {
  if (persistent) {
    try {
      const reply = await (SLOW_ACTIONS.has(action) ? slowHost : mainHost).call({ action, payload }, timeoutMs);
      if (!reply.ok) throw new Error(reply.error || "Windows control failed.");
      return reply.result ?? "";
    } catch (e) {
      if (!e.startup) throw e;
      persistent = false;
      console.error("The persistent PowerShell host could not start; using one process per action:", e.message);
    }
  }
  return runOnce(action, payload, timeoutMs);
}

const prewarm = () => { try { mainHost.start(); } catch {} };
const stop = () => { mainHost.stop(); slowHost.stop(); };
const status = () => ({
  mode: persistent ? "persistent" : "one process per action",
  system: { running: mainHost.running, ...mainHost.stats },
  files: { running: slowHost.running, ...slowHost.stats },
});

module.exports = { ps, prewarm, stop, status };
