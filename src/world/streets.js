import * as THREE from 'three';
import { scene } from '../core/context.js';
import { GEO, P, clsAt, hAt, hash2, rng } from '../core/geo.js';
import { addCollider, disc, flushRailings, mergeAdd, normalsOf, polyMesh, railing, resample, strip } from './geom.js';
import { MAINP, NRM, RF, buildMain, hw, nearestOnMain } from './mainroad.js';
import { M } from './materials.js';
import { buildParkGrounds } from './park.js';
import { buildFieldWest } from './road/fieldedge.js';

// ================= lanes and paths =================
// Pale dusty asphalt fading into dust at the edges, reddish-brown earth verges 1.2-1.8 m wide, and an open concrete drain
// only where a building or wall stands right at the road edge. Round end caps only where a lane meets another road.
// Railway Colony Rd (north from Hatigarh) is widened to its surveyed ~7 m (data/road_features.json).
const isRailwayColony = r => r.name === 'Railway Colony Road' || r.p.every(q => q[0] > -515 && q[0] < -480 && q[1] > -70 && q[1] < 125);
function laneWidth(r) { return isRailwayColony(r) ? RF.railway_colony_rd.asphalt_w : r.w; }
function buildLanes() {
  const asph = [], asphC = [], dust = [], verge = [], drain = [], caps = [];
  // the hill road up to Faculty School and the View point is pale cast concrete, not asphalt (satellite, Oct 2026)
  const onHill = p => p[0] > 40 && p[0] < 175 && p[1] > 70 && p[1] < 262;
  const lanes = GEO.roads.map(r => ({ r, P: resample(r.p, 2), w: laneWidth(r) })).filter(l => l.P.length >= 2);
  // spatial grid of lane samples, to tell a junction end from a dead end
  const G = new Map(), cell = 8, key = (x, y) => Math.floor(x / cell) + ',' + Math.floor(y / cell);
  lanes.forEach((l, k) => l.P.forEach(p => { const kk = key(p[0], p[1]); (G.get(kk) || G.set(kk, []).get(kk)).push([p[0], p[1], k, l.w]); }));
  const joins = (e, k, w) => {
    if (nearestOnMain(e[0], e[1])[0] < 16) return true;
    for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) for (const q of G.get((Math.floor(e[0] / cell) + i) + ',' + (Math.floor(e[1] / cell) + j)) || [])
      if (q[2] !== k && Math.hypot(q[0] - e[0], q[1] - e[1]) < (w + q[3]) / 2 + 0.5) return true;
    return false;
  };
  const built = p => { const c = clsAt(p[0], p[1]); return c === 2 || c === 3; };
  lanes.forEach(({ r, P, w }, k) => {
    for (let a = 0, i = 1; i <= P.length; i++) if (i === P.length || onHill(P[i]) !== onHill(P[a])) { const Q = P.slice(a, Math.min(P.length, i + 1)); if (Q.length > 1) (onHill(P[a]) ? asphC : asph).push(strip(Q, -w / 2, w / 2, 0.07, 0.07, 6)); a = i; }
    const nrm = normalsOf(P);
    for (const s of [1, -1]) {
      dust.push(strip(P, s * (w / 2 - 0.75), s * w / 2, 0.075, 0.075, 4, true));
      // split each side into runs: verge where there is open ground, drain where a building is right at the edge
      const vw = 1.2 + hash2(k, s) * 0.6, kind = P.map((p, i) => built([p[0] + nrm[i][0] * s * (w / 2 + 0.6), p[1] + nrm[i][1] * s * (w / 2 + 0.6)]) ? 'drain' : 'verge');
      let a = 0;
      for (let i = 1; i <= P.length; i++) if (i === P.length || kind[i] !== kind[a]) {
        const Q = P.slice(a, Math.min(P.length, i + 1)); if (Q.length > 1) {
          if (kind[a] === 'drain') drain.push(strip(Q, s * w / 2, s * (w / 2 + 0.45), 0.05, 0.05, 2));
          else verge.push(strip(Q, s * w / 2, s * (w / 2 + vw), 0.045, 0.045, 4));
        }
        a = i;
      }
    }
    for (const e of [P[0], P[P.length - 1]]) if (joins(e, k, w)) (onHill(e) ? asphC : caps).push(disc(e[0], e[1], w / 2, 0.07));
  });
  mergeAdd(asph.concat(caps), M.laneAsphalt); if (asphC.length) mergeAdd(asphC, M.laneConcrete); mergeAdd(dust, M.laneDust); mergeAdd(verge, M.verge); mergeAdd(drain, M.edge);
}

function buildField() {
  const F = GEO.fieldPoly;
  polyMesh(F, M.earth, 0.05, 6);
  // long axis via PCA for goal placement
  const cx = F.reduce((s, p) => s + p[0], 0) / F.length, cy = F.reduce((s, p) => s + p[1], 0) / F.length;
  let sxx = 0, syy = 0, sxy = 0; for (const p of F) { const dx = p[0] - cx, dy = p[1] - cy; sxx += dx * dx; syy += dy * dy; sxy += dx * dy; }
  const ang = 0.5 * Math.atan2(2 * sxy, sxx - syy), ux = Math.cos(ang), uy = Math.sin(ang);
  let lo = 1e9, hi = -1e9; for (const p of F) { const t = (p[0] - cx) * ux + (p[1] - cy) * uy; lo = Math.min(lo, t); hi = Math.max(hi, t); }
  const gm = M.white;
  for (const t of [lo + 5, hi - 5]) {
    const gx = cx + ux * t, gy = cy + uy * t, h = hAt(gx, gy), gr = new THREE.Group();
    for (const d of [-3.66, 3.66]) { const post = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 2.44, 8), gm); post.position.set(0, 1.22, d); gr.add(post); }
    const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 7.32, 8), gm); bar.rotation.x = Math.PI / 2; bar.position.y = 2.44; gr.add(bar);
    gr.position.set(gx, h, -gy); gr.rotation.y = ang; gr.traverse(o => o.castShadow = true); scene.add(gr);
  }
  // the road frontage (shoulder, footing, iron railing, brick wall and gate) is built with the main road: road/fieldedge.js
  buildFieldWest(); // red wall and chain-link along Baikuntha Rd
  return { cx, cy, ang };
}

// ================= Lakhipriya Devi Baruani Children's Park =================
function buildPark() {
  buildParkGrounds({ trees: PARK_TREES, beds: PARK_BEDS }); // fence, sheds, round bed, trees, water tank: see world/park.js; the bus shelter is built by streetlife.js
}
const PARK_TREES = [], PARK_BEDS = [];
function buildStreets() {
  buildMain(); buildLanes(); buildField(); buildPark(); flushRailings();
}

export { isRailwayColony, laneWidth, buildLanes, buildField, buildPark, buildStreets, PARK_TREES, PARK_BEDS };
