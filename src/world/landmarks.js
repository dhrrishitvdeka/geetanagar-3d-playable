import * as THREE from 'three';
import { scene } from '../core/context.js';
import { GEO, pointInPoly } from '../core/geo.js';
import { MAT } from './materials.js';

function shikhara(height, radius, faces = 12) {
  const prof = [[1, 0], [1, 0.12], [0.96, 0.28], [0.88, 0.46], [0.74, 0.64], [0.56, 0.8], [0.36, 0.92], [0.18, 0.98], [0.02, 1]].map(([r, h]) => new THREE.Vector2(r * radius, h * height));
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.LatheGeometry(prof, faces), new THREE.MeshStandardMaterial({ color: '#f6f3ec', roughness: 0.55, flatShading: true }));
  g.add(body);
  const amalaka = new THREE.Mesh(new THREE.TorusGeometry(radius * 0.28, radius * 0.1, 8, 16), MAT.temple); amalaka.rotation.x = Math.PI / 2; amalaka.position.y = height * 1.0; g.add(amalaka);
  const kalash = new THREE.Mesh(new THREE.SphereGeometry(radius * 0.14, 12, 8), MAT.gold); kalash.position.y = height * 1.06; g.add(kalash);
  const tip = new THREE.Mesh(new THREE.ConeGeometry(radius * 0.06, height * 0.18, 8), MAT.gold); tip.position.y = height * 1.18; g.add(tip);
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 1.6), MAT.grey); pole.position.set(radius * 0.15, height * 1.3, 0); g.add(pole);
  const flag = new THREE.Mesh(new THREE.ConeGeometry(0.35, 0.9, 3), MAT.saffron); flag.rotation.z = -Math.PI / 2; flag.scale.set(1, 1, 0.05); flag.position.set(radius * 0.15 + 0.45, height * 1.3 + 0.55, 0); g.add(flag);
  g.traverse(o => { o.castShadow = true; o.receiveShadow = true; });
  return g;
}
// a namghar is a long prayer hall under a hipped tin roof: just a small gold-capped finial on the ridge, no shikhara
function finial() {
  const g = new THREE.Group();
  const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.07, 0.9, 8), MAT.grey); stem.position.y = 0.45; g.add(stem);
  const pot = new THREE.Mesh(new THREE.SphereGeometry(0.2, 12, 8), MAT.gold); pot.scale.y = 1.2; pot.position.y = 1.02; g.add(pot);
  const tip = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.4, 8), MAT.gold); tip.position.y = 1.46; g.add(tip);
  g.traverse(o => { o.castShadow = true; o.receiveShadow = true; });
  return g;
}
// ---------- landmark styles: temples, namghar, schools, the bank ----------
const LANDMARK_STYLE = new Map();
for (const L of GEO.labels) {
  if (L.k !== 'lm') continue;
  let kind = null;
  if (/Mandir|mondir/i.test(L.t)) kind = 'temple'; else if (/Namghar/i.test(L.t)) kind = 'namghar';
  else if (/School|Vidyalaya|Mahavidyalaya/i.test(L.t)) kind = 'school'; else if (/SBI|Bank/i.test(L.t)) kind = 'bank';
  if (!kind) continue;
  let best = null, bd = 25;
  for (const b of GEO.buildings) { if (pointInPoly(L.x, L.y, b.p)) { best = b; bd = 0; break; } const d = Math.hypot(b.c[0] - L.x, b.c[1] - L.y); if (d < bd) { bd = d; best = b; } }
  if (best) LANDMARK_STYLE.set(best, { kind, name: L.t });
}
const TEMPLE_TOPS = [];
function decorateLandmark(b, st, top) {
  if (st.kind === 'temple') { const s = shikhara(Math.min(7, 2.5 + Math.sqrt(b.a) * 0.3), Math.min(2.6, Math.sqrt(b.a) * 0.13)); s.position.set(b.c[0], top, -b.c[1]); scene.add(s); }
  if (st.kind === 'namghar') { // top = eave height; the hipped roof (buildings.js) peaks Math.min(5, sqrt(a) * 0.35) above it, over the centroid
    const s = finial(); s.position.set(b.c[0], top + Math.min(5, Math.sqrt(b.a) * 0.35) - 0.1, -b.c[1]); scene.add(s);
  }
}

export { shikhara, decorateLandmark, LANDMARK_STYLE, TEMPLE_TOPS };
