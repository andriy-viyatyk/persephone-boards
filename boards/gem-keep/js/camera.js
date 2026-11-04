// Camera controls: orbit around a ground target.
// - Mouse wheel / pinch: zoom.
// - Left drag, pen drag, one-finger drag: rotate around the target.
// - Right or middle drag, pen barrel button, Shift+drag, two-finger drag: pan.
// - Keyboard: W/A/S/D or arrows pan, Q/E rotate, +/- zoom.
// A press that moves less than CLICK_SLOP pixels is reported as a click (onTap).
import * as THREE from "../lib/three.module.min.js";

const CLICK_SLOP = 6;           // pixels a press may move and still count as a tap
const ROTATE_SPEED = 0.006;     // radians per pixel
const ZOOM_STEP = 0.0012;       // fraction of distance per wheel delta unit
const MIN_DISTANCE = 5, MAX_DISTANCE = 42;
const MIN_PITCH = 0.32, MAX_PITCH = 1.45;  // radians above the ground
const KEY_PAN_SPEED = 0.9;      // distance-scaled units per second
const KEY_ROTATE_SPEED = 1.6;   // radians per second
const SMOOTHING = 12;           // higher = snappier camera follow

export function createCameraControls(camera, element, { onTap, onHover, bounds }) {
  const goal = { yaw: 0.6, pitch: 0.95, distance: 18, target: new THREE.Vector3() };
  const now = { yaw: goal.yaw, pitch: goal.pitch, distance: goal.distance, target: new THREE.Vector3() };
  const pointers = new Map();
  let drag = null;
  const keys = new Set();

  function clampGoal() {
    goal.pitch = Math.min(MAX_PITCH, Math.max(MIN_PITCH, goal.pitch));
    goal.distance = Math.min(MAX_DISTANCE, Math.max(MIN_DISTANCE, goal.distance));
    goal.target.x = Math.min(bounds.x, Math.max(-bounds.x, goal.target.x));
    goal.target.z = Math.min(bounds.z, Math.max(-bounds.z, goal.target.z));
  }

  function pan(dxPixels, dyPixels) {
    const scale = goal.distance / element.clientHeight * 1.1;
    const sin = Math.sin(goal.yaw), cos = Math.cos(goal.yaw);
    // Screen right is (cos, -sin) on the ground; screen up is away from the camera (-sin, -cos).
    goal.target.x -= (dxPixels * cos + dyPixels * sin) * scale;
    goal.target.z -= (-dxPixels * sin + dyPixels * cos) * scale;
    clampGoal();
  }

  function modeFor(event) {
    if (event.pointerType === "touch") return pointers.size >= 2 ? "pinch" : "rotate";
    // buttons: 1 = primary/pen tip, 2 = right/pen barrel, 4 = middle, 32 = pen eraser.
    if (event.buttons & 2 || event.buttons & 4 || event.buttons & 32 || event.shiftKey) return "pan";
    return "rotate";
  }

  element.addEventListener("contextmenu", (event) => event.preventDefault());
  element.addEventListener("pointerdown", (event) => {
    element.setPointerCapture(event.pointerId);
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    const pinch = pointers.size === 2 ? pinchState() : null;
    drag = { mode: modeFor(event), startX: event.clientX, startY: event.clientY, x: event.clientX, y: event.clientY, moved: pointers.size > 1, button: event.button, pinch };
  });
  element.addEventListener("pointermove", (event) => {
    if (!pointers.has(event.pointerId)) { onHover?.(event); return; }
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (!drag) return;
    if (drag.mode === "pinch" || pointers.size === 2) {
      const next = pinchState();
      if (drag.pinch && next) {
        goal.distance *= drag.pinch.span / Math.max(1, next.span);
        pan(next.x - drag.pinch.x, next.y - drag.pinch.y);
      }
      drag.pinch = next; drag.mode = "pinch"; drag.moved = true;
      clampGoal();
      return;
    }
    const dx = event.clientX - drag.x, dy = event.clientY - drag.y;
    drag.x = event.clientX; drag.y = event.clientY;
    if (!drag.moved && Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) < CLICK_SLOP) return;
    drag.moved = true;
    if (drag.mode === "pan") pan(dx, dy);
    else { goal.yaw -= dx * ROTATE_SPEED; goal.pitch += dy * ROTATE_SPEED; clampGoal(); }
  });
  const release = (event) => {
    if (!pointers.has(event.pointerId)) return;
    pointers.delete(event.pointerId);
    if (drag && !drag.moved && event.type === "pointerup" && drag.button === 0 && pointers.size === 0) onTap?.(event);
    if (pointers.size === 0) drag = null;
    else if (drag) { drag.pinch = null; drag.moved = true; }
  };
  element.addEventListener("pointerup", release);
  element.addEventListener("pointercancel", release);
  element.addEventListener("wheel", (event) => {
    event.preventDefault();
    goal.distance *= Math.exp(event.deltaY * ZOOM_STEP * (event.deltaMode === 1 ? 30 : 1));
    clampGoal();
  }, { passive: false });

  function pinchState() {
    const [a, b] = [...pointers.values()];
    return a && b ? { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, span: Math.hypot(a.x - b.x, a.y - b.y) } : null;
  }

  window.addEventListener("keydown", (event) => { if (!event.target.closest?.("input, textarea")) keys.add(event.key.toLowerCase()); });
  window.addEventListener("keyup", (event) => keys.delete(event.key.toLowerCase()));
  window.addEventListener("blur", () => keys.clear());

  function update(dt) {
    // In pixels, because pan() takes a pixel drag: KEY_PAN_SPEED * distance world units per second.
    const panStep = KEY_PAN_SPEED * dt * element.clientHeight / 1.1;
    if (keys.has("w") || keys.has("arrowup")) pan(0, panStep);
    if (keys.has("s") || keys.has("arrowdown")) pan(0, -panStep);
    if (keys.has("a") || keys.has("arrowleft")) pan(panStep, 0);
    if (keys.has("d") || keys.has("arrowright")) pan(-panStep, 0);
    if (keys.has("q")) goal.yaw += KEY_ROTATE_SPEED * dt;
    if (keys.has("e")) goal.yaw -= KEY_ROTATE_SPEED * dt;
    if (keys.has("+") || keys.has("=")) { goal.distance *= 1 - dt; clampGoal(); }
    if (keys.has("-")) { goal.distance *= 1 + dt; clampGoal(); }
    const k = 1 - Math.exp(-SMOOTHING * dt);
    now.yaw += (goal.yaw - now.yaw) * k;
    now.pitch += (goal.pitch - now.pitch) * k;
    now.distance += (goal.distance - now.distance) * k;
    now.target.lerp(goal.target, k);
    const flat = Math.cos(now.pitch) * now.distance;
    camera.position.set(now.target.x + Math.sin(now.yaw) * flat, now.target.y + Math.sin(now.pitch) * now.distance, now.target.z + Math.cos(now.yaw) * flat);
    camera.lookAt(now.target);
  }

  function reset({ yaw = 0.6, pitch = 0.95, distance = 18 } = {}) {
    Object.assign(goal, { yaw, pitch, distance }); goal.target.set(0, 0, 0);
    Object.assign(now, { yaw, pitch, distance }); now.target.set(0, 0, 0);
    update(0);
  }

  return { update, reset, get state() { return goal; } };
}
