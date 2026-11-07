// Browser page: open sites, search, browser controls.
// (Plain script: files share one global scope and load in the order listed in index.html.)

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
