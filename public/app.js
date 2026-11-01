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
  currentPage = "home",
  appsList = [],
  appsLoaded = false,
  appsLoading = false,
  appsQuery = "",
  appsStatusTimer = null,
  polling = false,
  dragging = false,
  dragLock = false,
  dragHoldTimer = null,
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
  "mpc-hc": "K-Lite Codec",
  "mpc-hc64": "K-Lite Codec",
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
    ![
      "home",
      "playback",
      "files",
      "apps",
      "browser",
      "window",
      "mouse",
      "keyboard",
    ].includes(page)
  )
    page = "home";
  currentPage = page;
  document
    .querySelectorAll("[data-page-panel]")
    .forEach((el) =>
      el.classList.toggle("active", el.dataset.pagePanel === page),
    );
  document.querySelectorAll("[data-go-page]").forEach((el) => {
    const active = el.dataset.goPage === page;
    el.classList.toggle("active", active);
    el.setAttribute("aria-current", active ? "page" : "false");
  });
  document
    .querySelector(".welcome")
    .classList.toggle("hidden", page !== "home");
  localStorage.setItem("remote-media-page", page);
  if (page !== "mouse" && dragging) endDrag();
  if (page === "window" && token) refresh();
  if (page === "apps" && token && !appsLoaded) loadApps();
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
  if (r.status === 401 && token && url !== "/api/pair") disconnect(false);
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
    startSession();
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
  const lockStates = [
    ["numLock", "lock-num", "NUMLOCK", "Num Lock"],
    ["capsLock", "lock-caps", "CAPSLOCK", "Caps Lock"],
    ["scrollLock", "lock-scroll", "SCROLLLOCK", "Scroll Lock"],
  ];
  for (const [property, id, key, label] of lockStates) {
    const active = !!s[property];
    const indicator = $("#" + id);
    indicator.classList.toggle("active", active);
    indicator.setAttribute("aria-label", label + (active ? " on" : " off"));
    document.querySelectorAll('[data-key="' + key + '"]')
      .forEach((button) => button.classList.toggle("lock-on", active));
  }
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
  setRange($("#system-volume"), s.systemVolume ?? 0);
  $("#system-value").value = s.systemVolume ?? 0;
  $("#system-mute").classList.toggle("active", !!s.systemMuted);
  document
    .querySelectorAll("#default-file-actions [data-action]")
    .forEach((b) => (b.disabled = !s.defaultAppReady));
  document
    .querySelectorAll(
      ".browser-controls [data-action],.browser-keys [data-action]",
    )
    .forEach((b) => (b.disabled = !s.browserReady));
  const found = (s.players || []).filter((p) => p.name === selected);
  const range = $("#player-volume");
  range.disabled = !found.length;
  $("#player-volume-title").textContent = selected
    ? `${formatPlayer(selected)} volume`
    : "Player volume";
  const isRunning = (s.running || []).includes(selected);
  const playerLabel = selected ? formatPlayer(selected) : "player";
  $("#player-selection-label").textContent = selected
    ? `Player: ${formatPlayer(selected)}`
    : "Choose player";
  $("#player-open").title = `Open ${playerLabel}`;
  $("#player-open").setAttribute("aria-label", `Open ${playerLabel}`);
  $("#player-close").title = `Close ${playerLabel}`;
  $("#player-close").setAttribute("aria-label", `Close ${playerLabel}`);
  $("#player-open").disabled = !selected;
  $("#player-close").disabled = !selected;
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
    }
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
  ["BACKQUOTE", ..."1234567890", "MINUS", "EQUALS", "BACKSPACE"],
  ["TAB", ..."QWERTYUIOP", "LBRACKET", "RBRACKET", "BACKSLASH"],
  ["CAPSLOCK", ..."ASDFGHJKL", "SEMICOLON", "QUOTE", "ENTER"],
  ["SHIFT", ..."ZXCVBNM", "COMMA", "PERIOD", "SLASH", "SHIFT"],
  ["CTRL", "WIN", "ALT", "SPACE", "ALTGR", "FN", "MENU", "CTRL"],
];
const functionKeys = [
  "ESCAPE",
  ...Array.from({ length: 12 }, (_, i) => "F" + (i + 1)),
  "PRINTSCREEN",
  "SCROLLLOCK",
  "PAUSE",
];
const navigationKeys = ["INSERT", "HOME", "PAGEUP", "DELETE", "END", "PAGEDOWN"];
const keyLabels = {
  ESCAPE: "Esc",
  BACKQUOTE: "\u0060",
  MINUS: "-",
  EQUALS: "=",
  BACKSPACE: "Backspace",
  INSERT: "Ins",
  DELETE: "Del",
  PAGEUP: "PgUp",
  PAGEDOWN: "PgDn",
  LBRACKET: "[",
  RBRACKET: "]",
  BACKSLASH: "\\",
  CAPSLOCK: "Caps Lock",
  SEMICOLON: ";",
  QUOTE: "'",
  ENTER: "Enter",
  SHIFT: "Shift",
  CTRL: "Ctrl",
  WIN: "Win",
  ALT: "Alt",
  ALTGR: "Alt",
  FN: "Fn",
  MENU: "Menu",
  COMMA: ",",
  PERIOD: ".",
  SLASH: "/",
  NUMLOCK: "Num\nLock",
  NUMDIVIDE: "/",
  NUMMULTIPLY: "*",
  NUMSUBTRACT: "-",
  NUMADD: "+",
  NUMDECIMAL: ".",
  NUMENTER: "Enter",
  NUM0: "0",
  NUM1: "1",
  NUM2: "2",
  NUM3: "3",
  NUM4: "4",
  NUM5: "5",
  NUM6: "6",
  NUM7: "7",
  NUM8: "8",
  NUM9: "9",
  PRINTSCREEN: "Print\nScreen",
  SCROLLLOCK: "Scroll\nLock",
  PAUSE: "Pause\nBreak",
};
const shiftedLabels = {
  BACKQUOTE: "~",
  1: "!",
  2: "@",
  3: "#",
  4: "$",
  5: "%",
  6: "^",
  7: "&",
  8: "*",
  9: "(",
  0: ")",
  MINUS: "_",
  EQUALS: "+",
  LBRACKET: "{",
  RBRACKET: "}",
  BACKSLASH: "|",
  SEMICOLON: ":",
  QUOTE: '"',
  COMMA: "<",
  PERIOD: ">",
  SLASH: "?",
};
function appendKeyIcon(button, key, symbol, label) {
  button.classList.add("key-labeled");
  const icon = document.createElement("span");
  icon.className = "key-icon";
  icon.setAttribute("aria-hidden", "true");
  if (key === "CAPSLOCK" || key === "WIN") {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("class", key === "WIN" ? "key-svg windows-glyph" : "key-svg");
    if (key === "CAPSLOCK") {
      const body = document.createElementNS("http://www.w3.org/2000/svg", "rect");
      body.setAttribute("x", "5");
      body.setAttribute("y", "10");
      body.setAttribute("width", "14");
      body.setAttribute("height", "10");
      body.setAttribute("rx", "2");
      const shackle = document.createElementNS("http://www.w3.org/2000/svg", "path");
      shackle.setAttribute("d", "M8 10V7a4 4 0 0 1 8 0v3");
      svg.append(shackle, body);
    } else {
      for (const [x, y] of [[3, 3], [13, 3], [3, 13], [13, 13]]) {
        const pane = document.createElementNS("http://www.w3.org/2000/svg", "path");
        pane.setAttribute("d", "M" + x + " " + y + "h8v8h-8z");
        svg.append(pane);
      }
    }
    icon.append(svg);
  } else {
    icon.textContent = symbol;
  }
  button.append(icon, Object.assign(document.createElement("span"), {
    className: "key-name",
    textContent: label,
  }));
}
function buildKeyboard() {
  const layout = $("#keyboard-layout");
  const functionLayout = $("#keyboard-function-keys");
  const navigation = $("#keyboard-extra-keys");
  const numpad = $("#numpad-layout");
  const createKey = (key) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "action-button keyboard-key";
    button.dataset.key = key;
    button.dataset.baseLabel = keyLabels[key] || key;
    button.dataset.shiftLabel = shiftedLabels[key] || button.dataset.baseLabel;
    button.setAttribute("aria-label", keyLabels[key] || key);
    if (["BACKSPACE", "TAB", "CAPSLOCK", "ENTER", "SHIFT", "CTRL", "ALT", "ALTGR", "MENU"].includes(key))
      button.classList.add("key-wide");
    if (key === "CAPSLOCK") button.classList.add("key-caps");
    if (key === "BACKSPACE") appendKeyIcon(button, key, "←", "Backspace");
    else if (key === "TAB") appendKeyIcon(button, key, "⇥", "Tab");
    else if (key === "CAPSLOCK") appendKeyIcon(button, key, "", "Caps Lock");
    else if (key === "ENTER") {
      button.classList.add("key-enter");
      appendKeyIcon(button, key, "↵", "Enter");
    } else if (key === "SHIFT") appendKeyIcon(button, key, "⇧", "Shift");
    else if (key === "WIN") appendKeyIcon(button, key, "", "Win");
    else if (key === "MENU") appendKeyIcon(button, key, "☷", "Menu");
    else if (shiftedLabels[key]) {
      button.classList.add("key-has-legends");
      const shifted = document.createElement("span");
      shifted.className = "key-shift-legend";
      shifted.textContent = shiftedLabels[key];
      const base = document.createElement("span");
      base.className = "key-base-legend";
      base.textContent = keyLabels[key] || key;
      button.append(shifted, base);
    } else {
      button.textContent = keyLabels[key] || key;
    }
    if (key === "SPACE") button.classList.add("key-space");
    if (key === "FN") {
      button.classList.add("key-fn");
      button.disabled = true;
      button.title = "Fn is a hardware function key";
    }
    return button;
  };
  functionKeys.forEach((key, index) => {
    const button = createKey(key);
    if ([1, 5, 9, 13].includes(index)) button.classList.add("keyboard-function-gap");
    if (["PRINTSCREEN", "SCROLLLOCK", "PAUSE"].includes(key))
      button.classList.add("keyboard-function-special");
    functionLayout.append(button);
  });
  navigationKeys.forEach((key) => navigation.append(createKey(key)));
  keyRows.forEach((keys, rowIndex) => {
    const row = document.createElement("div");
    row.className = "keyboard-row";
    row.dataset.row = String(rowIndex);
    keys.forEach((key) => row.append(createKey(key)));
    layout.append(row);
  });
  const numpadKeys = [
    ["NUMLOCK", "NUMDIVIDE", "NUMMULTIPLY", "NUMSUBTRACT"],
    ["NUM7", "NUM8", "NUM9", "NUMADD"],
    ["NUM4", "NUM5", "NUM6"],
    ["NUM1", "NUM2", "NUM3", "NUMENTER"],
    ["NUM0", "NUMDECIMAL"],
  ];
  numpadKeys.forEach((keys) => keys.forEach((key) => {
    const button = createKey(key);
    if (key === "NUMADD") button.classList.add("numpad-add");
    if (key === "NUMENTER") button.classList.add("numpad-enter");
    if (key === "NUM0") button.classList.add("numpad-zero");
    numpad.append(button);
  }));
  document.querySelectorAll(".keyboard-key").forEach((button) =>
    button.addEventListener("click", () => {
      const key = button.dataset.key;
      if (["CTRL", "SHIFT", "ALT"].includes(key)) {
        const name = key.toLowerCase();
        if (activeModifiers.has(name)) activeModifiers.delete(name);
        else activeModifiers.add(name);
        document.querySelectorAll("[data-modifier=\"" + name + "\"]")
          .forEach((el) => el.classList.toggle("active", activeModifiers.has(name)));
        document.querySelectorAll("[data-key=\"" + key + "\"]")
          .forEach((el) => el.classList.toggle("active", activeModifiers.has(name)));
        refreshShiftLabels();
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
      if (["CAPSLOCK", "NUMLOCK", "SCROLLLOCK"].includes(key))
        setTimeout(refresh, 150);
    }),
  );
  document.querySelectorAll("[data-modifier]").forEach((button) =>
    button.addEventListener("click", () => {
      const name = button.dataset.modifier;
      if (activeModifiers.has(name)) activeModifiers.delete(name);
      else activeModifiers.add(name);
      button.classList.toggle("active", activeModifiers.has(name));
      document.querySelectorAll("[data-key=\"" + name.toUpperCase() + "\"]")
        .forEach((el) => el.classList.toggle("active", activeModifiers.has(name)));
      refreshShiftLabels();
    }),
  );
  refreshShiftLabels();
}
function refreshShiftLabels() {
  const shifted = activeModifiers.has("shift");
  document.querySelectorAll(".keyboard-key.key-has-legends").forEach((button) => {
    button.classList.toggle("shift-active", shifted);
  });
}
buildKeyboard();
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
async function mouseCommand(action, extra = {}) {
  try {
    await request("/api/control", {
      method: "POST",
      body: JSON.stringify({ action, ...extra }),
    });
  } catch (e) {
    notify(e.message);
  }
}
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
    renderBreadcrumbs(currentFolder);
    $("#file-up").disabled = !currentFolder;
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
function renderBreadcrumbs(path) {
  const host = $("#file-breadcrumbs");
  host.replaceChildren();
  if (!path) {
    host.textContent = "Drives";
    return;
  }
  const parts = path.split(/[\\/]+/).filter(Boolean);
  let partial = parts[0] + "\\";
  const addCrumb = (label, target, isLast) => {
    if (isLast) {
      const current = document.createElement("span");
      current.className = "breadcrumb-current";
      current.textContent = label;
      host.append(current);
      return;
    }
    const button = document.createElement("button");
    button.type = "button";
    button.className = "breadcrumb-link";
    button.textContent = label;
    button.addEventListener("click", () => loadFiles(target));
    host.append(
      button,
      Object.assign(document.createElement("span"), {
        className: "breadcrumb-separator",
        textContent: "›",
      }),
    );
  };
  addCrumb(parts[0], partial, parts.length === 1);
  for (let i = 1; i < parts.length; i++) {
    partial += parts[i] + (i < parts.length - 1 ? "\\" : "");
    addCrumb(parts[i], partial, i === parts.length - 1);
  }
}
function setFilesFolded(folded) {
  $(".file-card").classList.toggle("explorer-controls-only", folded);
  const toggle = $("#file-browser-toggle");
  toggle.textContent = folded ? "▤" : "⌃";
  toggle.title = folded ? "Show file browser" : "Hide file browser";
  toggle.setAttribute("aria-label", toggle.title);
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
// ---------- Apps page ----------
const appsText = (value) =>
  String(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
const compareApps = (a, b) =>
  a.name.localeCompare(b.name, undefined, { sensitivity: "base", numeric: true });
function matchingApps() {
  const tokens = appsText(appsQuery).split(/\s+/).filter(Boolean);
  if (!tokens.length) return appsList;
  const scored = [];
  for (const app of appsList) {
    if (!tokens.every((token) => app.key.includes(token))) continue;
    // Best matches first: name starts with the search, then a word does, then anywhere.
    let score = 2;
    if (app.key.startsWith(tokens[0])) score = 0;
    else if (app.key.split(/[\s\-_.()+,:;/\\[\]]+/).some((w) => w.startsWith(tokens[0]))) score = 1;
    scored.push([score, app]);
  }
  scored.sort((a, b) => a[0] - b[0] || compareApps(a[1], b[1]));
  return scored.map((entry) => entry[1]);
}
function setAppsStatus(message, isError = false) {
  const el = $("#apps-status");
  el.textContent = message;
  el.classList.toggle("error", isError);
}
function updateAppsStatus() {
  if (!appsLoaded) return;
  const total = appsList.length,
    shown = matchingApps().length;
  setAppsStatus(
    !total
      ? "No apps were found on this PC."
      : appsQuery.trim()
        ? shown
          ? `${shown} of ${total} apps`
          : `No apps match “${appsQuery.trim()}”.`
        : `${total} apps`,
  );
}
function flashAppsStatus(message, isError = false) {
  setAppsStatus(message, isError);
  clearTimeout(appsStatusTimer);
  appsStatusTimer = setTimeout(updateAppsStatus, 3500);
}
function renderApps() {
  const host = $("#apps-list");
  const matches = matchingApps();
  const fragment = document.createDocumentFragment();
  const grouped = !appsQuery.trim();
  let group = "";
  for (const app of matches) {
    if (grouped) {
      const first = appsText(app.name).charAt(0);
      const letter = /\p{L}/u.test(first) ? first.toUpperCase() : "#";
      if (letter !== group) {
        group = letter;
        fragment.append(
          Object.assign(document.createElement("div"), {
            className: "app-letter",
            textContent: letter,
          }),
        );
      }
    }
    const row = document.createElement("button");
    row.type = "button";
    row.className = "app-row";
    row.dataset.id = app.id;
    row.dataset.name = app.name;
    row.append(
      Object.assign(document.createElement("span"), {
        className: "app-badge",
        textContent: (Array.from(app.name)[0] || "?").toUpperCase(),
      }),
      Object.assign(document.createElement("span"), {
        className: "app-name",
        textContent: app.name,
      }),
      Object.assign(document.createElement("span"), { className: "app-meta" }),
    );
    fragment.append(row);
  }
  host.replaceChildren(fragment);
  updateAppsStatus();
}
async function loadApps(force = false) {
  if (appsLoading) return;
  appsLoading = true;
  $("#apps-refresh").disabled = true;
  if (!appsLoaded || force)
    setAppsStatus("Loading apps… the first load can take a few seconds.");
  try {
    const data = await request("/api/apps" + (force ? "?refresh=1" : ""));
    appsList = (data.apps || [])
      .map((app) => ({ id: app.id, name: app.name, key: appsText(app.name) }))
      .sort(compareApps);
    appsLoaded = true;
    renderApps();
  } catch (e) {
    if (appsLoaded) flashAppsStatus(e.message, true);
    else setAppsStatus(e.message, true);
  } finally {
    appsLoading = false;
    $("#apps-refresh").disabled = false;
  }
}
async function openApp(id, name, row) {
  if (!id || row?.classList.contains("opening")) return;
  row?.classList.add("opening");
  row?.querySelector(".app-meta")?.replaceChildren("Opening…");
  flashAppsStatus(`Opening ${name}…`);
  try {
    await request("/api/control", {
      method: "POST",
      body: JSON.stringify({ action: "openApp", id }),
    });
    flashAppsStatus(`Opened ${name}.`);
    // The status check adopts the newly focused window, so the Window page
    // controls follow the app that was just opened.
    setTimeout(refresh, 1500);
    setTimeout(refresh, 4000);
  } catch (e) {
    flashAppsStatus(e.message, true);
    notify(e.message);
    if (/no longer in the list/i.test(e.message)) loadApps(true);
  } finally {
    setTimeout(() => {
      row?.classList.remove("opening");
      row?.querySelector(".app-meta")?.replaceChildren();
    }, 1200);
  }
}
function disconnect(callApi = true) {
  if (callApi && token)
    request("/api/unpair", { method: "POST" }).catch(() => {});
  token = "";
  localStorage.removeItem(tokenKey);
  clearInterval(timer);
  if (dragging) endDrag();
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
  .querySelectorAll("[data-mouse-action]")
  .forEach((b) =>
    b.addEventListener("click", () => mouseCommand(b.dataset.mouseAction)),
  );
let padActive = false,
  lastPadPoint = null,
  gesture = null,
  pendingMouse = { dx: 0, dy: 0 },
  mouseMoveTimer = null,
  padDown = null,
  longPressTimer = null,
  pendingTapTimer = null,
  pendingTap = false,
  pendingTapPoint = null,
  suppressNextTapPointerId = null;
let zoomCommandChain = Promise.resolve();
function queueMouseAction(action, extra = {}) {
  zoomCommandChain = zoomCommandChain.then(() => mouseCommand(action, extra));
}
// ---- drag: the left button stays down while the pointer moves ----
// Everything sent while a drag is active goes through one ordered queue, so
// "button down", the moves and "button up" cannot overtake each other.
function updateDragUi() {
  const button = $("#mouse-drag-toggle");
  button.classList.toggle("active", dragLock);
  button.setAttribute("aria-pressed", String(dragLock));
  button.querySelector("span").textContent = dragLock
    ? "Dragging: tap to release"
    : "Hold & drag";
  pad.classList.toggle("dragging", dragging);
}
function startDrag() {
  if (dragging) return;
  dragging = true;
  clearTimeout(mouseMoveTimer);
  mouseMoveTimer = null;
  const { dx, dy } = pendingMouse;
  pendingMouse = { dx: 0, dy: 0 };
  if (dx || dy) queueMouseAction("mouseMove", { dx, dy });
  queueMouseAction("mouseLeftDown");
  navigator.vibrate?.(15);
  updateDragUi();
}
function endDrag() {
  if (!dragging) return;
  clearTimeout(mouseMoveTimer);
  mouseMoveTimer = null;
  const { dx, dy } = pendingMouse;
  pendingMouse = { dx: 0, dy: 0 };
  if (dx || dy) queueMouseAction("mouseMove", { dx, dy });
  queueMouseAction("mouseLeftUp");
  dragging = false;
  dragLock = false;
  updateDragUi();
}
function beginPadDrag(pointerId) {
  if (dragging || padDown?.pointerId !== pointerId || padPointers.size !== 1) return;
  clearTimeout(dragHoldTimer);
  dragHoldTimer = null;
  clearTimeout(pendingTapTimer);
  pendingTap = false;
  pendingTapPoint = null;
  padDown.dragging = true;
  padDown.moved = true;
  startDrag();
}
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
  if (!dx && !dy) return;
  if (dragging) queueMouseAction("mouseMove", { dx, dy });
  else mouseCommand("mouseMove", { dx, dy });
}
function clearLongPress() {
  clearTimeout(longPressTimer);
  longPressTimer = null;
}
function queuePadTap(point) {
  if (pendingTap) {
    clearTimeout(pendingTapTimer);
    pendingTap = false;
    pendingTapPoint = null;
    mouseCommand("mouseDoubleClick");
    return;
  }
  pendingTap = true;
  pendingTapPoint = point;
  pendingTapTimer = setTimeout(() => {
    pendingTap = false;
    pendingTapPoint = null;
    mouseCommand("mouseLeftClick");
  }, 260);
}
pad.addEventListener("pointerdown", (e) => {
  if (padPointers.size === 0 && pendingTap && pendingTapPoint) {
    const gap = Math.hypot(e.clientX - pendingTapPoint.x, e.clientY - pendingTapPoint.y);
    if (gap > 32) {
      clearTimeout(pendingTapTimer);
      pendingTap = false;
      pendingTapPoint = null;
      suppressNextTapPointerId = e.pointerId;
    }
  }
  padActive = true;
  padPointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  lastPadPoint = { x: e.clientX, y: e.clientY };
  pad.setPointerCapture(e.pointerId);
  if (padPointers.size === 1) {
    // A touch that lands right after a tap and then holds or slides is a drag
    // (like a laptop touchpad); lifting quickly is still a double click.
    const dragCandidate = pendingTap && !dragging;
    padDown = {
      pointerId: e.pointerId,
      x: e.clientX,
      y: e.clientY,
      moved: false,
      longPressed: false,
      dragCandidate,
      dragging: false,
    };
    if (dragCandidate) {
      dragHoldTimer = setTimeout(() => beginPadDrag(e.pointerId), 220);
    } else if (!dragging) {
      longPressTimer = setTimeout(() => {
        if (padDown?.pointerId !== e.pointerId || padDown.moved || padPointers.size !== 1) return;
        padDown.longPressed = true;
        padDown.moved = true;
        pendingTap = false;
        clearTimeout(pendingTapTimer);
        mouseCommand("mouseRightClick");
      }, 550);
    }
  } else if (padPointers.size === 2) {
    clearLongPress();
    clearTimeout(dragHoldTimer);
    dragHoldTimer = null;
    if (padDown?.dragging) endDrag();
    padDown = null;
    if (pendingTap) {
      clearTimeout(pendingTapTimer);
      pendingTap = false;
      pendingTapPoint = null;
    }
    const points = [...padPointers.values()];
    gesture = {
      startDistance: touchDistance(points),
      startCenter: touchCenter(points),
      lastCenter: touchCenter(points),
      lastZoomDistance: touchDistance(points),
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
    const distance = touchDistance(points);
    const distanceChange = distance - gesture.startDistance;
    const centerTravel = Math.hypot(
      center.x - gesture.startCenter.x,
      center.y - gesture.startCenter.y,
    );
    if (
      gesture.mode === "pending" &&
      Math.abs(distanceChange) > 18 &&
      Math.abs(distanceChange) > centerTravel * 0.6
    ) {
      gesture.mode = "pinch";
      gesture.lastZoomDistance = distance;
      queueMouseAction(distanceChange > 0 ? "mouseGestureZoomIn" : "mouseGestureZoomOut");
    } else if (
      gesture.mode === "pending" &&
      Math.abs(center.y - gesture.startCenter.y) > 12 &&
      Math.abs(center.y - gesture.startCenter.y) >
        Math.abs(center.x - gesture.startCenter.x)
    ) {
      gesture.mode = "scroll";
    }
    if (gesture.mode === "pinch") {
      let steps = 0;
      while (distance - gesture.lastZoomDistance >= 26 && steps++ < 4) {
        queueMouseAction("mouseGestureZoomIn");
        gesture.lastZoomDistance += 26;
      }
      steps = 0;
      while (gesture.lastZoomDistance - distance >= 26 && steps++ < 4) {
        queueMouseAction("mouseGestureZoomOut");
        gesture.lastZoomDistance -= 26;
      }
    }
    if (gesture.mode === "scroll") {
      const deltaY = center.y - gesture.lastCenter.y;
      if (Math.abs(deltaY) >= 18) {
        const notches = Math.min(4, Math.floor(Math.abs(deltaY) / 18));
        const action = deltaY < 0 ? "mouseScrollDown" : "mouseScrollUp";
        for (let i = 0; i < notches; i++) queueMouseAction(action);
        gesture.lastCenter.y += Math.sign(deltaY) * notches * 18;
      }
    }
    e.preventDefault();
    return;
  }
  if (!lastPadPoint) return;
  const dx = e.clientX - lastPadPoint.x;
  const dy = e.clientY - lastPadPoint.y;
  if (padDown?.pointerId === e.pointerId) {
    const travelled = Math.hypot(e.clientX - padDown.x, e.clientY - padDown.y);
    if (padDown.dragCandidate && !padDown.dragging && travelled > 3)
      beginPadDrag(e.pointerId);
    if (travelled > 12) {
      padDown.moved = true;
      clearLongPress();
    }
  }
  pendingMouse.dx += Math.round(dx * 2.2);
  pendingMouse.dy += Math.round(dy * 2.2);
  lastPadPoint = { x: e.clientX, y: e.clientY };
  if (!mouseMoveTimer) mouseMoveTimer = setTimeout(flushMouseMove, 75);
  e.preventDefault();
});
function endPad(e, cancelled = false) {
  if (padDown?.pointerId === e.pointerId) {
    clearLongPress();
    clearTimeout(dragHoldTimer);
    dragHoldTimer = null;
    if (padDown.dragging) endDrag();
    else if (!cancelled && !dragging && !padDown.moved && !padDown.longPressed && suppressNextTapPointerId !== e.pointerId)
      queuePadTap({ x: e.clientX, y: e.clientY });
    padDown = null;
  }
  if (suppressNextTapPointerId === e.pointerId) suppressNextTapPointerId = null;
  padPointers.delete(e.pointerId);
  if (pad.hasPointerCapture(e.pointerId)) pad.releasePointerCapture(e.pointerId);
  if (padPointers.size === 1) {
    lastPadPoint = [...padPointers.values()][0];
    gesture = null;
  } else if (!padPointers.size) {
    padActive = false;
    lastPadPoint = null;
    gesture = null;
  }
}
$("#mouse-drag-toggle").addEventListener("click", () => {
  if (dragging) endDrag();
  else {
    dragLock = true;
    startDrag();
  }
});
pad.addEventListener("pointerup", (e) => endPad(e));
pad.addEventListener("pointercancel", (e) => endPad(e, true));
document.addEventListener("visibilitychange", () => {
  if (!token) return;
  if (document.hidden) {
    if (dragging) endDrag();
    else if (state?.mouseDragging) mouseCommand("mouseLeftUp");
  } else refresh();
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
$("#file-browser-toggle").addEventListener("click", () =>
  setFilesFolded(!$(".file-card").classList.contains("explorer-controls-only")),
);
$("#file-home").addEventListener("click", () => loadFiles(""));
$("#apps-refresh").addEventListener("click", () => loadApps(true));
$("#apps-search").addEventListener("input", (e) => {
  clearTimeout(debounce.apps);
  debounce.apps = setTimeout(() => {
    appsQuery = e.target.value;
    renderApps();
    $("#apps-list").scrollTop = 0;
  }, 80);
});
$("#apps-search").addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    // Enter opens the best match, so "type a few letters, press Go" works.
    e.preventDefault();
    clearTimeout(debounce.apps);
    appsQuery = e.target.value;
    renderApps();
    const first = $("#apps-list .app-row");
    if (first) {
      openApp(first.dataset.id, first.dataset.name, first);
      e.target.blur();
    }
  } else if (e.key === "Escape") {
    e.target.value = "";
    appsQuery = "";
    renderApps();
  }
});
$("#apps-list").addEventListener("click", (e) => {
  const row = e.target.closest(".app-row");
  if (row) openApp(row.dataset.id, row.dataset.name, row);
});
$("#file-open-explorer").addEventListener(
  "click",
  () => currentFolder && playerCommand("openFolder", currentFolder),
);
if (token) startSession();
else connected(false);
