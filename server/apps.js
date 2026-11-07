// Installed apps from the Start menu. The phone only sees a short id; the real launch id stays here,
// so a paired device can start an app that was listed but cannot pass an arbitrary command to Windows.
const crypto = require("node:crypto");
const { ps } = require("./system");

const CACHE_MS = 5 * 60 * 1000;
let cache = { at: 0, list: [], byId: new Map() }, loading = null;

async function load(force = false) {
  if (!force && cache.list.length && Date.now() - cache.at < CACHE_MS) return cache;
  if (!loading) {
    loading = ps("apps", {}, 60000)
      .then((text) => {
        const parsed = JSON.parse(text || "[]");
        const byId = new Map(), list = [];
        for (const row of Array.isArray(parsed) ? parsed : [parsed]) {
          const name = String(row?.name || "").trim(), appId = String(row?.appId || "").trim();
          if (!name || !appId) continue;
          const id = crypto.createHash("sha1").update(appId).digest("hex").slice(0, 16);
          if (byId.has(id)) continue;
          byId.set(id, { name, appId });
          list.push({ id, name });
        }
        list.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base", numeric: true }));
        return (cache = { at: Date.now(), list, byId });
      })
      .finally(() => { loading = null; });
  }
  return loading;
}
const find = async (id) => cache.byId.get(id) || (await load(true)).byId.get(id);

module.exports = { load, find };
