// Settings, diagnostics and the keyboard self-test.
const path = require("node:path");
const { spawn } = require("node:child_process");
const { VERSION, PORT, windowsDir, players } = require("../config");
const { json } = require("../http-util");
const { ps, status: systemStatus } = require("../system");
const input = require("../input");
const settings = require("../settings");
const sessions = require("../sessions");

// Runs windows/self-test.ps1 in its own (STA) PowerShell: it opens a small window and types into it.
function runSelfTest() {
  return new Promise((resolve, reject) => {
    const child = spawn("powershell.exe", ["-NoLogo", "-NoProfile", "-STA", "-ExecutionPolicy", "Bypass", "-File", path.join(windowsDir, "self-test.ps1")], { windowsHide: true });
    let out = "", err = "";
    const timer = setTimeout(() => { try { child.kill(); } catch {} reject(new Error("The keyboard test did not finish.")); }, 45000);
    child.stdout.setEncoding("utf8"); child.stderr.setEncoding("utf8");
    child.stdout.on("data", (x) => (out += x));
    child.stderr.on("data", (x) => (err += x));
    child.on("error", (e) => { clearTimeout(timer); reject(e); });
    child.on("close", (code) => {
      clearTimeout(timer);
      try { resolve(JSON.parse(out.trim())); } catch { reject(new Error(err.trim() || `The keyboard test failed (code ${code}).`)); }
    });
  });
}

module.exports = [
  { method: "GET", path: "/api/settings", auth: true, handler: ({ res }) => json(res, 200, settings.get()) },
  {
    method: "POST", path: "/api/settings", auth: true,
    handler({ res, body }) {
      const next = settings.update(body);
      input.applySettings();
      return json(res, 200, next);
    },
  },
  {
    method: "GET", path: "/api/diagnostics", auth: true,
    async handler({ res }) {
      let windows = null, windowsError = null;
      try { windows = JSON.parse(await ps("diagnostics", {})); } catch (e) { windowsError = e.message; }
      return json(res, 200, {
        version: VERSION, port: PORT, node: process.version, uptimeSeconds: Math.round(process.uptime()), pairedDevices: sessions.count(),
        players, settings: settings.get(), system: systemStatus(), input: input.status(), windows, windowsError,
      });
    },
  },
  {
    method: "POST", path: "/api/input-test", auth: true,
    async handler({ res }) {
      const result = await runSelfTest();
      // Use whatever works on this PC from now on.
      if (result.anyWorks && result.recommend) { settings.update(result.recommend); input.applySettings(); }
      return json(res, 200, { ...result, settings: settings.get() });
    },
  },
];
