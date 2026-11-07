// Files and installed apps.
const { ps } = require("../system");
const apps = require("../apps");
const { json } = require("../http-util");
const { mediaExtensions } = require("../config");

module.exports = [
  {
    method: "GET", path: "/api/files", auth: true,
    async handler({ res, url }) {
      return json(res, 200, JSON.parse(await ps("browse", { path: url.searchParams.get("path") || "", mediaExtensions })));
    },
  },
  {
    method: "GET", path: "/api/apps", auth: true,
    async handler({ res, url }) {
      const data = await apps.load(url.searchParams.get("refresh") === "1");
      return json(res, 200, { apps: data.list, loadedAt: data.at });
    },
  },
];
