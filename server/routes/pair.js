const { PIN, PORT } = require("../config");
const { json, clientIp, isLoopback, hasLoopbackHost, localAddresses } = require("../http-util");
const sessions = require("../sessions");

module.exports = [
  {
    method: "POST", path: "/api/pair", auth: false,
    async handler({ req, res, body }) {
      const ip = clientIp(req), locked = sessions.lockRemaining(ip);
      if (locked > 0) {
        res.setHeader("Retry-After", String(Math.ceil(locked / 1000)));
        return json(res, 429, { error: `Too many wrong codes. Try again in ${Math.ceil(locked / 60000)} minute(s).` });
      }
      if (!sessions.pinMatches(body.pin)) {
        sessions.recordFailure(ip);
        return json(res, 401, { error: "That code did not match." });
      }
      sessions.forgive(ip);
      return json(res, 200, { token: sessions.issueToken() });
    },
  },
  {
    method: "GET", path: "/api/pair-qr", auth: false,
    async handler({ req, res }) {
      if (!isLoopback(req) || !hasLoopbackHost(req))
        return json(res, 403, { error: "Open the QR page on the Windows PC to protect the pairing code." });
      const host = localAddresses()[0];
      if (!host) return json(res, 503, { error: "No active Wi-Fi or Ethernet IPv4 address was found." });
      const pairing = { type: "remote-media-control-pairing", version: 1, host, port: PORT, pairing_code: PIN };
      const svg = await require("qrcode").toString(JSON.stringify(pairing), {
        type: "svg", errorCorrectionLevel: "Q", margin: 3, color: { dark: "#12151e", light: "#ffffff" },
      });
      return json(res, 200, { ...pairing, svg });
    },
  },
  { method: "POST", path: "/api/unpair", auth: true, handler: ({ req, res }) => (sessions.revoke(req), json(res, 200, { ok: true })) },
  { method: "POST", path: "/api/unpair-others", auth: true, handler: ({ req, res }) => json(res, 200, { ok: true, removed: sessions.revokeOthers(req) }) },
];
