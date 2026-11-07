// Server-side settings (how keystrokes are delivered). Everything else lives on the phone.
const fs = require("node:fs");
const { settingsFile } = require("./config");

const DEFAULTS = { keyMethod: "sendinput", textMethod: "unicode", fallback: true };
const CHOICES = { keyMethod: ["sendinput", "legacy"], textMethod: ["unicode", "paste"] };
let current = { ...DEFAULTS };
try { current = { ...DEFAULTS, ...JSON.parse(fs.readFileSync(settingsFile, "utf8")) }; } catch {}

const get = () => ({ ...current });
function update(changes) {
  const next = { ...current };
  for (const key of Object.keys(CHOICES)) if (CHOICES[key].includes(changes?.[key])) next[key] = changes[key];
  if (typeof changes?.fallback === "boolean") next.fallback = changes.fallback;
  current = next;
  try { fs.writeFileSync(settingsFile, JSON.stringify(current)); } catch (e) { console.error("Could not save settings:", e.message); }
  return get();
}

module.exports = { get, update, DEFAULTS };
