// Apps page: list, search and open installed apps.
// (Plain script: files share one global scope and load in the order listed in index.html.)

// ---------- Apps page ----------
const appsText = (value) =>
  String(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
const compareApps = (a, b) =>
  a.name.localeCompare(b.name, undefined, { sensitivity: "base", numeric: true });
function matchingApps() {
  const tokens = appsText(appsQuery).split(/\s+/).filter(Boolean);
  if (!tokens.length) return appsList;
  const scored = [];
  for (const app of appsList) {
    if (!tokens.every((token) => app.key.includes(token))) continue;
    // Best matches first: name starts with the search, then a word does, then anywhere.
    let score = 2;
    if (app.key.startsWith(tokens[0])) score = 0;
    else if (app.key.split(/[\s\-_.()+,:;/\\[\]]+/).some((w) => w.startsWith(tokens[0]))) score = 1;
    scored.push([score, app]);
  }
  scored.sort((a, b) => a[0] - b[0] || compareApps(a[1], b[1]));
  return scored.map((entry) => entry[1]);
}
function setAppsStatus(message, isError = false) {
  const el = $("#apps-status");
  el.textContent = message;
  el.classList.toggle("error", isError);
}
function updateAppsStatus() {
  if (!appsLoaded) return;
  const total = appsList.length,
    shown = matchingApps().length;
  setAppsStatus(
    !total
      ? "No apps were found on this PC."
      : appsQuery.trim()
        ? shown
          ? `${shown} of ${total} apps`
          : `No apps match “${appsQuery.trim()}”.`
        : `${total} apps`,
  );
}
function flashAppsStatus(message, isError = false) {
  setAppsStatus(message, isError);
  clearTimeout(appsStatusTimer);
  appsStatusTimer = setTimeout(updateAppsStatus, 3500);
}
function renderApps() {
  const host = $("#apps-list");
  const matches = matchingApps();
  const fragment = document.createDocumentFragment();
  const grouped = !appsQuery.trim();
  let group = "";
  for (const app of matches) {
    if (grouped) {
      const first = appsText(app.name).charAt(0);
      const letter = /\p{L}/u.test(first) ? first.toUpperCase() : "#";
      if (letter !== group) {
        group = letter;
        fragment.append(
          Object.assign(document.createElement("div"), {
            className: "app-letter",
            textContent: letter,
          }),
        );
      }
    }
    const row = document.createElement("button");
    row.type = "button";
    row.className = "app-row";
    row.dataset.id = app.id;
    row.dataset.name = app.name;
    row.append(
      Object.assign(document.createElement("span"), {
        className: "app-badge",
        textContent: (Array.from(app.name)[0] || "?").toUpperCase(),
      }),
      Object.assign(document.createElement("span"), {
        className: "app-name",
        textContent: app.name,
      }),
      Object.assign(document.createElement("span"), { className: "app-meta" }),
    );
    fragment.append(row);
  }
  host.replaceChildren(fragment);
  updateAppsStatus();
}
async function loadApps(force = false) {
  if (appsLoading) return;
  appsLoading = true;
  $("#apps-refresh").disabled = true;
  if (!appsLoaded || force)
    setAppsStatus("Loading apps… the first load can take a few seconds.");
  try {
    const data = await request("/api/apps" + (force ? "?refresh=1" : ""));
    appsList = (data.apps || [])
      .map((app) => ({ id: app.id, name: app.name, key: appsText(app.name) }))
      .sort(compareApps);
    appsLoaded = true;
    renderApps();
  } catch (e) {
    if (appsLoaded) flashAppsStatus(e.message, true);
    else setAppsStatus(e.message, true);
  } finally {
    appsLoading = false;
    $("#apps-refresh").disabled = false;
  }
}
async function openApp(id, name, row) {
  if (!id || row?.classList.contains("opening")) return;
  row?.classList.add("opening");
  row?.querySelector(".app-meta")?.replaceChildren("Opening…");
  flashAppsStatus(`Opening ${name}…`);
  try {
    await request("/api/control", {
      method: "POST",
      body: JSON.stringify({ action: "openApp", id }),
    });
    flashAppsStatus(`Opened ${name}.`);
    // The status check adopts the newly focused window, so the Window page
    // controls follow the app that was just opened.
    setTimeout(refresh, 1500);
    setTimeout(refresh, 4000);
  } catch (e) {
    flashAppsStatus(e.message, true);
    notify(e.message);
    if (/no longer in the list/i.test(e.message)) loadApps(true);
  } finally {
    setTimeout(() => {
      row?.classList.remove("opening");
      row?.querySelector(".app-meta")?.replaceChildren();
    }, 1200);
  }
}

$("#apps-refresh").addEventListener("click", () => loadApps(true));
$("#apps-search").addEventListener("input", (e) => {
  clearTimeout(debounce.apps);
  debounce.apps = setTimeout(() => {
    appsQuery = e.target.value;
    renderApps();
    $("#apps-list").scrollTop = 0;
  }, 80);
});
$("#apps-search").addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    // Enter opens the best match, so "type a few letters, press Go" works.
    e.preventDefault();
    clearTimeout(debounce.apps);
    appsQuery = e.target.value;
    renderApps();
    const first = $("#apps-list .app-row");
    if (first) {
      openApp(first.dataset.id, first.dataset.name, first);
      e.target.blur();
    }
  } else if (e.key === "Escape") {
    e.target.value = "";
    appsQuery = "";
    renderApps();
  }
});
$("#apps-list").addEventListener("click", (e) => {
  const row = e.target.closest(".app-row");
  if (row) openApp(row.dataset.id, row.dataset.name, row);
});
