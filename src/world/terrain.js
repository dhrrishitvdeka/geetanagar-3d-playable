import * as THREE from 'three';
import { renderer, scene } from '../core/context.js';
import { CLS, CRES, CW, CH, CX0, CX1, CY0, CY1, HG, HGY1, HV, MANDIR, clsAt, hAt, hAtBase, hash2, mandirBump, pointInPoly } from '../core/geo.js';
import { cacheGet, cacheLater, texKey } from '../render/texcache.js';
import ZONES_SRC from '../veg/zones.js?raw'; // source text of the forest polygon and untraced-road boxes, for the texture cache key
import { ASSET } from '../veg/assets.js';
import { GLSL_BARE, getNoiseTex } from '../veg/noise.js';
import { forestAmt, onUntracedRoad } from '../veg/zones.js';
import { M } from './materials.js';
import { QUALITY } from '../render/quality.js';

// ---------- terrain mesh with painted ground ----------
const TW = (HG.nx - 1) * HG.step, TD = (HG.ny - 1) * HG.step;
const tgeo = new THREE.PlaneGeometry(TW, TD, HG.nx - 1, HG.ny - 1);
tgeo.rotateX(-Math.PI / 2);
{
  const pos = tgeo.attributes.position;
  for (let k = 0; k < pos.count; k++) {
    const x = pos.getX(k) + HG.x0 + TW / 2, y = -pos.getZ(k) + HG.y0 + TD / 2;
    pos.setXYZ(k, x, hAt(x, y), -y);
  }
  tgeo.computeVertexNormals();
}
const GPX = QUALITY === 'high' ? 2 : 1; // texels per metre
const mkCanvasTex = () => {
  const c = document.createElement('canvas'); c.width = Math.round(TW * GPX); c.height = Math.round(TD * GPX);
  const t = new THREE.CanvasTexture(c); t.anisotropy = renderer.capabilities.getMaxAnisotropy(); return [c, t];
};
// groundTex: macro albedo (grass tint, forest floor, shoulders). maskTex: R = bare-earth propensity, G = leaf litter, B = concrete/paved
const [groundCanvas, groundTex] = mkCanvasTex(); groundTex.colorSpace = THREE.SRGBColorSpace;
const [maskCanvas, maskTex] = mkCanvasTex();
const terrain = new THREE.Mesh(tgeo, new THREE.MeshStandardMaterial({ map: groundTex, roughness: 0.97 }));
terrain.receiveShadow = true; scene.add(terrain);

// ---------- ground cache ----------
// paintGround() takes about 1.6 s. A later run restores the two RGBA arrays it writes (alpha 255 everywhere) and puts them on the
// canvases exactly as the painting does. The key covers paintGround and the functions and data it samples (class raster, height grid,
// forest and road boxes), the preset and the browser. Top-level await because paintGround() is called synchronously.
const GROUND_KEY = texKey(`ground:${QUALITY}`, [
  paintGround.toString(), ZONES_SRC, [clsAt, hAt, hAtBase, mandirBump, hash2, pointInPoly].map(f => f.toString()).join(';'),
  CLS, HV, [HG.x0, HG.y0, HG.nx, HG.ny, HG.step, HGY1, CX0, CX1, CY0, CY1, CRES, CW, CH, TW, TD, GPX], MANDIR, QUALITY]);
const T_READ = performance.now();
let GROUND_HIT = await cacheGet(GROUND_KEY);
const GROUND_READ_MS = performance.now() - T_READ;

function paintGround() {
  const W = groundCanvas.width, H = groundCanvas.height;
  const g = groundCanvas.getContext('2d'), gm = maskCanvas.getContext('2d');
  const hit = GROUND_HIT; GROUND_HIT = null;
  const okArr = a => a instanceof Uint8ClampedArray && a.length === W * H * 4;
  if (hit && hit.w === W && hit.h === H && okArr(hit.col) && okArr(hit.msk)) {
    const t0 = performance.now();
    g.putImageData(new ImageData(hit.col, W, H), 0, 0); gm.putImageData(new ImageData(hit.msk, W, H), 0, 0);
    groundTex.needsUpdate = true; maskTex.needsUpdate = true;
    console.info(`ground: ${W}x${H} px, from cache, ${(GROUND_READ_MS + performance.now() - t0).toFixed(0)} ms`);
    return;
  }
  const img = g.createImageData(W, H), d = img.data, mimg = gm.createImageData(W, H), md = mimg.data;
  // sRGB base tints; the detail textures in the shader supply the fine structure
  const PAL = { 0: [128, 146, 92], 1: [140, 128, 104], 2: [124, 136, 96], 3: [126, 130, 100], 4: [112, 150, 80], 5: [170, 124, 90], 9: [104, 132, 76] };
  const FOREST_FLOOR = [92, 108, 64];
  // per-class [bare, litter, concrete] propensities (0..1); bare is thresholded against noise in the shader
  // under building footprints the ground is normally hidden; if a footprint has no building it should read as a yard, not a scar
  const MASK = { 0: [0.30, 0.05, 0], 1: [0.95, 0, 0.1], 2: [0.35, 0, 0.45], 3: [0.5, 0, 0.55], 4: [0.05, 0, 0], 5: [1, 0, 0], 9: [0.2, 0.15, 0] };
  const step = 1.1;
  for (let py = 0; py < H; py++) {
    const y = HGY1 - (py + 0.5) / GPX;
    for (let px = 0; px < W; px++) {
      const x = HG.x0 + (px + 0.5) / GPX;
      const c = clsAt(x, y), h = hAt(x, y);
      let col = PAL[c] || PAL[0], mk = MASK[c] || MASK[0], litter = mk[1], conc = mk[2], bare = mk[0];
      const fa = (c === 0 || c === 9) ? forestAmt(x, y, h) : 0; // 0..1: the forest floor fades in over ~3 m of height instead of switching at h = 4
      if (fa >= 1) { col = FOREST_FLOOR; litter = 0.85; bare = 0.12; }
      else {
        if (onUntracedRoad(x, y)) bare = 1;
        else if (c === 0) {
          // concrete aprons and courtyards hugging buildings; dusty strips along lanes
          let nb = 0, nr = 0;
          for (const [dx, dy] of [[step, 0], [-step, 0], [0, step], [0, -step]]) { const k = clsAt(x + dx, y + dy); if (k === 2 || k === 3) nb++; else if (k === 1) nr++; }
          if (nb) conc = Math.min(1, 0.35 + nb * 0.25) * (hash2(Math.floor(x / 9), Math.floor(y / 9)) < 0.55 ? 1 : 0.35);
          if (nr) bare = Math.max(bare, 0.75);
        }
        if (fa > 0) { col = [col[0] + (FOREST_FLOOR[0] - col[0]) * fa, col[1] + (FOREST_FLOOR[1] - col[1]) * fa, col[2] + (FOREST_FLOOR[2] - col[2]) * fa]; litter += (0.85 - litter) * fa; bare += (0.12 - bare) * fa; }
      }
      const n = hash2(Math.floor(x * 1.3), Math.floor(y * 1.3)) * 0.1 - 0.05 + (hash2(Math.floor(x / 7), Math.floor(y / 7)) - 0.5) * 0.12;
      const o = (py * W + px) * 4, m = 1 + n;
      d[o] = col[0] * m; d[o + 1] = col[1] * m; d[o + 2] = col[2] * m; d[o + 3] = 255;
      md[o] = bare * 255; md[o + 1] = litter * 255; md[o + 2] = conc * 255; md[o + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0); gm.putImageData(mimg, 0, 0);
  groundTex.needsUpdate = true; maskTex.needsUpdate = true;
  cacheLater(GROUND_KEY, () => ({ w: W, h: H, col: d, msk: md })); // the very arrays put above, stored when idle
}

// ---------- texture helpers ----------
const s2l = c => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
// mean colour of an image, in linear RGB, from a 64x64 downsample
function meanLinear(image) {
  const c = document.createElement('canvas'); c.width = c.height = 64; const g = c.getContext('2d'); g.drawImage(image, 0, 0, 64, 64);
  const d = g.getImageData(0, 0, 64, 64).data, m = [0, 0, 0];
  for (let i = 0; i < d.length; i += 4) for (let k = 0; k < 3; k++) m[k] += s2l(d[i + k] / 255);
  return new THREE.Vector3(m[0], m[1], m[2]).divideScalar(64 * 64);
}
// copy of a photo texture with its mean pulled to a target sRGB colour (per-channel gain) and contrast scaled
function regrade(image, target, contrast = 1) {
  const c = document.createElement('canvas'); c.width = image.width; c.height = image.height; const g = c.getContext('2d'); g.drawImage(image, 0, 0);
  const im = g.getImageData(0, 0, c.width, c.height), d = im.data, mean = [0, 0, 0];
  for (let i = 0; i < d.length; i += 4) for (let k = 0; k < 3; k++) mean[k] += d[i + k];
  for (let k = 0; k < 3; k++) mean[k] /= d.length / 4;
  const lum = (mean[0] + mean[1] + mean[2]) / 3;
  for (let i = 0; i < d.length; i += 4) {
    // shared luminance deviation keeps the grain neutral; per-channel gain sets the hue
    const dv = (d[i] + d[i + 1] + d[i + 2]) / 3 - lum;
    for (let k = 0; k < 3; k++) d[i + k] = Math.max(0, Math.min(255, target[k] + (dv * (target[k] / Math.max(1, lum)) * 0.55 + (d[i + k] - mean[k] - dv) * 0.6) * contrast));
  }
  g.putImageData(im, 0, 0);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = renderer.capabilities.getMaxAnisotropy();
  return t;
}

const GLSL_COMMON = /* glsl */`
uniform sampler2D uNoise; varying vec3 vWP;
${GLSL_BARE}
vec2 rot2(vec2 p, float a) { float c = cos(a), s = sin(a); return vec2(c * p.x - s * p.y, s * p.x + c * p.y); }
`;
const withWorldPos = sh => {
  sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vWP;')
    .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvWP = (modelMatrix * vec4(transformed, 1.0)).xyz;');
};
let FIELD_EARTH = null;

// ---------- photo textures on the ground, the field and the park lawn ----------
function applyGroundTextures() {
  const noise = getNoiseTex();
  if (ASSET.grass && ASSET.dirt) {
    const grassAvg = meanLinear(ASSET.grass.image), dirtAvg = meanLinear(ASSET.dirt.image);
    terrain.material.onBeforeCompile = sh => {
      Object.assign(sh.uniforms, { uNoise: { value: noise }, uGrass: { value: ASSET.grass }, uDirt: { value: ASSET.dirt }, uMask: { value: maskTex }, uGrassAvg: { value: grassAvg }, uDirtAvg: { value: dirtAvg } });
      withWorldPos(sh);
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\n' + GLSL_COMMON + 'uniform sampler2D uGrass, uDirt, uMask; uniform vec3 uGrassAvg, uDirtAvg;')
        .replace('#include <map_fragment>', /* glsl */`
#include <map_fragment>
{
  vec2 p = vec2(vWP.x, -vWP.z);
  vec4 msk = texture2D(uMask, vMapUv);
  vec4 nA = texture2D(uNoise, p / 61.0), nB = texture2D(uNoise, p / 13.7 + 0.5), nC = texture2D(uNoise, p / 2.9);
  // two scales of each photo texture, rotated against each other and blended by noise: no visible repeat
  vec3 g1 = texture2D(uGrass, rot2(p, 0.6) / 3.3).rgb, g2 = texture2D(uGrass, p / 8.9 + 0.37).rgb;
  vec3 gd = mix(g1, g2, smoothstep(0.25, 0.75, nB.g)) / uGrassAvg;
  vec3 d1 = texture2D(uDirt, rot2(p, 1.9) / 2.4).rgb, d2 = texture2D(uDirt, p / 6.1 + 0.71).rgb;
  vec3 dd = mix(d1, d2, smoothstep(0.25, 0.75, nB.r)) / uDirtAvg;
  float dl = dot(dd, vec3(0.333));
  // grass: macro tint times photo detail, with drier yellow-green patches
  vec3 grass = diffuseColor.rgb * mix(vec3(1.0), gd, 0.85);
  grass = mix(grass, grass * vec3(1.18, 1.05, 0.72), smoothstep(0.55, 0.8, nA.g) * 0.7);
  // dusty bare earth: Guwahati's red-brown soil, paler and greyer where trodden
  vec3 earth = vec3(0.47, 0.27, 0.155) * mix(1.0, dl, 0.8) * mix(vec3(1.0), dd / max(dl, 0.01), 0.4);
  earth = mix(earth, vec3(0.46, 0.38, 0.29) * dl, smoothstep(0.5, 0.85, nA.b) * 0.5);
  // leaf litter on the forest floor: browns and dull yellows with dark patches of humus
  vec3 litter = mix(vec3(0.16, 0.10, 0.045), vec3(0.26, 0.18, 0.07), nC.b) * mix(1.0, dl, 0.6);
  litter = mix(litter, vec3(0.06, 0.07, 0.035) * dl, smoothstep(0.6, 0.9, nC.a) * 0.6);
  // concrete aprons: weathered grey with dark water stains
  vec3 conc = vec3(0.30, 0.29, 0.26) * (0.8 + 0.35 * nC.g) * mix(1.0, 0.6, smoothstep(0.55, 0.9, nB.a));
  float bn = bareNoise(uNoise, p);
  float bare = smoothstep(0.62, 0.72, bn * 0.75 + msk.r * 0.55);
  float lit = msk.g * smoothstep(0.42, 0.7, nB.b * 0.7 + nA.r * 0.6);
  vec3 col = mix(grass, earth, bare);
  col = mix(col, litter, lit * (1.0 - bare * 0.5));
  col = mix(col, conc, smoothstep(0.3, 0.6, msk.b) * smoothstep(0.2, 0.4, nA.a + 0.25));
  diffuseColor.rgb = col;
}`);
    };
    terrain.material.needsUpdate = true;
    // park lawn: same anti-tiling treatment, kept a little greener than the yards
    const lawnAvg = grassAvg;
    M.lawn.map = ASSET.grass; M.lawn.color.set('#ffffff');
    M.lawn.onBeforeCompile = sh => {
      Object.assign(sh.uniforms, { uNoise: { value: noise }, uGrassAvg: { value: lawnAvg } });
      withWorldPos(sh);
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\n' + GLSL_COMMON + 'uniform vec3 uGrassAvg;')
        .replace('#include <map_fragment>', /* glsl */`
{
  vec2 p = vec2(vWP.x, -vWP.z);
  vec4 nA = texture2D(uNoise, p / 37.0), nB = texture2D(uNoise, p / 11.3 + 0.5);
  vec3 gd = mix(texture2D(map, rot2(p, 0.6) / 3.1).rgb, texture2D(map, p / 7.7 + 0.37).rgb, smoothstep(0.25, 0.75, nB.g)) / uGrassAvg;
  vec3 base = mix(vec3(0.085, 0.16, 0.045), vec3(0.15, 0.19, 0.06), smoothstep(0.4, 0.8, nA.r));
  diffuseColor.rgb *= base * mix(vec3(1.0), gd, 0.85);
}`);
    };
    M.lawn.customProgramCacheKey = () => 'geet-lawn';
    M.lawn.needsUpdate = true;
  }
  if (ASSET.dirt) {
    // Geetanagar Field: bare red-brown earth, ~sRGB (160, 110, 80) in daylight; the photo is far too dark, so regrade a copy
    FIELD_EARTH = regrade(ASSET.dirt.image, [170, 123, 93], 1.1);
    M.earth.map = FIELD_EARTH; M.earth.normalMap = ASSET.dirtN; M.earth.normalScale.set(0.6, 0.6); M.earth.color.setScalar(1.75); // the regraded photo is the albedo; the scene's exposure renders bare ground at about half its albedo M.earth.roughness = 1;
    M.earth.onBeforeCompile = sh => {
      sh.uniforms.uNoise = { value: noise };
      withWorldPos(sh);
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\n' + GLSL_COMMON)
        .replace('#include <map_fragment>', /* glsl */`
{
  vec2 p = vec2(vWP.x, -vWP.z);
  vec4 nA = texture2D(uNoise, p / 53.0), nB = texture2D(uNoise, p / 12.1 + 0.5), nC = texture2D(uNoise, p / 3.1);
  vec3 e = mix(texture2D(map, rot2(p, 0.4) / 3.7).rgb, texture2D(map, rot2(p, 2.1) / 9.3 + 0.37).rgb, smoothstep(0.3, 0.7, nB.g));
  e *= 0.84 + 0.32 * nA.r;                                                       // broad lighter and darker zones
  float dust = smoothstep(0.45, 0.85, nA.g * 0.7 + nB.b * 0.3);
  e = mix(e, vec3(dot(e, vec3(0.3, 0.5, 0.2))) * vec3(1.12, 1.0, 0.86) * 1.12, dust * 0.45);   // pale, dusty, sun-bleached
  e *= mix(1.0, 0.82, smoothstep(0.62, 0.9, nC.a) * 0.6);                        // compacted, slightly damp spots
  diffuseColor.rgb *= e;
}`);
    };
    M.earth.customProgramCacheKey = () => 'geet-earth';
    M.earth.needsUpdate = true;
  }
}

export { paintGround, applyGroundTextures, TW, TD, tgeo, groundCanvas, maskCanvas, GPX, groundTex, terrain, regrade, meanLinear };
