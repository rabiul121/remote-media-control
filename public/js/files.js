// Files page: browsing drives and folders, opening media.
// (Plain script: files share one global scope and load in the order listed in index.html.)

async function loadFiles(path = currentFolder) {
  const list = $("#file-list");
  list.replaceChildren(
    Object.assign(document.createElement("div"), {
      className: "file-empty",
      textContent: "Loading…",
    }),
  );
  try {
    const q = path ? "?path=" + encodeURIComponent(path) : "";
    const data = await request("/api/files" + q);
    currentFolder = data.path || "";
    renderBreadcrumbs(currentFolder);
    $("#file-up").disabled = !currentFolder;
    $("#file-open-explorer").disabled = !currentFolder;
    list.replaceChildren();
    const add = (item, kind) => {
      const b = document.createElement("button");
      b.className = "file-row " + kind;
      b.type = "button";
      const symbol = document.createElement("span");
      symbol.className = "file-symbol";
      symbol.textContent =
        kind === "folder"
          ? "▰"
          : kind === "drive"
            ? "▣"
            : kind === "media"
              ? "♫"
              : "▤";
      const name = document.createElement("span");
      name.className = "file-name";
      name.textContent = item.name;
      const meta = document.createElement("span");
      meta.className = "file-meta";
      meta.textContent =
        kind === "media" || kind === "file"
          ? formatBytes(item.bytes)
          : kind === "drive"
            ? item.path
            : "";
      b.append(symbol, name, meta);
      b.addEventListener("click", () =>
        kind === "media"
          ? playerCommand("openFile", item.path)
          : kind === "file"
            ? playerCommand("openDefaultFile", item.path)
            : loadFiles(item.path),
      );
      list.append(b);
    };
    const folders = (data.drives || []).concat(data.folders || []);
    folders.sort((a, b) => a.name.localeCompare(b.name));
    folders.forEach((x) => add(x, x.kind));
    (data.files || [])
      .sort((a, b) => a.name.localeCompare(b.name))
      .forEach((x) => add(x, x.kind || "media"));
    if (!list.children.length)
      list.append(
        Object.assign(document.createElement("div"), {
          className: "file-empty",
          textContent: "No files or folders here.",
        }),
      );
  } catch (e) {
    list.replaceChildren(
      Object.assign(document.createElement("div"), {
        className: "file-empty",
        textContent: e.message,
      }),
    );
  }
}
function renderBreadcrumbs(path) {
  const host = $("#file-breadcrumbs");
  host.replaceChildren();
  if (!path) {
    host.textContent = "Drives";
    return;
  }
  const parts = path.split(/[\\/]+/).filter(Boolean);
  let partial = parts[0] + "\\";
  const addCrumb = (label, target, isLast) => {
    if (isLast) {
      const current = document.createElement("span");
      current.className = "breadcrumb-current";
      current.textContent = label;
      host.append(current);
      return;
    }
    const button = document.createElement("button");
    button.type = "button";
    button.className = "breadcrumb-link";
    button.textContent = label;
    button.addEventListener("click", () => loadFiles(target));
    host.append(
      button,
      Object.assign(document.createElement("span"), {
        className: "breadcrumb-separator",
        textContent: "›",
      }),
    );
  };
  addCrumb(parts[0], partial, parts.length === 1);
  for (let i = 1; i < parts.length; i++) {
    partial += parts[i] + (i < parts.length - 1 ? "\\" : "");
    addCrumb(parts[i], partial, i === parts.length - 1);
  }
}
function setFilesFolded(folded) {
  $(".file-card").classList.toggle("explorer-controls-only", folded);
  const toggle = $("#file-browser-toggle");
  toggle.textContent = folded ? "▤" : "⌃";
  toggle.title = folded ? "Show file browser" : "Hide file browser";
  toggle.setAttribute("aria-label", toggle.title);
}
function formatBytes(bytes) {
  if (!Number.isFinite(bytes)) return "";
  if (bytes < 1024) return bytes + " B";
  const units = ["KB", "MB", "GB", "TB"];
  let i = -1;
  do {
    bytes /= 1024;
    i++;
  } while (bytes >= 1024 && i < units.length - 1);
  return bytes.toFixed(bytes >= 10 ? 0 : 1) + " " + units[i];
}

$("#file-up").addEventListener("click", async () => {
  if (!currentFolder) return;
  try {
    const d = await request(
      "/api/files?path=" + encodeURIComponent(currentFolder),
    );
    await loadFiles(d.parent || "");
  } catch (e) {
    notify(e.message);
  }
});
$("#files-refresh").addEventListener("click", () => loadFiles());
$("#file-browser-toggle").addEventListener("click", () =>
  setFilesFolded(!$(".file-card").classList.contains("explorer-controls-only")),
);
$("#file-home").addEventListener("click", () => loadFiles(""));

$("#file-open-explorer").addEventListener(
  "click",
  () => currentFolder && playerCommand("openFolder", currentFolder),
);
