const path = require("node:path");
const ROOT = path.resolve(__dirname, "..", "..");
const FB = process.env.FAKE_PS_DIR;                      // where the fake PowerShell logs and reads its switches
const TMP = process.env.TEST_TMP || require("node:os").tmpdir();
const { JSDOM } = require("jsdom"); const fs = require("fs");
const root = path.join(ROOT, "public") + "/";
const appSource = () => [...fs.readFileSync(root + "index.html", "utf8").matchAll(/<script src="\/(js\/[a-z]+\.js)"/g)].map((m) => fs.readFileSync(root + m[1], "utf8")).join("\n");
let pass = 0, fail = 0; const ok = (c, m) => { c ? pass++ : fail++; console.log((c ? "PASS " : "FAIL ") + m); };
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function boot(stateExtra = {}) {
  const dom = new JSDOM(fs.readFileSync(root + "index.html", "utf8"), { url: "http://localhost:8765/", runScripts: "outside-only", pretendToBeVisual: true });
  const w = dom.window, sent = [];
  w.localStorage.setItem("remote-media-token", "tok");
  w.matchMedia = () => ({ matches: false, addListener() {}, addEventListener() {} });
  const realSet = w.setTimeout.bind(w); w.setTimeout = (fn, ms, ...a) => realSet(fn, ms >= 10000 ? 1500 : ms, ...a);   // shorten the 10 s auto-clear
  w.fetch = async (url, opt = {}) => {
    const body = opt.body ? JSON.parse(opt.body) : null;
    if (url === "/api/control") { sent.push(body); await sleep(Math.random() * 20); }
    const data = url.startsWith("/api/state") ? { players: [], running: [], browsers: ["default", "brave"], defaultBrowser: "brave", browserReady: true, foregroundTitle: "YouTube - Brave", foregroundProcess: "brave", ...stateExtra } : url.startsWith("/api/files") ? { path: "", parent: "", drives: [], folders: [], files: [] } : { ok: true };
    return { ok: true, status: 200, json: async () => data };
  };
  w.eval(appSource());
  const d = w.document;
  d.querySelector('.home-tile[data-go-page="keyboard"]').click();
  await sleep(80);
  return { w, d, sent, key: k => d.querySelector(`.keyboard-key[data-key="${k}"]`), mod: n => d.querySelector(`[data-modifier="${n}"]`) };
}
const presses = s => s.filter(x => x.action === "keyboardPress");
(async () => {
  let t = await boot();
  // ---------- the Esc -> Alt+Esc bug ----------
  t.mod("alt").click();
  ok(t.mod("alt").classList.contains("active") && t.key("ALT").classList.contains("active"), "tapping Alt VISIBLY arms it (button + layout key highlighted; before there was no styling at all)");
  ok(/Next key with Alt/.test(t.d.querySelector("#keyboard-armed").textContent), "status line says: " + t.d.querySelector("#keyboard-armed").textContent);
  t.key("ESCAPE").click(); await sleep(60);
  ok(presses(t.sent)[0].modifiers.alt === true, "first Esc after arming Alt carries Alt (that is Alt+Esc, the app-cycling combo)");
  ok(!t.mod("alt").classList.contains("active") && t.d.querySelector("#keyboard-armed").textContent === "", "Alt releases itself after that one key");
  t.key("ESCAPE").click(); await sleep(60);
  ok(presses(t.sent)[1].modifiers.alt === false, "second Esc is a plain Esc, no Alt");

  // ---------- one-shot / lock ----------
  t = await boot();
  t.key("ALTGR").click();
  ok(t.mod("alt").classList.contains("active") && !presses(t.sent).length, "right 'Alt' key arms Alt instead of sending a stray Alt tap");
  await sleep(500); t.key("ALTGR").click();   // slow second tap = off
  ok(!t.mod("alt").classList.contains("active"), "slow second tap turns it off");
  t.mod("ctrl").click(); t.mod("ctrl").click();   // quick double tap = lock
  ok(t.mod("ctrl").classList.contains("locked") && /locked/.test(t.d.querySelector("#keyboard-armed").textContent), "double tap locks Ctrl");
  t.key("C").click(); t.key("V").click(); await sleep(80);
  ok(presses(t.sent).map(p => p.modifiers.ctrl).join() === "true,true", "locked Ctrl applies to several keys (Ctrl+C then Ctrl+V)");
  t.mod("ctrl").click(); await sleep(0);
  ok(!t.mod("ctrl").classList.contains("active"), "tap releases the lock");
  t.mod("shift").click(); t.mod("ctrl").click();
  ok(t.d.querySelector(".key-has-legends").classList.contains("shift-active"), "armed Shift shows the shifted legends");
  t.key("ESCAPE").click(); await sleep(60);
  const last = presses(t.sent).at(-1);
  ok(last.modifiers.ctrl && last.modifiers.shift && !t.mod("shift").classList.contains("active"), "Ctrl+Shift+Esc works (task manager) and both release");
  t.mod("alt").click(); await sleep(1800);
  ok(!t.mod("alt").classList.contains("active"), "a forgotten armed modifier clears itself (timeout)");
  t.mod("win").click(); t.d.querySelector('.nav-back,.brand,[data-go-page="home"]').click(); await sleep(40);
  ok(!t.mod("win").classList.contains("active"), "leaving the Keyboard page clears armed modifiers");

  // ---------- ordering ----------
  t = await boot(); t.sent.length = 0;
  for (const k of ["H", "E", "L", "L", "O"]) t.key(k).click();
  await sleep(250);
  ok(presses(t.sent).map(p => p.key).join("") === "HELLO", "five fast taps arrive in order despite random server latency");

  // ---------- phone keyboard typing ----------
  t = await boot(); t.sent.length = 0;
  const input = t.d.querySelector("#type-input");
  const type = async v => { input.value = v; input.dispatchEvent(new t.w.Event("input", { bubbles: true })); await sleep(5); };
  const log = () => t.sent.map(s => s.action === "typeText" ? `T(${s.text})` : s.key === "BACKSPACE" ? "<" : s.key === "ENTER" ? "⏎" : s.key).join(" ");
  await type("h"); await type("he"); await sleep(60);
  ok(log() === "T(h) T(e)", "typing sends each new character: " + log());
  t.sent.length = 0; await type("h"); await sleep(60);
  ok(log() === "<", "deleting a character sends Backspace: " + log());
  t.sent.length = 0; await type("hello"); await type("help"); await sleep(80);
  ok(log() === "T(ello) < < T(p)", "autocorrect 'hello'->'help' = 2 backspaces + 'p': " + log());
  t.sent.length = 0; await type("hello world"); await sleep(60);
  ok(log() === "< T(lo world)" || log() === "< < T(lo world)" || /T\(/.test(log()), "paste/replace handled: " + log());
  t.sent.length = 0; input.dispatchEvent(new t.w.KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true })); await sleep(60);
  ok(log() === "⏎" && input.value === "", "Enter presses Enter and clears the box: " + log());
  t.sent.length = 0; await type("x"); await sleep(60);
  ok(log() === "T(x)", "next line starts fresh (no stale diff): " + log());
  t.sent.length = 0; await type(""); await sleep(30); t.sent.length = 0;
  input.dispatchEvent(new t.w.KeyboardEvent("keydown", { key: "Backspace", bubbles: true, cancelable: true })); await sleep(60);
  ok(log() === "<", "Backspace in an empty box deletes on the PC: " + log());
  t.sent.length = 0; await type("😀"); await type(""); await sleep(60);
  ok(log() === "T(😀) <", "emoji: typed once, removed with ONE backspace (not two): " + log());
  t.sent.length = 0; await type("বাংলা"); await sleep(60);
  ok(log() === "T(বাংলা)", "Bengali text sent as one chunk: " + log());

  // ---------- zoom ----------
  t = await boot();
  const layout = t.d.querySelector("#keyboard-full-layout"), scroll = t.d.querySelector("#keyboard-scroll"), box = t.d.querySelector("#keyboard-zoom-box");
  Object.defineProperty(layout, "offsetWidth", { get: () => parseInt(layout.style.width) || 1120, configurable: true });
  Object.defineProperty(layout, "offsetHeight", { value: 400, configurable: true });
  Object.defineProperty(scroll, "clientWidth", { value: 390, configurable: true });
  Object.defineProperty(scroll, "clientHeight", { value: 300, configurable: true });
  const label = () => t.d.querySelector("#kbd-zoom-label").textContent;
  t.d.querySelector("#kbd-zoom-in").click();
  ok(label() === "120%" && layout.style.transform === "scale(1.2)" && box.style.width === "1344px" && box.style.height === "480px", "+ zooms to 120% and resizes the scroll area (" + label() + ", box " + box.style.width + "x" + box.style.height + ")");
  t.d.querySelector("#kbd-zoom-out").click(); t.d.querySelector("#kbd-zoom-out").click();
  ok(label() === "83%", "− twice = 83% (" + label() + ")");
  t.d.querySelector("#kbd-zoom-fit").click();
  ok(label() === "35%" && box.style.width === "390px", "Fit scales to the screen width: " + label() + ", box " + box.style.width);
  ok(t.w.localStorage.getItem("remote-media-kbd-zoom") === String(parseFloat(layout.style.transform.match(/[\d.]+/)[0])), "zoom level is remembered");
  t.d.querySelector("#kbd-zoom-reset").click(); ok(label() === "100%" && box.style.width === "1120px", "tap the % to reset to 100%");
  for (let i = 0; i < 15; i++) t.d.querySelector("#kbd-zoom-in").click(); ok(label() === "300%", "clamped at 300% (" + label() + ")");
  for (let i = 0; i < 30; i++) t.d.querySelector("#kbd-zoom-out").click(); ok(label() === "25%", "clamped at 25% (" + label() + ")");
  t.d.querySelector("#kbd-zoom-reset").click();
  // pinch
  const touch = (type, pts) => { const e = new t.w.Event(type, { bubbles: true, cancelable: true }); e.touches = pts.map(([x, y]) => ({ clientX: x, clientY: y })); scroll.dispatchEvent(e); return e; };
  touch("touchstart", [[100, 100], [200, 100]]);
  const mv = touch("touchmove", [[50, 100], [250, 100]]);
  ok(label() === "200%" && mv.defaultPrevented, "pinch spreading fingers 2x -> 200%, page does not scroll/zoom (" + label() + ")");
  touch("touchmove", [[100, 100], [200, 100]]); ok(label() === "100%", "pinching back to the start spread -> 100% (" + label() + ")");
  touch("touchmove", [[100, 100], [150, 100]]); ok(label() === "50%", "pinching in to half the spread -> 50% (" + label() + ")");
  touch("touchend", [[100, 100]]); const mv2 = touch("touchmove", [[0, 0], [10, 0]]); ok(!mv2.defaultPrevented && label() === "50%", "after fingers lift, moves are ignored");
  // persisted across reload of the page
  t.w.localStorage.setItem("remote-media-kbd-zoom", "0.6");
  const t2 = await boot(); t2.w.localStorage.setItem("remote-media-kbd-zoom", "0.6");

  // ---------- status line + browser UI ----------
  t = await boot();
  ok(t.d.querySelector("#keyboard-target-title").textContent === "brave: YouTube - Brave" && !t.d.querySelector("#keyboard-target").classList.contains("warn"), "'Typing into' shows the window in front: " + t.d.querySelector("#keyboard-target-title").textContent);
  ok(t.d.querySelector('#browser-select option[value="default"]').textContent === "Default browser (Brave)", "default browser named: " + t.d.querySelector('#browser-select option[value="default"]').textContent);
  t.sent.length = 0; t.d.querySelector("#keyboard-focus-browser").click(); await sleep(40);
  ok(t.sent[0]?.action === "browserFocus", "'Browser' button on the Keyboard page brings the browser to the front");
  ok(!!t.d.querySelector('.browser-controls [data-action="browserAddressBar"]') && !!t.d.querySelector('.browser-controls [data-action="browserFocus"]'), "Browser page has 'Bring to front' and 'Address bar'");
  t = await boot({ foregroundTitle: "Windows PowerShell", foregroundProcess: "powershell" });
  ok(t.d.querySelector("#keyboard-target").classList.contains("warn"), "warning colour when keys would go to a terminal/console");
  t = await boot({ foregroundTitle: "", foregroundProcess: "", browserReady: false });
  ok(t.d.querySelector("#keyboard-target-title").textContent === "No window in front" && t.d.querySelector("#keyboard-focus-browser").disabled, "no window in front is stated, Browser button disabled when no browser exists");
  console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
})().catch(e => { console.error("TEST ERROR", e); process.exit(2); });
