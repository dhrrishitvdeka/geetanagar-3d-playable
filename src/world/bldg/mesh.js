// Merged-geometry builder for buildings: flat-shaded quads and oriented boxes with vertex colours,
// UVs and an "aH" attribute (height above the ground, used by the facade shader's grime band).
// Map coordinates (x east, y north, z up) in, three.js world (x, z, -y) out.
import * as THREE from 'three';
import { scene } from '../../core/context.js';

export class MeshBuilder {
  constructor() { this.pos = []; this.nor = []; this.uv = []; this.col = []; this.h = []; this.idx = []; }
  get verts() { return this.pos.length / 3; }
  // A, B, C, D: map-space [x, y, z] corners in order around the quad; n: outward map-space normal [x, y, z]
  // uvs: [[u,v] x4]; col: THREE.Color; hs: height above ground per corner
  quad(A, B, C, D, n, col, uvs, hs) {
    const k = this.verts, w = [n[0], n[2], -n[1]];
    // make the winding match the requested normal
    const e1 = [B[0] - A[0], B[2] - A[2], -(B[1] - A[1])], e2 = [C[0] - A[0], C[2] - A[2], -(C[1] - A[1])];
    const cx = e1[1] * e2[2] - e1[2] * e2[1], cy = e1[2] * e2[0] - e1[0] * e2[2], cz = e1[0] * e2[1] - e1[1] * e2[0];
    const flip = cx * w[0] + cy * w[1] + cz * w[2] < 0;
    const P = [A, B, C, D];
    for (let i = 0; i < 4; i++) {
      const p = P[i]; this.pos.push(p[0], p[2], -p[1]); this.nor.push(w[0], w[1], w[2]);
      this.uv.push(uvs ? uvs[i][0] : 0, uvs ? uvs[i][1] : 0); this.col.push(col.r, col.g, col.b); this.h.push(hs ? hs[i] : 10);
    }
    if (flip) this.idx.push(k, k + 2, k + 1, k, k + 3, k + 2); else this.idx.push(k, k + 1, k + 2, k, k + 2, k + 3);
  }
  // a box aligned with a wall edge: origin o (map xy), unit along u, unit outward v; spans along [a0,a1],
  // outward [d0,d1], height [z0,z1]. faces: string of f(ront) b(ack) t(op) u(nder) l(eft) r(ight).
  // shade: per-face multipliers; gz: ground height for the grime attribute
  box(o, u, v, a0, a1, d0, d1, z0, z1, col, faces = 'fbtulr', gz = -1e3, uvs = 0.5) {
    const pt = (a, d, z) => [o[0] + u[0] * a + v[0] * d, o[1] + u[1] * a + v[1] * d, z];
    const hs = (za, zb) => [za - gz, za - gz, zb - gz, zb - gz];
    const c = col, cu = tmp.copy(col).multiplyScalar(0.62).clone();
    const la = (a1 - a0) * uvs, ld = (d1 - d0) * uvs, lz = (z1 - z0) * uvs;
    const R = (w, h) => [[0, 0], [w, 0], [w, h], [0, h]];
    if (faces.includes('f')) this.quad(pt(a0, d1, z0), pt(a1, d1, z0), pt(a1, d1, z1), pt(a0, d1, z1), [v[0], v[1], 0], c, R(la, lz), hs(z0, z1));
    if (faces.includes('b')) this.quad(pt(a1, d0, z0), pt(a0, d0, z0), pt(a0, d0, z1), pt(a1, d0, z1), [-v[0], -v[1], 0], c, R(la, lz), hs(z0, z1));
    if (faces.includes('t')) this.quad(pt(a0, d0, z1), pt(a1, d0, z1), pt(a1, d1, z1), pt(a0, d1, z1), [0, 0, 1], c, R(la, ld), hs(z1, z1));
    if (faces.includes('u')) this.quad(pt(a0, d1, z0), pt(a1, d1, z0), pt(a1, d0, z0), pt(a0, d0, z0), [0, 0, -1], cu, R(la, ld), hs(z0, z0));
    if (faces.includes('l')) this.quad(pt(a0, d0, z0), pt(a0, d1, z0), pt(a0, d1, z1), pt(a0, d0, z1), [-u[0], -u[1], 0], c, R(ld, lz), hs(z0, z1));
    if (faces.includes('r')) this.quad(pt(a1, d1, z0), pt(a1, d0, z0), pt(a1, d0, z1), pt(a1, d1, z1), [u[0], u[1], 0], c, R(ld, lz), hs(z0, z1));
  }
  // axis-aligned box centred on (x, y), rotated by ang (radians, map space)
  boxAt(x, y, ang, w, d, z0, z1, col, faces = 'fbtlr', gz = -1e3) {
    const u = [Math.cos(ang), Math.sin(ang)], v = [-Math.sin(ang), Math.cos(ang)];
    this.box([x, y], u, v, -w / 2, w / 2, -d / 2, d / 2, z0, z1, col, faces, gz);
  }
  mesh(mat, { cast = true, receive = true, add = true, noMerge = false } = {}) {
    if (!this.idx.length) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setAttribute('aH', new THREE.Float32BufferAttribute(this.h, 1));
    g.setIndex(this.verts > 65535 ? new THREE.Uint32BufferAttribute(this.idx, 1) : new THREE.Uint16BufferAttribute(this.idx, 1));
    g.computeBoundingSphere();
    const m = new THREE.Mesh(g, mat); if (noMerge) m.userData.noMerge = true; m.castShadow = cast; m.receiveShadow = receive; if (add) scene.add(m);
    return m;
  }
}
const tmp = new THREE.Color();

// Douglas-Peucker on a closed ring: traced footprints have many tiny jogs; facades want straight walls
export function simplifyRing(pts, tol) {
  const n = pts.length; if (n <= 4) return pts.slice();
  let ia = 0, ib = 0, best = -1;
  for (let i = 0; i < n; i++) { const d = Math.hypot(pts[i][0] - pts[0][0], pts[i][1] - pts[0][1]); if (d > best) { best = d; ia = i; } }
  best = -1; for (let i = 0; i < n; i++) { const d = Math.hypot(pts[i][0] - pts[ia][0], pts[i][1] - pts[ia][1]); if (d > best) { best = d; ib = i; } }
  const [s, e] = ia < ib ? [ia, ib] : [ib, ia];
  const keep = new Uint8Array(n); keep[s] = keep[e] = 1;
  const dp = (i0, i1, idxs) => { // idxs: ordered indices strictly between i0 and i1 along the ring
    let md = -1, mi = -1; const a = pts[i0], b = pts[i1], dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy) || 1e-9;
    for (const k of idxs) { const p = pts[k], d = Math.abs((p[0] - a[0]) * dy - (p[1] - a[1]) * dx) / L; if (d > md) { md = d; mi = k; } }
    if (md > tol) { keep[mi] = 1; const j = idxs.indexOf(mi); dp(i0, mi, idxs.slice(0, j)); dp(mi, i1, idxs.slice(j + 1)); }
  };
  const A = [], B = []; for (let i = s + 1; i < e; i++) A.push(i); for (let i = e + 1; i < n + s; i++) B.push(i % n);
  dp(s, e, A); dp(e, s, B);
  const out = []; for (let i = 0; i < n; i++) if (keep[i]) out.push(pts[i]);
  return out.length >= 3 ? out : pts.slice();
}
