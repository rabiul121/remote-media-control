const $ = (s) => document.querySelector(s);
const tokenKey = "remote-media-token";
const pairingToken = new URLSearchParams(location.search).get("pair_token");
if (pairingToken) {
  localStorage.setItem(tokenKey, pairingToken);
  history.replaceState(null, "", location.pathname);
}
let token = localStorage.getItem(tokenKey) || "";
const activeModifiers = new Set();
let selected = localStorage.getItem("remote-media-player") || "";
let state = null,
  timer = null,
  toastTimer = null,
  debounce = {},
  currentFolder = "",
  currentPage = localStorage.getItem("remote-media-page") || "playback",
  selectedBrowser = localStorage.getItem("remote-media-browser") || "default",
  searchProvider =
    localStorage.getItem("remote-media-search-provider") || "google",
  colorTheme = localStorage.getItem("remote-media-theme") || "dark";
if (
  !["default", "edge", "chrome", "firefox", "brave"].includes(selectedBrowser)
)
  selectedBrowser = "default";
if (!["google", "bing", "duckduckgo", "yahoo"].includes(searchProvider))
  searchProvider = "google";
document.documentElement.dataset.theme = colorTheme;
const players = {
  vlc: "VLC",
  musicbee: "MusicBee",
  potplayer: "PotPlayer",
  "mpc-hc": "MPC-HC",
  "mpc-hc64": "MPC-HC",
  wmplayer: "Windows Media Player",
};
const headers = () => ({
  "Content-Type": "application/json",
  ...(token ? { Authorization: `Bearer ${token}` } : {}),
});
function connected(value) {
  $("#pair-view").classList.toggle("hidden", value);
  $("#remote-view").classList.toggle("hidden", !value);
  $(".connection").classList.toggle("online", value);
  $("#connection-label").textContent = value
    ? "Paired to this PC"
    : "Not paired";
  $("#unpair").classList.toggle("hidden", !value);
}
function notify(msg) {
  const el = $("#toast");
  el.textContent = msg;
  el.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("show"), 2400);
}
function showPage(page) {
  if (
    !["playback", "files", "browser", "window", "mouse", "keyboard"].includes(
      page,
    )
  )
    page = "playback";
  currentPage = page;
  document
    .querySelectorAll("[data-page-panel]")
    .forEach((el) =>
      el.classList.toggle("active", el.dataset.pagePanel === page),
    );
  document.querySelectorAll(".page-tab").forEach((el) => {
    const active = el.dataset.page === page;
    el.classList.toggle("active", active);
    el.setAttribute("aria-current", active ? "page" : "false");
  });
  localStorage.setItem("remote-media-page", page);
}
function setTheme(theme) {
  colorTheme = theme === "light" ? "light" : "dark";
  document.documentElement.dataset.theme = colorTheme;
  localStorage.setItem("remote-media-theme", colorTheme);
  $("#theme-toggle").textContent = colorTheme === "dark" ? "☼" : "☾";
  $("#theme-toggle").title =
    "Switch to " + (colorTheme === "dark" ? "light" : "dark") + " theme";
  $("#theme-toggle").setAttribute("aria-label", $("#theme-toggle").title);
}
async function request(url, options = {}) {
  const r = await fetch(url, {
    ...options,
    headers: { ...headers(), ...options.headers },
  });
  let data = {};
  try {
    data = await r.json();
  } catch {}
  if (!r.ok) throw new Error(data.error || "Could not reach the Windows host.");
  return data;
}
async function pair(e) {
  e.preventDefault();
  $("#pair-error").textContent = "";
  const pin = $("#pin").value.replace(/\s/g, "");
  try {
    const d = await request("/api/pair", {
      method: "POST",
      body: JSON.stringify({ pin }),
    });
    token = d.token;
    localStorage.setItem(tokenKey, token);
    connected(true);
    await refresh();
  } catch (err) {
    $("#pair-error").textContent = err.message;
  }
}
function formatPlayer(name) {
  return players[name] || name;
}
function setRange(input, value) {
  input.value = value;
  input.style.setProperty("--fill", `${value}%`);
}
function paint(s) {
  state = s;
  for (const b of document.querySelectorAll(".player-option")) {
    const name = b.dataset.player;
    const active = (s.running || []).includes(name);
    const found = (s.players || []).filter((p) => p.name === name);
    b.querySelector(".player-state").textContent = active
      ? "RUNNING"
      : "OFFLINE";
    b.querySelector(".player-state").classList.toggle("running", active);
    b.classList.toggle("selected", selected === name);
  }
  const availableBrowsers = s.browsers || ["default"];
  document.querySelectorAll("#browser-select option").forEach((o) => {
    o.disabled = o.value !== "default" && !availableBrowsers.includes(o.value);
  });
  if (!availableBrowsers.includes(selectedBrowser)) {
    selectedBrowser = "default";
    localStorage.setItem("remote-media-browser", selectedBrowser);
  }
  $("#browser-select").value = selectedBrowser;
  if (
    selected &&
    !["vlc", "musicbee", "potplayer", "mpc-hc64", "wmplayer"].includes(selected)
  )
    selected = "";
  if (!selected) {
    const first = ["vlc", "musicbee", "potplayer", "mpc-hc64"].find((n) =>
      (s.running || []).includes(n),
    );
    if (first) selected = first;
  }
  for (const b of document.querySelectorAll(".player-option"))
    b.classList.toggle("selected", b.dataset.player === selected);
  $("#selected-hint").textContent =
    (selected
      ? "Selected: " +
        formatPlayer(selected) +
        ". Open, close, seek, and full screen controls target this player."
      : "Select a player first.") + " For K-Lite, choose MPC-HC.";
  setRange($("#system-volume"), s.systemVolume ?? 0);
  $("#system-value").value = s.systemVolume ?? 0;
  $("#system-mute").classList.toggle("active", !!s.systemMuted);
  document
    .querySelectorAll("#explorer-remote [data-action]")
    .forEach((b) => (b.disabled = !s.explorerReady));
  document
    .querySelectorAll("#default-file-actions [data-action]")
    .forEach((b) => (b.disabled = !s.defaultAppReady));
  $("#window-control-hint").textContent = s.defaultAppReady
    ? "Controls target the last file opened from this remote."
    : "Open an image, document, or PDF from Files to control its default app here.";
  document
    .querySelectorAll(
      ".browser-controls [data-action],.browser-keys [data-action]",
    )
    .forEach((b) => (b.disabled = !s.browserReady));
  $("#browser-hint").textContent = s.browserReady
    ? "Browser controls target the browser window opened from this tab."
    : "Choose a browser and open it or tap a site shortcut.";
  $("#mouse-hint").textContent = s.mouseDragging
    ? "Selection is active: drag on the pad, then tap Release."
    : "Start selection, then drag on the pad to select text or items. Release when finished.";
  $("#mouse-drag-toggle").classList.toggle("active", !!s.mouseDragging);
  $("#mouse-drag-toggle").querySelector("span").textContent = s.mouseDragging
    ? "Selecting…"
    : "Start selection";
  document.querySelector('[data-mouse-action="mouseLeftUp"]').disabled =
    !s.mouseDragging;
  const found = (s.players || []).filter((p) => p.name === selected);
  const range = $("#player-volume");
  range.disabled = !found.length;
  $("#player-volume-title").textContent = selected
    ? `${formatPlayer(selected)} volume`
    : "Player volume";
  $("#player-volume-hint").textContent = found.length
    ? "App mixer level. This affects only " + formatPlayer(selected) + "."
    : selected
      ? "No active audio session. Start playback in " +
        formatPlayer(selected) +
        "."
      : "Choose a running player to control its mixer level.";
  const isRunning = (s.running || []).includes(selected);
  $(".player-action-label").textContent = selected
    ? "Open " + formatPlayer(selected)
    : "Open player";
  document.querySelector("#player-close .player-action-label").textContent =
    selected ? "Close " + formatPlayer(selected) : "Close player";
  $("#player-open").disabled = !selected;
  $("#player-close").disabled = !selected || !isRunning;
  $("#player-fullscreen").disabled =
    !selected ||
    !isRunning ||
    selected === "musicbee" ||
    selected === "wmplayer";
  $("#player-fullscreen").title = !isRunning
    ? "Open this player first"
    : selected === "musicbee" || selected === "wmplayer"
      ? "Full screen is available for video players"
      : "Toggle full screen in " + formatPlayer(selected);
  if (found.length) {
    setRange(range, found[0].volume);
    $("#player-value").value = found[0].volume;
    $("#player-mute").classList.toggle("active", !!found[0].muted);
  } else {
    $("#player-value").value = "—";
    range.value = 0;
    range.style.setProperty("--fill", "0%");
    $("#player-mute").classList.remove("active");
  }
  $("#last-updated").textContent =
    "UPDATED " +
    new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  localStorage.setItem("remote-media-player", selected || "");
}
async function refresh() {
  try {
    paint(await request("/api/state"));
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
    if (
      action === "systemVolume" ||
      action === "playerVolume" ||
      action.startsWith("explorer")
    )
      await refresh();
    if (action.startsWith("default"))
      notify(
        "Sent " +
          action.replace("default", "").toLowerCase() +
          " to the opened app.",
      );
    if (action.startsWith("explorer"))
      notify(
        "Sent " +
          action
            .replace("explorer", "")
            .replace(/([A-Z])/g, " $1")
            .toLowerCase() +
          " to Windows Explorer.",
      );
  } catch (e) {
    notify(e.message);
  }
}
function normalizedAddress(raw) {
  let address = raw.trim();
  if (!address) return "";
  if (!/^[a-z][a-z\d+.-]*:/i.test(address)) address = "https://" + address;
  const url = new URL(address);
  if (!["http:", "https:"].includes(url.protocol))
    throw new Error("Use a web address beginning with http:// or https://.");
  return url.href;
}
async function browserCommand(action = "browserOpen", address = "") {
  try {
    const url = action === "browserOpen" ? normalizedAddress(address) : "";
    await request("/api/control", {
      method: "POST",
      body: JSON.stringify({ action, browser: selectedBrowser, url }),
    });
    if (action === "browserOpen") {
      if (url) $("#browser-address").value = url;
      showPage("browser");
      notify("Opening " + (url || "the browser") + ".");
    } else
      notify(
        action === "browserClose"
          ? "Closing browser."
          : "Sent " +
              action.replace("browser", "").toLowerCase() +
              " to the browser.",
      );
    await refresh();
  } catch (e) {
    notify(e.message);
  }
}
function searchWeb() {
  const q = $("#search-query").value.trim();
  if (!q) {
    notify("Enter something to search for.");
    return;
  }
  const templates = {
    google: "https://www.google.com/search?q=",
    bing: "https://www.bing.com/search?q=",
    duckduckgo: "https://duckduckgo.com/?q=",
    yahoo: "https://search.yahoo.com/search?p=",
  };
  browserCommand(
    "browserOpen",
    templates[searchProvider] + encodeURIComponent(q),
  );
}
const keyRows = [
  ["ESCAPE", ...Array.from({ length: 12 }, (_, i) => `F${i + 1}`)],
  ["BACKQUOTE", ..."1234567890", "MINUS", "EQUALS", "BACKSPACE"],
  ["TAB", ..."QWERTYUIOP", "LBRACKET", "RBRACKET", "BACKSLASH"],
  ["CAPSLOCK", ..."ASDFGHJKL", "SEMICOLON", "QUOTE", "ENTER"],
  ["SHIFT", ..."ZXCVBNM", "COMMA", "PERIOD", "SLASH", "SHIFT"],
  ["CTRL", "WIN", "ALT", "SPACE", "ALTGR", "MENU"],
];
const keyLabels = {
  ESCAPE: "Esc",
  BACKQUOTE: "`",
  MINUS: "−",
  EQUALS: "=",
  BACKSPACE: "⌫",
  INSERT: "Ins",
  DELETE: "Del",
  PAGEUP: "PgUp",
  PAGEDOWN: "PgDn",
  LBRACKET: "[",
  RBRACKET: "]",
  BACKSLASH: "\\",
  CAPSLOCK: "Caps",
  SEMICOLON: ";",
  QUOTE: "'",
  ENTER: "Enter",
  SHIFT: "Shift",
  CTRL: "Ctrl",
  WIN: "Win",
  ALT: "Alt",
  ALTGR: "AltGr",
  MENU: "Menu",
  COMMA: ",",
  PERIOD: ".",
  SLASH: "/",
  UP: "↑",
  DOWN: "↓",
  LEFT: "←",
  RIGHT: "→",
  NUMLOCK: "Num",
  NUMDIVIDE: "÷",
  NUMMULTIPLY: "×",
  NUMSUBTRACT: "−",
  NUMADD: "+",
  NUMDECIMAL: ".",
  NUMENTER: "Enter",
  PRINTSCREEN: "PrtSc",
  SCROLLLOCK: "ScrLk",
  PAUSE: "Pause",
};
function buildKeyboard() {
  const layout = $("#keyboard-layout");
  const numpad = $("#numpad-layout");
  const createKey = (key) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "action-button keyboard-key";
    button.dataset.key = key;
    button.textContent = keyLabels[key] || key;
    button.setAttribute("aria-label", key);
    if (
      [
        "BACKSPACE",
        "TAB",
        "CAPSLOCK",
        "ENTER",
        "SHIFT",
        "CTRL",
        "ALT",
        "ALTGR",
        "MENU",
      ].includes(key)
    )
      button.classList.add("key-wide");
    if (key === "SPACE") button.classList.add("key-space");
    return button;
  };
  keyRows.forEach((keys) => {
    const row = document.createElement("div");
    row.className = "keyboard-row";
    keys.forEach((key) => row.append(createKey(key)));
    layout.append(row);
  });
  [
    "PRINTSCREEN",
    "SCROLLLOCK",
    "PAUSE",
    "INSERT",
    "DELETE",
    "HOME",
    "END",
    "PAGEUP",
    "PAGEDOWN",
  ].forEach((key) => $("#keyboard-extra-keys").append(createKey(key)));
  [
    ["NUMLOCK", "NUMDIVIDE", "NUMMULTIPLY", "NUMSUBTRACT"],
    ["NUM7", "NUM8", "NUM9", "NUMADD"],
    ["NUM4", "NUM5", "NUM6", "NUMENTER"],
    ["NUM1", "NUM2", "NUM3", "NUMENTER"],
    ["NUM0", "NUM0", "NUMDECIMAL", "NUMENTER"],
  ].forEach((keys) => {
    const row = document.createElement("div");
    row.className = "numpad-row";
    keys.forEach((key, index) => {
      const button = createKey(key);
      if (key === "NUM0" && index < 2) button.classList.add("numpad-zero");
      row.append(button);
    });
    numpad.append(row);
  });
  numpad.querySelectorAll('[data-key="NUM0"]')[1]?.remove();
  document.querySelectorAll(".keyboard-key").forEach((button) =>
    button.addEventListener("click", () => {
      const key = button.dataset.key;
      if (["CTRL", "SHIFT", "ALT"].includes(key)) {
        const name = key.toLowerCase();
        if (activeModifiers.has(name)) activeModifiers.delete(name);
        else activeModifiers.add(name);
        document
          .querySelector(`[data-modifier="${name}"]`)
          .classList.toggle("active", activeModifiers.has(name));
        document
          .querySelectorAll(`[data-key="${key}"]`)
          .forEach((el) =>
            el.classList.toggle("active", activeModifiers.has(name)),
          );
        return;
      }
      command("keyboardPress", {
        key,
        modifiers: {
          ctrl: activeModifiers.has("ctrl"),
          alt: activeModifiers.has("alt"),
          shift: activeModifiers.has("shift"),
          win: activeModifiers.has("win"),
        },
      });
    }),
  );
  document.querySelectorAll("[data-modifier]").forEach((button) =>
    button.addEventListener("click", () => {
      const name = button.dataset.modifier;
      if (activeModifiers.has(name)) activeModifiers.delete(name);
      else activeModifiers.add(name);
      button.classList.toggle("active", activeModifiers.has(name));
      document
        .querySelectorAll(`[data-key="${name.toUpperCase()}"]`)
        .forEach((el) =>
          el.classList.toggle("active", activeModifiers.has(name)),
        );
    }),
  );
  const toggleNumpad = (show) => {
    $("#numpad-panel").classList.toggle("hidden", !show);
    $("#numpad-toggle").setAttribute("aria-expanded", String(show));
    $("#numpad-toggle").title = show
      ? "Hide numeric keypad"
      : "Show numeric keypad";
    $("#numpad-toggle").innerHTML = show
      ? "× <span>Hide numpad</span>"
      : "▦ <span>Numpad</span>";
  };
  $("#numpad-toggle").addEventListener("click", () =>
    toggleNumpad($("#numpad-panel").classList.contains("hidden")),
  );
  $("#numpad-hide").addEventListener("click", () => toggleNumpad(false));
}
buildKeyboard();
async function mouseCommand(action, extra = {}) {
  try {
    await request("/api/control", {
      method: "POST",
      body: JSON.stringify({ action, ...extra }),
    });
    if (action === "mouseLeftDown" || action === "mouseLeftUp") await refresh();
    else
      notify(
        action
          .replace("mouse", "")
          .replace(/([A-Z])/g, " $1")
          .toLowerCase(),
      );
  } catch (e) {
    notify(e.message);
  }
}
async function playerCommand(action, path = "") {
  try {
    await request("/api/control", {
      method: "POST",
      body: JSON.stringify({ action, player: selected, path }),
    });
    notify(
      action === "openFile"
        ? "Opening file in " + formatPlayer(selected)
        : action === "openDefaultFile"
          ? "Opening in the Windows default app"
          : action === "openPlayer"
            ? "Opening " + formatPlayer(selected)
            : action === "closePlayer"
              ? "Closing " + formatPlayer(selected)
              : "Opened folder in Windows Explorer",
    );
    if (action === "openDefaultFile") showPage("window");
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
async function loadFiles(path = currentFolder) {
  const list = $("#file-list");
  list.replaceChildren(
    Object.assign(document.createElement("div"), {
      className: "file-empty",
      textContent: "Loading…",
    }),
  );
  try {
    const q = path ? "?path=" + encodeURIComponent(path) : "";
    const data = await request("/api/files" + q);
    currentFolder = data.path || "";
    $("#file-location").textContent = currentFolder || "This PC";
    $("#file-up").disabled = !data.parent;
    $("#file-open-explorer").disabled = !currentFolder;
    list.replaceChildren();
    const add = (item, kind) => {
      const b = document.createElement("button");
      b.className = "file-row " + kind;
      b.type = "button";
      const symbol = document.createElement("span");
      symbol.className = "file-symbol";
      symbol.textContent =
        kind === "folder"
          ? "▰"
          : kind === "drive"
            ? "▣"
            : kind === "media"
              ? "♫"
              : "▤";
      const name = document.createElement("span");
      name.className = "file-name";
      name.textContent = item.name;
      const meta = document.createElement("span");
      meta.className = "file-meta";
      meta.textContent =
        kind === "media" || kind === "file"
          ? formatBytes(item.bytes)
          : kind === "drive"
            ? item.path
            : "";
      b.append(symbol, name, meta);
      b.addEventListener("click", () =>
        kind === "media"
          ? playerCommand("openFile", item.path)
          : kind === "file"
            ? playerCommand("openDefaultFile", item.path)
            : loadFiles(item.path),
      );
      list.append(b);
    };
    const folders = (data.drives || []).concat(data.folders || []);
    folders.sort((a, b) => a.name.localeCompare(b.name));
    folders.forEach((x) => add(x, x.kind));
    (data.files || [])
      .sort((a, b) => a.name.localeCompare(b.name))
      .forEach((x) => add(x, x.kind || "media"));
    if (!list.children.length)
      list.append(
        Object.assign(document.createElement("div"), {
          className: "file-empty",
          textContent: "No files or folders here.",
        }),
      );
  } catch (e) {
    list.replaceChildren(
      Object.assign(document.createElement("div"), {
        className: "file-empty",
        textContent: e.message,
      }),
    );
  }
}
function formatBytes(bytes) {
  if (!Number.isFinite(bytes)) return "";
  if (bytes < 1024) return bytes + " B";
  const units = ["KB", "MB", "GB", "TB"];
  let i = -1;
  do {
    bytes /= 1024;
    i++;
  } while (bytes >= 1024 && i < units.length - 1);
  return bytes.toFixed(bytes >= 10 ? 0 : 1) + " " + units[i];
}
function disconnect(callApi = true) {
  if (callApi && token)
    request("/api/unpair", { method: "POST" }).catch(() => {});
  token = "";
  localStorage.removeItem(tokenKey);
  clearInterval(timer);
  connected(false);
}
$("#pair-form").addEventListener("submit", pair);
$("#unpair").addEventListener("click", () => disconnect());
$("#refresh").addEventListener("click", refresh);
document
  .querySelectorAll(".page-tab")
  .forEach((b) => b.addEventListener("click", () => showPage(b.dataset.page)));
showPage(currentPage);
$("#browser-select").value = selectedBrowser;
$("#browser-select").addEventListener("change", (e) => {
  selectedBrowser = e.target.value;
  localStorage.setItem("remote-media-browser", selectedBrowser);
});
$("#browser-open").addEventListener("click", () =>
  browserCommand("browserOpen", ""),
);
$("#browser-go").addEventListener("click", () =>
  browserCommand("browserOpen", $("#browser-address").value),
);
$("#browser-address").addEventListener("keydown", (e) => {
  if (e.key === "Enter")
    browserCommand("browserOpen", $("#browser-address").value);
});
document
  .querySelectorAll("[data-browser-url]")
  .forEach((b) =>
    b.addEventListener("click", () =>
      browserCommand("browserOpen", b.dataset.browserUrl),
    ),
  );
$("#search-provider").value = searchProvider;
$("#search-provider").addEventListener("change", (e) => {
  searchProvider = e.target.value;
  localStorage.setItem("remote-media-search-provider", searchProvider);
});
$("#browser-search").addEventListener("click", searchWeb);
$("#search-query").addEventListener("keydown", (e) => {
  if (e.key === "Enter") searchWeb();
});
setTheme(colorTheme);
$("#theme-toggle").addEventListener("click", () =>
  setTheme(colorTheme === "dark" ? "light" : "dark"),
);
document
  .querySelectorAll("[data-mouse-action]:not(#mouse-drag-toggle)")
  .forEach((b) =>
    b.addEventListener("click", () => mouseCommand(b.dataset.mouseAction)),
  );
$("#mouse-drag-toggle").addEventListener("click", () =>
  mouseCommand(state?.mouseDragging ? "mouseLeftUp" : "mouseLeftDown"),
);
let padActive = false,
  lastPadPoint = null,
  gesture = null,
  pendingMouse = { dx: 0, dy: 0 },
  mouseMoveTimer = null;
const pad = $("#mouse-pad");
const padPointers = new Map();
const touchDistance = (points) =>
  Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y);
const touchCenter = (points) => ({
  x: (points[0].x + points[1].x) / 2,
  y: (points[0].y + points[1].y) / 2,
});
function flushMouseMove() {
  mouseMoveTimer = null;
  const dx = pendingMouse.dx,
    dy = pendingMouse.dy;
  pendingMouse = { dx: 0, dy: 0 };
  if (dx || dy) mouseCommand("mouseMove", { dx, dy });
}
pad.addEventListener("pointerdown", (e) => {
  padActive = true;
  padPointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  lastPadPoint = { x: e.clientX, y: e.clientY };
  pad.setPointerCapture(e.pointerId);
  if (padPointers.size === 2) {
    const points = [...padPointers.values()];
    gesture = {
      startDistance: touchDistance(points),
      startCenter: touchCenter(points),
      lastCenter: touchCenter(points),
      mode: "pending",
    };
    lastPadPoint = null;
    pendingMouse = { dx: 0, dy: 0 };
    clearTimeout(mouseMoveTimer);
    mouseMoveTimer = null;
  }
  e.preventDefault();
});
pad.addEventListener("pointermove", (e) => {
  if (!padActive) return;
  if (padPointers.has(e.pointerId))
    padPointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (padPointers.size >= 2 && gesture) {
    const points = [...padPointers.values()].slice(0, 2);
    const center = touchCenter(points);
    const distanceChange = touchDistance(points) - gesture.startDistance;
    if (gesture.mode === "pending" && Math.abs(distanceChange) > 26) {
      gesture.mode = "pinch";
      command("keyboardPress", {
        key: distanceChange > 0 ? "EQUALS" : "MINUS",
        modifiers: { ctrl: true, shift: distanceChange > 0 },
      });
      notify(distanceChange > 0 ? "Zoom in" : "Zoom out");
    } else if (
      gesture.mode === "pending" &&
      Math.abs(center.y - gesture.startCenter.y) > 26 &&
      Math.abs(center.y - gesture.startCenter.y) >
        Math.abs(center.x - gesture.startCenter.x)
    ) {
      gesture.mode = "scroll";
    }
    if (gesture.mode === "scroll") {
      const deltaY = center.y - gesture.lastCenter.y;
      if (Math.abs(deltaY) >= 35) {
        const action = deltaY < 0 ? "mouseScrollUp" : "mouseScrollDown";
        request("/api/control", {
          method: "POST",
          body: JSON.stringify({ action }),
        }).catch((error) => notify(error.message));
        gesture.lastCenter = center;
      }
    }
    e.preventDefault();
    return;
  }
  if (!lastPadPoint) return;
  pendingMouse.dx += Math.round((e.clientX - lastPadPoint.x) * 2.2);
  pendingMouse.dy += Math.round((e.clientY - lastPadPoint.y) * 2.2);
  lastPadPoint = { x: e.clientX, y: e.clientY };
  if (!mouseMoveTimer) mouseMoveTimer = setTimeout(flushMouseMove, 75);
  e.preventDefault();
});
const endPad = (e) => {
  padPointers.delete(e.pointerId);
  if (pad.hasPointerCapture(e.pointerId))
    pad.releasePointerCapture(e.pointerId);
  if (padPointers.size === 1) {
    lastPadPoint = [...padPointers.values()][0];
    gesture = null;
  } else if (!padPointers.size) {
    padActive = false;
    lastPadPoint = null;
    gesture = null;
  }
};
pad.addEventListener("pointerup", endPad);
pad.addEventListener("pointercancel", endPad);
document.addEventListener("visibilitychange", () => {
  if (document.hidden) mouseCommand("mouseLeftUp");
});
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
$("#file-up").addEventListener("click", async () => {
  if (!currentFolder) return;
  try {
    const d = await request(
      "/api/files?path=" + encodeURIComponent(currentFolder),
    );
    await loadFiles(d.parent || "");
  } catch (e) {
    notify(e.message);
  }
});
$("#files-refresh").addEventListener("click", () => loadFiles());
$("#file-open-explorer").addEventListener(
  "click",
  () => currentFolder && playerCommand("openFolder", currentFolder),
);
if (token) {
  connected(true);
  refresh();
  loadFiles("");
  timer = setInterval(refresh, 5000);
} else connected(false);
