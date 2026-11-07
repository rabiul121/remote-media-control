const path = require("node:path");
const ROOT = path.resolve(__dirname, "..", "..");
const FB = process.env.FAKE_PS_DIR;                      // where the fake PowerShell logs and reads its switches
const TMP = process.env.TEST_TMP || require("node:os").tmpdir();
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const http = require("node:http");
const PORT = 18765, PIN = "123456";
const env = { ...process.env, PATH: FB + ":" + process.env.PATH, LOCALAPPDATA: path.join(TMP, "local"), PORT: String(PORT), REMOTE_MEDIA_PIN: PIN };
fs.rmSync(path.join(TMP, "local"), { recursive: true, force: true }); fs.rmSync(FB + "/calls.log", { force: true });
const srv = spawn("node", ["server.js"], { cwd: ROOT, env });
let log = ""; srv.stdout.on("data", d => log += d); srv.stderr.on("data", d => log += d);
let pass = 0, fail = 0;
const ok = (c, m) => { c ? pass++ : fail++; console.log((c ? "PASS " : "FAIL ") + m); };
const raw = (path, { method = "GET", headers = {}, body } = {}) => new Promise((res, rej) => {
  const r = http.request({ host: "127.0.0.1", port: PORT, path, method, headers }, x => { let b = ""; x.on("data", c => b += c); x.on("end", () => { let j; try { j = JSON.parse(b) } catch {} res({ status: x.statusCode, body: b, json: j, headers: x.headers }) }); });
  r.on("error", rej); if (body) r.write(body); r.end();
});
const api = (path, token, opt = {}) => raw(path, { ...opt, headers: { "Content-Type": "application/json", ...(token ? { Authorization: "Bearer " + token } : {}), ...(opt.headers || {}) } });
const calls = () => fs.existsSync(FB + "/calls.log") ? fs.readFileSync(FB + "/calls.log", "utf8").trim().split("\n") : [];
const sleep = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  await sleep(1200);
  ok(log.includes("Pairing code: " + PIN), "server starts with the supplied 6-digit code");
  ok(fs.existsSync(path.join(TMP, "local", "RemoteMediaControl", "listener.pid")), "pid file written once listening");

  // --- crash regressions ---
  let r = await raw("/%"); ok(r.status === 400, "GET /% -> 400 (used to crash the process) got " + r.status);
  r = await raw("/%00"); ok(r.status === 400, "GET /%00 -> 400 got " + r.status);
  r = await raw("/"); ok(r.status === 200 && r.headers["x-content-type-options"] === "nosniff", "index served with nosniff");
  r = await raw("/..%2fserver.js"); ok(r.status === 403 || r.status === 404, "path traversal blocked: " + r.status);
  r = await raw("/api/pair", { method: "POST", body: "x".repeat(9000) }).catch(() => ({ status: "closed" }));
  ok(r.status === 400 || r.status === "closed", "oversized body rejected: " + r.status);
  ok(!srv.killed && srv.exitCode === null, "server still alive after hostile requests");

  // --- DNS-rebinding guard on the QR endpoint ---
  r = await raw("/api/pair-qr", { headers: { Host: "evil.example:" + PORT } }); ok(r.status === 403, "pair-qr refuses a non-loopback Host header: " + r.status);
  r = await raw("/api/pair-qr", { headers: { Host: "127.0.0.1:" + PORT } }); ok(r.status !== 403, "pair-qr allowed for 127.0.0.1 Host: " + r.status);

  // --- pairing + brute-force limiter ---
  let bad;
  for (let i = 0; i < 8; i++) bad = await api("/api/pair", null, { method: "POST", body: JSON.stringify({ pin: "000000" }) });
  ok(bad.status === 401, "8th wrong code is still a 401");
  r = await api("/api/pair", null, { method: "POST", body: JSON.stringify({ pin: PIN }) });
  ok(r.status === 429 && r.headers["retry-after"], "after 8 failures even the right code is locked out (429 + Retry-After)");
  // restart-free way to get a token for the rest: use a different source IP is impossible on loopback, so restart the server
  srv.kill(); await sleep(400);
  const srv2 = spawn("node", ["server.js"], { cwd: ROOT, env }); srv2.stderr.on("data", d => log += d); srv2.stdout.on("data", d => log += d);
  await sleep(1200);
  r = await api("/api/pair", null, { method: "POST", body: JSON.stringify({ pin: "" }) }); ok(r.status === 401, "empty code rejected");
  r = await api("/api/pair", null, { method: "POST", body: JSON.stringify({ pin: PIN }) }); ok(r.status === 200 && r.json.token, "correct code pairs");
  const token = r.json.token;

  // --- apps API ---
  r = await api("/api/apps"); ok(r.status === 401, "apps requires pairing");
  r = await api("/api/apps", token); ok(r.status === 200 && r.json.apps.length === 3, "apps list returned (" + (r.json.apps || []).length + ")");
  ok(r.json.apps.every(a => a.id && a.name && !a.appId), "list exposes only id+name, never the launch id");
  ok(r.json.apps[0].name === "Calculator", "sorted by name");
  const appCalls1 = calls().filter(c => c.startsWith("apps")).length;
  await api("/api/apps", token); ok(calls().filter(c => c.startsWith("apps")).length === appCalls1, "second list call served from cache");
  await Promise.all([api("/api/apps?refresh=1", token), api("/api/apps?refresh=1", token)]);
  ok(calls().filter(c => c.startsWith("apps")).length === appCalls1 + 1, "two simultaneous refreshes share one PowerShell run");

  // --- openApp ---
  const list = (await api("/api/apps", token)).json.apps; const npp = list.find(a => a.name === "Notepad++");
  r = await api("/api/control", token, { method: "POST", body: JSON.stringify({ action: "openApp", id: npp.id }) });
  ok(r.status === 200 && r.json.name === "Notepad++", "openApp with a listed id succeeds");
  const launch = calls().filter(c => c.startsWith("control") && c.includes("openApp")).pop();
  ok(launch && launch.includes("notepad++.exe"), "server passed the real launch id to PowerShell");
  const before = calls().length;
  r = await api("/api/control", token, { method: "POST", body: JSON.stringify({ action: "openApp", id: "deadbeefdeadbeef" }) });
  ok(r.status === 404, "unknown id -> 404 (" + r.status + ")");
  r = await api("/api/control", token, { method: "POST", body: JSON.stringify({ action: "openApp", id: "C:\\Windows\\System32\\cmd.exe" }) });
  ok(r.status === 404, "raw path as id is not launchable");
  ok(!calls().slice(before).some(c => c.startsWith("control")), "no control call reached PowerShell for invalid ids");

  // --- state: browser probe cached ---
  r = await api("/api/state", token); ok(r.json.browsers.includes("brave"), "first state probes browsers");
  r = await api("/api/state", token);
  const stateCalls = calls().filter(c => c.startsWith("state"));
  ok(stateCalls[0].includes('"detectBrowsers":true') && stateCalls[1].includes('"detectBrowsers":false'), "second state skips the probe");
  ok(r.json.browsers.includes("brave"), "cached browsers still returned");
  r = await api("/api/state?full=1", token); ok(calls().filter(c => c.startsWith("state")).pop().includes('"detectBrowsers":true'), "?full=1 forces a re-probe");

  // --- duplicate instance must not steal the pid file ---
  const dup = spawn("node", ["server.js"], { cwd: ROOT, env }); let dupLog = ""; dup.stderr.on("data", d => dupLog += d); dup.stdout.on("data", d => dupLog += d);
  const code = await new Promise(r => dup.on("exit", r));
  ok(code === 1 && /already in use/.test(dupLog), "second instance exits 1 with a clear message");
  ok(fs.readFileSync(path.join(TMP, "local", "RemoteMediaControl", "listener.pid"), "utf8").trim() === String(srv2.pid), "running instance's pid file untouched");

  srv2.kill();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error("TEST ERROR", e, log); process.exit(2); });
