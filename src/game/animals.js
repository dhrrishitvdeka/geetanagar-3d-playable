import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { scene } from '../core/context.js';
import { GEO } from '../core/geo.js';
import { QUALITY } from '../render/quality.js';
import { walkable } from '../ui/controls.js';
import { groundAt, inDeck } from '../world/deck.js';
import { normalsOf, resample } from '../world/geom.js';
import { MAINP, NRM, asphHalf } from '../world/mainroad.js';
import { beside } from '../world/streetlife.js';
import { emit, on } from './core/bus.js';
import { hasItem, removeItem } from './core/state.js';
import { sfx } from './audio.js';
import { bubble, toast } from './hud.js';
import { register } from './interact.js';

// ---------- street animals: dogs (and Pori), cows, goats, crows ----------
// Rigid parts are instanced per species (body / head / tail), legs are one shared mesh for every four-legged animal, crows are body + wings.
// A shared material picks each vertex's colour: fixed, the animal's coat (instanceColor), a second patch colour or a trim colour (collar).
const CFG = QUALITY === 'low' ? { dogs: 2, cows: 2, herds: [3], flocks: [4] } : QUALITY === 'high' ? { dogs: 5, cows: 3, herds: [3, 3], flocks: [5, 4] } : { dogs: 3, cows: 2, herds: [2, 2], flocks: [4, 4] };
const SHADOWS = QUALITY !== 'low';
const SLEEP = 150, SHOW = 200;
const rand = (a, b) => a + Math.random() * (b - a);
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const angd = (a, b) => { const d = a - b; return Math.atan2(Math.sin(d), Math.cos(d)); };
const ok = (x, y) => walkable(x, y) && !inDeck(x, y, 2);

// ---------- geometry ----------
const _col = new THREE.Color();
function pc(out, geo, mk, color, x, y, z, rx = 0, ry = 0, rz = 0) { // mk: 0 fixed colour, 1 coat, 2 patch colour, 3 trim colour
  const g = geo.index ? geo.toNonIndexed() : geo; g.deleteAttribute('uv');
  g.rotateZ(rz); g.rotateY(ry); g.rotateX(rx); g.translate(x, y, z);
  const n = g.attributes.position.count, c = new Float32Array(n * 3), m = new Float32Array(n).fill(mk); _col.set(color);
  for (let i = 0; i < n; i++) { c[i * 3] = _col.r; c[i * 3 + 1] = _col.g; c[i * 3 + 2] = _col.b; }
  g.setAttribute('color', new THREE.BufferAttribute(c, 3)); g.setAttribute('mk', new THREE.BufferAttribute(m, 1)); out.push(g);
}
const bx = (w, h, d) => new THREE.BoxGeometry(w, h, d);
const ball = (r, sx, sy, sz) => { const g = new THREE.SphereGeometry(r, 6, 4); g.scale(sx, sy, sz); return g; };
const ANIM = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, flatShading: true });
ANIM.onBeforeCompile = sh => {
  sh.vertexShader = sh.vertexShader
    .replace('#include <common>', '#include <common>\nattribute float mk;\nattribute vec3 aAlt;\nattribute vec3 aTrim;')
    .replace('#include <color_vertex>', '#if defined( USE_COLOR ) && defined( USE_INSTANCING_COLOR )\n vColor = vec4( mk < 0.5 ? color.rgb : ( mk < 1.5 ? instanceColor.rgb : ( mk < 2.5 ? aAlt : aTrim ) ), 1.0 );\n#endif'); // vColor is a vec4 in r186
};
function mkMesh(parts, cap, shadow) {
  const geo = mergeGeometries(parts, false); parts.forEach(g => g.dispose());
  geo.setAttribute('aAlt', new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3)); geo.setAttribute('aTrim', new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3));
  const im = new THREE.InstancedMesh(geo, ANIM, cap); // matrices start as zeros: nothing is drawn until an animal is posed
  im.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3);
  im.instanceMatrix.setUsage(THREE.DynamicDrawUsage); im.frustumCulled = false; im.castShadow = shadow && SHADOWS; im.receiveShadow = true; im.userData.noMerge = true;
  scene.add(im); return im;
}
function paint(im, i, coat, alt, trim) {
  _col.set(coat); im.instanceColor.setXYZ(i, _col.r, _col.g, _col.b);
  _col.set(alt || coat); im.geometry.attributes.aAlt.setXYZ(i, _col.r, _col.g, _col.b);
  _col.set(trim || coat); im.geometry.attributes.aTrim.setXYZ(i, _col.r, _col.g, _col.b);
  im.instanceColor.needsUpdate = true; im.geometry.attributes.aAlt.needsUpdate = true; im.geometry.attributes.aTrim.needsUpdate = true;
}
const GEOM = {};
function buildGeoms() {
  const G = GEOM, mk = () => [];
  // dog: ~0.5 m at the shoulder, +x forward
  G.dogBody = mk(); G.dogHead = mk(); G.dogTail = mk();
  pc(G.dogBody, bx(0.58, 0.22, 0.2), 1, 0, 0, 0.4, 0); pc(G.dogBody, bx(0.22, 0.27, 0.22), 1, 0, 0.2, 0.4, 0); pc(G.dogBody, bx(0.2, 0.22, 0.19), 1, 0, -0.25, 0.39, 0);
  pc(G.dogBody, bx(0.14, 0.2, 0.14), 1, 0, 0.33, 0.5, 0, 0, 0, -0.5); pc(G.dogBody, bx(0.28, 0.03, 0.205), 2, 0, 0, 0.515, 0);
  pc(G.dogHead, bx(0.17, 0.15, 0.15), 1, 0, 0.07, 0.03, 0); pc(G.dogHead, bx(0.12, 0.08, 0.09), 1, 0, 0.2, -0.01, 0); pc(G.dogHead, bx(0.03, 0.04, 0.05), 0, '#141414', 0.27, 0, 0);
  pc(G.dogHead, bx(0.05, 0.07, 0.17), 3, 0, -0.01, -0.06, 0);
  for (const z of [-1, 1]) { pc(G.dogHead, bx(0.02, 0.02, 0.02), 0, '#0a0a0a', 0.14, 0.06, z * 0.06); pc(G.dogHead, bx(0.04, 0.1, 0.04), 2, 0, 0.03, 0.12, z * 0.065, z * 0.3); }
  pc(G.dogTail, bx(0.22, 0.035, 0.035), 1, 0, -0.11, 0, 0);
  // cow: ~1.2 m at the back, with a zebu hump
  G.cowBody = mk(); G.cowHead = mk();
  pc(G.cowBody, bx(1.35, 0.62, 0.58), 1, 0, 0, 1.0, 0); pc(G.cowBody, bx(0.4, 0.7, 0.55), 1, 0, 0.55, 1.0, 0); pc(G.cowBody, bx(0.3, 0.18, 0.3), 1, 0, 0.4, 1.38, 0); pc(G.cowBody, bx(0.3, 0.6, 0.52), 1, 0, -0.6, 1.0, 0);
  pc(G.cowBody, bx(0.42, 0.45, 0.6), 2, 0, -0.1, 1.15, 0); pc(G.cowBody, bx(0.04, 0.55, 0.04), 1, 0, -0.78, 0.97, 0); pc(G.cowBody, bx(0.07, 0.12, 0.07), 2, 0, -0.78, 0.64, 0);
  pc(G.cowHead, bx(0.55, 0.3, 0.28), 1, 0, 0.27, 0, 0); pc(G.cowHead, bx(0.34, 0.27, 0.24), 1, 0, 0.72, -0.02, 0); pc(G.cowHead, bx(0.14, 0.17, 0.2), 0, '#c9a79a', 0.94, -0.06, 0);
  for (const z of [-1, 1]) { pc(G.cowHead, bx(0.1, 0.04, 0.12), 1, 0, 0.64, 0.1, z * 0.17); pc(G.cowHead, bx(0.03, 0.14, 0.03), 0, '#e8e2cf', 0.62, 0.17, z * 0.1, z * 0.3); pc(G.cowHead, bx(0.02, 0.03, 0.03), 0, '#0a0a0a', 0.8, 0.06, z * 0.1); }
  // goat: ~0.6 m at the back
  G.goatBody = mk(); G.goatHead = mk();
  pc(G.goatBody, bx(0.62, 0.28, 0.26), 1, 0, 0, 0.5, 0); pc(G.goatBody, bx(0.2, 0.3, 0.24), 1, 0, 0.2, 0.5, 0); pc(G.goatBody, bx(0.2, 0.27, 0.24), 1, 0, -0.25, 0.5, 0);
  pc(G.goatBody, bx(0.3, 0.02, 0.27), 2, 0, 0, 0.65, 0); pc(G.goatBody, bx(0.04, 0.1, 0.04), 1, 0, -0.31, 0.62, 0, 0, 0, 0.5);
  pc(G.goatHead, bx(0.22, 0.14, 0.12), 1, 0, 0.1, 0.03, 0, 0, 0, -0.5); pc(G.goatHead, bx(0.14, 0.13, 0.11), 1, 0, 0.24, 0, 0); pc(G.goatHead, bx(0.08, 0.08, 0.09), 1, 0, 0.33, -0.04, 0); pc(G.goatHead, bx(0.03, 0.1, 0.03), 2, 0, 0.3, -0.1, 0);
  for (const z of [-1, 1]) { pc(G.goatHead, bx(0.1, 0.03, 0.05), 1, 0, 0.18, 0, z * 0.09); pc(G.goatHead, bx(0.03, 0.1, 0.02), 0, '#cfc6b0', 0.16, 0.1, z * 0.04, 0, 0, 0.5); }
  // leg: unit box hanging from the hip pivot, scaled per species; the foot takes the patch colour (a paw, or a dark hoof)
  G.leg = mk(); pc(G.leg, bx(1, 0.88, 1), 1, 0, 0, -0.44, 0); pc(G.leg, bx(1.08, 0.12, 1.2), 2, 0, 0.02, -0.94, 0);
  // crow: body with a grey nape (house crow) and one wing (the other is the same turned half a circle)
  G.crow = mk(); G.wing = mk();
  pc(G.crow, ball(0.1, 1.6, 0.9, 0.9), 1, 0, 0, 0.16, 0); pc(G.crow, bx(0.16, 0.015, 0.07), 1, 0, -0.22, 0.17, 0); pc(G.crow, ball(0.05, 1, 1, 1), 1, 0, 0.16, 0.24, 0);
  pc(G.crow, bx(0.1, 0.1, 0.1), 2, 0, 0.1, 0.21, 0); pc(G.crow, bx(0.07, 0.025, 0.025), 0, '#2b2b2b', 0.23, 0.23, 0);
  for (const z of [-1, 1]) pc(G.crow, bx(0.015, 0.1, 0.015), 0, '#2b2b2b', 0, 0.05, z * 0.03);
  pc(G.wing, bx(0.22, 0.012, 0.3), 1, 0, 0, 0, 0.15);
}

// ---------- species ----------
const SPEC = {
  dog: { hip: 0.31, legs: [[0.22, 0.09], [0.22, -0.09], [-0.24, 0.09], [-0.24, -0.09]], lw: 0.065, head: [0.38, 0.56], tail: [-0.35, 0.45], sink: 0.2, bob: 0.02, hd0: 0, sit: 1, top: 0.8, r: 0.4 },
  cow: { hip: 0.72, legs: [[0.55, 0.2], [0.55, -0.2], [-0.55, 0.2], [-0.55, -0.2]], lw: 0.11, head: [0.7, 1.22], sink: 0.5, bob: 0.01, hd0: -0.45, sit: 0, top: 1.9, r: 0.9 },
  goat: { hip: 0.37, legs: [[0.2, 0.08], [0.2, -0.08], [-0.22, 0.08], [-0.22, -0.08]], lw: 0.05, head: [0.3, 0.62], sink: 0.26, bob: 0.015, hd0: 0.1, sit: 0, top: 1.0, r: 0.4 },
};
const DOG_COATS = [['#b98a52'], ['#c9a26b'], ['#1e1c1b', '#2b2724'], ['#e6e0d2', '#7a4b2a'], ['#7a5a37', '#2e2317'], ['#e6e0d2', '#7a4b2a'], ['#8a8782', '#5a5855'], ['#1e1c1b', '#6b4a2a'], ['#7a5a37', '#2e2317']];
const COW_COATS = [['#ece8df', '#a8a6a0'], ['#a8a6a0'], ['#7a4e30', '#4d301c'], ['#e8e2d6', '#6f4730'], ['#ece8df']];
const GOAT_COATS = [['#e9e4d8', '#c9b08a'], ['#26231f', '#e9e4d8'], ['#8a5a35', '#e9e4d8'], ['#c9b08a', '#f0ead8'], ['#e9e4d8'], ['#26231f']];
const ALL = [], DOGS = [], COWS = [], GOATS = [], HERDS = [], FLOCKS = [], CROWS = [];
let MB = null, ready = false, T = 0, legCount = 0, pPX = 0, pPY = 0, pv = 0, pori = null;
const M = {};

function newAnimal(kind, id, name, x, y, o = {}) {
  const [px, py] = openNear(x, y, 30);
  const a = { id, kind, name, x: px, y: py, z: groundAt(px, py), heading: Math.random() * 6.28, state: 'idle', sp: 0, ph: Math.random() * 6.28, home: [px, py], roam: o.roam || 40, tx: px, ty: py, t: rand(1, 4),
    lie: 0, sit: 0, hd: 0, hdT: 0, wag: 0, wagK: 0, petT: 0, followT: 0, barkCd: rand(0, 5), sniffCd: rand(5, 25), blocked: 0, sitT: 0, following: false, goHome: false, lift: 0, sc: o.sc || 1,
    awake: false, hidden: true, dirty: true, si: 0, leg0: 0, pos: [px, py, 0], bp: new THREE.Vector3(), herd: o.herd || null, r: (SPEC[kind] || {}).r || 0.3 };
  a.pos[2] = a.z; ALL.push(a); return a;
}
function openNear(x, y, rmax) {
  if (ok(x, y)) return [x, y];
  for (let r = 1.5; r <= rmax; r += 1.5) for (let a = 0; a < 6.28; a += 0.5) { const px = x + Math.cos(a) * r, py = y + Math.sin(a) * r; if (ok(px, py)) return [px, py]; }
  return [x, y];
}
// walkable road and shoulder points, for dogs to wander along
const SX = [], SY = [];
function buildSamples() {
  const add = (x, y) => { if (ok(x, y)) { SX.push(x); SY.push(y); } };
  for (const rd of GEO.roads) {
    if (rd.w < 3) continue;
    const P = resample(rd.p, 7), N = normalsOf(P), o = rd.w / 2 + 0.8;
    for (let i = 0; i < P.length; i++) { add(P[i][0], P[i][1]); add(P[i][0] + N[i][0] * o, P[i][1] + N[i][1] * o); add(P[i][0] - N[i][0] * o, P[i][1] - N[i][1] * o); }
  }
  for (let i = 3; i < MAINP.length; i += 3) for (const s of [1, -1]) { const o = asphHalf(i) + 1.8; add(MAINP[i][0] + NRM[i][0] * s * o, MAINP[i][1] + NRM[i][1] * s * o); }
}
function pickSample(a, dmin, dmax) { // a random sample point near the animal and not too far from home (reservoir sampling, no allocation)
  let n = 0, pick = -1; const lo = dmin * dmin, hi = dmax * dmax, r2 = a.roam * a.roam;
  for (let i = 0; i < SX.length; i++) {
    const dx = SX[i] - a.x, dy = SY[i] - a.y, d = dx * dx + dy * dy; if (d < lo || d > hi) continue;
    const hx = SX[i] - a.home[0], hy = SY[i] - a.home[1]; if (hx * hx + hy * hy > r2) continue;
    if (Math.random() * ++n < 1) pick = i;
  }
  if (pick < 0) return false; a.tx = SX[pick]; a.ty = SY[pick]; return true;
}

// ---------- movement ----------
function faceTo(a, x, y, dt, rate = 5) { const d = angd(Math.atan2(y - a.y, x - a.x), a.heading); a.heading += clamp(d, -rate * dt, rate * dt); }
function stepTo(a, tx, ty, spd, dt, turn = 4) { // 1 arrived, 0 moving, 2 blocked
  const dx = tx - a.x, dy = ty - a.y, d = Math.hypot(dx, dy); if (d < 0.35) return 1;
  const df = angd(Math.atan2(dy, dx), a.heading); a.heading += clamp(df, -turn * dt, turn * dt);
  const f = Math.abs(df) < 1.0 ? 1 : 0.15, st = Math.min(spd * f * dt, d), nx = a.x + Math.cos(a.heading) * st, ny = a.y + Math.sin(a.heading) * st;
  if (ok(nx, ny)) { a.x = nx; a.y = ny; a.sp = spd * f; a.blocked = 0; return 0; }
  if (ok(nx, a.y)) { a.x = nx; a.sp = spd * f * 0.6; a.blocked += dt * 0.6; return 0; } // sliding along a wall still counts towards being stuck
  if (ok(a.x, ny)) { a.y = ny; a.sp = spd * f * 0.6; a.blocked += dt * 0.6; return 0; }
  a.sp = 0; a.blocked += dt; return 2;
}
function setState(a, s, t) { a.state = s; a.t = t; }

// ---------- dogs ----------
function dogAI(a, dt, P, pd) {
  a.t -= dt; a.barkCd -= dt; a.sniffCd -= dt; a.petT -= dt; a.sp = 0; a.hdT = 0; a.wagK = 0.05;
  if (a.following) return followAI(a, dt, P, pd);
  if (a.goHome) { a.wagK = 0.2; if (stepTo(a, a.home[0], a.home[1], 2.2, dt, 6) || a.blocked > 2) { a.goHome = false; setState(a, 'idle', 2); } else a.state = 'walk'; return; }
  if (a.petT > 0) { faceTo(a, P.x, P.y, dt); a.state = 'petted'; a.wagK = 0.9; a.hdT = 0.1; return; }
  if (pv > 6 && pd < 9 && a.barkCd <= 0 && (a.state !== 'lie' || pd < 5) && Math.random() < 0.7) { // someone sprinted past
    setState(a, 'bark', 1.1); a.barkCd = rand(9, 14); sfx('bark', { x: a.x, y: a.y });
  }
  switch (a.state) {
    case 'idle': case 'petted':
      a.hdT = Math.sin(T * 0.8 + a.ph) * 0.15;
      if (pd < 16 && pd > 3 && a.sniffCd <= 0 && pv < 5 && Math.random() < dt * 0.1) { setState(a, 'approach', 12); break; }
      if (a.t <= 0) { const r = Math.random(); if (r < 0.3) setState(a, 'lie', rand(12, 35)); else if (pickSample(a, 6, 28)) setState(a, 'walk', rand(8, 16)); else setState(a, 'idle', rand(2, 5)); }
      break;
    case 'walk': if (stepTo(a, a.tx, a.ty, 1.0, dt) || a.blocked > 1.2 || a.t <= 0) setState(a, 'idle', rand(1.5, 5)); a.hdT = -0.1; break;
    case 'lie': if (a.t <= 0 || (pd < 2.2 && Math.random() < dt * 0.5)) setState(a, 'idle', 2); break;
    case 'approach': // trot over to sniff the player
      a.wagK = 0.4; faceTo(a, P.x, P.y, dt, 6);
      if (pd < 1.7) { setState(a, 'sniff', 2.5); break; }
      stepTo(a, P.x, P.y, 2.4, dt, 6); if (pv > 5 || a.t <= 0 || pd > 22) { setState(a, 'idle', 3); a.sniffCd = 20; }
      break;
    case 'sniff': faceTo(a, P.x, P.y, dt); a.hdT = -0.6; a.wagK = 0.3; if (a.t <= 0) { setState(a, 'idle', 2); a.sniffCd = rand(40, 60); } break;
    case 'bark': faceTo(a, P.x, P.y, dt, 8); a.hdT = 0.3 + Math.sin(T * 18) * 0.08; a.wagK = 0.2; if (a.t <= 0) setState(a, 'idle', 2); break;
    default: setState(a, 'idle', 2);
  }
}
function followAI(a, dt, P, pd) {
  if (P.riding) { a.state = 'sit'; a.sitT = 9; return; } // waits where the player rode off
  const hx = Math.cos(P.heading), hy = Math.sin(P.heading), gx = P.x - hx * 2 - hy * 0.7, gy = P.y - hy * 2 + hx * 0.7;
  if (pd > 70) { const o = openNear(gx, gy, 8); a.x = o[0]; a.y = o[1]; a.blocked = 0; pd = Math.hypot(P.x - a.x, P.y - a.y); a.dirty = true; }
  a.wagK = 0.45;
  if (pd > 2.8 || Math.hypot(gx - a.x, gy - a.y) > 3.5) {
    stepTo(a, gx, gy, clamp(1.0 + (pd - 2.8) * 0.9, 1.1, 5.5), dt, 6); a.state = a.sp > 2.2 ? 'run' : 'walk'; a.sitT = 0;
    if (a.blocked > 1.5 && pd > 5) { const o = openNear(gx, gy, 4); a.x = o[0]; a.y = o[1]; a.blocked = 0; }
  } else { faceTo(a, P.x, P.y, dt); a.sitT = pv < 0.4 ? a.sitT + dt : 0; a.state = a.sitT > 1.2 ? 'sit' : 'idle'; }
}
// home: optional new home ({ x, y }), e.g. Pori moving to the park lawn; snap puts her there at once (a loaded save)
function setDogFollow(id, on, home = null, snap = false) {
  const a = DOGS.find(d => d.id === id); if (!a) return;
  if (home) { a.home = [home.x, home.y]; if (snap) { a.x = home.x; a.y = home.y; a.z = groundAt(a.x, a.y); a.dirty = true; } }
  a.following = !!on; a.goHome = !on; a.sitT = 0; if (on) { a.petT = 0; setState(a, 'idle', 1); } else { a.state = 'walk'; a.t = 1; }
}

// ---------- cows ----------
function cowAI(a, dt, P, pd) {
  a.t -= dt; a.petT -= dt; a.sp = 0; a.hdT = -0.2;
  if (a.followT > 0) { a.followT -= dt; if (pd > 2.6) { stepTo(a, P.x, P.y, 1.4, dt, 2.5); a.state = 'walk'; } else { a.state = 'idle'; faceTo(a, P.x, P.y, dt, 2); } if (a.followT <= 0) setState(a, 'graze', rand(6, 14)); return; }
  if (a.petT > 0) { faceTo(a, P.x, P.y, dt, 2); a.state = 'idle'; return; }
  switch (a.state) {
    case 'graze': case 'idle': {
      a.hdT = -0.9;
      if (a.t <= 0) {
        const r = Math.random();
        if (r < 0.25) setState(a, 'lie', rand(25, 60));
        else if (r < 0.65) { const ang = Math.random() * 6.28, d = rand(3, 9), nx = a.x + Math.cos(ang) * d, ny = a.y + Math.sin(ang) * d; if (Math.hypot(nx - a.home[0], ny - a.home[1]) < a.roam && ok(nx, ny)) { a.tx = nx; a.ty = ny; setState(a, 'walk', 25); } else setState(a, 'graze', rand(4, 8)); }
        else setState(a, 'graze', rand(6, 14));
      }
      break;
    }
    case 'walk': if (stepTo(a, a.tx, a.ty, 0.5, dt, 1.5) || a.blocked > 1.5 || a.t <= 0) setState(a, 'graze', rand(6, 14)); a.hdT = -0.5; break;
    case 'lie': if (a.t <= 0) setState(a, 'graze', rand(6, 14)); break;
    default: setState(a, 'graze', 5);
  }
}

// ---------- goats ----------
function goatAI(a, dt, P, pd) {
  a.t -= dt; a.sp = 0; a.lift *= 0.8; a.hdT = -0.2;
  const h = a.herd;
  if (a.state === 'flee') { // hop away from a runner
    const r = stepTo(a, a.tx, a.ty, 4.8, dt, 8); a.lift = Math.abs(Math.sin(T * 12 + a.ph)) * 0.3; a.sp = 4.8;
    if (r || a.t <= 0) setState(a, 'graze', rand(3, 6)); return;
  }
  if ((pd < 7 && pv > 4.5) || pd < 1.6) {
    for (let k = 0; k < 6; k++) { const away = Math.atan2(a.y - P.y, a.x - P.x) + rand(-0.8, 0.8), nx = a.x + Math.cos(away) * 9, ny = a.y + Math.sin(away) * 9; if (ok(nx, ny)) { a.tx = nx; a.ty = ny; h.cx = nx; h.cy = ny; setState(a, 'flee', 1.8); return; } }
  }
  if (a.state === 'graze' || a.state === 'idle') {
    a.hdT = -0.7;
    if (a.t <= 0) { const ang = Math.random() * 6.28, d = rand(0.5, 4), nx = h.cx + Math.cos(ang) * d, ny = h.cy + Math.sin(ang) * d; if (ok(nx, ny)) { a.tx = nx; a.ty = ny; setState(a, 'walk', 15); } else setState(a, 'graze', rand(3, 7)); }
  } else if (a.state === 'walk') { if (stepTo(a, a.tx, a.ty, 0.7, dt) || a.blocked > 1 || a.t <= 0) setState(a, 'graze', rand(4, 10)); a.hdT = -0.2; }
  else setState(a, 'graze', 3);
}
function herdStep(h, dt) {
  h.t -= dt; if (h.t > 0) return; h.t = rand(25, 45);
  for (let k = 0; k < 6; k++) { const ang = Math.random() * 6.28, d = rand(3, 14), nx = h.hx + Math.cos(ang) * d, ny = h.hy + Math.sin(ang) * d; if (ok(nx, ny)) { h.cx = nx; h.cy = ny; return; } }
}

// ---------- posing ----------
const _root = new THREE.Matrix4(), _a = new THREE.Matrix4(), _b = new THREE.Matrix4(), _c = new THREE.Matrix4(), _d = new THREE.Matrix4(), _eu = new THREE.Euler(), _sv = new THREE.Vector3();
const put = (mesh, i, m) => m.toArray(mesh.instanceMatrix.array, i * 16);
function local(m, tx, ty, tz, rx, ry, rz, order = 'XYZ') { _eu.set(rx, ry, rz, order); m.makeRotationFromEuler(_eu); m.setPosition(tx, ty, tz); return m; }
function rotAbout(m, px, py, rz, dx, dy) { const c = Math.cos(rz), s = Math.sin(rz); m.makeRotationZ(rz); m.setPosition(px - (c * px - s * py) + dx, py - (s * px + c * py) + dy, 0); }
function rootMat(a, h) { _root.makeRotationY(a.heading); if (a.sc !== 1) _root.scale(_sv.setScalar(a.sc)); _root.setPosition(a.x, h, -a.y); }
function poseQuad(a, S, mb, mh, mt, ml) {
  const k = a.si, lie = a.lie, sit = a.sit * S.sit, amp = Math.min(1, a.sp / 1.4) * (a.sp > 2 ? 0.95 : 0.65), bob = a.sp > 0.2 ? Math.abs(Math.sin(a.ph)) * S.bob : 0;
  rootMat(a, a.z + a.lift);
  rotAbout(_a, -0.3, 0.3, 0.5 * sit, 0, -S.sink * lie - 0.08 * sit + bob);
  _c.multiplyMatrices(_root, _a); put(mb, k, _c); // torso (also holds the cow's tail)
  local(_b, S.head[0], S.head[1], 0, 0, 0, S.hd0 + a.hd - 0.45 * sit); _d.multiplyMatrices(_c, _b); put(mh, k, _d);
  if (mt) { local(_b, S.tail[0], S.tail[1], 0, 0, Math.sin(T * 16) * a.wag, -0.7 + (a.state === 'lie' ? 0.6 : 0)); _d.multiplyMatrices(_c, _b); put(mt, k, _d); }
  for (let j = 0; j < 4; j++) {
    const front = j < 2, sw = amp * Math.sin(a.ph + (j === 0 || j === 3 ? 0 : Math.PI));
    let th = sw, hy = S.hip - S.sink * lie, sy = 1 - S.sink * lie / S.hip;
    if (lie > 0) th += front ? 1.1 * lie : -0.9 * lie;
    if (sit > 0) { if (front) { hy += 0.2 * sit; sy += 0.65 * sit; } else { hy -= 0.14 * sit; th += 1.3 * sit; sy -= 0.35 * sit; } }
    local(_b, S.legs[j][0], hy, S.legs[j][1], 0, 0, th); _b.scale(_sv.set(S.lw, sy * S.hip, S.lw)); _d.multiplyMatrices(_root, _b); put(ml, a.leg0 + j, _d);
  }
  a.pos[0] = a.x; a.pos[1] = a.y; a.pos[2] = a.z;
}
function hide(a) {
  const parts = a.kind === 'dog' ? [M.dogBody, M.dogHead, M.dogTail] : a.kind === 'cow' ? [M.cowBody, M.cowHead] : [M.goatBody, M.goatHead];
  for (const m of parts) m.instanceMatrix.array.fill(0, a.si * 16, a.si * 16 + 16);
  M.legs.instanceMatrix.array.fill(0, a.leg0 * 16, (a.leg0 + 4) * 16);
}

// ---------- crows ----------
const SITES = [
  () => ({ x: -489.6, y: -48, roof: true }),                                // Hatigarh stall roofs
  () => { const [x, y] = beside(27, 1, 8); return { x, y }; },               // field-side kiosks
];
function makeFlock(site, n) {
  const s = SITES[site](), f = { cx: s.x, cy: s.y, hx: s.x, hy: s.y, state: 'ground', u: 0, t: 0, tx: 0, ty: 0, cawT: 0, roof: !!s.roof, crows: [], hidden: true, dirty: true };
  if (!f.roof) { const o = openNear(s.x, s.y, 20); f.cx = f.hx = o[0]; f.cy = f.hy = o[1]; }
  for (let k = 0; k < n; k++) {
    const c = { id: 'crow' + (CROWS.length + 1), kind: 'crow', x: 0, y: 0, z: 0, heading: Math.random() * 6.28, state: 'ground', gx: 0, gy: 0, gz: 0, R: rand(3, 8), th: Math.random() * 6.28, w: (Math.random() < 0.5 ? -1 : 1) * rand(0.9, 1.4), alt: rand(5, 10), ph: Math.random() * 6.28,
      peck: Math.random() < 0.5, pt: rand(0.5, 3), hop: 0, pitch: 0, px: 0, py: 0, si: CROWS.length };
    if (f.roof) { const st = Math.min(8, k * 2 + (k % 2)); c.gx = rand(-0.5, 0.5); c.gy = (-60.2 + st * 2.45) - f.cy; c.gz = 2.3; }
    else groundSpot(f, c);
    c.x = f.cx + c.gx; c.y = f.cy + c.gy; CROWS.push(c); ALL.push(c); f.crows.push(c);
  }
  FLOCKS.push(f);
}
function groundSpot(f, c) { c.gx = c.gy = 0; for (let k = 0; k < 6; k++) { const a = Math.random() * 6.28, r = rand(0.3, 2.5); if (ok(f.cx + Math.cos(a) * r, f.cy + Math.sin(a) * r)) { c.gx = Math.cos(a) * r; c.gy = Math.sin(a) * r; break; } } c.gz = 0; }
function flockAI(f, dt, P) {
  let pd = 1e9; for (let k = 0; k < f.crows.length; k++) pd = Math.min(pd, Math.hypot(f.crows[k].x - P.x, f.crows[k].y - P.y)); // nearest bird, the roof row is long
  f.cawT -= dt;
  switch (f.state) {
    case 'ground':
      if (pd < 6 || (pd < 10 && pv > 6)) {
        f.state = 'rise'; f.u = 0; sfx('caw', { x: f.cx, y: f.cy }); f.cawT = rand(1, 2);
        for (const c of f.crows) { c.state = 'fly'; c.th = Math.atan2(c.gy, c.gx) + rand(-0.5, 0.5); }
      }
      break;
    case 'rise': f.u += dt / 2.2; if (f.u >= 1) { f.u = 1; f.state = 'circle'; f.t = rand(3, 5); } break;
    case 'circle':
      f.t -= dt;
      if (f.t <= 0) { // pick a new perch 30-60 m away
        for (let k = 0; k < 14; k++) { const a = Math.random() * 6.28, d = rand(30, 60), x = f.cx + Math.cos(a) * d, y = f.cy + Math.sin(a) * d; if (ok(x, y)) { f.tx = x; f.ty = y; f.state = 'glide'; break; } }
        if (f.state !== 'glide') f.t = 2;
      }
      break;
    case 'glide': { const dx = f.tx - f.cx, dy = f.ty - f.cy, d = Math.hypot(dx, dy), st = 9 * dt; if (d <= st) { f.cx = f.tx; f.cy = f.ty; f.state = 'land'; f.roof = false; for (const c of f.crows) groundSpot(f, c); } else { f.cx += dx / d * st; f.cy += dy / d * st; } break; }
    case 'land': f.u -= dt / 2.5; if (f.u <= 0) { f.u = 0; f.state = 'ground'; f.hx = f.cx; f.hy = f.cy; for (const c of f.crows) c.state = 'ground'; } break;
  }
  if (f.state !== 'ground' && f.cawT <= 0 && f.state !== 'land') { f.cawT = rand(1.5, 3); sfx('caw', { x: f.cx, y: f.cy }); }
  const e = f.u * f.u * (3 - 2 * f.u), flying = f.state !== 'ground';
  for (let k = 0; k < f.crows.length; k++) {
    const c = f.crows[k]; c.px = c.x; c.py = c.y;
    if (flying) c.th += c.w * dt;
    const ox = Math.cos(c.th) * c.R, oy = Math.sin(c.th) * c.R;
    c.x = f.cx + c.gx + (ox - c.gx) * e; c.y = f.cy + c.gy + (oy - c.gy) * e;
    const gnd = groundAt(c.x, c.y); c.z = gnd + c.gz * (1 - e) + c.alt * e;
    if (flying) { const mv = Math.hypot(c.x - c.px, c.y - c.py); if (mv > 0.002) c.heading += clamp(angd(Math.atan2(c.y - c.py, c.x - c.px), c.heading), -6 * dt, 6 * dt); c.pitch = f.state === 'rise' ? 0.45 : f.state === 'land' ? -0.35 : 0.05; c.hop = 0; }
    else { // on the ground: peck, look about, now and then hop
      c.pt -= dt; if (c.pt <= 0) { c.peck = !c.peck; c.pt = rand(0.6, 3); if (Math.random() < 0.3) c.hop = 0.3; c.heading += rand(-1.2, 1.2); }
      c.pitch = c.peck ? -0.5 * Math.abs(Math.sin(T * 9 + c.ph)) : 0; if (c.hop > 0) { c.hop -= dt; c.z += Math.sin(c.hop / 0.3 * Math.PI) * 0.15; }
    }
    c.state = flying ? 'fly' : 'ground';
  }
}
function poseCrow(c, f) {
  _root.makeRotationY(c.heading); _root.setPosition(c.x, c.z, -c.y);
  local(_a, 0, 0, 0, 0, 0, c.pitch); _c.multiplyMatrices(_root, _a); put(M.crow, c.si, _c);
  const e = f.u * f.u * (3 - 2 * f.u), flap = Math.sin(T * (f.state === 'glide' ? 9 : 18) + c.ph) * (f.state === 'glide' ? 0.45 : 0.85), ang = 1.3 * (1 - Math.min(1, e * 3)) + flap * Math.min(1, e * 2);
  local(_b, 0.02, 0.2, 0.07, ang, 0, 0, 'YXZ'); _d.multiplyMatrices(_c, _b); put(M.wing, c.si * 2, _d);
  local(_b, 0.02, 0.2, -0.07, ang, Math.PI, 0, 'YXZ'); _d.multiplyMatrices(_c, _b); put(M.wing, c.si * 2 + 1, _d);
}

// ---------- interactions ----------
const MSG_PET = a => (a.name ? `${a.name} wags her tail.` : 'The dog wags its tail.');
function say(a, text, ms = 1600) { bubble('animal:' + a.id, () => a.bp.set(a.x, a.z + SPEC[a.kind].top, -a.y), text, ms); }
function petDog(a) {
  a.petT = 3; if (a.state === 'lie') setState(a, 'idle', 2);
  say(a, 'Woof!'); toast(MSG_PET(a), { kind: 'info' }); emit('animal:pet', { id: a.id, kind: 'dog' });
}
function registerAll() {
  for (const a of DOGS) {
    register({ id: 'pet:' + a.id, pos: () => a.pos, r: 2.2, kind: 'animal', priority: 1, label: a.name ? `Pet ${a.name}` : 'Pet the dog', onInteract: () => petDog(a) });
    if (a === pori) register({ id: 'feed:pori', pos: () => a.pos, r: 2.2, kind: 'animal', priority: 2, label: 'Give Pori biscuits', enabled: () => hasItem('biscuits'), onInteract: () => {
      if (!removeItem('biscuits')) return;
      emit('dog:fed', { id: 'pori', kind: 'dog' }); say(a, 'Woof!'); a.petT = 2.5;
      toast(a.following ? 'Pori crunches the biscuits happily.' : 'Pori gobbles the biscuits and trots along after you.', { kind: 'good' });
      setDogFollow('pori', true);
    } });
  }
  for (const a of COWS) {
    register({ id: 'pet:' + a.id, pos: () => a.pos, r: 2.6, kind: 'animal', priority: 1, label: 'Pet the cow', onInteract: () => {
      a.petT = 2.5; sfx('moo', { x: a.x, y: a.y }); say(a, 'Moo'); toast('The cow lets you scratch its forehead.', { kind: 'info' }); emit('animal:pet', { id: a.id, kind: 'cow' });
    } });
    register({ id: 'feed:' + a.id, pos: () => a.pos, r: 2.6, kind: 'animal', priority: 2, label: 'Feed a banana', enabled: () => hasItem('banana'), onInteract: () => {
      if (!removeItem('banana')) return;
      sfx('moo', { x: a.x, y: a.y }); a.followT = 10; toast('The cow munches the banana and ambles after you.', { kind: 'good' });
    } });
  }
}

// ---------- public ----------
function initAnimals() {
  if (ready) return;
  try {
    buildGeoms(); buildSamples();
    const nDog = 1 + CFG.dogs, nGoat = CFG.herds.reduce((s, n) => s + n, 0), nCrow = CFG.flocks.reduce((s, n) => s + n, 0);
    // Pori lives at Hatigarh; the street dogs spread along the road
    pori = newAnimal('dog', 'pori', 'Pori', -470, -70, { roam: 28 }); DOGS.push(pori);
    const spots = [[-135, -1], [-20, 1], [60, -1], [-300, 1], [-380, -1], [150, 1], [-240, -1], [-452, 1], [-535, -1]];
    for (let k = 0; k < CFG.dogs; k++) { const [x, s] = spots[k], [px, py] = beside(x, s, asphHalf(0) + 3); DOGS.push(newAnimal('dog', 'dog' + (k + 1), null, px, py, { roam: 55, sc: rand(0.9, 1.1) })); }
    const cowAt = [[-60, -4], [19, -23], [-19, 21], [-130, 40], [130, 120]];
    for (let k = 0; k < CFG.cows; k++) COWS.push(newAnimal('cow', 'cow' + (k + 1), null, cowAt[k][0], cowAt[k][1], { roam: 22, sc: rand(0.93, 1.05) }));
    const herdAt = [[-120, -128], [-50, 22]];
    CFG.herds.forEach((n, h) => {
      const g = { cx: 0, cy: 0, hx: 0, hy: 0, t: rand(5, 20) }, o = openNear(herdAt[h][0], herdAt[h][1], 30); g.cx = g.hx = o[0]; g.cy = g.hy = o[1]; HERDS.push(g);
      for (let k = 0; k < n; k++) GOATS.push(newAnimal('goat', `goat${GOATS.length + 1}`, null, o[0] + rand(-2, 2), o[1] + rand(-2, 2), { roam: 30, herd: g, sc: rand(0.85, 1.05) }));
    });
    CFG.flocks.forEach((n, f) => makeFlock(f, n));
    // meshes: counts are fixed by the quality tier
    M.dogBody = mkMesh(GEOM.dogBody, nDog, true); M.dogHead = mkMesh(GEOM.dogHead, nDog, true); M.dogTail = mkMesh(GEOM.dogTail, nDog, true);
    M.cowBody = mkMesh(GEOM.cowBody, COWS.length, true); M.cowHead = mkMesh(GEOM.cowHead, COWS.length, true);
    M.goatBody = mkMesh(GEOM.goatBody, nGoat, false); M.goatHead = mkMesh(GEOM.goatHead, nGoat, false);
    M.legs = mkMesh(GEOM.leg, (nDog + COWS.length + nGoat) * 4, true);
    M.crow = mkMesh(GEOM.crow, nCrow, false); M.wing = mkMesh(GEOM.wing, nCrow * 2, false);
    const give = (list, body, coats, hoof) => list.forEach((a, k) => {
      a.si = k; a.leg0 = legCount; legCount += 4; const c = coats[k % coats.length], trim = a === pori ? '#c4262e' : null;
      paint(body, k, a === pori ? '#dcc197' : c[0], a === pori ? null : c[1], trim);
      for (let j = 0; j < 4; j++) paint(M.legs, a.leg0 + j, a === pori ? '#dcc197' : c[0], hoof || (a === pori ? '#dcc197' : c[0]));
      if (body === M.dogBody) { paint(M.dogHead, k, a === pori ? '#dcc197' : c[0], a === pori ? null : c[1], trim); paint(M.dogTail, k, a === pori ? '#dcc197' : c[0]); }
    });
    give(DOGS, M.dogBody, DOG_COATS); give(COWS, M.cowBody, COW_COATS, '#2a2522'); give(GOATS, M.goatBody, GOAT_COATS, '#2a2522');
    COWS.forEach((a, k) => paint(M.cowHead, k, COW_COATS[k % COW_COATS.length][0], COW_COATS[k % COW_COATS.length][1]));
    GOATS.forEach((a, k) => paint(M.goatHead, k, GOAT_COATS[k % GOAT_COATS.length][0], GOAT_COATS[k % GOAT_COATS.length][1]));
    CROWS.forEach(c => { paint(M.crow, c.si, '#1c1c1f', '#8d9094'); paint(M.wing, c.si * 2, '#1c1c1f'); paint(M.wing, c.si * 2 + 1, '#1c1c1f'); });
    DOGS.forEach((a, k) => { if (k) a.t = rand(1, 6); });
    registerAll();
    on('game:start', () => { // a new or loaded game: Pori goes home; the quest code re-applies the follow if her quest is mid-way
      if (!pori) return; pori.following = false; pori.goHome = false; pori.x = pori.home[0]; pori.y = pori.home[1]; pori.z = groundAt(pori.x, pori.y); setState(pori, 'idle', 2); pori.dirty = true;
    });
    ready = true;
  } catch (err) { console.error('[animals] failed to build', err); }
}
function updateAnimals(dt, player) {
  if (!ready || !player || !(dt > 0)) return;
  if (dt > 0.05) dt = 0.05;
  T += dt;
  const mv = Math.hypot(player.x - pPX, player.y - pPY) / dt; pv = mv > 40 ? 0 : Math.max(mv, 0); pPX = player.x; pPY = player.y; // a teleport is not a sprint
  for (let k = 0; k < ALL.length; k++) {
    const a = ALL[k]; if (a.kind === 'crow') continue;
    const dx = a.x - player.x, dy = a.y - player.y, d2 = dx * dx + dy * dy;
    if (!a.following && d2 > SHOW * SHOW) { if (!a.hidden) { hide(a); a.hidden = true; } a.awake = false; continue; }
    if (a.hidden) { a.hidden = false; a.dirty = true; }
    a.awake = a.following || d2 < SLEEP * SLEEP;
    if (!a.awake && !a.dirty) continue;
    if (a.awake) {
      const pd = Math.sqrt(d2);
      if (a.kind === 'dog') dogAI(a, dt, player, pd); else if (a.kind === 'cow') cowAI(a, dt, player, pd); else goatAI(a, dt, player, pd);
      a.ph += a.sp * (a.kind === 'cow' ? 3 : 5) * dt; a.z = groundAt(a.x, a.y);
      a.lie += ((a.state === 'lie' ? 1 : 0) - a.lie) * Math.min(1, dt * 2); a.sit += ((a.state === 'sit' ? 1 : 0) - a.sit) * Math.min(1, dt * 3);
      a.hd += (a.hdT - a.hd) * Math.min(1, dt * 6); a.wag += (a.wagK - a.wag) * Math.min(1, dt * 5);
    }
    a.dirty = false;
    if (a.kind === 'dog') poseQuad(a, SPEC.dog, M.dogBody, M.dogHead, M.dogTail, M.legs);
    else if (a.kind === 'cow') poseQuad(a, SPEC.cow, M.cowBody, M.cowHead, null, M.legs);
    else poseQuad(a, SPEC.goat, M.goatBody, M.goatHead, null, M.legs);
  }
  for (const g of HERDS) herdStep(g, dt);
  for (const f of FLOCKS) {
    const d2 = (f.cx - player.x) ** 2 + (f.cy - player.y) ** 2;
    if (d2 > SHOW * SHOW) { if (!f.hidden) { for (const c of f.crows) { M.crow.instanceMatrix.array.fill(0, c.si * 16, c.si * 16 + 16); M.wing.instanceMatrix.array.fill(0, c.si * 32, c.si * 32 + 32); } f.hidden = true; } continue; }
    if (f.hidden) { f.hidden = false; f.dirty = true; }
    const awake = d2 < SLEEP * SLEEP || f.state !== 'ground';
    if (!awake && !f.dirty) continue;
    if (awake) flockAI(f, dt, player); else for (const c of f.crows) { c.x = f.cx + c.gx; c.y = f.cy + c.gy; c.z = groundAt(c.x, c.y) + c.gz; }
    f.dirty = false;
    for (const c of f.crows) poseCrow(c, f);
  }
  for (const key in M) M[key].instanceMatrix.needsUpdate = true;
}
function allAnimals() { return ALL; }
function animalBlocking(x, y, r = 0.4) { // only cows stand in the way: dogs and goats would just be annoying
  for (let k = 0; k < COWS.length; k++) { const a = COWS[k]; if (a.hidden) continue; const rr = a.r + r; if ((a.x - x) * (a.x - x) + (a.y - y) * (a.y - y) < rr * rr) return a; }
  return null;
}

export { initAnimals, updateAnimals, allAnimals, animalBlocking, setDogFollow };
