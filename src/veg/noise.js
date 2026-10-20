import * as THREE from 'three';

// ---------- one tileable 256x256 noise texture shared by ground, field, hills and vegetation ----------
// Each channel is a different scale of tileable value-noise fbm (R coarse, G medium, B fine, A cellular-ish blotches).
// The same data is sampled on the CPU (noiseAt) so grass and plant placement agree with what the shaders paint.
const NS = 256;
const NOISE = new Float32Array(NS * NS * 4);
{
  const lat = (p, seed) => { const a = new Float32Array(p * p); let s = seed; for (let i = 0; i < a.length; i++) { s = (s * 1664525 + 1013904223) >>> 0; a[i] = s / 4294967296; } return a; };
  const vnoise = (L, p, x, y) => { // tileable value noise with period p over [0,1)
    const fx = x * p, fy = y * p, ix = Math.floor(fx), iy = Math.floor(fy), u = fx - ix, v = fy - iy;
    const su = u * u * (3 - 2 * u), sv = v * v * (3 - 2 * v), g = (i, j) => L[((j % p + p) % p) * p + ((i % p + p) % p)];
    return (g(ix, iy) * (1 - su) + g(ix + 1, iy) * su) * (1 - sv) + (g(ix, iy + 1) * (1 - su) + g(ix + 1, iy + 1) * su) * sv;
  };
  const octs = [[4, 8, 16, 32], [8, 16, 32, 64], [32, 64, 128, 256]];
  const lats = octs.map((o, c) => o.map((p, k) => lat(p, 1000 + c * 97 + k * 13)));
  const cells = lat(16 * 16, 4242);
  for (let j = 0; j < NS; j++) for (let i = 0; i < NS; i++) {
    const x = i / NS, y = j / NS, o = (j * NS + i) * 4;
    for (let c = 0; c < 3; c++) { let v = 0, a = 0.5, n = 0; for (let k = 0; k < 4; k++) { v += a * vnoise(lats[c][k], octs[c][k], x, y); n += a; a *= 0.5; } NOISE[o + c] = v / n; }
    // worley-like blotches: distance to the nearest jittered point on a 16x16 tileable grid
    let dmin = 9; const gx = Math.floor(x * 16), gy = Math.floor(y * 16);
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const cx = gx + dx, cy = gy + dy, k = ((cy + 16) % 16) * 16 + (cx + 16) % 16; const px = (cx + cells[k]) / 16, py = (cy + cells[(k * 7 + 3) % 256]) / 16; dmin = Math.min(dmin, Math.hypot(px - x, py - y) * 16); }
    NOISE[o + 3] = Math.min(1, dmin);
  }
  // stretch every channel to the full 0..1 range so thresholds behave predictably
  for (let c = 0; c < 4; c++) { let lo = 1, hi = 0; for (let k = c; k < NOISE.length; k += 4) { lo = Math.min(lo, NOISE[k]); hi = Math.max(hi, NOISE[k]); } for (let k = c; k < NOISE.length; k += 4) NOISE[k] = (NOISE[k] - lo) / (hi - lo); }
}
let noiseTex = null;
function getNoiseTex() {
  if (noiseTex) return noiseTex;
  const d = new Uint8Array(NS * NS * 4); for (let i = 0; i < d.length; i++) d[i] = Math.round(NOISE[i] * 255);
  noiseTex = new THREE.DataTexture(d, NS, NS, THREE.RGBAFormat);
  noiseTex.wrapS = noiseTex.wrapT = THREE.RepeatWrapping; noiseTex.magFilter = THREE.LinearFilter; noiseTex.minFilter = THREE.LinearMipmapLinearFilter;
  noiseTex.generateMipmaps = true; noiseTex.needsUpdate = true;
  return noiseTex;
}
// bilinear CPU sample, matching texture2D(noiseTex, uv) with repeat wrapping
function noiseAt(c, u, v) {
  const fx = u * NS - 0.5, fy = v * NS - 0.5, ix = Math.floor(fx), iy = Math.floor(fy), a = fx - ix, b = fy - iy;
  const g = (i, j) => NOISE[((((j % NS) + NS) % NS) * NS + (((i % NS) + NS) % NS)) * 4 + c];
  return (g(ix, iy) * (1 - a) + g(ix + 1, iy) * a) * (1 - b) + (g(ix, iy + 1) * (1 - a) + g(ix + 1, iy + 1) * a) * b;
}
// ground "bareness" field in world metres (x east, y north); shared by terrain shader and grass placement.
// World uv convention for shaders: uv = vec2(x, -z) / scale  ==  (x, y) / scale.
const BARE_SCALE = [173, 41, 9.3];
function bareNoise(x, y) { return noiseAt(0, x / BARE_SCALE[0], y / BARE_SCALE[0]) * 0.55 + noiseAt(1, x / BARE_SCALE[1] + 0.31, y / BARE_SCALE[1] + 0.17) * 0.33 + noiseAt(2, x / BARE_SCALE[2], y / BARE_SCALE[2]) * 0.12; }
const GLSL_BARE = /* glsl */`
float bareNoise(sampler2D nt, vec2 p) {
  return texture2D(nt, p / ${BARE_SCALE[0].toFixed(1)}).r * 0.55 + texture2D(nt, p / ${BARE_SCALE[1].toFixed(1)} + vec2(0.31, 0.17)).g * 0.33 + texture2D(nt, p / ${BARE_SCALE[2].toFixed(1)}).b * 0.12;
}`;

export { getNoiseTex, noiseAt, bareNoise, GLSL_BARE, NS };
