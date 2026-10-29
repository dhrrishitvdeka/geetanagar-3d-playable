import * as THREE from 'three';
import { scene } from '../core/context.js';
import { HG, HGX1, HGY1, TERRAIN, hAt, hash2, rng } from '../core/geo.js';
import { getNoiseTex } from '../veg/noise.js';
import { quality } from '../veg/zones.js';

// ---- the wider setting: city carpet beyond the traced blocks, Guwahati's ring of hills on the horizon ----
// Guwahati from above is a patchwork of low RCC houses half-hidden under trees, with green hills all round.
// Buildings come in neighbourhood clusters; between them, tree clusters (baked impostors, handed to veg/trees.js).
function fbm(x, y) { let v = 0, a = 1, f = 1; for (let o = 0; o < 4; o++) { const ix = Math.floor(x * f), iy = Math.floor(y * f), fx = x * f - ix, fy = y * f - iy, u = fx * fx * (3 - 2 * fx), w = fy * fy * (3 - 2 * fy);
  const n = (i, j) => hash2(i + o * 17, j - o * 31); v += a * ((n(ix, iy) * (1 - u) + n(ix + 1, iy) * u) * (1 - w) + (n(ix, iy + 1) * (1 - u) + n(ix + 1, iy + 1) * u) * w); a *= 0.5; f *= 2.1; } return v / 1.875; }
const RX0 = HG.x0, RX1 = HGX1, RY0 = HG.y0, RY1 = HGY1;
function rectDist(x, y) { const dx = Math.max(RX0 - x, 0, x - RX1), dy = Math.max(RY0 - y, 0, y - RY1); return Math.hypot(dx, dy); }
// real hills around the city: Copernicus GLO-30, 60 m grid over +-4.5 km (data/terrain.json 'outer', metres above the road datum)
const OG = TERRAIN && TERRAIN.outer;
const OV = OG ? Float32Array.from(new Uint16Array(Uint8Array.from(atob(OG.b64), c => c.charCodeAt(0)).buffer), v => v / 10 - 50) : null;
function outerGrid(x, y) {
  let fx = (x - OG.x0) / OG.step, fy = (y - OG.y0) / OG.step;
  fx = Math.max(0, Math.min(OG.nx - 1.001, fx)); fy = Math.max(0, Math.min(OG.ny - 1.001, fy));
  const i = Math.floor(fx), j = Math.floor(fy), u = fx - i, v = fy - j, n = OG.nx;
  return (OV[j * n + i] * (1 - u) + OV[j * n + i + 1] * u) * (1 - v) + (OV[(j + 1) * n + i] * (1 - u) + OV[(j + 1) * n + i + 1] * u) * v;
}
function outerH(x, y) {
  if (!OV) return outerHProc(x, y);
  const cx = Math.max(RX0, Math.min(RX1, x)), cy = Math.max(RY0, Math.min(RY1, y)), t = Math.min(1, rectDist(x, y) / 250), k = t * t * (3 - 2 * t);
  return hAt(cx, cy) * (1 - k) + Math.max(-6, outerGrid(x, y)) * k;
}
// procedural stand-in, used only when data/terrain.json is missing
function outerHProc(x, y) {
  const cx = Math.max(RX0, Math.min(RX1, x)), cy = Math.max(RY0, Math.min(RY1, y)), dist = rectDist(x, y);
  let h = hAt(cx, cy) * Math.exp(-dist / 260);                                // the local hills fade out gently
  const r = Math.hypot(x + 150, y), th = Math.atan2(x + 150, y);             // 0 = north, +pi/2 = east
  // ridges: Meghalaya plateau edge to the south, Sarania-Narakasur and Kamakhya hills to the west, Narengi hills east
  const south = Math.exp(-Math.pow((th - Math.PI) / 0.95, 2)) + Math.exp(-Math.pow((th + Math.PI) / 0.95, 2));
  const west = Math.exp(-Math.pow((th + Math.PI / 2) / 0.6, 2)), east = Math.exp(-Math.pow((th - Math.PI / 2) / 0.5, 2)), north = Math.exp(-Math.pow(th / 0.7, 2));
  const ring = Math.max(0, Math.min(1, (r - 1500) / 1400));
  const amp = 330 * south + 170 * west + 140 * east + 25 * north + 40;
  h += ring * amp * (0.45 + 0.75 * fbm(x / 900 + 3, y / 900 - 2));
  return h;
}
// how built-up a spot is (0 = trees and gardens, 1 = dense blocks): neighbourhood-sized blobs, denser toward the city
function urban(x, y) { const rr = Math.hypot(x, y); return Math.max(0, Math.min(1, (fbm(x / 420 + 7, y / 420 - 4) - 0.47) * 3.5)) * Math.exp(-rr / 2600); }
const OUTER_TREES = []; // [x, y, h, species, size] -> impostors in veg/trees.js

// Pure planning helpers. These rows suggest a plausible city fabric outside the surveyed map;
// they are procedural scenery, not claimed street positions or additional mapped geography.
function outerPlanHash(x, y, salt = 0) {
  const n = Math.sin(x * 127.1 + y * 311.7 + salt * 74.7) * 43758.5453;
  return n - Math.floor(n);
}
function outerFootprintRadius(width, depth) { return Math.hypot(width, depth) / 2; }
function outerPieceTransform(b, ox, elevation, oz, width, height, depth) {
  const c = Math.cos(b.angle), s = Math.sin(b.angle);
  return { position: [b.x + ox * c + oz * s, b.ground + elevation, -b.y - ox * s + oz * c],
    scale: [width, height, depth], angle: b.angle };
}
function planOuterBuildings({ bounds, heightAt, densityAt, quality = 'high', limit = 7000 }) {
  const all = [], occupied = new Map(), tile = 144, cell = 48;
  const distance = (x, y) => Math.hypot(Math.max(bounds.x0 - x, 0, x - bounds.x1), Math.max(bounds.y0 - y, 0, y - bounds.y1));
  // Generate the same full layout for all presets, then thin it. Occupancy never depends on quality.
  for (let ty = -16; ty <= 15; ty++) for (let tx = -16; tx <= 15; tx++) {
    const cluster = outerPlanHash(tx, ty, 1);
    const angle = (cluster > 0.5 ? Math.PI / 2 : 0) + (outerPlanHash(tx, ty, 2) - 0.5) * 0.22;
    const c = Math.cos(angle), s = Math.sin(angle);
    for (let lane = 0; lane < 2; lane++) for (let plot = 0; plot < 6; plot++) for (const side of [-1, 1]) {
      const id = `${tx}:${ty}:${lane}:${plot}:${side}`, seed = tx * 31 + plot * 3 + side + lane * 19;
      const random = salt => outerPlanHash(seed, ty, salt);
      const width = 9 + random(3) * 7, depth = 8 + random(4) * 9;
      const along = (plot - 2.5) * 21.5 + (random(5) - 0.5) * 1.8;
      const across = (lane - 0.5) * 68 + side * (6 + depth / 2 + random(6) * 1.5);
      const x = tx * tile + along * c - across * s, y = ty * tile + along * s + across * c;
      const radius = outerFootprintRadius(width + 1.2, depth + 1.2), dist = distance(x, y);
      if (Math.hypot(x, y) + radius > 2300 || dist < radius + 6) continue;
      const ground = heightAt(x, y), density = densityAt(x, y);
      if (!Number.isFinite(ground) || ground > 10 || random(7) > 0.10 + 0.90 * density) continue;
      // Steep ground remains wooded rather than supporting floating or buried houses.
      if ([[radius, 0], [-radius, 0], [0, radius], [0, -radius]].some(([dx, dy]) => Math.abs(heightAt(x + dx, y + dy) - ground) > 2.2)) continue;
      const cx = Math.floor(x / cell), cy = Math.floor(y / cell);
      let overlap = false;
      for (let dx = -1; dx <= 1 && !overlap; dx++) for (let dy = -1; dy <= 1 && !overlap; dy++) {
        for (const other of occupied.get(`${cx + dx},${cy + dy}`) || []) {
          if (Math.hypot(x - other.x, y - other.y) < radius + other.radius + 1.5) { overlap = true; break; }
        }
      }
      if (overlap) continue;
      const floors = random(8) < 0.27 ? 1 : random(9) < 0.87 ? 2 + Math.floor(random(10) * 3) : 5;
      const b = { id, x, y, ground, width, depth, radius, angle, floors, distance: dist,
        pitched: floors === 1 && random(11) < 0.85, stepped: floors >= 3 && random(12) < 0.62,
        detail: dist < 270, palette: Math.floor(cluster * 5), variation: random(13), rank: random(14) };
      all.push(b);
      const key = `${cx},${cy}`;
      if (!occupied.has(key)) occupied.set(key, []);
      occupied.get(key).push(b);
    }
  }
  const keep = quality === 'low' ? 0.3 : quality === 'medium' ? 0.6 : 1;
  return all.slice(0, limit).filter(b => b.rank < keep);
}

function buildOuter() {
  const q = quality(), S = 9000, N = q === 'low' ? 112 : 225, geo = new THREE.PlaneGeometry(S, S, N, N); geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position, col = new Float32Array(pos.count * 3), c = new THREE.Color();
  const forest = new THREE.Color('#3f5a33'), forest2 = new THREE.Color('#4d6a3a'), green = new THREE.Color('#5c7a40'), dusty = new THREE.Color('#8f8a72'), roofy = new THREE.Color('#9a968c');
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = -pos.getZ(i);
    const inside = x > RX0 + 2 && x < RX1 - 2 && y > RY0 + 2 && y < RY1 - 2;
    const h = inside ? hAt(x, y) - 0.4 : outerH(x, y);
    pos.setY(i, h);
    const r = Math.hypot(x, y);
    if (h > 12 || r > 2600) c.copy(forest).lerp(forest2, fbm(x / 300, y / 300));
    else { const u = urban(x, y); c.copy(green).lerp(forest, fbm(x / 140, y / 140) * 0.5).lerp(dusty, u * 0.55).lerp(roofy, u * u * 0.3); }
    col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const ins = i => { const x = pos.getX(i), y = -pos.getZ(i); return x > RX0 + 2 && x < RX1 - 2 && y > RY0 + 2 && y < RY1 - 2; };
  const idx = geo.index.array, keep = []; for (let k = 0; k < idx.length; k += 3) if (!(ins(idx[k]) && ins(idx[k + 1]) && ins(idx[k + 2]))) keep.push(idx[k], idx[k + 1], idx[k + 2]);
  geo.setIndex(keep); geo.computeVertexNormals();
  const gmat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1 });
  // canopy texture on the ground and the hills: blotchy light/dark crowns at two scales, so slopes read as forest in the haze
  gmat.onBeforeCompile = sh => {
    sh.uniforms.uNoise = { value: getNoiseTex() };
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vOW;').replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvOW = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nuniform sampler2D uNoise; varying vec3 vOW;')
      .replace('#include <color_fragment>', `#include <color_fragment>
  { vec2 p = vec2(vOW.x, -vOW.z);
    float a = texture2D(uNoise, p / 31.0).a, b = texture2D(uNoise, p / 9.0 + 0.3).a, m = texture2D(uNoise, p / 700.0).r;
    float crowns = smoothstep(0.15, 0.75, a) * 0.6 + smoothstep(0.1, 0.8, b) * 0.4;
    diffuseColor.rgb *= mix(0.62, 1.18, crowns) * mix(0.85, 1.12, m); }`);
  };
  gmat.customProgramCacheKey = () => 'geet-outer-ground';
  const m = new THREE.Mesh(geo, gmat); m.receiveShadow = true; scene.add(m);
  // horizon: the 9 km square ends in a visible edge on high, where the far plane reaches 9.5 km; a flat forest-floor ring out to 9 km sits 40 m below
  // the square's mean edge height, and the fog hides the step between them
  { let sum = 0, n = 0; for (let k = 0; k <= 64; k++) { const t = -S / 2 + (k / 64) * S; for (const [x, y] of [[t, -S / 2], [t, S / 2], [-S / 2, t], [S / 2, t]]) { sum += outerH(x, y); n++; } }
    const ring = new THREE.Mesh(new THREE.RingGeometry(S / 2, S, 64, 1), new THREE.MeshStandardMaterial({ color: forest, roughness: 1 }));
    ring.rotation.x = -Math.PI / 2; ring.position.y = sum / n - 40; ring.name = 'horizon ring'; scene.add(ring); }

  const keepF = q === 'low' ? 0.3 : q === 'medium' ? 0.6 : 1;
  const fullHouses = planOuterBuildings({ bounds: { x0: RX0, x1: RX1, y0: RY0, y1: RY1 }, heightAt: outerH, densityAt: urban });
  const houses = fullHouses.filter(b => b.rank < keepF);
  // Keep the existing tree-impostor contract, with house clearances so crowns do not emerge through roofs.
  const houseGrid = new Map(), cell = 48;
  for (const b of fullHouses) {
    const key = Math.floor(b.x / cell) + ',' + Math.floor(b.y / cell);
    if (!houseGrid.has(key)) houseGrid.set(key, []);
    houseGrid.get(key).push(b);
  }
  const r = rng(404);
  OUTER_TREES.length = 0;
  for (let i = 0, accepted = 0; i < 90000 && accepted < 12000; i++) {
    const x = -2300 + r() * 4600, y = -2300 + r() * 4600;
    if (rectDist(x, y) < 4 || Math.hypot(x, y) > 2300) continue;
    const h = outerH(x, y), u = urban(x, y), chance = h > 10 ? 0.45 : (1 - (0.08 + 0.92 * u)) * 0.7 + 0.06;
    if (r() > chance) continue;
    const size = 7 + r() * 7, cx = Math.floor(x / cell), cy = Math.floor(y / cell);
    let blocked = false;
    for (let dx = -1; dx <= 1 && !blocked; dx++) for (let dy = -1; dy <= 1 && !blocked; dy++) {
      for (const b of houseGrid.get((cx + dx) + ',' + (cy + dy)) || []) if (Math.hypot(x - b.x, y - b.y) < b.radius + size * 0.3) { blocked = true; break; }
    }
    const species = r() < 0.45 ? 'mango' : r() < 0.6 ? 'rain' : 'jack';
    if (blocked) continue;
    accepted++;
    if (hash2(x, y) < keepF) OUTER_TREES.push([x, y, h, species, size]);
  }

  // All boxes (walls, parapets, bands and windows) share eight angular instance batches.
  // Only the low tin roofs need another geometry: at most sixteen draws for the entire city fabric.
  const box = new THREE.BoxGeometry(1, 1, 1); box.translate(0, 0.5, 0);
  const profile = new THREE.Shape(); profile.moveTo(-0.5, 0); profile.lineTo(0.5, 0); profile.lineTo(0, 1); profile.closePath();
  const gable = new THREE.ExtrudeGeometry(profile, { depth: 1, bevelEnabled: false, steps: 1 }); gable.translate(0, 0, -0.5);
  const material = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.9 });
  const groups = [Array.from({ length: 8 }, () => []), Array.from({ length: 8 }, () => [])];
  const dm = new THREE.Object3D(), colors = new Map();
  const color = hex => { if (!colors.has(hex)) colors.set(hex, new THREE.Color(hex)); return colors.get(hex); };
  const add = (b, kind, ox, elevation, oz, width, height, depth, hex) => {
    const tr = outerPieceTransform(b, ox, elevation, oz, width, height, depth);
    dm.position.fromArray(tr.position); dm.rotation.set(0, tr.angle, 0); dm.scale.fromArray(tr.scale); dm.updateMatrix();
    const sector = Math.min(7, Math.floor((Math.atan2(b.y, b.x) + Math.PI) / (2 * Math.PI) * 8));
    groups[kind][sector].push([dm.matrix.clone(), color(hex)]);
  };
  const walls = ['#d9d0bb', '#c3cfc5', '#d9c0ac', '#d6d4c9', '#cec49d'];
  const tin = ['#8b5444', '#657b88', '#657b60', '#9b5747'];
  for (const b of houses) {
    const wc = walls[b.palette], rc = b.pitched ? tin[Math.floor(b.variation * tin.length)] : '#949188';
    const detailed = b.detail && (q !== 'low' || b.rank < 0.15);
    const height = b.floors * 3.1 + 0.45, baseFloors = b.stepped ? Math.ceil(b.floors * 0.6) : b.floors;
    const baseHeight = b.stepped ? baseFloors * 3.1 : height;
    add(b, 0, 0, -0.4, 0, b.width, baseHeight + 0.4, b.depth, wc);
    add(b, 0, 0, baseHeight, 0, b.width + 0.45, 0.16, b.depth + 0.45, rc);
    let topWidth = b.width, topDepth = b.depth, topX = 0, topZ = 0;
    if (b.stepped) {
      topWidth *= 0.72; topDepth *= 0.68; topX = -b.width * 0.10; topZ = b.depth * 0.08;
      add(b, 0, topX, baseHeight, topZ, topWidth, height - baseHeight, topDepth, wc);
      add(b, 0, topX, height, topZ, topWidth + 0.35, 0.16, topDepth + 0.35, rc);
    }
    if (b.pitched) {
      add(b, 1, 0, height + 0.08, 0, b.width + 1.2, 1.7 + b.variation * 0.7, b.depth + 1.2, rc);
    } else if (detailed) {
      // Continuous low RCC parapets make roof terraces read as inhabited houses from the View point.
      const parapet = (ox, oz, w, d, elevation) => {
        for (const side of [-1, 1]) {
          add(b, 0, ox, elevation, oz + side * d / 2, w + 0.25, 0.55, 0.18, wc);
          add(b, 0, ox + side * w / 2, elevation, oz, 0.18, 0.55, d, wc);
        }
      };
      parapet(topX, topZ, topWidth, topDepth, height + 0.16);
      if (b.stepped) parapet(0, 0, b.width, b.depth, baseHeight + 0.16);
      if (!b.stepped && b.floors > 1 && b.variation < 0.6) {
        add(b, 0, b.width * 0.20, height + 0.16, b.depth * 0.18, 2.7, 2.2, 2.8, wc);
        add(b, 0, b.width * 0.20, height + 2.36, b.depth * 0.18, 2.95, 0.14, 3.05, rc);
      }
    }
    if (!detailed) continue;
    for (let floor = 0; floor < b.floors; floor++) {
      const upper = b.stepped && floor >= baseFloors;
      const w = upper ? topWidth : b.width, d = upper ? topDepth : b.depth;
      const ox = upper ? topX : 0, oz = upper ? topZ : 0, level = floor * 3.1;
      if (floor > 0) add(b, 0, ox, level, oz, w + 0.12, 0.15, d + 0.12, '#e7e1d1');
      // Two facades suffice at this distance; dark shallow boxes survive the haze without glass overdraw.
      for (const side of [-1, 1]) {
        for (let k = 0; k < 3; k++) add(b, 0, ox + (k - 1) * w * 0.26, level + 1.05, oz + side * (d / 2 + 0.035), 0.95, 1.15, 0.07, '#526365');
        for (let k = 0; k < 2; k++) add(b, 0, ox + side * (w / 2 + 0.035), level + 1.05, oz + (k - 0.5) * d * 0.42, 0.07, 1.15, 0.85, '#596968');
      }
    }
  }
  groups.forEach((sectors, kind) => sectors.forEach((items, sector) => {
    if (!items.length) return;
    const mesh = new THREE.InstancedMesh(kind ? gable : box, material, items.length);
    mesh.name = 'outer ' + (kind ? 'tin gables' : 'terraced houses') + ' sector ' + sector;
    items.forEach(([matrix, tint], i) => { mesh.setMatrixAt(i, matrix); mesh.setColorAt(i, tint); });
    mesh.receiveShadow = true; mesh.castShadow = false; mesh.computeBoundingSphere(); scene.add(mesh);
  }));
}

export { fbm, rectDist, outerH, buildOuter, RX0, RX1, RY0, RY1, OUTER_TREES, outerPlanHash, outerFootprintRadius, outerPieceTransform, planOuterBuildings };
