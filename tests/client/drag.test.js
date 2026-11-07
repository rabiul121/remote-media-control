const path = require("node:path");
const ROOT = path.resolve(__dirname, "..", "..");
const FB = process.env.FAKE_PS_DIR;                      // where the fake PowerShell logs and reads its switches
const TMP = process.env.TEST_TMP || require("node:os").tmpdir();
const { JSDOM } = require("jsdom"); const fs = require("fs");
const root = path.join(ROOT, "public") + "/";
const appSource = () => [...fs.readFileSync(root + "index.html", "utf8").matchAll(/<script src="\/(js\/[a-z]+\.js)"/g)].map((m) => fs.readFileSync(root + m[1], "utf8")).join("\n");
let pass = 0, fail = 0; const ok = (c, m) => { c ? pass++ : fail++; console.log((c ? "PASS " : "FAIL ") + m); };
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function boot() {
  const dom = new JSDOM(fs.readFileSync(root + "index.html", "utf8"), { url: "http://localhost:8765/", runScripts: "outside-only", pretendToBeVisual: true });
  const w = dom.window, log = [];
  w.localStorage.setItem("remote-media-token", "tok");
  w.matchMedia = () => ({ matches: false, addListener() {}, addEventListener() {} });
  w.fetch = async (url, opt = {}) => {
    const body = opt.body ? JSON.parse(opt.body) : null;
    if (url === "/api/control") { log.push(body.action + (body.dx !== undefined && body.action === "mouseMove" ? "" : "")); await sleep(Math.random() * 25); }  // random latency
    const data = url.startsWith("/api/state") ? { players: [], running: [], browsers: ["default"] } : url.startsWith("/api/files") ? { path: "", parent: "", drives: [], folders: [], files: [] } : { ok: true };
    return { ok: true, status: 200, json: async () => data };
  };
  w.eval(appSource());
  const pad = w.document.querySelector("#mouse-pad");
  pad.setPointerCapture = () => {}; pad.hasPointerCapture = () => false; pad.releasePointerCapture = () => {};
  w.document.querySelector('.home-tile[data-go-page="mouse"]').click();
  const fire = (type, id, x, y) => { const e = new w.MouseEvent(type, { clientX: x, clientY: y, bubbles: true, cancelable: true }); Object.defineProperty(e, "pointerId", { value: id }); pad.dispatchEvent(e); };
  return { w, d: w.document, log, fire, pad };
}
const moves = l => l.filter(a => a === "mouseMove").length;
(async () => {
  let t;
  // 1. tap, then touch again and slide  => drag
  t = await boot(); await sleep(60); t.log.length = 0;
  t.fire("pointerdown", 1, 100, 100); await sleep(40); t.fire("pointerup", 1, 100, 100);       // tap
  await sleep(80); t.fire("pointerdown", 2, 100, 100);                                         // touch again
  for (let i = 1; i <= 8; i++) { await sleep(30); t.fire("pointermove", 2, 100, 100 + i * 6); } // slide down
  await sleep(150); t.fire("pointerup", 2, 100, 148); await sleep(500);
  let L = t.log;
  ok(L.includes("mouseLeftDown") && L.at(-1) === "mouseLeftUp", "tap + touch-and-slide: button down ... button up (" + L.join(",") + ")");
  ok(L.indexOf("mouseLeftDown") < L.lastIndexOf("mouseMove") && L.lastIndexOf("mouseMove") < L.indexOf("mouseLeftUp"), "moves happen between down and up, in order despite random server latency");
  ok(moves(L) >= 1, "pointer moves were sent while dragging (" + moves(L) + ")");
  ok(!L.includes("mouseLeftClick") && !L.includes("mouseDoubleClick") && !L.includes("mouseRightClick"), "no stray click / double click / right click");
  ok(L.filter(a => a === "mouseLeftDown").length === 1 && L.filter(a => a === "mouseLeftUp").length === 1, "exactly one down and one up");

  // 2. tap, then touch and hold without moving => drag after hold
  t = await boot(); await sleep(60); t.log.length = 0;
  t.fire("pointerdown", 1, 50, 50); await sleep(30); t.fire("pointerup", 1, 50, 50);
  await sleep(60); t.fire("pointerdown", 2, 50, 50); await sleep(400);
  ok(t.log.includes("mouseLeftDown"), "tap + hold (no movement) starts a drag after ~0.2 s");
  t.fire("pointerup", 2, 50, 50); await sleep(150);
  ok(t.log.at(-1) === "mouseLeftUp", "lifting the finger releases the button");

  // 3. tap + quick tap => double click, no drag
  t = await boot(); await sleep(60); t.log.length = 0;
  t.fire("pointerdown", 1, 50, 50); await sleep(30); t.fire("pointerup", 1, 50, 50);
  await sleep(60); t.fire("pointerdown", 2, 50, 50); await sleep(40); t.fire("pointerup", 2, 50, 50); await sleep(400);
  ok(t.log.join() === "mouseDoubleClick", "tap + quick tap is still a double click (" + t.log.join() + ")");

  // 4. single tap => click ; plain slide => cursor move only ; long press => right click
  t = await boot(); await sleep(60); t.log.length = 0;
  t.fire("pointerdown", 1, 50, 50); await sleep(30); t.fire("pointerup", 1, 50, 50); await sleep(400);
  ok(t.log.join() === "mouseLeftClick", "single tap is still a click");
  t.log.length = 0; t.fire("pointerdown", 1, 50, 50); for (let i = 1; i <= 6; i++) { await sleep(40); t.fire("pointermove", 1, 50 + i * 8, 50); } t.fire("pointerup", 1, 98, 50); await sleep(300);
  ok(!t.log.includes("mouseLeftDown") && moves(t.log) >= 1, "plain slide only moves the cursor (no button down)");
  t.log.length = 0; t.fire("pointerdown", 1, 50, 50); await sleep(650); t.fire("pointerup", 1, 50, 50); await sleep(200);
  ok(t.log.join() === "mouseRightClick", "long press is still a right click");

  // 5. toggle button ("Hold & drag")
  t = await boot(); await sleep(60); t.log.length = 0;
  const btn = t.d.querySelector("#mouse-drag-toggle");
  btn.click(); await sleep(60);
  ok(t.log.includes("mouseLeftDown") && btn.getAttribute("aria-pressed") === "true" && /release/i.test(btn.textContent) && t.pad.classList.contains("dragging"), "toggle on: button down, UI shows dragging");
  t.fire("pointerdown", 1, 10, 10); for (let i = 1; i <= 5; i++) { await sleep(40); t.fire("pointermove", 1, 10, 10 + i * 9); } await sleep(120); t.fire("pointerup", 1, 10, 55); await sleep(200);
  ok(moves(t.log) >= 1, "sliding while toggled moves the pointer with the button held");
  ok(!t.log.includes("mouseLeftClick") && !t.log.includes("mouseRightClick") && t.log.filter(a => a === "mouseLeftUp").length === 0, "lifting the finger does not click or release in lock mode");
  t.fire("pointerdown", 1, 10, 10); await sleep(700); t.fire("pointerup", 1, 10, 10); await sleep(100);
  ok(!t.log.includes("mouseRightClick"), "long press while locked does not right-click");
  btn.click(); await sleep(200);
  ok(t.log.at(-1) === "mouseLeftUp" && btn.getAttribute("aria-pressed") === "false" && !t.pad.classList.contains("dragging"), "toggle off releases the button");

  // 6. safety: leaving the Mouse page releases a held button
  t = await boot(); await sleep(60); t.log.length = 0;
  t.d.querySelector("#mouse-drag-toggle").click(); await sleep(60);
  t.d.querySelector('.brand').click(); await sleep(200);
  ok(t.log.at(-1) === "mouseLeftUp", "leaving the Mouse page while holding releases the button");
  // 7. safety: app goes to background
  t = await boot(); await sleep(60); t.log.length = 0;
  t.d.querySelector("#mouse-drag-toggle").click(); await sleep(60);
  Object.defineProperty(t.d, "hidden", { value: true, configurable: true }); t.d.dispatchEvent(new t.w.Event("visibilitychange")); await sleep(200);
  ok(t.log.at(-1) === "mouseLeftUp", "backgrounding the page while holding releases the button");
  console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
})().catch(e => { console.error("TEST ERROR", e); process.exit(2); });
