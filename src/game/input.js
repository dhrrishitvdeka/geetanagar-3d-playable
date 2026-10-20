import { canvas } from '../core/context.js';
import { stick } from '../ui/controls.js';
import { on } from './core/bus.js';
import { toast } from './hud.js';

// ---------- input: keys, touch buttons and the joystick folded into one action map ----------
// Actions: forward back left right sprint crouch jump interact map journal inventory pause photo camera help
const MAP = {
  KeyW: 'forward', ArrowUp: 'forward', KeyS: 'back', ArrowDown: 'back', KeyA: 'left', ArrowLeft: 'left', KeyD: 'right', ArrowRight: 'right',
  ShiftLeft: 'sprint', ShiftRight: 'sprint', KeyC: 'crouch', ControlLeft: 'crouch', Space: 'jump', KeyE: 'interact', KeyF: 'interact', KeyM: 'map', KeyJ: 'journal',
  KeyI: 'inventory', Tab: 'inventory', Escape: 'pause', KeyP: 'photo', KeyV: 'camera', KeyH: 'help',
};
const held = new Set();           // sources currently down: key codes and 'touch:<action>'
const count = Object.create(null); // action -> number of sources holding it (W and ArrowUp both mean forward)
const hit = new Set();            // actions pressed since the last endFrame()
const AX = { x: 0, y: 0 };
let wheelAcc = 0, capture = false, gate = null, lockToastAt = 0;

const typing = t => !!t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
function press(src, action, gated) {
  if (held.has(src)) return;
  held.add(src); count[action] = (count[action] || 0) + 1;
  if (count[action] === 1 && !gated) hit.add(action);
}
function release(src, action) {
  if (!held.delete(src)) return;
  count[action] = Math.max(0, (count[action] || 1) - 1);
}
function clearAll() { held.clear(); hit.clear(); for (const k in count) count[k] = 0; wheelAcc = 0; }

function initInput() {
  addEventListener('keydown', e => {
    if (typing(e.target)) return;
    const a = MAP[e.code]; if (!a) return;
    // keep the page from scrolling or tabbing away while the game has the keyboard; buttons keep their own Space/Enter
    if (capture && (e.code === 'Tab' || e.code.startsWith('Arrow') || (e.code === 'Space' && !(e.target && /^(BUTTON|A|SUMMARY)$/.test(e.target.tagName))))) e.preventDefault();
    if (e.repeat) return;
    // while a modal is open the key is still tracked as held (so releasing it works) but never counts as a press
    press(e.code, a, !!gate && gate());
  });
  // capture phase and registered before the HUD's own listeners, so a key released under a modal can't stay stuck
  addEventListener('keyup', e => { const a = MAP[e.code]; if (a) release(e.code, a); }, true);
  addEventListener('blur', clearAll);
  document.addEventListener('visibilitychange', () => { if (document.hidden) clearAll(); });
  canvas.addEventListener('wheel', e => {
    e.preventDefault();
    wheelAcc += e.deltaY * (e.deltaMode === 1 ? 33 : e.deltaMode === 2 ? 400 : 1);
  }, { passive: false });
  // HUD touch buttons send the same thing a key would
  on('input:action', ({ action, down }) => { if (down) press('touch:' + action, action); else release('touch:' + action, action); });
}
function setInputGate(fn) { gate = fn; }
function resetPresses() { hit.clear(); }
// ask for the mouse; must run inside a click or key gesture. Says so if the browser refuses.
function requestLock() {
  if (matchMedia('(pointer: coarse)').matches) return;
  const failed = () => { const now = performance.now(); if (now - lockToastAt > 5000) { lockToastAt = now; try { toast('Click the view to look around'); } catch (e) { /* hud not ready */ } } };
  try { const p = canvas.requestPointerLock && canvas.requestPointerLock(); if (p && p.catch) p.catch(failed); } catch (e) { failed(); }
}
// main turns this on once play starts, so Tab still moves focus around the title menu
function setKeysCaptured(on) { capture = !!on; }

const isDown = a => (count[a] || 0) > 0;
const pressed = a => hit.has(a);
function axis() { // x = strafe right, y = forward; stick.y is screen-down so forward is -stick.y
  let x = (isDown('right') ? 1 : 0) - (isDown('left') ? 1 : 0) + stick.x;
  let y = (isDown('forward') ? 1 : 0) - (isDown('back') ? 1 : 0) - stick.y;
  const m = Math.hypot(x, y); if (m > 1) { x /= m; y /= m; }
  AX.x = x; AX.y = y; return AX;
}
function wheel() { const w = wheelAcc; wheelAcc = 0; return w; }
function endFrame() { hit.clear(); }

export { initInput, isDown, pressed, axis, wheel, endFrame, setKeysCaptured, setInputGate, resetPresses, requestLock };
