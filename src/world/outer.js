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

  // city blocks continuing in every direction past the traced area, in neighbourhood clusters
  const r = rng(404), boxes = [];
  OUTER_TREES.length = 0;
  for (let i = 0; i < 90000 && boxes.length < 7000; i++) {
    const x = -2300 + r() * 4600, y = -2300 + r() * 4600, dist = rectDist(x, y);
    if (dist < 4) continue;
    const rr = Math.hypot(x, y); if (rr > 2300) continue;
    const h = outerH(x, y), u = urban(x, y);
    if (h > 10) { if (r() < 0.45) OUTER_TREES.push([x, y, h, r() < 0.4 ? 'jack' : r() < 0.6 ? 'mango' : 'rain', 8 + r() * 7]); continue; }
    if (r() > 0.08 + 0.92 * u) { if (r() < 0.7) OUTER_TREES.push([x, y, h, r() < 0.45 ? 'mango' : r() < 0.6 ? 'rain' : 'jack', 7 + r() * 7]); continue; }
    if (r() < 0.25) OUTER_TREES.push([x + (r() - 0.5) * 8, y + (r() - 0.5) * 8, h, r() < 0.6 ? 'mango' : 'jack', 6 + r() * 5]);
    // floors: mostly 2-4, some single-storey Assam-type houses, a few 5-7 storey apartment blocks nearer the core
    const fl = r() < 0.18 ? 1 : r() < 0.8 ? 2 + Math.floor(r() * 3) : 5 + Math.floor(r() * 3 * Math.exp(-rr / 1800));
    boxes.push([x, y, h, 7 + r() * 9 + fl, 6 + r() * 8 + fl * 0.5, r() * Math.PI, fl]);
  }
  // keep load time and draw cost bounded: thin the groves evenly to at most 12k impostor trees
  if (OUTER_TREES.length > 12000) { const keep = 12000 / OUTER_TREES.length; const kept = OUTER_TREES.filter(() => r() < keep); OUTER_TREES.length = 0; OUTER_TREES.push(...kept); }
  // low keeps 30% and medium 60% of the outer ring, chosen by position hash so the result is the same on every load
  const keepF = q === 'low' ? 0.3 : q === 'medium' ? 0.6 : 1;
  if (keepF < 1) {
    const kb = boxes.filter(b => hash2(b[0], b[1]) < keepF), kt = OUTER_TREES.filter(t => hash2(t[0], t[1]) < keepF);
    boxes.length = 0; boxes.push(...kb); OUTER_TREES.length = 0; OUTER_TREES.push(...kt);
  }
  const dm = new THREE.Object3D(), geoB = new THREE.BoxGeometry(1, 1, 1); geoB.translate(0, 0.5, 0);
  const walls = new THREE.InstancedMesh(geoB, new THREE.MeshStandardMaterial({ color: '#fff', roughness: 0.9 }), boxes.length);
  const roofs = new THREE.InstancedMesh(geoB, new THREE.MeshStandardMaterial({ color: '#fff', roughness: 0.85 }), boxes.length * 2);
  const WC = ['#ddd5c4', '#d2c7b2', '#c9cfcb', '#e0cdb3', '#c6bfb2', '#e2c4b0', '#d3d8d6', '#cfc39a', '#c9d2b4', '#e3d9c9'].map(x => new THREE.Color(x));
  // roofs: weathered concrete mostly, then painted tin sheets (rust red, blue, green) on the single-storey houses
  const RC = [['#8d8a83', 30], ['#7d7a73', 20], ['#a29d92', 15], ['#8a5440', 10], ['#5f7387', 8], ['#5e7458', 7], ['#9b4a3a', 6], ['#6b6b6b', 4]];
  const roofCol = () => { let u = r() * 100; for (const [k, w] of RC) { u -= w; if (u <= 0) return new THREE.Color(k); } return new THREE.Color(RC[0][0]); };
  let nr = 0;
  boxes.forEach((b, i) => {
    const H = b[6] * 3.1 + 0.5 + (b[6] === 1 ? 0.6 : 0);
    dm.position.set(b[0], b[2] - 0.5, -b[1]); dm.rotation.set(0, b[5], 0); dm.scale.set(b[3], H, b[4]); dm.updateMatrix(); walls.setMatrixAt(i, dm.matrix);
    walls.setColorAt(i, WC[Math.floor(r() * WC.length)].clone().multiplyScalar(0.92 + r() * 0.12));
    const tin = b[6] === 1 && r() < 0.7;
    const rc = tin ? new THREE.Color(['#8a5440', '#5f7387', '#9b4a3a', '#5e7458'][Math.floor(r() * 4)]) : roofCol();
    dm.position.set(b[0], b[2] - 0.5 + H, -b[1]); dm.scale.set(b[3] + 0.3, tin ? 0.25 : 0.12, b[4] + 0.3); dm.updateMatrix(); roofs.setMatrixAt(nr, dm.matrix); roofs.setColorAt(nr++, rc);
    // stair head-room / water-tank block on many flat roofs
    if (!tin && b[6] > 1 && r() < 0.55) {
      const ox = (r() - 0.5) * b[3] * 0.5, oz = (r() - 0.5) * b[4] * 0.5, c0 = Math.cos(b[5]), s0 = Math.sin(b[5]);
      dm.position.set(b[0] + ox * c0 + oz * s0, b[2] - 0.5 + H, -b[1] - ox * s0 + oz * c0); dm.scale.set(3 + r() * 2, 2.4, 3 + r() * 2); dm.updateMatrix();
      roofs.setMatrixAt(nr, dm.matrix); roofs.setColorAt(nr++, WC[Math.floor(r() * WC.length)].clone().multiplyScalar(0.85));
    }
  });
  roofs.count = nr;
  for (const im of [walls, roofs]) { im.receiveShadow = true; im.castShadow = false; scene.add(im); }
}

export { fbm, rectDist, outerH, buildOuter, RX0, RX1, RY0, RY1, OUTER_TREES };
