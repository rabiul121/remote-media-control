// Page chrome: navigation, theme, sign out, quick page jumps, app lifecycle.
// (Plain script: files share one global scope and load in the order listed in index.html.)

function addMouseKeyboardShortcuts() {
  document
    .querySelectorAll('[data-page-panel]:not([data-page-panel="home"]):not([data-page-panel="mouse"]):not([data-page-panel="keyboard"])')
    .forEach((panel) => {
      const heading = panel.querySelector(".section-head");
      if (!heading) return;
      const shortcuts = document.createElement("div");
      shortcuts.className = "page-jumps";
      for (const [page, icon, label] of [
        ["mouse", "⌖", "Mouse controls"],
        ["keyboard", "⌨", "Keyboard controls"],
      ]) {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "icon-button page-jump";
        button.dataset.goPage = page;
        button.title = label;
        button.setAttribute("aria-label", label);
        button.textContent = icon;
        shortcuts.append(button);
      }
      heading.append(shortcuts);
    });
}
addMouseKeyboardShortcuts();

function disconnect(callApi = true) {
  if (callApi && token)
    request("/api/unpair", { method: "POST" }).catch(() => {});
  token = "";
  localStorage.removeItem(tokenKey);
  clearInterval(timer);
  if (dragging) endDrag();
  clearModifiers(true);
  resetTyping();
  pcSettingsLoaded = false;
  appsList = [];
  appsLoaded = false;
  renderApps();
  connected(false);
}

$("#pair-form").addEventListener("submit", pair);
$("#unpair").addEventListener("click", () => disconnect());
$("#refresh").addEventListener("click", () => refresh(true));
document
  .querySelectorAll("[data-go-page]")
  .forEach((b) =>
    b.addEventListener("click", () => showPage(b.dataset.goPage)),
  );
$("#home-link").addEventListener("click", (e) => {
  e.preventDefault();
  showPage("home");
});
$("#player-fold-toggle").addEventListener("click", () => {
  const expanded =
    $("#player-fold-toggle").getAttribute("aria-expanded") !== "true";
  $("#player-fold-toggle").setAttribute("aria-expanded", String(expanded));
  $("#player-picker").classList.toggle("hidden", !expanded);
  $("#player-fold-icon").textContent = expanded ? "⌃" : "⌄";
});
showPage(prefs.restorePage ? localStorage.getItem("remote-media-page") || "home" : "home");

$("#theme-toggle").addEventListener("click", () =>
  setTheme(colorTheme === "dark" ? "light" : "dark"),
);
document
  .querySelectorAll("[data-mouse-action]")
  .forEach((b) =>
    b.addEventListener("click", () => mouseCommand(b.dataset.mouseAction)),
  );

document.addEventListener("visibilitychange", () => {
  updateWakeLock();
  if (!token) return;
  if (document.hidden) {
    if (dragging) endDrag();
    else if (state?.mouseDragging) mouseCommand("mouseLeftUp");
  } else refresh();
});
