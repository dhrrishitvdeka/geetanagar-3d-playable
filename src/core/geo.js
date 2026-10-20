import * as THREE from 'three';

import geoUrl from '../../data/geo.json?url';
// lane network rebuilt by pipeline/roads.py (clean centrelines + measured widths); the original
// skeleton fragments stay available as GEO.rawRoads
import roadsUrl from '../../data/roads.json?url';
// curated landmarks checked against Google Maps pins (data/landmarks.json), added to the traced labels
import lmUrl from '../../data/landmarks.json?url';
// footprint patch from pipeline/footprints.py: split blobs and non-buildings. Existing indices never move: split parts are
// appended at the end, skipped entries keep their slot with an empty polygon (buildings.js ignores p.length < 3)
import fixUrl from '../../data/footprint_fixes.json?url';
// Real elevation from Copernicus GLO-30 (data/terrain.json, built by pipeline/terrain_dem.py): uint16 decimetres above
// Mother Teresa Rd on the same 5 m grid. Falls back to the old hillshade estimate in geo.json (uint8 quarter-metres).
import terrainUrl from '../../data/terrain.json?url';
// class raster (red channel = class id): its own PNG, decoded natively. createImageBitmap, not img.decode(): decode() never
// settles in a hidden/background tab; the options keep the class ids exact (no colour management, no alpha premultiply)
import clsUrl from '../../data/cls.png?url';

// every fetch starts now, so the awaits below only wait for the slowest one instead of adding up
const getJson = u => fetch(u).then(r => r.json());
const geoP = getJson(geoUrl), roadsP = getJson(roadsUrl), lmP = getJson(lmUrl), fixP = getJson(fixUrl);
const terrainP = fetch(terrainUrl).then(r => (r.ok ? r.json() : null)).catch(() => null);
const clsP = fetch(clsUrl).then(r => r.blob()).then(b => createImageBitmap(b, { colorSpaceConversion: 'none', premultiplyAlpha: 'none' }));

const GEO = await geoP;
GEO.rawRoads = GEO.roads;
{
  const R = await roadsP;
  GEO.roads = R.roads;
}
{
  const LM = await lmP;
  for (const it of LM.items) if (!GEO.labels.some(l => l.t === it.t)) GEO.labels.push({ t: it.t, x: it.x, y: it.y, k: it.k });
  for (const [t, c] of Object.entries(LM._corrections || {})) { const l = GEO.labels.find(l => l.t === t); if (l) { l.x = c.x; l.y = c.y; } }
}
{
  const F = await fixP, B = GEO.buildings;
  for (const [i, f] of Object.entries(F.replace)) if (B[i]) Object.assign(B[i], { p: f.p, a: f.a, c: f.c, k: f.k, d: f.d });
  for (const f of F.append) B.push({ p: f.p, a: f.a, c: f.c, k: f.k, d: f.d });
  for (const i of Object.keys(F.skip)) if (B[i]) B[i].p = [];
}
const P = (x, y, h = 0) => new THREE.Vector3(x, h, -y);
function rng(seed) { let a = seed | 0; return () => { a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
const hash2 = (x, y) => { const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453; return s - Math.floor(s); };

// ---------- terrain heights ----------
const TERRAIN = await terrainP;
const HG = TERRAIN ? TERRAIN.hgrid : GEO.hgrid;
const hbytes = Uint8Array.from(atob(HG.b64), c => c.charCodeAt(0));
const HV = HG.enc ? Float32Array.from(new Uint16Array(hbytes.buffer), v => v / 10) : Float32Array.from(hbytes, v => v / 4); // metres
const HGX1 = HG.x0 + (HG.nx - 1) * HG.step, HGY1 = HG.y0 + (HG.ny - 1) * HG.step;
const MANDIR = { gx: 49.5, stairFoot: -41.3, stairTop: -34.4, plat: 3.6, x0: 34, x1: 66, back: 14 };
function mandirBump(x, y) {
  const { gx, stairFoot, stairTop, plat, x0, x1, back } = MANDIR;
  if (y < stairFoot || y > back + 8 || x < x0 - 7 || x > x1 + 7) return 0;
  if (Math.abs(x - gx) <= 4.1 && y < stairTop) return plat * (y - stairFoot) / (stairTop - stairFoot);
  if (y < stairTop - 0.6) return 0;
  const dx = Math.max(x0 - x, 0, x - x1), dn = Math.max(y - back, 0);
  return plat * Math.max(0, 1 - Math.max(dx, dn) / 7) * (y < stairTop ? (y - (stairTop - 0.6)) / 0.6 : 1);
}
function hAt(x, y) { return Math.max(hAtBase(x, y), mandirBump(x, y)); }
const VP = GEO.viewpoint;
GEO.labels.push({ t: 'Mandir gate', x: 49.5, y: -33.5, k: 'lm' });
function hAtBase(x, y) { // bilinear, metres above the plain
  let fx = (x - HG.x0) / HG.step, fy = (y - HG.y0) / HG.step;
  fx = Math.max(0, Math.min(HG.nx - 1.001, fx)); fy = Math.max(0, Math.min(HG.ny - 1.001, fy));
  const i = Math.floor(fx), j = Math.floor(fy), u = fx - i, v = fy - j, n = HG.nx;
  const a = HV[j * n + i], b = HV[j * n + i + 1], c = HV[(j + 1) * n + i], d = HV[(j + 1) * n + i + 1];
  return (a * (1 - u) + b * u) * (1 - v) + (c * (1 - u) + d * u) * v;
}

// ---------- class map (0 yard, 1 road, 2 building, 3 shop/commercial, 4 park, 5 field) ----------
const [CX0, CX1, CY0, CY1] = GEO.bounds, CRES = GEO.res, CW = GEO.w, CH = GEO.h;
// class raster: read back once from the decoded bitmap
const CLS = await (async () => {
  const img = await clsP;
  const c = document.createElement('canvas'); c.width = CW; c.height = CH;
  const g = c.getContext('2d', { willReadFrequently: true }); g.drawImage(img, 0, 0);
  const d = g.getImageData(0, 0, CW, CH).data, out = new Uint8Array(CW * CH);
  for (let i = 0; i < out.length; i++) out[i] = d[i * 4];
  return out;
})();
function clsAt(x, y) {
  if (!CLS) return 0;
  const i = Math.floor((x - CX0) / CRES), j = Math.floor((CY1 - y) / CRES);
  if (i < 0 || j < 0 || i >= CW || j >= CH) return 9; // outside the traced area
  return CLS[j * CW + i];
}
function pointInPoly(x, y, poly) { let c = false; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const a = poly[i], b = poly[j]; if ((a[1] > y) !== (b[1] > y) && x < (b[0] - a[0]) * (y - a[1]) / (b[1] - a[1] + 1e-9) + a[0]) c = !c; } return c; }

export { rng, mandirBump, hAt, hAtBase, clsAt, pointInPoly, GEO, P, hash2, HG, hbytes, HV, TERRAIN, HGX1, HGY1, MANDIR, VP, CX0, CX1, CY0, CY1, CRES, CW, CH, CLS };
