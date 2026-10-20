import * as THREE from 'three';
import { scene } from '../core/context.js';
import { HG, clsAt, hAt, hash2, rng } from '../core/geo.js';
import { mode, player } from '../ui/controls.js';
import { ASSET, modelParts } from './assets.js';
import { inDeck } from '../world/deck.js';
import { blockedBySeg } from '../world/geom.js';
import { PARK_BEDS } from '../world/streets.js';
import { TD, TW } from '../world/terrain.js';
import { bareNoise, noiseAt } from './noise.js';
import { patchVeg } from './wind.js';
import { inForestPoly, inMandirClear, onUntracedRoad, quality } from './zones.js';

// ---------- near-camera grass: procedural clumps of curved blades, swaying in the wind ----------
// Placement follows the same bare-earth noise as the terrain shader, so tufts grow on the green and not on the dust.
// max: instance cap per preset; low builds no grass at all
const QG = { high: { step: 0.42, R: 38, blades: 11, max: 30000 }, medium: { step: 0.55, R: 21, blades: 9, max: 15000 }, low: { step: 0.9, R: 18, blades: 6, max: 0 } };
let grassIM = null, lastGrassAt = null, lastQ = null;

function clumpGeo(nb, seed) {
  const r = rng(seed), P = [], N = [], C = [], W = [], I = [];
  const base = new THREE.Color(0.10, 0.16, 0.035), mid = new THREE.Color(0.24, 0.34, 0.08), tip = new THREE.Color(0.52, 0.56, 0.20);
  for (let b = 0; b < nb; b++) {
    const a = r() * 6.28, rr = Math.sqrt(r()) * 0.16, x0 = Math.cos(a) * rr, z0 = Math.sin(a) * rr;
    const H = 0.14 + r() * 0.28, wd = 0.012 + r() * 0.012, face = r() * 6.28, lean = 0.15 + r() * 0.5, la = a + (r() - 0.5) * 1.2;
    const fx = Math.cos(face), fz = Math.sin(face), lx = Math.cos(la), lz = Math.sin(la);
    const nrm = new THREE.Vector3(-fz * 0.35, 1, fx * 0.35).normalize();
    const v0 = P.length / 3, lv = 4;
    for (let k = 0; k <= lv; k++) {
      const t = k / lv, bend = lean * t * t * H, y = H * t * (1 - 0.25 * lean * t), w = wd * (1 - t * 0.85);
      const cx = x0 + lx * bend, cz = z0 + lz * bend, col = t < 0.5 ? base.clone().lerp(mid, t * 2) : mid.clone().lerp(tip, (t - 0.5) * 2);
      if (k < lv) for (const s of [-1, 1]) { P.push(cx + fx * w * s, y, cz + fz * w * s); N.push(nrm.x, nrm.y, nrm.z); C.push(col.r, col.g, col.b); W.push(0.06 * t * t * H / 0.4, 0.015 * t); }
      else { P.push(cx, y, cz); N.push(nrm.x, nrm.y, nrm.z); C.push(col.r, col.g, col.b); W.push(0.06 * H / 0.4, 0.015); }
    }
    for (let k = 0; k < lv - 1; k++) { const a0 = v0 + k * 2; I.push(a0, a0 + 2, a0 + 1, a0 + 1, a0 + 2, a0 + 3); }
    const tl = v0 + (lv - 1) * 2; I.push(tl, tl + 2, tl + 1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(C, 3)); g.setAttribute('aWind', new THREE.Float32BufferAttribute(W, 2)); g.setIndex(I);
  return g;
}
const geos = {};
function buildGrass() {
  const q = quality();
  if (!QG[q].max) return; // low: no grass
  const mat = patchVeg(new THREE.MeshStandardMaterial({ vertexColors: true, side: THREE.DoubleSide, roughness: 0.85 }), { attr: true, flutter: 1, upNormals: true });
  for (const k of Object.keys(QG)) geos[k] = clumpGeo(QG[k].blades, 5);
  grassIM = new THREE.InstancedMesh(geos[q], mat, QG[q].max); grassIM.count = 0; grassIM.receiveShadow = true; grassIM.frustumCulled = false;
  grassIM.setColorAt(0, new THREE.Color(1, 1, 1));
  scene.add(grassIM);
}
// bare-earth propensity per class, as in terrain.js paintGround()
const BARE = { 0: 0.30, 4: 0.05, 9: 0.2 };
const ss = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const _dm = new THREE.Object3D(), _col = new THREE.Color(), APRON = [[1.1, 0], [-1.1, 0], [0, 1.1], [0, -1.1]]; // scratch for the rebuild (no per-rebuild or per-tuft allocation)
function updateGrass() {
  if (!grassIM) return;
  if (mode !== 'walk') { grassIM.count = 0; return; }
  const q = quality();
  if (q !== lastQ) { lastQ = q; lastGrassAt = null; grassIM.geometry = geos[q]; }
  if (lastGrassAt && Math.hypot(player.x - lastGrassAt[0], player.y - lastGrassAt[1]) < 5) return;
  lastGrassAt = [player.x, player.y];
  const { step, R, max } = QG[q];
  const dm = _dm, col = _col; let k = 0;
  for (let gx = Math.floor((player.x - R) / step); gx <= (player.x + R) / step; gx++) for (let gy = Math.floor((player.y - R) / step); gy <= (player.y + R) / step; gy++) {
    if (k >= max) break;
    const x = (gx + hash2(gx, gy)) * step, y = (gy + hash2(gy, gx)) * step;
    const dist = Math.hypot(x - player.x, y - player.y); if (dist > R) continue;
    const c = clsAt(x, y); if (c !== 0 && c !== 4 && c !== 9) continue;
    const h = hAt(x, y), forest = h > 4 || inForestPoly(x, y);
    let bare = forest ? 0.12 : BARE[c];
    // skip concrete aprons next to buildings
    if (c === 0 && !forest) { let nb = false; for (let a = 0; a < 4; a++) { const kk = clsAt(x + APRON[a][0], y + APRON[a][1]); if (kk === 2 || kk === 3) { nb = true; break; } } if (nb) continue; }
    const bareAmt = ss(0.62, 0.72, bareNoise(x, y) * 0.75 + bare * 0.55);
    let keep = (1 - bareAmt) * (forest ? 0.35 : c === 4 ? 0.95 : 0.8);
    if (hash2(gx * 3.1, gy * 7.7) > keep) continue;
    if (blockedBySeg(x, y, 0.3) || inMandirClear(x, y) || inDeck(x, y, 2) || onUntracedRoad(x, y)) continue;
    const dry = ss(0.55, 0.8, noiseAt(1, x / 61, y / 61));      // same dry patches as the terrain's grass tint
    const tall = 0.55 + 0.85 * noiseAt(0, x / 23, y / 23) * (c === 4 ? 0.45 : 1);
    const edge = ss(R, R * 0.7, dist), s = (0.75 + hash2(gx, gy * 2) * 0.5) * edge;
    dm.position.set(x, h - 0.02, -y); dm.rotation.set(0, hash2(gx, gy) * 6.28, 0); dm.scale.set(s, s * tall, s); dm.updateMatrix(); grassIM.setMatrixAt(k, dm.matrix);
    const v = 0.85 + hash2(gy, gx * 1.7) * 0.3;
    col.setRGB(v * (1 + 0.3 * dry), v * (1 + 0.08 * dry), v * (1 - 0.35 * dry)); grassIM.setColorAt(k, col);
    k++;
  }
  grassIM.count = k; grassIM.instanceMatrix.needsUpdate = true; grassIM.instanceColor.needsUpdate = true;
}
function buildFlowersAndRocks() {
  const dm = new THREE.Object3D();
  for (const [model, beds] of [[ASSET.flowerW, PARK_BEDS.filter((_, i) => i % 2 === 0)], [ASSET.flowerY, PARK_BEDS.filter((_, i) => i % 2 === 1)]]) {
    if (!model) continue;
    const mp = modelParts(model.scene);
    for (const p of mp.parts) {
      const pts = []; for (const [bx, by, br] of beds) for (let k = 0; k < 40; k++) { const a = hash2(k, bx) * 6.28, rr = Math.sqrt(hash2(bx, k)) * (br - 0.3); pts.push([bx + Math.cos(a) * rr, by + Math.sin(a) * rr]); }
      const im = new THREE.InstancedMesh(p.geo, p.mat, pts.length);
      pts.forEach(([x, y], i) => { const s = 0.45 / mp.h * (0.8 + hash2(x, y) * 0.5); dm.position.set(x, hAt(x, y) + 0.08, -y); dm.rotation.set(0, hash2(y, x) * 6.28, 0); dm.scale.setScalar(s); dm.updateMatrix(); im.setMatrixAt(i, dm.matrix); });
      im.castShadow = quality() === 'high'; scene.add(im);
    }
  }
  if (ASSET.rock) {
    const mp = modelParts(ASSET.rock.scene), r = rng(9), pts = [];
    for (let i = 0; i < 4000 && pts.length < 140; i++) { const x = HG.x0 + r() * TW, y = HG.y0 + r() * TD; if (hAt(x, y) < 6 || clsAt(x, y) !== 0 && clsAt(x, y) !== 9) continue; pts.push([x, y, 0.6 + r() * 1.4]); }
    for (const p of mp.parts) {
      const im = new THREE.InstancedMesh(p.geo, p.mat, pts.length);
      pts.forEach(([x, y, s], i) => { dm.position.set(x, hAt(x, y) - 0.15 * s, -y); dm.rotation.set(0, hash2(x, y) * 6.28, 0); dm.scale.setScalar(s / mp.h); dm.updateMatrix(); im.setMatrixAt(i, dm.matrix); });
      im.castShadow = true; im.receiveShadow = true; scene.add(im);
    }
  }
}

export { buildGrass, updateGrass, buildFlowersAndRocks, grassIM, lastGrassAt };
