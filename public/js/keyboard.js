// Keyboard page: layout, one-shot modifiers, phone-keyboard typing, quick keys, size and pinch zoom.
// (Plain script: files share one global scope and load in the order listed in index.html.)

// Modifiers are one-shot, like a phone keyboard: tap once to apply to the next key
// only, double-tap to lock, tap again to release. 0 = off, 1 = next key, 2 = locked.
const modifierNames = ["ctrl", "alt", "shift", "win"];
const modifierState = { ctrl: 0, alt: 0, shift: 0, win: 0 };
const modifierTapAt = {};
const modifierKeys = { ctrl: ["CTRL"], alt: ["ALT", "ALTGR"], shift: ["SHIFT"], win: [] };
const keyToModifier = { CTRL: "ctrl", ALT: "alt", ALTGR: "alt", SHIFT: "shift" };
let armedTimer = null;
// Keys and typed text are sent one after another, in the order they were tapped.
let keyChain = Promise.resolve();
let typedPrev = "";
const kbdZoomKey = "remote-media-kbd-zoom";
const kbdZoomMin = 0.25,
  kbdZoomMax = 3;
let kbdZoom = 1;

const keyRows = [
  ["BACKQUOTE", ..."1234567890", "MINUS", "EQUALS", "BACKSPACE"],
  ["TAB", ..."QWERTYUIOP", "LBRACKET", "RBRACKET", "BACKSLASH"],
  ["CAPSLOCK", ..."ASDFGHJKL", "SEMICOLON", "QUOTE", "ENTER"],
  ["SHIFT", ..."ZXCVBNM", "COMMA", "PERIOD", "SLASH", "SHIFT"],
  ["CTRL", "WIN", "ALT", "SPACE", "ALTGR", "FN", "MENU", "CTRL"],
];
const functionKeys = [
  "ESCAPE",
  ...Array.from({ length: 12 }, (_, i) => "F" + (i + 1)),
  "PRINTSCREEN",
  "SCROLLLOCK",
  "PAUSE",
];
const navigationKeys = ["INSERT", "HOME", "PAGEUP", "DELETE", "END", "PAGEDOWN"];
const keyLabels = {
  ESCAPE: "Esc",
  BACKQUOTE: "\u0060",
  MINUS: "-",
  EQUALS: "=",
  BACKSPACE: "Backspace",
  INSERT: "Ins",
  DELETE: "Del",
  PAGEUP: "PgUp",
  PAGEDOWN: "PgDn",
  LBRACKET: "[",
  RBRACKET: "]",
  BACKSLASH: "\\",
  CAPSLOCK: "Caps Lock",
  SEMICOLON: ";",
  QUOTE: "'",
  ENTER: "Enter",
  SHIFT: "Shift",
  CTRL: "Ctrl",
  WIN: "Win",
  ALT: "Alt",
  ALTGR: "Alt",
  FN: "Fn",
  MENU: "Menu",
  COMMA: ",",
  PERIOD: ".",
  SLASH: "/",
  NUMLOCK: "Num\nLock",
  NUMDIVIDE: "/",
  NUMMULTIPLY: "*",
  NUMSUBTRACT: "-",
  NUMADD: "+",
  NUMDECIMAL: ".",
  NUMENTER: "Enter",
  NUM0: "0",
  NUM1: "1",
  NUM2: "2",
  NUM3: "3",
  NUM4: "4",
  NUM5: "5",
  NUM6: "6",
  NUM7: "7",
  NUM8: "8",
  NUM9: "9",
  PRINTSCREEN: "Print\nScreen",
  SCROLLLOCK: "Scroll\nLock",
  PAUSE: "Pause\nBreak",
};
const shiftedLabels = {
  BACKQUOTE: "~",
  1: "!",
  2: "@",
  3: "#",
  4: "$",
  5: "%",
  6: "^",
  7: "&",
  8: "*",
  9: "(",
  0: ")",
  MINUS: "_",
  EQUALS: "+",
  LBRACKET: "{",
  RBRACKET: "}",
  BACKSLASH: "|",
  SEMICOLON: ":",
  QUOTE: '"',
  COMMA: "<",
  PERIOD: ">",
  SLASH: "?",
};
function appendKeyIcon(button, key, symbol, label) {
  button.classList.add("key-labeled");
  const icon = document.createElement("span");
  icon.className = "key-icon";
  icon.setAttribute("aria-hidden", "true");
  if (key === "CAPSLOCK" || key === "WIN") {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("class", key === "WIN" ? "key-svg windows-glyph" : "key-svg");
    if (key === "CAPSLOCK") {
      const body = document.createElementNS("http://www.w3.org/2000/svg", "rect");
      body.setAttribute("x", "5");
      body.setAttribute("y", "10");
      body.setAttribute("width", "14");
      body.setAttribute("height", "10");
      body.setAttribute("rx", "2");
      const shackle = document.createElementNS("http://www.w3.org/2000/svg", "path");
      shackle.setAttribute("d", "M8 10V7a4 4 0 0 1 8 0v3");
      svg.append(shackle, body);
    } else {
      for (const [x, y] of [[3, 3], [13, 3], [3, 13], [13, 13]]) {
        const pane = document.createElementNS("http://www.w3.org/2000/svg", "path");
        pane.setAttribute("d", "M" + x + " " + y + "h8v8h-8z");
        svg.append(pane);
      }
    }
    icon.append(svg);
  } else {
    icon.textContent = symbol;
  }
  button.append(icon, Object.assign(document.createElement("span"), {
    className: "key-name",
    textContent: label,
  }));
}
function buildKeyboard() {
  const layout = $("#keyboard-layout");
  const functionLayout = $("#keyboard-function-keys");
  const navigation = $("#keyboard-extra-keys");
  const numpad = $("#numpad-layout");
  const createKey = (key) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "action-button keyboard-key";
    button.dataset.key = key;
    button.dataset.baseLabel = keyLabels[key] || key;
    button.dataset.shiftLabel = shiftedLabels[key] || button.dataset.baseLabel;
    button.setAttribute("aria-label", keyLabels[key] || key);
    if (["BACKSPACE", "TAB", "CAPSLOCK", "ENTER", "SHIFT", "CTRL", "ALT", "ALTGR", "MENU"].includes(key))
      button.classList.add("key-wide");
    if (key === "CAPSLOCK") button.classList.add("key-caps");
    if (key === "BACKSPACE") appendKeyIcon(button, key, "←", "Backspace");
    else if (key === "TAB") appendKeyIcon(button, key, "⇥", "Tab");
    else if (key === "CAPSLOCK") appendKeyIcon(button, key, "", "Caps Lock");
    else if (key === "ENTER") {
      button.classList.add("key-enter");
      appendKeyIcon(button, key, "↵", "Enter");
    } else if (key === "SHIFT") appendKeyIcon(button, key, "⇧", "Shift");
    else if (key === "WIN") appendKeyIcon(button, key, "", "Win");
    else if (key === "MENU") appendKeyIcon(button, key, "☷", "Menu");
    else if (shiftedLabels[key]) {
      button.classList.add("key-has-legends");
      const shifted = document.createElement("span");
      shifted.className = "key-shift-legend";
      shifted.textContent = shiftedLabels[key];
      const base = document.createElement("span");
      base.className = "key-base-legend";
      base.textContent = keyLabels[key] || key;
      button.append(shifted, base);
    } else {
      button.textContent = keyLabels[key] || key;
    }
    if (key === "SPACE") button.classList.add("key-space");
    if (key === "FN") {
      button.classList.add("key-fn");
      button.disabled = true;
      button.title = "Fn is a hardware function key";
    }
    return button;
  };
  functionKeys.forEach((key, index) => {
    const button = createKey(key);
    if ([1, 5, 9, 13].includes(index)) button.classList.add("keyboard-function-gap");
    if (["PRINTSCREEN", "SCROLLLOCK", "PAUSE"].includes(key))
      button.classList.add("keyboard-function-special");
    functionLayout.append(button);
  });
  navigationKeys.forEach((key) => navigation.append(createKey(key)));
  keyRows.forEach((keys, rowIndex) => {
    const row = document.createElement("div");
    row.className = "keyboard-row";
    row.dataset.row = String(rowIndex);
    keys.forEach((key) => row.append(createKey(key)));
    layout.append(row);
  });
  const numpadKeys = [
    ["NUMLOCK", "NUMDIVIDE", "NUMMULTIPLY", "NUMSUBTRACT"],
    ["NUM7", "NUM8", "NUM9", "NUMADD"],
    ["NUM4", "NUM5", "NUM6"],
    ["NUM1", "NUM2", "NUM3", "NUMENTER"],
    ["NUM0", "NUMDECIMAL"],
  ];
  numpadKeys.forEach((keys) => keys.forEach((key) => {
    const button = createKey(key);
    if (key === "NUMADD") button.classList.add("numpad-add");
    if (key === "NUMENTER") button.classList.add("numpad-enter");
    if (key === "NUM0") button.classList.add("numpad-zero");
    numpad.append(button);
  }));
  document.querySelectorAll(".keyboard-key").forEach((button) =>
    button.addEventListener("click", () => {
      const key = button.dataset.key;
      if (keyToModifier[key]) tapModifier(keyToModifier[key]);
      else sendKey(key);
    }),
  );
  document.querySelectorAll("[data-modifier]").forEach((button) =>
    button.addEventListener("click", () => tapModifier(button.dataset.modifier)),
  );
  renderModifiers();
}
function queueKeyboard(action, extra) {
  keyChain = keyChain.then(() => command(action, extra));
}
function modifierSelector(name) {
  return [
    `[data-modifier="${name}"]`,
    ...modifierKeys[name].map((key) => `.keyboard-key[data-key="${key}"]`),
  ].join(",");
}
function renderModifiers() {
  for (const name of modifierNames) {
    const on = modifierState[name] > 0;
    document.querySelectorAll(modifierSelector(name)).forEach((el) => {
      el.classList.toggle("active", on);
      el.classList.toggle("locked", modifierState[name] === 2);
      if (el.dataset.modifier) el.setAttribute("aria-pressed", String(on));
    });
  }
  const labels = { ctrl: "Ctrl", alt: "Alt", shift: "Shift", win: "Win" };
  const armed = modifierNames.filter((name) => modifierState[name]);
  $("#keyboard-armed").textContent = armed.length
    ? (armed.some((name) => modifierState[name] === 1) ? "Next key with " : "Held: ") +
      armed.map((name) => labels[name] + (modifierState[name] === 2 ? " (locked)" : "")).join(" + ")
    : "";
  refreshShiftLabels();
}
function tapModifier(name) {
  buzz();
  const now = Date.now(),
    current = modifierState[name];
  if (current === 0) modifierState[name] = 1;
  else if (current === 1 && now - (modifierTapAt[name] || 0) < 450) modifierState[name] = 2;
  else modifierState[name] = 0;
  modifierTapAt[name] = now;
  renderModifiers();
  // A forgotten one-shot modifier clears itself instead of waiting to surprise the next key.
  clearTimeout(armedTimer);
  armedTimer = setTimeout(() => clearModifiers(), 10000);
}
function clearModifiers(includeLocked = false) {
  let changed = false;
  for (const name of modifierNames)
    if (modifierState[name] === 1 || (includeLocked && modifierState[name])) {
      modifierState[name] = 0;
      changed = true;
    }
  if (changed) renderModifiers();
}
// "ALT+TAB", "WIN+SHIFT+S", "F5": modifiers first, the key last.
function sendCombo(combo) {
  const parts = combo.split("+"), key = parts.pop();
  clearModifiers();
  buzz();
  queueKeyboard("keyboardPress", { key, modifiers: { ctrl: parts.includes("CTRL"), alt: parts.includes("ALT"), shift: parts.includes("SHIFT"), win: parts.includes("WIN") } });
}
function sendKey(key) {
  buzz();
  const modifiers = {
    ctrl: modifierState.ctrl > 0,
    alt: modifierState.alt > 0,
    shift: modifierState.shift > 0,
    win: modifierState.win > 0,
  };
  clearModifiers();
  queueKeyboard("keyboardPress", { key, modifiers });
  if (["CAPSLOCK", "NUMLOCK", "SCROLLLOCK"].includes(key)) setTimeout(refresh, 400);
}
// Text from the phone keyboard: send only what changed since the last input event,
// so autocorrect, backspace and replaced words all arrive correctly.
function sendTypedDiff(next) {
  let i = 0;
  const max = Math.min(typedPrev.length, next.length);
  while (i < max && typedPrev[i] === next[i]) i++;
  const isHigh = (code) => code >= 0xd800 && code <= 0xdbff;
  if (i > 0 && i < Math.max(typedPrev.length, next.length) && isHigh(typedPrev.charCodeAt(i - 1))) i--;
  const removed = Array.from(typedPrev.slice(i)).length;
  const added = next.slice(i);
  typedPrev = next;
  for (let n = 0; n < removed; n++)
    queueKeyboard("keyboardPress", { key: "BACKSPACE", modifiers: {} });
  if (added) queueKeyboard("typeText", { text: added });
}
function resetTyping() {
  const input = $("#type-input");
  input.value = "";
  typedPrev = "";
}
// ---- keyboard size ----
function measureKeyboard() {
  const box = $("#keyboard-zoom-box"),
    layout = $("#keyboard-full-layout");
  box.style.width = "";
  box.style.height = "";
  layout.style.width = "";
  layout.style.transform = "";
  return { w: layout.offsetWidth, h: layout.offsetHeight };
}
function applyKeyboardZoom(next, keepCenter = true, anchor = null) {
  const scroll = $("#keyboard-scroll"),
    box = $("#keyboard-zoom-box"),
    layout = $("#keyboard-full-layout");
  const before = kbdZoom;
  const base = measureKeyboard();
  if (!base.w) return; // the page is hidden; try again when it is shown
  kbdZoom = Math.min(kbdZoomMax, Math.max(kbdZoomMin, next ?? kbdZoom));
  layout.style.width = base.w + "px";
  layout.style.transform = `scale(${kbdZoom})`;
  box.style.width = Math.round(base.w * kbdZoom) + "px";
  box.style.height = Math.round(base.h * kbdZoom) + "px";
  $("#kbd-zoom-label").textContent = Math.round(kbdZoom * 100) + "%";
  if (keepCenter && before !== kbdZoom) {
    // Keep the point under the fingers (or the middle of the view) where it was.
    const ax = anchor?.x ?? scroll.clientWidth / 2,
      ay = anchor?.y ?? scroll.clientHeight / 2;
    const cx = (scroll.scrollLeft + ax) / before,
      cy = (scroll.scrollTop + ay) / before;
    scroll.scrollLeft = cx * kbdZoom - ax;
    scroll.scrollTop = cy * kbdZoom - ay;
  }
  try {
    localStorage.setItem(kbdZoomKey, String(kbdZoom));
  } catch {}
}
function fitKeyboard() {
  const base = measureKeyboard();
  if (!base.w) return;
  applyKeyboardZoom($("#keyboard-scroll").clientWidth / base.w, false);
  $("#keyboard-scroll").scrollLeft = 0;
}
function refreshShiftLabels() {
  const shifted = modifierState.shift > 0;
  document.querySelectorAll(".keyboard-key.key-has-legends").forEach((button) => {
    button.classList.toggle("shift-active", shifted);
  });
}
buildKeyboard();

{
  const saved = Number(localStorage.getItem(kbdZoomKey));
  if (saved > 0) kbdZoom = Math.min(kbdZoomMax, Math.max(kbdZoomMin, saved));
}
$("#kbd-zoom-in").addEventListener("click", () => applyKeyboardZoom(kbdZoom * 1.2));
$("#kbd-zoom-out").addEventListener("click", () => applyKeyboardZoom(kbdZoom / 1.2));
$("#kbd-zoom-reset").addEventListener("click", () => applyKeyboardZoom(1, false));
$("#kbd-zoom-fit").addEventListener("click", fitKeyboard);
window.addEventListener("resize", () => {
  if (currentPage === "keyboard") applyKeyboardZoom(kbdZoom, false);
});
// Pinch with two fingers on the keyboard to resize it (the app's WebView has no native pinch-zoom).
{
  const scroll = $("#keyboard-scroll");
  let pinch = null;
  const spread = (t) => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
  scroll.addEventListener("touchstart", (e) => {
    if (e.touches.length === 2) pinch = { distance: spread(e.touches), zoom: kbdZoom };
  }, { passive: true });
  scroll.addEventListener("touchmove", (e) => {
    if (!pinch || e.touches.length !== 2) return;
    e.preventDefault();
    const box = scroll.getBoundingClientRect();
    applyKeyboardZoom(pinch.zoom * (spread(e.touches) / pinch.distance), true, {
      x: (e.touches[0].clientX + e.touches[1].clientX) / 2 - box.left,
      y: (e.touches[0].clientY + e.touches[1].clientY) / 2 - box.top,
    });
  }, { passive: false });
  const endPinch = (e) => { if (e.touches.length < 2) pinch = null; };
  scroll.addEventListener("touchend", endPinch);
  scroll.addEventListener("touchcancel", endPinch);
}
// Phone keyboard -> PC. Enter presses Enter and clears the box, ready for the next line.
$("#type-input").addEventListener("input", (e) => {
  sendTypedDiff(e.target.value);
  if (e.target.value.length > 200) resetTyping();
});
$("#type-input").addEventListener("keydown", (e) => {
  const keys = { Enter: "ENTER", Backspace: "BACKSPACE", Delete: "DELETE", ArrowLeft: "LEFT", ArrowRight: "RIGHT", ArrowUp: "UP", ArrowDown: "DOWN" };
  if (e.key === "Enter") {
    e.preventDefault();
    queueKeyboard("keyboardPress", { key: "ENTER", modifiers: {} });
    resetTyping();
  } else if (keys[e.key] && (e.target.value === "" || e.key.startsWith("Arrow"))) {
    // Nothing left in the box to edit, so send the key to the PC itself.
    e.preventDefault();
    queueKeyboard("keyboardPress", { key: keys[e.key], modifiers: {} });
  }
});
// ---------- Keyboard page: quick keys, test, player volume steps ----------
document.querySelectorAll("[data-quick-key]").forEach((b) => b.addEventListener("click", () => sendCombo(b.dataset.quickKey)));

$("#keyboard-diagnose").addEventListener("click", () => runInputTest($("#keyboard-diagnose"), (text) => showKeyboardHint(text, "test")));
