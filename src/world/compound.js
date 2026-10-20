import * as THREE from 'three';
import { GEO, clsAt, hAt, hash2, pointInPoly, rng } from '../core/geo.js';
import { addCollider, mergeAdd, resample } from './geom.js';
import { laneWidth } from './streets.js';
import { HAT, MAINP, MAIN_JUNC, NRM, RF, edgeKind, hw, nearestOnMain } from './mainroad.js';
import { TEX, canvasTex, speckle } from './materials.js';
import OVERRIDES from '../../data/buildings_overrides.json';

// ================= plot boundary walls and gates along Mother Teresa Rd =================
// Street View (Mar 2026), docs/notes-buildings.md: from Hatigarh to past the mandir nearly every plot is behind a
// 1.5-2 m boundary wall (white, grey, blue-grey, red or bare brick) with a steel gate (sliding or two-leaf, grey,
// green or blue) and now and then a small gatehouse. Shopfronts have no wall.
// Estimated layout; finishes per Street View. Wall runs, plot splits, gate spots, colours, open/shut gates and
// gatehouses are all seeded guesses from the class raster and building centroids, not surveyed per plot.
const X0 = -520, X1 = 120;   // stretch covered (the Street View evidence runs -500..+90)
const OFF = 1.0;             // wall line outside the half right-of-way, clear of the shoulder strip
const PIL = 0.22;            // half width of a gate pillar
const ZONES = [[-1, -172, -64, 'park'], [1, -60, 20, 'field'], [1, 28, 72, 'mandir']]; // [side, x0, x1] (+1 north, -1 south)
const HAT_PTS = [[HAT.x, HAT.y], [-499, -62]]; // junction centre and the signal gantry corner, +-25 m
const NO_WALL = ['forecourt', 'field', 'mandir'];

// ---------- palette (estimated, per Street View) ----------
const PAINT = [['#ecebe5', '#e4e2da', '#f0eee9'], ['#a9abab', '#8e9293', '#b9bab6'], ['#7c8fa1', '#8a9bab', '#6f8396'], ['#a1443a', '#b3584a', '#8f3d36']]; // white, grey, blue-grey, red
const BRICK = ['#ffffff', '#f0dcd2', '#e3cabd'];
const GATE = ['#8d9296', '#8d9296', '#46705a', '#46705a', '#3b5f93', '#3b5f93', '#4f5357'];
const pick = (r, a) => a[Math.floor(r() * a.length)];

// ---------- mesh accumulators: one per material, flat-shaded quads ----------
const acc = () => ({ p: [], n: [], u: [], c: [], i: [] });
function quad(A, v, col, uv, hint) { // v: 4 world points; hint: expected outward normal (omit for double-sided leaves)
  let [a, b, c, d] = v, [ua, ub, uc, ud] = uv;
  let nx = (b[1] - a[1]) * (d[2] - a[2]) - (b[2] - a[2]) * (d[1] - a[1]), ny = (b[2] - a[2]) * (d[0] - a[0]) - (b[0] - a[0]) * (d[2] - a[2]), nz = (b[0] - a[0]) * (d[1] - a[1]) - (b[1] - a[1]) * (d[0] - a[0]);
  const l = Math.hypot(nx, ny, nz); if (l < 1e-9) return;
  if (hint && nx * hint[0] + ny * hint[1] + nz * hint[2] < 0) { [a, b, c, d] = [d, c, b, a]; [ua, ub, uc, ud] = [ud, uc, ub, ua]; nx = -nx; ny = -ny; nz = -nz; }
  const k = A.p.length / 3, C = col instanceof THREE.Color ? col : new THREE.Color(col);
  for (const [q, t] of [[a, ua], [b, ub], [c, uc], [d, ud]]) { A.p.push(q[0], q[1], q[2]); A.n.push(nx / l, ny / l, nz / l); A.u.push(t[0], t[1]); A.c.push(C.r, C.g, C.b); }
  A.i.push(k, k + 1, k + 2, k, k + 2, k + 3);
}
function geom(A) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(A.p, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(A.n, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(A.u, 2)); g.setAttribute('color', new THREE.Float32BufferAttribute(A.c, 3)); g.setIndex(A.i); return g;
}
const W = (x, y, h) => [x, h, -y]; // local (x, y, height) to world
// a wall slab along a polyline of [x, y, arc]; nr(k) = unit normal toward the road at vertex k. lo null = sunk into the ground
function slab(A, pts, nr, t, lo, hi, col, uu, vv) {
  const F = [], B = [];
  pts.forEach((p, k) => {
    const n = nr(k), g = hAt(p[0], p[1]), fx = p[0] + n[0] * t / 2, fy = p[1] + n[1] * t / 2, bx = p[0] - n[0] * t / 2, by = p[1] - n[1] * t / 2;
    const y0 = lo == null ? Math.min(g, hAt(fx, fy), hAt(bx, by)) - 0.25 : g + lo, y1 = g + hi, v0 = lo == null ? 0 : 0.88;
    F.push({ x: fx, y: fy, y0, y1, v0, a: p[2] }); B.push({ x: bx, y: by, y0, y1, v0, a: p[2] });
  });
  const nz = n => [n[0], 0, -n[1]];
  for (let k = 0; k < pts.length - 1; k++) {
    const n = nr(k), f0 = F[k], f1 = F[k + 1], b0 = B[k], b1 = B[k + 1];
    const uvs = (q0, q1) => [[q0.a / uu, q0.v0], [q1.a / uu, q1.v0], [q1.a / uu, q1.v0 + (q1.y1 - q1.y0) / vv], [q0.a / uu, q0.v0 + (q0.y1 - q0.y0) / vv]];
    quad(A, [W(f0.x, f0.y, f0.y0), W(f1.x, f1.y, f1.y0), W(f1.x, f1.y, f1.y1), W(f0.x, f0.y, f0.y1)], col, uvs(f0, f1), nz(n));
    quad(A, [W(b0.x, b0.y, b0.y0), W(b1.x, b1.y, b1.y0), W(b1.x, b1.y, b1.y1), W(b0.x, b0.y, b0.y1)], col, uvs(b0, b1), nz([-n[0], -n[1]]));
    quad(A, [W(b0.x, b0.y, b0.y1), W(b1.x, b1.y, b1.y1), W(f1.x, f1.y, f1.y1), W(f0.x, f0.y, f0.y1)], col, [[f0.a / uu, 0.9], [f1.a / uu, 0.9], [f1.a / uu, 0.95], [f0.a / uu, 0.95]], [0, 1, 0]);
  }
}
// an upright box centred on (cx, cy): w along the tangent (tx, ty), d along its left normal, from absolute y0 to y1
function box(A, cx, cy, tx, ty, w, d, y0, y1, col, vOff = 0, uu = 2.4, vv = 2.4) {
  const nx = -ty, ny = tx, c = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([a, b]) => [cx + tx * a * w / 2 + nx * b * d / 2, cy + ty * a * w / 2 + ny * b * d / 2]);
  for (let k = 0; k < 4; k++) {
    const p = c[k], q = c[(k + 1) % 4], len = Math.hypot(q[0] - p[0], q[1] - p[1]), mx = (p[0] + q[0]) / 2 - cx, my = (p[1] + q[1]) / 2 - cy;
    quad(A, [W(p[0], p[1], y0), W(q[0], q[1], y0), W(q[0], q[1], y1), W(p[0], p[1], y1)], col, [[0, vOff], [len / uu, vOff], [len / uu, vOff + (y1 - y0) / vv], [0, vOff + (y1 - y0) / vv]], [mx, 0, -my]);
  }
  quad(A, c.map(p => W(p[0], p[1], y1)), col, [[0.9, 0.9], [0.95, 0.9], [0.95, 0.95], [0.9, 0.95]], [0, 1, 0]);
}
const gmin = (x, y, r) => Math.min(hAt(x, y), hAt(x + r, y), hAt(x - r, y), hAt(x, y + r), hAt(x, y - r));
// a square pillar with a cap, sunk into the ground
function post(A, x, y, tx, ty, w, h, col, cap) {
  const y0 = gmin(x, y, w * 0.7) - 0.25, y1 = hAt(x, y) + h;
  box(A, x, y, tx, ty, w, w, y0, y1, col); box(A, x, y, tx, ty, w + 0.14, w + 0.14, y1, y1 + 0.08, cap, 0.86);
}

// ---------- textures (no external assets) ----------
function plasterTex() { // dusty plaster, rain streaks, damp and moss at the foot; tinted per plot by vertex colour
  return canvasTex(256, 256, (g, w, h) => {
    const r = rng(77); g.fillStyle = '#f1efe9'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 90; i++) { g.fillStyle = `rgba(80,70,60,${0.05 + r() * 0.09})`; g.fillRect(r() * w, 0, 1 + r() * 3, 30 + r() * 120); }
    const gr = g.createLinearGradient(0, h * 0.7, 0, h); gr.addColorStop(0, 'rgba(60,50,40,0)'); gr.addColorStop(1, 'rgba(60,50,40,0.45)'); g.fillStyle = gr; g.fillRect(0, h * 0.7, w, h * 0.3);
    for (let i = 0; i < 26; i++) { g.fillStyle = `rgba(70,95,60,${0.08 + r() * 0.12})`; g.beginPath(); g.ellipse(r() * w, h * (0.8 + r() * 0.2), 4 + r() * 16, 3 + r() * 8, 0, 0, 7); g.fill(); }
    speckle(g, w, h, 9000, ['rgba(0,0,0,0.07)', 'rgba(255,255,255,0.18)', 'rgba(120,100,80,0.10)']);
  });
}
function gateTex() { // one steel leaf: frame, bars, a sheet-metal lower plate and spear tips; painted by vertex colour
  return canvasTex(256, 256, (g, w, h) => {
    const fill = (x, y, bw, bh, c = '#f4f4f2') => { g.fillStyle = c; g.fillRect(x, y, bw, bh); };
    const mid = Math.round(h * 0.56), plate = h - 12;
    fill(0, 30, 12, h - 30); fill(w - 12, 30, 12, h - 30); fill(0, 30, w, 12); fill(0, plate, w, 12); fill(0, mid, w, 10);
    for (let x = 20; x < w - 14; x += 19) fill(x, 42, 5, mid - 42);          // bars above the mid rail
    for (let x = 18; x < w - 8; x += 38) { g.fillStyle = '#f4f4f2'; g.beginPath(); g.moveTo(x, 30); g.lineTo(x + 5, 6); g.lineTo(x + 10, 30); g.fill(); } // spear tips
    fill(12, mid + 10, w - 24, plate - mid - 10, '#e3e4e1');                    // sheet-metal plate
    for (let y = mid + 28; y < plate - 6; y += 22) fill(12, y, w - 24, 3, '#b7bab9');
    fill(12, mid + 10, w - 24, 3, '#a9acab');
  }, false);
}

// ---------- which plots get a wall ----------
// One building index per class-raster hit, to tell shopfronts from walled houses (override shops: true / false wins).
function buildingAt(x, y) {
  let best = -1, bd = 2.5;
  GEO.buildings.forEach((b, i) => {
    if (Math.abs(b.c[0] - x) > 60 || Math.abs(b.c[1] - y) > 60) return;
    if (pointInPoly(x, y, b.p)) { best = i; bd = -1; return; }
    if (bd < 0) return;
    for (const q of b.p) { const d = Math.hypot(q[0] - x, q[1] - y); if (d < bd) { bd = d; best = i; } }
  });
  return best;
}
const inZone = (s, x) => ZONES.some(z => z[0] === s && x >= z[1] && x <= z[2]);
const nearHat = (x, y) => HAT_PTS.some(h => Math.hypot(x - h[0], y - h[1]) < 25);
// static skips for road sample i on side s (also used to re-check the finished segments); returns a reason or null
function skipAt(s, i) {
  const P = MAINP[i], x = P[0];
  if (x < X0 || x > X1) return 'range';
  if (inZone(s, x)) return 'zone';
  if (nearHat(x, P[1])) return 'hatigarh';
  if (NO_WALL.includes(edgeKind(s, i))) return 'edge';
  const side = s === 1 ? 'N' : 'S';
  for (const j of RF.junctions) if (j.side === side && Math.abs(x - j.x) < (j.w + 2) / 2 + 1) return 'lane';
  for (const j of MAIN_JUNC) if (j.side === s && Math.hypot(x - j.x, P[1] - j.y) < (j.w + 2) / 2 + 1) return 'lane';
  for (const b of RF.bus_stops) if (b.side === side && Math.abs(x - b.x) < 6) return 'busstop';
  return null;
}

// ================= boundary walls along the side lanes =================
// Street View (Narikalbari 3rd Bye Ln, Baikuntha Rd, Railway Colony Rd): the lanes run between ~1.6-2.1 m plot walls, bare
// brick about as often as plastered, with a steel gate per plot. Same rules as the main road (no wall where a house or shop
// stands at the lane edge, at lane mouths, on open land); layout is seeded, not surveyed per plot. Every gate is left open
// so each yard (delivery doors, collectibles) stays reachable.
const LANE_BOX = [-560, 170, -340, 340];
// upper Railway Colony Rd (pano n6dev6yxA3mnQbD9EJ-sAw, May 2023): a sunken lane between ~3 m mossy old walls under a closed canopy
const OLD_RC_Y = 55, MOSSY = ['#9a9b8a', '#8f927f', '#a3a08d', '#868a78'];
const LANE_BRICK = ['#c9b3a6', '#b89c8e', '#d4bfb2']; // exposed lane brick is darker and grimier than the main-road walls
const MAIN_Y = MAINP.reduce((m, p) => [Math.min(m[0], p[1]), Math.max(m[1], p[1])], [1e9, -1e9]);
export function buildLaneWalls(lanes) {
  const t0 = performance.now(), A = { pl: acc(), br: acc(), gt: acc() }, st = { runs: 0, gates: 0, len: 0, skip: {} };
  const G = new Map(), cell = 8, key = (x, y) => Math.floor(x / cell) + ',' + Math.floor(y / cell);
  lanes.forEach((l, k) => l.P.forEach(p => { const kk = key(p[0], p[1]); (G.get(kk) || G.set(kk, []).get(kk)).push([p[0], p[1], k, l.w]); }));
  const otherLane = (x, y, k) => { for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) for (const q of G.get((Math.floor(x / cell) + i) + ',' + (Math.floor(y / cell) + j)) || []) if (q[2] !== k && Math.hypot(q[0] - x, q[1] - y) < q[3] / 2 + 1.2) return true; return false; };
  const F = GEO.fieldPoly, PK = GEO.parkPoly, nearPoly = (poly, x, y, r) => [[0, 0], [r, 0], [-r, 0], [0, r], [0, -r]].some(([a, b]) => pointInPoly(x + a, y + b, poly));
  const tex = { pl: plasterTex(), gt: gateTex() };
  lanes.forEach(({ P, w, name }, k) => {
    const nl = P.map((p, i) => { const a = P[Math.max(0, i - 1)], b = P[Math.min(P.length - 1, i + 1)], dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy) || 1; return [-dy / l, dx / l]; });
    for (const s of [1, -1]) {
      const o = w / 2 + 1.7, WP = P.map((p, i) => [p[0] + nl[i][0] * s * o, p[1] + nl[i][1] * s * o]), arc = [0], ok = [];
      for (let i = 1; i < WP.length; i++) arc.push(arc[i - 1] + Math.hypot(WP[i][0] - WP[i - 1][0], WP[i][1] - WP[i - 1][1]));
      WP.forEach(([x, y], i) => {
        const dx = nl[i][0] * s, dy = nl[i][1] * s; let why = null;
        if (x < LANE_BOX[0] || x > LANE_BOX[1] || y < LANE_BOX[2] || y > LANE_BOX[3]) why = 'range';
        else if (nearHat(x, y) || Math.hypot(x - HAT.x, y - HAT.y) < 32) why = 'hatigarh';
        else if (y > MAIN_Y[0] - 22 && y < MAIN_Y[1] + 22 && nearestOnMain(x, y)[0] < 22) why = 'main';
        else if (otherLane(x, y, k)) why = 'lane';
        else if (nearPoly(F, x, y, 12) || nearPoly(PK, x, y, 5)) why = 'zone';
        else for (let d = 0; d <= 4 && !why; d += 0.5) { const c = clsAt(x + dx * d, y + dy * d); if (d <= 0.9 && (c === 1 || c === 2 || c === 3)) why = c === 1 ? 'road' : 'building'; else if (c === 3 && d <= 1.5) why = 'shopfront'; else if (d <= 3 && (c === 4 || c === 5 || c === 9)) why = 'open land'; }
        if (why) st.skip[why] = (st.skip[why] || 0) + 1; ok.push(!why);
      });
      for (let i = 0; i < WP.length;) {
        if (!ok[i]) { i++; continue; }
        let j = i; while (j + 1 < WP.length && ok[j + 1]) j++;
        const len = arc[j] - arc[i];
        const mid = WP[(i + j) >> 1], old = name === 'Railway Colony Road' && mid[1] > OLD_RC_Y; // the sunken upper stretch
        if (len >= 5) laneRun(A, WP.slice(i, j + 1).map((p, q) => [p[0], p[1], arc[i + q] - arc[i]]), s, len, st, old);
        i = j + 1;
      }
    }
  });
  const mat = {
    pl: new THREE.MeshStandardMaterial({ map: tex.pl, vertexColors: true, roughness: 0.95 }),
    br: new THREE.MeshStandardMaterial({ map: TEX.brick, vertexColors: true, roughness: 0.95 }),
    gt: new THREE.MeshStandardMaterial({ map: tex.gt, vertexColors: true, alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.5, metalness: 0.25 }),
  };
  for (const kk of ['pl', 'br', 'gt']) if (A[kk].p.length) mergeAdd([geom(A[kk])], mat[kk], true);
  console.info(`[lanewalls] ${st.runs} runs, ${st.len.toFixed(0)} m of wall, ${st.gates} gates, ${(A.pl.p.length + A.br.p.length + A.gt.p.length) / 3} verts; skipped ${JSON.stringify(st.skip)}; ${Math.round(performance.now() - t0)} ms`);
  return st;
}
function laneRun(A, pts, s, len, st, old = false) {
  st.runs++;
  const at = a => { a = Math.max(0, Math.min(len, a)); let k = 0; while (k < pts.length - 2 && pts[k + 1][2] < a) k++;
    const p = pts[k], q = pts[k + 1], t = (a - p[2]) / ((q[2] - p[2]) || 1), l = Math.hypot(q[0] - p[0], q[1] - p[1]) || 1, tx = (q[0] - p[0]) / l, ty = (q[1] - p[1]) / l;
    return { x: p[0] + (q[0] - p[0]) * t, y: p[1] + (q[1] - p[1]) * t, tx, ty, nx: s * ty, ny: -s * tx }; };
  const slice = (a, b) => { const out = [[at(a).x, at(a).y, a]]; for (const p of pts) if (p[2] > a + 0.05 && p[2] < b - 0.05) out.push([p[0], p[1], p[2]]); out.push([at(b).x, at(b).y, b]); return out; };
  const r0 = rng(Math.floor(hash2(pts[0][0] * 1.3, pts[0][1] * 0.7 + s) * 1e9));
  // plots of 11-17 m, one gate each (short runs: one plot, a gate only if there is room)
  const bounds = [0]; while (len - bounds[bounds.length - 1] > 20) bounds.push(bounds[bounds.length - 1] + 11 + r0() * 6); bounds.push(len);
  for (let k = 0; k < bounds.length - 1; k++) {
    const a = bounds[k], b = bounds[k + 1], p0 = at(a), r = rng(Math.floor(hash2(p0.x * 1.17 + s, p0.y * 0.83) * 1e9));
    const kind = r(), brick = !old && kind >= 0.55, paint = brick ? null : PAINT[kind < 0.25 ? 0 : kind < 0.4 ? 1 : kind < 0.48 ? 2 : 3];
    const col = new THREE.Color(old ? pick(r, MOSSY) : brick ? pick(r, LANE_BRICK) : pick(r, paint)), cap = new THREE.Color(old ? '#9c9d8f' : brick ? '#cfcabf' : '#d8d6cf'), pcol = new THREE.Color(old ? pick(r, MOSSY) : brick ? '#d6d1c6' : pick(r, paint)).multiplyScalar(1.03);
    const h = Math.round((old ? 2.6 + r() * 0.4 : 1.6 + r() * 0.5) * 20) / 20, tw = 0.2, body = brick ? A.br : A.pl, uu = brick ? 1.2 : 2.4, vv = brick ? 0.6 : 2.4;
    const wg = 2.4 + Math.round(r() * 8) / 10, hg = wg / 2, g = b - a >= wg + 3 ? a + (b - a) * (0.3 + r() * 0.4) : null, gcol = new THREE.Color(pick(r, GATE));
    const pieces = g == null ? [[a, b]] : [[a, g - hg - PIL], [g + hg + PIL, b]];
    for (const [pa, pb] of pieces) {
      if (pb - pa < 0.3) continue;
      const q = slice(pa, pb), nr = kk => { const e = at(q[kk][2]); return [e.nx, e.ny]; };
      slab(body, q, nr, tw, null, h, col, uu, vv); slab(A.pl, q, nr, tw + 0.1, h, h + 0.07, cap, 2.4, 2.4);
      for (let m = 0; m < q.length - 1; m++) { addCollider([q[m][0], q[m][1]], [q[m + 1][0], q[m + 1][1]]); st.len += Math.hypot(q[m + 1][0] - q[m][0], q[m + 1][1] - q[m][1]); }
    }
    for (const aa of (k === 0 ? [a, b] : [b])) { const e = at(aa); post(A.pl, e.x, e.y, e.tx, e.ty, 0.4, h + 0.12, pcol, cap); }
    if (g == null) continue;
    const e = at(g), L = (u, v) => [e.x + e.tx * u + e.nx * v, e.y + e.ny * v + e.ty * u], gh = Math.min(h - 0.1, 1.85) + 0.05;
    for (const sd of [-1, 1]) { const c = L(sd * (hg + PIL), 0); post(A.pl, c[0], c[1], e.tx, e.ty, PIL * 2, h + 0.3, pcol, cap); }
    for (const sd of [-1, 1]) { // leaves swung into the yard, at a random angle
      const p1 = L(sd * (hg - 0.05), -0.05), ang = 0.6 + r() * 0.8, p2 = L(sd * (hg - 0.05) - sd * Math.cos(ang) * hg, -Math.sin(ang) * hg);
      const y1 = hAt(p1[0], p1[1]) + 0.12, y2 = hAt(p2[0], p2[1]) + 0.12;
      quad(A.gt, [W(p1[0], p1[1], y1), W(p2[0], p2[1], y2), W(p2[0], p2[1], y2 + gh), W(p1[0], p1[1], y1 + gh)], gcol, [[0, 0], [1, 0], [1, 1], [0, 1]]);
    }
    st.gates++;
  }
}

export function buildCompoundWalls() {
  const t0 = performance.now(), A = { pl: acc(), br: acc(), gt: acc() };
  const st = { runs: 0, pieces: 0, segments: 0, gates: 0, open: 0, booths: 0, len: { N: 0, S: 0 }, skip: {}, inSkip: 0, shopBehind: 0 };
  const segs = [];

  // first-row building centroids -> candidate gate spots
  const cands = [];
  GEO.buildings.forEach(b => {
    if (b.a < 30) return;
    let bj = -1, bd = 1e9;
    MAINP.forEach((p, j) => { if (p[0] < X0 - 20 || p[0] > X1 + 20) return; const d = Math.hypot(p[0] - b.c[0], p[1] - b.c[1]); if (d < bd) { bd = d; bj = j; } });
    if (bj < 0 || bd > 45) return;
    const lat = (b.c[0] - MAINP[bj][0]) * NRM[bj][0] + (b.c[1] - MAINP[bj][1]) * NRM[bj][1];
    cands.push({ j: bj, s: lat >= 0 ? 1 : -1, lat: Math.abs(lat) - hw(bj) - OFF });
  });

  // ---- 1. per side: mark road samples that can carry a wall, then take contiguous runs ----
  const runs = [];
  for (const s of [1, -1]) {
    const n = MAINP.length, WP = [], arc = [0], ok = new Array(n).fill(false), lane = new Array(n).fill(false);
    for (let i = 0; i < n; i++) {
      const o = hw(i) + OFF, P = MAINP[i], x = P[0] + NRM[i][0] * s * o, y = P[1] + NRM[i][1] * s * o;
      WP.push([x, y]); if (i) arc.push(arc[i - 1] + Math.hypot(x - WP[i - 1][0], y - WP[i - 1][1]));
      if (P[0] < X0 - 10 || P[0] > X1 + 10) continue;
      let why = skipAt(s, i);
      if (!why) {
        const dx = NRM[i][0] * s, dy = NRM[i][1] * s; let bld = null;
        for (const d of [0.3, 1.5, 3]) if (clsAt(x + dx * d, y + dy * d) === 1) { lane[i] = true; why = 'lane'; }
        for (let d = 0; d <= 9 && !why; d += 0.5) {
          const k = clsAt(x + dx * d, y + dy * d);
          if (d <= 3 && (k === 4 || k === 5 || k === 9)) why = 'open land';
          if (!bld && (k === 2 || k === 3)) bld = { d, k, x: x + dx * d, y: y + dy * d };
        }
        if (!why && bld) {
          const bi = buildingAt(bld.x, bld.y), ov = bi >= 0 ? OVERRIDES[bi] : null;
          if (bld.d < 0.9) why = 'building';
          else if ((ov && ov.shops === true) || (bld.k === 3 && bld.d <= 4 && !(ov && ov.shops === false))) why = 'shopfront'; // override shops: true, or commercial pixels right behind
        }
      }
      if (why) st.skip[why] = (st.skip[why] || 0) + 1; else ok[i] = true;
    }
    for (let i = 0; i < n; i++) if (lane[i]) { if (i) ok[i - 1] = false; if (i < n - 1) ok[i + 1] = false; ok[i] = false; } // lane mouths: a sample either side too
    for (let i = 0; i < n;) {
      if (!ok[i]) { i++; continue; }
      let j = i; while (j + 1 < n && ok[j + 1]) j++;
      const len = arc[j] - arc[i];
      if (len >= 6) runs.push({ s, i0: i, i1: j, len, pts: WP.slice(i, j + 1).map((p, k) => [p[0], p[1], arc[i + k] - arc[i]]), cand: [] });
      i = j + 1;
    }
  }
  for (const c of cands) for (const r of runs) if (r.s === c.s && c.j >= r.i0 && c.j <= r.i1 && c.lat > -1 && c.lat < 32) { r.cand.push({ a: r.pts[c.j - r.i0][2], lat: c.lat }); break; }

  // ---- 2. build each run: plots, wall pieces, pillars, gates ----
  const tex = { pl: plasterTex(), gt: gateTex() };
  for (const run of runs) {
    const { s, pts, len } = run; st.runs++;
    const at = a => { // point, tangent and road-facing normal at arc position a
      a = Math.max(0, Math.min(len, a)); let k = 0; while (k < pts.length - 2 && pts[k + 1][2] < a) k++;
      const p = pts[k], q = pts[k + 1], t = (a - p[2]) / ((q[2] - p[2]) || 1), l = Math.hypot(q[0] - p[0], q[1] - p[1]) || 1, tx = (q[0] - p[0]) / l, ty = (q[1] - p[1]) / l;
      return { x: p[0] + (q[0] - p[0]) * t, y: p[1] + (q[1] - p[1]) * t, tx, ty, nx: s * ty, ny: -s * tx };
    };
    const slice = (a, b) => { const out = [[at(a).x, at(a).y, a]]; for (const p of pts) if (p[2] > a + 0.05 && p[2] < b - 0.05) out.push([p[0], p[1], p[2]]); out.push([at(b).x, at(b).y, b]); return out; };
    const r0 = rng(Math.floor(hash2(pts[0][0] * 1.7, pts[0][1] * 0.9 + s) * 1e9));

    // gate spots: in front of building centroids first, then fill any stretch longer than ~25 m
    let G = [];
    for (const c of run.cand.sort((p, q) => p.lat - q.lat)) { const a = len >= 6.5 ? Math.max(3.2, Math.min(len - 3.2, c.a)) : c.a; if (G.every(g => Math.abs(g - a) > 11)) G.push(a); }
    G.sort((a, b) => a - b);
    if (!G.length) { if (len >= 7) { const m = Math.max(1, Math.round(len / 17)); for (let k = 0; k < m; k++) G.push((k + 0.5) * len / m + (r0() - 0.5) * 2); } }
    else {
      const out = [], edges = [0, ...G, len];
      for (let k = 0; k < edges.length - 1; k++) {
        const a = edges[k], b = edges[k + 1], lim = k === 0 || k === edges.length - 2 ? 24 : 26;
        if (k) out.push(a);
        if (b - a > lim) { const m = Math.floor((b - a) / 18); for (let q = 1; q <= m; q++) out.push(a + (b - a) * q / (m + 1) + (r0() - 0.5) * 3); }
      }
      out.push(edges[edges.length - 2]); G = [...new Set(out)].filter(a => a > 2.8 && a < len - 2.8).sort((a, b) => a - b);
      G = G.filter((a, k) => !k || a - G[k - 1] > 8);
      if (!G.length && len >= 7) G = [len / 2];
    }
    const bounds = [0, ...G.slice(1).map((g, k) => (G[k] + g) / 2), len];

    // ---- plots ----
    for (let k = 0; k < bounds.length - 1; k++) {
      const a = bounds[k], b = bounds[k + 1], g = G.length ? G[k] : null, p0 = at(a);
      const r = rng(Math.floor(hash2(p0.x * 1.31 + s, p0.y * 0.77) * 1e9));
      const kind = r(), brick = kind >= 0.78, paint = brick ? null : PAINT[kind < 0.3 ? 0 : kind < 0.52 ? 1 : kind < 0.66 ? 2 : 3];
      const col = new THREE.Color(brick ? pick(r, BRICK) : pick(r, paint)), cap = new THREE.Color(brick ? '#cfcabf' : '#d8d6cf'), pcol = new THREE.Color(brick ? '#d6d1c6' : pick(r, paint)).multiplyScalar(1.03);
      const h = Math.round((1.5 + r() * 0.5) * 20) / 20, panel = r() < 0.55, tw = panel ? 0.15 : 0.2, pw = 0.36;
      const gcol = new THREE.Color(pick(r, GATE)), sliding = r() < 0.4, open = r() < 0.3, wantBooth = r() < 0.24 && b - a >= 14, wg = 3 + Math.round(r() * 10) / 10;
      const body = brick ? A.br : A.pl, uu = brick ? 1.2 : 2.4, vv = brick ? 0.6 : 2.4;
      const hg = wg / 2, pieces = g == null ? [[a, b]] : [[a, g - hg - PIL], [g + hg + PIL, b]];
      const nrAt = q => kk => { const e = at(q[kk][2]); return [e.nx, e.ny]; };
      for (const [pa, pb] of pieces) {
        if (pb - pa < 0.3) continue;
        const q = slice(pa, pb), nr = nrAt(q); st.pieces++;
        slab(body, q, nr, tw, null, h, col, uu, vv);
        slab(A.pl, q, nr, tw + 0.1, h, h + 0.07, cap, 2.4, 2.4);
        for (let m = 0; m < q.length - 1; m++) { addCollider([q[m][0], q[m][1]], [q[m + 1][0], q[m + 1][1]]); segs.push({ a: [q[m][0], q[m][1]], b: [q[m + 1][0], q[m + 1][1]], s }); st.segments++; st.len[s === 1 ? 'N' : 'S'] += Math.hypot(q[m + 1][0] - q[m][0], q[m + 1][1] - q[m][1]); }
        if (panel) { const m = Math.round((pb - pa) / 3.2); for (let j = 1; j < m; j++) { const e = at(pa + (pb - pa) * j / m); post(A.pl, e.x, e.y, e.tx, e.ty, pw, h + 0.05, pcol, cap); } }
      }
      for (const aa of (k === 0 ? [a, b] : [b])) { const e = at(aa); post(A.pl, e.x, e.y, e.tx, e.ty, pw + 0.04, h + 0.12, pcol, cap); }
      if (g == null) continue;

      // ---- gate ----
      const e = at(g), L = (u, v) => [e.x + e.tx * u + e.nx * v, e.y + e.ny * v + e.ty * u], gh = Math.min(h - 0.1, 1.85) + 0.05;
      const leaf = (p1, p2) => {
        const y1 = hAt(p1[0], p1[1]) + 0.12, y2 = hAt(p2[0], p2[1]) + 0.12;
        quad(A.gt, [W(p1[0], p1[1], y1), W(p2[0], p2[1], y2), W(p2[0], p2[1], y2 + gh), W(p1[0], p1[1], y1 + gh)], gcol, [[0, 0], [1, 0], [1, 1], [0, 1]]);
      };
      for (const sd of [-1, 1]) { const c = L(sd * (hg + PIL), 0); post(A.pl, c[0], c[1], e.tx, e.ty, PIL * 2, h + 0.35, pcol, cap); }
      const availL = g - hg - PIL - a, availR = b - g - hg - PIL - PIL;
      let side = availR >= availL ? 1 : -1; const slideOk = sliding && Math.max(availL, availR) >= wg * 0.8;
      if (!open) {
        if (sliding) { leaf(L(-hg, 0), L(0, 0)); leaf(L(0, 0), L(hg, 0)); } else { leaf(L(-hg + 0.03, 0), L(-0.02, 0)); leaf(L(0.02, 0), L(hg - 0.03, 0)); }
        addCollider(L(-hg, 0), L(hg, 0));
      } else {
        st.open++;
        if (slideOk) { const v = -0.18; leaf(L(side * (hg + 0.06), v), L(side * (hg + 0.06 + wg / 2), v)); leaf(L(side * (hg + 0.06 + wg / 2), v), L(side * (hg + 0.06 + wg), v)); }
        else for (const sd of [-1, 1]) leaf(L(sd * (hg - 0.05), -0.05), L(sd * (hg + 0.2), -hg * 0.95)); // leaves swung in
      }
      st.gates++;

      // ---- gatehouse (2 x 2 m, 2.4 m): beside the gate, inside the wall, only where the ground behind is clear ----
      if (wantBooth) {
        const sd = availR >= 3.2 && (availL < 3.2 || r() < 0.5) ? 1 : availL >= 3.2 ? -1 : 0;
        if (sd) {
          const uc = sd * (hg + PIL * 2 + 1.1), c = L(uc, -1.15), hit = [[0, 0], [1, 1], [1, -1], [-1, 1], [-1, -1]].some(([x, y]) => { const q = L(uc + x * 1.1, -1.15 + y * 1.1), k = clsAt(q[0], q[1]); return k === 1 || k === 2 || k === 3; });
          if (!hit) {
            const y0 = gmin(c[0], c[1], 1.0) - 0.15, bw = new THREE.Color(pick(r, ['#ebe8e0', '#d9d4c6', '#c9d1bd', '#b9c3cc'])), dark = new THREE.Color(pick(r, ['#3d4348', '#46705a', '#3b5f93']));
            box(A.pl, c[0], c[1], e.tx, e.ty, 2, 2, y0, y0 + 2.4, bw); box(A.pl, c[0], c[1], e.tx, e.ty, 2.3, 2.3, y0 + 2.4, y0 + 2.52, new THREE.Color('#9a968e'), 0.86);
            const f = L(uc - sd * 1.03, -1.15 + 0.35); box(A.pl, f[0], f[1], e.tx, e.ty, 0.05, 0.85, y0 + 0.15, y0 + 2.05, dark);                 // door facing the drive
            const wv = L(uc - sd * 1.03, -1.15 - 0.55); box(A.pl, wv[0], wv[1], e.tx, e.ty, 0.05, 0.6, y0 + 1.2, y0 + 1.8, new THREE.Color('#2f3a42'));
            const cs = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([x, y]) => L(uc + x, -1.15 + y)); for (let m = 0; m < 4; m++) addCollider(cs[m], cs[(m + 1) % 4]);
            st.booths++;
          }
        }
      }
    }
  }

  // ---- 3. merge: plaster/pillars, brick, gate leaves (3 meshes) ----
  const mat = {
    pl: new THREE.MeshStandardMaterial({ map: tex.pl, vertexColors: true, roughness: 0.95 }),
    br: new THREE.MeshStandardMaterial({ map: TEX.brick, vertexColors: true, roughness: 0.95 }),
    gt: new THREE.MeshStandardMaterial({ map: tex.gt, vertexColors: true, alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.5, metalness: 0.25 }),
  };
  for (const k of ['pl', 'br', 'gt']) if (A[k].p.length) mergeAdd([geom(A[k])], mat[k], true);

  // ---- 4. self-check: finished segments against the skip rules ----
  const nearIdx = (x, y) => { let b = 0, bd = 1e9; MAINP.forEach((p, i) => { const d = Math.hypot(p[0] - x, p[1] - y); if (d < bd) { bd = d; b = i; } }); return b; };
  for (const sg of segs) {
    const mx = (sg.a[0] + sg.b[0]) / 2, my = (sg.a[1] + sg.b[1]) / 2;
    const ni = nearIdx(mx, my);
    if ((sg.s === -1 && mx > -170 && mx < -66) || (sg.s === 1 && ((mx > -58 && mx < 18) || (mx > 30 && mx < 70))) || Math.abs(mx - HAT.x) < 21 || Math.hypot(mx + 499, my + 62) < 24 || skipAt(sg.s, ni)) st.inSkip++;
    const dx = NRM[ni][0] * sg.s, dy = NRM[ni][1] * sg.s;
    for (let d = 1; d <= 4; d += 0.5) if (clsAt(mx + dx * d, my + dy * d) === 3) { st.shopBehind++; break; }
  }
  st.ms = Math.round(performance.now() - t0);
  st.lanes = buildLaneWalls(GEO.roads.map(r => ({ P: resample(r.p, 2), w: laneWidth(r), name: r.name })).filter(l => l.P.length >= 2));
  console.info(`[compound] ${st.runs} runs, ${st.pieces} wall pieces, ${st.segments} segments, wall length N ${st.len.N.toFixed(0)} m / S ${st.len.S.toFixed(0)} m, ${st.gates} gates (${st.open} open), ${st.booths} gatehouses; segments inside skip zones: ${st.inSkip}; segments with commercial pixels 1-4 m behind: ${st.shopBehind}; skipped samples ${JSON.stringify(st.skip)}; ${st.ms} ms`);
  return st;
}
