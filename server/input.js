// Mouse, keyboard and typed text. One long-running worker keeps them fast and in order.
const path = require("node:path");
const { JsonLineWorker } = require("./json-worker");
const { windowsDir } = require("./config");
const settings = require("./settings");

const configureMessage = () => {
  const s = settings.get();
  return { id: "configure", action: "configure", keyMethod: s.keyMethod, textMethod: s.textMethod, fallback: s.fallback };
};
const worker = new JsonLineWorker({
  name: "Input worker",
  script: path.join(windowsDir, "input-worker.ps1"),
  timeoutMs: 20000, // the first call compiles the native helpers
  onSpawn: (w) => { try { w.child.stdin.write(JSON.stringify(configureMessage()) + "\n"); } catch {} },
});

let lastError = null;
let dragging = false, releaseTimer = null;

// Safety net: if the phone vanishes mid-drag, release the left button after 30 s of silence.
function armRelease() {
  clearTimeout(releaseTimer);
  releaseTimer = setTimeout(() => {
    send("mouseLeftUp").catch(() => {});
    dragging = false;
    releaseTimer = null;
  }, 30000);
  releaseTimer.unref?.();
}
function trackDrag(action) {
  if (action === "mouseLeftDown") { dragging = true; armRelease(); }
  else if (action === "mouseMove" && dragging) armRelease(); // a moving drag is not idle
  else if (action === "mouseLeftUp") { dragging = false; clearTimeout(releaseTimer); releaseTimer = null; }
}

async function send(action, payload = {}) {
  try {
    const reply = await worker.call({ action, ...payload });
    if (reply.ok === false) throw new Error(reply.error || "Input failed.");
  } catch (e) {
    lastError = { action, message: e.message, at: Date.now() };
    throw e;
  }
}

const applySettings = () => { try { worker.write(configureMessage()); } catch {} };
const stop = () => worker.stop();
const status = () => {
  const { lastError: workerError, lastErrorAt, ...counters } = worker.stats;
  return { ...counters, running: worker.running, dragging, lastError, workerError, workerErrorAt: lastErrorAt };
};

module.exports = { send, trackDrag, applySettings, stop, status, isDragging: () => dragging };
