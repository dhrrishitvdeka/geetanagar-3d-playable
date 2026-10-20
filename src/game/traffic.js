import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { scene } from '../core/context.js';
import { GEO, hAt } from '../core/geo.js';
import { QUALITY } from '../render/quality.js';
import { addCollider, normalsOf, resample } from '../world/geom.js';
import { HAT, MAINP, NRM, asphHalf, medHalf } from '../world/mainroad.js';
import { CAR_COLS, PLACED, TOTO_COLS, TWO_COLS, baked } from '../world/road/vehicles.js';
import { emit } from './core/bus.js';
import { sfx } from './audio.js';
import { animalBlocking } from './animals.js';
import { npcBlocking } from './npc/agents.js';

// ---------- traffic: parked vehicles become colliders; a small fleet drives Mother Teresa Rd (on the left) and a few wider lanes ----------
// Each kind is two InstancedMeshes: tinted paint, and everything else (glass, tyres, lamps...) merged with vertex colours: 18 draw calls in all.
const SIZE = { hatch: [3.8, 1.7], sedan: [4.3, 1.75], suv: [4.5, 1.85], toto: [2.8, 1.1], auto: [2.6, 1.3], scooter: [1.8, 0.6], moto: [1.8, 0.6], bus: [9, 2.3], truck: [3.2, 1.6], cyclerick: [2.0, 1.1] };
const C = a => a.map(c => new THREE.Color(c));
const CARS = C(CAR_COLS), TOTOS = C(TOTO_COLS), TWOS = C(TWO_COLS), BUSES = C(['#e8b923', '#f2f2ef']), AUTOS = C(['#2f7d3a']), TRUCKS = C(['#2c63b8']);
// share of the fleet, speed range (m/s), acceleration, colours
const KD = {
  hatch: { share: 0.18, v: [10, 12], acc: 2.6, cols: CARS }, sedan: { share: 0.14, v: [10, 12], acc: 2.6, cols: CARS }, suv: { share: 0.13, v: [10, 12], acc: 2.4, cols: CARS },
  scooter: { share: 0.15, v: [8, 10], acc: 3.0, cols: TWOS }, moto: { share: 0.10, v: [8, 10], acc: 3.2, cols: TWOS }, toto: { share: 0.15, v: [4.5, 5.5], acc: 1.2, cols: TOTOS },
  auto: { share: 0.07, v: [6.5, 7.5], acc: 1.6, cols: AUTOS }, bus: { share: 0.04, v: [7.5, 8.5], acc: 1.3, cols: BUSES }, truck: { share: 0.04, v: [7.5, 8.5], acc: 1.5, cols: TRUCKS },
};
const MIX = Object.keys(KD);
const N = QUALITY === 'low' ? 10 : QUALITY === 'high' ? 26 : 18; // fleet size
const WIN = 350;                                                   // keep traffic within this many metres (along the road) of the player
const FAST_OFF = 1.8, SLOW_IN = 1.5;                               // lane positions: fast lane from the median, slow lane in from the kerb
const rand = (a, b) => a + Math.random() * (b - a);
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const angd = (a, b) => { const d = a - b; return Math.atan2(Math.sin(d), Math.cos(d)); };

// ---------- routes: the main road and the wider lanes, with cumulative length ----------
function mkRoute(pts, nrm, main) {
  const n = pts.length, S = new Float32Array(n);
  for (let i = 1; i < n; i++) S[i] = S[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
  const m = pts[n >> 1];
  return { pts, nrm, S, n, L: S[n - 1], main, mx: m[0], my: m[1] };
}
const MAIN = mkRoute(MAINP, NRM, true);
const LANES = [];
const FAST = new Float32Array(MAINP.length), SLOW = new Float32Array(MAINP.length), SHIFT = [new Float32Array(MAINP.length), new Float32Array(MAINP.length)]; // SHIFT[0] north half, [1] south half
function indexAt(R, s) { let lo = 0, hi = R.n - 2; while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (R.S[mid] <= s) lo = mid; else hi = mid - 1; } return lo; }

// ---------- parked vehicles: four wall segments each, so neither the player nor the NPC walk graph passes through ----------
function boxCollider(x, y, ang, L, W) {
  const c = Math.cos(ang), s = Math.sin(ang), hl = L / 2, hw = W / 2, pt = (u, w) => [x + u * c - w * s, y + u * s + w * c];
  const a = pt(hl, hw), b = pt(hl, -hw), d = pt(-hl, -hw), e = pt(-hl, hw);
  addCollider(a, b); addCollider(b, d); addCollider(d, e); addCollider(e, a);
  if (W < 1.4) addCollider(pt(hl, 0), pt(-hl, 0)); // a spine, so a narrow bike has no gap in the middle
}
function nearestMain(x, y) { let best = 1e18, bi = 0; for (let i = 0; i < MAINP.length; i++) { const dx = MAINP[i][0] - x, dy = MAINP[i][1] - y, d = dx * dx + dy * dy; if (d < best) { best = d; bi = i; } } return bi; }
function prepareLanes() {
  for (let i = 0; i < MAINP.length; i++) { FAST[i] = medHalf(MAINP[i][0]) + FAST_OFF; SLOW[i] = asphHalf(i) - SLOW_IN; }
  // a parked vehicle that sits inside the slow lane (totos waiting at Hatigarh) pushes the slow lane inward around it
  for (const p of PLACED) {
    const i = nearestMain(p.x, p.y), q = MAINP[i], n = NRM[i];
    if (Math.hypot(p.x - q[0], p.y - q[1]) > 14) continue;
    const lat = (p.x - q[0]) * n[0] + (p.y - q[1]) * n[1], al = Math.abs(lat), side = lat > 0 ? 0 : 1, sz = SIZE[p.kind] || [2, 1];
    const da = p.ang - Math.atan2(n[0], -n[1]), ext = Math.abs(Math.cos(da)) * sz[1] / 2 + Math.abs(Math.sin(da)) * sz[0] / 2;
    if (al - ext >= SLOW[i] + 1.15 || al + ext <= SLOW[i] - 1.15 || al < FAST[i] + 1) continue;
    const sh = clamp(SLOW[i] - (al - ext - 1.35), 0, Math.max(0, SLOW[i] - FAST[i] - 1.4)), span = Math.ceil((Math.max(sz[0], sz[1]) / 2 + 10) / 2.5);
    for (let j = Math.max(0, i - span); j <= Math.min(MAINP.length - 1, i + span); j++) SHIFT[side][j] = Math.max(SHIFT[side][j], sh);
  }
  for (const rd of GEO.roads) {
    if (rd.w < 6) continue;
    const P = resample(rd.p, 3); if (P.length < 4) continue;
    const R = mkRoute(P, normalsOf(P), false); if (R.L >= 40) LANES.push(R);
  }
}

// ---------- the fleet: instanced meshes ----------
const REST = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7, metalness: 0.3 });
const KS = {}; // per kind: { meshes: [paint, rest], n (written this frame), live, cap }
function instMesh(geo, mat, cap, tint, shadow) {
  const im = new THREE.InstancedMesh(geo, mat, cap);
  im.count = 0; im.frustumCulled = false; im.castShadow = shadow && QUALITY !== 'low'; im.receiveShadow = true; im.userData.noMerge = true; // moving instances: no culling by a stale bound
  im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  if (tint) { im.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3); im.instanceColor.setUsage(THREE.DynamicDrawUsage); }
  scene.add(im); return im;
}
function buildKind(kind, cap) {
  const paint = [], rest = []; let paintMat = null;
  for (const [m, geo] of baked(kind)) {
    if (m.userData.tint) { paintMat = m; paint.push(geo); continue; }
    // everything else keeps its colour as a vertex colour (lamps add their emissive glow, glass is just dark)
    const g = geo.clone(), n = g.attributes.position.count, col = new Float32Array(n * 3), r = m.color.r + m.emissive.r, gr = m.color.g + m.emissive.g, b = m.color.b + m.emissive.b;
    for (let k = 0; k < n; k++) { col[k * 3] = r; col[k * 3 + 1] = gr; col[k * 3 + 2] = b; }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3)); rest.push(g);
  }
  const meshes = [];
  if (paint.length) meshes.push(instMesh(paint.length === 1 ? paint[0] : mergeGeometries(paint, false), paintMat, cap, true, true));
  if (rest.length) meshes.push(instMesh(rest.length === 1 ? rest[0] : mergeGeometries(rest, false), REST, cap, false, true));
  return { meshes, n: 0, live: 0, cap, tinted: paint.length > 0 };
}

// ---------- vehicles ----------
const LIVE = [], POOL = [];
function makeVeh() {
  return { kind: 'hatch', route: MAIN, dir: 1, s: 0, i: 0, lat: 0, lane: 0, latOff: 0.8, speed: 0, vmax: 10, acc: 2.5, x: 0, y: 0, z: 0, heading: 0, cs: 1, sn: 0, tx: 1, ty: 0, hl: 2, hw: 0.9, col: CARS[0],
    ph: 0, wob: 0, hold: 0, honkCd: 0, brake: 0, laneCd: 0, per: 0, og: 1e9, turn: 0, dh: 0 };
}
let T = 0, ready = false, spawnT = 0, perT = 0, hitCd = 0, projT = 0, pS = 0, pI = 0, pD = 1e9, pPrevX = 0, pPrevY = 0, pv = 0, laneN = 0;
const LC = []; // lane routes near the player

function laneTarget(v) { // signed lateral offset from the route centreline (positive = left of increasing s); drive on the left
  if (!v.route.main) return v.dir * v.latOff;
  const i = v.i, off = v.lane === 0 ? FAST[i] : SLOW[i] - SHIFT[v.dir > 0 ? 0 : 1][i];
  return v.dir * Math.max(off, 1.0);
}
function locate(v) {
  const R = v.route, S = R.S, P = R.pts, Nn = R.nrm; let i = v.i;
  while (i > 0 && S[i] > v.s) i--; while (i < R.n - 2 && S[i + 1] < v.s) i++; v.i = i;
  const len = S[i + 1] - S[i] || 1, f = clamp((v.s - S[i]) / len, 0, 1), a = P[i], b = P[i + 1], n0 = Nn[i], n1 = Nn[i + 1];
  let nx = n0[0] + (n1[0] - n0[0]) * f, ny = n0[1] + (n1[1] - n0[1]) * f; const l = Math.hypot(nx, ny) || 1; nx /= l; ny /= l;
  v.x = a[0] + (b[0] - a[0]) * f + nx * v.lat; v.y = a[1] + (b[1] - a[1]) * f + ny * v.lat;
  v.tx = ny; v.ty = -nx; // path tangent in the direction of increasing s
}
function release(k) {
  const v = LIVE[k]; KS[v.kind].live--; if (v.route !== MAIN) laneN--;
  LIVE[k] = LIVE[LIVE.length - 1]; LIVE.pop(); POOL.push(v);
}
function spaceFree(R, dir, s, latT) {
  for (let j = 0; j < LIVE.length; j++) { const o = LIVE[j]; if (o.route !== R || o.dir !== dir) continue; if (Math.abs(o.s - s) < 22 && Math.abs(o.lat - latT) < 2.2) return false; }
  return true;
}
function takeKind(lane) {
  for (let tries = 0; tries < 6; tries++) {
    let kind;
    if (lane) kind = Math.random() < 0.8 ? (Math.random() < 0.6 ? 'scooter' : 'moto') : 'toto';
    else { let r = Math.random(), k = 0; for (; k < MIX.length - 1; k++) { r -= KD[MIX[k]].share; if (r < 0) break; } kind = MIX[k]; }
    if (KS[kind].live < KS[kind].cap) return kind;
  }
  return null;
}
function spawn(R, dir, s, kind) {
  if (!POOL.length || !kind) return false;
  const v = POOL[POOL.length - 1], kd = KD[kind], sz = SIZE[kind], two = kind === 'scooter' || kind === 'moto';
  v.kind = kind; v.route = R; v.dir = dir; v.s = clamp(s, 1, R.L - 1); v.i = indexAt(R, v.s);
  v.lane = R.main ? (kind === 'hatch' || kind === 'sedan' || kind === 'suv' ? (Math.random() < 0.65 ? 0 : 1) : (two && Math.random() < 0.15 ? 0 : 1)) : 0;
  v.latOff = kind === 'toto' ? 0.55 : 0.8;
  v.vmax = (R.main ? rand(kd.v[0], kd.v[1]) : (two ? rand(6, 8) : rand(4.5, 5.5))); v.acc = kd.acc;
  v.hl = sz[0] / 2; v.hw = sz[1] / 2; v.col = kd.cols[Math.floor(Math.random() * kd.cols.length)];
  v.lat = laneTarget(v);
  if (!spaceFree(R, dir, v.s, v.lat)) return false;
  POOL.pop(); v.speed = v.vmax * 0.8; v.ph = Math.random() * 6.28; v.wob = two ? 0.15 : 0; v.hold = 0; v.honkCd = Math.random() * 2; v.brake = 0; v.laneCd = 2 + Math.random() * 4; v.per = Math.random() * 0.15; v.og = 1e9; v.turn = 0; v.dh = 0;
  locate(v); v.heading = Math.atan2(v.ty * dir, v.tx * dir); v.cs = Math.cos(v.heading); v.sn = Math.sin(v.heading); v.z = hAt(v.x, v.y) + 0.06;
  LIVE.push(v); KS[kind].live++; if (!R.main) laneN++;
  return true;
}
function trySpawn(P, fill) {
  const mainN = LIVE.length - laneN, laneT = LC.length ? Math.round(N * 0.2) : 0, mainT = pD > 320 ? 0 : N - laneT;
  if (laneN < laneT && POOL.length) { // a rider on one of the wider lanes, out of the player's face
    const R = LC[Math.floor(Math.random() * LC.length)], s = rand(8, R.L - 8), j = indexAt(R, s);
    if (Math.hypot(R.pts[j][0] - P.x, R.pts[j][1] - P.y) > 110) { if (spawn(R, Math.random() < 0.5 ? 1 : -1, s, takeKind(true))) return true; }
  }
  if (mainN < mainT && POOL.length) {
    const dir = Math.random() < 0.5 ? 1 : -1;
    let s;
    if (fill) { s = pS + rand(-WIN + 10, WIN - 10); if (Math.abs(s - pS) < 140) s = pS + (s < pS ? -1 : 1) * rand(140, WIN - 10); }
    else s = pS - dir * rand(325, 345); // upstream window edge
    if (s > 6 && s < MAIN.L - 6) return spawn(MAIN, dir, s, takeKind(false));
  }
  return false;
}

// ---------- per-vehicle step ----------
function honk(v, P) { v.honkCd = 4; if (Math.hypot(v.x - P.x, v.y - P.y) < 100) sfx('horn', { x: v.x, y: v.y }); }
function stepVeh(v, dt, P) {
  const R = v.route, dir = v.dir;
  v.honkCd -= dt; v.laneCd -= dt; v.brake -= dt; v.per -= dt; if (v.turn > 0) v.turn -= dt;
  // speed limit: slow through Hatigarh, slow in bends and during a U-turn
  let tgt = v.vmax;
  if (R.main) { const ax = Math.abs(v.x - HAT.x); if (ax < 35) tgt *= ax < 15 ? 0.4 : 0.4 + 0.6 * (ax - 15) / 20; }
  tgt = Math.min(tgt, Math.max(2.5, v.vmax * (1 - Math.min(1, Math.abs(v.dh) / 1.1))));
  if (v.turn > 0) tgt = Math.min(tgt, 2.5);
  // the vehicle ahead in this lane: keep a time gap
  let gap = 1e9, lead = null;
  for (let j = 0; j < LIVE.length; j++) {
    const o = LIVE[j]; if (o === v || o.route !== R || o.dir !== dir) continue;
    const d = (o.s - v.s) * dir; if (d <= 0 || d > 70) continue;
    if (Math.abs(o.lat - v.lat) > v.hw + o.hw + 0.35) continue;
    const g = d - v.hl - o.hl; if (g < gap) { gap = g; lead = o; }
  }
  if (lead) {
    tgt = Math.min(tgt, Math.max(0, (gap - 2.0) / 1.2));
    if (R.main && v.laneCd <= 0 && lead.vmax < v.vmax - 1.2 && gap < 20) { // stuck behind something slow: try the other lane if it is clear
      v.laneCd = 8; const was = v.lane; v.lane = 1 - was; const nt = laneTarget(v); let free = true;
      for (let j = 0; j < LIVE.length && free; j++) { const o = LIVE[j]; if (o === v || o.route !== R || o.dir !== dir) continue; const d = (o.s - v.s) * dir; if (Math.abs(o.lat - nt) < v.hw + o.hw + 0.6 && d > -(10 + v.hl + o.hl) && d < 18 + v.hl + o.hl) free = false; }
      if (!free) v.lane = was;
    }
  }
  // the player, NPCs and animals in the lane ahead
  let og = 1e9;
  const dxp = P.x - v.x, dyp = P.y - v.y, ahead = dxp * v.cs + dyp * v.sn, lim = Math.max(1.3, v.hw + 0.6);
  if (ahead > 0 && ahead < v.hl + 14 && Math.abs(-dxp * v.sn + dyp * v.cs) < lim) og = ahead - v.hl - 0.4;
  if (v.per <= 0) { // NPCs and animals are looked for a few times a second only
    v.per = 0.15; v.og = 1e9;
    for (let d = v.hl + 2.5; d < v.hl + 13; d += 3) { const px = v.x + v.cs * d, py = v.y + v.sn * d; if (npcBlocking(px, py, 1.3) || animalBlocking(px, py, 0.4)) { v.og = d - v.hl - 1; break; } }
  }
  if (v.og < og) og = v.og;
  const blocked = og < 1e8;
  if (blocked) tgt = Math.min(tgt, Math.sqrt(2 * 4.5 * Math.max(0, og - 1.2)));
  if (v.brake > 0) tgt = 0;
  if (blocked && v.speed < 0.6) { v.hold += dt; if (v.hold > 1.2 && v.honkCd <= 0) honk(v, P); } else v.hold = Math.max(0, v.hold - dt * 2);
  const dv = tgt - v.speed;
  v.speed += dv > 0 ? Math.min(dv, v.acc * dt) : Math.max(dv, -(v.brake > 0 ? 12 : 7.5) * dt);
  // advance along the route; wider lanes turn around at their ends
  v.s += dir * v.speed * dt;
  if (!R.main && (v.s < 0 || v.s > R.L)) { v.s = clamp(v.s, 0, R.L); v.dir = -dir; v.turn = 1.8; v.speed = Math.min(v.speed, 2.5); }
  // lateral: ease to the lane, with a little wobble for two-wheelers
  const latOld = v.lat, nd = v.dir, latT = laneTarget(v) + (v.wob ? Math.sin(T * 1.7 + v.ph) * v.wob : 0), stp = 1.6 * dt;
  v.lat += clamp(latT - v.lat, -stp, stp);
  locate(v);
  const vl = (v.lat - latOld) / dt, want = Math.atan2(v.ty * nd, v.tx * nd) + nd * Math.atan2(vl, Math.max(v.speed, 2));
  v.dh = angd(want, v.heading);
  v.heading += clamp(v.dh, -3.2 * dt, 3.2 * dt); v.cs = Math.cos(v.heading); v.sn = Math.sin(v.heading);
  v.z = hAt(v.x, v.y) + 0.06;
}

// ---------- hits on the player ----------
function checkHit(v, P) {
  const dx = P.x - v.x, dy = P.y - v.y, r = v.hl + v.hw + 0.5; if (dx * dx + dy * dy > r * r) return;
  const u = dx * v.cs + dy * v.sn, w = -dx * v.sn + dy * v.cs, cu = clamp(u, -v.hl, v.hl), cw = clamp(w, -v.hw, v.hw), ex = u - cu, ew = w - cw;
  if (ex * ex + ew * ew > 0.35 * 0.35) return;
  let px = (ex * v.cs - ew * v.sn), py = (ex * v.sn + ew * v.cs); const l = Math.hypot(px, py);
  if (l < 0.001) { px = -v.sn * (w >= 0 ? 1 : -1); py = v.cs * (w >= 0 ? 1 : -1); } else { px /= l; py /= l; }
  px += v.cs * 0.5; py += v.sn * 0.5; const k = Math.hypot(px, py) || 1;
  hitCd = 1.5; v.brake = 1.2;
  emit('player:hit', { dx: px / k, dy: py / k, speed: v.speed, kind: v.kind });
}

// ---------- draw ----------
function writeVeh(v) {
  const k = KS[v.kind], i = k.n++; if (i >= k.cap) return;
  const c = v.cs, s = v.sn, o = i * 16;
  for (let m = 0; m < k.meshes.length; m++) {
    const a = k.meshes[m].instanceMatrix.array;
    a[o] = c; a[o + 1] = 0; a[o + 2] = -s; a[o + 3] = 0; a[o + 4] = 0; a[o + 5] = 1; a[o + 6] = 0; a[o + 7] = 0; a[o + 8] = s; a[o + 9] = 0; a[o + 10] = c; a[o + 11] = 0;
    a[o + 12] = v.x; a[o + 13] = v.z; a[o + 14] = -v.y; a[o + 15] = 1;
  }
  if (k.tinted) { const ca = k.meshes[0].instanceColor.array; ca[i * 3] = v.col.r; ca[i * 3 + 1] = v.col.g; ca[i * 3 + 2] = v.col.b; }
}

// ---------- public ----------
let inited = false;
function initTraffic() {
  if (inited) return; inited = true;
  for (const p of PLACED) { const sz = SIZE[p.kind]; if (sz) boxCollider(p.x, p.y, p.ang, sz[0], sz[1]); }
  try {
    prepareLanes();
    let total = 0;
    for (const kind of MIX) { const cap = Math.ceil(N * KD[kind].share * 1.8) + 3; KS[kind] = buildKind(kind, cap); total += cap; }
    for (let i = 0; i < Math.min(total, N * 3); i++) POOL.push(makeVeh());
    ready = true;
  } catch (err) { console.error('[traffic] fleet failed', err); }
}
function updateTraffic(dt, player) {
  if (!ready || !player || !(dt > 0)) return;
  if (dt > 0.05) dt = 0.05;
  T += dt; hitCd -= dt;
  // where the player is along the main road, how far from it, and how fast they move (cheap, a few times a second)
  if ((projT -= dt) <= 0) {
    projT = 0.25; let best = 1e18, bi = 0;
    for (let i = 0; i < MAINP.length; i++) { const dx = MAINP[i][0] - player.x, dy = MAINP[i][1] - player.y, d = dx * dx + dy * dy; if (d < best) { best = d; bi = i; } }
    pI = bi; pS = MAIN.S[bi]; pD = Math.sqrt(best);
    LC.length = 0; for (const R of LANES) if (Math.hypot(R.mx - player.x, R.my - player.y) < 300 + R.L / 2) LC.push(R);
  }
  pv = Math.hypot(player.x - pPrevX, player.y - pPrevY) / dt; pPrevX = player.x; pPrevY = player.y;
  // keep the fleet topped up: fast while it is thin (start, teleport), one by one afterwards
  const want = pD > 320 ? Math.round(N * 0.2) : N;
  if ((spawnT -= dt) <= 0) {
    const fill = LIVE.length < want * 0.6;
    for (let k = 0; k < (fill ? 3 : 1); k++) trySpawn(player, fill);
    spawnT = fill ? 0.05 : 0.35;
  }
  for (let k = LIVE.length - 1; k >= 0; k--) {
    const v = LIVE[k];
    stepVeh(v, dt, player);
    const far = v.route === MAIN ? (Math.abs(v.s - pS) > WIN + 15 || v.s <= 0.5 || v.s >= MAIN.L - 0.5) : Math.hypot(v.x - player.x, v.y - player.y) > WIN + 40;
    if (far) { release(k); continue; }
    if (hitCd <= 0 && v.speed > 2 && !player.seated) checkHit(v, player);
  }
  for (const kind of MIX) KS[kind].n = 0;
  for (let k = 0; k < LIVE.length; k++) writeVeh(LIVE[k]);
  for (const kind of MIX) { const ks = KS[kind]; for (let m = 0; m < ks.meshes.length; m++) { const im = ks.meshes[m]; im.count = ks.n; if (ks.n) { im.instanceMatrix.needsUpdate = true; if (im.instanceColor) im.instanceColor.needsUpdate = true; } } }
}
function vehicleAt(x, y, r = 0.5) { // oriented rectangle (rounded by r) against the moving fleet
  for (let k = 0; k < LIVE.length; k++) {
    const v = LIVE[k], dx = x - v.x, dy = y - v.y, rr = v.hl + v.hw + r + 1; if (dx * dx + dy * dy > rr * rr) continue;
    const u = dx * v.cs + dy * v.sn, w = -dx * v.sn + dy * v.cs, ex = u - clamp(u, -v.hl, v.hl), ew = w - clamp(w, -v.hw, v.hw);
    if (ex * ex + ew * ew < r * r) return v;
  }
  return null;
}
function getTrafficVehicles() { return LIVE; }

export { initTraffic, updateTraffic, vehicleAt, getTrafficVehicles };
