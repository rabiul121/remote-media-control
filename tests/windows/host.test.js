// The persistent PowerShell host, started for real (needs PowerShell 7). It must announce itself, answer many
// requests in a row, report a failing request without dying, and clean up its results.
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const ROOT = path.resolve(__dirname, "..", "..");
const pwsh = process.env.PWSH || "pwsh";
let pass = 0, fail = 0;
const ok = (c, m) => { c ? pass++ : fail++; console.log((c ? "PASS " : "FAIL ") + m); };

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "host-test-"));
fs.mkdirSync(path.join(dir, "sub")); fs.writeFileSync(path.join(dir, "a.mp3"), "");
// Get-StartApps only exists on Windows, so a stand-in is defined before the host script runs.
const stub = 'function Get-StartApps { [pscustomobject]@{Name="Calculator";AppID="calc!App"}; [pscustomobject]@{Name="Uninstall X";AppID="u!x"}; [pscustomobject]@{Name="Calculator again";AppID="calc!App"} }';
const child = spawn(pwsh, ["-NoProfile", "-Command", `${stub}; & '${path.join(ROOT, "windows", "host.ps1")}'`], { env: { ...process.env, DOTNET_SYSTEM_GLOBALIZATION_INVARIANT: "1" } });
const lines = []; let buffer = "";
child.stdout.on("data", (d) => { buffer += d; let i; while ((i = buffer.indexOf("\n")) >= 0) { lines.push(buffer.slice(0, i).trim()); buffer = buffer.slice(i + 1); } });
const send = (id, action, payload) => child.stdin.write(JSON.stringify({ id, action, payload }) + "\n");
const reply = async (id) => { for (let i = 0; i < 400; i++) { const l = lines.map((x) => { try { return JSON.parse(x); } catch { return null; } }).find((x) => x && x.id === id); if (l) return l; await new Promise((r) => setTimeout(r, 50)); } return null; };

(async () => {
  for (let i = 0; i < 400 && !lines.includes('{"ready":true}'); i++) await new Promise((r) => setTimeout(r, 50));
  ok(lines.includes('{"ready":true}'), "host starts and announces it is ready");
  send("1", "browse", { path: dir, mediaExtensions: [".mp3"] });
  const browse = await reply("1"); const listing = browse && JSON.parse(browse.result);
  ok(browse?.ok && listing.folders[0].name === "sub" && listing.files[0].name === "a.mp3", "browse: lists folders and media files");
  send("2", "apps", {}); const apps = await reply("2"); const list = apps && JSON.parse(apps.result);
  ok(apps?.ok && list.length === 1 && list[0].name === "Calculator", "apps: hides 'Uninstall' entries and duplicates");
  send("3", "browse", { path: path.join(dir, "missing"), mediaExtensions: [] }); const state = await reply("3");
  ok(state && state.ok === false && state.error, "a failing request is reported as an error");
  send("4", "browse", { path: dir, mediaExtensions: [] }); const again = await reply("4");
  ok(again?.ok, "the host keeps serving after that failure");
  send("5", "control", { action: "playerVolume", player: "", value: 50 }); const ctl = await reply("5");
  ok(ctl && ctl.ok === false && ctl.error === "Choose a player first.", "errors carry their own message: " + (ctl && ctl.error));
  send("6", "no-such-action", {}); const unknown = await reply("6");
  ok(unknown?.ok === true && unknown.result === "", "an unknown action is a harmless empty answer");
  child.kill(); fs.rmSync(dir, { recursive: true, force: true });
  console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
})();
