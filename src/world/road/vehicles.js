import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { scene } from '../../core/context.js';
import { hAt } from '../../core/geo.js';

// ---------- vehicles: each kind is modelled once, baked to one geometry per material, then instanced ----------
// Local frame: +x = forward, +y = up, z = across. Placed with rotation.y = heading (map angle).
const mat = (color, o = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.6, ...o });
const VM = {
  paint: mat('#ffffff', { metalness: 0.45, roughness: 0.32 }), glass: mat('#1b2328', { metalness: 0.4, roughness: 0.06 }), tyre: mat('#151515', { roughness: 0.92 }),
  rim: mat('#a3a8ab', { metalness: 0.8, roughness: 0.35 }), trim: mat('#232425', { roughness: 0.7 }), lamp: mat('#f4efdd', { emissive: '#3a3528', roughness: 0.2 }),
  tail: mat('#9c1219', { roughness: 0.3 }), seat: mat('#2a2522', { roughness: 0.9 }), canopyY: mat('#e0b62a', { roughness: 0.7 }), hood: mat('#1e1f1f', { roughness: 0.95, side: THREE.DoubleSide }),
  frame: mat('#2f5a3a', { metalness: 0.4, roughness: 0.5 }), red: mat('#a32a28', { roughness: 0.8 }), steel: mat('#8e9499', { metalness: 0.7, roughness: 0.4 }), plate: mat('#e9e6da', { roughness: 0.6 }),
};
VM.paint.userData.tint = true;
function add(g, geo, m, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) { const o = new THREE.Mesh(geo, m); o.position.set(x, y, z); o.rotation.set(rx, ry, rz); g.add(o); return o; }
const B = (w, h, d) => new THREE.BoxGeometry(w, h, d);
function prof(pts, depth, bevel = 0.04) { // extrude a side profile across the vehicle width, centred on z = 0
  const s = new THREE.Shape(pts.map(([x, y]) => new THREE.Vector2(x, y)));
  const g = new THREE.ExtrudeGeometry(s, { depth: depth - 2 * bevel, bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 2, curveSegments: 4 });
  g.translate(0, 0, -(depth - 2 * bevel) / 2); return g;
}
function wheel(g, x, z, r, w = 0.2) {
  add(g, new THREE.CylinderGeometry(r, r, w, 18), VM.tyre, x, r, z, Math.PI / 2);
  add(g, new THREE.CylinderGeometry(r * 0.58, r * 0.58, w + 0.02, 12), VM.rim, x, r, z, Math.PI / 2);
}
function ring(g, x, r, tube = 0.06) { add(g, new THREE.TorusGeometry(r, tube, 8, 22), VM.tyre, x, r + tube, 0); add(g, new THREE.CylinderGeometry(r * 0.25, r * 0.25, 0.1, 10), VM.steel, x, r + tube, 0, Math.PI / 2); }

function carModel(kind) {
  const g = new THREE.Group();
  const D = { hatch: { L: 3.75, W: 1.66, H: 1.5, belt: 0.98, r0: -1.6, r1: -1.38, f0: 0.25, f1: 0.95, boot: 0 }, sedan: { L: 4.35, W: 1.72, H: 1.46, belt: 0.95, r0: -1.35, r1: -1.0, f0: 0.3, f1: 1.0, boot: 1 }, suv: { L: 4.45, W: 1.82, H: 1.78, belt: 1.1, r0: -2.1, r1: -2.0, f0: 0.55, f1: 1.15, boot: 0 } }[kind];
  const { L, W, H, belt } = D, hl = L / 2;
  const lower = D.boot ? [[-hl, 0.32], [-hl, 0.88], [D.r0 - 0.1, belt], [D.f1, belt], [hl, 0.82], [hl, 0.32]] : [[-hl, 0.32], [-hl, belt], [D.f1, belt], [hl, belt - 0.18], [hl, 0.32]];
  add(g, prof(lower, W, 0.07), VM.paint);
  add(g, prof([[D.r0, belt], [D.r1, H - 0.06], [D.f0, H - 0.06], [D.f1, belt]], W - 0.16, 0.04), VM.glass); // greenhouse
  add(g, prof([[D.r1 - 0.02, H - 0.08], [D.r1 + 0.05, H], [D.f0 - 0.05, H], [D.f0 + 0.03, H - 0.08]], W - 0.12, 0.03), VM.paint); // roof
  add(g, B(0.12, H - belt - 0.02, W - 0.14), VM.paint, (D.r1 + D.f0) / 2 - 0.1, (H + belt) / 2, 0); // B pillar
  for (const sx of [-1, 1]) add(g, B(0.18, 0.2, W + 0.02), VM.trim, sx * (hl + 0.02), 0.42, 0); // bumpers
  for (const z of [-1, 1]) { add(g, B(0.06, 0.12, 0.34), VM.lamp, hl + 0.01, belt - 0.26, z * (W / 2 - 0.26)); add(g, B(0.06, 0.16, 0.3), VM.tail, -hl - 0.01, (D.boot ? 0.78 : belt - 0.2), z * (W / 2 - 0.22)); }
  add(g, B(0.03, 0.12, 0.5), VM.plate, hl + 0.06, 0.45, 0); add(g, B(0.03, 0.12, 0.5), VM.plate, -hl - 0.06, 0.5, 0);
  add(g, B(0.08, 0.08, 0.16), VM.paint, D.f1 - 0.15, belt + 0.06, W / 2 + 0.06); add(g, B(0.08, 0.08, 0.16), VM.paint, D.f1 - 0.15, belt + 0.06, -W / 2 - 0.06); // mirrors
  const r = kind === 'suv' ? 0.36 : 0.3, wx = hl - 0.75;
  for (const x of [wx, -wx + 0.05]) for (const z of [-1, 1]) wheel(g, x, z * (W / 2 - 0.12), r, 0.21);
  return g;
}
function totoModel() { // battery e-rickshaw ("toto"): open sides, rounded roof, single front wheel
  const g = new THREE.Group();
  add(g, prof([[-1.35, 0.3], [-1.35, 0.78], [0.55, 0.78], [0.95, 1.2], [1.25, 1.2], [1.38, 0.9], [1.3, 0.35], [0.6, 0.3]], 1.0, 0.05), VM.paint);
  add(g, prof([[-1.42, 1.86], [-1.38, 1.97], [1.15, 1.97], [1.4, 1.84], [1.38, 1.8], [-1.4, 1.8]], 1.12, 0.03), VM.paint); // roof
  for (const x of [-1.32, 0.98]) for (const z of [-0.5, 0.5]) add(g, new THREE.CylinderGeometry(0.025, 0.025, 1.05), VM.trim, x, 1.3, z);
  add(g, B(0.05, 0.62, 0.92), VM.glass, 1.12, 1.5, 0, 0, 0, -0.2);
  add(g, B(0.06, 0.95, 1.02), VM.paint, -1.36, 1.3, 0); add(g, B(0.07, 0.35, 0.7), VM.glass, -1.37, 1.45, 0);
  add(g, B(0.55, 0.12, 0.95), VM.seat, -0.85, 0.9, 0); add(g, B(0.1, 0.45, 0.95), VM.seat, -1.15, 1.12, 0); add(g, B(0.45, 0.12, 0.9), VM.seat, 0.05, 0.9, 0);
  add(g, B(0.4, 0.1, 0.4), VM.seat, 0.62, 1.05, 0); add(g, B(0.04, 0.04, 0.6), VM.trim, 0.92, 1.3, 0);
  add(g, B(0.05, 0.12, 0.2), VM.lamp, 1.38, 1.05, 0); for (const z of [-0.42, 0.42]) add(g, B(0.04, 0.1, 0.12), VM.tail, -1.4, 0.65, z);
  wheel(g, 1.05, 0, 0.25, 0.14); for (const z of [-0.5, 0.5]) wheel(g, -0.9, z, 0.25, 0.15);
  return g;
}
function autoModel() { // three-wheeler auto-rickshaw: painted tub, yellow canopy, black side curtains rolled up
  const g = new THREE.Group();
  add(g, prof([[-1.3, 0.32], [-1.3, 0.95], [0.6, 0.95], [1.05, 1.05], [1.3, 0.85], [1.3, 0.38], [0.5, 0.32]], 1.3, 0.06), VM.paint);
  add(g, prof([[-1.32, 0.95], [-1.32, 1.45], [-1.05, 1.74], [0.85, 1.78], [1.12, 1.62], [1.05, 1.55], [0.8, 1.7], [-0.98, 1.66], [-1.22, 1.42], [-1.22, 0.95]], 1.36, 0.03), VM.canopyY);
  add(g, B(0.04, 0.6, 1.1), VM.glass, 1.05, 1.32, 0, 0, 0, -0.25);
  for (const z of [-0.66, 0.66]) add(g, new THREE.CylinderGeometry(0.06, 0.06, 1.6, 8), VM.hood, -0.2, 1.62, z, 0, 0, Math.PI / 2);
  add(g, B(0.5, 0.14, 1.15), VM.seat, -0.8, 1.0, 0); add(g, B(0.12, 0.5, 1.15), VM.seat, -1.12, 1.25, 0);
  add(g, B(0.05, 0.14, 0.22), VM.lamp, 1.32, 0.9, 0); add(g, B(0.04, 0.04, 0.7), VM.trim, 0.9, 1.25, 0);
  wheel(g, 1.0, 0, 0.23, 0.13); for (const z of [-0.58, 0.58]) wheel(g, -0.85, z, 0.23, 0.14);
  return g;
}
function scooterModel() {
  const g = new THREE.Group();
  add(g, prof([[-0.85, 0.36], [-0.9, 0.6], [-0.6, 0.8], [-0.08, 0.76], [-0.05, 0.42], [0.42, 0.4], [0.55, 0.95], [0.7, 1.02], [0.72, 0.9], [0.62, 0.4], [0.3, 0.3], [-0.6, 0.3]], 0.34, 0.04), VM.paint);
  add(g, B(0.66, 0.1, 0.3), VM.seat, -0.47, 0.86, 0); add(g, B(0.08, 0.4, 0.08), VM.trim, 0.66, 1.15, 0, 0, 0, -0.3);
  add(g, B(0.06, 0.06, 0.66), VM.trim, 0.72, 1.32, 0); add(g, B(0.08, 0.1, 0.16), VM.lamp, 0.78, 1.24, 0);
  for (const z of [-0.3, 0.3]) add(g, new THREE.SphereGeometry(0.04, 6, 4), VM.glass, 0.68, 1.45, z);
  add(g, B(0.05, 0.08, 0.14), VM.tail, -0.92, 0.66, 0);
  for (const x of [-0.62, 0.66]) ring(g, x, 0.17, 0.065);
  return g;
}
function motoModel() {
  const g = new THREE.Group();
  const tank = add(g, new THREE.SphereGeometry(0.17, 12, 8), VM.paint, 0.12, 0.88, 0); tank.scale.set(1.6, 0.7, 0.85);
  add(g, B(0.6, 0.09, 0.26), VM.seat, -0.38, 0.84, 0); add(g, B(0.5, 0.12, 0.2), VM.paint, -0.72, 0.8, 0, 0, 0, 0.2);
  add(g, B(0.42, 0.3, 0.24), VM.steel, 0.02, 0.5, 0); add(g, B(0.9, 0.05, 0.05), VM.trim, -0.1, 0.62, 0, 0, 0, -0.25);
  add(g, new THREE.CylinderGeometry(0.03, 0.03, 0.75), VM.steel, 0.58, 0.68, 0.08, 0, 0, -0.42); add(g, new THREE.CylinderGeometry(0.03, 0.03, 0.75), VM.steel, 0.58, 0.68, -0.08, 0, 0, -0.42);
  add(g, B(0.04, 0.04, 0.7), VM.trim, 0.66, 1.07, 0); add(g, new THREE.CylinderGeometry(0.08, 0.08, 0.08, 10), VM.lamp, 0.76, 0.98, 0, 0, 0, Math.PI / 2);
  add(g, new THREE.CylinderGeometry(0.035, 0.05, 0.6, 8), VM.steel, -0.35, 0.35, 0.16, 0, 0, Math.PI / 2 - 0.15);
  for (const x of [-0.66, 0.7]) ring(g, x, 0.25, 0.07);
  return g;
}
function busModel() { // mid-size bus (yellow school buses and city buses use this road)
  const g = new THREE.Group(), L = 9.0, W = 2.3, hl = L / 2;
  add(g, prof([[-hl, 0.45], [-hl, 2.85], [hl - 0.35, 2.88], [hl, 2.5], [hl, 0.45]], W, 0.1), VM.paint);
  add(g, B(L - 1.6, 0.85, W + 0.02), VM.glass, -0.45, 2.1, 0); add(g, B(0.05, 1.05, W - 0.2), VM.glass, hl + 0.01, 1.95, 0); add(g, B(0.05, 0.6, W - 0.4), VM.glass, -hl - 0.01, 2.2, 0);
  add(g, B(L + 0.02, 0.32, W + 0.02), VM.trim, 0, 0.6, 0); add(g, B(L - 1.2, 0.12, W + 0.03), VM.red, -0.3, 1.45, 0);
  add(g, B(0.8, 1.9, 0.05), VM.glass, hl - 1.3, 1.45, -W / 2 - 0.005); // door on the kerb side (left)
  for (const z of [-1, 1]) { add(g, B(0.06, 0.18, 0.3), VM.lamp, hl + 0.03, 0.95, z * 0.85); add(g, B(0.06, 0.25, 0.2), VM.tail, -hl - 0.03, 1.0, z * 0.95); }
  for (const x of [-hl + 2.1, hl - 2.0]) for (const z of [-1, 1]) wheel(g, x, z * (W / 2 - 0.2), 0.48, 0.3);
  return g;
}
function truckModel() { // small cargo truck (Tata Ace type)
  const g = new THREE.Group();
  add(g, prof([[0.6, 0.45], [0.6, 1.75], [1.15, 1.78], [1.45, 1.2], [1.5, 0.45]], 1.5, 0.06), VM.paint);
  add(g, B(0.05, 0.55, 1.3), VM.glass, 1.32, 1.45, 0, 0, 0, -0.5); for (const z of [-1, 1]) add(g, B(0.45, 0.42, 0.02), VM.glass, 0.95, 1.45, z * 0.755);
  add(g, B(2.3, 0.12, 1.55), VM.trim, -0.6, 0.62, 0);
  for (const z of [-1, 1]) add(g, B(2.3, 0.42, 0.05), VM.paint, -0.6, 0.88, z * 0.75); add(g, B(0.05, 0.42, 1.55), VM.paint, -1.73, 0.88, 0);
  add(g, B(0.05, 0.1, 0.22), VM.lamp, 1.52, 0.75, 0.5); add(g, B(0.05, 0.1, 0.22), VM.lamp, 1.52, 0.75, -0.5);
  for (const x of [-1.2, 1.0]) for (const z of [-1, 1]) wheel(g, x, z * 0.62, 0.3, 0.2);
  return g;
}
function cycleRickModel() { // cycle-rickshaw: front bicycle half, two rear wheels, red bench seat, black folding hood
  const g = new THREE.Group();
  ring(g, 0.95, 0.31, 0.03); for (const z of [-0.48, 0.48]) { const w = ring(g, -0.55, 0.31, 0.03); g.children[g.children.length - 2].position.z = z; g.children[g.children.length - 1].position.z = z; }
  add(g, B(1.4, 0.05, 0.05), VM.frame, 0.25, 0.55, 0, 0, 0, 0.1); add(g, new THREE.CylinderGeometry(0.025, 0.025, 0.8), VM.frame, 0.85, 0.75, 0, 0, 0, -0.3);
  add(g, B(0.25, 0.06, 0.16), VM.seat, 0.45, 0.98, 0); add(g, new THREE.CylinderGeometry(0.025, 0.025, 0.45), VM.frame, 0.45, 0.75, 0);
  add(g, B(0.06, 0.04, 0.55), VM.trim, 0.9, 1.15, 0);
  add(g, B(0.05, 0.05, 1.0), VM.frame, -0.55, 0.34, 0); add(g, B(0.7, 0.3, 1.0), VM.frame, -0.55, 0.62, 0);
  add(g, B(0.6, 0.12, 0.95), VM.red, -0.55, 0.85, 0); add(g, B(0.1, 0.45, 0.95), VM.red, -0.85, 1.12, 0);
  const hood = add(g, new THREE.CylinderGeometry(0.55, 0.55, 1.0, 12, 1, true, 0, Math.PI * 0.75), VM.hood, -0.7, 1.15, 0, Math.PI / 2, 0, Math.PI / 2 + 0.2);
  return g;
}
const KINDS = { hatch: () => carModel('hatch'), sedan: () => carModel('sedan'), suv: () => carModel('suv'), toto: totoModel, auto: autoModel, scooter: scooterModel, moto: motoModel, bus: busModel, truck: truckModel, cyclerick: cycleRickModel };

// bake: one merged geometry per material
const BAKED = {};
function baked(kind) {
  if (BAKED[kind]) return BAKED[kind];
  const g = KINDS[kind](); g.updateMatrixWorld(true); const by = new Map();
  g.traverse(o => { if (!o.isMesh) return; let geo = o.geometry.clone().applyMatrix4(o.matrixWorld); if (geo.index) geo = geo.toNonIndexed();
    for (const k of Object.keys(geo.attributes)) if (!['position', 'normal', 'uv'].includes(k)) geo.deleteAttribute(k); geo.clearGroups();
    if (!by.has(o.material)) by.set(o.material, []); by.get(o.material).push(geo); });
  return (BAKED[kind] = [...by].map(([m, gs]) => [m, mergeGeometries(gs, false)]));
}
const QUEUE = {}; let pending = false;
const PLACED = []; // every vehicle placed so far ({ kind, x, y, ang }); the game turns the parked ones into colliders
function addVehicle(kind, x, y, ang, color = '#ffffff', lift = 0.06) {
  PLACED.push({ kind, x, y, ang });
  (QUEUE[kind] = QUEUE[kind] || []).push([x, hAt(x, y) + lift, y, ang, new THREE.Color(color)]);
  if (!pending) { pending = true; queueMicrotask(flushVehicles); }
}
function flushVehicles() {
  pending = false; const dm = new THREE.Object3D();
  for (const kind in QUEUE) {
    const list = QUEUE[kind]; if (!list.length) continue;
    for (const [m, geo] of baked(kind)) {
      const im = new THREE.InstancedMesh(geo, m, list.length);
      list.forEach(([x, h, y, a, c], k) => { dm.position.set(x, h, -y); dm.rotation.set(0, a, 0); dm.updateMatrix(); im.setMatrixAt(k, dm.matrix); if (m.userData.tint) im.setColorAt(k, c); });
      im.castShadow = true; im.receiveShadow = true; im.computeBoundingSphere(); scene.add(im);
    }
    list.length = 0;
  }
}
const CAR_COLS = ['#f2f2ef', '#f2f2ef', '#c3c7ca', '#8d9196', '#2a2d31', '#9b1c1c', '#1f4e8c', '#d9d4c7', '#5b5f63', '#7a1f2b'];
const TOTO_COLS = ['#8fc3df', '#7cb8d6', '#3f8a4a', '#d9d9d2', '#e0b62a'];
const TWO_COLS = ['#1d1d1f', '#c0c4c8', '#9b1c1c', '#1f4e8c', '#f2f2ef', '#3a3d42', '#6d1f8a', '#c79a2b'];

export { addVehicle, flushVehicles, baked, PLACED, CAR_COLS, TOTO_COLS, TWO_COLS, KINDS };
