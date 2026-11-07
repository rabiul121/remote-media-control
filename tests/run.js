#!/usr/bin/env node
// Runs every test suite and prints one summary. Usage:  node tests/run.js [client|server|windows]
//   client  : the phone UI against a simulated PC (needs `cd tests && npm install` for jsdom)
//   server  : the listener against a fake PowerShell (Linux/macOS/WSL)
//   windows : the real PowerShell and C# against mocks (needs PowerShell 7 = pwsh; some also gcc/python3)
const { spawn, spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const here = __dirname;
const only = process.argv[2];
const isWindows = process.platform === "win32";
const work = fs.mkdtempSync(path.join(os.tmpdir(), "remotedeck-tests-"));
const fakeDir = path.join(work, "fake");
fs.mkdirSync(fakeDir);
fs.copyFileSync(path.join(here, "fake-powershell", "powershell.exe"), path.join(fakeDir, "powershell.exe"));
fs.chmodSync(path.join(fakeDir, "powershell.exe"), 0o755);

const have = (cmd, args = ["--version"]) => { try { return spawnSync(cmd, args, { stdio: "ignore" }).status === 0; } catch { return false; } };
const pwsh = process.env.PWSH || (have("pwsh") ? "pwsh" : fs.existsSync("/tmp/pwsh/pwsh") ? "/tmp/pwsh/pwsh" : null);
const env = { ...process.env, FAKE_PS_DIR: fakeDir, TEST_TMP: work, PWSH: pwsh || "", DOTNET_SYSTEM_GLOBALIZATION_INVARIANT: "1" };

const jsdomInstalled = fs.existsSync(path.join(here, "node_modules", "jsdom"));
// when = can this suite run here;  needs = what to install if not
const suites = [
  ...["pages", "drag", "keyboard", "tools"].map((n) => ({ group: "client", name: `client/${n}`, cmd: process.execPath, args: [path.join(here, "client", `${n}.test.js`)], when: jsdomInstalled, needs: "jsdom: run `cd tests && npm install`" })),
  ...["core", "input", "features"].map((n) => ({ group: "server", name: `server/${n}`, cmd: process.execPath, args: [path.join(here, "server", `${n}.test.js`)], when: !isWindows, needs: "Linux, macOS or WSL" })),
  { group: "windows", name: "windows/syntax (parse, compile, C# 5)", cmd: pwsh, args: ["-NoProfile", "-File", path.join(here, "windows", "syntax.test.ps1")], when: !!pwsh, needs: "PowerShell 7 (pwsh)" },
  { group: "windows", name: "windows/input (key sequences)", cmd: pwsh, args: ["-NoProfile", "-File", path.join(here, "windows", "input.test.ps1")], when: !!pwsh, needs: "PowerShell 7 (pwsh)" },
  { group: "windows", name: "windows/host (persistent host)", cmd: process.execPath, args: [path.join(here, "windows", "host.test.js")], when: !!pwsh, needs: "PowerShell 7 (pwsh)" },
  { group: "windows", name: "windows/input-worker (stub user32)", cmd: "bash", args: [path.join(here, "windows", "input-worker.e2e.sh"), pwsh || "pwsh", path.join(work, "e2e")], when: !!pwsh && !isWindows && have("gcc"), needs: "pwsh and gcc" },
  { group: "windows", name: "windows/actions (state, volume, power)", cmd: pwsh, args: ["-NoProfile", "-File", path.join(here, "windows", "actions.test.ps1")], when: !!pwsh && !isWindows && have("python3"), needs: "pwsh and python3", setup: "actions" },
];

function run(suite) {
  return new Promise((resolve) => {
    const extras = [];
    if (suite.setup === "actions") {
      // Two dummy processes named like the players, and a stand-in for MPC-HC's web interface.
      const dir = path.join(work, "actions"); fs.mkdirSync(dir, { recursive: true });
      const sleepBin = spawnSync("which", ["sleep"], { encoding: "utf8" }).stdout.trim();
      for (const name of ["MusicBee", "mpc-hc64"]) { fs.copyFileSync(sleepBin, path.join(dir, name)); fs.chmodSync(path.join(dir, name), 0o755); extras.push(spawn(path.join(dir, name), ["300"], { stdio: "ignore" })); }
      extras.push(spawn("python3", [path.join(here, "windows", "mpc-web-server.py")], { stdio: "ignore", env: { ...env, ACTIONS_TEST_DIR: dir } }));
      env.ACTIONS_TEST_DIR = dir;
      spawnSync("sleep", ["1.5"]);
    }
    const child = spawn(suite.cmd, suite.args, { env, cwd: path.resolve(here, "..") });
    let out = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (out += d));
    child.on("close", (code) => {
      extras.forEach((p) => { try { p.kill(); } catch {} });
      const counts = [...out.matchAll(/(\d+) passed, (\d+) failed/g)].pop();
      resolve({ code, out, passed: counts ? +counts[1] : 0, failed: counts ? +counts[2] : code ? 1 : 0 });
    });
  });
}

(async () => {
  let totalPass = 0, totalFail = 0, skipped = 0;
  for (const suite of suites) {
    if (only && suite.group !== only) continue;
    if (!suite.when) { skipped++; console.log(`SKIP  ${suite.name}  (needs ${suite.needs})`); continue; }
    const r = await run(suite);
    totalPass += r.passed; totalFail += r.failed;
    console.log(`${r.code === 0 ? "ok   " : "FAIL "} ${suite.name}  ${r.passed} passed${r.failed ? ", " + r.failed + " FAILED" : ""}`);
    if (r.code !== 0) console.log(r.out.split("\n").filter((l) => /FAIL|Error|error/.test(l)).slice(0, 12).map((l) => "      " + l).join("\n"));
  }
  fs.rmSync(work, { recursive: true, force: true });
  console.log(`\n${totalPass} checks passed, ${totalFail} failed, ${skipped} suite(s) skipped`);
  process.exit(totalFail ? 1 : 0);
})();
