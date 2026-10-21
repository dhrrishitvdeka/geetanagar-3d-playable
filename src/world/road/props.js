import * as THREE from 'three';
import { scene } from '../../core/context.js';
import { hAt, rng } from '../../core/geo.js';
import { footRaise } from './footpath.js';
import { addCollider } from '../geom.js';
import { M, box, canvasTex, std } from '../materials.js';
import { banner } from './textures.js';

// ---------- roadside props: Hatigarh traffic island, stalls, signals, cabinets, carts, high-mast light ----------
// Local frame for props: +x = the side facing the road / the front, y up.
function put(g, x, y, ang = 0, lift = 0) {
  g.position.set(x, hAt(x, y) + footRaise(x, y) + lift, -y); g.rotation.y = ang; // footRaise: props on a raised footpath stand on it
  g.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } }); scene.add(g); return g;
}
const add = (g, m, x, y, z, rx = 0, ry = 0, rz = 0) => { m.position.set(x, y, z); m.rotation.set(rx, ry, rz); g.add(m); return m; };
const cyl = (r0, r1, h, mat, seg = 12, open = false) => new THREE.Mesh(new THREE.CylinderGeometry(r0, r1, h, seg, 1, open), mat);

const stripes = canvasTex(512, 64, (g, w, h) => { for (let k = 0; k < 16; k++) { g.fillStyle = k % 2 ? '#1d1e20' : '#ebe8df'; g.fillRect(k * 32, 0, 32, h); }
  for (let i = 0; i < 500; i++) { g.fillStyle = `rgba(110,92,70,${Math.random() * 0.4})`; g.fillRect(Math.random() * w, h * 0.5 + Math.random() * h * 0.5, 2 + Math.random() * 6, 2); } });
const tinTex = canvasTex(256, 256, (g, w, h) => { // corrugated sheet with rust streaks
  for (let x = 0; x < w; x += 8) { const gr = g.createLinearGradient(x, 0, x + 8, 0); gr.addColorStop(0, '#8d969c'); gr.addColorStop(0.5, '#c2c8cb'); gr.addColorStop(1, '#7b8388'); g.fillStyle = gr; g.fillRect(x, 0, 8, h); }
  const r = rng(7); for (let i = 0; i < 40; i++) { g.fillStyle = `rgba(${120 + r() * 40},${60 + r() * 20},30,${0.15 + r() * 0.3})`; g.fillRect(r() * w, r() * h, 3 + r() * 14, 10 + r() * 80); }
});
const MP = {
  stripes: new THREE.MeshStandardMaterial({ map: stripes, roughness: 0.8 }), yellowPipe: std('#e2b81f', { metalness: 0.3, roughness: 0.45 }),
  banner: new THREE.MeshStandardMaterial({ map: banner(), roughness: 0.55 }), disc: std('#e9e6de', { roughness: 0.6, side: THREE.DoubleSide }), discRim: std('#b3261e'),
  tin: new THREE.MeshStandardMaterial({ map: tinTex, metalness: 0.45, roughness: 0.45, side: THREE.DoubleSide }), wood: std('#7a5a3a', { roughness: 0.9 }), bamboo: std('#b59a62', { roughness: 0.85 }),
  cabinet: std('#8f9599', { metalness: 0.35, roughness: 0.55 }), signal: std('#151617', { roughness: 0.5 }), red: std('#b8221c', { roughness: 0.65 }),
  lampR: std('#5a0d0d', { emissive: '#ff2a1a', emissiveIntensity: 0.9 }), lampA: std('#4a3a10', { roughness: 0.3 }), lampG: std('#0d3a1a', { roughness: 0.3 }),
  tarp: std('#2f6fb3', { side: THREE.DoubleSide, roughness: 0.85 }), tub: std('#2f6fb3', { roughness: 0.6 }), tubR: std('#c62828', { roughness: 0.6 }),
};
// Street View (pano 9Yn0U7qxM9dqWNLUej2-3g, Mar 2026): round plinth in black-and-white stripes with a step block, a yellow pipe
// railing round a bed of potted red flowers, a slim black-and-white banded pillar, a white canopy disc and a navy advertising drum on top
const bands = canvasTex(64, 256, (g, w, h) => { for (let k = 0; k < 8; k++) { g.fillStyle = k % 2 ? '#1d1e20' : '#ebe8df'; g.fillRect(0, k * 32, w, 32); }
  for (let i = 0; i < 120; i++) { g.fillStyle = `rgba(110,92,70,${Math.random() * 0.3})`; g.fillRect(Math.random() * w, Math.random() * h, 2, 2 + Math.random() * 5); } });
const drumTex = canvasTex(512, 128, (g, w, h) => { // navy ad drum, white lettering (generic text)
  g.fillStyle = '#16294f'; g.fillRect(0, 0, w, h); g.fillStyle = '#f2f2ee'; g.textAlign = 'center';
  for (const cx of [128, 384]) { g.font = 'bold 30px Arial, sans-serif'; g.fillText('SMART CITY', cx, 52); g.font = '20px Arial, sans-serif'; g.fillText('GUWAHATI', cx, 84); }
  g.fillStyle = 'rgba(255,255,255,0.12)'; g.fillRect(0, 0, w, 10); g.fillStyle = 'rgba(0,0,0,0.25)'; g.fillRect(0, h - 12, w, 12); }, false);
function trafficIsland(x, y) {
  const g = new THREE.Group(), PH = 0.85;
  add(g, cyl(1.3, 1.36, PH, MP.stripes, 40), 0, PH / 2, 0);
  add(g, box(0.6, 0.42, 0.7, M.concrete), -1.45, 0.21, 0.3); // step block on the west side
  add(g, cyl(1.24, 1.24, 0.06, std('#5a4634', { roughness: 1 }), 40), 0, PH + 0.03, 0); // soil bed
  for (const hgt of [0.3, 0.62]) add(g, new THREE.Mesh(new THREE.TorusGeometry(1.2, 0.03, 8, 40), MP.yellowPipe), 0, PH + hgt, 0, Math.PI / 2);
  for (let k = 0; k < 28; k++) { const a = k / 28 * Math.PI * 2; add(g, cyl(0.022, 0.022, 0.62, MP.yellowPipe, 6), Math.cos(a) * 1.2, PH + 0.31, Math.sin(a) * 1.2); }
  // potted plants: terracotta pots with red-flowered and green clumps
  const r = rng(77), pot = std('#9b4a2c', { roughness: 0.9 }), leaf = std('#3f6b2a', { roughness: 0.9 }), flower = std('#c8262a', { roughness: 0.8 });
  for (let k = 0; k < 9; k++) { const a = k / 9 * Math.PI * 2 + r() * 0.3, rr = 0.75 + r() * 0.25, px = Math.cos(a) * rr, pz = Math.sin(a) * rr;
    add(g, cyl(0.13, 0.1, 0.22, pot, 10), px, PH + 0.14, pz); add(g, new THREE.Mesh(new THREE.IcosahedronGeometry(0.13 + r() * 0.05, 1), r() < 0.6 ? flower : leaf), px, PH + 0.32, pz); }
  const band = new THREE.MeshStandardMaterial({ map: bands, roughness: 0.7 }); bands.repeat.set(1, 3);
  add(g, cyl(0.16, 0.18, 4.0, band, 16), 0, PH + 2.0, 0);
  add(g, cyl(1.0, 1.0, 0.08, MP.disc, 40), 0, PH + 4.05, 0);
  add(g, cyl(0.82, 0.82, 1.3, new THREE.MeshStandardMaterial({ map: drumTex, roughness: 0.5 }), 40), 0, PH + 4.75, 0);
  add(g, cyl(0.84, 0.84, 0.06, std('#1d1e20'), 40), 0, PH + 5.42, 0);
  add(g, cyl(0.05, 0.05, 2.0, M.steel, 8), 0, PH + 6.4, 0);
  put(g, x, y, 0, 0.04);
  for (let k = 0; k < 12; k++) { const a0 = k / 12 * 6.283, a1 = (k + 1) / 12 * 6.283; addCollider([x + Math.cos(a0) * 1.4, y + Math.sin(a0) * 1.4], [x + Math.cos(a1) * 1.4, y + Math.sin(a1) * 1.4]); }
}
// yellow signal pole; arm > 0 adds an overhanging arm with a second head
function signalPole(x, y, ang, arm = 0) {
  const g = new THREE.Group(), H = 4.4;
  add(g, cyl(0.08, 0.1, H, MP.yellowPipe, 10), 0, H / 2, 0);
  const head = (hx, hy, hz) => { add(g, box(0.32, 0.95, 0.3, MP.signal), hx, hy, hz); [[MP.lampR, 0.3], [MP.lampA, 0], [MP.lampG, -0.3]].forEach(([m, d]) => add(g, cyl(0.1, 0.1, 0.04, m, 12), hx + 0.17, hy + d, hz, 0, 0, Math.PI / 2));
    for (const d of [0.3, 0, -0.3]) add(g, box(0.16, 0.04, 0.26, MP.signal), hx + 0.24, hy + d + 0.12, hz); };
  head(0.2, H - 0.9, 0);
  if (arm) { add(g, box(0.08, 0.08, arm, MP.yellowPipe), 0, H - 0.2, -arm / 2); head(0.2, H - 0.75, -arm + 0.2); }
  put(g, x, y, ang);
}
// yellow pole with an arm reaching over the side road, carrying a signal head and a CCTV camera (west corner of Railway Colony Rd)
function gantry(x, y, ang, arm = 5.5) {
  const g = new THREE.Group(), H = 5.6;
  add(g, cyl(0.11, 0.14, H, MP.yellowPipe, 10), 0, H / 2, 0);
  add(g, box(arm, 0.12, 0.12, MP.yellowPipe), arm / 2, H - 0.2, 0); add(g, box(arm * 0.5, 0.06, 0.06, MP.yellowPipe), arm * 0.25, H - 0.75, 0, 0, 0, 0.22);
  for (const hx of [arm - 0.3, 0.25]) { add(g, box(0.3, 0.95, 0.32, MP.signal), hx, H - 0.85, 0.2); [[MP.lampR, 0.3], [MP.lampA, 0], [MP.lampG, -0.3]].forEach(([m, d]) => add(g, cyl(0.1, 0.1, 0.04, m, 12), hx, H - 0.85 + d, 0.38, Math.PI / 2)); }
  add(g, box(0.32, 0.16, 0.16, std('#e8e8e4')), arm * 0.6, H - 0.38, 0.0); add(g, cyl(0.05, 0.05, 0.06, MP.signal, 10), arm * 0.6 + 0.18, H - 0.38, 0, 0, 0, Math.PI / 2); // CCTV camera
  add(g, box(0.3, 0.45, 0.2, MP.cabinet), 0, 1.4, 0.18);
  put(g, x, y, ang);
}
function cabinet(x, y, ang) {
  const g = new THREE.Group();
  add(g, box(1.0, 0.25, 0.6, M.concrete), 0, 0.12, 0); add(g, box(0.48, 1.45, 0.92, MP.cabinet), 0, 0.98, 0);
  add(g, box(0.52, 0.06, 0.98, MP.cabinet), 0, 1.72, 0); add(g, box(0.02, 1.3, 0.02, std('#555a5e')), 0.25, 1.0, 0);
  for (let k = 0; k < 3; k++) add(g, box(0.01, 0.18 + k * 0.05, 0.25, std(['#f2f2ee', '#e5c21e', '#d33'][k])), 0.25, 0.7 + k * 0.32, (k - 1) * 0.25);
  put(g, x, y, ang);
}
// tin-roofed stall on wooden posts with a painted counter, produce heaped on top; the front faces +x
const PRODUCE = ['#e8c43a', '#f08a24', '#7ab03d', '#c6262e', '#3f8f3a', '#8a4b2a', '#e3d9a2', '#5e8f2e'];
function stall(x, y, ang, counter, seed) {
  const g = new THREE.Group(), W = 2.3, D = 1.9, r = rng(seed), hb = 2.15, hf = 2.45;
  for (const [px, ph] of [[D / 2, hf], [-D / 2, hb]]) for (const pz of [-W / 2, W / 2]) add(g, box(0.08, ph, 0.08, r() < 0.5 ? MP.wood : MP.bamboo), px, ph / 2, pz);
  const roof = add(g, box(D + 0.9, 0.03, W + 0.25, MP.tin), 0.3, (hf + hb) / 2 + 0.05, 0, 0, 0, Math.atan2(hf - hb, D));
  add(g, box(0.06, 0.22, W + 0.2, std('#8a8478', { roughness: 0.8 })), D / 2 + 0.72, hf + 0.05, 0); // weathered fascia board
  const cm = std(counter, { roughness: 0.7 });
  add(g, box(0.9, 0.85, W - 0.1, cm), D / 2 - 0.45, 0.43, 0); add(g, box(1.0, 0.05, W, MP.wood), D / 2 - 0.45, 0.88, 0);
  for (let k = 0; k < 7; k++) { const m = new THREE.Mesh(new THREE.SphereGeometry(0.22 + r() * 0.08, 10, 6), std(PRODUCE[Math.floor(r() * PRODUCE.length)], { roughness: 0.6 })); m.scale.set(1, 0.45, 1); add(g, m, D / 2 - 0.45 + (r() - 0.5) * 0.4, 0.95, -W / 2 + 0.3 + k * (W - 0.6) / 6); }
  // a string of plastic packets hung from the front beam
  for (let k = 0; k < 6; k++) add(g, box(0.02, 0.32, 0.18, std(PRODUCE[(k + seed) % PRODUCE.length], { roughness: 0.4 })), D / 2 + 0.02, hf - 0.35, -W / 2 + 0.35 + k * 0.33);
  add(g, box(0.5, 0.35, 0.4, r() < 0.5 ? MP.tub : MP.tubR), -0.3, 0.18, -0.6); add(g, box(0.4, 0.3, 0.35, std('#c9a46a')), -0.3, 0.15, 0.5);
  const tarp = add(g, box(0.02, 1.4, W, MP.tarp), -D / 2 - 0.02, 1.2, 0); tarp.material = r() < 0.5 ? MP.tarp : std(['#3a7d44', '#8a8f94', '#c8b48a'][Math.floor(r() * 3)], { roughness: 0.9 });
  put(g, x, y, ang);
}
function kiosk(x, y, ang, front = '#f0c419', body = '#cfc6b4') { // small kiosk: yellow-fronted at Hatigarh, blue ones on the park forecourt
  const g = new THREE.Group(), W = 1.7, D = 1.4;
  add(g, box(D, 2.1, W, std(body)), 0, 1.05, 0); add(g, box(0.05, 0.9, W - 0.1, std(front)), D / 2 + 0.01, 0.5, 0);
  add(g, box(0.05, 0.75, W - 0.2, std('#3a2f27')), D / 2 + 0.01, 1.4, 0); add(g, box(D + 0.5, 0.04, W + 0.3, MP.tin), 0.2, 2.18, 0, 0, 0, 0.08);
  add(g, box(0.05, 0.4, W + 0.1, std(front)), D / 2 + 0.3, 2.35, 0);
  put(g, x, y, ang);
  const c = Math.cos(ang), s = Math.sin(ang); for (const [a, b] of [[[-D / 2, -W / 2], [D / 2, -W / 2]], [[D / 2, -W / 2], [D / 2, W / 2]], [[D / 2, W / 2], [-D / 2, W / 2]], [[-D / 2, W / 2], [-D / 2, -W / 2]]]) addCollider([x + a[0] * c + a[1] * s, y + a[0] * s - a[1] * c], [x + b[0] * c + b[1] * s, y + b[0] * s - b[1] * c]);
}
function handcart(x, y, ang, color = '#c0271f', canopy = false) { // vendor's push-cart: a painted box on bicycle wheels
  const g = new THREE.Group(), body = std(color, { roughness: 0.6 });
  add(g, box(1.9, 0.55, 0.95, body), 0, 0.95, 0); add(g, box(2.0, 0.05, 1.05, MP.wood), 0, 1.25, 0);
  for (const z of [-0.5, 0.5]) { add(g, new THREE.Mesh(new THREE.TorusGeometry(0.33, 0.03, 6, 18), std('#1b1b1b')), 0.3, 0.36, z); add(g, cyl(0.025, 0.025, 1.05, M.steel, 6), 0.3, 0.36, 0, Math.PI / 2); }
  for (const z of [-0.42, 0.42]) add(g, cyl(0.025, 0.025, 0.7, M.steel, 6), -0.85, 0.35, z);
  for (const z of [-0.35, 0.35]) add(g, cyl(0.02, 0.02, 0.8, M.steel, 6), 1.3, 1.05, z, 0, 0, Math.PI / 2 - 0.2);
  if (canopy) { for (const [px, pz] of [[-0.9, -0.45], [-0.9, 0.45], [0.9, -0.45], [0.9, 0.45]]) add(g, cyl(0.02, 0.02, 1.0, M.steel, 6), px, 1.75, pz); add(g, box(2.2, 0.03, 1.3, MP.tarp), 0, 2.27, 0); }
  for (let k = 0; k < 5; k++) add(g, box(0.25, 0.15, 0.25, std(PRODUCE[k])), -0.7 + k * 0.35, 1.35, 0);
  put(g, x, y, ang);
}
function umbrellaStall(x, y, ang) { // small table stall under a red-and-white umbrella (north shoulder near Hatigarh)
  const g = new THREE.Group();
  add(g, box(1.0, 0.8, 1.4, MP.red), 0, 0.4, 0); add(g, box(1.1, 0.04, 1.5, MP.wood), 0, 0.82, 0);
  add(g, cyl(0.025, 0.025, 2.2, M.steel, 6), -0.2, 1.1, 0);
  const um = new THREE.Mesh(new THREE.ConeGeometry(1.3, 0.45, 12, 1, true), new THREE.MeshStandardMaterial({ map: stripes, color: '#ffb0a8', side: THREE.DoubleSide, roughness: 0.8 })); add(g, um, -0.2, 2.15, 0);
  put(g, x, y, ang);
}
function busShelter(x, y, ang) { // tiled-roof shelter on pillars with a bench; the open side (+x) faces the road
  const g = new THREE.Group();
  add(g, box(3.2, 0.25, 6.5, std('#8c8478')), 0, 2.7, 0, 0, 0, 0.12);
  for (const dx of [-1.3, 1.3]) for (const dz of [-3, 3]) add(g, box(0.22, 2.7, 0.22, std('#b9b1a3')), dx, 1.35, dz);
  add(g, box(0.6, 0.12, 5.5, std('#9b9488')), -0.9, 0.5, 0); add(g, box(0.1, 1.2, 6.2, std('#b9b1a3')), -1.4, 0.6, 0);
  put(g, x, y, ang);
}
function highMast(x, y) { // tall octagonal mast with a lamp ring (the high-mast light near the field)
  const g = new THREE.Group(), H = 18;
  add(g, cyl(0.7, 0.7, 0.5, M.concrete, 8), 0, 0.25, 0);
  add(g, cyl(0.13, 0.3, H, M.steel, 8), 0, 0.5 + H / 2, 0);
  add(g, new THREE.Mesh(new THREE.TorusGeometry(0.9, 0.06, 6, 24), M.steel), 0, H + 0.3, 0, Math.PI / 2);
  const lm = std('#d8dad6', { emissive: '#3a3628', roughness: 0.4 });
  for (let k = 0; k < 6; k++) { const a = k / 6 * Math.PI * 2; add(g, box(0.5, 0.3, 0.4, lm), Math.cos(a) * 0.95, H + 0.15, Math.sin(a) * 0.95, 0, -a, -0.4); }
  add(g, cyl(0.3, 0.05, 0.6, M.steel, 8), 0, H + 0.8, 0);
  put(g, x, y);
}

// rooftop mobile tower: square galvanised lattice mast tapering up, panel antennas and microwave dishes near the top
function roofTower(x, y, z, H = 11) {
  const g = new THREE.Group(), mat = std('#b9bdbf', { metalness: 0.6, roughness: 0.45 }), w0 = 1.3, w1 = 0.45, legs = [[1, 1], [1, -1], [-1, 1], [-1, -1]];
  const strut = (ax, ay, az, bx, by, bz, r) => { const dx = bx - ax, dy = by - ay, dz = bz - az, L = Math.hypot(dx, dy, dz), m = cyl(r, r, L, mat, 4);
    m.position.set((ax + bx) / 2, (ay + by) / 2, (az + bz) / 2); m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(dx / L, dy / L, dz / L)); g.add(m); };
  const hw = h => (w0 + (w1 - w0) * h / H) / 2, N = 6;
  for (const [sx, sz] of legs) strut(sx * hw(0), 0, sz * hw(0), sx * hw(H), H, sz * hw(H), 0.05);
  for (let k = 0; k < N; k++) { const h0 = k / N * H, h1 = (k + 1) / N * H; // X bracing on each face
    for (const [a, b] of [[[1, 1], [1, -1]], [[1, -1], [-1, -1]], [[-1, -1], [-1, 1]], [[-1, 1], [1, 1]]]) {
      strut(a[0] * hw(h0), h0, a[1] * hw(h0), b[0] * hw(h1), h1, b[1] * hw(h1), 0.02); strut(b[0] * hw(h0), h0, b[1] * hw(h0), a[0] * hw(h1), h1, a[1] * hw(h1), 0.02); } }
  const pan = std('#e4e4e0', { roughness: 0.6 });
  for (let k = 0; k < 3; k++) { const a = k / 3 * Math.PI * 2 + 0.4; add(g, box(0.22, 1.3, 0.1, pan), Math.cos(a) * 0.55, H - 0.9, Math.sin(a) * 0.55, 0, -a, 0); }
  for (const [h, a] of [[H - 3, 0.6], [H - 4.2, 2.6]]) { const d = cyl(0.32, 0.32, 0.18, pan, 16); d.rotation.set(0, -a, Math.PI / 2); d.position.set(Math.cos(a) * 0.45, h, Math.sin(a) * 0.45); g.add(d); }
  add(g, cyl(0.03, 0.03, 2.2, mat, 6), 0, H + 1.1, 0); // lightning rod
  g.position.set(x, z, -y); g.traverse(o => { if (o.isMesh) o.castShadow = true; }); scene.add(g); return g;
}

export { trafficIsland, signalPole, cabinet, stall, kiosk, handcart, highMast, umbrellaStall, gantry, busShelter, roofTower, put, MP };
