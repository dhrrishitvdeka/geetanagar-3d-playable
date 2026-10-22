import * as THREE from 'three';
import { scene } from '../core/context.js';

// ---------- sectored instancing: one instanced set split into slices around a centre ----------
// A single InstancedMesh spread all round the camera can never be frustum-culled. Splitting it into an inner disc
// plus pie slices (same geometry, material and instances) lets the renderer skip the slices behind the camera and
// outside the shadow box. Bounds are recomputed on every refill and padded for the wind sway done in the shader.
const _white = new THREE.Color(1, 1, 1);
class SectorSet {
  // n slices round the centre, inner: radius of the centre disc, pad: metres added to each slice's bounds
  constructor(geo, mat, cap, { n = 8, inner = 16, pad = 2.5, colors = false, name = '' } = {}) {
    this.n = n; this.inner2 = inner * inner; this.pad = pad; this.cx = 0; this.cy = 0;
    this.k = new Int32Array(n + 1);
    this.meshes = [];
    for (let i = 0; i <= n; i++) {
      const m = new THREE.InstancedMesh(geo, mat, cap); m.count = 0; m.visible = false; m.name = name ? `${name}#${i}` : '';
      if (colors) m.setColorAt(0, _white); // allocate instanceColor up front
      scene.add(m); this.meshes.push(m);
    }
  }
  // slice index for a map position (x east, y north) around the centre set by begin()
  slot(x, y) {
    const dx = x - this.cx, dy = y - this.cy;
    if (dx * dx + dy * dy < this.inner2) return 0;
    return 1 + Math.min(this.n - 1, Math.floor((Math.atan2(dy, dx) + Math.PI) / (2 * Math.PI) * this.n));
  }
  begin(cx, cy) { this.cx = cx; this.cy = cy; this.k.fill(0); }
  add(s, matrix, color) { const m = this.meshes[s], k = this.k[s]++; m.setMatrixAt(k, matrix); if (color) m.setColorAt(k, color); }
  end() {
    for (let i = 0; i <= this.n; i++) {
      const m = this.meshes[i], c = this.k[i];
      m.count = c; m.visible = c > 0;
      if (!c) continue;
      m.instanceMatrix.needsUpdate = true; if (m.instanceColor) m.instanceColor.needsUpdate = true;
      m.computeBoundingSphere(); m.boundingSphere.radius += this.pad;
    }
  }
  get count() { let c = 0; for (let i = 0; i <= this.n; i++) c += this.k[i]; return c; }
  set castShadow(v) { for (const m of this.meshes) m.castShadow = v; }
  set receiveShadow(v) { for (const m of this.meshes) m.receiveShadow = v; }
  set customDepthMaterial(v) { for (const m of this.meshes) m.customDepthMaterial = v; }
}

// static instances (nothing moves them after the build) bucketed into square map cells, one InstancedMesh per cell,
// so a long row of small things along a road is culled cell by cell; items: [x, y, matrix, color?]
function cellInstances(geo, mat, items, cell = 60, name = '') {
  const cells = new Map();
  for (const it of items) { const key = Math.floor(it[0] / cell) + ',' + Math.floor(it[1] / cell); let a = cells.get(key); if (!a) cells.set(key, a = []); a.push(it); }
  const out = [];
  for (const a of cells.values()) {
    const m = new THREE.InstancedMesh(geo, mat, a.length); m.name = name;
    a.forEach(([, , mx, c], i) => { m.setMatrixAt(i, mx); if (c) m.setColorAt(i, c); });
    m.computeBoundingSphere(); scene.add(m); out.push(m);
  }
  return out;
}

export { SectorSet, cellInstances };
