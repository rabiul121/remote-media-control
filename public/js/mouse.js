// Mouse page: touchpad gestures (move, tap, scroll, zoom, drag) and their ordered command queue.
// (Plain script: files share one global scope and load in the order listed in index.html.)

async function mouseCommand(action, extra = {}) {
  try {
    await request("/api/control", {
      method: "POST",
      body: JSON.stringify({ action, ...extra }),
    });
  } catch (e) {
    notify(e.message);
  }
}

let padActive = false,
  lastPadPoint = null,
  gesture = null,
  pendingMouse = { dx: 0, dy: 0 },
  mouseMoveTimer = null,
  padDown = null,
  longPressTimer = null,
  pendingTapTimer = null,
  pendingTap = false,
  pendingTapPoint = null,
  suppressNextTapPointerId = null;
let zoomCommandChain = Promise.resolve();
function queueMouseAction(action, extra = {}) {
  zoomCommandChain = zoomCommandChain.then(() => mouseCommand(action, extra));
}
// ---- drag: the left button stays down while the pointer moves ----
// Everything sent while a drag is active goes through one ordered queue, so
// "button down", the moves and "button up" cannot overtake each other.
function updateDragUi() {
  const button = $("#mouse-drag-toggle");
  button.classList.toggle("active", dragLock);
  button.setAttribute("aria-pressed", String(dragLock));
  button.querySelector("span:last-child").textContent = dragLock ? "Release" : "Drag";
  button.classList.toggle("active", dragLock);
  pad.classList.toggle("dragging", dragging);
}
function startDrag() {
  if (dragging) return;
  dragging = true;
  clearTimeout(mouseMoveTimer);
  mouseMoveTimer = null;
  const { dx, dy } = pendingMouse;
  pendingMouse = { dx: 0, dy: 0 };
  if (dx || dy) queueMouseAction("mouseMove", { dx, dy });
  queueMouseAction("mouseLeftDown");
  navigator.vibrate?.(15);
  updateDragUi();
}
function endDrag() {
  if (!dragging) return;
  clearTimeout(mouseMoveTimer);
  mouseMoveTimer = null;
  const { dx, dy } = pendingMouse;
  pendingMouse = { dx: 0, dy: 0 };
  if (dx || dy) queueMouseAction("mouseMove", { dx, dy });
  queueMouseAction("mouseLeftUp");
  dragging = false;
  dragLock = false;
  updateDragUi();
}
function beginPadDrag(pointerId) {
  if (dragging || padDown?.pointerId !== pointerId || padPointers.size !== 1) return;
  clearTimeout(dragHoldTimer);
  dragHoldTimer = null;
  clearTimeout(pendingTapTimer);
  pendingTap = false;
  pendingTapPoint = null;
  padDown.dragging = true;
  padDown.moved = true;
  startDrag();
}
const pad = $("#mouse-pad");
const padPointers = new Map();
const touchDistance = (points) =>
  Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y);
const touchCenter = (points) => ({
  x: (points[0].x + points[1].x) / 2,
  y: (points[0].y + points[1].y) / 2,
});
function flushMouseMove() {
  mouseMoveTimer = null;
  const dx = pendingMouse.dx,
    dy = pendingMouse.dy;
  pendingMouse = { dx: 0, dy: 0 };
  if (!dx && !dy) return;
  if (dragging) queueMouseAction("mouseMove", { dx, dy });
  else mouseCommand("mouseMove", { dx, dy });
}
function clearLongPress() {
  clearTimeout(longPressTimer);
  longPressTimer = null;
}
function queuePadTap(point) {
  if (pendingTap) {
    clearTimeout(pendingTapTimer);
    pendingTap = false;
    pendingTapPoint = null;
    mouseCommand("mouseDoubleClick");
    return;
  }
  pendingTap = true;
  pendingTapPoint = point;
  pendingTapTimer = setTimeout(() => {
    pendingTap = false;
    pendingTapPoint = null;
    mouseCommand("mouseLeftClick");
  }, 260);
}
pad.addEventListener("pointerdown", (e) => {
  if (padPointers.size === 0 && pendingTap && pendingTapPoint) {
    const gap = Math.hypot(e.clientX - pendingTapPoint.x, e.clientY - pendingTapPoint.y);
    if (gap > 32) {
      clearTimeout(pendingTapTimer);
      pendingTap = false;
      pendingTapPoint = null;
      suppressNextTapPointerId = e.pointerId;
    }
  }
  padActive = true;
  padPointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  lastPadPoint = { x: e.clientX, y: e.clientY };
  pad.setPointerCapture(e.pointerId);
  if (padPointers.size === 1) {
    // A touch that lands right after a tap and then holds or slides is a drag
    // (like a laptop touchpad); lifting quickly is still a double click.
    const dragCandidate = pendingTap && !dragging;
    padDown = {
      pointerId: e.pointerId,
      x: e.clientX,
      y: e.clientY,
      moved: false,
      longPressed: false,
      dragCandidate,
      dragging: false,
    };
    if (dragCandidate) {
      dragHoldTimer = setTimeout(() => beginPadDrag(e.pointerId), 220);
    } else if (!dragging) {
      longPressTimer = setTimeout(() => {
        if (padDown?.pointerId !== e.pointerId || padDown.moved || padPointers.size !== 1) return;
        padDown.longPressed = true;
        padDown.moved = true;
        pendingTap = false;
        clearTimeout(pendingTapTimer);
        mouseCommand("mouseRightClick");
      }, 550);
    }
  } else if (padPointers.size === 2) {
    clearLongPress();
    clearTimeout(dragHoldTimer);
    dragHoldTimer = null;
    if (padDown?.dragging) endDrag();
    padDown = null;
    if (pendingTap) {
      clearTimeout(pendingTapTimer);
      pendingTap = false;
      pendingTapPoint = null;
    }
    const points = [...padPointers.values()];
    gesture = {
      startDistance: touchDistance(points),
      startCenter: touchCenter(points),
      lastCenter: touchCenter(points),
      lastZoomDistance: touchDistance(points),
      mode: "pending",
    };
    lastPadPoint = null;
    pendingMouse = { dx: 0, dy: 0 };
    clearTimeout(mouseMoveTimer);
    mouseMoveTimer = null;
  }
  e.preventDefault();
});
pad.addEventListener("pointermove", (e) => {
  if (!padActive) return;
  if (padPointers.has(e.pointerId))
    padPointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (padPointers.size >= 2 && gesture) {
    const points = [...padPointers.values()].slice(0, 2);
    const center = touchCenter(points);
    const distance = touchDistance(points);
    const distanceChange = distance - gesture.startDistance;
    const centerTravel = Math.hypot(
      center.x - gesture.startCenter.x,
      center.y - gesture.startCenter.y,
    );
    if (
      gesture.mode === "pending" &&
      Math.abs(distanceChange) > 18 &&
      Math.abs(distanceChange) > centerTravel * 0.6
    ) {
      gesture.mode = "pinch";
      gesture.lastZoomDistance = distance;
      queueMouseAction(distanceChange > 0 ? "mouseGestureZoomIn" : "mouseGestureZoomOut");
    } else if (
      gesture.mode === "pending" &&
      Math.abs(center.y - gesture.startCenter.y) > 12 &&
      Math.abs(center.y - gesture.startCenter.y) >
        Math.abs(center.x - gesture.startCenter.x)
    ) {
      gesture.mode = "scroll";
    }
    if (gesture.mode === "pinch") {
      let steps = 0;
      while (distance - gesture.lastZoomDistance >= 26 && steps++ < 4) {
        queueMouseAction("mouseGestureZoomIn");
        gesture.lastZoomDistance += 26;
      }
      steps = 0;
      while (gesture.lastZoomDistance - distance >= 26 && steps++ < 4) {
        queueMouseAction("mouseGestureZoomOut");
        gesture.lastZoomDistance -= 26;
      }
    }
    if (gesture.mode === "scroll") {
      const deltaY = center.y - gesture.lastCenter.y;
      const step = 18 / prefs.scrollSpeed;
      if (Math.abs(deltaY) >= step) {
        const notches = Math.min(4, Math.floor(Math.abs(deltaY) / step));
        // Natural scrolling: fingers moving up scroll the page down.
        const action = (deltaY < 0) === prefs.naturalScroll ? "mouseScrollDown" : "mouseScrollUp";
        for (let i = 0; i < notches; i++) queueMouseAction(action);
        gesture.lastCenter.y += Math.sign(deltaY) * notches * step;
      }
    }
    e.preventDefault();
    return;
  }
  if (!lastPadPoint) return;
  const dx = e.clientX - lastPadPoint.x;
  const dy = e.clientY - lastPadPoint.y;
  if (padDown?.pointerId === e.pointerId) {
    const travelled = Math.hypot(e.clientX - padDown.x, e.clientY - padDown.y);
    if (padDown.dragCandidate && !padDown.dragging && travelled > 3)
      beginPadDrag(e.pointerId);
    if (travelled > 12) {
      padDown.moved = true;
      clearLongPress();
    }
  }
  pendingMouse.dx += Math.round(dx * 2.2 * prefs.mouseSpeed);
  pendingMouse.dy += Math.round(dy * 2.2 * prefs.mouseSpeed);
  lastPadPoint = { x: e.clientX, y: e.clientY };
  if (!mouseMoveTimer) mouseMoveTimer = setTimeout(flushMouseMove, 75);
  e.preventDefault();
});
function endPad(e, cancelled = false) {
  if (padDown?.pointerId === e.pointerId) {
    clearLongPress();
    clearTimeout(dragHoldTimer);
    dragHoldTimer = null;
    if (padDown.dragging) endDrag();
    else if (!cancelled && !dragging && !padDown.moved && !padDown.longPressed && suppressNextTapPointerId !== e.pointerId)
      queuePadTap({ x: e.clientX, y: e.clientY });
    padDown = null;
  }
  if (suppressNextTapPointerId === e.pointerId) suppressNextTapPointerId = null;
  padPointers.delete(e.pointerId);
  if (pad.hasPointerCapture(e.pointerId)) pad.releasePointerCapture(e.pointerId);
  if (padPointers.size === 1) {
    lastPadPoint = [...padPointers.values()][0];
    gesture = null;
  } else if (!padPointers.size) {
    padActive = false;
    lastPadPoint = null;
    gesture = null;
  }
}
$("#mouse-drag-toggle").addEventListener("click", () => {
  if (dragging) endDrag();
  else {
    dragLock = true;
    startDrag();
  }
});
pad.addEventListener("pointerup", (e) => endPad(e));
pad.addEventListener("pointercancel", (e) => endPad(e, true));
