// POST /api/control: one endpoint for every button. The action name decides where it goes.
const { ps } = require("../system");
const input = require("../input");
const apps = require("../apps");
const rt = require("../runtime");
const { json } = require("../http-util");
const { players, browsers, mediaExtensions } = require("../config");

const GROUPS = {
  media: ["playPause", "play", "pause", "next", "previous", "seekForward", "seekBackward", "seekSmallForward", "seekSmallBackward", "seekLargeForward", "seekLargeBackward", "toggleFullscreen"],
  app: ["defaultScrollUp", "defaultScrollDown", "defaultPrevious", "defaultNext", "defaultArrowUp", "defaultArrowDown", "defaultArrowLeft", "defaultArrowRight", "defaultHome", "defaultEnd", "defaultMinimize", "defaultMaximize", "defaultFullscreen", "defaultRestore", "defaultClose"],
  explorer: ["explorerUp", "explorerDown", "explorerLeft", "explorerRight", "explorerTab", "explorerShiftTab", "explorerEnter", "explorerClose"],
  browser: ["browserOpen", "browserBack", "browserForward", "browserReload", "browserHome", "browserMinimize", "browserMaximize", "browserFullscreen", "browserRestore", "browserClose", "browserArrowUp", "browserArrowDown", "browserArrowLeft", "browserArrowRight", "browserScrollUp", "browserScrollDown", "browserTab", "browserShiftTab", "browserEnter", "browserEscape", "browserCloseTab", "browserFocus", "browserAddressBar"],
  mouse: ["mouseMove", "mouseLeftDown", "mouseLeftUp", "mouseLeftClick", "mouseRightClick", "mouseDoubleClick", "mouseMiddleClick", "mouseScrollUp", "mouseScrollDown", "mouseHome", "mouseEnd", "mouseZoomIn", "mouseZoomOut", "mouseZoomReset", "mouseGestureZoomIn", "mouseGestureZoomOut"],
  audio: ["systemVolume", "systemMute", "playerVolume", "playerVolumeStep", "playerMute", "openPlayer", "closePlayer"],
  files: ["openFile", "openDefaultFile", "openFolder"],
  other: ["keyboardPress", "typeText", "openApp", "power"],
};
const ALLOWED = new Set(Object.values(GROUPS).flat());
const KEY = /^(?:[A-Z]|[0-9]|F(?:[1-9]|1[0-9]|2[0-4])|NUM[0-9]|NUMADD|NUMSUBTRACT|NUMMULTIPLY|NUMDIVIDE|NUMDECIMAL|NUMENTER|SPACE|ENTER|TAB|ESCAPE|BACKSPACE|DELETE|INSERT|HOME|END|PAGEUP|PAGEDOWN|UP|DOWN|LEFT|RIGHT|CAPSLOCK|NUMLOCK|SCROLLLOCK|PRINTSCREEN|PAUSE|EQUALS|MINUS|COMMA|PERIOD|SLASH|BACKSLASH|SEMICOLON|QUOTE|LBRACKET|RBRACKET|BACKQUOTE|WIN|ALTGR|MENU)$/;
const POWER = ["lock", "sleep", "displayOff", "restart", "shutdown", "cancel"];

const bad = (res, message, code = 400) => json(res, code, { error: message });
const modifiersOf = (m) => ({ ctrl: m?.ctrl === true, alt: m?.alt === true, shift: m?.shift === true, win: m?.win === true });
const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));

// Which window the action targets, and what to remember afterwards.
const targetFor = (action) =>
  action.startsWith("explorer") ? rt.explorerWindow : action.startsWith("browser") && action !== "browserOpen" ? rt.browserWindow : rt.defaultWindow || 0;

function rememberWindow(action, result, res) {
  const handle = Number.parseInt(result, 10) || 0;
  const open = { openDefaultFile: ["defaultWindow", "The default app opened, but its window could not be targeted."], openFolder: ["explorerWindow", "Explorer opened, but its window could not be targeted."], browserOpen: ["browserWindow", "The browser opened, but its window could not be targeted."] }[action];
  if (open) {
    rt[open[0]] = handle;
    if (!handle) return bad(res, open[1], 500);
  }
  if (action === "defaultClose") rt.defaultWindow = 0;
  if (action === "explorerClose") rt.explorerWindow = 0;
  if (action === "browserClose") rt.browserWindow = 0;
  return null;
}

module.exports = [
  {
    method: "POST", path: "/api/control", auth: true,
    async handler({ res, body }) {
      const action = body.action;
      if (!ALLOWED.has(action)) return bad(res, "Unknown control.");

      if (action === "openApp") {
        const entry = await apps.find(String(body.id || ""));
        if (!entry) return bad(res, "That app is no longer in the list. Reload the list and try again.", 404);
        await ps("control", { action, appId: entry.appId });
        return json(res, 200, { ok: true, name: entry.name });
      }
      if (action === "keyboardPress") {
        const key = String(body.key || "");
        if (!KEY.test(key)) return bad(res, "Unsupported keyboard key.");
        await input.send(action, { key, modifiers: modifiersOf(body.modifiers) });
        return json(res, 200, { ok: true });
      }
      if (action === "typeText") {
        const text = String(body.text ?? "").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "");
        if (!text || text.length > 500) return bad(res, "Type between 1 and 500 characters.");
        await input.send(action, { text });
        return json(res, 200, { ok: true });
      }
      if (action.startsWith("mouse")) {
        await input.send(action, { dx: clamp(Number(body.dx) || 0, -1200, 1200), dy: clamp(Number(body.dy) || 0, -1200, 1200) });
        input.trackDrag(action);
        return json(res, 200, { ok: true });
      }

      const player = players.includes(String(body.player || "").toLowerCase()) ? String(body.player).toLowerCase() : "";
      if (["openPlayer", "closePlayer", "openFile", "playerVolume", "playerVolumeStep", "playerMute", "playPause", "play", "pause", "next", "previous", "seekForward", "seekBackward", "seekSmallForward", "seekSmallBackward", "seekLargeForward", "seekLargeBackward"].includes(action) && !player) return bad(res, "Choose a player first.");
      if (action === "power" && !POWER.includes(body.what)) return bad(res, "Unknown power action.");
      const browser = browsers.includes(String(body.browser || "").toLowerCase()) ? String(body.browser).toLowerCase() : "default";
      const result = await ps("control", {
        action, player, browser, mediaExtensions,
        key: String(body.key || ""), modifiers: modifiersOf(body.modifiers),
        value: Number.isFinite(Number(body.value)) ? clamp(Number(body.value), 0, 100) : 0,
        direction: body.direction === "down" ? "down" : "up",
        what: String(body.what || ""),
        path: String(body.path || "").slice(0, 2048),
        url: String(body.url || "").trim().slice(0, 2048),
        targetWindow: Number.isSafeInteger(targetFor(action)) ? targetFor(action) : 0,
      });
      return rememberWindow(action, result, res) || json(res, 200, { ok: true });
    },
  },
];
