import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { scene } from '../../core/context.js';
import { hAt } from '../../core/geo.js';
import { footRaise } from './footpath.js';

// ---------- vehicles: each kind is modelled once, baked to one geometry per material, then instanced ----------
// Local frame: +x = forward, +y = up, z = across (+z is the vehicle's right... left-hand traffic: the kerb side is -z).
// Placed with rotation.y = heading (map angle). What is on Guwahati's roads: Alto / Swift-type hatchbacks, Dzire-type sedans,
// SUVs, Activa-type scooters, Splendor-type motorbikes (with the saree guard every Indian bike carries), CNG autos, battery
// totos, city buses, the Tata Ace and cycle-rickshaws. Riders and drivers (rider: true materials) are only baked for the moving
// traffic (baked(kind, true)); parked vehicles stand empty.
const mat = (color, o = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.6, ...o });
const VM = {
  paint: mat('#ffffff', { metalness: 0.45, roughness: 0.32 }), glass: mat('#1b2328', { metalness: 0.4, roughness: 0.06 }), tyre: mat('#151515', { roughness: 0.92 }),
  rim: mat('#a3a8ab', { metalness: 0.8, roughness: 0.35 }), trim: mat('#232425', { roughness: 0.7 }), lamp: mat('#f4efdd', { emissive: '#3a3528', roughness: 0.2 }),
  tail: mat('#9c1219', { roughness: 0.3 }), seat: mat('#2a2522', { roughness: 0.9 }), canopyY: mat('#e0b62a', { roughness: 0.7 }), hood: mat('#1e1f1f', { roughness: 0.95, side: THREE.DoubleSide }),
  frame: mat('#2f5a3a', { metalness: 0.4, roughness: 0.5 }), red: mat('#a32a28', { roughness: 0.8 }), steel: mat('#8e9499', { metalness: 0.7, roughness: 0.4 }), plate: mat('#e9e6da', { roughness: 0.6 }),
  amber: mat('#e08a1e', { emissive: '#3a2008', roughness: 0.3 }), chrome: mat('#c9ced2', { metalness: 0.9, roughness: 0.2 }), plateY: mat('#e6c229', { roughness: 0.6 }), ink: mat('#141414', { roughness: 0.8 }),
  // riders and drivers
  skin: mat('#8d5a3b', { roughness: 0.8 }), shirt: mat('#ffffff', { roughness: 0.85 }), pants: mat('#2b2f3a', { roughness: 0.9 }), helmet: mat('#151617', { roughness: 0.35, metalness: 0.2 }), hair: mat('#17120e', { roughness: 0.9 }),
};
VM.paint.userData.tint = true; VM.shirt.userData.tint2 = true;
for (const k of ['skin', 'shirt', 'pants', 'helmet', 'hair']) VM[k].userData.rider = true;
function add(g, geo, m, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) { const o = new THREE.Mesh(geo, m); o.position.set(x, y, z); o.rotation.set(rx, ry, rz); g.add(o); return o; }
const B = (w, h, d) => new THREE.BoxGeometry(w, h, d);
function prof(pts, depth, bevel = 0.04) { // extrude a side profile across the vehicle width, centred on z = 0
  const s = new THREE.Shape(pts.map(([x, y]) => new THREE.Vector2(x, y)));
  const g = new THREE.ExtrudeGeometry(s, { depth: depth - 2 * bevel, bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 2, curveSegments: 4 });
  g.translate(0, 0, -(depth - 2 * bevel) / 2); return g;
}
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _up = new THREE.Vector3(0, 1, 0);
// a rod (cylinder, or a square bar with sq: true) from point a to point b
function rod(g, a, b, r, m, seg = 8, sq = false) {
  _a.set(...a); _b.set(...b); const len = _a.distanceTo(_b), o = new THREE.Mesh(sq ? B(r * 2, len, r * 2) : new THREE.CylinderGeometry(r, r, len, seg), m);
  o.position.copy(_a).add(_b).multiplyScalar(0.5); o.quaternion.setFromUnitVectors(_up, _b.sub(_a).normalize()); g.add(o); return o;
}
// a car wheel: tyre, a silver five-spoke rim on the outside face, a black arch over it on the body side
function wheel(g, x, z, r, w = 0.2, arch = true) {
  const s = Math.sign(z) || 1;
  add(g, new THREE.CylinderGeometry(r, r, w, 20), VM.tyre, x, r, z, Math.PI / 2);
  add(g, new THREE.CylinderGeometry(r * 0.62, r * 0.62, w + 0.012, 16), VM.trim, x, r, z, Math.PI / 2); // dark well behind the spokes
  add(g, new THREE.TorusGeometry(r * 0.6, r * 0.05, 5, 18), VM.rim, x, r, z + s * (w / 2 + 0.008)); // rim lip
  for (let k = 0; k < 5; k++) { const a = k / 5 * Math.PI * 2; add(g, B(r * 0.55, r * 0.11, 0.025), VM.rim, x + Math.cos(a) * r * 0.29, r + Math.sin(a) * r * 0.29, z + s * (w / 2 + 0.006), 0, 0, a); }
  add(g, new THREE.CylinderGeometry(r * 0.13, r * 0.13, w + 0.03, 10), VM.chrome, x, r, z, Math.PI / 2);
  if (arch) add(g, new THREE.TorusGeometry(r + 0.07, 0.045, 5, 14, Math.PI), VM.trim, x, r, z + s * 0.035);
}
// a two-wheeler wheel: tyre, rim, spokes (or a cast rim) and hub
function bikeWheel(g, x, r, tube = 0.055, spokes = 12) {
  add(g, new THREE.TorusGeometry(r, tube, 8, 26), VM.tyre, x, r + tube, 0);
  add(g, new THREE.TorusGeometry(r - tube * 0.9, 0.014, 4, 26), VM.rim, x, r + tube, 0);
  for (let k = 0; k < spokes; k++) { const a = k / spokes * Math.PI * 2 + (k % 2) * 0.12; add(g, B(r * 0.9, spokes > 6 ? 0.008 : 0.04, spokes > 6 ? 0.008 : 0.025), VM.rim, x + Math.cos(a) * r * 0.45, r + tube + Math.sin(a) * r * 0.45, (k % 2 ? 0.02 : -0.02) * (spokes > 6 ? 1 : 0), 0, 0, a); }
  add(g, new THREE.CylinderGeometry(r * 0.2, r * 0.2, 0.12, 10), VM.steel, x, r + tube, 0, Math.PI / 2);
}
// number plates: white for private vehicles, yellow for commercial ones, with dark bars standing in for the characters
function plate(g, x, y, z, along, yellow = false, w = 0.5, h = 0.12) {
  add(g, B(along ? w : 0.02, h, along ? 0.02 : w), yellow ? VM.plateY : VM.plate, x, y, z);
  for (let k = 0; k < 4; k++) { const o = (k - 1.5) * w * 0.22; add(g, B(along ? w * 0.15 : 0.024, h * 0.45, along ? 0.024 : w * 0.15), VM.ink, along ? x + o : x + Math.sign(x || 1) * 0.004, y, along ? z + 0.004 : z + o); }
}
// a person seated on or in a vehicle: hips at `seat`, hands on `grips` (both sides, ±z), feet at `feet` (±z); helmet or bare head
function rider(g, seat, grips, feet, o = {}) {
  const [sx, sy] = seat, lean = o.lean ?? 0.25, tl = 0.56, hx = sx + Math.sin(lean) * tl, hy = sy + Math.cos(lean) * tl; // shoulders
  rod(g, [sx, sy + 0.04, 0], [hx, hy, 0], 0.17, VM.shirt, 10); // torso
  add(g, new THREE.SphereGeometry(0.17, 10, 8), VM.shirt, hx, hy - 0.02, 0).scale.set(0.8, 0.6, 1.15); // shoulders
  add(g, new THREE.CylinderGeometry(0.05, 0.05, 0.1, 8), VM.skin, hx + 0.02, hy + 0.08, 0); // neck
  const hdx = hx + 0.04, hdy = hy + 0.22;
  add(g, new THREE.SphereGeometry(0.1, 12, 9), VM.skin, hdx, hdy, 0).scale.set(1, 1.15, 0.9);
  if (o.helmet !== false) { const h = add(g, new THREE.SphereGeometry(0.135, 14, 10, 0, Math.PI * 2, 0, Math.PI * 0.62), VM.helmet, hdx - 0.01, hdy + 0.01, 0); h.scale.set(1.05, 1.08, 1.0); add(g, B(0.03, 0.08, 0.2), VM.glass, hdx + 0.12, hdy - 0.01, 0, 0, 0, -0.3); }
  else add(g, new THREE.SphereGeometry(0.105, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.5), VM.hair, hdx - 0.01, hdy + 0.02, 0);
  for (const s of [-1, 1]) {
    const sh = [hx, hy - 0.05, s * 0.19], gp = [grips[0], grips[1], s * grips[2]], el = [(sh[0] + gp[0]) / 2 - 0.02, (sh[1] + gp[1]) / 2 - 0.1, s * (grips[2] * 0.6 + 0.08)];
    rod(g, sh, el, 0.045, VM.shirt); rod(g, el, gp, 0.04, VM.skin);
    const hip = [sx, sy, s * 0.11], kn = o.knee ? [o.knee[0], o.knee[1], s * o.knee[2]] : [sx + 0.42, sy + 0.04, s * 0.15], ft = [feet[0], feet[1], s * feet[2]];
    rod(g, hip, kn, 0.07, VM.pants); rod(g, kn, ft, 0.055, VM.pants); add(g, B(0.2, 0.07, 0.09), VM.ink, ft[0] + 0.05, ft[1] - 0.02, ft[2]);
  }
}

function carModel(kind) {
  const g = new THREE.Group();
  const D = { hatch: { L: 3.75, W: 1.66, H: 1.5, belt: 0.98, r0: -1.6, r1: -1.38, f0: 0.25, f1: 0.95, boot: 0 }, sedan: { L: 4.35, W: 1.72, H: 1.46, belt: 0.95, r0: -1.35, r1: -1.0, f0: 0.3, f1: 1.0, boot: 1 }, suv: { L: 4.45, W: 1.82, H: 1.78, belt: 1.1, r0: -2.1, r1: -2.0, f0: 0.55, f1: 1.15, boot: 0 } }[kind];
  const { L, W, H, belt } = D, hl = L / 2, hw = W / 2;
  // body shell, the sill and the dark underbody
  const lower = D.boot ? [[-hl, 0.32], [-hl, 0.88], [D.r0 - 0.1, belt], [D.f1, belt], [hl, 0.82], [hl, 0.32]] : [[-hl, 0.32], [-hl, belt], [D.f1, belt], [hl, belt - 0.18], [hl, 0.32]];
  add(g, prof(lower, W, 0.07), VM.paint);
  add(g, B(L - 0.9, 0.1, W + 0.02), VM.trim, 0, 0.33, 0);
  // glasshouse: tinted glass set in, body-coloured A, B and C pillars, a black seal along the window line, the roof
  add(g, prof([[D.r0, belt], [D.r1, H - 0.06], [D.f0, H - 0.06], [D.f1, belt]], W - 0.18, 0.04), VM.glass);
  add(g, prof([[D.r1 - 0.02, H - 0.08], [D.r1 + 0.05, H], [D.f0 - 0.05, H], [D.f0 + 0.03, H - 0.08]], W - 0.12, 0.03), VM.paint);
  const bx = (D.r1 + D.f0) / 2 - 0.1, cx = D.boot ? D.r1 + 0.25 : D.r1 + 0.08;
  for (const s of [-1, 1]) {
    const z = s * (hw - 0.085);
    rod(g, [D.f1, belt, z], [D.f0, H - 0.07, z], 0.045, VM.paint, 6, true); // A pillar
    rod(g, [D.r0 + 0.04, belt, z], [D.r1 + 0.02, H - 0.07, z], 0.07, VM.paint, 6, true); // C pillar
    add(g, B(0.1, H - belt - 0.06, 0.05), VM.paint, bx, (H + belt) / 2 - 0.02, z); // B pillar
    if (kind !== 'hatch') add(g, B(0.07, H - belt - 0.08, 0.05), VM.paint, cx, (H + belt) / 2 - 0.03, z); // the quarter-light post
    add(g, B(D.f1 - D.r0 + 0.1, 0.03, 0.02), VM.trim, (D.f1 + D.r0) / 2, belt + 0.012, s * (hw + 0.002)); // window seal
    // door seams and handles: front door, rear door
    for (const x of [D.f1 - 0.05, bx + 0.02, D.r0 + (kind === 'hatch' ? 0.25 : 0.18)]) add(g, B(0.012, belt - 0.42, 0.012), VM.trim, x, (belt + 0.42) / 2, s * (hw + 0.004));
    for (const x of [bx + 0.18, D.r0 + 0.45]) add(g, B(0.13, 0.025, 0.025), VM.chrome, x, belt - 0.1, s * (hw + 0.01));
    // mirror on a stalk, black with a body-coloured cap
    rod(g, [D.f1 - 0.1, belt + 0.03, s * (hw - 0.05)], [D.f1 - 0.16, belt + 0.07, s * (hw + 0.12)], 0.018, VM.trim, 5);
    add(g, B(0.08, 0.1, 0.17), VM.paint, D.f1 - 0.17, belt + 0.1, s * (hw + 0.17));
    // indicator repeater on the front fender
    add(g, B(0.06, 0.025, 0.015), VM.amber, hl - 0.55, belt - 0.12, s * (hw + 0.004));
  }
  // nose: grille with a chrome bar, headlamps, indicators, bumper with an air dam and fog lamps, plate
  const nose = D.boot ? 0.82 : belt - 0.18;
  add(g, B(0.04, 0.16, W * 0.48), VM.trim, hl + 0.005, nose - 0.14, 0); add(g, B(0.05, 0.025, W * 0.44), VM.chrome, hl + 0.015, nose - 0.1, 0);
  for (const s of [-1, 1]) {
    add(g, B(0.08, 0.11, 0.36), VM.lamp, hl - 0.015, nose - 0.11, s * (hw - 0.28), s * -0.25, 0, 0);
    add(g, B(0.06, 0.04, 0.12), VM.amber, hl, nose - 0.2, s * (hw - 0.12));
    add(g, new THREE.CylinderGeometry(0.04, 0.04, 0.03, 10), VM.lamp, hl + 0.09, 0.4, s * (hw - 0.28), 0, 0, Math.PI / 2);
  }
  add(g, B(0.22, 0.22, W + 0.03), VM.paint, hl - 0.03, 0.46, 0); add(g, B(0.2, 0.08, W * 0.6), VM.trim, hl + 0.01, 0.38, 0); // bumper, air dam
  plate(g, hl + 0.11, 0.53, 0, false);
  // tail: lamps wrapping round the corners, reverse lights, bumper, plate, a rear wiper and a spoiler on the hatches and SUVs
  const tailY = D.boot ? 0.78 : belt - 0.2;
  for (const s of [-1, 1]) {
    add(g, B(0.06, 0.18, 0.3), VM.tail, -hl - 0.005, tailY, s * (hw - 0.2)); add(g, B(0.22, 0.18, 0.03), VM.tail, -hl + 0.08, tailY, s * (hw + 0.004));
    add(g, B(0.06, 0.05, 0.1), VM.lamp, -hl - 0.01, tailY - 0.13, s * (hw - 0.3));
  }
  add(g, B(0.2, 0.22, W + 0.03), VM.paint, -hl + 0.03, 0.46, 0); add(g, B(0.04, 0.05, W * 0.7), VM.trim, -hl - 0.075, 0.4, 0);
  plate(g, -hl - 0.1, 0.62, 0, false);
  if (!D.boot) { rod(g, [D.r0 - 0.03, belt + 0.25, -0.05], [D.r0 + 0.02, belt + 0.03, 0.25], 0.012, VM.trim, 4); add(g, B(0.2, 0.05, W - 0.3), VM.paint, D.r1 - 0.02, H - 0.04, 0, 0, 0, 0.2); }
  // wipers on the windscreen, an aerial on the sedan, roof rails on the SUV
  for (const z of [-0.35, 0.25]) rod(g, [D.f1 - 0.02, belt + 0.03, z], [D.f1 - 0.25, belt + 0.18, z + 0.32], 0.01, VM.trim, 4);
  if (kind === 'sedan') rod(g, [D.r1 - 0.15, H - 0.02, 0], [D.r1 - 0.35, H + 0.18, 0], 0.006, VM.trim, 4);
  if (kind === 'suv') for (const s of [-1, 1]) { add(g, B(D.f0 - D.r1 - 0.2, 0.03, 0.04), VM.steel, (D.f0 + D.r1) / 2, H + 0.06, s * (hw - 0.18)); for (const x of [D.r1 + 0.1, D.f0 - 0.1]) add(g, B(0.05, 0.06, 0.04), VM.trim, x, H + 0.03, s * (hw - 0.18)); }
  const r = kind === 'suv' ? 0.36 : 0.31, wx = hl - (kind === 'sedan' ? 0.85 : 0.75);
  for (const x of [wx, -wx + 0.05]) for (const z of [-1, 1]) wheel(g, x, z * (hw - 0.12), r, 0.21);
  return g;
}
function totoModel() { // battery e-rickshaw ("toto"): open sides, rounded roof on four posts, a single front wheel, the driver up front
  const g = new THREE.Group();
  add(g, prof([[-1.35, 0.3], [-1.35, 0.78], [0.55, 0.78], [0.95, 1.2], [1.25, 1.2], [1.38, 0.9], [1.3, 0.35], [0.6, 0.3]], 1.0, 0.05), VM.paint);
  add(g, prof([[-1.42, 1.86], [-1.38, 1.97], [1.15, 1.97], [1.4, 1.84], [1.38, 1.8], [-1.4, 1.8]], 1.12, 0.03), VM.paint); // roof
  add(g, B(2.7, 0.04, 1.14), VM.trim, 0, 1.79, 0); // roof lining edge
  for (const x of [-1.32, 0.98]) for (const z of [-0.5, 0.5]) add(g, new THREE.CylinderGeometry(0.025, 0.025, 1.05), VM.steel, x, 1.3, z);
  for (const z of [-0.5, 0.5]) add(g, B(1.0, 0.025, 0.025), VM.steel, -0.5, 1.15, z); // the grab rail along each side
  add(g, B(0.05, 0.62, 0.92), VM.glass, 1.12, 1.5, 0, 0, 0, -0.2); add(g, B(0.06, 0.04, 0.95), VM.trim, 1.25, 1.82, 0);
  add(g, B(0.06, 0.95, 1.02), VM.paint, -1.36, 1.3, 0); add(g, B(0.07, 0.35, 0.7), VM.glass, -1.37, 1.45, 0);
  add(g, B(0.55, 0.12, 0.95), VM.seat, -0.85, 0.9, 0); add(g, B(0.1, 0.45, 0.95), VM.seat, -1.15, 1.12, 0); add(g, B(0.45, 0.12, 0.9), VM.seat, 0.05, 0.9, 0); add(g, B(0.08, 0.35, 0.9), VM.seat, -0.15, 1.1, 0);
  add(g, B(0.4, 0.1, 0.4), VM.seat, 0.62, 0.82, 0);
  rod(g, [1.15, 0.9, 0], [0.92, 1.3, 0], 0.025, VM.trim, 6); add(g, B(0.04, 0.04, 0.6), VM.trim, 0.92, 1.3, 0); // handlebar
  add(g, new THREE.CylinderGeometry(0.07, 0.07, 0.05, 12), VM.lamp, 1.39, 1.02, 0, 0, 0, Math.PI / 2); for (const z of [-0.38, 0.38]) add(g, B(0.04, 0.05, 0.08), VM.amber, 1.36, 1.12, z);
  for (const z of [-0.42, 0.42]) { add(g, B(0.04, 0.1, 0.12), VM.tail, -1.4, 0.65, z); add(g, B(0.02, 0.22, 0.25), VM.trim, -1.0, 0.3, z * 1.25); } // tail lamps, mud flaps
  plate(g, -1.41, 0.45, 0, false, true, 0.36, 0.1);
  rod(g, [1.05, 0.25, 0], [1.2, 0.85, 0], 0.03, VM.steel); wheel(g, 1.05, 0, 0.25, 0.14, false); for (const z of [-0.5, 0.5]) wheel(g, -0.9, z, 0.25, 0.15, false);
  rider(g, [0.6, 0.86], [0.92, 1.22, 0.28], [0.95, 0.8, 0.15], { helmet: false, lean: 0.3, knee: [0.95, 0.92, 0.17] });
  return g;
}
function autoModel() { // CNG auto-rickshaw: painted tub, yellow canopy, black side curtains rolled up, a spare wheel behind
  const g = new THREE.Group();
  add(g, prof([[-1.3, 0.32], [-1.3, 0.95], [0.6, 0.95], [1.05, 1.05], [1.3, 0.85], [1.3, 0.38], [0.5, 0.32]], 1.3, 0.06), VM.paint);
  add(g, prof([[-1.32, 0.95], [-1.32, 1.45], [-1.05, 1.74], [0.85, 1.78], [1.12, 1.62], [1.05, 1.55], [0.8, 1.7], [-0.98, 1.66], [-1.22, 1.42], [-1.22, 0.95]], 1.36, 0.03), VM.canopyY);
  add(g, B(0.04, 0.6, 1.1), VM.glass, 1.05, 1.32, 0, 0, 0, -0.25); rod(g, [1.1, 1.06, -0.2], [0.98, 1.5, 0.05], 0.01, VM.trim, 4); // windscreen, wiper
  for (const z of [-0.66, 0.66]) { add(g, new THREE.CylinderGeometry(0.06, 0.06, 1.6, 8), VM.hood, -0.2, 1.62, z, 0, 0, Math.PI / 2); add(g, new THREE.CylinderGeometry(0.02, 0.02, 0.7), VM.steel, 0.82, 1.3, z * 0.95); }
  add(g, B(0.5, 0.14, 1.15), VM.seat, -0.8, 1.0, 0); add(g, B(0.12, 0.5, 1.15), VM.seat, -1.12, 1.25, 0); add(g, B(0.32, 0.1, 0.36), VM.seat, 0.43, 0.74, 0);
  add(g, B(0.04, 0.25, 0.75), VM.glass, -1.31, 1.25, 0); // rear window
  add(g, new THREE.CylinderGeometry(0.08, 0.08, 0.06, 12), VM.lamp, 1.32, 0.9, 0, 0, 0, Math.PI / 2); add(g, B(0.04, 0.04, 0.7), VM.trim, 0.9, 1.25, 0);
  for (const z of [-0.5, 0.5]) { add(g, B(0.04, 0.05, 0.08), VM.amber, 1.28, 1.0, z * 0.6); add(g, B(0.04, 0.1, 0.12), VM.tail, -1.31, 0.6, z); }
  add(g, new THREE.TorusGeometry(0.2, 0.07, 8, 18), VM.tyre, -1.42, 0.85, 0, 0, Math.PI / 2, 0); // the spare
  add(g, B(0.08, 0.06, 0.55), VM.trim, 1.2, 0.33, 0); plate(g, 1.32, 0.55, 0, false, true, 0.3, 0.09); plate(g, -1.33, 0.5, 0.35, false, true, 0.3, 0.09);
  wheel(g, 1.0, 0, 0.23, 0.13, false); for (const z of [-0.58, 0.58]) wheel(g, -0.85, z, 0.23, 0.14, false);
  rider(g, [0.4, 0.78], [0.9, 1.15, 0.3], [0.95, 0.72, 0.16], { helmet: false, lean: 0.35, knee: [0.8, 0.84, 0.17] }); // hunched under the canopy, as auto drivers sit
  return g;
}
function scooterModel() { // Activa-type: leg shield, floorboard, rounded rear body, cowl headlamp, mirrors on stalks
  const g = new THREE.Group();
  add(g, prof([[-0.85, 0.36], [-0.92, 0.58], [-0.78, 0.74], [-0.5, 0.82], [-0.12, 0.8], [-0.06, 0.48], [0.36, 0.44], [0.44, 0.52], [0.36, 0.44], [-0.05, 0.42], [-0.12, 0.34], [-0.6, 0.3]], 0.38, 0.06), VM.paint); // rear body
  add(g, prof([[0.36, 0.42], [0.45, 1.0], [0.56, 1.08], [0.64, 1.02], [0.6, 0.42]], 0.44, 0.05), VM.paint); // the leg shield
  add(g, B(0.46, 0.04, 0.3), VM.trim, 0.12, 0.43, 0); // floorboard mat
  add(g, prof([[-0.82, 0.83], [-0.78, 0.92], [-0.1, 0.9], [-0.08, 0.82]], 0.32, 0.04), VM.seat);
  rod(g, [-0.9, 0.85, -0.14], [-0.72, 0.9, -0.14], 0.012, VM.chrome, 4); rod(g, [-0.9, 0.85, 0.14], [-0.72, 0.9, 0.14], 0.012, VM.chrome, 4); add(g, B(0.03, 0.02, 0.28), VM.chrome, -0.9, 0.85, 0); // grab rail
  rod(g, [0.64, 0.3, 0], [0.58, 1.14, 0], 0.035, VM.trim); // steering column through the shield
  add(g, B(0.16, 0.12, 0.5), VM.paint, 0.6, 1.2, 0); add(g, B(0.1, 0.09, 0.22), VM.lamp, 0.69, 1.2, 0); // handlebar cowl, headlamp
  for (const s of [-1, 1]) {
    add(g, B(0.04, 0.035, 0.14), VM.trim, 0.58, 1.22, s * 0.3); // grips
    rod(g, [0.58, 1.25, s * 0.2], [0.55, 1.45, s * 0.25], 0.01, VM.trim, 4); add(g, new THREE.SphereGeometry(0.045, 8, 6), VM.glass, 0.55, 1.47, s * 0.26).scale.set(0.5, 0.8, 1); // mirrors
    add(g, B(0.04, 0.03, 0.05), VM.amber, 0.68, 1.15, s * 0.22); add(g, B(0.04, 0.03, 0.05), VM.amber, -0.9, 0.7, s * 0.12);
  }
  add(g, prof([[0.48, 0.3], [0.56, 0.42], [0.8, 0.42], [0.86, 0.32]], 0.12, 0.02), VM.paint); // front mudguard
  add(g, B(0.05, 0.08, 0.14), VM.tail, -0.93, 0.68, 0); plate(g, -0.9, 0.48, 0, false, false, 0.2, 0.1);
  rod(g, [-0.2, 0.3, 0.18], [-0.75, 0.38, 0.18], 0.04, VM.steel); // silencer, right side
  for (const x of [-0.62, 0.66]) bikeWheel(g, x, 0.17, 0.065, 5);
  rider(g, [-0.42, 0.9], [0.58, 1.22, 0.3], [0.1, 0.48, 0.13], { lean: 0.12, knee: [0.12, 0.88, 0.17] });
  return g;
}
function motoModel() { // Splendor-type commuter: tank with knee pads, finned engine, long silencer, carrier, saree guard on the left
  const g = new THREE.Group();
  const tank = add(g, new THREE.SphereGeometry(0.17, 14, 9), VM.paint, 0.12, 0.88, 0); tank.scale.set(1.6, 0.7, 0.85);
  for (const s of [-1, 1]) add(g, B(0.16, 0.1, 0.02), VM.trim, 0.0, 0.84, s * 0.15);
  add(g, prof([[-0.72, 0.82], [-0.68, 0.9], [-0.1, 0.9], [-0.05, 0.82]], 0.26, 0.04), VM.seat);
  add(g, prof([[-0.95, 0.74], [-0.88, 0.84], [-0.3, 0.82], [-0.3, 0.68]], 0.2, 0.03), VM.paint); // tail panel
  add(g, B(0.3, 0.2, 0.26), VM.paint, -0.38, 0.66, 0); // side panels
  // engine: block with cooling fins, a cylinder leaning forward, the chain guard
  add(g, B(0.36, 0.22, 0.22), VM.steel, 0.02, 0.44, 0); for (let k = 0; k < 5; k++) add(g, B(0.11, 0.022, 0.2), VM.steel, 0.2 + k * 0.012, 0.56 + k * 0.035, 0, 0, 0, -0.35); // cylinder fins
  add(g, B(0.6, 0.05, 0.04), VM.trim, -0.35, 0.42, -0.14);
  rod(g, [0.32, 0.92, 0], [-0.25, 0.5, 0], 0.03, VM.trim); rod(g, [-0.25, 0.5, 0], [-0.68, 0.35, 0], 0.025, VM.trim); // frame
  // front: two fork tubes, round headlamp with a visor, speedometer, handlebar, mirrors, mudguards
  for (const s of [-1, 1]) rod(g, [0.73, 0.33, s * 0.07], [0.55, 1.0, s * 0.07], 0.022, VM.chrome);
  add(g, new THREE.CylinderGeometry(0.09, 0.09, 0.08, 14), VM.lamp, 0.66, 1.0, 0, 0, 0, Math.PI / 2); add(g, B(0.08, 0.04, 0.2), VM.trim, 0.63, 1.1, 0);
  add(g, new THREE.CylinderGeometry(0.05, 0.05, 0.04, 10), VM.trim, 0.55, 1.12, 0); add(g, B(0.04, 0.035, 0.7), VM.trim, 0.52, 1.1, 0);
  for (const s of [-1, 1]) { rod(g, [0.52, 1.12, s * 0.22], [0.5, 1.34, s * 0.26], 0.01, VM.trim, 4); add(g, new THREE.SphereGeometry(0.04, 8, 6), VM.glass, 0.5, 1.36, s * 0.27).scale.set(0.5, 0.8, 1); add(g, B(0.04, 0.03, 0.05), VM.amber, 0.66, 0.98, s * 0.14); }
  add(g, prof([[0.55, 0.62], [0.62, 0.68], [0.9, 0.66], [0.96, 0.58]], 0.1, 0.02), VM.paint);
  add(g, prof([[-0.98, 0.5], [-0.98, 0.62], [-0.6, 0.7], [-0.55, 0.62]], 0.12, 0.02), VM.paint);
  // silencer with a chrome heat shield on the right, a carrier rack, tail lamp and plate
  rod(g, [-0.05, 0.36, 0.17], [-0.85, 0.45, 0.17], 0.045, VM.steel); add(g, B(0.3, 0.05, 0.03), VM.chrome, -0.45, 0.47, 0.21, 0, 0, 0.1);
  add(g, B(0.32, 0.025, 0.24), VM.trim, -0.85, 0.86, 0); add(g, B(0.06, 0.06, 0.12), VM.tail, -0.98, 0.72, 0); plate(g, -1.0, 0.58, 0, false, false, 0.2, 0.1);
  // the saree guard: a rail over the left of the rear wheel, so a pillion's sari can't catch in the spokes
  rod(g, [-0.35, 0.82, -0.2], [-0.95, 0.58, -0.2], 0.012, VM.chrome, 4); rod(g, [-0.95, 0.58, -0.2], [-0.75, 0.25, -0.2], 0.012, VM.chrome, 4); rod(g, [-0.62, 0.78, -0.2], [-0.62, 0.3, -0.2], 0.012, VM.chrome, 4);
  for (const x of [-0.66, 0.7]) bikeWheel(g, x, 0.25, 0.07, 16);
  rider(g, [-0.35, 0.9], [0.52, 1.1, 0.33], [-0.02, 0.38, 0.2], { lean: 0.32, knee: [0.15, 0.84, 0.19] });
  return g;
}
function busModel() { // city bus: window bays between pillars, destination board, livery bands, folding door on the kerb side, mirrors on arms
  const g = new THREE.Group(), L = 9.0, W = 2.3, hl = L / 2;
  add(g, prof([[-hl, 0.45], [-hl, 2.85], [hl - 0.35, 2.88], [hl, 2.5], [hl, 0.45]], W, 0.1), VM.paint);
  add(g, B(L - 1.6, 0.85, W + 0.02), VM.glass, -0.45, 2.1, 0);
  for (let x = -hl + 0.95; x < hl - 1.3; x += 1.05) for (const s of [-1, 1]) add(g, B(0.09, 0.85, 0.03), VM.paint, x, 2.1, s * (W / 2 + 0.012)); // window pillars
  add(g, B(0.05, 1.05, W - 0.2), VM.glass, hl + 0.01, 1.95, 0); add(g, B(0.05, 0.6, W - 0.4), VM.glass, -hl - 0.01, 2.2, 0);
  add(g, B(0.06, 0.22, W - 0.5), VM.ink, hl + 0.02, 2.62, 0); add(g, B(0.065, 0.12, W - 0.7), VM.amber, hl + 0.03, 2.62, 0); // destination board
  add(g, B(L + 0.02, 0.32, W + 0.02), VM.trim, 0, 0.6, 0); add(g, B(L - 1.2, 0.12, W + 0.03), VM.red, -0.3, 1.45, 0); add(g, B(L - 1.2, 0.05, W + 0.03), VM.canopyY, -0.3, 1.36, 0); // bumper band, livery
  add(g, B(0.8, 1.9, 0.05), VM.glass, hl - 1.3, 1.45, -W / 2 - 0.005); add(g, B(0.03, 1.9, 0.06), VM.trim, hl - 1.3, 1.45, -W / 2 - 0.01); // door on the kerb side (left)
  add(g, B(0.7, 0.18, 0.3), VM.trim, hl - 1.3, 0.55, -W / 2 + 0.1); // step
  for (const s of [-1, 1]) {
    add(g, B(0.06, 0.18, 0.3), VM.lamp, hl + 0.03, 0.95, s * 0.85); add(g, B(0.06, 0.25, 0.2), VM.tail, -hl - 0.03, 1.0, s * 0.95); add(g, B(0.05, 0.06, 0.12), VM.amber, hl + 0.03, 1.15, s * 0.95);
    rod(g, [hl - 0.1, 2.3, s * (W / 2)], [hl + 0.35, 2.15, s * (W / 2 + 0.3)], 0.02, VM.trim, 4); add(g, B(0.05, 0.32, 0.16), VM.glass, hl + 0.36, 1.98, s * (W / 2 + 0.32)); // mirror arm
  }
  add(g, B(0.04, 0.45, W * 0.55), VM.trim, hl + 0.01, 0.75, 0); plate(g, hl + 0.06, 0.95, 0, false, true, 0.55, 0.13); plate(g, -hl - 0.06, 0.9, 0, false, true, 0.55, 0.13);
  for (const x of [-hl + 2.1, hl - 2.0]) for (const z of [-1, 1]) wheel(g, x, z * (W / 2 - 0.2), 0.48, 0.3);
  return g;
}
function truckModel() { // Tata Ace: snub cab, slatted cargo bed, commercial yellow plates
  const g = new THREE.Group();
  add(g, prof([[0.6, 0.45], [0.6, 1.75], [1.15, 1.78], [1.45, 1.2], [1.5, 0.45]], 1.5, 0.06), VM.paint);
  add(g, B(0.05, 0.55, 1.3), VM.glass, 1.32, 1.45, 0, 0, 0, -0.5); for (const z of [-1, 1]) add(g, B(0.45, 0.42, 0.02), VM.glass, 0.95, 1.45, z * 0.755);
  add(g, B(0.05, 0.18, 0.7), VM.trim, 1.5, 0.75, 0); for (let k = 0; k < 3; k++) add(g, B(0.055, 0.02, 0.66), VM.chrome, 1.51, 0.69 + k * 0.06, 0); // grille
  for (const z of [-1, 1]) { rod(g, [1.2, 1.5, z * 0.75], [1.35, 1.55, z * 0.95], 0.015, VM.trim, 4); add(g, B(0.04, 0.22, 0.1), VM.glass, 1.36, 1.45, z * 0.97); rod(g, [1.42, 1.25, z * 0.3], [1.2, 1.62, z * 0.05], 0.01, VM.trim, 4); }
  add(g, B(2.3, 0.12, 1.55), VM.trim, -0.6, 0.62, 0);
  for (const z of [-1, 1]) for (let k = 0; k < 3; k++) add(g, B(2.3, 0.1, 0.05), VM.paint, -0.6, 0.73 + k * 0.14, z * 0.75); // slatted sides
  for (let k = 0; k < 3; k++) add(g, B(0.05, 0.1, 1.55), VM.paint, -1.73, 0.73 + k * 0.14, 0);
  for (const x of [-1.72, -0.6, 0.55]) for (const z of [-1, 1]) add(g, B(0.06, 0.45, 0.06), VM.trim, x, 0.9, z * 0.75);
  add(g, B(0.05, 0.1, 0.22), VM.lamp, 1.52, 0.95, 0.5); add(g, B(0.05, 0.1, 0.22), VM.lamp, 1.52, 0.95, -0.5); for (const z of [-0.6, 0.6]) add(g, B(0.04, 0.1, 0.14), VM.tail, -1.76, 0.6, z);
  plate(g, 1.53, 0.55, 0, false, true, 0.4, 0.1); plate(g, -1.77, 0.48, 0, false, true, 0.4, 0.1);
  for (const x of [-1.2, 1.0]) for (const z of [-1, 1]) wheel(g, x, z * 0.62, 0.3, 0.2);
  rider(g, [0.85, 0.74], [1.15, 1.1, 0.2], [1.25, 0.55, 0.15], { helmet: false, lean: 0.2, knee: [1.15, 0.8, 0.16] }); // the driver, seen through the cab glass
  return g;
}
function cycleRickModel() { // cycle-rickshaw: front bicycle half, two rear wheels, red bench seat, black folding hood, the rickshaw-wallah pedalling
  const g = new THREE.Group();
  bikeWheel(g, 0.95, 0.31, 0.03, 16);
  for (const z of [-0.48, 0.48]) { const k = g.children.length; bikeWheel(g, -0.55, 0.31, 0.03, 16); for (let i = k; i < g.children.length; i++) g.children[i].position.z += z; }
  add(g, B(1.4, 0.05, 0.05), VM.frame, 0.25, 0.55, 0, 0, 0, 0.1); add(g, new THREE.CylinderGeometry(0.025, 0.025, 0.8), VM.frame, 0.85, 0.75, 0, 0, 0, -0.3);
  add(g, B(0.25, 0.06, 0.16), VM.seat, 0.45, 0.98, 0); add(g, new THREE.CylinderGeometry(0.025, 0.025, 0.45), VM.frame, 0.45, 0.75, 0);
  add(g, B(0.06, 0.04, 0.55), VM.trim, 0.9, 1.15, 0);
  add(g, B(0.05, 0.05, 1.0), VM.frame, -0.55, 0.34, 0); add(g, B(0.7, 0.3, 1.0), VM.frame, -0.55, 0.62, 0);
  add(g, B(0.6, 0.12, 0.95), VM.red, -0.55, 0.85, 0); add(g, B(0.1, 0.45, 0.95), VM.red, -0.85, 1.12, 0);
  add(g, new THREE.CylinderGeometry(0.55, 0.55, 1.0, 12, 1, true, 0, Math.PI * 0.75), VM.hood, -0.7, 1.15, 0, Math.PI / 2, 0, Math.PI / 2 + 0.2);
  rider(g, [0.42, 1.02], [0.88, 1.15, 0.26], [0.55, 0.42, 0.12], { helmet: false, lean: 0.35, knee: [0.65, 1.02, 0.14] });
  return g;
}
const KINDS = { hatch: () => carModel('hatch'), sedan: () => carModel('sedan'), suv: () => carModel('suv'), toto: totoModel, auto: autoModel, scooter: scooterModel, moto: motoModel, bus: busModel, truck: truckModel, cyclerick: cycleRickModel };

// bake: one merged geometry per material. riders: include the people (moving traffic only)
const BAKED = {};
function baked(kind, riders = false) {
  const key = kind + (riders ? '+r' : '');
  if (BAKED[key]) return BAKED[key];
  const g = KINDS[kind](); g.updateMatrixWorld(true); const by = new Map();
  g.traverse(o => { if (!o.isMesh || (!riders && o.material.userData.rider)) return; let geo = o.geometry.clone().applyMatrix4(o.matrixWorld); if (geo.index) geo = geo.toNonIndexed();
    for (const k of Object.keys(geo.attributes)) if (!['position', 'normal', 'uv'].includes(k)) geo.deleteAttribute(k); geo.clearGroups();
    if (!by.has(o.material)) by.set(o.material, []); by.get(o.material).push(geo); });
  return (BAKED[key] = [...by].map(([m, gs]) => [m, mergeGeometries(gs, false)]));
}
const QUEUE = {}; let pending = false;
const PLACED = []; // every vehicle placed so far ({ kind, x, y, ang }); the game turns the parked ones into colliders
function addVehicle(kind, x, y, ang, color = '#ffffff', lift = 0.06) {
  PLACED.push({ kind, x, y, ang });
  (QUEUE[kind] = QUEUE[kind] || []).push([x, hAt(x, y) + footRaise(x, y) + lift, y, ang, new THREE.Color(color)]);
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
// what riders and drivers wear: shirts and kurtas, a few bright ones
const SHIRT_COLS = ['#f2f0ea', '#e8e4d8', '#4a78a8', '#2f3a4a', '#a63c3c', '#3c7a4a', '#d8c27a', '#6d4a8a', '#c86a2a', '#87a9c9'];

export { addVehicle, flushVehicles, baked, PLACED, CAR_COLS, TOTO_COLS, TWO_COLS, SHIRT_COLS, KINDS };
