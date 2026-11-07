const { ps } = require("../system");
const input = require("../input");
const rt = require("../runtime");
const { json } = require("../http-util");

const BROWSER_CACHE_MS = 5 * 60 * 1000;
const positive = (n) => (Number.isSafeInteger(n) && n > 0 ? n : 0);

// Each page controls one window. Follow the window in front when it fits that page, otherwise keep the last one if it still exists.
function follow(current, foreground, targetExists) {
  if (positive(foreground)) return foreground;
  return targetExists ? current : 0;
}

module.exports = [
  {
    method: "GET", path: "/api/state", auth: true,
    async handler({ res, url }) {
      const detectBrowsers = url.searchParams.get("full") === "1" || !rt.browsers || Date.now() - rt.browsersCheckedAt > BROWSER_CACHE_MS;
      const state = JSON.parse(await ps("state", {
        targetWindow: rt.defaultWindow, explorerWindow: rt.explorerWindow, browserWindow: rt.browserWindow, detectBrowsers,
      }));
      if (Array.isArray(state.browsers)) {
        rt.browsers = state.browsers;
        if (typeof state.defaultBrowser === "string") rt.defaultBrowser = state.defaultBrowser;
        rt.browsersCheckedAt = Date.now();
      }
      state.browsers = rt.browsers || ["default"];
      state.defaultBrowser = rt.defaultBrowser;
      // A browser opened by hand, or opened behind other windows, is still found: the one in front, else any open one.
      rt.browserWindow = positive(state.foregroundBrowserWindow) ? state.foregroundBrowserWindow
        : state.browserTargetWindowExists ? rt.browserWindow : positive(state.browserFallbackWindow);
      rt.defaultWindow = follow(rt.defaultWindow, state.foregroundWindow, state.targetWindowExists);
      rt.explorerWindow = follow(rt.explorerWindow, state.foregroundExplorerWindow, state.explorerTargetWindowExists);
      Object.assign(state, {
        explorerReady: !!rt.explorerWindow, defaultAppReady: !!rt.defaultWindow, browserReady: !!rt.browserWindow,
        mouseDragging: input.isDragging(),
      });
      return json(res, 200, state);
    },
  },
];
