// Shared basics: element helper, phone settings, wake lock, global state, pages, themes, API requests, pairing.
// (Plain script: files share one global scope and load in the order listed in index.html.)

const $ = (s) => document.querySelector(s);
const tokenKey = "remote-media-token";
const pairingToken = new URLSearchParams(location.search).get("pair_token");
if (pairingToken) {
  localStorage.setItem(tokenKey, pairingToken);
  history.replaceState(null, "", location.pathname);
}
// Settings that belong to this phone (the PC-side ones live on the server).
const prefsKey = "remote-media-prefs";
const prefDefaults = { mouseSpeed: 1, scrollSpeed: 1, naturalScroll: true, haptics: false, wake: false, restorePage: true };
const prefs = (() => {
  try { return { ...prefDefaults, ...JSON.parse(localStorage.getItem(prefsKey) || "{}") }; } catch { return { ...prefDefaults }; }
})();
const savePrefs = () => { try { localStorage.setItem(prefsKey, JSON.stringify(prefs)); } catch {} };
const buzz = (ms = 12) => { if (prefs.haptics) navigator.vibrate?.(ms); };
let wakeLock = null;
async function updateWakeLock() {
  const wanted = prefs.wake && currentPage === "mouse" && !document.hidden;
  try {
    if (wanted && !wakeLock && navigator.wakeLock) {
      wakeLock = await navigator.wakeLock.request("screen");
      wakeLock.addEventListener("release", () => { wakeLock = null; });
    } else if (!wanted && wakeLock) {
      await wakeLock.release();
      wakeLock = null;
    }
  } catch { wakeLock = null; }
}
let token = localStorage.getItem(tokenKey) || "";

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
  pcSettingsLoaded = false,
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
      "tools",
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
  if (page !== "keyboard") clearModifiers(true);
  if (page === "keyboard") {
    requestAnimationFrame(() => applyKeyboardZoom(kbdZoom, false));
    if (token) refresh();
  }
  if (page === "window" && token) refresh();
  if (page === "apps" && token && !appsLoaded) loadApps();
  if (page === "tools" && token && !pcSettingsLoaded) loadPcSettings();
  updateWakeLock();
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
