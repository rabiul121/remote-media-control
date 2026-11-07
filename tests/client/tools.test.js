const path = require("node:path");
const ROOT = path.resolve(__dirname, "..", "..");
const FB = process.env.FAKE_PS_DIR;                      // where the fake PowerShell logs and reads its switches
const TMP = process.env.TEST_TMP || require("node:os").tmpdir();
const { JSDOM } = require("jsdom"); const fs = require("fs");
const root = path.join(ROOT, "public") + "/";
const appSource = () => [...fs.readFileSync(root + "index.html", "utf8").matchAll(/<script src="\/(js\/[a-z]+\.js)"/g)].map((m) => fs.readFileSync(root + m[1], "utf8")).join("\n");
let pass = 0, fail = 0; const ok = (c, m) => { c ? pass++ : fail++; console.log((c ? "PASS " : "FAIL ") + m); };
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function boot({ state = {}, prefs = null, page = null, store = {}, nav = {}, controlError = null } = {}) {
  const dom = new JSDOM(fs.readFileSync(root + "index.html", "utf8"), { url: "http://localhost:8765/", runScripts: "outside-only", pretendToBeVisual: true });
  const w = dom.window, reqs = [];
  w.localStorage.setItem("remote-media-token", "tok");
  if (prefs) w.localStorage.setItem("remote-media-prefs", JSON.stringify(prefs));
  if (page) w.localStorage.setItem("remote-media-page", page);
  for (const [k, v] of Object.entries(store)) w.localStorage.setItem(k, v);
  Object.assign(w.navigator, nav);
  w.matchMedia = () => ({ matches: false, addListener() {}, addEventListener() {} });
  const realSet = w.setTimeout.bind(w); w.setTimeout = (fn, ms, ...a) => realSet(fn, ms === 4000 ? 300 : ms, ...a);
  w.fetch = async (url, opt = {}) => {
    const body = opt.body ? JSON.parse(opt.body) : null; reqs.push({ url, method: opt.method || "GET", body });
    const res = (data, status = 200) => ({ ok: status < 400, status, json: async () => data });
    if (url === "/api/control" && controlError && body.action === "keyboardPress") return res({ error: controlError }, 500);
    if (url.startsWith("/api/state")) return res({ players: [], running: [], browsers: ["default"], foregroundTitle: "Notepad", foregroundProcess: "notepad", ...state });
    if (url.startsWith("/api/files")) return res({ path: "", parent: "", drives: [], folders: [], files: [] });
    if (url.startsWith("/api/apps")) return res({ apps: [{ id: "a1", name: "Calculator" }] });
    if (url === "/api/settings") return res(body ? { keyMethod: body.keyMethod, textMethod: body.textMethod, fallback: body.fallback } : { keyMethod: "sendinput", textMethod: "unicode", fallback: true });
    if (url === "/api/input-test") return res({ keys: { ok: true }, unicode: { ok: false }, legacy: { ok: true }, paste: { ok: true }, elevated: false, anyWorks: true, settings: { keyMethod: "sendinput", textMethod: "paste", fallback: true } });
    if (url === "/api/diagnostics") return res({ version: "1.2.1", node: "v22", uptimeSeconds: 600, pairedDevices: 2, system: { mode: "persistent" }, settings: { keyMethod: "sendinput", textMethod: "unicode", fallback: true }, input: { lastError: { message: "Windows accepted 0 of 4" } }, windows: { psVersion: "5.1", user: "robi", session: 1, elevated: false, defaultBrowser: "brave", mpcWeb: false, audio: ["output 1: vlc 50%"] } });
    if (url === "/api/unpair-others") return res({ ok: true, removed: 2 });
    return res({ ok: true });
  };
  w.eval(appSource());
  await sleep(80);
  const d = w.document, go = p => { d.querySelector(`.home-tile[data-go-page="${p}"]`).click(); return sleep(60); };
  const pad = d.querySelector("#mouse-pad"); pad.setPointerCapture = () => {}; pad.hasPointerCapture = () => false; pad.releasePointerCapture = () => {};
  const fire = (type, id, x, y) => { const e = new w.MouseEvent(type, { clientX: x, clientY: y, bubbles: true, cancelable: true }); Object.defineProperty(e, "pointerId", { value: id }); pad.dispatchEvent(e); };
  return { w, d, reqs, go, fire, ctl: () => reqs.filter(r => r.url === "/api/control").map(r => r.body) };
}
(async () => {
  // ---------- player volume modes ----------
  let t = await boot({ store: { "remote-media-player": "musicbee" }, state: { running: ["musicbee"], players: [{ name: "musicbee", volume: null, muted: null, mode: "keys" }] } });
  await t.go("playback"); const d = t.d;
  ok(d.querySelector("#player-keys-row").classList.contains("hidden") && !d.querySelector("#player-slider-row").classList.contains("hidden"), "MusicBee keeps the absolute slider visible");
  ok(/shared audio mode/.test(d.querySelector("#player-volume-note").textContent) && d.querySelector("#player-volume").disabled, "explains why: " + d.querySelector("#player-volume-note").textContent.slice(0, 60) + "…");
  t = await boot({ store: { "remote-media-player": "vlc" }, state: { running: ["vlc"], players: [{ name: "vlc", volume: 35, muted: false, mode: "mixer" }] } }); await t.go("playback");
  ok(t.d.querySelector("#player-keys-row").classList.contains("hidden") && !t.d.querySelector("#player-slider-row").classList.contains("hidden") && t.d.querySelector("#player-value").value === "35" && !t.d.querySelector("#player-volume").disabled && t.d.querySelector("#player-volume-note").textContent === "", "mixer mode: normal slider at 35, no note");
  t = await boot({ store: { "remote-media-player": "mpc-hc64" }, state: { running: ["mpc-hc64"], players: [{ name: "mpc-hc64", volume: 60, muted: false, mode: "web" }] } }); await t.go("playback");
  ok(/web interface/.test(t.d.querySelector("#player-volume-note").textContent) && t.d.querySelector("#player-value").value === "60", "web mode: slider with level 60 and a note");
  t = await boot({ store: { "remote-media-player": "musicbee" }, state: { running: [], players: [] } }); await t.go("playback");
  ok(/Open MusicBee/.test(t.d.querySelector("#player-volume-note").textContent), "player closed: 'Open MusicBee to control its volume'");

  // ---------- pointer speed / scroll preferences ----------
  const slide = async (t2) => { t2.reqs.length = 0; t2.fire("pointerdown", 1, 100, 100); await sleep(20); t2.fire("pointermove", 1, 110, 100); await sleep(120); t2.fire("pointerup", 1, 110, 100); await sleep(30); return t2.ctl().find(c => c.action === "mouseMove"); };
  t = await boot({}); await t.go("mouse"); let mv = await slide(t); ok(mv && mv.dx === 22, "default pointer speed: 10px finger move = 22 (" + mv?.dx + ")");
  t = await boot({ prefs: { mouseSpeed: 2 } }); await t.go("mouse"); mv = await slide(t); ok(mv && mv.dx === 44, "pointer speed 2x: 44 (" + mv?.dx + ")");
  const scroll = async (t2) => { t2.reqs.length = 0; t2.fire("pointerdown", 1, 100, 300); t2.fire("pointerdown", 2, 200, 300); t2.fire("pointermove", 1, 100, 280); t2.fire("pointermove", 2, 200, 280); await sleep(60); const a = t2.ctl().map(c => c.action).filter(x => /Scroll/.test(x)); t2.fire("pointerup", 1, 100, 280); t2.fire("pointerup", 2, 200, 280); return a; };
  t = await boot({}); await t.go("mouse"); let sc = await scroll(t); ok(sc.join() === "mouseScrollDown", "natural scrolling (default): fingers up -> page down (" + sc.join() + ")");
  t = await boot({ prefs: { naturalScroll: false } }); await t.go("mouse"); sc = await scroll(t); ok(sc.join() === "mouseScrollUp", "natural scrolling off: fingers up -> scroll up (" + sc.join() + ")");
  t = await boot({ prefs: { scrollSpeed: 2 } }); await t.go("mouse"); sc = await scroll(t); ok(sc.length === 2, "scroll speed 2x: 20px = 2 notches instead of 1 (" + sc.length + ")");

  // ---------- quick keys ----------
  t = await boot({}); await t.go("keyboard"); const q = c => t.d.querySelector(`[data-quick-key="${c}"]`);
  t.reqs.length = 0; q("ALT+TAB").click(); q("WIN+SHIFT+S").click(); q("F5").click(); q("CTRL+SHIFT+ESCAPE").click(); await sleep(80);
  const kp = t.ctl().filter(c => c.action === "keyboardPress");
  const m = k => Object.entries(k.modifiers).filter(([, v]) => v).map(([n]) => n).join("+");
  ok(kp.map(k => `${m(k)}|${k.key}`).join(",") === "alt|TAB,shift+win|S,|F5,ctrl+shift|ESCAPE", "quick keys send the right combos in order: " + kp.map(k => `${m(k)}|${k.key}`).join(" "));
  t.d.querySelector('[data-modifier="alt"]').click(); q("CTRL+C").click(); await sleep(50);
  ok(m(t.ctl().filter(c => c.action === "keyboardPress").at(-1)) === "ctrl" && !t.d.querySelector('[data-modifier="alt"]').classList.contains("active"), "a quick key never inherits an armed modifier (Alt armed + Copy = Ctrl+C only)");
  ok(t.d.querySelectorAll("[data-quick-key]").length >= 12, "quick keys row has " + t.d.querySelectorAll("[data-quick-key]").length + " shortcuts");

  // ---------- haptics ----------
  let buzzed = 0; t = await boot({ prefs: { haptics: true }, nav: { vibrate: () => { buzzed++; return true; } } }); await t.go("keyboard"); t.d.querySelector('.keyboard-key[data-key="A"]').click(); ok(buzzed >= 1, "vibrates on key taps when enabled");
  buzzed = 0; t = await boot({ prefs: { haptics: false }, nav: { vibrate: () => { buzzed++; return true; } } }); await t.go("keyboard"); t.d.querySelector('.keyboard-key[data-key="A"]').click(); ok(buzzed === 0, "silent when disabled");

  // ---------- keep screen awake ----------
  let lock = 0, released = 0; t = await boot({ prefs: { wake: true }, nav: { wakeLock: { request: async () => { lock++; return { release: async () => { released++; }, addEventListener() {} }; } } } });
  await t.go("mouse"); await sleep(30); ok(lock === 1, "screen kept on while the touchpad is open");
  t.d.querySelector("#home-link").click(); await sleep(60); ok(released === 1, "released when leaving the Mouse page");
  lock = 0; t = await boot({ prefs: { wake: false }, nav: { wakeLock: { request: async () => { lock++; return { release: async () => {}, addEventListener() {} }; } } } }); await t.go("mouse"); await sleep(30); ok(lock === 0, "does nothing when the option is off");

  // ---------- restore last page ----------
  t = await boot({ page: "apps" }); ok(t.d.querySelector('[data-page-panel="apps"]').classList.contains("active") && t.reqs.some(r => r.url.startsWith("/api/apps")), "reopens on the last page (Apps) and loads it");
  t = await boot({ page: "apps", prefs: { restorePage: false } }); ok(t.d.querySelector('[data-page-panel="home"]').classList.contains("active"), "option off -> starts on Home");

  // ---------- Tools: power ----------
  t = await boot({}); await t.go("tools"); const pw = k => t.d.querySelector(`[data-power="${k}"]`);
  t.reqs.length = 0; pw("lock").click(); await sleep(40);
  ok(t.ctl()[0]?.action === "power" && t.ctl()[0].what === "lock" && /locked/.test(t.d.querySelector("#power-status").textContent), "Lock: one tap");
  t.reqs.length = 0; pw("restart").click(); await sleep(30);
  ok(!t.ctl().length && pw("restart").textContent === "Tap to confirm" && pw("restart").classList.contains("confirm"), "Restart: first tap only asks to confirm, nothing is sent");
  pw("restart").click(); await sleep(40); ok(t.ctl()[0]?.what === "restart" && /15 seconds/.test(t.d.querySelector("#power-status").textContent) && pw("restart").textContent === "Restart", "second tap restarts and the button resets");
  t.reqs.length = 0; pw("shutdown").click(); await sleep(450);
  ok(pw("shutdown").textContent === "Shut down" && !pw("shutdown").classList.contains("confirm"), "unconfirmed Shut down arms itself off again after a few seconds");
  pw("shutdown").click(); await sleep(450); ok(!t.ctl().length, "...and a later tap is a fresh first tap (nothing sent)");
  pw("cancel").click(); await sleep(40); ok(t.ctl().at(-1)?.what === "cancel", "Cancel: one tap, no confirmation");

  // ---------- Tools: PC typing settings ----------
  t = await boot({}); await t.go("tools");
  ok(t.reqs.some(r => r.url === "/api/settings" && r.method === "GET") && t.d.querySelector("#set-key-method").value === "sendinput" && t.d.querySelector("#set-fallback").checked, "typing settings loaded when the page opens");
  t.reqs.length = 0; const sel = t.d.querySelector("#set-text-method"); sel.value = "paste"; sel.dispatchEvent(new t.w.Event("change", { bubbles: true })); await sleep(40);
  const post = t.reqs.find(r => r.url === "/api/settings" && r.method === "POST"); ok(post && post.body.textMethod === "paste" && post.body.keyMethod === "sendinput", "changing a setting saves all three values");
  t.d.querySelector("#run-input-test").click(); await sleep(60);
  const out = t.d.querySelector("#input-test-result"); ok(!out.classList.contains("hidden") && /Standard keys: works/.test(out.textContent) && /Direct text: blocked/.test(out.textContent) && /text = paste/.test(out.textContent), "'Test and fix typing' lists each method and what it chose");
  ok(t.d.querySelector("#set-text-method").value === "paste" && !t.d.querySelector("#run-input-test").disabled, "controls follow the result; button usable again");
  t.d.querySelector("#load-diagnostics").click(); await sleep(60);
  const diag = t.d.querySelector("#diagnostics-result").textContent;
  ok(/RemoteDeck 1\.2\.1/.test(diag) && /Windows helper: persistent/.test(diag) && /Last typing error: Windows accepted 0 of 4/.test(diag) && /output 1: vlc 50%/.test(diag) && /administrator: no/.test(diag), "diagnostics are readable text, not raw JSON");
  t.d.querySelector("#unpair-others").click(); await sleep(40); ok(/Signed out 2 other phone/.test(t.d.querySelector("#unpair-others").textContent), "sign out other phones reports how many");

  // ---------- Keyboard: test button + administrator warning ----------
  t = await boot({}); await t.go("keyboard"); t.d.querySelector("#keyboard-diagnose").click(); await sleep(70);
  const hint = t.d.querySelector("#keyboard-hint"); ok(!hint.classList.contains("hidden") && /Standard keys: works/.test(hint.textContent), "Test button on the Keyboard page shows the result right there");
  t = await boot({ state: { foregroundElevated: true, selfElevated: false, foregroundProcess: "taskmgr", foregroundTitle: "Task Manager" } }); await t.go("keyboard");
  ok(/administrator/.test(t.d.querySelector("#keyboard-hint").textContent) && t.d.querySelector("#keyboard-target").classList.contains("warn") && /runs as administrator/.test(t.d.querySelector("#keyboard-target-title").textContent), "an elevated app in front is called out, with what to do");
  t = await boot({ state: { foregroundElevated: true, selfElevated: true } }); await t.go("keyboard"); ok(t.d.querySelector("#keyboard-hint").classList.contains("hidden"), "no warning when RemoteDeck is elevated too");
  // ---------- rejected keys are explained where you type ----------
  t = await boot({ controlError: "Windows accepted 0 of 4 simulated input events." }); await t.go("keyboard");
  t.d.querySelector('.keyboard-key[data-key="A"]').click(); await sleep(80);
  ok(!t.d.querySelector("#keyboard-hint").classList.contains("hidden") && /Tap Test/.test(t.d.querySelector("#keyboard-hint").textContent), "a rejected key shows a hint pointing to the Test button");
  t.d.querySelector("#home-link").click(); t.reqs.length = 0; await t.go("keyboard"); await sleep(100);
  ok(!t.d.querySelector("#keyboard-hint").classList.contains("hidden"), "the hint is not wiped by the next status refresh");
  console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
})().catch(e => { console.error("TEST ERROR", e); process.exit(2); });
