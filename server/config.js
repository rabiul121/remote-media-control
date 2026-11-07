// Settings that never change while the server runs.
const path = require("node:path");
const os = require("node:os");
const crypto = require("node:crypto");

const ROOT = path.resolve(__dirname, "..");
const PORT = Number(process.env.PORT || 8765);
const HOST = process.env.HOST || "0.0.0.0";
const VERSION = require(path.join(ROOT, "package.json")).version;

// A missing or short code would be trivially guessable, so anything that is not
// exactly six digits is replaced by a random one.
const PIN = (() => {
  const supplied = String(process.env.REMOTE_MEDIA_PIN || process.argv[2] || "")
    .replace(/\D/g, "")
    .slice(0, 6);
  return supplied.length === 6 ? supplied : crypto.randomInt(100000, 1000000).toString();
})();

const runtimeDir = path.join(process.env.LOCALAPPDATA || os.tmpdir(), "RemoteMediaControl");

module.exports = {
  ROOT, PORT, HOST, PIN, VERSION, runtimeDir,
  pidFile: path.join(runtimeDir, "listener.pid"),
  sessionFile: path.join(runtimeDir, "paired-devices.json"),
  settingsFile: path.join(runtimeDir, "settings.json"),
  windowsDir: path.join(ROOT, "windows"),
  publicDir: path.join(ROOT, "public"),
  players: ["vlc", "musicbee", "potplayer", "mpc-hc", "mpc-hc64", "wmplayer"],
  browsers: ["default", "edge", "chrome", "firefox", "brave"],
  mediaExtensions: [
    ".mp3", ".mp4", ".m4a", ".m4v", ".mkv", ".avi", ".mov", ".wmv", ".mpeg", ".mpg",
    ".webm", ".ts", ".flac", ".wav", ".aac", ".ogg", ".opus", ".wma",
  ],
};
