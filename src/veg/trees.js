import * as THREE from 'three';
import { camera, scene } from '../core/context.js';
import { GEO, HG, clsAt, hAt, hash2, rng } from '../core/geo.js';
import { ASSET, modelParts } from './assets.js';
import { inDeck, inViewWedge, sightTop } from '../world/deck.js';
import { blockedBySeg } from '../world/geom.js';
import { MEDIAN_TREES } from '../world/mainroad.js';
import { gridNearest } from '../world/road/mainidx.js';
import { EXTRA_TREES } from '../world/streetlife.js';
import { PARK_TREES } from '../world/streets.js';
import { TD, TW } from '../world/terrain.js';
import { OUTER_TREES } from '../world/outer.js';
import { bakeImpostor, makeImpostorMesh } from './impostor.js';
import { BUILDERS, NVAR, materials } from './palms.js';
import { VEG_U, patchVeg, tickVeg, vegDepth } from './wind.js';
import { noiseAt } from './noise.js';
import { FOREST_POLY, forestAmt, inForestPoly, inMandirClear, onUntracedRoad, quality } from './zones.js';
import { SectorSet } from '../render/sectored.js';
import { QUALITY } from '../render/quality.js';

// ---------- trees ----------
// Broadleaf trees (EZ-Tree models standing in for rain tree, mango, jackfruit and the pink-flowering median trees):
// full models near the camera, baked impostor billboards everywhere, dithered crossfade between them.
// Yard plants (areca, coconut, banana, bamboo) are procedural (palms.js) with a near and a far LOD.
const SPECIES = {
  // rain tree (Samanea saman): huge flat umbrella, fine bipinnate pale-green foliage -> EZ "ash" (compound leaves), squashed wide
  rain: { model: 'ash', sx: 1.6, sy: 0.78, tints: ['#bcd08a', '#aec683', '#c4d796'], s: [9, 15] },
  // mango: dense dark evergreen dome
  mango: { model: 'oak', sx: 1.18, sy: 0.95, tints: ['#6c9656', '#628c50', '#77a05e'], s: [7, 12] },
  // jackfruit / other mixed broadleaf of the ridge
  jack: { model: 'oak', sx: 1.0, sy: 1.05, tints: ['#8eb06a', '#85a862', '#97b672'], s: [6, 11] },
  // pink-flowering ornamentals on the median and in the park
  flower: { model: 'flower', sx: 1.0, sy: 1.0, tints: ['#ffb4d2', '#f6a5c6', '#ffc2da'], s: [4, 7] },
};
const MODELS = ['oak', 'ash', 'flower'];
const TREES = [];   // {x, y, h, s, sp, model, sx, sy, tint, yaw, outer}
const PLANTS = [];  // {x, y, h, sp, v, s, yaw}
const VARIANTS = {};
let farTrunk = null; // kept for main.js: truthy once the trees exist
let nearSets = {}, lastNearAt = null, lastQ = null;
const imps = {}, plantSets = {};
// yard plants reach 2 km out, so they get fewer, wider slices than the near trees (fewer draw calls)
const PLANT_SLICES = { n: 6, inner: 30 };
// traced-area trees bucketed by map cell (built on first use), so picking the near models doesn't scan every tree
const NEAR_CELL = 32, nearGrid = new Map();
let lastPlantAt = null;

const mainPts = GEO.main, nearMain = gridNearest(mainPts); // the same vertices as before (not MAINP), so the tree layout does not change
// distance to the main road, 99 beyond 20 m (only 'within 20 m' is asked)
function distMain(x, y) { const i = nearMain(x, y, 20); return i < 0 ? 99 : Math.hypot(mainPts[i][0] - x, mainPts[i][1] - y); }
const pick = (r, table) => { let u = r() * table.reduce((a, b) => a + b[1], 0); for (const [k, w] of table) { u -= w; if (u <= 0) return k; } return table[0][0]; };
const MIX = {
  forest: [['mango', 30], ['rain', 22], ['jack', 32], ['bamboo', 9], ['areca', 7]],
  yard: [['areca', 32], ['banana', 15], ['coconut', 10], ['bamboo', 3], ['mango', 20], ['jack', 10], ['rain', 6], ['flower', 4]],
  road: [['rain', 40], ['mango', 35], ['coconut', 10], ['areca', 10], ['jack', 5]],
  outside: [['areca', 22], ['banana', 8], ['coconut', 12], ['bamboo', 6], ['mango', 25], ['jack', 17], ['rain', 10]],
};
const CLEAR_R = { areca: 1.0, banana: 1.3, coconut: 1.6, bamboo: 2.6 };

function addTree(x, y, h, sp, r, s) {
  const S = SPECIES[sp]; s = s ?? S.s[0] + r() * (S.s[1] - S.s[0]);
  TREES.push({ x, y, h, s, sp, model: S.model, sx: S.sx * (0.9 + r() * 0.2), sy: S.sy * (0.9 + r() * 0.2), tint: new THREE.Color(S.tints[Math.floor(r() * S.tints.length)]), yaw: r() * Math.PI * 2 });
}
// keep every k-th traced-area candidate (trees then plants) so the list fits the preset budget
function capTraced(t0, p0, budget) {
  const total = (TREES.length - t0) + (PLANTS.length - p0);
  if (total <= budget) return;
  const k = Math.ceil(total / budget), trees = TREES.splice(t0), plants = PLANTS.splice(p0); let g = 0;
  for (const t of trees) if (g++ % k === 0) TREES.push(t);
  for (const p of plants) if (g++ % k === 0) PLANTS.push(p);
}
function collectTrees() {
  const r = rng(77);
  const t0 = TREES.length, p0 = PLANTS.length;
  const clear = (x, y, rad) => { for (const [dx, dy] of [[0, 0], [rad, 0], [-rad, 0], [0, rad], [0, -rad]]) { const c = clsAt(x + dx, y + dy); if (c !== 0 && c !== 9 && c !== 4) return false; if (blockedBySeg(x + dx, y + dy, 0.5) || onUntracedRoad(x + dx, y + dy)) return false; } return true; };
  for (let i = 0; i < 140000; i++) {
    const x = HG.x0 + r() * TW, y = HG.y0 + r() * TD, h = hAt(x, y), c = clsAt(x, y);
    if (c !== 0 && c !== 9) continue;
    const fa = forestAmt(x, y, h), forest = fa >= 1 || (fa > 0 && hash2(x * 1.7, y * 2.3) < fa), outside = c === 9; // a mixed edge over ~3 m of height, not a line
    const dm = forest ? 99 : distMain(x, y), road = dm < 20 && !outside;
    // groves and gardens cluster: a slow noise modulates density so trees gather instead of spreading evenly
    const grove = 0.35 + 1.3 * noiseAt(0, x / 140 + 0.2, y / 140 + 0.6);
    let p = (forest ? 0.5 : road ? 0.12 : outside ? 0.075 : 0.085) * (forest ? 1 : grove);
    if (inMandirClear(x, y) || inDeck(x, y, 6)) p = 0;
    if (r() > p) continue;
    const sp = pick(r, forest ? MIX.forest : road ? MIX.road : outside ? MIX.outside : MIX.yard);
    const plant = !!BUILDERS[sp];
    if (!clear(x, y, plant ? CLEAR_R[sp] : forest ? 1.8 : 2)) continue;
    const top = plant ? (sp === 'banana' ? 4 : sp === 'bamboo' ? 13 : 15) : SPECIES[sp].s[1] * 1.1;
    // View point sightline: satellite shows unbroken canopy below the terrace, so trees there are shortened to sit
    // under the sightline (you look out across the crowns) rather than removed; only spots with < 3 m headroom stay clear
    const vw = inViewWedge(x, y), head = vw === null ? Infinity : sightTop(vw) - h;
    if (head < 3) continue;
    if (plant && top > head) continue;
    if (plant) PLANTS.push({ x, y, h, sp, v: Math.floor(r() * NVAR[sp]), s: 0.85 + r() * 0.3, yaw: r() * Math.PI * 2 });
    else { addTree(x, y, h, sp, r); const t = TREES[TREES.length - 1]; if (t.s * 1.25 > head) { const s0 = t.s; t.s = Math.max(2.4, head / 1.25); t.sx *= Math.min(2.2, Math.sqrt(s0 / t.s)); } }
  }
  // banana clumps: a mother plant rarely stands alone
  for (const p of PLANTS.slice()) if (p.sp === 'banana') for (let k = 0, n = Math.floor(r() * 3); k < n; k++) {
    const a = r() * 6.28, d = 1.2 + r() * 1.2, x = p.x + Math.cos(a) * d, y = p.y + Math.sin(a) * d;
    if (clear(x, y, 0.8)) PLANTS.push({ x, y, h: hAt(x, y), sp: 'banana', v: Math.floor(r() * NVAR.banana), s: 0.7 + r() * 0.35, yaw: r() * 6.28 });
  }
  // the traced-area budget leaves room for the explicit lists below, which are never thinned
  capTraced(t0, p0, Math.max(1, QP[quality()].traced - MEDIAN_TREES.length - PARK_TREES.length - EXTRA_TREES.length));
  for (const t of MEDIAN_TREES) addTree(t.x, t.y, t.h, 'flower', r, t.s);
  for (const t of PARK_TREES) addTree(t.x, t.y, hAt(t.x, t.y), t.pink ? 'flower' : 'mango', r, t.s);
  for (const t of EXTRA_TREES) addTree(t.x, t.y, t.h, t.variant === 'ash' ? 'mango' : t.variant === 'flower' ? 'flower' : 'rain', r, t.s);
  // the city beyond the traced area (outer.js): impostors only
  for (const t of OUTER_TREES) { addTree(t[0], t[1], t[2], t[3] || 'mango', r, t[4]); TREES[TREES.length - 1].outer = true; }
  console.info(`trees: ${TREES.length} broadleaf (${OUTER_TREES.length} outer), ${PLANTS.length} yard plants`);
  return PLANTS;
}

// caps, radii and budgets per quality preset
// traced: max trees and palms collected inside the traced area; nearR/cap: full models per variant near the camera;
// shadows: true (all), 'near' (only the near full models) or false; outer thinning is done in world/outer.js
const QP = {
  high: { nearR: 92, cap: 180, plantR: 160, plantFar: 2200, shadows: true, fast: false, traced: Infinity },
  medium: { nearR: 70, cap: 80, plantR: 110, plantFar: 1500, shadows: 'near', fast: false, traced: 14000 },
  low: { nearR: 0, cap: 0, plantR: 50, plantFar: 700, shadows: false, fast: true, traced: 6000 },
};

function buildTreeMeshes() {
  const dm = new THREE.Object3D();
  if (ASSET.trees) {
    const groups = {}; ASSET.trees.scene.children.forEach(c => { groups[c.name] = c; });
    const leafTex = { oak: ASSET.leafOak, ash: ASSET.leafAsh, flower: ASSET.leafOak };
    const bark = new THREE.Color('#d9cbb4');
    for (const v of MODELS) {
      const g = groups[v]; if (!g) continue;
      const mp = modelParts(g); VARIANTS[v] = mp;
      const isLeaf = p => p.mat && p.mat.name === 'leaves';
      const center = new THREE.Vector3(0, mp.h * 0.62, 0), radius = new THREE.Vector3(mp.w * 0.5, mp.h * 0.4, mp.w * 0.5);
      const wind = { sway: { h: mp.h, amp: 0.022 }, fade: 'near' };
      nearSets[v] = mp.parts.map(p => {
        const leaf = isLeaf(p);
        const mat = leaf
          ? patchVeg(new THREE.MeshStandardMaterial({ map: leafTex[v], alphaTest: 0.5, alphaToCoverage: QUALITY !== 'low', side: THREE.DoubleSide, roughness: 0.78 }), { ...wind, flutter: 0.05, foliage: { center, radius, mix: 0.65, ao: 0.45 }, upNormals: true })
          : patchVeg(new THREE.MeshStandardMaterial({ map: ASSET.bark, normalMap: ASSET.barkN, color: bark, roughness: 0.95 }), wind);
        // sliced round the camera so the slices out of view are culled (leaf slices carry the per-tree tint)
        const im = new SectorSet(p.geo, mat, Math.max(...Object.values(QP).map(q => q.cap)), { colors: leaf, name: `tree:${v}:${leaf ? 'leaf' : 'bark'}` }); im.castShadow = true; im.receiveShadow = true;
        im.customDepthMaterial = leaf ? vegDepth(leafTex[v], { ...wind, flutter: 0.05 }) : vegDepth(null, wind, 0);
        im.leaf = leaf;
        return im;
      });
      // impostor atlas, baked from the same model and materials
      const bake = bakeImpostor(mp, mp.parts.map(p => isLeaf(p) ? { map: leafTex[v], leaf: true } : { map: ASSET.bark, tint: bark, leaf: false }));
      // traced-area trees first, then the outer ring in shuffled order, so lower presets can simply draw fewer
      const rs = rng(5 + v.length), list = TREES.filter(t => t.model === v && !t.outer);
      const outer = TREES.filter(t => t.model === v && t.outer).map(t => [rs(), t]).sort((a, b) => a[0] - b[0]).map(e => e[1]);
      const nInner = list.length; list.push(...outer);
      const im = makeImpostorMesh(bake, Math.max(1, list.length), { fade: 'far' });
      list.forEach((t, i) => {
        const sc = (t.s * 1.25) / mp.h;
        dm.position.set(t.x, t.h - 0.25, -t.y); dm.rotation.set(0, t.yaw, 0); dm.scale.set(sc * t.sx, sc * t.sy, sc * t.sx); dm.updateMatrix();
        im.setMatrixAt(i, dm.matrix); im.setColorAt(i, t.tint);
      });
      im.name = `impostor:${v}`; im.count = list.length; im.userData.nInner = nInner; im.userData.nAll = list.length; scene.add(im); imps[v] = im;
    }
  }
  // yard plants: per species and variant, a near (detailed) and far (simple) instanced pair
  const M = materials();
  for (const sp of Object.keys(BUILDERS)) for (let v = 0; v < NVAR[sp]; v++) {
    const n = PLANTS.filter(p => p.sp === sp && p.v === v).length; if (!n) continue;
    const seed = 1000 + v * 17 + sp.length * 101;
    const set = plantSets[sp + v] = {};
    for (const [lod, detail] of [['near', true], ['far', false]]) {
      const g = BUILDERS[sp](seed, detail);
      const tr = new SectorSet(g.trunk, M[sp].trunk, n, { ...PLANT_SLICES, name: `plant:${sp}${v}:${lod}:trunk` }), lf = new SectorSet(g.leaf, M[sp].leaf, n, { ...PLANT_SLICES, name: `plant:${sp}${v}:${lod}:leaf` });
      lf.customDepthMaterial = M[sp].depth;
      for (const m of [tr, lf]) { m.castShadow = lod === 'near' || sp === 'coconut'; m.receiveShadow = true; }
      set[lod] = [tr, lf];
    }
  }
  farTrunk = imps.oak || imps.ash || {};
  updateNearTrees(true);
  console.info('[veg] quality', quality(), 'trees', TREES.length, 'plants', PLANTS.length, 'outer', OUTER_TREES.length, 'near', Object.entries(nearSets).map(([v, a]) => `${v} ${a[0]?.count ?? 0}`).join(', '));
}

const _cam = new THREE.Vector3();
function updateNearTrees(force) {
  _cam.copy(camera.position);
  tickVeg(performance.now() / 1000, _cam);
  const q = quality(), P = QP[q];
  if (q !== lastQ) {
    lastQ = q; force = true;
    for (const v in imps) { const im = imps[v]; im.castShadow = false; im.userData.setFast(P.fast); im.count = im.userData.nAll; }
    for (const v in nearSets) for (const im of nearSets[v]) im.castShadow = !!P.shadows;
    for (const id in plantSets) for (const m of plantSets[id].near) m.castShadow = !!P.shadows;
    for (const id in plantSets) for (const m of plantSets[id].far) m.castShadow = P.shadows === true && id.startsWith('coconut');
  }
  const cx = _cam.x, cy = -_cam.z, cz = _cam.y;
  const moved = !lastNearAt || Math.hypot(cx - lastNearAt[0], cy - lastNearAt[1], cz - lastNearAt[2]);
  if (!force && moved < 7) return;
  lastNearAt = [cx, cy, cz];
  const dm = new THREE.Object3D();
  // broadleaf near models
  let effR = P.nearR;
  const cand = {}; for (const v in nearSets) cand[v] = [];
  // only the grid cells within reach: the 3D distance is never shorter than the map distance
  const R = P.nearR + 8, g0 = Math.floor((cx - R) / NEAR_CELL), g1 = Math.floor((cx + R) / NEAR_CELL), h0 = Math.floor((cy - R) / NEAR_CELL), h1 = Math.floor((cy + R) / NEAR_CELL);
  if (!nearGrid.size) for (let i = 0; i < TREES.length; i++) { const t = TREES[i]; if (t.outer) continue; const k = Math.floor(t.x / NEAR_CELL) * 65536 + Math.floor(t.y / NEAR_CELL); let c = nearGrid.get(k); if (!c) nearGrid.set(k, c = []); c.push(i); }
  for (let gx = g0; gx <= g1; gx++) for (let gy = h0; gy <= h1; gy++) {
    const cell = nearGrid.get(gx * 65536 + gy); if (!cell) continue;
    for (const i of cell) {
      const t = TREES[i]; if (!cand[t.model]) continue;
      const d = Math.hypot(t.x - cx, t.y - cy, t.h + t.s * 0.5 - cz);
      if (d < R) cand[t.model].push([d, i]);
    }
  }
  for (const v in nearSets) {
    const all = cand[v].sort((a, b) => a[0] - b[0] || a[1] - b[1]), list = all.slice(0, P.cap), mp = VARIANTS[v];
    if (all.length > P.cap) effR = Math.min(effR, list.length ? list[list.length - 1][0] : 0);
    const sets = nearSets[v]; for (const im of sets) im.begin(cx, cy);
    for (const [, i] of list) {
      const t = TREES[i], sc = (t.s * 1.25) / mp.h, s = sets[0].slot(t.x, t.y);
      dm.position.set(t.x, t.h - 0.25, -t.y); dm.rotation.set(0, t.yaw, 0); dm.scale.set(sc * t.sx, sc * t.sy, sc * t.sx); dm.updateMatrix();
      for (const im of sets) im.add(s, dm.matrix, im.leaf ? t.tint : null);
    }
    for (const im of sets) im.end();
  }
  // impostors take over completely beyond uNearR; the selection above stays valid until the camera moves 7 m
  VEG_U.uNearR.value = Math.max(0, effR - 8); VEG_U.uFadeW.value = Math.min(14, Math.max(4, effR * 0.18));
  // yard plants
  if (force || !lastPlantAt || Math.hypot(cx - lastPlantAt[0], cy - lastPlantAt[1], cz - lastPlantAt[2]) > 12) {
    lastPlantAt = [cx, cy, cz];
    for (const id in plantSets) for (const lod of ['near', 'far']) for (const m of plantSets[id][lod]) m.begin(cx, cy);
    for (const p of PLANTS) {
      const d = Math.hypot(p.x - cx, p.y - cy, p.h + 4 - cz);
      if (d > P.plantFar) continue;
      const set = plantSets[p.sp + p.v]; if (!set) continue;
      const pair = set[d < P.plantR ? 'near' : 'far'], s = pair[0].slot(p.x, p.y);
      dm.position.set(p.x, p.h - 0.1, -p.y); dm.rotation.set(0, p.yaw, 0); dm.scale.setScalar(p.s); dm.updateMatrix();
      for (const m of pair) m.add(s, dm.matrix);
    }
    for (const id in plantSets) for (const lod of ['near', 'far']) for (const m of plantSets[id][lod]) m.end();
  }
}

// handles for profiling and debugging (dev console)
const VEG_OBJECTS = { nearSets, imps, plantSets };

export { VEG_OBJECTS, collectTrees, inForestPoly, inMandirClear, buildTreeMeshes, updateNearTrees, TREES, PLANTS, VARIANTS, farTrunk, nearSets, lastNearAt, FOREST_POLY, SPECIES };
