const path = require("node:path");
const ROOT = path.resolve(__dirname, "..", "..");
const FB = process.env.FAKE_PS_DIR;                      // where the fake PowerShell logs and reads its switches
const TMP = process.env.TEST_TMP || require("node:os").tmpdir();
const { JSDOM } = require("jsdom");
const fs = require("fs");
const root = path.join(ROOT, "public") + "/";
const appSource = () => [...fs.readFileSync(root + "index.html", "utf8").matchAll(/<script src="\/(js\/[a-z]+\.js)"/g)].map((m) => fs.readFileSync(root + m[1], "utf8")).join("\n");
let pass = 0, fail = 0;
const ok = (c, m) => { c ? pass++ : fail++; console.log((c ? "PASS " : "FAIL ") + m); };
const sleep = ms => new Promise(r => setTimeout(r, ms));

const APPS = [
  { id: "a1", name: "Calculator" }, { id: "a2", name: "Camera" }, { id: "a3", name: "Notepad++" },
  { id: "a4", name: "Édge Browser" }, { id: "a5", name: "7-Zip File Manager" }, { id: "a6", name: "Windows Calculator Plus" },
];
async function boot({ token = "tok", appsFail = false, player = "", statePlayers = [], running = [] } = {}) {
  const dom = new JSDOM(fs.readFileSync(root + "index.html", "utf8"), { url: "http://localhost:8765/", runScripts: "outside-only", pretendToBeVisual: true });
  const w = dom.window; const reqs = [];
  if (token) w.localStorage.setItem("remote-media-token", token);
  if (player) w.localStorage.setItem("remote-media-player", player);
  w.matchMedia = () => ({ matches: false, addListener() {}, addEventListener() {} });
  w.fetch = async (url, opt = {}) => {
    reqs.push({ url, method: opt.method || "GET", body: opt.body ? JSON.parse(opt.body) : null, auth: opt.headers?.Authorization });
    const res = (status, data) => ({ ok: status < 400, status, json: async () => data });
    if (url === "/api/pair") return res(JSON.parse(opt.body).pin === "123456" ? 200 : 401, JSON.parse(opt.body).pin === "123456" ? { token: "newtok" } : { error: "That code did not match." });
    if (url.startsWith("/api/apps")) return appsFail ? res(500, { error: "Windows did not respond in time." }) : res(200, { apps: APPS });
    if (url.startsWith("/api/state")) return token === "expired" ? res(401, { error: "Pair this device first." }) : res(200, { systemVolume: 30, players: statePlayers, running, browsers: ["default"] });
    if (url.startsWith("/api/files")) return res(200, { path: "", parent: "", drives: [{ name: "C", path: "C:\\", kind: "drive" }], folders: [], files: [] });
    if (url === "/api/control") return res(200, { ok: true });
    return res(404, { error: "nf" });
  };
  w.eval(appSource());
  await sleep(50);
  return { w, d: w.document, reqs };
}
const $ = (d, s) => d.querySelector(s);
(async () => {
  // ---------- layout ----------
  let { w, d, reqs } = await boot();
  const layout = $(d, ".mouse-layout"), pad = $(d, "#mouse-pad"), controls = $(d, ".mouse-controls");
  ok(layout.firstElementChild === pad && controls.previousElementSibling === pad, "mouse page: the touchpad comes first, the controls follow");
  const groups = [...controls.querySelectorAll(".mouse-group")].map(g => g.getAttribute("aria-label"));
  ok(groups.join() === "Click and drag,Scroll,Zoom", "controls grouped logically: " + groups.join(" / "));
  const acts = g => [...controls.querySelectorAll(`.mouse-group[aria-label="${g}"] [data-mouse-action]`)].map(b => b.dataset.mouseAction).join();
  ok(acts("Click and drag") === "mouseLeftClick,mouseDoubleClick,mouseRightClick" && !!controls.querySelector('.mouse-group[aria-label="Click and drag"] #mouse-drag-toggle'), "Click group: left, double, right + drag toggle");
  ok(acts("Scroll") === "mouseScrollUp,mouseScrollDown,mouseHome,mouseEnd", "Scroll group: up, down, Top (Ctrl+Home), Bottom (Ctrl+End): " + acts("Scroll"));
  ok(acts("Zoom") === "mouseZoomOut,mouseZoomReset,mouseZoomIn", "Zoom group: out, reset, in");
  ok(["mouseHome", "mouseEnd", "mouseLeftClick", "mouseScrollUp"].every(a => d.querySelectorAll(`[data-mouse-action="${a}"]`).length === 1), "every action exists exactly once (no duplicates)");
  ok(!$(d, ".mouse-edge-button") && !$(d, ".mouse-buttons"), "old layout is gone");
  $(d, '[data-mouse-action="mouseHome"]').click(); $(d, '[data-mouse-action="mouseEnd"]').click(); $(d, '[data-mouse-action="mouseRightClick"]').click(); await sleep(30);
  const ctl = reqs.filter(r => r.url === "/api/control").map(r => r.body.action);
  ok(["mouseHome", "mouseEnd", "mouseRightClick"].every(a => ctl.includes(a)), "buttons send their actions to the server");

  // ---------- home tile + page switch ----------
  ok(!!$(d, '.home-tile[data-go-page="apps"]'), "Home has an Apps tile");
  ok(reqs.some(r => r.url.startsWith("/api/state")) && reqs.some(r => r.url.startsWith("/api/files")), "stored token starts session (state + files loaded)");
  ok(!reqs.some(r => r.url.startsWith("/api/apps")), "apps list is NOT fetched until the Apps page is opened");
  $(d, '.home-tile[data-go-page="apps"]').click(); await sleep(60);
  ok($(d, '[data-page-panel="apps"]').classList.contains("active"), "Apps page becomes active");
  ok(reqs.filter(r => r.url.startsWith("/api/apps")).length === 1, "opening Apps loads the list once");
  ok($(d, "#apps-status").textContent === "6 apps", "status shows count: " + $(d, "#apps-status").textContent);
  const rows = () => [...d.querySelectorAll("#apps-list .app-row")].map(r => r.dataset.name);
  const letters = [...d.querySelectorAll("#apps-list .app-letter")].map(e => e.textContent);
  ok(rows().length === 6, "all six apps rendered");
  ok(JSON.stringify(letters) === JSON.stringify(["#", "C", "E", "N", "W"]), "grouped under letter headers, accents folded, digits under #: " + letters.join(""));

  // ---------- search ----------
  const type = async v => { const i = $(d, "#apps-search"); i.value = v; i.dispatchEvent(new w.Event("input")); await sleep(130); };
  await type("calc");
  ok(JSON.stringify(rows()) === JSON.stringify(["Calculator", "Windows Calculator Plus"]), "'calc' ranks prefix match before mid-name match: " + rows().join(" | "));
  ok(!d.querySelector("#apps-list .app-letter"), "no letter headers while searching");
  ok($(d, "#apps-status").textContent === "2 of 6 apps", "status: " + $(d, "#apps-status").textContent);
  await type("edge"); ok(rows().join() === "Édge Browser", "accent-insensitive search ('edge' finds 'Édge')");
  await type("file zip"); ok(rows().join() === "7-Zip File Manager", "multi-word search in any order");
  await type("CAM"); ok(rows().join() === "Camera", "case-insensitive");
  await type("zzzz"); ok(rows().length === 0 && /No apps match/.test($(d, "#apps-status").textContent), "no match message: " + $(d, "#apps-status").textContent);
  ok(!$(d, "#apps-list").children.length, "list emptied (CSS hides empty list)");
  const evil = $(d, "#apps-search"); await type("<img src=x onerror=alert(1)>");
  ok(!d.querySelector("#apps-list img") && !d.querySelector("#apps-status img"), "search text is never injected as HTML");

  // ---------- open ----------
  await type("note"); reqs.length = 0;
  $(d, "#apps-list .app-row").click(); await sleep(40);
  const open = reqs.find(r => r.url === "/api/control");
  ok(open && open.body.action === "openApp" && open.body.id === "a3" && open.auth === "Bearer tok", "tap sends openApp with the app id and auth token");
  ok($(d, "#apps-status").textContent === "Opened Notepad++.", "inline status: " + $(d, "#apps-status").textContent);
  await type("zoom-nothing"); await type("cam");
  reqs.length = 0;
  const si = $(d, "#apps-search"); si.value = "calc"; si.dispatchEvent(new w.KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true })); await sleep(40);
  ok(reqs.find(r => r.url === "/api/control")?.body.id === "a1", "Enter opens the best match immediately (even before debounce fires)");
  si.dispatchEvent(new w.KeyboardEvent("keydown", { key: "Escape", bubbles: true })); await sleep(30);
  ok(si.value === "" && rows().length === 6, "Escape clears the search");
  // double tap guard
  reqs.length = 0; const row = $(d, "#apps-list .app-row"); row.click(); row.click(); await sleep(30);
  ok(reqs.filter(r => r.url === "/api/control").length === 1, "double tap does not launch twice");

  // ---------- reload button ----------
  reqs.length = 0; $(d, "#apps-refresh").click(); await sleep(40);
  ok(reqs.some(r => r.url === "/api/apps?refresh=1"), "reload button asks the server for a fresh list");

  // ---------- error path ----------
  ({ w, d, reqs } = await boot({ appsFail: true }));
  $(d, '.home-tile[data-go-page="apps"]').click(); await sleep(60);
  ok($(d, "#apps-status").classList.contains("error") && /did not respond/.test($(d, "#apps-status").textContent), "load failure shows an error in the page");
  ok(!$(d, "#apps-refresh").disabled, "reload button re-enabled after failure so the user can retry");

  // ---------- pairing bug fix ----------
  ({ w, d, reqs } = await boot({ token: "" }));
  ok(!$(d, "#pair-view").classList.contains("hidden"), "unpaired shows pair screen");
  $(d, "#pin").value = "123456"; $(d, "#pair-form").dispatchEvent(new w.Event("submit", { cancelable: true, bubbles: true })); await sleep(60);
  ok(!$(d, "#remote-view").classList.contains("hidden"), "pairing with the PIN opens the remote");
  ok(reqs.some(r => r.url.startsWith("/api/files")), "after PIN pairing the file list loads (used to stay on 'Loading drives…')");
  ok(w.localStorage.getItem("remote-media-token") === "newtok", "token saved");
  $(d, "#pin").value = "000000"; $(d, "#unpair").click(); await sleep(30);

  // ---------- expired session ----------
  ({ w, d, reqs } = await boot({ token: "expired" })); await sleep(60);
  ok(!$(d, "#pair-view").classList.contains("hidden") && !w.localStorage.getItem("remote-media-token"), "401 returns to the pair screen and clears the token");
  ({ d } = await boot({ player: "musicbee", statePlayers: [{ name: "musicbee", volume: null, mode: "keys" }], running: ["musicbee"] }));
  ok(!$(d, "#player-slider-row").classList.contains("hidden") && $(d, "#player-keys-row").classList.contains("hidden") && $(d, "#player-volume").disabled, "MusicBee keeps the slider visible but disables it without an audio session");
  ok(/shared audio mode/.test($(d, "#player-volume-note").textContent), "MusicBee explains how to expose its audio session");
  ({ d } = await boot({ player: "mpc-hc64", statePlayers: [{ name: "mpc-hc64", volume: null, mode: "keys" }], running: ["mpc-hc64"] }));
  ok(!$(d, "#player-slider-row").classList.contains("hidden") && $(d, "#player-volume").disabled && /enable MPC-HC Web Interface/i.test($(d, "#player-volume-note").textContent), "K-Lite keeps slider visible and explains available absolute volume sources");
  ({ d } = await boot({ player: "mpc-hc64", statePlayers: [{ name: "mpc-hc64", volume: 64, mode: "web" }], running: ["mpc-hc64"] }));
  ok(!$(d, "#player-slider-row").classList.contains("hidden") && $(d, "#player-value").value === "64", "K-Lite with web volume shows its confirmed internal level on the slider");
  console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
})().catch(e => { console.error("TEST ERROR", e); process.exit(2); });
