import * as THREE from 'three';
import { GEO, MANDIR, hAt, rng } from '../core/geo.js';
import { mergeAdd, normalsOf, railing, resample, strip } from './geom.js';
import { M } from './materials.js';
import { cellInstances } from '../render/sectored.js';
import { buildFieldEdge } from './road/fieldedge.js';
import RF from '../../data/road_features.json'; // surveyed positions: median, gaps, edges, lights (see _about)

// ================= Mother Teresa Rd (Zoo-Narengi Rd) =================
// Cross-section after Street View (Mar 2026), see docs/notes-streets.md:
//  - undivided ~11.5 m asphalt at Hatigarh Chariali and everywhere west of it, dusty earth shoulders, no kerbs or railings;
//  - the median starts with a nose ~25 m east of the junction (x ~ -470) and runs east: a raised kerb painted in
//    black-and-white blocks, a black railing, bougainvillea and shrubs (wider, with trees, for the first ~130 m);
//  - road edges: a narrow striped kerb with a black railing, then a dusty earth shoulder, broken at side lanes;
//    the field frontage has an earth shoulder, concrete footing, ornamental iron railing and a brick wall.
const MAINP = resample(GEO.main.map(p => [p[0], p[1], p[2]]), 2.5);
const NRM = normalsOf(MAINP); // NRM[i] points north (left of eastbound traffic)
const hw = i => Math.max(9, Math.min(13.5, MAINP[i][2] / 2));   // half of the full right-of-way
const MED = 0.7, FOOT = 2.3, KERB_H = 0.18, MED_H = 0.3, KERB_W = 0.4;
const RM = RF.median, MED_X0 = RM.start_x, MED_X1 = RM.end_x; // median nose and end (road_features.json)
const lerp = (a, b, t) => a + (b - a) * Math.max(0, Math.min(1, t));
const inMedGap = x => RF.median_gaps.some(g => Math.abs(x - g.x) < g.w / 2);
function medHalf(x) {
  if (x < MED_X0 || x > MED_X1) return 0;
  if (x < MED_X0 + 5) return lerp(0.45, RM.wide_half_m, (x - MED_X0) / 5);
  if (x < RM.wide_to_x) return RM.wide_half_m;
  return lerp(RM.wide_half_m, RM.narrow_half_m, (x - RM.wide_to_x) / 40);
}
const hatigarh = GEO.labels.find(l => l.t === 'Hatigarh Chariali');
const HAT = { x: -497, y: 0 }; // junction centre on the main road (Railway Colony Rd mouth), y set below
function asphHalf(i) {
  const x = MAINP[i][0], m = medHalf(x);
  if (m === 0) return Math.min(hw(i) - 1.2, 5.8) + Math.max(0, 1.6 - Math.abs(x - HAT.x) / 12); // slight flare at the junction
  return Math.min(m + 8.5, hw(i) - 2.0);
}
// junctions where side roads meet the main road -> breaks in the edge kerb and railing
const MAIN_JUNC = [];
function nearestOnMain(x, y) { let best = 1e9, bi = 0; for (let i = 0; i < MAINP.length; i += 1) { const d = Math.hypot(MAINP[i][0] - x, MAINP[i][1] - y); if (d < best) { best = d; bi = i; } } return [best, bi]; }
for (const r of GEO.roads) for (const end of [r.p[0], r.p[r.p.length - 1]]) {
  const [d, i] = nearestOnMain(end[0], end[1]);
  if (d < hw(i) + 6) { const nrm = NRM[i]; const side = Math.sign((end[0] - MAINP[i][0]) * nrm[0] + (end[1] - MAINP[i][1]) * nrm[1]) || 1; MAIN_JUNC.push({ x: MAINP[i][0], y: MAINP[i][1], side, w: r.w }); }
}
HAT.y = MAINP[nearestOnMain(HAT.x, hatigarh.y)[1]][1];
// what lines each side of the carriageway, from the surveyed edge list: 'kerb' (striped kerb + black railing),
// 'open' (earth shoulder only), 'culvert' (painted concrete culvert railing), 'field', 'mandir'; side lanes break kerbs
function edgeKind(s, i) {
  const x = MAINP[i][0], side = s === 1 ? 'N' : 'S';
  const e = RF.edges[side].find(e => x >= e.x0 && x < e.x1), kind = e ? e.kind : 'open';
  if (kind !== 'field' && kind !== 'open' && RF.junctions.some(j => j.side === side && Math.abs(x - j.x) < j.w / 2 + 3)) return 'open';
  return kind;
}
function runs(s) { // contiguous index ranges with the same edge kind (sharing their end points)
  const out = []; let k0 = 0, kind = edgeKind(s, 0);
  for (let i = 1; i < MAINP.length; i++) { const k = edgeKind(s, i); if (k !== kind || i === MAINP.length - 1) { out.push([k0, i, kind]); k0 = i; kind = k; } }
  return out;
}
const sub = (a, b) => MAINP.slice(a, b + 1);

const KERB_GREEN_TO = -60; // median kerb is painted black-green west of this x
function buildMain() {
  const P = MAINP, asph = [], dust = [], kerb = [], kerbG = [], shoulder = [], med = [], pave = [];
  for (const s of [1, -1]) {
    asph.push(strip(P, i => s * medHalf(P[i][0]), i => s * asphHalf(i), 0.06, 0.06, 6));
    // dust drifts along the outer edge, and a thinner band against the median kerb
    dust.push(strip(P, i => s * (asphHalf(i) - 2.0), i => s * asphHalf(i), 0.065, 0.065, 4, true));
    const mi = P.findIndex(p => p[0] >= MED_X0);
    const PM = P.slice(mi);
    dust.push(strip(PM, i => s * (medHalf(PM[i][0]) + 1.1), i => s * medHalf(PM[i][0]), 0.065, 0.065, 4, true));
    for (const [a, b, kind] of runs(s)) {
      const Q = sub(a, b), o = i => asphHalf(a + i), H = i => hw(a + i);
      if (kind === 'kerb') {
        kerb.push(strip(Q, i => s * o(i), i => s * o(i), 0.04, KERB_H, 2.4, true));                              // road face
        kerb.push(strip(Q, i => s * o(i), i => s * (o(i) + KERB_W), KERB_H, KERB_H, 2.4, true));                 // top
        kerb.push(strip(Q, i => s * (o(i) + KERB_W), i => s * (o(i) + KERB_W), KERB_H, 0.0, 2.4, true));         // back
        shoulder.push(strip(Q, i => s * (o(i) + KERB_W), i => s * (H(i) + 0.8), 0.04, 0.04, 4));
        railing(Q.map((p, i) => [p[0] + NRM[a + i][0] * s * (o(i) + 0.2), p[1] + NRM[a + i][1] * s * (o(i) + 0.2)]),
          { h: 0.95, spacing: 2.4, base: KERB_H, rails: [0.1, 0.96], post: 0.07, infill: 'railInfill', infillSpan: [0.1, 0.96],
            skip: m => RF.bus_stops.some(b => (b.side === 'N') === (s === 1) && Math.abs(m[0] - b.x) < 4) }); // open in front of bus stops
      } else if (kind === 'culvert' || kind === 'mandir') {
        kerb.push(strip(Q, i => s * o(i), i => s * o(i), 0.04, KERB_H, 2.4, true));
        kerb.push(strip(Q, i => s * o(i), i => s * (o(i) + KERB_W), KERB_H, KERB_H, 2.4, true));
        if (kind === 'mandir') { pave.push(strip(Q, i => s * (o(i) + KERB_W), i => s * (H(i) + 0.6), KERB_H, KERB_H, 2.2)); kerb.push(strip(Q, i => s * (H(i) + 0.6), i => s * (H(i) + 0.6), KERB_H, 0, 2.4, true)); }
        else { kerb.push(strip(Q, i => s * (o(i) + KERB_W), i => s * (o(i) + KERB_W), KERB_H, 0.0, 2.4, true)); shoulder.push(strip(Q, i => s * (o(i) + KERB_W), i => s * (H(i) + 0.8), 0.04, 0.04, 4)); }
        const line = Q.map((p, i) => [p[0] + NRM[a + i][0] * s * (o(i) + 0.2), p[1] + NRM[a + i][1] * s * (o(i) + 0.2)]);
        if (kind === 'culvert') railing(line, { h: 0.85, spacing: 1.6, base: KERB_H, rails: [0.45, 0.85], post: 0.18, postMat: 'kerb', railMat: 'kerb' });
        else railing(line, { h: 0.95, spacing: 2.4, base: KERB_H, rails: [0.1, 0.96], post: 0.07, infill: 'railInfill', infillSpan: [0.1, 0.96], skip: m => Math.abs(m[0] - MANDIR.gx) < 4.6 }); // open at the stairs
      } else if (kind === 'forecourt') { // bare dusty earth right up to the park fence (no footpath, no railing)
        shoulder.push(strip(Q, i => s * o(i), i => s * (H(i) + 2.5), 0.04, 0.04, 4));
      } else if (kind === 'open') {
        shoulder.push(strip(Q, i => s * o(i), i => s * (H(i) + 0.8), 0.04, 0.04, 4));
      } else buildFieldEdge(Q, a, s, o, H, shoulder);
    }
  }
  // the median: soil bed between two painted kerb faces, rounded noses at each end and at any surveyed U-turn gap
  const medRuns = []; { let cur = null;
    P.forEach((p, i) => { const on = medHalf(p[0]) > 0 && !inMedGap(p[0]); if (on) { if (!cur) medRuns.push(cur = []); cur.push(i); } else cur = null; }); }
  for (const run of medRuns) {
    if (run.length < 2) continue;
    const PM = run.map(i => P[i]), mh = i => medHalf(PM[i][0]);
    med.push(strip(PM, i => -mh(i), i => mh(i), MED_H, MED_H, 3));
    // kerb paint: black and green west of the field, black and white from the field east (Street View x -245, -145 / x -27)
    const kg = PM.findIndex(p => p[0] > KERB_GREEN_TO), parts = kg <= 0 ? [[PM, kg === 0 ? kerb : kerbG]] : [[PM.slice(0, kg + 1), kerbG], [PM.slice(kg), kerb]];
    for (const [Q, dst] of parts) for (const s of [1, -1]) dst.push(strip(Q, i => s * medHalf(Q[i][0]), i => s * medHalf(Q[i][0]), 0.04, MED_H, 2.4, true));
    for (const [k, dir] of [[0, 1], [run.length - 1, -1]]) { // dir 1: open half faces west
      const n0 = PM[k], r0 = Math.max(0.3, mh(k)), n = NRM[run[k]], cap = new THREE.CylinderGeometry(r0, r0, MED_H, 16, 1, true, 0, Math.PI);
      cap.rotateY(Math.atan2(dir * n[0], -dir * n[1])); cap.translate(n0[0], hAt(n0[0], n0[1]) + MED_H / 2 + 0.02, -n0[1]); (n0[0] > KERB_GREEN_TO ? kerb : kerbG).push(cap.toNonIndexed());
    }
    // median railing: maroon posts, black verticals between a bottom and a top rail (Street View x -145 and x -27, Mar 2026)
    railing(PM.slice(1, -1).map(p => [p[0], p[1]]), { h: 0.95, spacing: 2.5, base: MED_H, rails: [0.12, 0.95], post: 0.07, postMat: 'maroon', infill: 'railInfill', infillSpan: [0.12, 0.95] });
  }
  mergeAdd(asph, M.asphalt); mergeAdd(dust, M.dust); mergeAdd(kerb.map(g => (g.index ? g.toNonIndexed() : g)), M.kerb); mergeAdd(kerbG.map(g => (g.index ? g.toNonIndexed() : g)), M.kerbGreen); mergeAdd(med, M.median); mergeAdd(shoulder, M.shoulder); if (pave.length) mergeAdd(pave, M.paver);
  // pink bougainvillea and green shrubs along both sides of the railing, small trees in the wide western stretch
  const r = rng(31), bush = [];
  for (const run of medRuns) for (let k = 1; k < run.length - 1; k++) {
    const i = run[k], p = P[i], m = medHalf(p[0]);
    // clumps of 3-6 small soft blobs (Street View: low trimmed shrubs, not bushes); ~1 in 3 clumps is flowering bougainvillea
    for (const s of [1, -1]) if (r() < 0.85) { const pinkish = r() < 0.3, n = 3 + Math.floor(r() * 4), cx = p[0] + NRM[i][0] * s * m * 0.55, cy = p[1] + NRM[i][1] * s * m * 0.55;
      for (let q = 0; q < n; q++) bush.push([cx + (r() - 0.5) * 1.6, cy + (r() - 0.5) * Math.min(0.5, m * 0.4), m, pinkish && r() < 0.7]); }
    if (m > 1 && k % 5 === 2 && r() < 0.7) MEDIAN_TREES.push({ x: p[0], y: p[1], h: hAt(p[0], p[1]) + MED_H, s: 4.5 + r() * 2.5 });
  }
  const lamps = RF.street_lights.filter(l => l.side === 'median' && medHalf(l.x) > 0).map(l => nearestOnMain(l.x, P.find(p => p[0] >= l.x)[1])[1]);
  const dm = new THREE.Object3D(), bg = new THREE.IcosahedronGeometry(0.5, 2), pp = bg.attributes.position;
  for (let k = 0; k < pp.count; k++) { const f = 0.75 + 0.5 * Math.abs(Math.sin(pp.getX(k) * 9.1 + pp.getY(k) * 7.3 + pp.getZ(k) * 5.7)); pp.setXYZ(k, pp.getX(k) * f, pp.getY(k) * f, pp.getZ(k) * f); }
  bg.computeVertexNormals();
  const GC = ['#3f6a2a', '#4f7a34', '#56803a', '#5d8a3b', '#476f2e', '#6b8f3f'].map(c => new THREE.Color(c)), PC = ['#b4527e', '#c2658f', '#a04a72', '#cf7fa4'].map(c => new THREE.Color(c));
  const shrubs = bush.map(([x, y, m, pk]) => { const sz = 0.22 + r() * 0.28; dm.position.set(x, hAt(x, y) + MED_H + 0.22 * sz + 0.05, -y); dm.scale.set(sz * (0.9 + r() * 0.5), sz * (0.6 + r() * 0.5), sz * Math.min(1, m)); dm.rotation.set(r() * 0.4, r() * 6, r() * 0.4); dm.updateMatrix(); return [x, y, dm.matrix.clone(), (pk ? PC : GC)[Math.floor(r() * (pk ? PC : GC).length)]]; });
  // one instanced mesh per 60 m of median, so the rows out of view and outside the shadow box are culled
  for (const im of cellInstances(bg, new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.95 }), shrubs)) { im.castShadow = true; im.receiveShadow = true; }
  buildMedianLamps(lamps);
}
// median street lights: tapered steel pole with twin curved arms (seen on Street View at the field)
function buildMedianLamps(idx) {
  const pole = new THREE.CylinderGeometry(0.07, 0.13, 9, 8); pole.translate(0, 4.5, 0);
  const geos = [], heads = [];
  for (const i of idx) {
    const p = MAINP[i], y0 = hAt(p[0], p[1]) + MED_H, ang = Math.atan2(NRM[i][1], NRM[i][0]);
    const a = pole.clone(); a.translate(p[0], y0, -p[1]); geos.push(a);
    for (const s of [1, -1]) {
      const curve = new THREE.QuadraticBezierCurve3(new THREE.Vector3(0, 8.4, 0), new THREE.Vector3(s * 0.2, 9.3, 0), new THREE.Vector3(s * 1.9, 9.25, 0));
      const arm = new THREE.TubeGeometry(curve, 8, 0.045, 5); arm.rotateY(ang); arm.translate(p[0], y0, -p[1]); geos.push(arm.toNonIndexed());
      const h = new THREE.BoxGeometry(0.62, 0.12, 0.26); h.translate(s * 2.05, 9.2, 0); h.rotateY(ang); h.translate(p[0], y0, -p[1]); heads.push(h);
    }
  }
  mergeAdd(geos.map(g => (g.index ? g.toNonIndexed() : g)), M.steel, true);
  mergeAdd(heads, new THREE.MeshStandardMaterial({ color: '#c9ccc8', roughness: 0.5, metalness: 0.4, emissive: '#2a2618' }), true);
}
const MEDIAN_TREES = [];

export { nearestOnMain, buildMain, MAINP, NRM, hw, MED, FOOT, KERB_H, KERB_W, MED_H, MAIN_JUNC, hatigarh, HAT, MEDIAN_TREES, medHalf, asphHalf, edgeKind, MED_X0, RF };
