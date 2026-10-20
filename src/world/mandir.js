import * as THREE from 'three';
import { scene } from '../core/context.js';
import { MANDIR, hAt, hAtBase, rng } from '../core/geo.js';
import { addCollider, mergeAdd, strip } from './geom.js';
import { shikhara } from './landmarks.js';
import { M, MAT, box, canvasTex, place, std } from './materials.js';

function deity(x, y, z, color) { // a painted figure in a niche
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.24, 0.8, 10), std(color)); body.position.y = 0.4; g.add(body);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.13, 10, 8), std('#e9c9a4')); head.position.y = 0.92; g.add(head);
  const crown = new THREE.Mesh(new THREE.ConeGeometry(0.1, 0.2, 8), MAT.gold); crown.position.y = 1.1; g.add(crown);
  g.position.set(x, z, -y); scene.add(g);
}
function lion(x, y, z, face) {
  const g = new THREE.Group();
  const body = box(0.9, 0.5, 0.4, MAT.lion); body.position.y = 0.45; g.add(body);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.28, 10, 8), MAT.lion); head.position.set(0.5 * face, 0.8, 0); g.add(head);
  const mane = new THREE.Mesh(new THREE.TorusGeometry(0.26, 0.09, 6, 12), std('#c96d1f')); mane.position.set(0.47 * face, 0.8, 0); mane.rotation.y = Math.PI / 2; g.add(mane);
  for (const lx of [-0.35, 0.35]) for (const lz of [-0.13, 0.13]) { const leg = box(0.12, 0.3, 0.12, MAT.lion); leg.position.set(lx, 0.15, lz); g.add(leg); }
  g.position.set(x, z, -y); g.traverse(o => { o.castShadow = true; }); scene.add(g);
}
function gateGrille() {
  return canvasTex(256, 256, (g, w, h) => {
    g.clearRect(0, 0, w, h); g.strokeStyle = '#cfd3d6'; g.lineWidth = 5;
    for (let x = 8; x < w; x += 22) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, h); g.stroke(); }
    g.lineWidth = 7; for (const y of [10, h / 2, h - 10]) { g.beginPath(); g.moveTo(0, y); g.lineTo(w, y); g.stroke(); }
    g.lineWidth = 4; for (const [cx, cy] of [[w / 4, h / 4], [3 * w / 4, h / 4], [w / 4, 3 * h / 4], [3 * w / 4, 3 * h / 4]]) { g.beginPath(); g.arc(cx, cy, 26, 0, 7); g.stroke(); g.beginPath(); g.arc(cx, cy, 12, 0, 7); g.stroke(); }
  }, false);
}

// ---------- the mandir on the bank east of Geetanagar Field ----------
function buildMandir() {
  const { gx, stairFoot, stairTop, plat, x0, x1, back } = MANDIR;
  const base = hAtBase(gx, stairTop), top = base + plat;
  // wide stairs from the footpath up to the gate (~20 steps on Street View), with a central divider and handrail
  const steps = 20, run = (stairTop - stairFoot) / steps;
  for (let i = 0; i < steps; i++) {
    const h = plat * (i + 1) / steps, s = box(8.2, h, run + 0.02, MAT.stone);
    place(s, gx, stairFoot + run * (i + 0.5), hAtBase(gx, stairFoot) + h / 2);
  }
  for (let i = 0; i < steps; i++) { const h = plat * (i + 1) / steps; place(box(0.32, 0.22, run + 0.02, MAT.temple), gx, stairFoot + run * (i + 0.5), hAtBase(gx, stairFoot) + h + 0.11); }
  for (let i = 0; i <= steps; i += 4) { const h = plat * Math.min(steps, i + 0.5) / steps; place(new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.9, 6), M.steel), gx, stairFoot + run * Math.min(steps - 0.5, i + 0.5), hAtBase(gx, stairFoot) + h + 0.65); }
  { const rail = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, Math.hypot(stairTop - stairFoot, plat), 8), M.steel); rail.rotation.x = -(Math.PI / 2 - Math.atan2(plat, stairTop - stairFoot)); /* rises toward the gate (north) */ place(rail, gx, (stairFoot + stairTop) / 2, hAtBase(gx, stairFoot) + plat / 2 + 1.1); }
  // paved apron at the stair foot, between the footpath and the first step
  place(box(9.0, 0.6, 2.2, MAT.stone), gx, stairFoot - 0.6, hAtBase(gx, stairFoot) - 0.04); // top ~0.26 m, covers the start of the terrain ramp
  for (const sx of [-4.3, 4.3]) { const cheek = box(0.4, plat + 0.3, stairTop - stairFoot, MAT.temple); place(cheek, gx + sx, (stairFoot + stairTop) / 2, hAtBase(gx, stairFoot) + (plat + 0.3) / 2); }
  // earth bank faced with stone; the scalloped white wall runs west of the stairs, a lower plain wall continues east (Street View)
  const bankW = [[x0, gx - 4.5, true], [gx + 4.5, x1, false]];
  // Street View (pano PB8GuiPzx4PQ7Ock14zMVQ, Mar 2026): beside the stairs the bank is a scrubby slope of dry grass, not a wall face
  const slope = new THREE.MeshStandardMaterial({ map: M.lawn.map, color: '#f2e6b8', roughness: 1, side: THREE.DoubleSide }), y0 = stairFoot + 0.9, sr = rng(53), scrub = [];
  for (const [a, b] of bankW) {
    const z0a = hAtBase(a, y0) - 0.05, z0b = hAtBase(b, y0) - 0.05, g = new THREE.BufferGeometry();
    const v = [a, z0a, -y0, b, z0b, -y0, b, top, -stairTop, a, top, -stairTop, a, z0a, -y0, a, top, -stairTop, a, z0a, -stairTop, b, z0b, -y0, b, top, -stairTop, b, z0b, -stairTop];
    g.setAttribute('position', new THREE.Float32BufferAttribute(v, 3)); g.setIndex([0, 1, 2, 0, 2, 3, 4, 5, 6, 7, 9, 8]);
    g.setAttribute('uv', new THREE.Float32BufferAttribute(v.flatMap((_, k) => k % 3 === 0 ? [v[k] / 4, v[k + 2] / 4] : []), 2)); g.computeVertexNormals();
    const mesh = new THREE.Mesh(g, slope); mesh.receiveShadow = true; scene.add(mesh); addCollider([a, y0], [b, y0]);
    for (let k = 0; k < (b - a) * 1.2; k++) { const t = sr(), x = a + 0.5 + sr() * (b - a - 1), y = y0 + t * (stairTop - y0 - 0.4); scrub.push([x, y, hAtBase(x, y0) + (top - hAtBase(x, y0)) * t]); }
  }
  const sg = new THREE.IcosahedronGeometry(0.45, 2), sm = new THREE.InstancedMesh(sg, std('#5f7436', { roughness: 0.95 }), scrub.length), dm = new THREE.Object3D();
  scrub.forEach(([x, y, z], k) => { const s = 0.5 + sr() * 0.9; dm.position.set(x, z + 0.15 * s, -y); dm.scale.set(s, s * (0.5 + sr() * 0.4), s); dm.rotation.y = sr() * 6; dm.updateMatrix(); sm.setMatrixAt(k, dm.matrix); sm.setColorAt(k, new THREE.Color().setHSL(0.2 + sr() * 0.06, 0.35, 0.22 + sr() * 0.12)); });
  sm.castShadow = true; sm.receiveShadow = true; scene.add(sm);
  for (const [a, b, scallop] of bankW) {
    if (!scallop) { place(box(b - a, 1.1, 0.25, MAT.temple), (a + b) / 2, stairTop + 0.1, top + 0.55); addCollider([a, stairTop + 0.1], [b, stairTop + 0.1]); continue; }
    const n = Math.floor((b - a) / 2.4);
    for (let i = 0; i < n; i++) {
      const cx = a + (i + 0.5) * (b - a) / n, panel = box((b - a) / n - 0.08, 2.0, 0.25, MAT.temple); place(panel, cx, stairTop + 0.1, top + 1.0);
      const cap = new THREE.Mesh(new THREE.CylinderGeometry((b - a) / n / 2 - 0.04, (b - a) / n / 2 - 0.04, 0.25, 16, 1, false, 0, Math.PI), MAT.temple);
      cap.rotation.x = Math.PI / 2; place(cap, cx, stairTop + 0.1, top + 2.0); cap.rotation.x = Math.PI / 2; cap.rotation.z = 0;
      addCollider([cx - (b - a) / n / 2, stairTop + 0.1], [cx + (b - a) / n / 2, stairTop + 0.1]);
    }
  }
  // the gate: two pillars with deity niches, an arched lintel, and shikharas on top
  const gy = stairTop + 0.6, pw = 1.7, inner = 3.1, H = 4.8;
  for (const s of [-1, 1]) {
    const px = gx + s * (inner + pw / 2);
    place(box(pw, H, 1.7, MAT.temple), px, gy, top + H / 2);
    place(box(pw + 0.12, 0.35, 1.82, MAT.pink), px, gy, top + 0.18);
    place(box(0.95, 1.6, 0.25, MAT.niche), px, gy - 0.78, top + 1.7);
    place(box(1.15, 0.18, 0.35, MAT.saffron), px, gy - 0.8, top + 2.6);
    deity(px, gy - 0.75, top + 1.0, s < 0 ? '#5aa36a' : '#5b86c4');
    place(box(pw + 0.3, 0.3, 2.0, MAT.temple), px, gy, top + H + 0.15);
  }
  // lintel with pink and saffron bands, small arch
  place(box(2 * inner + 2 * pw + 0.3, 1.4, 1.9, MAT.temple), gx, gy, top + H + 0.6 + 0.1);
  place(box(2 * inner + 2 * pw + 0.32, 0.32, 1.92, MAT.pink), gx, gy, top + H + 0.3);
  place(box(2 * inner + 2 * pw + 0.34, 0.16, 1.94, MAT.saffron), gx, gy, top + H + 1.25);
  for (const s of [-1, 1]) for (let k = 0; k < 3; k++) place(box(0.55, 0.55, 0.06, k === 1 ? MAT.saffron : MAT.pink), gx + s * (1.0 + k * 1.3), gy - 0.97, top + H + 0.75);
  const arch = new THREE.Mesh(new THREE.TorusGeometry(inner - 0.1, 0.22, 8, 24, Math.PI), MAT.temple); place(arch, gx, gy - 0.6, top + H - inner + 0.6);
  // iron gate leaves
  const grille = new THREE.MeshStandardMaterial({ map: gateGrille(), transparent: true, alphaTest: 0.4, side: THREE.DoubleSide, metalness: 0.5, roughness: 0.4 });
  for (const s of [-1, 1]) { const leaf = new THREE.Mesh(new THREE.PlaneGeometry(inner * 0.98, 3.0), grille); leaf.position.set(gx + s * inner / 2, top + 1.5, -(gy - 0.2)); leaf.rotation.y = s * 0.12; scene.add(leaf); }
  // pavilion and the main shikhara over the centre, a smaller one over the left pillar
  const ptop = top + H + 1.4;
  place(box(3.4, 0.25, 2.0, MAT.temple), gx, gy, ptop + 0.12);
  for (const sx of [-1.4, 1.4]) for (const sz of [-0.75, 0.75]) place(new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 1.3, 8), MAT.temple), gx + sx, gy + sz, ptop + 0.9);
  place(box(3.6, 0.3, 2.2, MAT.pink), gx, gy, ptop + 1.7);
  const big = shikhara(3.6, 1.2); big.position.set(gx, ptop + 1.85, -gy); scene.add(big);
  // a smaller shikhara over EACH side pillar, and orange lions on the lintel either side of the central pavilion
  for (const s of [-1, 1]) { const small = shikhara(2.2, 0.75); small.position.set(gx + s * (inner + pw / 2), top + H + 1.4, -gy); scene.add(small); }
  lion(gx + 2.45, gy - 0.3, top + H + 1.4, 1); lion(gx - 2.45, gy - 0.3, top + H + 1.4, -1);
  // path up through the trees to the shrine
  const path = []; for (let y = gy + 1; y <= back - 6; y += 1.5) path.push([gx + Math.sin(y * 0.05) * 0.6, y]);
  mergeAdd([strip(path, -1.1, 1.1, 0.06, 0.06, 2)], M.paver);
  // shrine on the plateau at the top of the path (UNVERIFIED: not visible on Street View or Maps)
  const sx = gx, sy = back - 1, sh = hAt(sx, sy);
  place(box(8, 0.8, 8, MAT.stone), sx, sy, sh + 0.4);
  place(box(4.6, 3.6, 4.6, MAT.temple), sx, sy + 1, sh + 0.8 + 1.8);
  place(box(4.8, 0.3, 4.8, MAT.pink), sx, sy + 1, sh + 0.8 + 3.5);
  place(box(1.4, 2.2, 0.1, MAT.niche), sx, sy - 1.32, sh + 0.8 + 1.1);
  place(box(4.2, 0.25, 3.0, MAT.temple), sx, sy - 2.6, sh + 0.8 + 3.0);
  for (const px of [-1.8, 1.8]) for (const pz of [-3.8, -1.6]) place(new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.13, 3.0, 10), MAT.temple), sx + px, sy + pz + 0.6, sh + 0.8 + 1.5);
  const st = shikhara(6.2, 2.3); st.position.set(sx, sh + 0.8 + 3.65, -(sy + 1)); scene.add(st);
  for (const [a, b] of [[[sx - 2.3, sy + 3.3], [sx + 2.3, sy + 3.3]], [[sx - 2.3, sy - 1.3], [sx - 2.3, sy + 3.3]], [[sx + 2.3, sy - 1.3], [sx + 2.3, sy + 3.3]]]) addCollider(a, b);
}

export { deity, lion, gateGrille, buildMandir };
