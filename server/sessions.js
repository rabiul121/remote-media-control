// Paired phones: tokens that last a year, plus a limit on wrong pairing codes.
const fs = require("node:fs");
const crypto = require("node:crypto");
const { PIN, sessionFile, runtimeDir } = require("./config");

const TTL = 365 * 24 * 60 * 60 * 1000;
const sessions = new Map(); // token -> expiry time
fs.mkdirSync(runtimeDir, { recursive: true });
try {
  const stored = JSON.parse(fs.readFileSync(sessionFile, "utf8"));
  for (const [token, expiresAt] of Array.isArray(stored) ? stored : [])
    if (/^[a-f0-9]{48}$/i.test(token) && Number.isFinite(expiresAt) && expiresAt > Date.now()) sessions.set(token, expiresAt);
} catch {}

function save() {
  try {
    const temporary = `${sessionFile}.${process.pid}.tmp`;
    fs.writeFileSync(temporary, JSON.stringify([...sessions]), { mode: 0o600 });
    fs.renameSync(temporary, sessionFile);
  } catch (e) {
    console.error("Could not save paired devices:", e.message);
  }
}
const tokenOf = (req) => String(req.headers.authorization || "").replace(/^Bearer\s+/i, "");
function isPaired(req) {
  const token = tokenOf(req), expires = sessions.get(token);
  if (!expires) return false;
  if (expires < Date.now()) { sessions.delete(token); save(); return false; }
  return true;
}
function issueToken() {
  const token = crypto.randomBytes(24).toString("hex");
  sessions.set(token, Date.now() + TTL);
  save();
  return token;
}
function revoke(req) { if (sessions.delete(tokenOf(req))) save(); }
function revokeOthers(req) {
  const keep = tokenOf(req);
  let removed = 0;
  for (const token of [...sessions.keys()]) if (token !== keep) { sessions.delete(token); removed++; }
  if (removed) save();
  return removed;
}

// ---- pairing code: compared in constant time, and wrong guesses are rate limited per address ----
const attempts = new Map();
const MAX_FAILURES = 8, WINDOW = 10 * 60 * 1000, LOCK = 5 * 60 * 1000;
function pinMatches(candidate) {
  const a = Buffer.from(String(candidate ?? "")), b = Buffer.from(PIN);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
function lockRemaining(ip) {
  const entry = attempts.get(ip), now = Date.now();
  if (!entry) return 0;
  if (entry.lockedUntil > now) return entry.lockedUntil - now;
  if (now - entry.first > WINDOW) attempts.delete(ip);
  return 0;
}
function recordFailure(ip) {
  const now = Date.now();
  let entry = attempts.get(ip);
  if (!entry || now - entry.first > WINDOW) entry = { count: 0, first: now, lockedUntil: 0 };
  if (++entry.count >= MAX_FAILURES) Object.assign(entry, { lockedUntil: now + LOCK, count: 0, first: now });
  attempts.set(ip, entry);
  if (attempts.size > 500) for (const [key, value] of attempts) if (value.lockedUntil < now && now - value.first > WINDOW) attempts.delete(key);
}
const forgive = (ip) => attempts.delete(ip);
const count = () => sessions.size;

module.exports = { isPaired, issueToken, revoke, revokeOthers, pinMatches, lockRemaining, recordFailure, forgive, count };
