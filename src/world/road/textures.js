import * as THREE from 'three';
import { renderer } from '../../core/context.js';
import { rng } from '../../core/geo.js';
import { QUALITY } from '../../render/quality.js';

// ---------- procedural PBR-ish textures for roads, kerbs, walls (all generated, no external assets) ----------
// Each painter draws three aligned canvases from the same seed: colour (sRGB), roughness and bump (linear).
const ANISO = renderer.capabilities.getMaxAnisotropy();
// Low halves every canvas and skips bump maps; painting stays in full-size units, so the layout is unchanged
const K = QUALITY === 'low' ? 0.5 : 1, BUMP = QUALITY !== 'low';
function tex(c, srgb, repeat = true) {
  const t = new THREE.CanvasTexture(c); t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace; t.anisotropy = ANISO;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping; return t;
}
function canv(w, h) { const c = document.createElement('canvas'); c.width = Math.round(w * K); c.height = Math.round(h * K); const g = c.getContext('2d'); g.setTransform(K, 0, 0, K, 0, 0); return [c, g]; }
// paint the same shapes on several layers: L = { col, rough, bump } contexts (no bump context on Low)
function layers(w, h) { const o = {}; for (const k of BUMP ? ['col', 'rough', 'bump'] : ['col', 'rough']) { const [c, g] = canv(w, h); o[k] = g; o[k + 'C'] = c; } return o; }
function maps(L, extra = {}) { return { map: tex(L.colC, true), roughnessMap: tex(L.roughC, false), bumpMap: L.bumpC ? tex(L.bumpC, false) : null, ...extra }; }
const grey = v => `rgb(${v},${v},${v})`;
// draw wrapped so the tile stays seamless
function wrapDraw(w, h, x, y, r, fn) { for (const dx of [-w, 0, w]) for (const dy of [-h, 0, h]) if (x + dx > -r && x + dx < w + r && y + dy > -r && y + dy < h + r) fn(x + dx, y + dy); }
function noise(g, w, h, n, seed, cols, size = 1.5) { const r = rng(seed); for (let i = 0; i < n; i++) { g.fillStyle = cols[Math.floor(r() * cols.length)]; const s = r() * size + 0.5; g.fillRect(r() * w, r() * h, s, s); } }
function blobs(g, w, h, n, seed, colFn, rmin, rmax, flat = 0.6) {
  const r = rng(seed);
  for (let i = 0; i < n; i++) { const x = r() * w, y = r() * h, a = rmin + r() * (rmax - rmin), b = a * (flat + r() * (1 - flat)), rot = r() * 3, c = colFn(r);
    wrapDraw(w, h, x, y, a, (px, py) => { const gr = g.createRadialGradient(px, py, 0, px, py, a); gr.addColorStop(0, c); gr.addColorStop(1, c.replace(/[\d.]+\)$/, '0)'));
      g.save(); g.translate(px, py); g.rotate(rot); g.scale(1, b / a); g.translate(-px, -py); g.fillStyle = gr; g.beginPath(); g.arc(px, py, a, 0, 7); g.fill(); g.restore(); }); }
}
function crack(gs, w, h, r, x, y, len, width) {
  let a = r() * 6.28; const pts = [[x, y]];
  for (let k = 0; k < len; k++) { a += (r() - 0.5) * 0.7; x += Math.cos(a) * 7; y += Math.sin(a) * 7; pts.push([x, y]); if (r() < 0.08) crack(gs, w, h, r, x, y, len * 0.4 | 0, width * 0.7); }
  for (const [g, style, lw] of gs) { g.strokeStyle = style; g.lineWidth = width * lw; g.lineCap = 'round';
    for (const dx of [-w, 0, w]) for (const dy of [-h, 0, h]) { g.beginPath(); pts.forEach(([px, py], i) => (i ? g.lineTo(px + dx, py + dy) : g.moveTo(px + dx, py + dy))); g.stroke(); } }
}

// worn asphalt: 1024 px = 8 m. Aggregate, repaired patches, cracks, oil stains, tyre polish.
function asphalt() {
  const W = 1024, L = layers(W, W), r = rng(5);
  L.col.fillStyle = '#5f6164'; L.col.fillRect(0, 0, W, W); L.rough.fillStyle = grey(225); L.rough.fillRect(0, 0, W, W); if (L.bump) { L.bump.fillStyle = grey(128); L.bump.fillRect(0, 0, W, W); }
  blobs(L.col, W, W, 40, 11, q => (q() < 0.5 ? `rgba(70,72,76,${0.25 + q() * 0.2})` : `rgba(128,126,120,${0.12 + q() * 0.12})`), 60, 220);
  // repair patches: darker, smoother, slightly raised, crisp edges
  for (let i = 0; i < 4; i++) { const pw = 80 + r() * 180, ph = 60 + r() * 120, x = r() * W, y = r() * W, v = r(), pts = [];
    for (let k = 0; k < 14; k++) { const a = k / 14 * 6.283 + r() * 0.3, f = 0.3 + r() * 0.3; pts.push([Math.cos(a) * pw * f, Math.sin(a) * ph * f]); }
    wrapDraw(W, W, x, y, 300, (px, py) => { for (const [g, f] of [[L.col, v < 0.5 ? 'rgba(66,68,71,0.45)' : 'rgba(84,86,88,0.4)'], [L.rough, grey(200)], ...(L.bump ? [[L.bump, grey(142)]] : [])]) { g.fillStyle = f; g.beginPath(); pts.forEach(([a, b], k) => (k ? g.lineTo(px + a, py + b) : g.moveTo(px + a, py + b))); g.closePath(); g.fill(); } }); }
  noise(L.col, W, W, 90000, 21, ['#4e5053', '#686a6d', '#727270', '#45474a', '#7a7975', '#5a5c5f'], 1.6);
  if (L.bump) noise(L.bump, W, W, 60000, 21, [grey(90), grey(165), grey(110), grey(150)], 2.2);
  noise(L.rough, W, W, 20000, 23, [grey(245), grey(205)], 2);
  // cracks: dark, rough, recessed
  for (let i = 0; i < 5; i++) crack([[L.col, 'rgba(32,32,33,0.5)', 1], ...(L.bump ? [[L.bump, grey(80), 1.3]] : []), [L.rough, grey(255), 1]], W, W, r, r() * W, r() * W, 8 + r() * 22 | 0, 0.9 + r() * 0.8);
  // oil and rubber stains: dark and glossy
  blobs(L.col, W, W, 14, 31, q => `rgba(28,26,24,${0.25 + q() * 0.3})`, 18, 70, 0.4);
  blobs(L.rough, W, W, 14, 31, q => `rgba(110,110,110,${0.5 + q() * 0.3})`, 18, 70, 0.4);
  // dusty, lighter flecks
  blobs(L.col, W, W, 25, 41, q => `rgba(160,150,132,${0.1 + q() * 0.12})`, 20, 90);
  return maps(L);
}
// dust drift along the asphalt edge: alpha ramps up toward v = 1 (the road edge). 512 x 128, u along the road
function dustEdge() {
  const [c, g] = canv(512, 128), r = rng(61);
  const gr = g.createLinearGradient(0, 0, 0, 128); gr.addColorStop(0, 'rgba(138,128,114,0)'); gr.addColorStop(0.5, 'rgba(138,128,114,0.2)'); gr.addColorStop(1, 'rgba(134,124,108,0.8)');
  g.fillStyle = gr; g.fillRect(0, 0, 512, 128);
  for (let i = 0; i < 9000; i++) { const y = Math.pow(r(), 0.6) * 128, a = (y / 128) * 0.5; g.fillStyle = r() < 0.5 ? `rgba(120,104,84,${a})` : `rgba(185,172,150,${a})`; g.fillRect(r() * 512, y, 1 + r() * 3, 1 + r() * 2); }
  for (let i = 0; i < 24; i++) { const x = r() * 512, w = 20 + r() * 70, h = 20 + r() * 60; const gg = g.createRadialGradient(x, 128, 0, x, 128, w); gg.addColorStop(0, 'rgba(140,124,100,0.5)'); gg.addColorStop(1, 'rgba(140,124,100,0)'); g.fillStyle = gg; g.fillRect(x - w, 128 - h, w * 2, h); }
  g.clearRect(0, 0, 512, 3); // fully transparent inner edge (no bleed from the opaque side)
  const t = tex(c, true); t.wrapT = THREE.ClampToEdgeWrapping; t.flipY = false; return t; // v = 0 (canvas top) is the inner, clear edge
}
// grey-brown dusty earth shoulder with pebbles and tyre ruts: 512 px = 4 m
function shoulder() {
  const W = 512, L = layers(W, W);
  L.col.fillStyle = '#8a8378'; L.col.fillRect(0, 0, W, W); L.rough.fillStyle = grey(250); L.rough.fillRect(0, 0, W, W); if (L.bump) { L.bump.fillStyle = grey(128); L.bump.fillRect(0, 0, W, W); }
  blobs(L.col, W, W, 50, 71, q => (q() < 0.5 ? `rgba(108,100,90,${0.3 + q() * 0.2})` : `rgba(160,150,134,${0.2 + q() * 0.2})`), 25, 110);
  blobs(L.col, W, W, 10, 72, q => `rgba(96,104,70,${0.15 + q() * 0.15})`, 20, 60); // a little weedy green
  noise(L.col, W, W, 40000, 73, ['#78706a', '#9e968a', '#6a625a', '#aaa294', '#87807a'], 2.0);
  if (L.bump) noise(L.bump, W, W, 30000, 73, [grey(80), grey(180), grey(120)], 2.4);
  const r = rng(74); for (let i = 0; i < 220; i++) { const x = r() * W, y = r() * W, s = 1 + r() * 2.2; L.col.fillStyle = r() < 0.5 ? '#a49b8e' : '#6c6155'; L.col.beginPath(); L.col.ellipse(x, y, s, s * 0.7, r() * 3, 0, 7); L.col.fill(); if (L.bump) { L.bump.fillStyle = grey(210); L.bump.beginPath(); L.bump.ellipse(x, y, s, s * 0.7, 0, 0, 7); L.bump.fill(); } }
  return maps(L);
}
// black-and-white kerb blocks, worn paint and grime at the foot. 512 x 64 = 2.4 m along (four 0.6 m blocks), v up the face
function kerb(light = '#e4e1d8') {
  const W = 512, H = 64, L = layers(W, H), r = rng(81);
  L.rough.fillStyle = grey(200); L.rough.fillRect(0, 0, W, H); if (L.bump) { L.bump.fillStyle = grey(128); L.bump.fillRect(0, 0, W, H); }
  for (let k = 0; k < 4; k++) { const x = k * 128; L.col.fillStyle = k % 2 ? '#1c1d1f' : light; L.col.fillRect(x, 0, 128, H); if (L.bump) { L.bump.fillStyle = grey(90); L.bump.fillRect(x, 0, 2, H); } }
  // chipped paint showing grey concrete
  for (let i = 0; i < 160; i++) { const x = r() * W, y = r() * H, s = 1 + r() * 6; L.col.fillStyle = `rgba(150,146,138,${0.5 + r() * 0.5})`; L.col.fillRect(x, y, s * 1.5, s); }
  // grime and splashed mud toward the road (low v) and dust on top
  const gr = L.col.createLinearGradient(0, 0, 0, H); gr.addColorStop(0, 'rgba(105,88,70,0.75)'); gr.addColorStop(0.45, 'rgba(105,88,70,0.15)'); gr.addColorStop(1, 'rgba(105,88,70,0.05)'); L.col.fillStyle = gr; L.col.fillRect(0, 0, W, H);
  noise(L.col, W, H, 3500, 82, ['rgba(90,74,58,0.5)', 'rgba(0,0,0,0.3)', 'rgba(255,255,255,0.15)'], 2);
  return maps(L);
}
// cast concrete with water streaks and mould: 512 px = 2 m
function concrete(seed = 91, base = '#a9a59c') {
  const W = 512, L = layers(W, W), r = rng(seed);
  L.col.fillStyle = base; L.col.fillRect(0, 0, W, W); L.rough.fillStyle = grey(225); L.rough.fillRect(0, 0, W, W); if (L.bump) { L.bump.fillStyle = grey(128); L.bump.fillRect(0, 0, W, W); }
  blobs(L.col, W, W, 30, seed + 1, q => (q() < 0.6 ? `rgba(90,88,80,${0.12 + q() * 0.15})` : `rgba(200,196,186,${0.1 + q() * 0.1})`), 30, 140);
  for (let i = 0; i < 26; i++) { const x = r() * W, w = 4 + r() * 18, h = 60 + r() * 300, y = r() * W; const gg = L.col.createLinearGradient(0, y, 0, y + h); gg.addColorStop(0, 'rgba(60,58,52,0.28)'); gg.addColorStop(1, 'rgba(60,58,52,0)'); L.col.fillStyle = gg; wrapDraw(W, W, x, y, 320, (px, py) => L.col.fillRect(px, py, w, h)); }
  blobs(L.col, W, W, 8, seed + 2, q => `rgba(60,70,48,${0.15 + q() * 0.15})`, 20, 70); // mould
  noise(L.col, W, W, 30000, seed + 3, ['rgba(70,68,62,0.35)', 'rgba(220,216,206,0.3)'], 1.6);
  if (L.bump) noise(L.bump, W, W, 30000, seed + 3, [grey(100), grey(160)], 1.8);
  return maps(L);
}
// irregular red brickwork with recessed mortar: 512 x 256 = 1.8 m x 0.9 m
function brick() {
  const W = 512, H = 256, L = layers(W, H), r = rng(101);
  L.col.fillStyle = '#9d9184'; L.col.fillRect(0, 0, W, H); L.rough.fillStyle = grey(250); L.rough.fillRect(0, 0, W, H); if (L.bump) { L.bump.fillStyle = grey(60); L.bump.fillRect(0, 0, W, H); }
  const bh = 21.3, bw = 64; // ~75 mm courses, 225 mm bricks
  for (let row = 0; row < 12; row++) { const y = row * bh, off = row % 2 ? bw / 2 : 0;
    for (let x = -bw; x < W + bw; x += bw) { const v = 0.78 + r() * 0.35, jx = (r() - 0.5) * 2, red = r() < 0.12 ? [120, 62, 46] : [168, 78, 56];
      L.col.fillStyle = `rgb(${red[0] * v | 0},${red[1] * v | 0},${red[2] * v | 0})`; L.col.fillRect(x + off + 2 + jx, y + 2, bw - 4, bh - 4);
      const bv = grey(170 + r() * 50 | 0); // drawn only when bump maps exist; the draw consumes the same random value either way
      if (L.bump) { L.bump.fillStyle = bv; L.bump.fillRect(x + off + 2 + jx, y + 2, bw - 4, bh - 4); }
      L.rough.fillStyle = grey(215); L.rough.fillRect(x + off + 2, y + 2, bw - 4, bh - 4); } }
  noise(L.col, W, H, 12000, 102, ['rgba(60,30,20,0.35)', 'rgba(220,180,150,0.2)', 'rgba(0,0,0,0.2)'], 1.6);
  // dust and damp at the foot of the wall
  const gr = L.col.createLinearGradient(0, H * 0.55, 0, H); gr.addColorStop(0, 'rgba(110,96,80,0)'); gr.addColorStop(1, 'rgba(110,96,80,0.45)'); L.col.fillStyle = gr; L.col.fillRect(0, 0, W, H);
  return maps(L);
}
// vertical-bar railing infill with alpha: 256 x 128 = 1.2 m along, the full height
function railBars() {
  const [c, g] = canv(256, 128); g.clearRect(0, 0, 256, 128); g.fillStyle = '#ffffff';
  for (let x = 6; x < 256; x += 32) g.fillRect(x, 0, 5, 128);
  return tex(c, true);
}
// galvanised chain-link mesh with alpha: 128 x 128 = 0.6 m square, ~60 mm diamonds
function chainLink() {
  const [c, g] = canv(128, 128); g.clearRect(0, 0, 128, 128); g.strokeStyle = '#ffffff'; g.lineWidth = 2.2;
  for (let k = -128; k < 256; k += 16) { g.beginPath(); g.moveTo(k, 0); g.lineTo(k + 128, 128); g.stroke(); g.beginPath(); g.moveTo(k, 128); g.lineTo(k + 128, 0); g.stroke(); }
  return tex(c, true);
}
// square ornamental panel for the field railing: dark iron frame, terracotta motif in the middle. 128 px
function fieldPanel() {
  const [c, g] = canv(128, 128);
  g.fillStyle = '#1c1c1d'; g.fillRect(0, 0, 128, 128); g.fillStyle = '#8b4a2f'; g.fillRect(10, 10, 108, 108);
  g.fillStyle = '#b4673f'; g.beginPath(); g.arc(64, 64, 40, 0, 7); g.fill();
  g.strokeStyle = '#5e2d1c'; g.lineWidth = 5; for (let k = 0; k < 8; k++) { const a = k * Math.PI / 4; g.beginPath(); g.moveTo(64, 64); g.lineTo(64 + Math.cos(a) * 40, 64 + Math.sin(a) * 40); g.stroke(); }
  g.fillStyle = '#d18a55'; g.beginPath(); g.arc(64, 64, 12, 0, 7); g.fill();
  g.strokeStyle = '#1c1c1d'; g.lineWidth = 4; g.strokeRect(22, 22, 84, 84);
  noise(g, 128, 128, 900, 111, ['rgba(0,0,0,0.25)', 'rgba(255,220,180,0.12)'], 1.5);
  return tex(c, true, false);
}
// a dark-blue wrap-around advertising banner (generic text) for the Hatigarh pillar
function banner() {
  const [c, g] = canv(512, 512);
  g.fillStyle = '#16306b'; g.fillRect(0, 0, 512, 512);
  const gr = g.createLinearGradient(0, 0, 0, 512); gr.addColorStop(0, 'rgba(255,255,255,0.08)'); gr.addColorStop(1, 'rgba(0,0,0,0.25)'); g.fillStyle = gr; g.fillRect(0, 0, 512, 512);
  g.textAlign = 'center'; g.fillStyle = '#ffffff'; g.font = 'bold 54px Arial, sans-serif';
  for (const x of [128, 384]) { g.fillText('NEW', x, 120); g.fillText('ARRIVALS', x, 180); g.fillStyle = '#f5c518'; g.font = 'bold 40px Arial, sans-serif'; g.fillText('BIG SALE', x, 260); g.fillStyle = '#ffffff'; g.font = '26px Arial, sans-serif'; g.fillText('Hatigarh, Guwahati', x, 320); g.font = 'bold 54px Arial, sans-serif'; }
  g.fillStyle = '#f5c518'; g.fillRect(0, 400, 512, 26); g.fillStyle = '#c62828'; g.fillRect(0, 440, 512, 72);
  noise(g, 512, 512, 4000, 121, ['rgba(0,0,0,0.25)', 'rgba(255,255,255,0.1)'], 2);
  return tex(c, true);
}

export { asphalt, dustEdge, shoulder, kerb, concrete, brick, railBars, chainLink, fieldPanel, banner, canv, tex, noise, blobs };
