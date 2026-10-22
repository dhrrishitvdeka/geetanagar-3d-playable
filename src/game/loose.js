import * as THREE from 'three';
import { scene } from '../core/context.js';
import { findOpen, walkable } from '../ui/controls.js';
import { groundAt } from '../world/deck.js';
import { MAINP, NRM, asphHalf, hw, nearestOnMain } from '../world/mainroad.js';
import { beside } from '../world/streetlife.js';
import { sfx } from './audio.js';
import { on } from './core/bus.js';
import { register } from './interact.js';
import { allNPCs } from './npc/agents.js';
import { playEmote } from './player.js';

// ---------- loose objects: things on the ground that anyone can knock about ----------
// A rubber ball at the Children's Park (the kids there kick it to each other, see 'play' in npc/agents.js) and tin cans and plastic
// bottles dropped by the stalls. Walking or running into one shoves it; a standing can or bottle tips over first and then rolls
// like a cylinder does: across its axis, never along it. One InstancedMesh per kind (3 draw calls). Only objects within AWAKE m of
// the player are simulated; the rest sleep where they lie. Reset to where they started on every game:start.
const AWAKE = 60, BODY_R = 0.24, G = 9.8;
const KINDS = {
  ball: { r: 0.09, h: 0.18, bounce: 0.6, roll: 0.35, push: 1.35, sound: 'kick', pitch: 1.8, vol: 0.45 },
  can: { r: 0.033, h: 0.12, bounce: 0.25, roll: 1.6, push: 1.1, sound: 'clank', pitch: 1, vol: 0.5 },
  bottle: { r: 0.036, h: 0.24, bounce: 0.3, roll: 1.1, push: 0.9, sound: 'kick', pitch: 2.6, vol: 0.3 },
};
const OBJ = [], MESH = {};
const _q = new THREE.Quaternion(), _qy = new THREE.Quaternion(), _qz = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), -Math.PI / 2);
const _ax = new THREE.Vector3(), _m = new THREE.Matrix4(), _p = new THREE.Vector3(), _s = new THREE.Vector3(1, 1, 1), UP = new THREE.Vector3(0, 1, 0), XA = new THREE.Vector3(1, 0, 0);
const rnd = (a, b) => a + Math.random() * (b - a);
let inited = false;

// ---------- where they lie ----------
function scatter(kind, x, y, n, spread) {
  for (let k = 0; k < n; k++) {
    let px = x + rnd(-spread, spread), py = y + rnd(-spread, spread); if (!walkable(px, py)) [px, py] = findOpen(px, py);
    const down = kind !== 'ball' && Math.random() < 0.5; // half of them already lie on their side
    OBJ.push({ kind, k: KINDS[kind], i: 0, x0: px, y0: py, down0: down, ax0: rnd(0, 6.28), x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, down, ax: 0, roll: 0, q: new THREE.Quaternion(), hitCd: 0, dirty: true });
  }
}
function layout() {
  scatter('ball', -108, -98, 1, 1); // Children's Park, by the kids' play spot
  const kiosk = kx => { const [, i] = nearestOnMain(kx, -50), s = NRM[i][1] > 0 ? 1 : -1, off = hw(i) + 2.4; return [MAINP[i][0] + NRM[i][0] * s * off, MAINP[i][1] + NRM[i][1] * s * off]; };
  for (const kx of [24, 31, -44, -37]) { const [x, y] = kiosk(kx); scatter('can', x, y, 1, 1.2); scatter('bottle', x, y, 1, 1.4); }
  try { const [, i] = nearestOnMain(-121, -70), b = beside(-121, -1, asphHalf(i) + 2.6); scatter('can', b[0], b[1], 2, 1.5); scatter('bottle', b[0], b[1], 2, 1.5); } catch (e) { /* forecourt helpers missing */ }
  scatter('can', -486, -52, 3, 3); scatter('bottle', -486, -48, 3, 4); // Hatigarh stall row
  scatter('bottle', -57, -72, 2, 2); // bus stand
}
function reset(o) {
  o.x = o.x0; o.y = o.y0; o.down = o.down0; o.ax = o.ax0; o.roll = 0; o.vx = o.vy = o.vz = 0; o.q.identity(); o.z = groundAt(o.x, o.y) + (o.down ? o.k.r : 0); o.dirty = true;
}

// ---------- drawing ----------
function build() {
  const ball = new THREE.SphereGeometry(KINDS.ball.r, 12, 8), bc = ball.attributes.position, col = new Float32Array(bc.count * 3);
  for (let i = 0; i < bc.count; i++) { const red = (Math.atan2(bc.getZ(i), bc.getX(i)) + Math.PI) % (Math.PI / 2) < Math.PI / 4; col.set(red ? [0.85, 0.16, 0.12] : [0.98, 0.82, 0.18], i * 3); } // quartered red and yellow, so the spin shows
  ball.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const can = new THREE.CylinderGeometry(KINDS.can.r, KINDS.can.r, KINDS.can.h, 10);
  const bottle = new THREE.CylinderGeometry(KINDS.bottle.r * 0.45, KINDS.bottle.r, KINDS.bottle.h, 8);
  const mats = { ball: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55 }), can: new THREE.MeshStandardMaterial({ color: '#b8bcc2', roughness: 0.35, metalness: 0.7 }),
    bottle: new THREE.MeshStandardMaterial({ color: '#9fd3e6', roughness: 0.2, transparent: true, opacity: 0.75 }) };
  const geos = { ball, can, bottle };
  for (const kind in KINDS) {
    const list = OBJ.filter(o => o.kind === kind); if (!list.length) continue;
    const m = new THREE.InstancedMesh(geos[kind], mats[kind], list.length); m.userData.noMerge = true; m.castShadow = kind === 'ball'; m.frustumCulled = false; m.name = 'loose_' + kind;
    list.forEach((o, i) => { o.i = i; }); MESH[kind] = m; scene.add(m);
  }
}
function draw(o) {
  const m = MESH[o.kind]; if (!m) return;
  if (o.kind === 'ball') { _p.set(o.x, o.z, -o.y); _m.compose(_p, o.q, _s); }
  else if (!o.down) { _p.set(o.x, o.z + o.k.h / 2, -o.y); _m.compose(_p, _q.identity(), _s); }
  else { // lying: the cylinder's y axis turned onto local x, spun about it by the roll, then turned to face ax
    _qy.setFromAxisAngle(UP, o.ax); _q.setFromAxisAngle(XA, o.roll).multiply(_qz); _q.premultiply(_qy);
    _p.set(o.x, o.z, -o.y); _m.compose(_p, _q, _s);
  }
  m.setMatrixAt(o.i, _m); m.instanceMatrix.needsUpdate = true; o.dirty = false;
}

// ---------- physics ----------
// shove o away from a body at (bx, by) moving at speed sp; a standing can or bottle falls over in the direction it was hit
function hit(o, bx, by, sp) {
  const dx = o.x - bx, dy = o.y - by, d = Math.hypot(dx, dy), rr = BODY_R + o.k.r; if (d >= rr || d < 1e-4) return;
  const nx = dx / d, ny = dy / d, px = bx + nx * rr, py = by + ny * rr; if (walkable(px, py)) { o.x = px; o.y = py; }
  if (sp < 0.3) return; // standing still against it only nudges it out of the way
  const want = sp * o.k.push + 0.4, along = o.vx * nx + o.vy * ny;
  if (along < want) { o.vx += nx * (want - along); o.vy += ny * (want - along); }
  if (!o.down) { o.down = true; o.ax = Math.atan2(ny, nx) + Math.PI / 2; o.z = groundAt(o.x, o.y) + o.k.r; } // falls away from the hit, axis across it
  if (sp > 1.2) o.vz = Math.min(2.5, sp * 0.35);
  if (o.hitCd <= 0) { sfx(o.k.sound, { x: o.x, y: o.y, pitch: o.k.pitch, vol: o.k.vol * Math.min(1, sp / 3) }); o.hitCd = 0.25; }
}
function step(o, dt) {
  if (o.hitCd > 0) o.hitCd -= dt;
  const k = o.k, rest = o.kind === 'ball' || o.down ? k.r : 0;
  let sp = Math.hypot(o.vx, o.vy); const gz0 = groundAt(o.x, o.y) + rest;
  if (sp < 0.02 && o.vz === 0 && o.z <= gz0 + 0.005) { if (o.vx || o.vy) { o.vx = o.vy = 0; } if (Math.abs(o.z - gz0) > 1e-3) { o.z = gz0; o.dirty = true; } return; }
  if (o.down) { // a lying cylinder rolls across its axis; any slide along the axis dies fast
    const cx = Math.cos(o.ax), cy = Math.sin(o.ax), along = o.vx * cx + o.vy * cy, decay = Math.exp(-8 * dt);
    o.vx -= cx * along * (1 - decay); o.vy -= cy * along * (1 - decay);
  }
  const ox = o.x, oy = o.y;
  o.vz -= G * dt; o.z += o.vz * dt; const gz = groundAt(o.x, o.y) + rest;
  if (o.z <= gz) { o.z = gz; o.vz = o.vz < -1 ? -o.vz * k.bounce : 0; }
  const nx = o.x + o.vx * dt, ny = o.y + o.vy * dt;
  if (walkable(nx, ny)) { o.x = nx; o.y = ny; } else if (walkable(nx, o.y)) { o.x = nx; o.vy *= -0.4; } else if (walkable(o.x, ny)) { o.y = ny; o.vx *= -0.4; } else { o.vx *= -0.4; o.vy *= -0.4; }
  if (o.z <= gz + 0.01) { sp = Math.hypot(o.vx, o.vy); if (sp > 0) { const ns = Math.max(0, sp - (k.roll + 0.25 * sp) * dt) / sp; o.vx *= ns; o.vy *= ns; } }
  const mx = o.x - ox, my = o.y - oy, md = Math.hypot(mx, my);
  if (md > 1e-5) {
    if (o.kind === 'ball') { _ax.set(-my, 0, -mx).normalize(); o.q.premultiply(_q.setFromAxisAngle(_ax, md / k.r)); }
    else if (o.down) o.roll += (mx * -Math.sin(o.ax) + my * Math.cos(o.ax)) / k.r; // signed distance across the axis
  }
  o.dirty = true;
}

// ---------- the player kicks the park ball on purpose ----------
let kickIn = 0, kickO = null;
function kickLoose(o, ang, v, lift) { o.vx = Math.cos(ang) * v; o.vy = Math.sin(ang) * v; o.vz = lift; sfx(o.k.sound, { x: o.x, y: o.y, pitch: o.k.pitch, vol: o.k.vol }); }
function registerBall(o) {
  const pos = [0, 0, 0];
  register({ id: 'loose:' + OBJ.indexOf(o), pos: () => { pos[0] = o.x; pos[1] = o.y; pos[2] = o.z; return pos; }, r: 1.4, kind: 'ball', label: () => 'Kick the ball',
    onInteract: () => { if (kickIn > 0) return; kickIn = 0.2; kickO = o; playEmote('kick', 0.5); } });
}

// ---------- public API ----------
function initLoose() {
  if (inited) return; inited = true;
  layout(); for (const o of OBJ) reset(o); build(); for (const o of OBJ) draw(o);
  for (const o of OBJ) if (o.kind === 'ball') registerBall(o);
  on('game:start', () => { for (const o of OBJ) { reset(o); draw(o); } });
}
function updateLoose(dt, p) {
  if (!inited || !p) return;
  if (kickIn > 0 && (kickIn -= dt) <= 0 && kickO && Math.hypot(kickO.x - p.x, kickO.y - p.y) < 1.6) kickLoose(kickO, p.heading || 0, 7, 2.2);
  const npcs = allNPCs(), pz = p.z || 0;
  for (const o of OBJ) {
    const dx = o.x - p.x, dy = o.y - p.y; if (dx * dx + dy * dy > AWAKE * AWAKE) continue;
    if (!p.seated && o.z - pz < 0.7) hit(o, p.riding ? p.riding.x : p.x, p.riding ? p.riding.y : p.y, p.speed || 0);
    for (let i = 0; i < npcs.length; i++) { const n = npcs[i]; if (n.dead || Math.abs(n.x - o.x) > 0.5 || Math.abs(n.y - o.y) > 0.5) continue; hit(o, n.x, n.y, n.speed); }
    step(o, Math.min(dt, 0.05)); if (o.dirty) draw(o);
  }
}
// nearest loose object of a kind within r of (x, y), or null (the park kids use it to find their ball)
function nearLoose(kind, x, y, r) { let best = null, bd = r * r; for (const o of OBJ) { if (o.kind !== kind) continue; const d = (o.x - x) ** 2 + (o.y - y) ** 2; if (d < bd) { bd = d; best = o; } } return best; }

export { initLoose, updateLoose, nearLoose, kickLoose };
