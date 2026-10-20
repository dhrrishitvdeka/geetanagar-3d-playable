import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { scene } from '../core/context.js';
import { hAt } from '../core/geo.js';
import { M } from './materials.js';

// ---- geometry helpers ----
function resample(pts, step = 2) {
  const out = [pts[0]];
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i], L = Math.hypot(b[0] - a[0], b[1] - a[1]), n = Math.max(1, Math.ceil(L / step));
    for (let k = 1; k <= n; k++) { const t = k / n; out.push(a.length > 2 ? [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t] : [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]); }
  }
  return out;
}
function normalsOf(pts) {
  return pts.map((p, i) => {
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
    const dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy) || 1; return [-dy / l, dx / l];
  });
}
// a strip between two lateral offsets (functions of the point index), draped on the terrain
function strip(pts, offA, offB, yA, yB, worldUV = 4, along = false) {
  const n = normalsOf(pts), pos = [], uv = [], idx = []; let s = 0;
  pts.forEach((p, i) => {
    if (i) s += Math.hypot(p[0] - pts[i - 1][0], p[1] - pts[i - 1][1]);
    const oa = typeof offA === 'function' ? offA(i) : offA, ob = typeof offB === 'function' ? offB(i) : offB;
    const ax = p[0] + n[i][0] * oa, ay = p[1] + n[i][1] * oa, bx = p[0] + n[i][0] * ob, by = p[1] + n[i][1] * ob;
    const ha = hAt(ax, ay), hb = hAt(bx, by);
    pos.push(ax, ha + yA, -ay, bx, hb + yB, -by);
    if (along) uv.push(s / worldUV, 0, s / worldUV, 1); else uv.push(ax / worldUV, ay / worldUV, bx / worldUV, by / worldUV);
    if (i) { const k = (i - 1) * 2; idx.push(k, k + 2, k + 1, k + 1, k + 2, k + 3); }
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx); g.computeVertexNormals(); return g;
}
function mergeAdd(geos, mat, shadow = false) {
  if (!geos.length) return;
  const g = mergeGeometries(geos, false); const m = new THREE.Mesh(g, mat); m.receiveShadow = true; m.castShadow = shadow; scene.add(m); geos.forEach(x => x.dispose()); return m;
}
function disc(x, y, r, yOff) {
  const g = new THREE.CircleGeometry(r, 18); g.rotateX(-Math.PI / 2);
  const p = g.attributes.position, uv = g.attributes.uv;
  for (let i = 0; i < p.count; i++) { const wx = p.getX(i) + x, wy = -p.getZ(i) + y; p.setXYZ(i, wx, hAt(wx, wy) + yOff, -wy); uv.setXY(i, wx / 4, wy / 4); }
  g.computeVertexNormals(); return g;
}

// ---- colliders: railings, fences and walls you can't walk through ----
const COLL = new Map(), CC = 10;
function addCollider(a, b) {
  const x0 = Math.floor(Math.min(a[0], b[0]) / CC), x1 = Math.floor(Math.max(a[0], b[0]) / CC), y0 = Math.floor(Math.min(a[1], b[1]) / CC), y1 = Math.floor(Math.max(a[1], b[1]) / CC);
  for (let i = x0; i <= x1; i++) for (let j = y0; j <= y1; j++) { const k = i + ',' + j; (COLL.get(k) || COLL.set(k, []).get(k)).push([a, b]); }
}
function blockedBySeg(x, y, r = 0.3) {
  const l = COLL.get(Math.floor(x / CC) + ',' + Math.floor(y / CC)); if (!l) return false;
  for (const [a, b] of l) {
    const dx = b[0] - a[0], dy = b[1] - a[1], L2 = dx * dx + dy * dy || 1; let t = ((x - a[0]) * dx + (y - a[1]) * dy) / L2; t = Math.max(0, Math.min(1, t));
    if (Math.hypot(x - a[0] - dx * t, y - a[1] - dy * t) < r) return true;
  }
  return false;
}

// ---- railings along a polyline, skipping gaps ----
const railBits = { post: [], rail: [] };
// infill: material key for an alpha-tested vertical-bar panel (one cheap strip instead of thousands of balusters)
function railing(pts, { h = 1.0, spacing = 2.0, postMat = 'black', railMat = 'black', rails = [0.35, 0.95], skip = () => false, base = 0, collide = true, post: ps = 0.06, infill = null, infillSpan = [0.08, 0.92] }) {
  const post = new THREE.BoxGeometry(ps, 1, ps); post.translate(0, 0.5, 0);
  let acc = spacing, run = [];
  const endRun = () => { if (infill && run.length > 1) railBits.post.push([strip(run, 0, 0, base + infillSpan[0] * h, base + infillSpan[1] * h, 1.2, true), infill]); run = []; };
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i], L = Math.hypot(b[0] - a[0], b[1] - a[1]); if (L < 0.01) continue;
    const mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    if (skip(mid)) { if (acc < spacing && run.length) { const p = post.clone(); p.scale(1, h, 1); p.translate(a[0], hAt(a[0], a[1]) + base, -a[1]); railBits.post.push([p, postMat]); } acc = spacing; endRun(); continue; }
    if (!run.length) run.push(a); run.push(b);
    const ha = hAt(a[0], a[1]) + base, hb = hAt(b[0], b[1]) + base, ang = Math.atan2(b[1] - a[1], b[0] - a[0]);
    for (const rh of rails) {
      const r = new THREE.BoxGeometry(L, 0.05, 0.04); r.rotateY(ang); r.translate(mid[0], (ha + hb) / 2 + rh * h, -mid[1]);
      railBits.rail.push([r, railMat]);
    }
    acc += L;
    if (acc >= spacing) { acc = 0; const p = post.clone(); p.scale(1, h, 1); p.translate(a[0], ha, -a[1]); railBits.post.push([p, postMat]); }
    if (collide) addCollider(a, b);
  }
  endRun();
}
function flushRailings() {
  const by = {};
  for (const [g, m] of [...railBits.post, ...railBits.rail]) (by[m] = by[m] || []).push(g);
  for (const m in by) mergeAdd(by[m], M[m], true);
  railBits.post.length = 0; railBits.rail.length = 0;
}
function polyMesh(poly, mat, yOff, uvScale) {
  const shape = poly.map(p => new THREE.Vector2(p[0], p[1]));
  // fill densely so the surface follows the ground
  const xs = poly.map(p => p[0]), ys = poly.map(p => p[1]);
  const g = new THREE.ShapeGeometry(new THREE.Shape(shape)); // in x/y plane
  const p = g.attributes.position, uv = g.attributes.uv;
  for (let i = 0; i < p.count; i++) { const x = p.getX(i), y = p.getY(i); p.setXYZ(i, x, hAt(x, y) + yOff, -y); uv.setXY(i, x / uvScale, y / uvScale); }
  g.computeVertexNormals();
  const m = new THREE.Mesh(g, mat); m.receiveShadow = true; scene.add(m); return m;
}

export { resample, normalsOf, strip, mergeAdd, disc, addCollider, blockedBySeg, railing, flushRailings, polyMesh, COLL, CC, railBits };
