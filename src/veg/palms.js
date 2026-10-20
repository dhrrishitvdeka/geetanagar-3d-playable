import * as THREE from 'three';
import { renderer } from '../core/context.js';
import { rng } from '../core/geo.js';
import { patchVeg, vegDepth } from './wind.js';

// ---------- procedural yard plants of Guwahati: areca (tamul) and coconut palms, banana, bamboo clumps ----------
// Built in metres at load: curved tube trunks, arching pinnate fronds as folded alpha strips, banana leaves,
// arching bamboo culms with leaf cards. Every vertex carries aWind = (sway metres, flutter weight) for wind.js.

// ---- geometry builder ----
class Builder {
  constructor() { this.p = []; this.n = []; this.uv = []; this.c = []; this.w = []; this.i = []; }
  v(p, n, u, v, col, ws, wf) { this.p.push(p.x, p.y, p.z); this.n.push(n.x, n.y, n.z); this.uv.push(u, v); this.c.push(col.r, col.g, col.b); this.w.push(ws, wf); return this.p.length / 3 - 1; }
  tri(a, b, c) { this.i.push(a, b, c); }
  geo() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(this.n, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2)); g.setAttribute('color', new THREE.Float32BufferAttribute(this.c, 3));
    g.setAttribute('aWind', new THREE.Float32BufferAttribute(this.w, 2)); g.setIndex(this.i); g.computeBoundingSphere(); return g;
  }
}
const V = (x, y, z) => new THREE.Vector3(x, y, z), UP = V(0, 1, 0);
// tube along points pts (Vector3[]), radius r(t), sides, uv v in metres / vScale; colour col(t); sway weight sw(t)
function tube(B, pts, r, sides, vScale, col, sw) {
  let len = 0; const L = [0]; for (let k = 1; k < pts.length; k++) { len += pts[k].distanceTo(pts[k - 1]); L.push(len); }
  const base = B.p.length / 3;
  for (let k = 0; k < pts.length; k++) {
    const t = k / (pts.length - 1), T = pts[Math.min(k + 1, pts.length - 1)].clone().sub(pts[Math.max(k - 1, 0)]).normalize();
    const S = new THREE.Vector3().crossVectors(T, Math.abs(T.y) > 0.95 ? V(1, 0, 0) : UP).normalize(), U = new THREE.Vector3().crossVectors(S, T);
    for (let s = 0; s <= sides; s++) {
      const a = (s / sides) * Math.PI * 2, n = S.clone().multiplyScalar(Math.cos(a)).addScaledVector(U, Math.sin(a));
      B.v(pts[k].clone().addScaledVector(n, r(t)), n, s / sides, L[k] / vScale, col(t), sw(t), 0);
    }
  }
  for (let k = 0; k < pts.length - 1; k++) for (let s = 0; s < sides; s++) {
    const a = base + k * (sides + 1) + s, b = a + sides + 1;
    B.tri(a, b, a + 1); B.tri(a + 1, b, b + 1);
  }
}
// folded strip along a rachis: 3 vertices across (left edge, rachis, right edge); w(t) half-width, fold(t) radians
// (positive lifts the edges into a V), fwd(t) how far the edges lean toward the tip; normals bent toward the sky
function strip(B, pts, w, fold, fwd, col, sw, fl) {
  const base = B.p.length / 3, n = pts.length;
  for (let k = 0; k < n; k++) {
    const t = k / (n - 1), T = pts[Math.min(k + 1, n - 1)].clone().sub(pts[Math.max(k - 1, 0)]).normalize();
    const S = new THREE.Vector3().crossVectors(T, UP); if (S.lengthSq() < 1e-4) S.set(1, 0, 0); S.normalize();
    const N = new THREE.Vector3().crossVectors(S, T).normalize(); if (N.y < 0) N.negate();
    const ww = w(t), f = fold(t), fw = fwd(t);
    const nrm = N.clone().add(V(0, 1.2, 0)).normalize(), c = col(t);
    const L = pts[k].clone().addScaledVector(S, -ww * Math.cos(f)).addScaledVector(N, ww * Math.sin(f)).addScaledVector(T, ww * fw);
    const R = pts[k].clone().addScaledVector(S, ww * Math.cos(f)).addScaledVector(N, ww * Math.sin(f)).addScaledVector(T, ww * fw);
    B.v(L, nrm, 0, t, c, sw(t), fl(t) * 1.2); B.v(pts[k], nrm, 0.5, t, c, sw(t), fl(t) * 0.6); B.v(R, nrm, 1, t, c, sw(t), fl(t) * 1.2);
  }
  for (let k = 0; k < n - 1; k++) for (let s = 0; s < 2; s++) { const a = base + k * 3 + s, b = a + 3; B.tri(a, b, a + 1); B.tri(a + 1, b, b + 1); }
}
// arching curve: start p0, horizontal direction az, initial elevation el, length len, droop (fraction of len), n points
function arch(p0, az, el, len, droop, n) {
  const d = V(Math.sin(az), 0, Math.cos(az)), pts = [];
  for (let k = 0; k < n; k++) { const t = k / (n - 1); pts.push(p0.clone().addScaledVector(d, Math.cos(el) * len * t).add(V(0, Math.sin(el) * len * t - droop * len * t * t, 0))); }
  // keep segment lengths roughly equal to len/(n-1) after the droop bends the curve
  return pts;
}

// ---- canvas textures ----
function ctex(w, h, draw, srgb = true, repeat = true) {
  const c = document.createElement('canvas'); c.width = w; c.height = h; const g = c.getContext('2d', { willReadFrequently: !repeat }); draw(g, w, h);
  let t;
  if (repeat) { t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; }
  else {
    // alpha cards: un-premultiplied copy whose transparent texels carry the mean leaf colour, so filtering and mipmaps
    // don't pull black fringes into the leaf edges. Row 0 of the canvas is v = 0 (no flip).
    const d = g.getImageData(0, 0, w, h).data, m = [0, 0, 0]; let n = 0; // getImageData is already un-premultiplied
    for (let i = 0; i < d.length; i += 4) if (d[i + 3] > 200) { m[0] += d[i]; m[1] += d[i + 1]; m[2] += d[i + 2]; n++; }
    for (let k = 0; k < 3; k++) m[k] = n ? m[k] / n : 0;
    const out = new Uint8Array(d.length);
    for (let i = 0; i < d.length; i += 4) { const a = d[i + 3] / 255; for (let k = 0; k < 3; k++) out[i + k] = a > 0.02 ? d[i + k] : m[k]; out[i + 3] = d[i + 3]; }
    t = new THREE.DataTexture(out, w, h, THREE.RGBAFormat); t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
    t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearMipmapLinearFilter; t.generateMipmaps = true; t.needsUpdate = true;
  }
  if (srgb) t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = renderer.capabilities.getMaxAnisotropy();
  return t;
}
const TEXS = {};
function textures() {
  if (TEXS.ready) return TEXS;
  const r = rng(31);
  // pinnate frond: leaflets from the rachis (u = 0.5) to both edges, angled toward the tip (v = 1)
  const frond = (n, lw, cols, tipBrown) => ctex(128, 512, (g, w, h) => {
    g.clearRect(0, 0, w, h); g.lineCap = 'round';
    for (let i = 0; i < n; i++) {
      const y = (i + 0.5) / n * h;
      for (const side of [-1, 1]) {
        const ex = w / 2 + side * (w / 2 - 2 - r() * 6), ey = Math.min(h - 2, y + h * (0.05 + r() * 0.03));
        const grd = g.createLinearGradient(w / 2, y, ex, ey); const c = cols[Math.floor(r() * cols.length)];
        grd.addColorStop(0, c); grd.addColorStop(0.8, c); grd.addColorStop(1, tipBrown && r() < 0.5 ? '#9c8a52' : c);
        g.strokeStyle = grd; g.lineWidth = lw * (0.8 + r() * 0.4);
        g.beginPath(); g.moveTo(w / 2, y); g.quadraticCurveTo(w / 2 + side * w * 0.22, y + h * 0.012, ex, ey); g.stroke();
      }
    }
    g.strokeStyle = '#b9b56a'; g.lineWidth = 3; g.beginPath(); g.moveTo(w / 2, 0); g.lineTo(w / 2, h); g.stroke();
  }, true, false);
  TEXS.areca = frond(46, 5.5, ['#4f7a2a', '#5a8630', '#46702a', '#628c36'], true);
  TEXS.coco = frond(78, 3.2, ['#5b7f2c', '#6a8a33', '#4f7328', '#76933c'], true);
  // banana leaf: one broad blade with a pale midrib, fine parallel veins and wind tears along them
  TEXS.banana = ctex(256, 512, (g, w, h) => {
    g.clearRect(0, 0, w, h);
    g.fillStyle = '#5f9a34'; g.beginPath(); g.moveTo(w / 2, 0);
    for (let y = 0; y <= h; y += 8) { const t = y / h, hw = (w / 2 - 3) * Math.pow(Math.sin(Math.PI * Math.min(1, 0.06 + t * 0.98)), 0.45); g.lineTo(w / 2 + hw, y); }
    for (let y = h; y >= 0; y -= 8) { const t = y / h, hw = (w / 2 - 3) * Math.pow(Math.sin(Math.PI * Math.min(1, 0.06 + t * 0.98)), 0.45); g.lineTo(w / 2 - hw, y); }
    g.fill();
    for (let i = 0; i < 900; i++) { g.fillStyle = r() < 0.5 ? 'rgba(40,80,20,0.10)' : 'rgba(150,190,90,0.10)'; g.fillRect(r() * w, r() * h, 2 + r() * 30, 1.5); }
    g.globalCompositeOperation = 'source-atop';
    for (let y = 4; y < h; y += 5) { g.strokeStyle = 'rgba(30,60,15,0.18)'; g.lineWidth = 1; g.beginPath(); g.moveTo(w / 2, y); g.lineTo(0, y + 26); g.moveTo(w / 2, y); g.lineTo(w, y + 26); g.stroke(); }
    g.fillStyle = 'rgba(170,140,70,0.55)'; for (let i = 0; i < 18; i++) { const y = r() * h; g.fillRect(0, y, r() < 0.5 ? w * 0.08 : w, 3); } // dry edges
    g.globalCompositeOperation = 'destination-out';
    for (let i = 0; i < 26; i++) { const side = r() < 0.5 ? -1 : 1, y = 30 + r() * (h - 60), d = (0.25 + r() * 0.7) * w / 2; g.lineWidth = 1.5 + r() * 2; g.beginPath(); g.moveTo(w / 2 + side * (w / 2), y + 26 * (1 - 0)); g.lineTo(w / 2 + side * (w / 2 - d), y + 26 * (1 - d / (w / 2))); g.stroke(); }
    g.globalCompositeOperation = 'source-over';
    g.fillStyle = '#c7d488'; g.fillRect(w / 2 - 3, 0, 6, h);
  }, true, false);
  // bamboo leaf spray: many narrow lanceolate leaves hanging from a twig
  TEXS.bambooLeaf = ctex(256, 256, (g, w, h) => {
    g.clearRect(0, 0, w, h);
    const leaf = (x, y, a, L, wd, c) => { g.save(); g.translate(x, y); g.rotate(a); g.fillStyle = c; g.beginPath(); g.moveTo(0, 0); g.quadraticCurveTo(wd, L * 0.35, 0, L); g.quadraticCurveTo(-wd, L * 0.35, 0, 0); g.fill(); g.restore(); };
    for (let i = 0; i < 70; i++) { const x = 20 + r() * (w - 40), y = 10 + r() * (h * 0.55), a = (r() - 0.5) * 1.6; leaf(x, y, a, 50 + r() * 60, 5 + r() * 4, ['#6b8f3a', '#5d8233', '#7d9c45', '#88a24c', '#53752d'][Math.floor(r() * 5)]); }
    g.strokeStyle = '#7b7a3e'; g.lineWidth = 2; for (let i = 0; i < 6; i++) { g.beginPath(); g.moveTo(w / 2, 0); g.lineTo(r() * w, h * 0.5 * r()); g.stroke(); }
  }, true, false);
  // trunks: areca (pale grey, tight ring scars), coconut (grey-brown, rough rings), banana (green with brown sheaths), bamboo culm
  const rings = (bg, ring, every, jitter) => ctex(64, 256, (g, w, h) => {
    g.fillStyle = bg; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 1400; i++) { g.fillStyle = r() < 0.5 ? 'rgba(0,0,0,0.07)' : 'rgba(255,255,255,0.06)'; g.fillRect(r() * w, r() * h, 1 + r() * 2, 2 + r() * 10); }
    for (let y = 0; y < h; y += every + r() * jitter) { g.fillStyle = ring; g.fillRect(0, y, w, 1.5 + r() * 2); }
  });
  TEXS.arecaTrunk = rings('#a39f92', 'rgba(70,66,58,0.55)', 9, 4);
  TEXS.cocoTrunk = rings('#8a7d6c', 'rgba(55,45,35,0.6)', 6, 5);
  TEXS.bananaTrunk = ctex(64, 256, (g, w, h) => {
    g.fillStyle = '#7d9346'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 40; i++) { g.fillStyle = ['rgba(110,80,45,0.5)', 'rgba(70,95,40,0.4)', 'rgba(150,140,80,0.35)'][i % 3]; g.fillRect(r() * w, 0, 2 + r() * 10, h); }
    for (let i = 0; i < 600; i++) { g.fillStyle = 'rgba(60,40,20,0.15)'; g.fillRect(r() * w, r() * h, 1, 3 + r() * 6); }
  });
  TEXS.bambooCulm = ctex(32, 256, (g, w, h) => {
    const grd = g.createLinearGradient(0, 0, w, 0); grd.addColorStop(0, '#6d8a3a'); grd.addColorStop(0.5, '#93a957'); grd.addColorStop(1, '#6d8a3a');
    g.fillStyle = grd; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 300; i++) { g.fillStyle = 'rgba(90,80,40,0.12)'; g.fillRect(r() * w, r() * h, 1, 4 + r() * 12); }
    g.fillStyle = 'rgba(70,70,35,0.85)'; g.fillRect(0, 0, w, 4); g.fillStyle = 'rgba(200,200,150,0.5)'; g.fillRect(0, 4, w, 2);
  });
  TEXS.ready = true;
  return TEXS;
}

// ---- species ----
const C = (hex) => new THREE.Color(hex);
const lerpC = (a, b, t) => a.clone().lerp(b, t);
function areca(seed, detail) {
  const r = rng(seed), T = new Builder(), L = new Builder();
  const H = 9 + r() * 4, az = r() * 6.28, lean = (r() - 0.3) * 0.5, bow = (r() - 0.5) * 0.5, segs = detail ? 10 : 4;
  const d = V(Math.sin(az), 0, Math.cos(az)), sideD = V(Math.cos(az), 0, -Math.sin(az));
  const P = t => V(0, H * t, 0).addScaledVector(d, lean * t * t * 1.5).addScaledVector(sideD, bow * Math.sin(Math.PI * t));
  const tr = []; for (let k = 0; k <= segs; k++) tr.push(P(k / segs));
  const SW = 0.05 * H; // crown sway in metres at full wind
  tube(T, tr, t => 0.12 - 0.035 * t, detail ? 7 : 4, 0.9, () => C('#ffffff'), t => SW * t * t);
  const top = P(1), shaft = []; for (let k = 0; k <= 3; k++) shaft.push(top.clone().add(V(0, k * 0.4, 0)));
  tube(T, shaft, t => 0.13 - 0.03 * t * t, detail ? 7 : 4, 0.9, () => C('#8fb04e'), () => SW);
  const crown = top.clone().add(V(0, 1.2, 0)), nf = detail ? 8 + Math.floor(r() * 3) : 6;
  for (let f = 0; f < nf; f++) {
    const a = f * 2.4 + r() * 0.5, upper = f / nf, el = 0.45 + upper * 0.7 + r() * 0.15, len = 1.8 + r() * 0.6;
    const dead = detail && f === 0 && r() < 0.5;
    const pts = arch(crown.clone().add(V(0, -0.15 * (1 - upper), 0)), a, dead ? -1.2 : el, len, dead ? 0.1 : 0.5 + r() * 0.2, detail ? 7 : 4);
    const col = dead ? C('#b9a370') : lerpC(C('#ffffff'), C('#d7e6a0'), r() * 0.6);
    strip(L, pts, t => 0.42 * Math.pow(Math.sin(Math.PI * (0.1 + t * 0.85)), 0.6), t => 0.35 - 0.6 * t, () => 0.3, () => col, t => SW + 0.25 * t * t, t => 0.06 * t);
  }
  return { trunk: T.geo(), leaf: L.geo(), h: H + 2.4, swayH: H };
}
function coconut(seed, detail) {
  const r = rng(seed), T = new Builder(), L = new Builder();
  const H = 10 + r() * 6, az = r() * 6.28, lean = 1.2 + r() * 2.5, segs = detail ? 12 : 5;
  const d = V(Math.sin(az), 0, Math.cos(az));
  // a base that leans out, then curves back up toward the light
  const P = t => V(0, H * t, 0).addScaledVector(d, lean * Math.sin(t * Math.PI * 0.55));
  const tr = []; for (let k = 0; k <= segs; k++) tr.push(P(k / segs));
  const SW = 0.035 * H;
  tube(T, tr, t => 0.17 + 0.09 * Math.pow(1 - t, 6) - 0.03 * t, detail ? 8 : 5, 0.7, () => C('#ffffff'), t => SW * t * t);
  const crown = P(1).add(V(0, 0.3, 0));
  // coconuts and the fibrous frond bases under the crown
  if (detail) {
    const nut = new THREE.IcosahedronGeometry(0.14, 0), np = nut.attributes.position, nn = nut.attributes.normal;
    const nc = 5 + Math.floor(r() * 6);
    for (let k = 0; k < nc; k++) {
      const a = r() * 6.28, o = crown.clone().add(V(Math.sin(a) * 0.3, -0.35 - r() * 0.3, Math.cos(a) * 0.3)), col = r() < 0.7 ? C('#7f8a3a') : C('#8a6a3a');
      const b = T.p.length / 3; for (let i = 0; i < np.count; i++) T.v(V(np.getX(i), np.getY(i) * 1.1, np.getZ(i)).add(o), V(nn.getX(i), nn.getY(i), nn.getZ(i)), 0.5, 0.5, col, SW, 0);
      for (let i = 0; i < np.count; i += 3) T.tri(b + i, b + i + 1, b + i + 2);
    }
  }
  const nf = detail ? 18 + Math.floor(r() * 7) : 10;
  for (let f = 0; f < nf; f++) {
    const a = f * 2.4 + r() * 0.4, upper = f / nf, el = -0.5 + upper * 1.35 + r() * 0.2, len = 3.4 + r() * 1.0;
    const dead = detail && f < 2 && r() < 0.6;
    const pts = arch(crown, a, dead ? -1.3 : el, len, dead ? 0.05 : 0.35 + r() * 0.2, detail ? 8 : 4);
    const col = dead ? C('#a8925f') : lerpC(C('#ffffff'), C('#e2df9c'), r() * 0.7);
    strip(L, pts, t => 0.75 * Math.pow(Math.sin(Math.PI * (0.06 + t * 0.9)), 0.5), () => -0.55, () => 0.2, () => col, t => SW + 0.35 * t * t, t => 0.08 * t);
  }
  return { trunk: T.geo(), leaf: L.geo(), h: H + 2.5, swayH: H };
}
function banana(seed, detail) {
  const r = rng(seed), T = new Builder(), L = new Builder();
  const H = 2.2 + r() * 1.4, tr = []; for (let k = 0; k <= 3; k++) tr.push(V((r() - 0.5) * 0.05, H * k / 3, (r() - 0.5) * 0.05));
  const SW = 0.05 * H;
  tube(T, tr, t => 0.15 - 0.05 * t, detail ? 7 : 4, 1.2, () => C('#ffffff'), t => SW * t * t);
  // a couple of suckers (pups) at the base
  if (detail) for (let k = 0; k < 2; k++) { const a = r() * 6.28, o = V(Math.sin(a) * 0.45, 0, Math.cos(a) * 0.45), h2 = 0.6 + r() * 0.6; tube(T, [o, o.clone().add(V(0, h2, 0))], t => 0.07 - 0.03 * t, 5, 1.2, () => C('#ffffff'), () => 0); }
  const nl = detail ? 7 + Math.floor(r() * 3) : 5, top = tr[tr.length - 1];
  for (let f = 0; f < nl; f++) {
    const a = f * 2.4 + r() * 0.6, upper = f / nl, old = upper < 0.25;
    const el = old ? -0.2 - r() * 0.6 : 0.5 + upper * 0.7, len = 1.7 + r() * 0.8;
    const pts = arch(top.clone().add(V(0, -0.2 * (1 - upper), 0)), a, el, len, old ? 0.4 : 0.55 + r() * 0.25, detail ? 9 : 4);
    const col = old && r() < 0.6 ? C('#c2ac70') : lerpC(C('#ffffff'), C('#d8e8a0'), r() * 0.5);
    // short bare petiole, then the blade
    strip(L, pts, t => (t < 0.12 ? 0.03 : 0.36 * Math.pow(Math.sin(Math.PI * Math.min(1, (t - 0.12) / 0.88 * 0.95 + 0.04)), 0.45)), t => 0.25 - 0.3 * t, () => 0, () => col, t => SW + 0.12 * t * t, t => 0.07 * t);
  }
  return { trunk: T.geo(), leaf: L.geo(), h: H + 1.5, swayH: H };
}
function bamboo(seed, detail) {
  const r = rng(seed), T = new Builder(), L = new Builder();
  const nc = detail ? 18 + Math.floor(r() * 10) : 10, Hc = 9 + r() * 5;
  for (let c = 0; c < nc; c++) {
    const a = r() * 6.28, rr = Math.sqrt(r()) * 0.9, base = V(Math.sin(a) * rr, 0, Math.cos(a) * rr);
    const out = V(Math.sin(a + (r() - 0.5) * 0.8), 0, Math.cos(a + (r() - 0.5) * 0.8)), len = Hc * (0.7 + r() * 0.35), arc = 0.25 + r() * 0.35;
    const pts = [], n = detail ? 7 : 4;
    for (let k = 0; k <= n; k++) { const t = k / n; pts.push(base.clone().addScaledVector(out, arc * len * t * t).add(V(0, len * (t - arc * 0.35 * t * t * t), 0))); }
    const SW = 0.06 * len, tone = lerpC(C('#ffffff'), C('#c9c27a'), r() * 0.6);
    tube(T, pts, t => 0.05 - 0.025 * t, detail ? 5 : 3, 0.38, () => tone, t => SW * t * t);
    // leaf sprays on the upper part, hanging outward and down
    const ncards = detail ? 9 : 4;
    for (let k = 0; k < ncards; k++) {
      const t = 0.45 + 0.55 * (k + r() * 0.5) / ncards, i = Math.min(n - 1, Math.floor(t * n)), f = t * n - i, p = pts[i].clone().lerp(pts[i + 1], f);
      const ca = a + (r() - 0.5) * 2.4, cd = V(Math.sin(ca), 0, Math.cos(ca)), side = V(Math.cos(ca), 0, -Math.sin(ca)), w = 0.55 + r() * 0.3, hh = 1.0 + r() * 0.5;
      const q0 = p.clone().addScaledVector(side, -w), q1 = p.clone().addScaledVector(side, w);
      const q2 = q1.clone().addScaledVector(cd, hh * 0.6).add(V(0, -hh * 0.75, 0)), q3 = q0.clone().addScaledVector(cd, hh * 0.6).add(V(0, -hh * 0.75, 0));
      const nrm = cd.clone().add(V(0, 1.4, 0)).normalize(), col = lerpC(C('#ffffff'), C('#d6d58e'), r() * 0.5), sw = SW * t * t, b = L.p.length / 3;
      L.v(q0, nrm, 0, 0, col, sw, 0.03); L.v(q1, nrm, 1, 0, col, sw, 0.03); L.v(q2, nrm, 1, 1, col, sw + 0.1, 0.1); L.v(q3, nrm, 0, 1, col, sw + 0.1, 0.1);
      L.tri(b, b + 3, b + 1); L.tri(b + 1, b + 3, b + 2);
    }
  }
  return { trunk: T.geo(), leaf: L.geo(), h: Hc, swayH: Hc };
}

// ---- materials ----
const MATS = {};
function materials() {
  if (MATS.ready) return MATS;
  const t = textures();
  const trunk = map => patchVeg(new THREE.MeshStandardMaterial({ map, vertexColors: true, roughness: 0.92 }), { attr: true });
  const leaf = (map, rough = 0.8) => patchVeg(new THREE.MeshStandardMaterial({ map, vertexColors: true, alphaTest: 0.45, side: THREE.DoubleSide, roughness: rough }), { attr: true, flutter: 1, upNormals: true });
  const depth = map => vegDepth(map, { attr: true, flutter: 1 }, 0.45);
  MATS.areca = { trunk: trunk(t.arecaTrunk), leaf: leaf(t.areca), depth: depth(t.areca) };
  MATS.coconut = { trunk: trunk(t.cocoTrunk), leaf: leaf(t.coco), depth: depth(t.coco) };
  MATS.banana = { trunk: trunk(t.bananaTrunk), leaf: leaf(t.banana, 0.6), depth: depth(t.banana) };
  MATS.bamboo = { trunk: trunk(t.bambooCulm), leaf: leaf(t.bambooLeaf), depth: depth(t.bambooLeaf) };
  MATS.ready = true;
  return MATS;
}
const BUILDERS = { areca, coconut, banana, bamboo };
const NVAR = { areca: 4, coconut: 3, banana: 3, bamboo: 2 };

export { BUILDERS, NVAR, materials, textures };
