import * as THREE from 'three';
import { scene } from '../core/context.js';
import { GEO, clsAt, hAt, hash2, pointInPoly, rng } from '../core/geo.js';
import { inViewWedge, sightTop } from './deck.js';
import { LANDMARK_STYLE, decorateLandmark } from './landmarks.js';
import { nearestOnMain } from './mainroad.js';
import { buildShopfronts } from './shops.js';
import { BAY, FLOOR, facadeMaterials } from './bldg/facades.js';
import { MeshBuilder, simplifyRing } from './bldg/mesh.js';
// hand-checked facts from Street View, keyed by index in GEO.buildings (see docs/notes-buildings.md)
import OVERRIDES from '../../data/buildings_overrides.json';
const SURVEY = OVERRIDES._survey; // inside this stretch only buildings marked shops: true get shopfronts

// ---------- palette: muted, dusty paint seen on Street View ----------
// RCC houses: beige, cream, pale yellow, grey, a few pastels. Assam-type houses: lime-wash whites.
const WALLS = ['#e4d9c2', '#dccfb4', '#ece3cf', '#d8c8a6', '#e6d6a6', '#e0cd96', '#cbc5b9', '#c2beb4', '#d6d2c9',
  '#e2ccb6', '#dbc2ba', '#c9d1bd', '#cbd0c8', '#eae0c8', '#d3c3a6', '#bdb7ab', '#e8dfb8', '#d9c7b0'];
const ASSAM_WALLS = ['#ece8de', '#e6e1d4', '#efe9da', '#e2ddcf', '#e9e3d1', '#d9dccf'];
const SHOP_WALLS = ['#e2d6bc', '#dacbab', '#d4cab8', '#e6dece', '#cfc9bd'];
const TIN = ['#8e5a45', '#7d4f3e', '#8a8d8c', '#6f7a6e', '#66737c', '#9a6a4f', '#77797a'];
// flat roofs: weathered grey concrete, a few darker mould-stained ones, some with white/red waterproof coating
const SLAB = ['#c9c4b8', '#bfb9ad', '#d2cdc2', '#b3ada1', '#c4bfb5', '#9d978c', '#a39d92', '#e0ddd5', '#b88b78'];
const RAIL = ['#6d7277', '#2a2c2e', '#7c8186', '#4b5a50', '#d4d2cb', '#5a4a3e'];
const LCOL = { school: '#e9dcb6', temple: '#f3efe6', namghar: '#efebe2', bank: '#dcdfe0' };
const CONCRETE = new THREE.Color('#a8a49b'), REBAR = new THREE.Color('#4a3b30'), DOOR = new THREE.Color('#5b4a3c'), AC = new THREE.Color('#dcdedb');

const BLD = [], SHOPLIST = [], tanks = [], ROOFS = []; // ROOFS: the flat roofs, for the clutter in details.js
const C = (hex) => new THREE.Color(hex);

// everything about a building that does not depend on its neighbours: floors, heights, roof type, style, colours
function massing(b, bi) {
  const ov = OVERRIDES[bi] || {};
  const raw = b.p; if (raw.length < 3) return null;
  let base = Infinity, top = -Infinity;
  for (const p of raw) { const h = hAt(p[0], p[1]); base = Math.min(base, h); top = Math.max(top, h); }
  const s = hash2(b.c[0] * 0.37, b.c[1] * 0.71), s2 = hash2(b.c[1] * 1.3, b.c[0] * 0.9), s3 = hash2(b.c[0] * 2.1 + 5, b.c[1] * 0.3);
  let floors;
  const a = b.a;
  // Geetanagar is mostly 1-3 storey houses; taller apartment blocks cluster on Mother Teresa Rd
  if (a < 45) floors = 1;
  else if (a < 100) floors = s < 0.45 ? 1 : 2;
  else if (a < 220) floors = s < 0.2 ? 1 : s < 0.75 ? 2 : 3;
  else if (a < 600) floors = s < 0.35 ? 2 : s < 0.8 ? 3 : 4;
  else floors = s < 0.55 ? 2 : 3; // very large blobs are usually several joined houses on the map
  if (b.d < 30 && a > 120) floors = Math.max(floors, 3 + Math.floor(s2 * 4)); // Street View (Mar 2026): 3-6 storey flats line Mother Teresa Rd
  else if (b.d < 22 && a > 80 && s2 < 0.55) floors += s2 < 0.2 ? 2 : 1;
  if (b.k) floors = Math.max(floors, 2);
  if (ov.floors) floors = ov.floors;
  const lst = LANDMARK_STYLE.get(b);
  if (lst && !ov.floors) { if (lst.kind === 'namghar' || lst.kind === 'temple') floors = 1; if (lst.kind === 'school') floors = Math.max(2, Math.min(floors, 3)); if (lst.kind === 'bank') floors = Math.max(floors, 2); }
  // View point sightline: cap floors so the view stays open. Real houses that would still poke into it are kept
  // at one storey (satellite shows them) rather than dropped, and get no roof tank.
  let lowSight = false;
  const vw = inViewWedge(b.c[0], b.c[1]); if (vw !== null) { const allowed = Math.floor((sightTop(vw) - top - 0.9) / 3.1); lowSight = allowed < 1; floors = Math.max(1, Math.min(floors, allowed)); }
  floors = Math.min(floors, 8);
  const z0 = base - 1.5, z1 = top + floors * FLOOR;
  const isTin = ov.roof ? ov.roof === 'tin' : lst ? lst.kind === 'namghar' : (floors === 1 || (floors === 2 && a < 140 && s2 < 0.4));
  const style = ov.style || (isTin ? 'assam' : lst ? { school: 'rcc', bank: 'slide', temple: 'blank' }[lst.kind] || 'rcc' : s3 < 0.55 ? 'rcc' : 'slide');
  const wallCol = C(ov.wall ? ov.wall : lst ? LCOL[lst.kind] : isTin ? ASSAM_WALLS[Math.floor(s * 997) % ASSAM_WALLS.length] : b.k ? SHOP_WALLS[Math.floor(s2 * SHOP_WALLS.length)] : WALLS[Math.floor(s * 997) % WALLS.length]);
  const tv = hash2(s2 * 9, s * 7); // trim: same paint, off-white bands, or a darker shade
  const trimCol = tv < 0.5 ? wallCol.clone().multiplyScalar(0.93) : tv < 0.75 ? C('#e8e4da') : wallCol.clone().multiplyScalar(0.76);
  const unfinished = ov.unfinished != null ? ov.unfinished : !isTin && !lst && floors >= 2 && vw === null && s3 > 0.965 && b.d > 40;
  return { ov, raw, base, top, s, s2, s3, floors, a, lst, lowSight, vw, z0, z1, isTin, style, wallCol, trimCol, unfinished, pts: simplifyRing(raw, 0.85) };
}

// keep the part of a ring where sign * ((p - m) . u - t) >= 0 (Sutherland-Hodgman against one line)
function clipHalf(ring, mx, my, ux, uy, t, sign) {
  if (!isFinite(t)) return ring;
  const f = p => sign * ((p[0] - mx) * ux + (p[1] - my) * uy - t), out = [];
  for (let i = 0; i < ring.length; i++) { const A = ring[i], B = ring[(i + 1) % ring.length], fa = f(A), fb = f(B);
    if (fa >= 0) out.push(A);
    if ((fa >= 0) !== (fb >= 0)) { const k = fa / (fa - fb); out.push([A[0] + (B[0] - A[0]) * k, A[1] + (B[1] - A[1]) * k]); } }
  return out;
}
const ringArea = r => { let s = 0; for (let i = 0; i < r.length; i++) { const a = r[i], b = r[(i + 1) % r.length]; s += a[0] * b[1] - b[0] * a[1]; } return Math.abs(s) / 2; };
// very large traced blobs are usually a row of joined houses: cut them across their long axis into 9-14 m plots
function splitFootprint(b) {
  const P = b.p, n = P.length; if (b.a < 380 || n < 3) return [b];
  let mx = 0, my = 0; for (const p of P) { mx += p[0]; my += p[1]; } mx /= n; my /= n;
  let sxx = 0, syy = 0, sxy = 0; for (const p of P) { const dx = p[0] - mx, dy = p[1] - my; sxx += dx * dx; syy += dy * dy; sxy += dx * dy; }
  const ang = 0.5 * Math.atan2(2 * sxy, sxx - syy), ux = Math.cos(ang), uy = Math.sin(ang); // principal (long) axis
  let t0 = Infinity, t1 = -Infinity, w0 = Infinity, w1 = -Infinity;
  for (const p of P) { const t = (p[0] - mx) * ux + (p[1] - my) * uy, w = -(p[0] - mx) * uy + (p[1] - my) * ux; t0 = Math.min(t0, t); t1 = Math.max(t1, t); w0 = Math.min(w0, w); w1 = Math.max(w1, w); }
  const L = t1 - t0; if (L / Math.max(1, w1 - w0) < 1.5 && b.a < 900) return [b];
  const k = Math.min(6, Math.max(2, Math.round(L / (9 + hash2(mx, my) * 5))));
  const cut = j => j <= 0 ? -Infinity : j >= k ? Infinity : t0 + L * (j + (hash2(j * 3.1, mx + my) - 0.5) * 0.3) / k;
  const out = [];
  for (let j = 0; j < k; j++) {
    const ring = clipHalf(clipHalf(P, mx, my, ux, uy, cut(j), 1), mx, my, ux, uy, cut(j + 1), -1);
    const ar = ring.length >= 3 ? ringArea(ring) : 0; if (ar < 20) continue;
    let cx = 0, cy = 0; for (const p of ring) { cx += p[0]; cy += p[1]; }
    out.push({ ...b, p: ring, a: ar, c: [cx / ring.length, cy / ring.length] });
  }
  return out.length > 1 ? out : [b];
}

function buildAll() {
  const FM = facadeMaterials();
  // one set of mesh builders per 300 m cell, so the frustum and the shadow frustum can skip whole cells (150 m cut the shadow pass more but added ~290 draw calls)
  const CB = 300, CELLB = new Map(), cellOf = (x, y) => { const k = Math.floor(x / CB) * 4096 + Math.floor(y / CB); return CELLB.get(k) || CELLB.set(k, { W: { rcc: new MeshBuilder(), slide: new MeshBuilder(), assam: new MeshBuilder(), blank: new MeshBuilder(), side: new MeshBuilder() }, trim: new MeshBuilder(), rail: new MeshBuilder(), roof: new MeshBuilder(), tin: new MeshBuilder() }).get(k); };
  const R = rng(2024);
  // a facade quad from z0 to z1 along edge a->b: u counts bays (0.5 texture units each), v counts floors
  const wall = (mb, a, b, n, z0, z1, col, top, uOff, vOff, gA, gB) => {
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]), bays = Math.max(1, Math.round(L / BAY)), u1 = uOff + bays * 0.5;
    const v = z => vOff + ((z - top) / FLOOR) * 0.5;
    mb.quad([a[0], a[1], z0], [b[0], b[1], z0], [b[0], b[1], z1], [a[0], a[1], z1], [n[0], n[1], 0], col,
      [[uOff, v(z0)], [u1, v(z0)], [u1, v(z1)], [uOff, v(z1)]], [z0 - gA, z0 - gB, z1 - gB, z1 - gA]);
  };

  // pass 1: every building's roof height, so a side wall knows how much of it the neighbour hides
  const LIST = []; GEO.buildings.forEach((b, bi) => { if (OVERRIDES[bi] || LANDMARK_STYLE.get(b)) LIST.push({ b, bi }); else for (const p of splitFootprint(b)) LIST.push({ b: p, bi }); });
  const MS = LIST.map(({ b, bi }) => massing(b, bi)); // massing still reads OVERRIDES[bi]
  const NBG = new Map(), NBC = 16, nbk = (i, j) => i * 65536 + j;
  MS.forEach((m, li) => { if (!m) return; let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const p of m.pts) { x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]); y0 = Math.min(y0, p[1]); y1 = Math.max(y1, p[1]); }
    for (let i = Math.floor(x0 / NBC); i <= Math.floor(x1 / NBC); i++) for (let j = Math.floor(y0 / NBC); j <= Math.floor(y1 / NBC); j++) { const k = nbk(i, j); (NBG.get(k) || NBG.set(k, []).get(k)).push(li); } });
  const roofAt = (x, y, self) => { const l = NBG.get(nbk(Math.floor(x / NBC), Math.floor(y / NBC))); if (l) for (const bi of l) if (bi !== self && pointInPoly(x, y, MS[bi].pts)) return MS[bi].z1; return null; };

  LIST.forEach(({ b, bi }, li) => {
    const m = MS[li]; if (!m) return; const { W, trim, rail, roof, tin } = cellOf(b.c[0], b.c[1]); const { ov, raw, base, top, s, s2, s3, floors, a, lst, lowSight, vw, z0, z1, isTin, style, wallCol, trimCol, unfinished, pts } = m;
    const n = pts.length;

    // ---- per-edge facts ----
    const E = [];
    let longest = 0;
    for (let i = 0; i < n; i++) {
      const p = pts[i], q = pts[(i + 1) % n], L = Math.hypot(q[0] - p[0], q[1] - p[1]);
      const nx = (q[1] - p[1]) / L, ny = -(q[0] - p[0]) / L, mx = (p[0] + q[0]) / 2, my = (p[1] + q[1]) / 2; // outward for CCW rings
      let mainFacing = false;
      if (b.d < 45 && L >= 2) { const [d0] = nearestOnMain(mx, my), [d1] = nearestOnMain(mx + nx * 4, my + ny * 4); mainFacing = d1 < d0 - 2 && d0 < 30; }
      const road = mainFacing || clsAt(mx + nx * 3.5, my + ny * 3.5) === 1 || clsAt(mx + nx * 6, my + ny * 6) === 1;
      const e = { p, q, L, n: [nx, ny], u: [(q[0] - p[0]) / L, (q[1] - p[1]) / L], mainFacing, road, gA: hAt(p[0], p[1]), gB: hAt(q[0], q[1]) };
      const surveyed = SURVEY && b.c[0] >= SURVEY.x0 && b.c[0] <= SURVEY.x1;
      e.shop = (ov.shops != null ? ov.shops : surveyed && SURVEY.shops === false ? false : b.d < 26 || (lst && lst.kind === 'bank')) && mainFacing && L >= 3.2;
      E.push(e); if (L > E[longest].L) longest = i;
    }
    for (let i = 0; i < n; i++) {
      const e = E[i], mx = (e.p[0] + e.q[0]) / 2, my = (e.p[1] + e.q[1]) / 2, nb = d => { const k = clsAt(mx + e.n[0] * d, my + e.n[1] * d); return k === 2 || k === 3; };
      const party = !e.road && nb(3.0) && nb(4.2);
      // a neighbour hides this wall only up to its own roof; above that the wall is exposed and gets windows like any other
      let hid = party ? roofAt(mx + e.n[0] * 3.6, my + e.n[1] * 3.6, li) : null; if (party && hid === null) hid = z1;
      e.hid = hid === null ? -Infinity : Math.min(z1, hid + 0.3);
      e.front = e.road || i === longest;
      e.win = style !== 'blank' && e.L >= (style === 'assam' ? 2.0 : 2.2) && z1 - Math.max(e.hid, top) >= 2.4;
    }

    // ---- walls: plinth band below the ground floor, then the facade ----
    const vOff = s2 < 0.5 ? 0 : 0.5;
    for (let i = 0; i < n; i++) {
      const e = E[i], uOff = hash2(i + 3.3, s) < 0.5 ? 0 : 0.5;
      const eg = Math.max(e.gA, e.gB), low = !isTin && top - eg > 1.0 ? eg + 0.3 : null; // downhill wall: the floors continue down to this wall's own ground
      const plinthTop = low !== null ? low : top + (isTin ? 0.45 : 0); e.low = low;
      const zWin = Math.max(plinthTop, e.hid);
      const Wf = !e.win ? W.blank : (e.front || style === 'assam') ? W[style] : (W.side || W[style]); // W.side arrives in M3
      wall(W.blank, e.p, e.q, e.n, z0, plinthTop, wallCol.clone().multiplyScalar(isTin ? 0.8 : 0.92), top, uOff, vOff, e.gA, e.gB);
      if (zWin > plinthTop) wall(W.blank, e.p, e.q, e.n, plinthTop, zWin, wallCol, top, uOff, vOff, e.gA, e.gB); // hidden by the neighbour
      if (z1 > zWin) wall(Wf, e.p, e.q, e.n, zWin, z1, wallCol, top, uOff, isTin ? 0 : vOff, e.gA, e.gB);
    }

    // ---- RCC frame details: slab ledges, chajjas over every window row, balconies ----
    if (!isTin) {
      const balcony = floors >= 2 && style !== 'blank' && hash2(s * 3, s3 * 5) < 0.8;
      const solid = hash2(s3 * 11, 2) < 0.4, railCol = C(RAIL[Math.floor(hash2(s * 13, 4) * RAIL.length)]);
      for (let i = 0; i < n; i++) {
        const e = E[i]; if (e.L < 1.2) continue;
        const g = Math.min(e.gA, e.gB);
        for (let k = e.low != null ? -Math.floor((top - e.low) / FLOOR) : 0; k < floors; k++) {
          const fb = top + k * FLOOR; if (fb + FLOOR <= (e.low ?? -Infinity) + 0.4) continue;
          // floor slab edge at the top of every storey
          trim.box(e.p, e.u, e.n, -0.04, e.L + 0.04, -0.02, 0.09, fb + FLOOR - 0.2, fb + FLOOR, trimCol, 'f', g);
          // chajja (sunshade) over the window row
          if (e.win && !(e.shop && k === 0) && fb + 2.15 > e.hid) trim.box(e.p, e.u, e.n, 0.15, e.L - 0.15, -0.02, 0.42 + s * 0.16, fb + 2.15, fb + 2.24, trimCol, 'ftu', g);
        }
        // balconies on road-facing walls of 2+ storey houses
        if (balcony && e.win && e.L >= 4 && (e.road || hash2(i * 7.1, s2) < 0.35)) {
          const bw = Math.min(e.L - 1, 3 + hash2(i, s2) * 3.5), a0 = (e.L - bw) * (hash2(s, i + 7) < 0.5 ? 0.5 : 0.15), a1 = a0 + bw, dep = 1.05;
          for (let k = 1; k < floors; k++) {
            if (top + k * FLOOR < e.hid) continue;
            if (e.shop && k === 1) continue;
            const fb = top + k * FLOOR;
            trim.box(e.p, e.u, e.n, a0, a1, -0.02, dep, fb - 0.16, fb + 0.02, trimCol, 'ftulr', g);
            if (solid) {
              trim.box(e.p, e.u, e.n, a0, a1, dep - 0.1, dep, fb + 0.02, fb + 1.0, wallCol, 'fbtlr', g);
              for (const [aa, ab] of [[a0, a0 + 0.1], [a1 - 0.1, a1]]) trim.box(e.p, e.u, e.n, aa, ab, 0, dep - 0.1, fb + 0.02, fb + 1.0, wallCol, 'tlr', g);
              trim.box(e.p, e.u, e.n, a0 - 0.03, a1 + 0.03, dep - 0.13, dep + 0.03, fb + 1.0, fb + 1.06, trimCol, 'ftulr', g);
            } else {
              const P = (al, d, z) => [e.p[0] + e.u[0] * al + e.n[0] * d, e.p[1] + e.u[1] * al + e.n[1] * d, z];
              const z0r = fb + 0.02, z1r = fb + 1.02, ru = bw / 1.6, rd = dep / 1.6;
              rail.quad(P(a0, dep - 0.04, z0r), P(a1, dep - 0.04, z0r), P(a1, dep - 0.04, z1r), P(a0, dep - 0.04, z1r), [e.n[0], e.n[1], 0], railCol, [[0, 0], [ru, 0], [ru, 1], [0, 1]]);
              for (const al of [a0 + 0.02, a1 - 0.02]) rail.quad(P(al, 0, z0r), P(al, dep - 0.04, z0r), P(al, dep - 0.04, z1r), P(al, 0, z1r), [e.u[0], e.u[1], 0], railCol, [[0, 0], [rd, 0], [rd, 1], [0, 1]]);
            }
          }
        }
      }
      // AC outdoor units on a few walls, hung beside the windows
      if (style !== 'blank' && hash2(s2 * 17, s3) < (floors >= 3 ? 0.65 : 0.3)) {
        const cnt = 1 + (s > 0.6 ? 1 : 0) + (floors >= 4 ? 1 : 0);
        for (let q = 0; q < cnt; q++) {
          const cand = E.filter(e => e.win && e.L >= 3); if (!cand.length) break;
          const e = cand[Math.floor(R() * cand.length)], bays = Math.max(1, Math.round(e.L / BAY)), k = Math.floor(R() * floors);
          const al = bays > 1 ? (1 + Math.floor(R() * (bays - 1))) * e.L / bays : e.L * 0.18, fb = top + k * FLOOR;
          if (fb + 1.1 < e.hid) continue;
          if (e.shop && k === 0) continue;
          trim.box(e.p, e.u, e.n, al - 0.42, al + 0.42, 0.03, 0.33, fb + 1.1, fb + 1.68, AC, 'ftulr', Math.min(e.gA, e.gB));
          trim.box(e.p, e.u, e.n, al - 0.3, al + 0.3, 0.33, 0.34, fb + 1.2, fb + 1.58, C('#6f7376'), 'f');
        }
      }
    }

    // ---- roof ----
    const r2 = hash2(s * 5.1, s2 * 3.3);
    if (isTin) { // hipped tin roof rising toward the centroid, overhanging the walls
      const rc = C(ov.roofCol || TIN[Math.floor(s2 * 991) % TIN.length]);
      const rise = lst && lst.kind === 'namghar' ? Math.min(5, Math.sqrt(a) * 0.35) : Math.min(2.4, Math.sqrt(a) * 0.22);
      const apex = [b.c[0], b.c[1], z1 + rise];
      const eave = q => [q[0] + (q[0] - b.c[0]) * 0.07, q[1] + (q[1] - b.c[1]) * 0.07, z1 - 0.12];
      for (let i = 0; i < n; i++) {
        const A = eave(pts[i]), B = eave(pts[(i + 1) % n]), L = Math.hypot(B[0] - A[0], B[1] - A[1]);
        const ex = B[0] - A[0], ey = B[1] - A[1], ez = B[2] - A[2], fx = apex[0] - A[0], fy = apex[1] - A[1], fz = apex[2] - A[2];
        const nn = [ey * fz - ez * fy, ez * fx - ex * fz, ex * fy - ey * fx], nl = Math.hypot(...nn) || 1;
        const up = nn[2] < 0 ? -1 : 1, nrm = [nn[0] / nl * up, nn[1] / nl * up, nn[2] / nl * up];
        const slope = Math.hypot(apex[0] - (A[0] + B[0]) / 2, apex[1] - (A[1] + B[1]) / 2, rise);
        const shade = 0.88 + hash2(i, s) * 0.2, cc = rc.clone().multiplyScalar(shade);
        tin.quad(A, B, apex, apex, nrm, cc, [[0, 0], [L, 0], [L / 2, slope], [L / 2, slope]]);
      }
    } else {
      const rc = C(SLAB[Math.floor(hash2(s * 31, s2 * 7) * SLAB.length)]);
      const tri = THREE.ShapeUtils.triangulateShape(pts.map(p => new THREE.Vector2(p[0], p[1])), []);
      const k0 = roof.verts;
      for (const p of pts) { roof.pos.push(p[0], z1, -p[1]); roof.nor.push(0, 1, 0); roof.uv.push(p[0] / 7, p[1] / 7); roof.col.push(rc.r, rc.g, rc.b); roof.h.push(10); }
      for (const t of tri) roof.idx.push(k0 + t[0], k0 + t[2], k0 + t[1]);
      if (!unfinished) { // parapet with a concrete coping
        const ph = 0.95;
        for (let i = 0; i < n; i++) {
          const e = E[i]; if (e.hid >= z1) continue; // a taller neighbour (often a cut piece of the same blob) already stands in this plane
          wall(W.blank, e.p, e.q, e.n, z1, z1 + ph, wallCol.clone().multiplyScalar(0.96), top, 0, 0, z1 - 20, z1 - 20);
          trim.box(e.p, e.u, e.n, -0.03, e.L + 0.03, -0.18, 0.04, z1 + ph, z1 + ph + 0.07, trimCol, 'ft', -1e3);
        }
      } else { // unfinished top floor: stub columns with rusty rebar sticking out, at corners and every ~3.5 m
        for (let i = 0; i < n; i++) {
          const e = E[i], cnt = Math.max(1, Math.round(e.L / 3.5));
          for (let k = 0; k < cnt; k++) {
            const al = (k / cnt) * e.L, x = e.p[0] + e.u[0] * al - e.n[0] * 0.17, y = e.p[1] + e.u[1] * al - e.n[1] * 0.17;
            const hh = 0.9 + hash2(x, y) * 1.4, ang = Math.atan2(e.u[1], e.u[0]);
            trim.boxAt(x, y, ang, 0.3, 0.3, z1, z1 + hh, CONCRETE, 'fbtlr', -1e3);
            for (const [ox, oy] of [[-0.09, -0.09], [0.09, -0.09], [-0.09, 0.09], [0.09, 0.09]]) trim.boxAt(x + ox, y + oy, ang, 0.025, 0.025, z1 + hh, z1 + hh + 0.5 + hash2(ox + x, oy) * 0.4, REBAR, 'fblr', -1e3);
          }
        }
      }
      // staircase head room (mumty) on flat roofs of 2+ storey houses, kept out of the View point sightline
      let mumty = null;
      if (floors >= 2 && a > 70 && vw === null && !lst) {
        const e = E[longest], ang = Math.atan2(e.u[1], e.u[0]), mw = 2.6, md = 3.2;
        for (const [fa, fd] of [[0.25, -2.2], [0.75, -2.2], [0.5, -3.0], [0.2, -1.8]]) {
          const cx = e.p[0] + e.u[0] * e.L * fa + e.n[0] * fd, cy = e.p[1] + e.u[1] * e.L * fa + e.n[1] * fd;
          const ok = [[-1, -1], [1, -1], [1, 1], [-1, 1]].every(([sx, sy]) => pointInPoly(cx + e.u[0] * sx * (mw / 2 + 0.3) - e.n[0] * sy * (md / 2 + 0.3), cy + e.u[1] * sx * (mw / 2 + 0.3) - e.n[1] * sy * (md / 2 + 0.3), pts));
          if (ok) { mumty = { x: cx, y: cy, ang }; break; }
        }
        if (mumty) {
          const { x, y, ang: an } = mumty, mh = 2.5;
          trim.boxAt(x, y, an, mw, md, z1, z1 + mh, wallCol.clone().multiplyScalar(0.94), 'fbtlr', z1);
          trim.boxAt(x, y, an, mw + 0.35, md + 0.35, z1 + mh, z1 + mh + 0.12, trimCol, 'fbtulr', z1);
          // door on the face toward the building's long side
          const u = [Math.cos(an), Math.sin(an)], v = [-Math.sin(an), Math.cos(an)];
          trim.box([x - v[0] * md / 2, y - v[1] * md / 2], u, [-v[0], -v[1]], -0.45, 0.45, 0, 0.02, z1, z1 + 2.05, DOOR, 'f', z1);
        }
      }
      // black plastic water tanks, a fixture on nearly every RCC roof in Guwahati
      if (r2 < 0.78 && a > 50 && !lowSight) {
        if (mumty && r2 < 0.4) tanks.push({ x: mumty.x, y: mumty.y, z: z1 + 2.62 - 0.9, n: 1 });
        else {
          let tx = b.c[0] + (s - 0.5) * Math.sqrt(a) * 0.4, ty = b.c[1] + (s2 - 0.5) * Math.sqrt(a) * 0.4;
          if (!pointInPoly(tx, ty, pts)) { tx = b.c[0]; ty = b.c[1]; }
          if (pointInPoly(tx, ty, pts) && !(mumty && Math.hypot(tx - mumty.x, ty - mumty.y) < 2.6)) tanks.push({ x: tx, y: ty, z: z1, n: a > 300 ? 2 : 1 });
        }
      }
      if (!unfinished && !lowSight && !lst) ROOFS.push({ pts, E, z1, c: b.c, a, floors, mumty, longest });
    }
    BLD.push({ c: b.c, top: z1, floors });
    if (lst) decorateLandmark(b, lst, z1 + (isTin ? 0 : 0.95));
    const shopEdges = E.map((e, i) => (e.shop ? i : -1)).filter(i => i >= 0);
    if (shopEdges.length) SHOPLIST.push({ pts, edges: shopEdges, sign: lst && lst.kind === 'bank' ? 'bank' : null, wall: wallCol, floors, top });
  });
  buildShopfronts(SHOPLIST);
  let wv = 0, tv = 0, rv = 0;
  for (const c of CELLB.values()) {
    const o = { noMerge: true }; // mergeStatic would join the cells again and undo the culling
    for (const k in c.W) { c.W[k].mesh(FM[k], o); wv += c.W[k].verts; }
    c.trim.mesh(FM.trim, o); c.rail.mesh(FM.rail, { cast: true, noMerge: true }); c.roof.mesh(FM.roof, o); c.tin.mesh(FM.tin, o); tv += c.trim.verts; rv += c.rail.verts;
  }
  // tanks: black plastic with a ribbed body and a lid, on a short stand
  const tg = new THREE.CylinderGeometry(0.72, 0.78, 1.3, 14); tg.translate(0, 0.65 + 0.9, 0);
  const tm = new THREE.InstancedMesh(tg, new THREE.MeshStandardMaterial({ color: '#202326', roughness: 0.55 }), tanks.reduce((s, t) => s + t.n, 0));
  const dm = new THREE.Object3D(); let ti = 0;
  for (const t of tanks) for (let q = 0; q < t.n; q++) { dm.position.set(t.x + q * 1.8, t.z, -t.y); dm.updateMatrix(); tm.setMatrixAt(ti++, dm.matrix); }
  tm.castShadow = true; tm.receiveShadow = true; scene.add(tm);
  const stand = new THREE.BoxGeometry(1.7, 0.9, 1.7); stand.translate(0, 0.45, 0);
  const sm = new THREE.InstancedMesh(stand, new THREE.MeshStandardMaterial({ color: '#8f8b83', roughness: 0.9 }), tanks.length); ti = 0;
  for (const t of tanks) { dm.position.set(t.x + (t.n - 1) * 0.9, t.z, -t.y); dm.scale.set(t.n > 1 ? 2.1 : 1, 1, 1); dm.updateMatrix(); sm.setMatrixAt(ti++, dm.matrix); dm.scale.set(1, 1, 1); }
  sm.castShadow = sm.receiveShadow = true; scene.add(sm);
  if (import.meta.env.DEV) console.info(`[buildings] ${BLD.length} buildings, facade textures ${FM.ms.toFixed(0)} ms, cells ${CELLB.size}, verts: walls ${wv}, trim ${tv}, rail ${rv}`);
}

export { buildAll, WALLS, SHOP_WALLS, TIN, SLAB, tanks, BLD, SHOPLIST, ROOFS };
