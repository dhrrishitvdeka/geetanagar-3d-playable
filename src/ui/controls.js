import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { $, camera, canvas, stage } from '../core/context.js';
import { CX0, CX1, CY0, CY1, GEO, HG, HGX1, HGY1, P, VP, clsAt, hAt } from '../core/geo.js';
import { toggleMap } from './minimap.js';
import { deckBlocked, groundAt } from '../world/deck.js';
import { footRaise } from '../world/road/footpath.js';
import { blockedBySeg } from '../world/geom.js';
import { hatigarh } from '../world/mainroad.js';
import { movePlanar } from '../game/core/movement.js';

// ---------- camera modes ----------
const orbit = new OrbitControls(camera, canvas);
orbit.enableDamping = true; orbit.dampingFactor = 0.08; orbit.maxPolarAngle = Math.PI * 0.49; orbit.minDistance = 15; orbit.maxDistance = 2400;
const CENTER = P((CX0 + CX1) / 2, (CY0 + CY1) / 2, 0);
let mode = 'orbit';
const player = { x: 0, y: -20, yaw: 0, pitch: 0, vz: 0, eye: 1.62 };
const SPOTS = {
  viewpoint: { x: 78.0, y: 197.6, yaw: Math.PI, pitch: -0.08 }, // on the terrace, by the south railing (Maps pin 26.1752971, 91.7907812)
  mandir: { x: 49.5, y: -44.5, yaw: 0.05, pitch: 0.12 },
  field: { x: (GEO.field[0] + GEO.field[2]) / 2, y: GEO.field[1] + 7, yaw: 0.15 },
  fss: { x: GEO.fss[0] - 8, y: GEO.fss[1] - 25, yaw: 0.2 },
  railway: { x: -500.8, y: 68.7, yaw: 0 }, // sampled Railway Colony Road centreline
  karbi: { x: -606.8, y: 117.6, yaw: -Math.PI / 2 }, // sampled Karbi Path centreline
  talukdar: { x: -642.2, y: 242.2, yaw: -0.6 }, // sampled Talukdar Road centreline
  hatigarh: (() => { const l = GEO.labels.find(l => l.t === 'Hatigarh Chariali'); return { x: l.x + 18, y: l.y + 2, yaw: Math.PI / 2 }; })(),
  park: { x: -118.6, y: -73.5, yaw: Math.PI + 0.35, pitch: -0.02 }, // forecourt by the road, looking SSE at the gate and sheds (as Street View pano kEM0kEBZ4oUXOCakZBgK1g)
  sbi: (() => { const l = GEO.labels.find(l => l.t === 'SBI Branch Gitanagar'); return { x: l.x - 14, y: l.y + 8, yaw: -Math.PI / 2 }; })(),
};
function findOpen(x, y) { // nudge a spawn point off buildings
  for (let r = 0; r < 40; r += 1) for (let a = 0; a < 6.28; a += 0.4) { const px = x + Math.cos(a) * r, py = y + Math.sin(a) * r; if (walkable(px, py)) return [px, py]; }
  return [x, y];
}
const WR = 0.35; // body radius: the five samples are centre, east, west, north, south (unrolled: this runs for every NPC/animal step)
function walkable(x, y) {
  let c = clsAt(x, y); if (c === 2 || c === 3) return false;
  c = clsAt(x + WR, y); if (c === 2 || c === 3) return false;
  c = clsAt(x - WR, y); if (c === 2 || c === 3) return false;
  c = clsAt(x, y + WR); if (c === 2 || c === 3) return false;
  c = clsAt(x, y - WR); if (c === 2 || c === 3) return false;
  if (blockedBySeg(x, y)) return false;
  return x > HG.x0 + 5 && x < HGX1 - 5 && y > HG.y0 + 5 && y < HGY1 - 5;
}
function enterWalk(spot) {
  const s = SPOTS[spot] || SPOTS.field;
  if (spot === 'viewpoint') { player.x = s.x; player.y = s.y; } else [player.x, player.y] = findOpen(s.x, s.y); player.yaw = s.yaw; player.pitch = s.pitch != null ? s.pitch : 0.04;
  mode = 'walk'; orbit.enabled = false; stage.classList.add('walking');
  $('btn-walk').setAttribute('aria-pressed', 'true'); $('btn-orbit').setAttribute('aria-pressed', 'false');
  $('walkhint').hidden = false; camera.fov = 70; camera.updateProjectionMatrix();
}
function enterOrbit() {
  mode = 'orbit'; orbit.enabled = true; stage.classList.remove('walking');
  if (document.pointerLockElement) document.exitPointerLock();
  $('btn-walk').setAttribute('aria-pressed', 'false'); $('btn-orbit').setAttribute('aria-pressed', 'true');
  $('walkhint').hidden = true; camera.fov = 50; camera.updateProjectionMatrix();
  const t = P(player.x, player.y, hAt(player.x, player.y));
  orbit.target.copy(t); camera.position.set(t.x + 160, t.y + 190, t.z + 230);
}

// input
let lookGate = null; // the game sets this so menus and dialogue don't grab the pointer; null (the explorer) always allows
function setLookGate(fn) { lookGate = fn; }
const keys = new Set();
addEventListener('keydown', e => {
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
  keys.add(e.code);
  if (mode === 'walk' && ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) e.preventDefault();
  if (e.code === 'KeyM') toggleMap();
});
addEventListener('keyup', e => keys.delete(e.code));
addEventListener('blur', () => keys.clear());
canvas.addEventListener('click', () => {
  if (mode !== 'walk' || matchMedia('(pointer: coarse)').matches || (lookGate && !lookGate())) return;
  try { const p = canvas.requestPointerLock && canvas.requestPointerLock(); if (p && p.catch) p.catch(() => {}); } catch (e) {}
});
document.addEventListener('pointerlockchange', () => { $('walkhint').classList.toggle('locked', document.pointerLockElement === canvas); });
document.addEventListener('mousemove', e => {
  if (mode !== 'walk' || document.pointerLockElement !== canvas || (lookGate && !lookGate())) return;
  player.yaw -= e.movementX * 0.0022; player.pitch = Math.max(-1.3, Math.min(1.3, player.pitch - e.movementY * 0.0022));
});
// drag to look (touch, or when pointer lock is unavailable)
let drag = null;
canvas.addEventListener('pointerdown', e => { if (mode === 'walk' && document.pointerLockElement !== canvas && !(lookGate && !lookGate())) { drag = { id: e.pointerId, x: e.clientX, y: e.clientY }; canvas.setPointerCapture(e.pointerId); } });
canvas.addEventListener('pointermove', e => {
  if (!drag || e.pointerId !== drag.id) return;
  player.yaw -= (e.clientX - drag.x) * 0.005; player.pitch = Math.max(-1.3, Math.min(1.3, player.pitch - (e.clientY - drag.y) * 0.005));
  drag.x = e.clientX; drag.y = e.clientY;
});
const endDrag = e => { if (drag && e.pointerId === drag.id) drag = null; };
canvas.addEventListener('pointerup', endDrag); canvas.addEventListener('pointercancel', endDrag);
// on-screen joystick
const joy = $('joy'), knob = $('knob'); const stick = { x: 0, y: 0, id: null };
joy.addEventListener('pointerdown', e => { stick.id = e.pointerId; joy.setPointerCapture(e.pointerId); moveStick(e); });
joy.addEventListener('pointermove', e => { if (e.pointerId === stick.id) moveStick(e); });
const endStick = e => { if (e.pointerId === stick.id) { stick.id = null; stick.x = stick.y = 0; knob.style.transform = ''; } };
joy.addEventListener('pointerup', endStick); joy.addEventListener('pointercancel', endStick);
function moveStick(e) {
  const r = joy.getBoundingClientRect(), cx = r.left + r.width / 2, cy = r.top + r.height / 2, R = r.width / 2;
  let dx = (e.clientX - cx) / R, dy = (e.clientY - cy) / R; const m = Math.hypot(dx, dy); if (m > 1) { dx /= m; dy /= m; }
  stick.x = dx; stick.y = dy; knob.style.transform = `translate(${dx * R * 0.6}px, ${dy * R * 0.6}px)`;
}
let runToggle = false;
$('btn-run').addEventListener('click', () => { runToggle = !runToggle; $('btn-run').setAttribute('aria-pressed', String(runToggle)); });

function stepWalk(dt) {
  let f = 0, s = 0;
  if (keys.has('KeyW') || keys.has('ArrowUp')) f += 1;
  if (keys.has('KeyS') || keys.has('ArrowDown')) f -= 1;
  if (keys.has('KeyA')) s -= 1; if (keys.has('KeyD')) s += 1;
  if (keys.has('ArrowLeft')) player.yaw += dt * 1.8; if (keys.has('ArrowRight')) player.yaw -= dt * 1.8;
  f -= stick.y; s += stick.x;
  const m = Math.hypot(f, s); if (m > 1) { f /= m; s /= m; }
  const speed = (keys.has('ShiftLeft') || keys.has('ShiftRight') || runToggle) ? 9 : 3.4;
  const fx = -Math.sin(player.yaw), fy = Math.cos(player.yaw); // yaw 0 = facing north
  const rx = Math.cos(player.yaw), ry = Math.sin(player.yaw);
  const dx = (fx * f + rx * s) * speed * dt, dy = (fy * f + ry * s) * speed * dt;
  // move with wall sliding; steep ground also slows you down
  const tryMove = (nx, ny, ox, oy) => { const h0 = groundAt(ox, oy); if (!walkable(nx, ny) || deckBlocked(nx, ny, h0)) return false; const dr = footRaise(nx, ny) - footRaise(ox, oy), dh = groundAt(nx, ny) - h0 - dr, dist = Math.hypot(nx - ox, ny - oy) || 1; return dr <= 0.45 && dh / dist < 1.2; }; // a kerb up to 0.45 m is a step; the slope test ignores it
  movePlanar(player, dx, dy, tryMove);
  const moving = m > 0.05;
  bob = moving ? bob + dt * speed * 2.2 : bob * 0.9;
  const gy = groundAt(player.x, player.y) + player.eye + Math.sin(bob) * (moving ? 0.035 : 0);
  camera.position.set(player.x, gy, -player.y);
  const cp = Math.cos(player.pitch);
  camera.lookAt(player.x - Math.sin(player.yaw) * cp, gy + Math.sin(player.pitch), -(player.y + Math.cos(player.yaw) * cp));
}
let bob = 0;

export { findOpen, walkable, enterWalk, enterOrbit, moveStick, stepWalk, orbit, CENTER, mode, player, SPOTS, keys, drag, endDrag, joy, knob, endStick, runToggle, bob, stick, setLookGate };
