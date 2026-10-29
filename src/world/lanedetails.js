import * as THREE from 'three';
import { GEO, clsAt, hAt, hash2, pointInPoly } from '../core/geo.js';
import { QUALITY } from '../render/quality.js';
import { MeshBuilder } from './bldg/mesh.js';
import { resample, normalsOf } from './geom.js';
import { laneWidth } from './streets.js';
import { GATE_POSTS } from './compound.js';
import { MAINP, hw } from './mainroad.js';

// Reconstructed utilitarian finishes, not a survey of individual drains or walls.
// Drain runs use exactly the same class-raster rule as streets.buildLanes; low
// retaining faces require an actual downhill height difference in the terrain.
const LIMIT = { low: { groups: 18, seams: 18, cell: 160 }, medium: { groups: 32, seams: 12, cell: 120 }, high: { groups: 52, seams: 8, cell: 96 } };
const UP = [0, 0, 1];
const hillConcrete = p => p[0] > 40 && p[0] < 175 && p[1] > 70 && p[1] < 262;
const builtClass = (x, y) => { const c = clsAt(x, y); return c === 2 || c === 3; };
const gridKey = (x, y) => Math.floor(x / 8) + ',' + Math.floor(y / 8);
let mainGrid = new Map();
function nearMain(x, y) {
  const cx = Math.floor(x / 8), cy = Math.floor(y / 8);
  for (let a = -3; a <= 3; a++) for (let b = -3; b <= 3; b++) for (const p of mainGrid.get((cx + a) + ',' + (cy + b)) || []) {
    if (Math.hypot(x - p.x, y - p.y) < p.r) return true;
  }
  return false;
}

function lanePoint(lane, i, side, offset) {
  const p = lane.P[i], n = lane.N[i];
  return [p[0] + n[0] * side * (lane.w / 2 + offset), p[1] + n[1] * side * (lane.w / 2 + offset)];
}
function gateGap(a, b, margin = 0.5) {
  // Existing open gate widths, not guessed driveway positions.
  const dx = b[0] - a[0], dy = b[1] - a[1], length2 = dx * dx + dy * dy || 1;
  return GATE_POSTS.some(g => {
    if (!g.lane || !g.open) return false;
    const t = Math.max(0, Math.min(1, ((g.x - a[0]) * dx + (g.y - a[1]) * dy) / length2));
    return Math.hypot(g.x - a[0] - t * dx, g.y - a[1] - t * dy) < g.hg + margin;
  });
}
function roadGrid(lanes) {
  const grid = new Map();
  for (const l of lanes) for (let i = 0; i < l.P.length; i++) {
    const p = l.P[i];
    const key = gridKey(p[0], p[1]);
    if (!grid.has(key)) grid.set(key, []);
    grid.get(key).push({ x: p[0], y: p[1], w: l.w, id: l.id, lane: l, i });
  }
  return grid;
}
function otherRoad(x, y, id, grid, margin = 1) {
  const cx = Math.floor(x / 8), cy = Math.floor(y / 8);
  for (let a = -2; a <= 2; a++) for (let b = -2; b <= 2; b++) for (const p of grid.get((cx + a) + ',' + (cy + b)) || []) {
    if (p.id !== id && Math.hypot(p.x - x, p.y - y) < p.w / 2 + margin) return p;
  }
  return null;
}
function clearStructure(lane, i, side, offset, grid) {
  const a = lanePoint(lane, i, side, offset), b = lanePoint(lane, i + 1, side, offset);
  if (gateGap(a, b, 0.8)) return false;
  for (const p of [a, b, [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]]) {
    if (nearMain(p[0], p[1]) || otherRoad(p[0], p[1], lane.id, grid)) return false;
    if (clsAt(p[0], p[1]) === 1 || clsAt(p[0], p[1]) >= 4) return false;
    if (pointInPoly(p[0], p[1], GEO.fieldPoly) || pointInPoly(p[0], p[1], GEO.parkPoly)) return false;
  }
  return true;
}

// The drain base already exists as a 45 cm strip at +5 cm in streets.js.
// Interpolate its existing sample vertices, then add a shallow lip and dark bed.
function drainPoint(lane, i, side, q, extra = 0) {
  const a = lanePoint(lane, i, side, 0), b = lanePoint(lane, i, side, 0.45);
  return [a[0] + (b[0] - a[0]) * q, a[1] + (b[1] - a[1]) * q,
    hAt(...a) * (1 - q) + hAt(...b) * q + 0.05 + extra];
}
function drainRibbon(builder, lane, i, side, q0, q1, extra, color) {
  builder.quad(drainPoint(lane, i, side, q0, extra), drainPoint(lane, i + 1, side, q0, extra),
    drainPoint(lane, i + 1, side, q1, extra), drainPoint(lane, i, side, q1, extra), UP, color);
}
function bridgePoint(lane, f, side, q) {
  const i = Math.min(lane.P.length - 2, Math.floor(f)), t = f - i;
  const A = drainPoint(lane, i, side, 0), B = drainPoint(lane, i, side, 1);
  const C = drainPoint(lane, i + 1, side, 0), D = drainPoint(lane, i + 1, side, 1);
  return A.map((_, k) => (t + q <= 1 ? A[k] + t * (C[k] - A[k]) + q * (B[k] - A[k])
    : D[k] + (1 - t) * (B[k] - D[k]) + (1 - q) * (C[k] - D[k])) + (k === 2 ? 0.027 : 0));
}
function laneSurfacePoint(lane, f, q, lift = 0.012) {
  const i = Math.min(lane.P.length - 2, Math.floor(f)), t = f - i;
  const point = (j, side) => { const p = lanePoint(lane, j, side, 0); return [p[0], p[1], hAt(...p) + 0.07]; };
  const A = point(i, -1), B = point(i, 1), C = point(i + 1, -1), D = point(i + 1, 1);
  return A.map((_, k) => (t + q <= 1 ? A[k] + t * (C[k] - A[k]) + q * (B[k] - A[k])
    : D[k] + (1 - t) * (B[k] - D[k]) + (1 - q) * (C[k] - D[k])) + (k === 2 ? lift : 0));
}
function cornerSurfacePoint(p, width, radius, angle) {
  // buildLanes end caps use geom.disc's 18-sided triangle fan.
  const step = Math.PI * 2 / 18, theta = Math.floor(angle / step) * step, R = width / 2;
  const ax = Math.cos(theta) * R, ay = Math.sin(theta) * R, bx = Math.cos(theta + step) * R, by = Math.sin(theta + step) * R;
  const dx = Math.cos(angle) * radius, dy = Math.sin(angle) * radius, det = ax * by - ay * bx;
  const a = (dx * by - dy * bx) / det, b = (ax * dy - ay * dx) / det;
  return [p[0] + dx, p[1] + dy, hAt(...p) * (1 - a - b) + hAt(p[0] + ax, p[1] + ay) * a + hAt(p[0] + bx, p[1] + by) * b + 0.081];
}
function retainingDrop(lane, i, side) {
  const a = lanePoint(lane, i, side, 0), b = lanePoint(lane, i, side, 1.6);
  return hAt(...a) - hAt(...b);
}
function retainingFace(builder, lane, i, side, color, cap) {
  const a = lanePoint(lane, i, side, 0.82), b = lanePoint(lane, i + 1, side, 0.82);
  const c = lanePoint(lane, i, side, 0.96), d = lanePoint(lane, i + 1, side, 0.96);
  const edgeA = lanePoint(lane, i, side, 0), edgeB = lanePoint(lane, i + 1, side, 0);
  const topA = Math.min(hAt(...edgeA) + 0.06, hAt(...a) + 0.42), topB = Math.min(hAt(...edgeB) + 0.06, hAt(...b) + 0.42);
  const A = [a[0], a[1], topA], B = [b[0], b[1], topB], C = [c[0], c[1], topA], D = [d[0], d[1], topB];
  const n = [side * lane.N[i][0], side * lane.N[i][1], 0];
  builder.quad([c[0], c[1], hAt(...c) - 0.08], [d[0], d[1], hAt(...d) - 0.08], D, C, n, color);
  builder.quad(A, B, D, C, UP, cap);
  // Short return faces stop each low plinth neatly instead of leaving open ends.
  builder.quad([a[0], a[1], hAt(...a) - 0.08], A, C, [c[0], c[1], hAt(...c) - 0.08], [-lane.N[i][1], lane.N[i][0], 0], color);
  builder.quad([b[0], b[1], hAt(...b) - 0.08], [d[0], d[1], hAt(...d) - 0.08], D, B, [lane.N[i][1], -lane.N[i][0], 0], color);
}

let done = false;
function buildLaneDetails() {
  if (done) return; done = true;
  const cfg = LIMIT[QUALITY] || LIMIT.medium, cells = new Map();
  mainGrid = new Map();
  MAINP.forEach((p, i) => { const key = gridKey(...p); if (!mainGrid.has(key)) mainGrid.set(key, []); mainGrid.get(key).push({ x: p[0], y: p[1], r: hw(i) + 6 }); });
  const lanes = GEO.roads.filter(r => r.p?.length >= 2 && r.w >= 2.5).map((r, id) => {
    const P = resample(r.p, 2), S = [0];
    for (let i = 1; i < P.length; i++) S.push(S[i - 1] + Math.hypot(P[i][0] - P[i - 1][0], P[i][1] - P[i - 1][1]));
    return { id, P, N: normalsOf(P), S, w: laneWidth(r), name: r.name || '' };
  });
  const grid = roadGrid(lanes), groups = [];
  const stat = { groups: 0, drainSegments: 0, retainingSegments: 0, bridges: 0, corners: 0, seams: 0, meshes: 0, vertices: 0 };
  const gray = new THREE.Color('#8b887b'), damp = new THREE.Color('#555c4b'), bed = new THREE.Color('#3e4039');
  const concrete = new THREE.Color('#a29d8c'), wear = new THREE.Color('#8d8877'), seam = new THREE.Color('#68675e');
  const cellAt = p => {
    const key = Math.floor(p[0] / cfg.cell) + ',' + Math.floor(p[1] / cfg.cell);
    if (!cells.has(key)) cells.set(key, { flat: new MeshBuilder(), raised: new MeshBuilder() });
    return cells.get(key);
  };
  // Candidate runs are consecutive 20 m pieces, ranked deterministically. Higher
  // presets add complete runs rather than scattering more disconnected ornaments.
  for (const lane of lanes) for (let start = 1; start < lane.P.length - 2; start += 10) {
    const end = Math.min(lane.P.length - 2, start + 10), work = [];
    for (let i = start; i < end; i++) for (const side of [1, -1]) {
      if (!clearStructure(lane, i, side, 0.55, grid)) continue;
      const a = lanePoint(lane, i, side, 0.6), b = lanePoint(lane, i + 1, side, 0.6);
      const drain = builtClass(...a) && builtClass(...b);
      const retain = !drain && retainingDrop(lane, i, side) > 0.28 && retainingDrop(lane, i + 1, side) > 0.28
        && clearStructure(lane, i, side, 0.9, grid) && !builtClass(...lanePoint(lane, i, side, 0.9));
      if (drain || retain) work.push({ i, side, drain });
    }
    if (work.length) groups.push({ lane, start, work, score: hash2(lane.P[start][0], lane.P[start][1]) + (lane.name ? 0 : 1) });
  }
  groups.sort((a, b) => a.score - b.score);
  const selected = groups.slice(0, cfg.groups);
  const activeRanges = new Map();
  for (const group of selected) {
    if (!activeRanges.has(group.lane.id)) activeRanges.set(group.lane.id, []);
    activeRanges.get(group.lane.id).push([group.lane.S[group.start], group.lane.S[Math.min(group.lane.P.length - 2, group.start + 10)]]);
  }
  for (const group of selected) {
    stat.groups++;
    const { lane } = group;
    for (const { i, side, drain } of group.work) {
      const cell = cellAt(lane.P[i]);
      if (drain) {
        drainRibbon(cell.flat, lane, i, side, 0.17, 0.83, 0.007, bed);
        drainRibbon(cell.raised, lane, i, side, 0, 0.13, 0.045, gray);
        drainRibbon(cell.raised, lane, i, side, 0.87, 1, 0.035, damp);
        const n = [side * lane.N[i][0], side * lane.N[i][1], 0];
        cell.raised.quad(drainPoint(lane, i, side, 0.13, 0.007), drainPoint(lane, i + 1, side, 0.13, 0.007),
          drainPoint(lane, i + 1, side, 0.13, 0.045), drainPoint(lane, i, side, 0.13, 0.045), n, damp);
        cell.raised.quad(drainPoint(lane, i, side, 0.87, 0.007), drainPoint(lane, i + 1, side, 0.87, 0.007),
          drainPoint(lane, i + 1, side, 0.87, 0.035), drainPoint(lane, i, side, 0.87, 0.035), n.map(v => -v), gray);
        stat.drainSegments++;
      } else { retainingFace(cell.raised, lane, i, side, damp, concrete); stat.retainingSegments++; }
    }
  }

  // Bridge only an existing open gate's actual approach, and only if the class
  // data already calls for a drain there. No invented entrances or raised steps.
  for (const gate of GATE_POSTS) {
    if (!gate.lane || !gate.open || stat.bridges >= cfg.groups * 2) continue;
    let nearest = null, distance = 3;
    const cx = Math.floor(gate.x / 8), cy = Math.floor(gate.y / 8), candidates = new Map();
    for (let a = -2; a <= 2; a++) for (let b = -2; b <= 2; b++) for (const point of grid.get((cx + a) + ',' + (cy + b)) || []) {
      if (point.i > 0 && point.i < point.lane.P.length - 2) candidates.set(point.id + ':' + point.i, point);
    }
    for (const point of candidates.values()) for (const side of [1, -1]) {
      const l = point.lane, i = point.i;
      const p = lanePoint(l, i, side, 1.7), q = lanePoint(l, i + 1, side, 1.7);
      const dx = q[0] - p[0], dy = q[1] - p[1], length2 = dx * dx + dy * dy || 1;
      const t = Math.max(0, Math.min(1, ((gate.x - p[0]) * dx + (gate.y - p[1]) * dy) / length2));
      const d = Math.hypot(p[0] + t * dx - gate.x, p[1] + t * dy - gate.y);
      if (d < distance) { distance = d; nearest = { l, i, side, arc: l.S[i] + t * (l.S[i + 1] - l.S[i]) }; }
    }
    if (!nearest) continue;
    const { l, i, side, arc } = nearest, center = lanePoint(l, i, side, 0.6);
    if (!builtClass(...center)) continue;
    if (nearMain(center[0], center[1]) || otherRoad(center[0], center[1], l.id, grid, 1.5)) continue;
    const builder = cellAt(center).flat;
    // Existing resampled strips retain their own heights along the whole bridge.
    let segments = 0;
    for (let j = Math.max(1, i - 2); j <= Math.min(l.P.length - 3, i + 2); j++) {
      const start = Math.max(l.S[j], arc - gate.hg * 0.9), end = Math.min(l.S[j + 1], arc + gate.hg * 0.9);
      if (end - start < 0.05) continue;
      const probe = lanePoint(l, j, side, 0.6);
      if (!builtClass(...probe) || otherRoad(probe[0], probe[1], l.id, grid, 1.5)) continue;
      const span = l.S[j + 1] - l.S[j] || 1, f0 = j + (start - l.S[j]) / span, f1 = j + (end - l.S[j]) / span;
      builder.quad(bridgePoint(l, f0, side, 0), bridgePoint(l, f1, side, 0), bridgePoint(l, f1, side, 1), bridgePoint(l, f0, side, 1), UP, concrete); segments++;
    }
    if (segments) stat.bridges++;
  }

  // Weathered concrete joints on the existing hill road; elsewhere, only short
  // edge seams. Flush overlays never narrow a road or change navigation.
  const cornerKeys = new Set();
  for (const lane of lanes) {
    const ranges = activeRanges.get(lane.id); if (!ranges) continue;
    const activeAt = arc => ranges.some(([a, b]) => arc >= a - 4 && arc <= b + 4);
    let lastSeam = 0;
    for (let i = 1; i < lane.P.length - 2; i++) {
      if (!activeAt(lane.S[i])) continue;
      if (lane.S[i] - lastSeam < cfg.seams || stat.seams >= cfg.groups * 30) continue;
      lastSeam = lane.S[i];
      if (nearMain(...lane.P[i]) || otherRoad(...lane.P[i], lane.id, grid, 2)) continue;
      const a = lane.P[i], builder = cellAt(a).flat;
      // Stay inside the same source triangle even at very short traced segments.
      const fraction = Math.min(0.015, 0.025 / (lane.S[i + 1] - lane.S[i] || 1));
      const strips = hillConcrete(a) ? [[-0.46, 0.46]] : [[-0.48, -0.34], [0.34, 0.48]];
      for (const [lo, hi] of strips) {
        const point = (q, u) => laneSurfacePoint(lane, i + u * fraction, q + 0.5);
        builder.quad(point(lo, 0), point(hi, 0), point(hi, 1), point(lo, 1), UP, seam);
      }
      stat.seams++;
    }
    for (const i of [0, lane.P.length - 1]) {
      if (!activeAt(lane.S[i])) continue;
      const p = lane.P[i], other = otherRoad(...p, lane.id, grid, 0.5);
      if (!other || nearMain(...p)) continue;
      const key = Math.round(p[0] / 4) + ',' + Math.round(p[1] / 4);
      if (cornerKeys.has(key) || stat.corners >= cfg.groups * 2) continue; cornerKeys.add(key);
      const builder = cellAt(p).flat, n = lane.N[i], dir = i === 0 ? -1 : 1;
      const angle = Math.atan2(-n[0] * dir, n[1] * dir);
      for (const side of [-1, 1]) {
        const a = angle + side * 0.55, b = angle + side * 1.1;
        const point = (r, theta) => cornerSurfacePoint(p, lane.w, r, theta);
        // Each wedge remains in one of the original cap's triangle-fan faces.
        const step = Math.PI * 2 / 18, end = Math.max(a, b);
        for (let start = Math.min(a, b); start < end - 1e-6;) {
          const stop = Math.min(end, (Math.floor(start / step + 1e-6) + 1) * step);
          builder.quad(point(lane.w * 0.36, start), point(lane.w * 0.46, start), point(lane.w * 0.46, stop), point(lane.w * 0.36, stop), UP, wear);
          start = stop;
        }
      }
      stat.corners++;
    }
  }
  const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.96 });
  for (const [key, cell] of cells) for (const layer of ['flat', 'raised']) {
    const builder = cell[layer], mesh = builder.mesh(material, { cast: layer === 'raised' });
    if (mesh) { mesh.name = `lane_details_${layer}_${key}`; stat.meshes++; stat.vertices += builder.verts; }
  }
  return stat;
}

export { buildLaneDetails };
