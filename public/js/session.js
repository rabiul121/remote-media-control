// The live connection: start, poll, refresh, and the generic command sender.
// (Plain script: files share one global scope and load in the order listed in index.html.)

function startSession() {
  connected(true);
  clearInterval(timer);
  refresh();
  loadFiles("");
  timer = setInterval(poll, 5000);
}
// The timer skips a tick while the phone is in the background or the previous
// status check is still running, so slow PowerShell calls cannot pile up.
async function poll() {
  if (polling || document.hidden) return;
  polling = true;
  try {
    await refresh();
  } finally {
    polling = false;
  }
}
async function refresh(full = false) {
  try {
    paint(await request("/api/state" + (full === true ? "?full=1" : "")));
  } catch (err) {
    if (err.message === "Pair this device first.") {
      disconnect(false);
      return;
    }
    notify(err.message);
  }
}
async function command(action, value) {
  try {
    await request("/api/control", {
      method: "POST",
      body: JSON.stringify({
        action,
        player: selected,
        ...(value && typeof value === "object" ? value : { value }),
      }),
    });
    if (action === "systemVolume" || action === "playerVolume" || action.startsWith("explorer")) await refresh();
  } catch (e) {
    notify(e.message);
    // A rejected key is easy to miss in a toast, so say what to do where the typing happens.
    if (/Windows accepted|simulated input|clipboard/i.test(e.message))
      showKeyboardHint("Windows rejected the key press. Tap Test to find a typing method that works on this PC.", "error");
  }
}
