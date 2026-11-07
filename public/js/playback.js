// Playback page: player picker, volume (mixer / web / keys), generic action buttons.
// (Plain script: files share one global scope and load in the order listed in index.html.)

async function playerCommand(action, path = "") {
  try {
    if (action === "closePlayer") {
      const latest = await request("/api/state");
      paint(latest);
      if (!(latest.running || []).includes(selected)) {
        notify(formatPlayer(selected) + " is not running.");
        return;
      }
    }
    await request("/api/control", {
      method: "POST",
      body: JSON.stringify({ action, player: selected, path }),
    });
    if (action === "openDefaultFile") showPage("window");
    if (action === "openFolder" && window.matchMedia("(max-width: 620px)").matches) setFilesFolded(true);
    if (
      action === "openPlayer" ||
      action === "closePlayer" ||
      action === "openFolder" ||
      action === "openDefaultFile"
    )
      setTimeout(refresh, 500);
  } catch (e) {
    notify(e.message);
  }
}

$("#players").addEventListener("click", (e) => {
  const b = e.target.closest("[data-player]");
  if (!b) return;
  selected = b.dataset.player;
  paint(state || { running: [], players: [] });
  refresh();
});
document.querySelectorAll("[data-action]").forEach((b) =>
  b.addEventListener("click", () => {
    const action = b.dataset.action;
    if (action.startsWith("browser")) {
      browserCommand(action);
      return;
    }
    if (
      (action.startsWith("seek") || action === "toggleFullscreen") &&
      !selected
    ) {
      notify("Choose a player first.");
      return;
    }
    command(action);
  }),
);
$("#system-volume").addEventListener("input", (e) => {
  setRange(e.target, e.target.value);
  $("#system-value").value = e.target.value;
  clearTimeout(debounce.sys);
  debounce.sys = setTimeout(() => command("systemVolume", e.target.value), 90);
});
$("#player-volume").addEventListener("input", (e) => {
  setRange(e.target, e.target.value);
  $("#player-value").value = e.target.value;
  clearTimeout(debounce.player);
  debounce.player = setTimeout(
    () => command("playerVolume", e.target.value),
    100,
  );
});
$("#system-mute").addEventListener("click", () => command("systemMute"));
$("#player-mute").addEventListener("click", () => {
  if (!selected) {
    notify("Choose a player first.");
    return;
  }
  command("playerMute");
});
document.querySelectorAll("[data-volume]").forEach((b) =>
  b.addEventListener("click", () => {
    const kind = b.dataset.volume,
      delta = Number(b.dataset.step),
      input = $("#" + (kind === "system" ? "system-volume" : "player-volume"));
    if (
      kind === "player" &&
      !state?.players?.some((p) => p.name === selected)
    ) {
      notify(
        "Start playback in " + formatPlayer(selected || "a player") + " first.",
      );
      return;
    }
    const next = Math.max(0, Math.min(100, Number(input.value) + delta));
    setRange(input, next);
    $("#" + (kind === "system" ? "system-value" : "player-value")).value = next;
    command(kind === "system" ? "systemVolume" : "playerVolume", next);
  }),
);
$("#player-open").addEventListener("click", () => playerCommand("openPlayer"));
$("#player-close").addEventListener("click", () =>
  playerCommand("closePlayer"),
);

document.querySelectorAll("[data-player-step]").forEach((b) =>
  b.addEventListener("click", () => { buzz(); command("playerVolumeStep", { direction: b.dataset.playerStep }); }),
);
