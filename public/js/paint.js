// State from the PC -> what is shown on screen. One small function per area.
// (Plain script: files share one global scope and load in the order listed in index.html.)

function formatPlayer(name) {
  return players[name] || name;
}
function setRange(input, value) {
  input.value = value;
  input.style.setProperty("--fill", `${value}%`);
}
const LOCKS = [
  ["numLock", "lock-num", "NUMLOCK", "Num Lock"],
  ["capsLock", "lock-caps", "CAPSLOCK", "Caps Lock"],
  ["scrollLock", "lock-scroll", "SCROLLLOCK", "Scroll Lock"],
];
const SHELL_PROCESSES = /^(powershell|pwsh|node|conhost|cmd|windowsterminal)$/i;
const BROWSER_NAMES = { brave: "Brave", chrome: "Chrome", edge: "Edge", firefox: "Firefox" };

// state -> screen. Each function below updates one area.
function paint(s) {
  state = s;
  paintLocks(s);
  paintPlayerPicker(s);
  paintSystemVolume(s);
  paintPlayer(s);
  paintBrowser(s);
  paintWindowControls(s);
  paintKeyboardTarget(s);
  $("#last-updated").textContent = "UPDATED " + new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}
function paintLocks(s) {
  for (const [property, id, key, label] of LOCKS) {
    const active = !!s[property];
    const indicator = $("#" + id);
    indicator.classList.toggle("active", active);
    indicator.setAttribute("aria-label", label + (active ? " on" : " off"));
    document.querySelectorAll(`[data-key="${key}"]`).forEach((button) => button.classList.toggle("lock-on", active));
  }
}
function paintPlayerPicker(s) {
  const running = s.running || [];
  if (selected && !["vlc", "musicbee", "potplayer", "mpc-hc64", "wmplayer"].includes(selected)) selected = "";
  if (!selected) selected = ["vlc", "musicbee", "potplayer", "mpc-hc64"].find((n) => running.includes(n)) || "";
  for (const b of document.querySelectorAll(".player-option")) {
    const active = running.includes(b.dataset.player);
    b.querySelector(".player-state").textContent = active ? "RUNNING" : "OFFLINE";
    b.querySelector(".player-state").classList.toggle("running", active);
    b.classList.toggle("selected", b.dataset.player === selected);
  }
}
function paintSystemVolume(s) {
  setRange($("#system-volume"), s.systemVolume ?? 0);
  $("#system-value").value = s.systemVolume ?? 0;
  $("#system-mute").classList.toggle("active", !!s.systemMuted);
}
// How a player's volume is controlled depends on what Windows can see (see windows/actions.ps1):
//   mixer = per-app volume in Windows, web = the player's web interface, keys = only its volume keys
function paintPlayer(s) {
  const found = (s.players || []).find((p) => p.name === selected);
  const hasLevel = !!found && found.volume != null;
  const keysOnly = !!found && !hasLevel;
  const label = selected ? formatPlayer(selected) : "player";
  const isRunning = (s.running || []).includes(selected);
  const range = $("#player-volume");
  $("#player-slider-row").classList.toggle("hidden", keysOnly);
  $("#player-keys-row").classList.toggle("hidden", !keysOnly);
  $("#player-volume-title").textContent = selected ? `${label} volume` : "Player volume";
  $("#player-volume-note").textContent = !selected ? ""
    : !isRunning ? `Open ${label} to control its volume.`
    : found?.mode === "web" ? "Controlled through the player's web interface."
    : keysOnly ? `Windows can't read ${label}'s own volume (it probably uses exclusive or ASIO output), so these buttons press its volume keys.` : "";
  range.disabled = !hasLevel;
  if (hasLevel) {
    setRange(range, found.volume);
    $("#player-value").value = found.volume;
  } else {
    $("#player-value").value = "—";
    range.value = 0;
    range.style.setProperty("--fill", "0%");
  }
  $("#player-mute").classList.toggle("active", !!found?.muted);
  $("#player-selection-label").textContent = selected ? `Player: ${label}` : "Choose player";
  for (const [id, verb] of [["#player-open", "Open"], ["#player-close", "Close"]]) {
    $(id).title = `${verb} ${label}`;
    $(id).setAttribute("aria-label", `${verb} ${label}`);
    $(id).disabled = !selected;
  }
  const videoPlayer = selected !== "musicbee" && selected !== "wmplayer";
  $("#player-fullscreen").disabled = !selected || !isRunning || !videoPlayer;
  $("#player-fullscreen").title = !isRunning ? "Open this player first" : videoPlayer ? "Toggle full screen in " + label : "Full screen is available for video players";
  localStorage.setItem("remote-media-player", selected || "");
}
function paintBrowser(s) {
  const available = s.browsers || ["default"];
  document.querySelectorAll("#browser-select option").forEach((o) => { o.disabled = o.value !== "default" && !available.includes(o.value); });
  if (!available.includes(selectedBrowser)) {
    selectedBrowser = "default";
    localStorage.setItem("remote-media-browser", selectedBrowser);
  }
  $("#browser-select").value = selectedBrowser;
  $('#browser-select option[value="default"]').textContent = BROWSER_NAMES[s.defaultBrowser] ? `Default browser (${BROWSER_NAMES[s.defaultBrowser]})` : "Default browser";
  document.querySelectorAll(".browser-controls [data-action],.browser-keys [data-action],.keyboard-target [data-action]").forEach((b) => (b.disabled = !s.browserReady));
}
function paintWindowControls(s) {
  document.querySelectorAll("#default-file-actions [data-action]").forEach((b) => (b.disabled = !s.defaultAppReady));
}
function showKeyboardHint(text, kind = "") {
  const hint = $("#keyboard-hint");
  hint.textContent = text || "";
  hint.dataset.kind = kind;
  hint.classList.toggle("hidden", !text);
}
function paintKeyboardTarget(s) {
  const proc = s.foregroundProcess || "";
  const blocked = !!s.foregroundElevated && !s.selfElevated;
  $("#keyboard-target-title").textContent = blocked ? `${proc}: runs as administrator`
    : s.foregroundTitle ? `${proc || "app"}: ${s.foregroundTitle}` : "No window in front";
  $("#keyboard-target").classList.toggle("warn", blocked || !s.foregroundTitle || SHELL_PROCESSES.test(proc));
  const hint = $("#keyboard-hint");
  if (blocked) showKeyboardHint("Windows blocks typing into apps that run as administrator. Close that app and reopen it normally, or start RemoteDeck as administrator.", "elevation");
  else if (hint.dataset.kind === "elevation") showKeyboardHint("");
}
