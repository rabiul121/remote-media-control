const path = require("node:path");
const ROOT = path.resolve(__dirname, "..", "..");
const FB = process.env.FAKE_PS_DIR;                      // where the fake PowerShell logs and reads its switches
const TMP = process.env.TEST_TMP || require("node:os").tmpdir();
const { spawn } = require("node:child_process"); const fs = require("node:fs"); const http = require("node:http");
const PORT = 18767, PIN = "654321";
const env = { ...process.env, PATH: FB + ":" + process.env.PATH, LOCALAPPDATA: path.join(TMP, "local3"), PORT: String(PORT), REMOTE_MEDIA_PIN: PIN };
for (const f of ["calls.log", "worker.log", "state.extra"]) fs.rmSync(FB + "/" + f, { force: true }); fs.rmSync(path.join(TMP, "local3"), { recursive: true, force: true });
const srv = spawn("node", ["server.js"], { cwd: ROOT, env }); let log = ""; srv.stdout.on("data", d => log += d); srv.stderr.on("data", d => log += d);
let pass = 0, fail = 0; const ok = (c, m) => { c ? pass++ : fail++; console.log((c ? "PASS " : "FAIL ") + m); };
const raw = (path, { method = "GET", headers = {}, body } = {}) => new Promise((res, rej) => { const r = http.request({ host: "127.0.0.1", port: PORT, path, method, headers }, x => { let b = ""; x.on("data", c => b += c); x.on("end", () => { let j; try { j = JSON.parse(b) } catch {} res({ status: x.statusCode, json: j }) }) }); r.on("error", rej); if (body) r.write(body); r.end(); });
let token; const api = (p, o = {}) => raw(p, { ...o, headers: { "Content-Type": "application/json", Authorization: "Bearer " + token } });
const ctl = body => api("/api/control", { method: "POST", body: JSON.stringify(body) });
const read = f => (fs.existsSync(FB + "/" + f) ? fs.readFileSync(FB + "/" + f, "utf8").trim().split("\n").filter(Boolean) : []).filter(l => !(f === "worker.log" && l.includes('"action":"configure"')));
const sleep = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  await sleep(1200);
  token = (await raw("/api/pair", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ pin: PIN }) })).json.token;

  // ---- keyboard goes through the fast worker ----
  let r = await ctl({ action: "keyboardPress", key: "ESCAPE", modifiers: { ctrl: false, alt: false, shift: false, win: false } });
  ok(r.status === 200, "keyboardPress accepted");
  let w = read("worker.log").map(l => JSON.parse(l));
  ok(w.length === 1 && w[0].action === "keyboardPress" && w[0].key === "ESCAPE" && w[0].modifiers.alt === false, "key went to the persistent worker with its modifiers");
  ok(!read("calls.log").some(c => c.startsWith("control") && c.includes("keyboardPress")), "no PowerShell process was started for the key press");
  await ctl({ action: "keyboardPress", key: "C", modifiers: { ctrl: true } });
  w = read("worker.log").map(l => JSON.parse(l)); ok(w.at(-1).modifiers.ctrl === true && w.at(-1).modifiers.alt === false, "Ctrl+C: only the requested modifier is set");
  r = await ctl({ action: "keyboardPress", key: "EVIL" }); ok(r.status === 400, "unknown key rejected");
  r = await ctl({ action: "keyboardPress", key: "ESCAPE", modifiers: { alt: "true" } });
  w = read("worker.log").map(l => JSON.parse(l)); ok(w.at(-1).modifiers.alt === false, "modifier must be a real boolean (string 'true' ignored)");

  // ---- typed text ----
  const before = read("worker.log").length;
  const text = "Hello বাংলা 😀 é";
  r = await ctl({ action: "typeText", text }); ok(r.status === 200, "typeText accepted");
  const rawLine = read("worker.log")[before];
  ok(/^[\x00-\x7f]*$/.test(rawLine), "text reaches the worker as pure ASCII (non-ASCII is \\u-escaped)");
  ok(JSON.parse(rawLine).text === text, "Bengali, emoji and accents decode back exactly");
  r = await ctl({ action: "typeText", text: "" }); ok(r.status === 400, "empty text rejected");
  r = await ctl({ action: "typeText", text: "x".repeat(501) }); ok(r.status === 400, "over-long text rejected");
  await ctl({ action: "typeText", text: "a\u0000b\u0007c\nd\te" });
  ok(JSON.parse(read("worker.log").at(-1)).text === "abc\nd\te", "control characters stripped, newline and tab kept");
  const n0 = read("worker.log").length;
  await Promise.all(Array.from({ length: 25 }, (_, i) => ctl({ action: "keyboardPress", key: "A", modifiers: {} })));
  ok(read("worker.log").length === n0 + 25, "25 rapid key presses all delivered");

  // ---- browser detection ----
  fs.writeFileSync(FB + "/state.extra", '"foregroundBrowserWindow":555,"browserTargetWindowExists":false,"browserFallbackWindow":0,');
  r = await api("/api/state?full=1"); ok(r.json.browserReady === true, "browser in front is adopted (browserReady) without ever pressing Open");
  ok(r.json.defaultBrowser === "brave", "default browser reported (brave)");
  r = await api("/api/state"); ok(r.json.defaultBrowser === "brave", "default browser stays cached on cheap polls");
  r = await ctl({ action: "browserFocus" }); ok(r.status === 200, "browserFocus accepted");
  ok(read("calls.log").filter(c => c.startsWith("control") && c.includes("browserFocus")).pop().includes('"targetWindow":555'), "browserFocus targets the adopted window (555)");
  r = await ctl({ action: "browserAddressBar" }); ok(r.status === 200, "browserAddressBar accepted");
  fs.writeFileSync(FB + "/state.extra", '"foregroundBrowserWindow":0,"browserTargetWindowExists":false,"browserFallbackWindow":777,');
  r = await api("/api/state"); ok(r.json.browserReady === true, "browser opened behind other windows is found by process (fallback)");
  await ctl({ action: "browserFocus" });
  ok(read("calls.log").filter(c => c.startsWith("control") && c.includes("browserFocus")).pop().includes('"targetWindow":777'), "controls now target the fallback window (777)");
  fs.writeFileSync(FB + "/state.extra", '"foregroundBrowserWindow":0,"browserTargetWindowExists":true,"browserFallbackWindow":0,');
  r = await api("/api/state"); ok(r.json.browserReady === true, "known browser window that still exists is kept");
  fs.writeFileSync(FB + "/state.extra", '"foregroundBrowserWindow":0,"browserTargetWindowExists":false,"browserFallbackWindow":0,');
  r = await api("/api/state"); ok(r.json.browserReady === false, "browser closed -> not ready (no stale window)");
  await ctl({ action: "browserFocus" });
  ok(read("calls.log").filter(c => c.startsWith("control") && c.includes("browserFocus")).pop().includes('"targetWindow":0'), "no browser: PowerShell gets window 0 and refuses with its own message");
  r = await api("/api/state"); ok(r.json.foregroundTitle === "YouTube - Brave" && r.json.foregroundProcess === "brave", "state reports what is in front");

  srv.kill(); console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
})().catch(e => { console.error("TEST ERROR", e, log); srv.kill(); process.exit(2); });
