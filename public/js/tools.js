// Tools page: power, phone settings, typing settings and test, diagnostics.
// (Plain script: files share one global scope and load in the order listed in index.html.)

// ---------- Tools page ----------
function bindPrefs() {
  const range = (id, out, key) => {
    const input = $(id), show = () => ($(out).textContent = Number(prefs[key]).toFixed(1) + "×");
    input.value = prefs[key];
    show();
    input.addEventListener("input", () => { prefs[key] = Number(input.value); show(); savePrefs(); });
  };
  const check = (id, key, after) => {
    const input = $(id);
    input.checked = !!prefs[key];
    input.addEventListener("change", () => { prefs[key] = input.checked; savePrefs(); after?.(); });
  };
  range("#set-mouse-speed", "#out-mouse-speed", "mouseSpeed");
  range("#set-scroll-speed", "#out-scroll-speed", "scrollSpeed");
  check("#set-natural-scroll", "naturalScroll");
  check("#set-haptics", "haptics", () => buzz(30));
  check("#set-wake", "wake", updateWakeLock);
  check("#set-restore-page", "restorePage");
}
bindPrefs();

const POWER_MESSAGES = {
  lock: "PC locked.", sleep: "Going to sleep…", displayOff: "Screen turned off. Move the mouse on the PC to wake it.",
  restart: "Restarting in 15 seconds. Press Cancel to stop.", shutdown: "Shutting down in 15 seconds. Press Cancel to stop.", cancel: "Cancelled.",
};
document.querySelectorAll("[data-power]").forEach((button) => {
  let revert = null;
  const reset = () => { clearTimeout(revert); if (button.dataset.label) button.textContent = button.dataset.label; button.classList.remove("confirm"); };
  button.addEventListener("click", async () => {
    const what = button.dataset.power;
    // Restart and shut down need a second tap so a stray touch cannot switch the PC off.
    if (button.classList.contains("danger") && !button.classList.contains("confirm")) {
      button.dataset.label = button.textContent;
      button.textContent = "Tap to confirm";
      button.classList.add("confirm");
      revert = setTimeout(reset, 4000);
      return;
    }
    reset();
    try {
      await request("/api/control", { method: "POST", body: JSON.stringify({ action: "power", what }) });
      $("#power-status").textContent = POWER_MESSAGES[what];
    } catch (e) { $("#power-status").textContent = e.message; }
  });
});

async function loadPcSettings() {
  try {
    const settings = await request("/api/settings");
    $("#set-key-method").value = settings.keyMethod;
    $("#set-text-method").value = settings.textMethod;
    $("#set-fallback").checked = !!settings.fallback;
    pcSettingsLoaded = true;
  } catch (e) { notify(e.message); }
}
async function savePcSettings() {
  try {
    await request("/api/settings", { method: "POST", body: JSON.stringify({
      keyMethod: $("#set-key-method").value, textMethod: $("#set-text-method").value, fallback: $("#set-fallback").checked,
    }) });
  } catch (e) { notify(e.message); }
}
["#set-key-method", "#set-text-method", "#set-fallback"].forEach((id) => $(id).addEventListener("change", savePcSettings));

function summarizeInputTest(r) {
  const verdict = (x) => (x?.ok ? "works" : x?.error ? "failed (" + x.error + ")" : "blocked");
  const lines = [`Standard keys: ${verdict(r.keys)}`, `Direct text: ${verdict(r.unicode)}`, `Compatibility keys: ${verdict(r.legacy)}`, `Paste text: ${verdict(r.paste)}`, ""];
  lines.push(r.anyWorks
    ? `Now using: keys = ${r.settings.keyMethod}, text = ${r.settings.textMethod}.` + (r.elevated ? "" : "\nIf one app still ignores typing, it may be running as administrator.")
    : "Windows blocked every method. A security or remote-control program may be filtering simulated input.");
  return lines.join("\n");
}
async function runInputTest(button, show) {
  const label = button.textContent;
  button.disabled = true;
  button.textContent = "Testing… a small window will appear";
  let text;
  try {
    const result = await request("/api/input-test", { method: "POST", body: "{}" });
    text = summarizeInputTest(result);
    $("#set-key-method").value = result.settings.keyMethod;
    $("#set-text-method").value = result.settings.textMethod;
  } catch (e) { text = e.message; }
  button.disabled = false;
  button.textContent = label;
  show(text);
}
$("#run-input-test").addEventListener("click", () =>
  runInputTest($("#run-input-test"), (text) => { const box = $("#input-test-result"); box.textContent = text; box.classList.remove("hidden"); }),
);

function formatDiagnostics(d) {
  const minutes = Math.round(d.uptimeSeconds / 60), w = d.windows;
  const lines = [
    `RemoteDeck ${d.version} on Node ${d.node}`,
    `Running for ${minutes < 120 ? minutes + " min" : Math.round(minutes / 60) + " h"} · ${d.pairedDevices} paired phone(s)`,
    `Windows helper: ${d.system.mode}`,
    `Typing: keys ${d.settings.keyMethod}, text ${d.settings.textMethod}, auto-switch ${d.settings.fallback ? "on" : "off"}`,
    d.input.lastError ? `Last typing error: ${d.input.lastError.message}` : "Last typing error: none",
    "",
  ];
  if (w) {
    lines.push(`PowerShell ${w.psVersion} · user ${w.user} · session ${w.session}`, `RemoteDeck runs as administrator: ${w.elevated ? "yes" : "no"}`,
      `Default browser: ${w.defaultBrowser || "unknown"} · MPC-HC web interface: ${w.mpcWeb ? "on" : "off"}`, "",
      "Programs playing audio:", ...(w.audio.length ? w.audio.map((x) => "  " + x) : ["  none right now"]));
  } else lines.push("Windows details unavailable: " + d.windowsError);
  return lines.join("\n");
}
$("#load-diagnostics").addEventListener("click", async () => {
  const box = $("#diagnostics-result");
  box.classList.remove("hidden");
  box.textContent = "Loading…";
  try { box.textContent = formatDiagnostics(await request("/api/diagnostics")); } catch (e) { box.textContent = e.message; }
});
$("#unpair-others").addEventListener("click", async () => {
  try {
    const r = await request("/api/unpair-others", { method: "POST", body: "{}" });
    $("#unpair-others").textContent = r.removed ? `Signed out ${r.removed} other phone(s)` : "No other phones are paired";
    setTimeout(() => ($("#unpair-others").textContent = "Sign out other phones"), 3000);
  } catch (e) { notify(e.message); }
});
