import * as THREE from 'three';
import { GEO, hAt, clsAt, hash2, pointInPoly } from '../core/geo.js';
import { QUALITY } from '../render/quality.js';
import { BLD, ROOFS } from './buildings.js';
import { MeshBuilder, simplifyRing } from './bldg/mesh.js';
import { LANDMARK_STYLE } from './landmarks.js';
import OVERRIDES from '../../data/buildings_overrides.json';

// Procedural construction detail, not a survey of individual homes. Existing builders
// already supply windows, balconies, random AC boxes, tanks, washing and dishes.
// These assemblies add connected services on clear side-lane facades, never ground clutter.
const BUDGETS = { low: 36, medium: 120, high: 260 }, CELL = 100;
const COLORS = { pipe: '#a9aaa0', metal: '#686f6c', cabinet: '#a0a69b', dark: '#3e4745', cream: '#d8d8ca', rust: '#8b6853', tile: '#a8a395' };

// Sample the actual rendered footprint network; long thin houses can cross several cells.
function footprintIndex(buildings) {
  const cells = new Map(), size = 20;
  for (const b of buildings) {
    if (b.p.length < 3) continue;
    const xs = b.p.map(p => p[0]), ys = b.p.map(p => p[1]);
    for (let x = Math.floor(Math.min(...xs) / size); x <= Math.floor(Math.max(...xs) / size); x++)
      for (let y = Math.floor(Math.min(...ys) / size); y <= Math.floor(Math.max(...ys) / size); y++) {
        const key = x + ',' + y;
        if (!cells.has(key)) cells.set(key, []);
        cells.get(key).push(b);
      }
  }
  return (x, y, self) => (cells.get(Math.floor(x / size) + ',' + Math.floor(y / size)) || [])
    .some(b => b !== self && pointInPoly(x, y, b.p));
}

// Exported separately so placements can be tested against terrain and neighboring homes
// without creating a WebGL context. Plan entries retain their exact wall/height provenance.
function planResidentialDetails({ quality = QUALITY, buildings = GEO.buildings, built = BLD, roofs = ROOFS, heightAt = hAt, classAt = clsAt, overrides = OVERRIDES, landmarks = LANDMARK_STYLE } = {}) {
  const builtByCenter = new Map(built.map(b => [b.c, b]));
  const roofByCenter = new Map(roofs.map(r => [r.c, r]));
  const occupied = footprintIndex(buildings), candidates = [];
  for (const [bi, b] of buildings.entries()) {
    const rendered = builtByCenter.get(b.c);
    if (!rendered || b.p.length < 3 || b.k || b.d < 35 || b.a < 45 || landmarks.has(b)) continue;
    // Split traced blobs have separate rendered centers. Only the exact, existing house
    // matched above is used: do not guess a wall from the enclosing unsplit footprint.
    const roof = roofByCenter.get(b.c), pts = roof ? roof.pts : simplifyRing(b.p, 0.85);
    const area = pts.reduce((sum, p, i) => { const q = pts[(i + 1) % pts.length]; return sum + p[0] * q[1] - q[0] * p[1]; }, 0);
    const winding = area >= 0 ? 1 : -1;
    const seed = hash2(b.c[0] * 1.31, b.c[1] * 0.79);
    const s2 = hash2(b.c[1] * 1.3, b.c[0] * 0.9), s3 = hash2(b.c[0] * 2.1 + 5, b.c[1] * 0.3);
    // Same predicate as buildings.js: avoid adding a second condenser to a house
    // which already received its original procedural AC unit(s).
    const ov = overrides[bi] || {};
    const tin = ov.roof ? ov.roof === 'tin' : rendered.floors === 1 || (rendered.floors === 2 && b.a < 140 && s2 < 0.4);
    if (!roof && !tin) continue; // unfinished/occluded RCC roofs are not tin eaves
    const existingAC = !tin && hash2(s2 * 17, s3) < (rendered.floors >= 3 ? 0.65 : 0.3);
    const edges = [];
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i], b1 = pts[(i + 1) % pts.length], length = Math.hypot(b1[0] - a[0], b1[1] - a[1]);
      if (length < 4.5) continue;
      const u = [(b1[0] - a[0]) / length, (b1[1] - a[1]) / length], n = [u[1] * winding, -u[0] * winding];
      const start = length - 2.65, end = length - 0.22;
      let clear = true, groundMin = Infinity, groundMax = -Infinity;
      for (let al = start; al <= end + 1e-6; al += (end - start) / 8) {
        const wx = a[0] + u[0] * al, wy = a[1] + u[1] * al, h = heightAt(wx, wy);
        groundMin = Math.min(groundMin, h); groundMax = Math.max(groundMax, h);
        for (const offset of [0.08, 0.3, 0.55]) {
          const x = wx + n[0] * offset, y = wy + n[1] * offset, cls = classAt(x, y);
          if ([1, 4, 5].includes(cls) || (offset === 0.55 && [2, 3].includes(cls)) || occupied(x, y, b)) clear = false;
        }
      }
      if (!clear || groundMax - groundMin > 0.8 || rendered.top - groundMax < 2.7) continue;
      if (roof && roof.E[i]?.hid > groundMin + 1) continue;
      edges.push({ a, u, n, length, groundMin, groundMax, edgeIndex: i });
    }
    if (!edges.length) continue;
    edges.sort((a, b) => hash2(a.a[0] + 17, a.a[1]) - hash2(b.a[0] + 17, b.a[1]));
    const edge = edges[0], pipeAl = edge.length - 0.35;
    const pipeGround = heightAt(edge.a[0] + edge.u[0] * pipeAl, edge.a[1] + edge.u[1] * pipeAl);
    candidates.push({ ...edge, center: b.c, source: b, top: rendered.top, pipeGround, floors: rendered.floors, flat: !!roof,
      condenser: !!roof && !existingAC && rendered.floors >= 2, seed, rank: hash2(b.c[0] - 31.7, b.c[1] + 11.9) });
  }
  // One stable ordering makes Low a strict subset of Medium and High.
  return candidates.sort((a, b) => a.rank - b.rank || a.center[0] - b.center[0]).slice(0, BUDGETS[quality] ?? BUDGETS.medium);
}

let result = null;
function buildResidentialDetails() {
  if (result) return result;
  const plan = planResidentialDetails(), cells = new Map();
  const col = Object.fromEntries(Object.entries(COLORS).map(([key, hex]) => [key, new THREE.Color(hex)]));
  const count = { buildings: plan.length, flatRoofDrains: 0, eaveDrains: 0, eaveBraces: 0, meters: 0, condensers: 0, meshes: 0, vertices: 0, quality: QUALITY };
  const materials = {
    paint: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.86 }),
    metal: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.65, metalness: 0.25 }),
  };
  for (const p of plan) {
    const key = Math.floor(p.center[0] / CELL) + ',' + Math.floor(p.center[1] / CELL);
    if (!cells.has(key)) cells.set(key, { paint: new MeshBuilder(), metal: new MeshBuilder() });
    const cell = cells.get(key), box = (layer, a0, a1, d0, d1, z0, z1, color) => cell[layer].box(p.a, p.u, p.n, a0, a1, d0, d1, z0, z1, col[color], 'fbtulr', p.pipeGround);
    const pipeAl = p.length - 0.35, bottom = p.pipeGround + 0.12, pipeTop = p.top - (p.flat ? 0.1 : 0.2);
    // A close-fitting rainwater downpipe; bends and clamp plates explain how it is mounted.
    box('paint', pipeAl - 0.045, pipeAl + 0.045, 0.09, 0.18, bottom, pipeTop, 'pipe');
    box('paint', pipeAl - 0.07, pipeAl + 0.07, 0.02, p.flat ? 0.24 : 0.35, pipeTop - 0.06, pipeTop + 0.06, 'pipe');
    box('paint', pipeAl - 0.055, pipeAl + 0.055, 0.09, 0.26, bottom, bottom + 0.12, 'pipe');
    for (let z = bottom + 0.45; z < pipeTop - 0.2; z += QUALITY === 'low' ? 2.8 : 1.6) {
      box('metal', pipeAl - 0.08, pipeAl + 0.08, 0.02, 0.085, z - 0.035, z + 0.035, 'metal');
      box('metal', pipeAl - 0.065, pipeAl + 0.065, 0.08, 0.195, z - 0.025, z + 0.025, 'metal');
    }
    if (p.flat) {
      // Scupper through the parapet at the slab edge, attached to the actual roof elevation.
      box('metal', pipeAl - 0.11, pipeAl + 0.11, 0.015, 0.25, p.top - 0.12, p.top + 0.07, 'dark'); count.flatRoofDrains++;
    } else {
      // Tin-house eave gutter: short matched section, not a second roof or fake facade.
      box('metal', p.length - 2.45, p.length - 0.2, 0.09, 0.3, p.top - 0.24, p.top - 0.15, 'metal'); count.eaveDrains++;
      // A couple of worn timber diagonal eave brackets on low houses. Their ends
      // stay against the existing overhang; no support posts enter the walking space.
      if (QUALITY !== 'low' && p.floors <= 2 && p.seed < 0.6) for (const al of [p.length - 2.3, p.length - 0.65]) {
        const point = (d, z, offset) => [p.a[0] + p.u[0] * (al + offset) + p.n[0] * d, p.a[1] + p.u[1] * (al + offset) + p.n[1] * d, z];
        for (const offset of [-0.025, 0.025]) cell.paint.quad(point(0.03, p.top - 0.62, offset), point(0.31, p.top - 0.24, offset), point(0.31, p.top - 0.18, offset), point(0.03, p.top - 0.56, offset), [p.u[0] * Math.sign(offset), p.u[1] * Math.sign(offset), 0], col.rust);
        count.eaveBraces++;
      }
    }
    if (p.seed < 0.72) {
      const meterAl = p.length - 1.2, meterGround = hAt(p.a[0] + p.u[0] * meterAl, p.a[1] + p.u[1] * meterAl);
      const meterZ = meterGround + 1.18;
      box('paint', meterAl - 0.2, meterAl + 0.2, 0.015, 0.06, meterZ - 0.07, meterZ + 0.56, 'tile');
      box('metal', meterAl - 0.15, meterAl + 0.15, 0.06, 0.17, meterZ, meterZ + 0.46, 'cabinet');
      box('metal', meterAl - 0.075, meterAl + 0.075, 0.171, 0.177, meterZ + 0.24, meterZ + 0.36, 'dark');
      box('metal', meterAl + 0.1, meterAl + 0.12, 0.17, 0.19, meterZ + 0.12, meterZ + 0.19, 'metal');
      const conduitTop = Math.min(p.top - 0.35, meterZ + 1.35);
      box('paint', meterAl - 0.015, meterAl + 0.015, 0.035, 0.065, meterZ + 0.46, conduitTop, 'pipe'); count.meters++;
    }
    if (p.condenser && QUALITY !== 'low') {
      const a0 = p.length - 2.55, a1 = a0 + 0.85, z = p.groundMax + 2.05;
      box('paint', a0, a1, 0.08, 0.42, z, z + 0.55, 'cream');
      for (const al of [a0 + 0.1, a1 - 0.1]) {
        box('metal', al - 0.025, al + 0.025, 0.02, 0.46, z - 0.045, z, 'rust');
        box('metal', al - 0.025, al + 0.025, 0.02, 0.065, z - 0.3, z + 0.03, 'metal');
      }
      // A small radial grille, made from rectangles in the shared metal batch.
      const mid = (a0 + a1) / 2;
      box('metal', mid - 0.2, mid + 0.2, 0.421, 0.426, z + 0.08, z + 0.47, 'dark');
      for (let j = 0; j < (QUALITY === 'high' ? 7 : 4); j++) {
        const al = mid - 0.17 + j * (QUALITY === 'high' ? 0.055 : 0.11);
        box('metal', al, al + 0.012, 0.427, 0.433, z + 0.09, z + 0.46, 'metal');
      }
      // Condensate line ends against the wall above ground, never across a lane.
      box('paint', a1 - 0.025, a1 + 0.005, 0.04, 0.07, p.groundMax + 0.2, z + 0.12, 'pipe'); count.condensers++;
    }
  }
  for (const [key, cell] of cells) for (const layer of ['paint', 'metal']) {
    const builder = cell[layer], mesh = builder.mesh(materials[layer], { cast: QUALITY !== 'low' });
    if (mesh) { mesh.name = `residential_${layer}_${key}`; count.meshes++; count.vertices += builder.verts; }
  }
  if (!plan.length) for (const material of Object.values(materials)) material.dispose();
  result = Object.freeze(count);
  return result;
}

export { buildResidentialDetails, planResidentialDetails, BUDGETS };
