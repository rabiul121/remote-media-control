const path = require("node:path");
const ROOT = path.resolve(__dirname, "..", "..");
const FB = process.env.FAKE_PS_DIR;                      // where the fake PowerShell logs and reads its switches
const TMP = process.env.TEST_TMP || require("node:os").tmpdir();
const { spawn } = require("node:child_process"); const fs = require("node:fs"); const http = require("node:http");
let pass = 0, fail = 0; const ok = (c, m) => { c ? pass++ : fail++; console.log((c ? "PASS " : "FAIL ") + m); };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const rd = f => fs.existsSync(FB + "/" + f) ? fs.readFileSync(FB + "/" + f, "utf8").trim().split("\n").filter(Boolean) : [];
function boot(port, extraEnv = {}) {
  fs.rmSync(path.join(TMP, "local" + port), { recursive: true, force: true });
  const env = { ...process.env, PATH: FB + ":" + process.env.PATH, LOCALAPPDATA: path.join(TMP, "local" + port), PORT: String(port), REMOTE_MEDIA_PIN: "222222", ...extraEnv };
  const srv = spawn("node", ["server.js"], { cwd: ROOT, env }); let log = ""; srv.stdout.on("data", d => log += d); srv.stderr.on("data", d => log += d);
  const raw = (path, { method = "GET", headers = {}, body } = {}) => new Promise((res, rej) => { const r = http.request({ host: "127.0.0.1", port, path, method, headers }, x => { let b = ""; x.on("data", c => b += c); x.on("end", () => { let j; try { j = JSON.parse(b) } catch {} res({ status: x.statusCode, json: j, text: b }) }) }); r.on("error", rej); if (body) r.write(body); r.end(); });
  const api = { token: null, srv, get log() { return log; },
    call: (p, o = {}) => raw(p, { ...o, headers: { "Content-Type": "application/json", ...(api.token ? { Authorization: "Bearer " + api.token } : {}), ...(o.headers || {}) } }),
    ctl: (b) => api.call("/api/control", { method: "POST", body: JSON.stringify(b) }), raw };
  return api;
}
async function pair(s) { await sleep(1300); s.token = (await s.raw("/api/pair", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ pin: "222222" }) })).json.token; }
(async () => {
  for (const f of ["calls.log", "worker.log", "starts.log", "state.extra", "input.fail", "selftest.blocked"]) fs.rmSync(FB + "/" + f, { force: true });
  let s = boot(18771); await pair(s);

  // ---- persistent host ----
  for (let i = 0; i < 8; i++) await s.call("/api/state");
  await s.call("/api/files"); await s.call("/api/apps"); await s.ctl({ action: "systemVolume", value: 30 });
  const starts = rd("starts.log").filter(x => x === "host.ps1").length;
  ok(starts === 2, "10+ requests served by just two long-running hosts (system + files), not one process each (starts: " + starts + ")");
  ok(rd("calls.log").length >= 11, "all of them actually reached Windows (" + rd("calls.log").length + " calls)");

  // ---- error messages ----
  fs.writeFileSync(FB + "/host.fail.control", "");
  let r = await s.ctl({ action: "systemMute" }); fs.rmSync(FB + "/host.fail.control");
  ok(r.status === 500 && r.json.error === "Simulated failure in control", "Windows error reaches the phone without the PowerShell wrapper: " + (r.json && r.json.error));
  r = await s.call("/api/state"); ok(r.status === 200, "host keeps serving after a failed request");

  // ---- new actions ----
  await s.ctl({ action: "playerVolumeStep", player: "musicbee", direction: "down" });
  ok(JSON.parse(rd("calls.log").filter(c => c.startsWith("control") && c.includes("playerVolumeStep")).pop().replace(/^control /, "")).direction === "down", "volume step passes its direction");
  await s.ctl({ action: "playerVolumeStep", player: "musicbee", direction: "sideways" });
  ok(JSON.parse(rd("calls.log").filter(c => c.includes("playerVolumeStep")).pop().replace(/^control /, "")).direction === "up", "invalid direction becomes 'up'");
  r = await s.ctl({ action: "playPause", player: "vlc" });
  ok(r.status === 200 && JSON.parse(rd("calls.log").filter(c => c.includes("playPause")).pop().replace(/^control /, "")).player === "vlc", "play/pause forwards the selected player to Windows");
  r = await s.ctl({ action: "playPause" }); ok(r.status === 400, "play/pause requires an explicitly selected player");
  r = await s.ctl({ action: "power", what: "lock" }); ok(r.status === 200, "power: lock accepted");
  ok(JSON.parse(rd("calls.log").filter(c => c.includes('"what":"lock"')).pop().replace(/^control /, "")).what === "lock", "power action reaches Windows");
  r = await s.ctl({ action: "power", what: "format" }); ok(r.status === 400, "power: unknown action rejected");
  r = await s.ctl({ action: "power" }); ok(r.status === 400, "power: missing action rejected");

  // ---- settings + input worker configuration ----
  r = await s.call("/api/settings"); ok(r.json.keyMethod === "sendinput" && r.json.textMethod === "unicode" && r.json.fallback === true, "default settings");
  await s.ctl({ action: "keyboardPress", key: "A", modifiers: {} });
  ok(rd("worker.log")[0].includes('"action":"configure"') && rd("worker.log")[0].includes('"keyMethod":"sendinput"'), "input worker is configured as soon as it starts");
  r = await s.call("/api/settings", { method: "POST", body: JSON.stringify({ keyMethod: "legacy", textMethod: "paste", fallback: false, evil: 1 }) });
  ok(r.json.keyMethod === "legacy" && r.json.textMethod === "paste" && r.json.fallback === false && r.json.evil === undefined, "settings updated, unknown fields ignored");
  await sleep(150); ok(rd("worker.log").some(l => l.includes('"keyMethod":"legacy"') && l.includes('"textMethod":"paste"')), "running worker is reconfigured immediately");
  r = await s.call("/api/settings", { method: "POST", body: JSON.stringify({ keyMethod: "rm -rf", textMethod: 5 }) }); ok(r.json.keyMethod === "legacy" && r.json.textMethod === "paste", "invalid values ignored");
  ok(JSON.parse(fs.readFileSync(path.join(TMP, "local18771", "RemoteMediaControl", "settings.json"), "utf8")).keyMethod === "legacy", "settings are saved to disk");

  // ---- input errors ----
  fs.writeFileSync(FB + "/input.fail", "");
  r = await s.ctl({ action: "keyboardPress", key: "A", modifiers: {} });
  ok(r.status === 500 && r.json.error === "Windows accepted 0 of 2 simulated input events.", "a blocked key explains why: " + (r.json && r.json.error));
  fs.rmSync(FB + "/input.fail");

  // ---- self test ----
  await s.call("/api/settings", { method: "POST", body: JSON.stringify({ keyMethod: "sendinput", textMethod: "unicode", fallback: true }) });
  r = await s.call("/api/input-test", { method: "POST", body: "{}" });
  ok(r.status === 200 && r.json.anyWorks === true && r.json.settings.textMethod === "paste", "self-test applies the method that works (paste)");
  fs.writeFileSync(FB + "/selftest.blocked", "");
  await s.call("/api/settings", { method: "POST", body: JSON.stringify({ textMethod: "unicode" }) });
  r = await s.call("/api/input-test", { method: "POST", body: "{}" }); fs.rmSync(FB + "/selftest.blocked");
  ok(r.json.anyWorks === false && r.json.settings.textMethod === "unicode", "when nothing works the settings are left alone");

  // ---- diagnostics ----
  r = await s.call("/api/diagnostics"); const d = r.json;
  ok(d.version === require(ROOT + "/package.json").version && d.pairedDevices === 1 && Array.isArray(d.windows.audio) && d.system.mode === "persistent", "diagnostics: version, devices, audio, mode");
  ok(d.input.lastError && d.input.lastError.message.includes("Windows accepted 0"), "diagnostics remember the last input error");
  ok((await s.raw("/api/diagnostics")).status === 401, "diagnostics need pairing");

  // ---- the phone UI is split into scripts: every one must be served ----
  const index = await s.raw("/"); const srcs = [...index.text.matchAll(/<script src="(\/js\/[a-z]+\.js)"/g)].map(m => m[1]);
  ok(srcs.length === 12, "index.html loads 12 feature scripts (" + srcs.length + ")");
  const served = await Promise.all(srcs.map(src => s.raw(src)));
  ok(served.every(r => r.status === 200 && r.text.length > 20), "every script is served");
  ok((await s.raw("/js/..%2fserver.js")).status !== 200 && (await s.raw("/app.js")).status === 404, "no path escape, and the old monolith is gone");

  // ---- other devices ----
  const t2 = (await s.raw("/api/pair", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ pin: "222222" }) })).json.token;
  r = await s.call("/api/unpair-others", { method: "POST", body: "{}" }); ok(r.json.removed === 1, "sign out other devices removes 1");
  ok((await s.raw("/api/state", { headers: { Authorization: "Bearer " + t2 } })).status === 401 && (await s.call("/api/state")).status === 200, "the other phone is signed out, this one stays");
  s.srv.kill(); await sleep(200);

  // ---- fallback when the persistent host cannot start ----
  fs.rmSync(FB + "/calls.log", { force: true });
  s = boot(18772, { FAKE_HOST_DIE: "1" }); await pair(s);
  r = await s.call("/api/state"); ok(r.status === 200 && r.json.systemVolume === 40, "host cannot start -> still works one process per action");
  r = await s.call("/api/diagnostics"); ok(r.json.system.mode === "one process per action", "diagnostics report the fallback mode");
  ok(/using one process per action/.test(s.log), "the fallback is logged once for the user");
  s.srv.kill(); await sleep(100);
  console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
})().catch(e => { console.error("TEST ERROR", e); process.exit(2); });
