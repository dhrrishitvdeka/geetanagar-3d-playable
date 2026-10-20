// Procedural facade textures for Guwahati houses and the materials that use them.
// Layouts are drawn in 1024-unit coordinates and rasterised at 1024 px (High), 768 (Medium) or 512 (Low).
// Each facade texture covers 2 bays x 2 floors (one 512-unit cell = 3.2 m x 3.1 m),
// so a wall shows four different windows before it repeats. Plaster areas are white in the colour map and
// get the building's paint from vertex colours (mask R channel), while frames, glass and grills keep their
// own colours.
import * as THREE from 'three';
import { rng } from '../../core/geo.js';
import { QUALITY } from '../../render/quality.js';
import { Layers, canvas, fbm, normalFromHeight, tex } from './tex.js';

export const BAY = 3.2, FLOOR = 3.1, CELL = 512;
const SZ = { low: 512, medium: 768, high: 1024 }[QUALITY], K = SZ / 1024; // facade set size in px and scale from layout units
const PX = CELL / BAY, PY = CELL / FLOOR;           // pixels per metre
const yAt = (cy, z) => cy * CELL + CELL - z * PY;   // canvas y of height z (m) above the floor in cell row cy

const PLASTER = '#f4f1ea';
const plaster = { c: PLASTER, h: 0.5, p: 1, r: 0.93 };

// dark water streaks running down from a ledge (colour only)
function streaks(L, r, x0, x1, y0, len, strength = 0.22) {
  L.overlay(g => {
    const n = Math.max(2, Math.round((x1 - x0) / 22));
    for (let i = 0; i < n; i++) {
      const x = x0 + r() * (x1 - x0), w = 3 + r() * 14, l = len * (0.35 + r() * 0.75), a = strength * (0.4 + r() * 0.8);
      const gr = g.createLinearGradient(0, y0, 0, y0 + l);
      gr.addColorStop(0, `rgba(58,54,44,${a})`); gr.addColorStop(0.5, `rgba(62,58,48,${a * 0.55})`); gr.addColorStop(1, 'rgba(62,58,48,0)');
      g.fillStyle = gr; g.beginPath(); g.moveTo(x, y0); g.lineTo(x + w, y0); g.lineTo(x + w * 0.7 + (r() - 0.5) * 4, y0 + l); g.lineTo(x + w * 0.3, y0 + l); g.closePath(); g.fill();
    }
    // a soft general dirty wash under the ledge
    const gr = g.createLinearGradient(0, y0, 0, y0 + len * 0.6);
    gr.addColorStop(0, `rgba(70,64,52,${strength * 0.5})`); gr.addColorStop(1, 'rgba(70,64,52,0)');
    g.fillStyle = gr; g.fillRect(x0, y0, x1 - x0, len * 0.6);
  });
}
// soft shade under a projecting ledge (chajja / slab), colour only
function ledgeShade(L, x0, x1, y0, h, a = 0.25) {
  L.overlay(g => { const gr = g.createLinearGradient(0, y0, 0, y0 + h); gr.addColorStop(0, `rgba(40,36,30,${a})`); gr.addColorStop(1, 'rgba(40,36,30,0)'); g.fillStyle = gr; g.fillRect(x0, y0, x1 - x0, h); });
}
function slabBand(L, cy) { // painted floor slab edge across the top of each floor cell row
  L.rect(0, cy * CELL, 1024, 26, { c: '#ebe7de', h: 0.62, p: 1, r: 0.93 });
  L.rect(0, cy * CELL + 26, 1024, 3, { c: '#a9a499', h: 0.45, p: 1, r: 0.93 });
}
// glass: sky reflection gradient, optionally with a curtain or a dark open room behind
function glass(L, r, x, y, w, h, kind) {
  L.rect(x, y, w, h, { c: '#3a4146', h: 0.18, p: 0, r: 0.12 });
  L.overlay(g => {
    if (kind === 'curtain') {
      const cols = ['#b88f72', '#8f7a62', '#7e9a8c', '#c9b48b', '#9a5f55', '#8a9690', '#d6c9b0'];
      g.fillStyle = cols[Math.floor(r() * cols.length)]; g.fillRect(x, y, w, h);
      for (let i = 0; i < w; i += 9) { g.fillStyle = `rgba(0,0,0,${0.08 + r() * 0.12})`; g.fillRect(x + i, y, 4, h); }
    } else if (kind === 'dark') {
      g.fillStyle = '#1e1c1a'; g.fillRect(x, y, w, h);
      g.fillStyle = 'rgba(120,110,95,0.25)'; g.fillRect(x, y + h * 0.65, w, h * 0.35);
    } else {
      const gr = g.createLinearGradient(x, y, x + w * 0.3, y + h);
      gr.addColorStop(0, '#a9b6bd'); gr.addColorStop(0.45, '#6e7a80'); gr.addColorStop(1, '#3b4247'); g.fillStyle = gr; g.fillRect(x, y, w, h);
    }
    // glass sheen and dust
    const s = g.createLinearGradient(x, y, x + w, y + h); s.addColorStop(0, 'rgba(255,255,255,0.10)'); s.addColorStop(0.5, 'rgba(255,255,255,0.02)'); s.addColorStop(1, 'rgba(255,255,255,0.08)');
    g.fillStyle = s; g.fillRect(x, y, w, h);
  });
  L.rect(x, y, w, h, { r: kind === 'curtain' ? 0.2 : 0.1, p: 0 });
}
function frameBox(L, x, y, w, h, t, s) { L.rect(x, y, w, t, s); L.rect(x, y + h - t, w, t, s); L.rect(x, y, t, h, s); L.rect(x + w - t, y, t, h, s); }

// ---- RCC house: steel-framed casements behind a painted steel safety grill ----
function paintRCC(seed) {
  const L = new Layers(SZ, SZ, K), r = rng(seed);
  L.rect(0, 0, 1024, 1024, plaster);
  const FR = ['#3f4a43', '#4c3a2e', '#d9d6cc', '#3e4954', '#6b6f70'], GR = ['#2d3033', '#4a4f53', '#6b7176', '#d8d6cf', '#35463b'];
  const kinds = [['curtain', 'clear'], ['dark', 'curtain'], ['clear', 'dark'], ['curtain', 'curtain']];
  for (let cy = 0; cy < 2; cy++) {
    slabBand(L, cy);
    for (let cx = 0; cx < 2; cx++) {
      const x0 = cx * CELL, wW = (cy === 1 && cx === 1 ? 1.3 : 1.65) * PX, x = x0 + (CELL - wW) / 2;
      const yTop = yAt(cy, 2.1), ySill = yAt(cy, 0.82), wh = ySill - yTop;
      const frame = { c: FR[Math.floor(r() * FR.length)], h: 0.42, p: 0, r: 0.55 }, grill = { c: GR[Math.floor(r() * GR.length)], h: 0.9, p: 0, r: 0.5 };
      ledgeShade(L, x0, x0 + CELL, yTop - 26, 34, 0.28);
      // plaster reveal around the opening
      L.rect(x - 10, yTop - 6, wW + 20, wh + 12, { c: '#e9e5dc', h: 0.38, p: 1, r: 0.93 });
      const [k1, k2] = kinds[cy * 2 + cx];
      glass(L, r, x, yTop, wW / 2, wh, k1); glass(L, r, x + wW / 2, yTop, wW / 2, wh, k2);
      frameBox(L, x, yTop, wW, wh, 9, frame); L.rect(x + wW / 2 - 4, yTop, 8, wh, frame);
      for (const hx of [x, x + wW / 2]) for (let j = 1; j < 3; j++) L.rect(hx + 4, yTop + (wh * j) / 3 - 2, wW / 2 - 8, 4, frame); // glazing bars
      // ventilator above the window: small glass strip under the lintel
      // safety grill: verticals + two rails + a band of diamonds near the top
      const gx = x - 4, gw = wW + 8;
      frameBox(L, gx, yTop - 4, gw, wh + 8, 6, grill);
      for (let i = gx + 14; i < gx + gw - 6; i += 16) L.rect(i, yTop, 4, wh, grill);
      L.rect(gx, yTop + wh * 0.33, gw, 5, grill); L.rect(gx, yTop + wh * 0.7, gw, 5, grill);
      L.gc.strokeStyle = grill.c; L.gc.lineWidth = 3; L.gh.strokeStyle = '#e6e6e6'; L.gh.lineWidth = 3;
      for (const g of [L.gc, L.gh]) { g.beginPath(); for (let i = gx; i < gx + gw - 16; i += 32) { const yy = yTop + wh * 0.33 + 2; g.moveTo(i, yy - 18); g.lineTo(i + 16, yy - 2); g.lineTo(i + 32, yy - 18); } g.stroke(); }
      // projecting sill
      L.rect(x - 22, ySill + 4, wW + 44, 12, { c: '#e3dfd5', h: 0.75, p: 1, r: 0.93 });
      streaks(L, r, x - 18, x + wW + 18, ySill + 16, CELL * 0.33, 0.26);
      streaks(L, r, x0 + 10, x0 + CELL - 10, cy * CELL + 30, CELL * 0.25, 0.12);
    }
  }
  pipe(L, r, 1004);
  L.plasterPass(seed);
  return L;
}

// ---- sliding aluminium windows (newer RCC houses and flats) ----
function paintSlide(seed) {
  const L = new Layers(SZ, SZ, K), r = rng(seed);
  L.rect(0, 0, 1024, 1024, plaster);
  const alu = { c: '#b7bab8', h: 0.45, p: 0, r: 0.35 }, aluD = { c: '#8e9290', h: 0.4, p: 0, r: 0.35 };
  const boxGrill = { c: '#e2e0d8', h: 0.92, p: 0, r: 0.5 };
  for (let cy = 0; cy < 2; cy++) {
    slabBand(L, cy);
    for (let cx = 0; cx < 2; cx++) {
      const x0 = cx * CELL, small = cy === 0 && cx === 1, wW = (small ? 1.2 : 1.95) * PX, x = x0 + (CELL - wW) / 2;
      const yTop = yAt(cy, 2.1), ySill = yAt(cy, small ? 1.2 : 0.9), wh = ySill - yTop;
      ledgeShade(L, x0, x0 + CELL, yTop - 26, 34, 0.25);
      L.rect(x - 8, yTop - 8, wW + 16, wh + 16, { c: '#e6e2d9', h: 0.36, p: 1, r: 0.93 });
      const panes = small ? 2 : 3, pw = wW / panes;
      for (let i = 0; i < panes; i++) glass(L, r, x + i * pw, yTop, pw, wh, (cx + cy + i) % 3 === 0 ? 'curtain' : i === 1 && cy === 1 ? 'dark' : 'clear');
      frameBox(L, x, yTop, wW, wh, 12, alu);
      for (let i = 1; i < panes; i++) { L.rect(x + i * pw - 7, yTop, 14, wh, alu); L.rect(x + i * pw + 6, yTop, 2, wh, aluD); }
      L.rect(x, ySill - 14, wW, 4, aluD);
      if ((cx + cy) % 2 === 1) { // a box grill in front, common on ground and first floors
        const gx = x - 14, gy = yTop - 14, gw = wW + 28, gh = wh + 22;
        frameBox(L, gx, gy, gw, gh, 7, boxGrill);
        for (let i = gx + 26; i < gx + gw - 8; i += 26) L.rect(i, gy, 4, gh, boxGrill);
        for (let j = gy + 26; j < gy + gh - 8; j += 26) L.rect(gx, j, gw, 4, boxGrill);
      }
      L.rect(x - 16, ySill + 6, wW + 32, 10, { c: '#dedad0', h: 0.72, p: 1, r: 0.93 });
      streaks(L, r, x - 12, x + wW + 12, ySill + 16, CELL * 0.3, 0.22);
      streaks(L, r, x0 + 10, x0 + CELL - 10, cy * CELL + 30, CELL * 0.2, 0.1);
    }
  }
  L.plasterPass(seed + 1);
  return L;
}

// ---- Assam-type house: lime-washed walls, timber posts, small barred windows with wooden shutters ----
function paintAssam(seed) {
  const L = new Layers(SZ, SZ, K), r = rng(seed);
  L.rect(0, 0, 1024, 1024, plaster);
  const SH = ['#5d6f5a', '#4e6676', '#6f5a43', '#7a6a4f', '#56705f'], wood = { c: '#6a5440', h: 0.6, p: 0, r: 0.85 }, bar = { c: '#3a3836', h: 0.85, p: 0, r: 0.5 };
  for (let cy = 0; cy < 2; cy++) {
    // painted dado band and plinth, eave shade at the top
    L.rect(0, yAt(cy, 0.8), 1024, 0.8 * PY, { c: '#b9bdb6', h: 0.5, p: 0.55, r: 0.93 });
    L.rect(0, yAt(cy, 0.8) - 6, 1024, 6, { c: '#9fa29b', h: 0.55, p: 0.4, r: 0.93 });
    ledgeShade(L, 0, 1024, cy * CELL, 70, 0.35);
    for (let cx = 0; cx < 2; cx++) {
      const x0 = cx * CELL, sc = { c: SH[Math.floor(r() * SH.length)], h: 0.66, p: 0, r: 0.85 };
      // timber post at the bay edge and a wall plate under the eave
      L.rect(x0, cy * CELL, 16, CELL, wood); L.rect(0, cy * CELL + 40, 1024, 10, wood);
      if (cy === 1 && cx === 1) { // a plank door
        const dw = 0.95 * PX, dx = x0 + (CELL - dw) / 2, dt = yAt(cy, 2.05);
        L.rect(dx - 10, dt - 10, dw + 20, CELL * (cy + 1) - dt + 10, wood);
        L.rect(dx, dt, dw, CELL * (cy + 1) - dt, sc);
        for (let i = dx + 12; i < dx + dw; i += 18) L.rect(i, dt, 2, CELL * (cy + 1) - dt, { c: 'rgba(0,0,0,0.25)', h: 0.55 });
        streaks(L, r, dx - 8, dx + dw + 8, dt + 2, 60, 0.18);
        continue;
      }
      const wW = 0.95 * PX, x = x0 + (CELL - wW) / 2, yTop = yAt(cy, 2.0), ySill = yAt(cy, 0.85), wh = ySill - yTop;
      L.rect(x - 12, yTop - 12, wW + 24, wh + 24, wood);
      glass(L, r, x, yTop, wW, wh, 'dark');
      for (let i = 1; i < 6; i++) L.rect(x + (wW * i) / 6 - 3, yTop, 6, wh, bar);
      if ((cx + cy) % 2 === 0) { // shutters swung open against the wall
        for (const sx of [x - 12 - wW / 2, x + wW + 12]) {
          L.rect(sx, yTop - 4, wW / 2, wh + 8, sc);
          for (let i = 10; i < wW / 2; i += 16) L.rect(sx + i, yTop, 2, wh, { c: 'rgba(0,0,0,0.22)', h: 0.6 });
          L.rect(sx, yTop + wh * 0.5, wW / 2, 5, { c: 'rgba(0,0,0,0.2)', h: 0.7 });
        }
      } else { // shutters closed
        L.rect(x, yTop, wW, wh, sc); L.rect(x + wW / 2 - 2, yTop, 4, wh, { c: '#2e2a26', h: 0.5 });
        for (let i = 10; i < wW; i += 16) L.rect(x + i, yTop, 2, wh, { c: 'rgba(0,0,0,0.22)', h: 0.6 });
      }
      // small ventilator high up
      const vy = yAt(cy, 2.55); L.rect(x + wW / 2 - 40, vy, 80, 30, wood); glass(L, r, x + wW / 2 - 34, vy + 5, 68, 20, 'dark');
      streaks(L, r, x - 10, x + wW + 10, ySill + 12, CELL * 0.22, 0.2);
    }
  }
  L.plasterPass(seed + 2, 1.4);
  return L;
}

// ---- blank side walls: plaster, slab lines, a drain pipe, cracks and stains ----
function pipe(L, r, x) {
  L.rect(x, 0, 12, 1024, { c: '#3a3d3f', h: 0.95, p: 0, r: 0.4 });
  L.rect(x + 2, 0, 3, 1024, { c: '#55595b', h: 1, p: 0, r: 0.4 });
  for (let y = 60; y < 1024; y += 340) L.rect(x - 4, y, 20, 8, { c: '#2b2d2e', h: 1, p: 0 });
}
function paintBlank(seed) {
  const L = new Layers(SZ, SZ, K), r = rng(seed);
  L.rect(0, 0, 1024, 1024, plaster);
  for (let cy = 0; cy < 2; cy++) { slabBand(L, cy); streaks(L, r, 0, 1024, cy * CELL + 30, CELL * 0.45, 0.17); }
  // patch repairs in slightly different plaster
  for (let i = 0; i < 5; i++) { const w = 60 + r() * 160, h = 40 + r() * 120; L.rect(r() * (1024 - w), r() * (1024 - h), w, h, { c: r() < 0.5 ? '#ebe6dc' : '#f7f4ee', h: 0.53, p: 1, r: 0.93 }); }
  // hairline cracks
  L.overlay(g => { g.strokeStyle = 'rgba(60,55,48,0.35)'; g.lineWidth = 1.2; for (let i = 0; i < 6; i++) { let x = r() * 1024, y = r() * 1024; g.beginPath(); g.moveTo(x, y); for (let k = 0; k < 8; k++) { x += (r() - 0.5) * 30; y += 8 + r() * 18; g.lineTo(x, y); } g.stroke(); } });
  // a small toilet ventilator in one cell
  const vx = 700, vy = yAt(1, 2.2); L.rect(vx - 8, vy - 8, 0.6 * PX + 16, 0.45 * PY + 16, { c: '#e6e2d9', h: 0.38, p: 1 }); glass(L, r, vx, vy, 0.6 * PX, 0.45 * PY, 'clear');
  for (let i = 1; i < 4; i++) L.rect(vx, vy + i * 0.45 * PY / 4, 0.6 * PX, 4, { c: '#4a4f53', h: 0.8, p: 0 });
  streaks(L, r, vx - 6, vx + 0.6 * PX + 6, vy + 0.45 * PY + 8, 120, 0.2);
  pipe(L, r, 220);
  L.plasterPass(seed + 3, 1.3);
  return L;
}

// ---- roofs: weathered concrete slab, corrugated tin ----
function paintSlab(seed) {
  const L = new Layers(512, 512), r = rng(seed), n = fbm(seed, 512, 512, 3, 5);
  L.rect(0, 0, 512, 512, { c: '#d6d3cc', h: 0.5, p: 1, r: 0.95 });
  const d = L.gc.getImageData(0, 0, 512, 512);
  for (let y = 0; y < 512; y++) for (let x = 0; x < 512; x++) { const i = (y * 512 + x) * 4, v = n(x, y), k = 0.62 + v * 0.55 + (r() - 0.5) * 0.08; const moss = Math.max(0, 0.45 - v) * 0.5; d.data[i] *= k * (1 - moss * 0.3); d.data[i + 1] *= k * (1 - moss * 0.15); d.data[i + 2] *= k * (1 - moss * 0.45); }
  L.gc.putImageData(d, 0, 0);
  return L;
}
function paintTin(seed) {
  const L = new Layers(256, 256), r = rng(seed), n = fbm(seed, 256, 256, 2, 4);
  // 12 corrugations across the tile (tile = 1 m), running along v (down the slope)
  const d = L.gc.createImageData(256, 256), hd = L.gh.createImageData(256, 256);
  for (let y = 0; y < 256; y++) for (let x = 0; x < 256; x++) {
    const i = (y * 256 + x) * 4, wv = Math.sin((x / 256) * Math.PI * 2 * 12), rust = Math.max(0, n(x, y) - 0.45) * 1.6;
    const k = 0.86 + wv * 0.1 + (r() - 0.5) * 0.05;
    d.data[i] = 235 * k * (1 - rust * 0.1); d.data[i + 1] = 235 * k * (1 - rust * 0.35); d.data[i + 2] = 235 * k * (1 - rust * 0.55); d.data[i + 3] = 255;
    hd.data[i] = hd.data[i + 1] = hd.data[i + 2] = 128 + wv * 100; hd.data[i + 3] = 255;
  }
  L.gc.putImageData(d, 0, 0); L.gh.putImageData(hd, 0, 0);
  L.rect(0, 0, 256, 256, { p: 1, r: 0.55 });
  return L;
}

// ---- balcony railing (alpha-tested), greyscale so vertex colours can tint it ----
function railingTexture() {
  const c = canvas(512, 256), g = c.getContext('2d');
  g.clearRect(0, 0, 512, 256); g.fillStyle = '#d0d0d0';
  g.fillRect(0, 0, 512, 16); g.fillRect(0, 240, 512, 16); g.fillRect(0, 150, 512, 8);   // top rail, bottom rail, mid rail
  for (let x = 0; x < 512; x += 32) g.fillRect(x, 0, 6, 256);                           // balusters
  g.fillRect(0, 0, 12, 256); g.fillStyle = '#bdbdbd';
  g.lineWidth = 5; g.strokeStyle = '#c4c4c4'; g.beginPath(); for (let x = 0; x < 512; x += 64) { g.moveTo(x, 158); g.quadraticCurveTo(x + 32, 230, x + 64, 158); } g.stroke();
  const t = tex(c, true); return t;
}

// ---------- materials ----------
// Facade shader additions: paint mask, dusty colour variation, a damp/grime band at the foot of the
// walls (aH = height above the ground at each vertex) and faint rain streaking.
const GLSL_NOISE = `
float bh_(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7))) * 43758.5453); }
float vn_(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
  return mix(mix(bh_(i), bh_(i+vec2(1,0)), f.x), mix(bh_(i+vec2(0,1)), bh_(i+vec2(1,1)), f.x), f.y); }`;
function patchFacade(m, { grime = 1, paintMask = true } = {}) {
  m.onBeforeCompile = sh => {
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aH;\nvarying float vH;\nvarying vec3 vWP;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvH = aH;\nvWP = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vH;\nvarying vec3 vWP;' + GLSL_NOISE)
      .replace('#include <color_fragment>', '')
      .replace('#include <map_fragment>', `
        vec4 texel = texture2D(map, vMapUv);
        float paint = ${paintMask ? 'texture2D(roughnessMap, vMapUv).r' : '1.0'};
        vec3 col = texel.rgb * mix(vec3(1.0), vColor.rgb, paint);
        float along = vWP.x * 0.71 - vWP.z * 0.7;
        float big = vn_(vec2(along * 0.18, vWP.y * 0.12) + vWP.xz * 0.05);
        float wash = vn_(vec2(along * 1.3, vWP.y * 0.06));
        col *= mix(1.0, 0.86 + 0.2 * big, paint);
        col *= 1.0 - 0.10 * smoothstep(0.55, 0.9, wash) * paint;            // long rain-washed streaks
        float lim = 0.5 + 0.9 * vn_(vec2(along * 0.8, 3.1));
        float damp = (1.0 - smoothstep(lim * 0.6, lim, vH)) * ${grime.toFixed(2)};
        col = mix(col, col * vec3(0.5, 0.52, 0.44), damp * 0.8);             // dark damp/moss band
        float dust = (1.0 - smoothstep(0.0, 2.2, vH)) * 0.35 * ${grime.toFixed(2)};
        col = mix(col, vec3(0.42, 0.36, 0.29), dust * (0.4 + 0.6 * big));      // red-brown splash dust
        diffuseColor.rgb *= col;`);
  };
  m.customProgramCacheKey = () => 'geetFacade' + grime + paintMask;
  return m;
}
function facadeMat(L, normalStrength, opts) {
  const t = L.textures(normalStrength);
  const m = new THREE.MeshStandardMaterial({ map: t.map, normalMap: t.normal, roughnessMap: t.mr, roughness: 1, metalness: 0, vertexColors: true, side: THREE.DoubleSide });
  m.normalScale.set(1, 1);
  return patchFacade(m, opts);
}

let FACADE = null;
export function facadeMaterials() {
  if (FACADE) return FACADE;
  const t0 = performance.now();
  const slab = paintSlab(41).textures(1.5), tin = paintTin(43).textures(3);
  FACADE = {
    rcc: facadeMat(paintRCC(11), 3),
    slide: facadeMat(paintSlide(13), 3),
    assam: facadeMat(paintAssam(17), 3),
    blank: facadeMat(paintBlank(19), 2.5),
    roof: new THREE.MeshStandardMaterial({ map: slab.map, normalMap: slab.normal, vertexColors: true, roughness: 0.95, side: THREE.DoubleSide }),
    tin: new THREE.MeshStandardMaterial({ map: tin.map, normalMap: tin.normal, vertexColors: true, roughness: 0.55, metalness: 0.35, side: THREE.DoubleSide }),
    trim: patchFacade(new THREE.MeshStandardMaterial({ map: slab.map, vertexColors: true, roughness: 0.92 }), { grime: 1, paintMask: false }),
    rail: new THREE.MeshStandardMaterial({ map: railingTexture(), vertexColors: true, alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.5, metalness: 0.4 }),
  };
  FACADE.ms = performance.now() - t0;
  console.info(`facades: ${SZ} px sets, ${FACADE.ms.toFixed(0)} ms`);
  return FACADE;
}
