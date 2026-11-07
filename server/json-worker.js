// A long-running PowerShell process that answers one JSON request per line.
// Starting PowerShell and compiling the native helpers costs 1-3 seconds, so we
// do it once and keep the process alive instead of starting one per action.
const { spawn } = require("node:child_process");

// The worker reads its console as non-UTF-8, so every non-ASCII character is \u-escaped.
const asciiJson = (value) =>
  JSON.stringify(value).replace(/[\u007f-\uffff]/g, (c) => "\\u" + c.charCodeAt(0).toString(16).padStart(4, "0"));

// "Exception calling "KeyPress" with "5" argument(s): "<message>"" -> "<message>"
const cleanMessage = (text) =>
  String(text || "").replace(/^Exception calling "[^"]*" with "\d+" argument\(s\): "([\s\S]*)"$/, "$1").trim();

class JsonLineWorker {
  constructor({ name, script, timeoutMs = 30000, onSpawn = null }) {
    Object.assign(this, { name, script, timeoutMs, onSpawn });
    this.child = null;
    this.pending = new Map();
    this.sequence = 0;
    this.stats = { starts: 0, lastError: null, lastErrorAt: 0, answered: 0 };
  }
  get running() {
    return !!this.child && this.child.exitCode === null && !this.child.killed;
  }
  start() {
    if (this.running) return this.child;
    const child = spawn(
      "powershell.exe",
      ["-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", this.script],
      { windowsHide: true },
    );
    this.child = child;
    this.stats.starts++;
    let buffer = "", errors = "", answered = false;
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      buffer += chunk;
      let newline;
      while ((newline = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        if (!line) continue;
        let message;
        try { message = JSON.parse(line); } catch { continue; }
        if (message.ready) { answered = true; continue; }
        const entry = this.pending.get(message.id);
        if (!entry) continue;
        answered = true;
        this.pending.delete(message.id);
        clearTimeout(entry.timer);
        this.stats.answered++;
        if (message.ok === false) message.error = cleanMessage(message.error);
        entry.resolve(message);
      }
    });
    child.stderr.on("data", (chunk) => { errors += chunk; });
    child.stdin.on("error", (error) => this.fail(child, error, !answered));
    child.on("error", (error) => this.fail(child, error, !answered));
    child.on("close", (code) =>
      this.fail(child, new Error(cleanMessage(errors) || `${this.name} worker stopped (code ${code}).`), !answered),
    );
    if (this.onSpawn) this.onSpawn(this);
    return child;
  }
  // A worker that dies before it ever answered probably cannot run at all; callers may fall back.
  fail(child, error, startup) {
    if (this.child === child) this.child = null;
    this.stats.lastError = error.message;
    this.stats.lastErrorAt = Date.now();
    const failure = Object.assign(new Error(error.message), { startup });
    for (const [id, entry] of this.pending) {
      this.pending.delete(id);
      clearTimeout(entry.timer);
      entry.reject(failure);
    }
  }
  write(message) {
    const child = this.start();
    child.stdin.write(asciiJson(message) + "\n");
  }
  call(request, timeoutMs = this.timeoutMs) {
    return new Promise((resolve, reject) => {
      const child = this.start();
      const id = String(++this.sequence);
      const timer = setTimeout(() => {
        if (!this.pending.delete(id)) return;
        // A silent worker is killed; the next call starts a fresh one.
        try { child.kill(); } catch {}
        if (this.child === child) this.child = null;
        reject(new Error(`${this.name} did not respond in time.`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      child.stdin.write(asciiJson({ id, ...request }) + "\n", (error) => {
        if (!error) return;
        const entry = this.pending.get(id);
        if (!entry) return;
        this.pending.delete(id);
        clearTimeout(timer);
        reject(error);
      });
    });
  }
  stop() {
    try { this.child?.kill(); } catch {}
    this.child = null;
  }
}

module.exports = { JsonLineWorker, asciiJson, cleanMessage };
