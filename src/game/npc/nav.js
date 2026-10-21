import { GEO } from '../../core/geo.js';
import { walkable } from '../../ui/controls.js';
import { normalsOf } from '../../world/geom.js';
import { FP_W, MAINP, NRM, RF, asphHalf, edgeKind, hw, nearestOnMain } from '../../world/mainroad.js';

// ---------- pedestrian walk graph over the real lanes ----------
// Every lane gets two side tracks (keep-left: the left-hand track prefers the lane's own direction, the right-hand one the
// reverse) and the walkers' A* charges extra for going against a track. Mother Teresa Rd gets a footway on each shoulder with
// a few crossings. Junctions are joined where lane ends meet other lanes or the shoulder. Nodes that aren't walkable are dropped.
const STEP = 5, CELL = 10, WRONG = 1.4;
let NX = [], NY = [], ADJ = [], COST = [], XFLAG = []; // node coordinates, neighbours, cost of leaving for each neighbour, crossing nodes
let GRID = new Map(), alive = null, built = false, comp = null, mainComp = -1;
let gS = null, gP = null, gStamp = null, gClosed = null, stampNo = 0, heapN = null, heapF = null;

// even spacing by arc length (geom.resample keeps every vertex, and traced lanes have many close ones)
function evenly(pts, step) {
  const out = [[pts[0][0], pts[0][1]]]; let carry = 0;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i], L = Math.hypot(b[0] - a[0], b[1] - a[1]); if (L < 1e-6) continue;
    let d = step - carry; while (d <= L) { const t = d / L; out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]); d += step; }
    carry = L - (d - step);
  }
  const l = pts[pts.length - 1], e = out[out.length - 1];
  if (Math.hypot(l[0] - e[0], l[1] - e[1]) > 1.5) out.push([l[0], l[1]]); else out[out.length - 1] = [l[0], l[1]];
  return out;
}
const key = (cx, cy) => (cx + 5000) * 10000 + (cy + 5000);
const addNode = (x, y, cross = 0) => { NX.push(x); NY.push(y); ADJ.push([]); COST.push([]); XFLAG.push(cross); return NX.length - 1; };
function link(a, b, mab = 1, mba = 1) {
  if (a < 0 || b < 0 || a === b || ADJ[a].includes(b)) return;
  const d = Math.hypot(NX[a] - NX[b], NY[a] - NY[b]) + 0.01;
  ADJ[a].push(b); COST[a].push(d * mab); ADJ[b].push(a); COST[b].push(d * mba);
}
const dist = (a, b) => Math.hypot(NX[a] - NX[b], NY[a] - NY[b]);

// ---------- build ----------
function buildNav() {
  NX = []; NY = []; ADJ = []; COST = []; XFLAG = []; GRID = new Map(); built = false;
  const lanes = [];
  let mnY = 1e9, mxY = -1e9; for (const p of MAINP) { if (p[1] < mnY) mnY = p[1]; if (p[1] > mxY) mxY = p[1]; }
  const onCarriageway = (x, y) => { // inside the asphalt (or the median) of Mother Teresa Rd
    if (y < mnY - 25 || y > mxY + 25) return false;
    const [d, i] = nearestOnMain(x, y); return d < asphHalf(i) + 0.3;
  };
  // 1. lane side tracks
  GEO.roads.forEach(r => {
    if (!r.p || r.p.length < 2) return;
    let L = 0; for (let i = 1; i < r.p.length; i++) L += Math.hypot(r.p[i][0] - r.p[i - 1][0], r.p[i][1] - r.p[i - 1][1]);
    if (L < 4) return;
    const pts = evenly(r.p, STEP), nrm = normalsOf(pts), o = Math.max(0.6, r.w / 2 - 0.7);
    const ch = { 1: new Array(pts.length).fill(-1), '-1': new Array(pts.length).fill(-1) };
    for (let i = 0; i < pts.length; i++) {
      const [x, y] = pts[i]; if (onCarriageway(x, y)) continue;
      for (const s of [1, -1]) for (const f of [1, 0.5, 0]) {
        const off = f === 0 ? 0 : Math.max(0.5, o * f), px = x + nrm[i][0] * s * off, py = y + nrm[i][1] * s * off;
        if (!onCarriageway(px, py) && walkable(px, py)) { ch[s][i] = addNode(px, py); break; }
      }
    }
    for (const s of [1, -1]) for (let i = 1; i < pts.length; i++) {
      const a = ch[s][i - 1], b = ch[s][i]; let pa = a;
      if (pa < 0 && i >= 2) pa = ch[s][i - 2]; // hop over a single blocked sample
      if (pa >= 0 && b >= 0 && dist(pa, b) < 12) link(pa, b, s === 1 ? 1 : WRONG, s === 1 ? WRONG : 1);
    }
    if (r.w <= 9) for (let i = 0; i < pts.length; i += 3) link(ch[1][i], ch[-1][i], 1.6, 1.6); // people cross small lanes freely
    lanes.push({ pts, ch, w: r.w });
  });
  // 2. Mother Teresa Rd shoulders
  const SH = { 1: [], '-1': [] }; // [mainIndex, node]
  for (const s of [1, -1]) {
    let prev = -1, prevI = -1;
    for (let i = 0; i < MAINP.length; i += 2) {
      const off = asphHalf(i) + (edgeKind(s, i) === 'kerb' ? FP_W / 2 : 1.3), // people walk on the middle of the raised footpath
         x = MAINP[i][0] + NRM[i][0] * s * off, y = MAINP[i][1] + NRM[i][1] * s * off;
      if (!walkable(x, y)) continue;
      const n = addNode(x, y); SH[s].push([i, n]);
      if (prev >= 0 && i - prevI <= 4) link(prev, n); prev = n; prevI = i;
    }
  }
  const shoulderNear = (s, x, y, maxD) => { let best = -1, bd = maxD; for (const [, n] of SH[s]) { const d = Math.hypot(NX[n] - x, NY[n] - y); if (d < bd) { bd = d; best = n; } } return best; };
  // crossings between the two shoulders: Hatigarh, the bus stand, the field gate and the mandir. The bus stand's is a few metres west
  // of the shelter (x -57): right at it the north end landed in the corner where the field railing starts (x -58) and walkers got boxed in.
  for (const cx of RF.crossings.map(c => c.x)) { // road_features.json: the same list the median and the footpath railing open at
    let bi = 0, bd = 1e9; MAINP.forEach((p, i) => { const d = Math.abs(p[0] - cx); if (d < bd) { bd = d; bi = i; } });
    // a node exactly at the opening (the shoulder nodes are only every 5 m, so a straight line between them could clip the median's nose)
    const end = s => { const off = asphHalf(bi) + (edgeKind(s, bi) === 'kerb' ? FP_W / 2 : 1.3), x = MAINP[bi][0] + NRM[bi][0] * s * off, y = MAINP[bi][1] + NRM[bi][1] * s * off; if (!walkable(x, y)) return -1; const n = addNode(x, y), m = shoulderNear(s, x, y, 7); if (m >= 0) link(n, m); return n; };
    const a = end(1), b = end(-1); if (a < 0 || b < 0) continue;
    const len = dist(a, b), n = Math.max(2, Math.round(len / 3)); let prev = a;
    for (let k = 1; k < n; k++) { const t = k / n, m = addNode(NX[a] + (NX[b] - NX[a]) * t, NY[a] + (NY[b] - NY[a]) * t, 1); link(prev, m, 1.1, 1.1); prev = m; }
    link(prev, b, 1.1, 1.1);
  }
  // 3. junctions: lane ends meet other lanes (within (w1+w2)/2 + 2.5 m) or the main road shoulder; crossing lanes join mid-way
  const cg = new Map(), ck = (x, y) => key(Math.floor(x / 12), Math.floor(y / 12));
  lanes.forEach((ln, li) => ln.pts.forEach((p, i) => { const k = ck(p[0], p[1]); (cg.get(k) || cg.set(k, []).get(k)).push([li, i]); }));
  const sideNodes = (ln, i) => { const out = []; for (let j = i - 1; j <= i + 1; j++) if (j >= 0 && j < ln.pts.length) for (const s of [1, -1]) if (ln.ch[s][j] >= 0) out.push(ln.ch[s][j]); return out; };
  const join = (la, ia, lb, ib) => { // each side node of A at ia links to the nearest side node of B around ib, and the other way round
    const A = lanes[la], B = lanes[lb], bn = sideNodes(B, ib), an = sideNodes(A, ia);
    for (const s of [1, -1]) { const n = A.ch[s][ia]; if (n < 0) continue; let b = -1, bd = 1e9; for (const m of bn) { const d = dist(n, m); if (d < bd) { bd = d; b = m; } } if (b >= 0) link(n, b); }
    for (const s of [1, -1]) { const n = B.ch[s][ib]; if (n < 0) continue; let b = -1, bd = 1e9; for (const m of an) { const d = dist(n, m); if (d < bd) { bd = d; b = m; } } if (b >= 0) link(n, b); }
  };
  lanes.forEach((ln, li) => {
    for (const e of [0, ln.pts.length - 1]) {
      const [x, y] = ln.pts[e], best = new Map();
      for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (const [lj, j] of cg.get(ck(x + dx * 12, y + dy * 12)) || []) {
        if (lj === li) continue; const d = Math.hypot(lanes[lj].pts[j][0] - x, lanes[lj].pts[j][1] - y);
        if (d <= (ln.w + lanes[lj].w) / 2 + 2.5 && (!best.has(lj) || best.get(lj)[0] > d)) best.set(lj, [d, j]);
      }
      [...best.entries()].sort((a, b) => a[1][0] - b[1][0]).slice(0, 3).forEach(([lj, [, j]]) => join(li, e, lj, j));
      // meeting the main road: join the end to the shoulder on its side
      const [d, mi] = nearestOnMain(x, y);
      if (d < hw(mi) + 6) {
        const s = ((x - MAINP[mi][0]) * NRM[mi][0] + (y - MAINP[mi][1]) * NRM[mi][1]) >= 0 ? 1 : -1, sn = shoulderNear(s, x, y, 22);
        if (sn >= 0) for (const k of [1, -1]) link(ln.ch[k][e], sn);
      }
    }
  });
  // interior crossings: segments of different lanes that intersect
  const seen = new Set(), segX = (a, b, c, d) => {
    const r = (b[0] - a[0]) * (d[1] - c[1]) - (b[1] - a[1]) * (d[0] - c[0]); if (Math.abs(r) < 1e-9) return false;
    const t = ((c[0] - a[0]) * (d[1] - c[1]) - (c[1] - a[1]) * (d[0] - c[0])) / r, u = ((c[0] - a[0]) * (b[1] - a[1]) - (c[1] - a[1]) * (b[0] - a[0])) / r; return t >= 0 && t <= 1 && u >= 0 && u <= 1;
  };
  lanes.forEach((ln, li) => { for (let i = 0; i + 1 < ln.pts.length; i++) {
    const a = ln.pts[i], b = ln.pts[i + 1], x0 = Math.floor(Math.min(a[0], b[0]) / 12), x1 = Math.floor(Math.max(a[0], b[0]) / 12), y0 = Math.floor(Math.min(a[1], b[1]) / 12), y1 = Math.floor(Math.max(a[1], b[1]) / 12);
    for (let cx = x0; cx <= x1; cx++) for (let cy = y0; cy <= y1; cy++) for (const [lj, j] of cg.get(key(cx, cy)) || []) {
      if (lj <= li) continue; const B = lanes[lj].pts; for (const jj of [j - 1, j]) { if (jj < 0 || jj + 1 >= B.length) continue;
        const k = li * 1e9 + i * 1e5 + lj * 10 + (jj & 7); if (seen.has(k)) continue; seen.add(k);
        if (segX(a, b, B[jj], B[jj + 1])) { const ia = Math.hypot(a[0] - B[jj][0], a[1] - B[jj][1]) < Math.hypot(b[0] - B[jj][0], b[1] - B[jj][1]) ? i : i + 1; join(li, ia, lj, jj); join(li, i + 1 - (ia - i), lj, jj + 1); }
      }
    }
  } });
  // 4. keep the largest connected piece, index it for nearest-node queries and set up A* scratch space
  const N = NX.length; comp = new Int32Array(N); let sizes = []; const stack = [];
  const label = () => {
    comp.fill(-1); sizes = [];
    for (let s = 0; s < N; s++) {
      if (comp[s] >= 0) continue; const id = sizes.length; let c = 0; stack.push(s); comp[s] = id;
      while (stack.length) { const u = stack.pop(); c++; for (const v of ADJ[u]) if (comp[v] < 0) { comp[v] = id; stack.push(v); } }
      sizes.push(c);
    }
  };
  label();
  // lanes that touch nothing: bridge a separate piece to its nearest neighbour across open ground (<= 45 m, walkable all the way)
  const all = new Map(); for (let i = 0; i < N; i++) { const k = key(Math.floor(NX[i] / CELL), Math.floor(NY[i] / CELL)); (all.get(k) || all.set(k, []).get(k)).push(i); }
  for (let pass = 0; pass < 3; pass++) {
    const best = new Map(); // comp -> [dist, a, b]
    for (let a = 0; a < N; a++) {
      const c = comp[a]; if (sizes[c] < 6) continue; const cx = Math.floor(NX[a] / CELL), cy = Math.floor(NY[a] / CELL);
      for (let i = cx - 4; i <= cx + 4; i++) for (let j = cy - 4; j <= cy + 4; j++) for (const b of all.get(key(i, j)) || []) {
        if (comp[b] === c) continue; const d = dist(a, b); if (d <= 45 && (!best.get(c) || best.get(c)[0] > d)) best.set(c, [d, a, b]);
      }
    }
    let joined = 0;
    for (const [, [d, a, b]] of best) {
      let clear = true; for (let t = 1; t < 6 && clear; t++) clear = walkable(NX[a] + (NX[b] - NX[a]) * t / 6, NY[a] + (NY[b] - NY[a]) * t / 6);
      if (clear) { link(a, b, 1.3, 1.3); joined++; }
    }
    if (!joined) break; label();
  }
  mainComp = sizes.indexOf(Math.max(...sizes, 0)); alive = new Uint8Array(N);
  for (let i = 0; i < N; i++) if (comp[i] === mainComp) { alive[i] = 1; const k = key(Math.floor(NX[i] / CELL), Math.floor(NY[i] / CELL)); (GRID.get(k) || GRID.set(k, []).get(k)).push(i); }
  gS = new Float32Array(N); gP = new Int32Array(N); gStamp = new Int32Array(N); gClosed = new Int32Array(N); stampNo = 0; heapN = new Int32Array(1 << 16); heapF = new Float32Array(1 << 16);
  built = true;
  return { nodes: N, alive: sizes[mainComp] || 0, components: sizes.length, lanes: lanes.length };
}

// ---------- queries ----------
// ok(n): an optional filter, e.g. no road-crossing nodes for somewhere people are meant to stand about
function nearestNode(x, y, ok) {
  if (!built || !alive) return -1;
  const cx = Math.floor(x / CELL), cy = Math.floor(y / CELL); let best = -1, bd = 1e9;
  for (let r = 0; r <= 6; r++) {
    for (let i = cx - r; i <= cx + r; i++) for (let j = cy - r; j <= cy + r; j++) {
      if (Math.max(Math.abs(i - cx), Math.abs(j - cy)) !== r) continue;
      const l = GRID.get(key(i, j)); if (!l) continue;
      for (const n of l) { if (ok && !ok(n)) continue; const d = Math.hypot(NX[n] - x, NY[n] - y); if (d < bd) { bd = d; best = n; } }
    }
    if (best >= 0 && bd <= r * CELL) break;
  }
  if (best < 0) for (let n = 0; n < NX.length; n++) if (alive[n] && (!ok || ok(n))) { const d = Math.hypot(NX[n] - x, NY[n] - y); if (d < bd) { bd = d; best = n; } }
  return best;
}
// a start node near (x, y), preferring ones ahead of the walker so a path doesn't open by turning back
// the first node of a walk: near, ahead rather than behind, and one that can be walked to in a straight line (a node just past a
// railing or a wall would leave the walker sliding along it)
const clearTo = (x, y, n) => { const d = Math.hypot(NX[n] - x, NY[n] - y); for (let t = 0.3; t < d; t += 0.3) if (!walkable(x + (NX[n] - x) * t / d, y + (NY[n] - y) * t / d)) return false; return true; };
function startNode(x, y, hdg) {
  const cx = Math.floor(x / CELL), cy = Math.floor(y / CELL), hx = Math.cos(hdg || 0), hy = Math.sin(hdg || 0), cand = [];
  for (let i = cx - 1; i <= cx + 1; i++) for (let j = cy - 1; j <= cy + 1; j++) { const l = GRID.get(key(i, j)); if (!l) continue;
    for (const n of l) { const dx = NX[n] - x, dy = NY[n] - y, d = Math.hypot(dx, dy); if (d > 14) continue; cand.push([d + (hdg != null && d > 1 && (dx * hx + dy * hy) / d < -0.2 ? 6 : 0), n]); } }
  if (!cand.length) return nearestNode(x, y);
  cand.sort((a, b) => a[0] - b[0]);
  for (let k = 0; k < Math.min(cand.length, 6); k++) if (clearTo(x, y, cand[k][1])) return cand[k][1];
  return cand[0][1];
}
function randomPoint(near, minD = 20, maxD = 120) {
  if (!built || !alive) return { x: near ? near.x : 0, y: near ? near.y : 0, node: -1 };
  const ox = near ? near.x : 0, oy = near ? near.y : 0;
  for (let t = 0; t < 24; t++) {
    const a = Math.random() * 6.2832, d = minD + Math.random() * (maxD - minD), n = nearestNode(ox + Math.cos(a) * d, oy + Math.sin(a) * d);
    if (n >= 0) { const dd = Math.hypot(NX[n] - ox, NY[n] - oy); if (dd >= minD * 0.8 && dd <= maxD * 1.2) return { x: NX[n], y: NY[n], node: n }; }
  }
  let best = -1, bd = 1e9; const mid = (minD + maxD) / 2; // fallback: the alive node whose distance is closest to the middle of the range
  for (let n = 0; n < NX.length; n += 3) if (alive[n]) { const d = Math.abs(Math.hypot(NX[n] - ox, NY[n] - oy) - mid) + Math.random() * 20; if (d < bd) { bd = d; best = n; } }
  return best >= 0 ? { x: NX[best], y: NY[best], node: best } : { x: ox, y: oy, node: -1 };
}
// like randomPoint, but only in a cone (angle ang +- spread, map angle), e.g. "behind the camera"
function randomPointDir(near, minD, maxD, ang, spread) {
  if (!built || !alive) return randomPoint(near, minD, maxD);
  for (let t = 0; t < 14; t++) {
    const a = ang + (Math.random() * 2 - 1) * spread, d = minD + Math.random() * (maxD - minD), n = nearestNode(near.x + Math.cos(a) * d, near.y + Math.sin(a) * d);
    if (n >= 0) { const dd = Math.hypot(NX[n] - near.x, NY[n] - near.y); if (dd >= minD * 0.85 && dd <= maxD * 1.15) return { x: NX[n], y: NY[n], node: n }; }
  }
  return randomPoint(near, minD, maxD);
}

// ---------- A* (binary heap with lazy deletion, reusable typed scratch arrays) ----------
function astar(s, e) {
  const stamp = ++stampNo; let hn = 0, expanded = 0; const ex = NX[e], ey = NY[e];
  const push = (n, f) => { if (hn >= heapN.length) return false; let i = hn++; while (i > 0) { const p = (i - 1) >> 1; if (heapF[p] <= f) break; heapN[i] = heapN[p]; heapF[i] = heapF[p]; i = p; } heapN[i] = n; heapF[i] = f; return true; };
  const pop = () => { const top = heapN[0], n = heapN[--hn], f = heapF[hn]; let i = 0; for (;;) { let c = 2 * i + 1; if (c >= hn) break; if (c + 1 < hn && heapF[c + 1] < heapF[c]) c++; if (heapF[c] >= f) break; heapN[i] = heapN[c]; heapF[i] = heapF[c]; i = c; } heapN[i] = n; heapF[i] = f; return top; };
  gStamp[s] = stamp; gS[s] = 0; gP[s] = -1; push(s, Math.hypot(NX[s] - ex, NY[s] - ey));
  while (hn > 0 && expanded < 30000) {
    const u = pop(); if (gClosed[u] === stamp) continue; gClosed[u] = stamp; expanded++;
    if (u === e) return true;
    const A = ADJ[u], C = COST[u];
    for (let k = 0; k < A.length; k++) {
      const v = A[k]; if (!alive[v] || gClosed[v] === stamp) continue; const g = gS[u] + C[k];
      if (gStamp[v] !== stamp || g < gS[v]) { gStamp[v] = stamp; gS[v] = g; gP[v] = u; push(v, g + Math.hypot(NX[v] - ex, NY[v] - ey)); }
    }
  }
  return false;
}
// hdg (optional map angle of the walker) steers the start node forwards; returns [[x, y], ...] ending at (bx, by) when it is near the graph
function findPath(ax, ay, bx, by, hdg) {
  if (!built) return null;
  const s = startNode(ax, ay, hdg), e = nearestNode(bx, by); if (s < 0 || e < 0) return null;
  if (!astar(s, e)) return null;
  const rev = []; for (let n = e; n >= 0; n = gP[n]) rev.push(n);
  const out = []; for (let i = rev.length - 1; i >= 0; i--) out.push([NX[rev[i]], NY[rev[i]], XFLAG[rev[i]]]); // third value 1 = on a road crossing
  if (out.length > 1 && Math.hypot(out[1][0] - ax, out[1][1] - ay) < Math.hypot(out[1][0] - out[0][0], out[1][1] - out[0][1])) out.shift(); // already past the first node
  if (Math.hypot(bx - NX[e], by - NY[e]) <= 25) out.push([bx, by]);
  return out;
}
const nodeCount = () => NX.length;
const nodeXY = (n, out) => { out[0] = NX[n]; out[1] = NY[n]; return out; };
const isCrossNode = n => n >= 0 && XFLAG[n] === 1;

export { buildNav, randomPoint, randomPointDir, findPath, nearestNode, nodeCount, nodeXY, isCrossNode };
