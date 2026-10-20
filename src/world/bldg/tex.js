// Canvas helpers for the procedural building textures: a colour layer, a height layer (turned into a
// normal map) and a mask layer (R = paintable plaster, G = roughness) drawn in lockstep.
import * as THREE from 'three';
import { renderer } from '../../core/context.js';
import { rng } from '../../core/geo.js';
import { QUALITY } from '../../render/quality.js';
import { cacheEnabled } from '../../render/texcache.js';

export function canvas(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }

// tileable value noise on a period x period lattice
export function tileNoise(seed, period) {
  const r = rng(seed), v = new Float32Array(period * period);
  for (let i = 0; i < v.length; i++) v[i] = r();
  return (x, y) => { // x, y in lattice units
    const xi = Math.floor(x), yi = Math.floor(y), fx = x - xi, fy = y - yi;
    const u = fx * fx * (3 - 2 * fx), w = fy * fy * (3 - 2 * fy);
    const i0 = ((xi % period) + period) % period, j0 = ((yi % period) + period) % period, i1 = (i0 + 1) % period, j1 = (j0 + 1) % period;
    const a = v[j0 * period + i0], b = v[j0 * period + i1], c = v[j1 * period + i0], d = v[j1 * period + i1];
    return (a * (1 - u) + b * u) * (1 - w) + (c * (1 - u) + d * u) * w;
  };
}
export function fbm(seed, W, H, base = 4, oct = 4) { // returns (px, py) -> 0..1, tileable over W x H pixels
  const ns = []; for (let o = 0; o < oct; o++) ns.push(tileNoise(seed + o * 17, base << o));
  return (px, py) => { let s = 0, a = 0.5, n = 0; for (let o = 0; o < oct; o++) { const p = base << o; s += ns[o](px / W * p, py / H * p) * a; n += a; a *= 0.5; } return s / n; };
}

// A layered painter. Every primitive takes { c: colour, h: height 0..1, p: paint 0..1, r: roughness 0..1 }.
export class Layers {
  // w, h: canvas size in pixels; s: scale from layout units to pixels (drawing code keeps its own units)
  constructor(w, h, s = 1) {
    this.w = w; this.h = h;
    this.col = canvas(w, h); this.hgt = canvas(w, h); this.msk = canvas(w, h);
    this.gc = this.col.getContext('2d'); this.gh = this.hgt.getContext('2d'); this.gm = this.msk.getContext('2d');
    for (const g of [this.gc, this.gh, this.gm]) g.setTransform(s, 0, 0, s, 0, 0);
    this.keep = cacheEnabled() ? {} : null; // final pixel arrays, held until the texture cache has taken them (see capture)
    this._hd = null;
  }
  _style(s) {
    const hv = Math.round((s.h ?? 0.5) * 255), pv = Math.round((s.p ?? 0) * 255), rv = Math.round((s.r ?? 0.9) * 255);
    return [s.c, `rgb(${hv},${hv},${hv})`, `rgb(${pv},${rv},0)`];
  }
  rect(x, y, w, h, s) {
    const [c, hh, m] = this._style(s);
    if (c) { this.gc.fillStyle = c; this.gc.fillRect(x, y, w, h); }
    if (s.h != null) { this.gh.fillStyle = hh; this.gh.fillRect(x, y, w, h); }
    if (s.p != null || s.r != null) { this.gm.fillStyle = m; this.gm.fillRect(x, y, w, h); }
  }
  // colour-only overlay (stains, gradients) that leaves height and mask alone
  overlay(fn) { this.gc.save(); fn(this.gc); this.gc.restore(); }
  height(fn) { this.gh.save(); fn(this.gh); this.gh.restore(); }
  // per-pixel pass over plaster: grain + blotches, scaled by the paint mask
  plasterPass(seed, amount = 1) {
    const { w, h } = this, cd = this.gc.getImageData(0, 0, w, h), hd = this.gh.getImageData(0, 0, w, h), md = this.gm.getImageData(0, 0, w, h);
    const big = fbm(seed, w, h, 3, 4), fine = fbm(seed + 99, w, h, 64, 2), r = rng(seed + 5);
    let ha = 255;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4, p = md.data[i] / 255;
      const g = (r() - 0.5) * 0.06, b = (big(x, y) - 0.5) * 0.22 * amount, f = (fine(x, y) - 0.5) * 0.12;
      const k = 1 + (g + b + f) * p;
      cd.data[i] = Math.min(255, cd.data[i] * k); cd.data[i + 1] = Math.min(255, cd.data[i + 1] * k); cd.data[i + 2] = Math.min(255, cd.data[i + 2] * k);
      hd.data[i] = hd.data[i + 1] = hd.data[i + 2] = Math.max(0, Math.min(255, hd.data[i] + (f * 40 + g * 30) * p)); ha &= hd.data[i + 3];
    }
    this.gc.putImageData(cd, 0, 0); this.gh.putImageData(hd, 0, 0);
    // fully opaque height: reading the canvas back would return exactly hd.data, so normalFromHeight can use it and the
    // height canvas is read once instead of twice (the second getImageData is what triggers the Canvas2D readback warning)
    this._hd = ha === 255 ? hd.data : null;
    if (this.keep) { this.keep.col = cd.data; this.keep.msk = md.data; }
  }
  textures(normalStrength = 2.5) {
    const map = tex(this.col, true), mr = tex(this.msk, false);
    const nc = QUALITY === 'low' ? null : normalFromHeight(this.hgt, normalStrength, this._hd, this.keep); // Low: no normal maps
    this._hd = null;
    return { map, mr, normal: nc && tex(nc, false) };
  }
  // The final bytes of the three uploaded maps for the texture cache, or null when any is not fully opaque (alpha 255 makes
  // putImageData exact, so a restored canvas uploads the same texels). Takes the arrays the passes already hold; only a map
  // that was drawn rather than put (slab / tin mask) is read from its canvas, and that is its first read.
  capture() {
    const k = this.keep; this.keep = null;
    if (!k) return null;
    const rd = c => c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    const col = k.col || rd(this.col), msk = k.msk || rd(this.msk), nrm = QUALITY === 'low' ? null : k.nrm, n = this.w * this.h * 4;
    for (const d of [col, msk, nrm]) if (d !== null && (!d || d.length !== n || !opaque(d))) return null;
    return { w: this.w, h: this.h, col, msk, nrm };
  }
}
const opaque = d => { for (let i = 3; i < d.length; i += 4) if (d[i] !== 255) return false; return true; };
// a stored capture that still has the shape this preset expects (Low has no normal map)
export function planesOk(p) {
  const n = p && p.w * p.h * 4, good = d => d instanceof Uint8ClampedArray && d.length === n;
  return !!p && good(p.col) && good(p.msk) && (QUALITY === 'low' ? p.nrm === null : good(p.nrm));
}
// the same three textures as Layers.textures(), built from stored bytes instead of drawing
export function texturesFromPlanes(p) {
  const plane = d => { const c = canvas(p.w, p.h); c.getContext('2d').putImageData(new ImageData(d, p.w, p.h), 0, 0); return c; };
  const map = tex(plane(p.col), true), mr = tex(plane(p.msk), false);
  return { map, mr, normal: p.nrm && tex(plane(p.nrm), false) };
}

// px: the height canvas's pixels when the caller already holds them (opaque, so identical to a readback); keep: receives the output bytes
export function normalFromHeight(src, strength, px, keep) {
  const w = src.width, h = src.height, d = px || src.getContext('2d').getImageData(0, 0, w, h).data;
  const out = canvas(w, h), og = out.getContext('2d'), od = og.createImageData(w, h);
  const H = (x, y) => d[((((y + h) % h) * w) + ((x + w) % w)) * 4] / 255;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const dx = (H(x + 1, y) - H(x - 1, y)) * strength, dy = (H(x, y + 1) - H(x, y - 1)) * strength;
    // canvas y runs down, texture v runs up (flipY), so +y in the canvas is -v
    let nx = -dx, ny = dy, nz = 1; const l = Math.hypot(nx, ny, nz); nx /= l; ny /= l; nz /= l;
    const i = (y * w + x) * 4; od.data[i] = (nx * 0.5 + 0.5) * 255; od.data[i + 1] = (ny * 0.5 + 0.5) * 255; od.data[i + 2] = (nz * 0.5 + 0.5) * 255; od.data[i + 3] = 255;
  }
  og.putImageData(od, 0, 0); if (keep) keep.nrm = od.data; return out;
}

export function tex(c, srgb, repeat = true) {
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = Math.min(QUALITY === 'low' ? 4 : 8, renderer.capabilities.getMaxAnisotropy());
  return t;
}
