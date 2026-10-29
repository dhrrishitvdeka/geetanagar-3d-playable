import * as THREE from 'three';
import { hAt, rng } from '../core/geo.js';
import { QUALITY } from '../render/quality.js';
import { MeshBuilder } from './bldg/mesh.js';
import { MAINP, NRM, RF, MAIN_JUNC, FP_W, FP_H, asphHalf, medHalf, hw, edgeKind, fpHeightAt } from './mainroad.js';

// Small surface details, not new surveyed features. Everything is flush to an existing
// road/footpath surface and adds no collision geometry or obstacles at access points.
const UP = [0, 0, 1];
const CFG = { low: { joints: 3, patches: 8, drains: 24, slots: 4 }, medium: { joints: 2, patches: 5, drains: 18, slots: 6 }, high: { joints: 1, patches: 3, drains: 14, slots: 8 } };

// Reconstruct the actual two triangles used by geom.strip. Sampling hAt directly at
// a decal's corners could put it above or below the existing, coarser road mesh.
function surfacePoint(side, f, q, band, lift = 0.005) {
  const i = Math.max(0, Math.min(MAINP.length - 2, Math.floor(f))), t = Math.max(0, Math.min(1, f - i));
  const corner = (j, outer) => {
    const kind = edgeKind(side, j), a = asphHalf(j);
    const inner = band === 'path' ? a : band === 'road' ? medHalf(MAINP[j][0]) : a + (kind === 'kerb' ? FP_W : 0);
    const outside = band === 'path' ? a + FP_W : band === 'road' ? a : hw(j) + 0.8;
    const off = side * (outer ? outside : inner), x = MAINP[j][0] + NRM[j][0] * off, y = MAINP[j][1] + NRM[j][1] * off;
    return [x, y, hAt(x, y) + (band === 'path' ? fpHeightAt(side, j) : band === 'road' ? 0.06 : 0.04)];
  };
  const A = corner(i, false), B = corner(i, true), C = corner(i + 1, false), D = corner(i + 1, true);
  return A.map((_, k) => (t + q <= 1 ? A[k] + t * (C[k] - A[k]) + q * (B[k] - A[k])
    : D[k] + (1 - t) * (B[k] - D[k]) + (1 - q) * (C[k] - D[k])) + (k === 2 ? lift : 0));
}

function clearSpan(side, f0, f1) {
  const a = Math.max(0, Math.floor(f0)), b = Math.min(MAINP.length - 1, Math.ceil(f1));
  const lo = Math.min(MAINP[a][0], MAINP[b][0]), hi = Math.max(MAINP[a][0], MAINP[b][0]);
  const overlaps = (x, r) => x + r >= lo && x - r <= hi;
  if (RF.crossings.some(c => overlaps(c.x, 3))) return false;
  if (RF.speed_breakers.some(c => overlaps(c.x, 5))) return false;
  if (RF.junctions.some(j => j.side === (side === 1 ? 'N' : 'S') && overlaps(j.x, j.w / 2 + 3))) return false;
  return !MAIN_JUNC.some(j => j.side === side && overlaps(j.x, j.w / 2 + 3));
}

function surfaceQuad(builder, side, f0, f1, q0, q1, band, color, lift = 0.005) {
  // Split at every sample boundary, keeping details on the piecewise road surface.
  for (let f = f0; f < f1 - 1e-6;) {
    const end = Math.min(f1, Math.floor(f + 1e-6) + 1);
    builder.quad(surfacePoint(side, f, q0, band, lift), surfacePoint(side, end, q0, band, lift),
      surfacePoint(side, end, q1, band, lift), surfacePoint(side, f, q1, band, lift), UP, color);
    f = end;
  }
}

let built = false;
function buildStreetscape() {
  if (built) return; built = true;
  const cfg = CFG[QUALITY] || CFG.medium, random = rng(9061), cells = new Map();
  const joint = new THREE.Color('#66615a'), rim = new THREE.Color('#8c8980'), slot = new THREE.Color('#343833');
  const steel = new THREE.Color('#777b73'), edge = new THREE.Color('#686963');
  const dust = ['#a0927c', '#948773', '#aa9a82', '#8d826f'].map(c => new THREE.Color(c));
  const get = i => {
    const key = Math.floor(i / 40);
    if (!cells.has(key)) cells.set(key, { surface: new MeshBuilder(), metal: new MeshBuilder() });
    return cells.get(key);
  };
  let joints = 0, drains = 0, patches = 0;
  for (const side of [1, -1]) for (let i = 2; i < MAINP.length - 3; i++) {
    if (!clearSpan(side, i - 0.4, i + 0.7)) continue;
    const kind = edgeKind(side, i);
    if (kind !== 'kerb' && kind !== 'open') continue;
    const { surface, metal } = get(i);
    // Narrow slab seams, with an occasional pale concrete lip. Stay off ramp ends.
    if (kind === 'kerb' && fpHeightAt(side, i - 0.4) >= FP_H - 0.001 && fpHeightAt(side, i + 0.7) >= FP_H - 0.001) {
      if (i % cfg.joints === 0) {
        surfaceQuad(surface, side, i, i + 0.013, 0.035, 0.965, 'path', joint);
        if (i % 4 === 0) surfaceQuad(surface, side, i + 0.016, i + 0.032, 0.04, 0.96, 'path', rim);
        joints++;
      }
      // A small flush inspection lid with a frame, recessed slits and two hinge tabs.
      if ((i + (side === 1 ? 3 : 0)) % cfg.drains === 0) {
        const f0 = i + 0.16, f1 = i + 0.44;
        surfaceQuad(surface, side, f0 - 0.025, f1 + 0.025, 0.275, 0.725, 'path', joint, 0.006);
        surfaceQuad(metal, side, f0, f1, 0.3, 0.7, 'path', steel, 0.009);
        for (let j = 0; j < cfg.slots; j++) {
          const f = f0 + 0.025 + j * 0.23 / cfg.slots;
          surfaceQuad(surface, side, f, f + 0.009, 0.35, 0.65, 'path', slot, 0.011);
        }
        for (const f of [f0 + 0.04, f1 - 0.055]) surfaceQuad(metal, side, f, f + 0.015, 0.285, 0.32, 'path', rim, 0.012);
        drains++;
      }
    }
    if (i % cfg.patches !== 0) continue;
    // Broken small edge chips on asphalt and dry deposits on the earth shoulder;
    // patches vary in width/length and leave the carriageway markings readable.
    const f0 = i + 0.08, f1 = i + 0.32 + random() * 0.25;
    const roadWidth = Math.max(1, asphHalf(i) - medHalf(MAINP[i][0]));
    const q0 = 1 - (0.1 + random() * 0.16) / roadWidth;
    surfaceQuad(surface, side, f0, f1, q0, 0.995, 'road', edge, 0.008);
    const q = 0.08 + random() * 0.18, width = 0.12 + random() * 0.16;
    const color = dust[Math.floor(random() * dust.length)];
    surfaceQuad(surface, side, f0 + 0.05, f1, q, q + width, 'shoulder', color, 0.009);
    surfaceQuad(surface, side, f0, f0 + 0.05, q + 0.03, q + width * 0.8, 'shoulder', color, 0.009);
    patches++;
  }
  const surfaceMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.98 });
  const metalMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.62, metalness: 0.45 });
  let meshes = 0, vertices = 0;
  for (const [key, cell] of cells) for (const [layer, material] of [['surface', surfaceMat], ['metal', metalMat]]) {
    const builder = cell[layer], mesh = builder.mesh(material, { cast: false });
    if (!mesh) continue;
    mesh.name = `streetscape_${layer}_${key}`; vertices += builder.verts; meshes++;
  }
  return { joints, drains, patches, meshes, vertices };
}

export { buildStreetscape };
