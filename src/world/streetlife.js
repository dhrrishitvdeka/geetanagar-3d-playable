import * as THREE from 'three';
import { scene } from '../core/context.js';
import { GEO, clsAt, hAt, rng } from '../core/geo.js';
import { mergeAdd, normalsOf, resample } from './geom.js';
import { HAT, KERB_W, MAINP, NRM, RF, asphHalf, edgeKind, hw, medHalf, nearestOnMain } from './mainroad.js';
import { M, std } from './materials.js';
import { FIELD_X0 } from './road/fieldedge.js';
import { busShelter, cabinet, gantry, handcart, highMast, kiosk, roofTower, signalPole, stall, trafficIsland, umbrellaStall } from './road/props.js';
import { BLD } from './buildings.js';
import { CAR_COLS, TOTO_COLS, TWO_COLS, addVehicle } from './road/vehicles.js';

// ================= street life: Hatigarh Chariali, parked and moving vehicles, electric poles and wires =================
// a point beside the main road: side s (+1 north), lateral offset off from the centreline, at map x
function beside(x, s, off) { const [, i] = nearestOnMain(x, MAINP.find(p => p[0] >= x)?.[1] ?? 0); const p = MAINP[i], n = NRM[i]; return [p[0] + n[0] * s * off, p[1] + n[1] * s * off, i]; }
const heading = i => { const a = MAINP[Math.max(0, i - 1)], b = MAINP[Math.min(MAINP.length - 1, i + 1)]; return Math.atan2(b[1] - a[1], b[0] - a[0]); };
const shoulderOff = (s, i) => asphHalf(i) + (edgeKind(s, i) === 'kerb' ? KERB_W : 0);

function buildHatigarh() {
  const hx = HAT.x, hy = HAT.y;
  // traffic island, signals, kiosk, cabinet and stalls: positions from data/road_features.json
  trafficIsland(RF.island.x, MAINP[nearestOnMain(RF.island.x, hy)[1]][1]);
  // lattice mobile tower on the roof of the grey shop building at the SW corner (Street View pano 9Yn0U7qxM9dqWNLUej2-3g, heading 215)
  { const b = GEO.buildings[905], e = b && BLD.find(q => q.c === b.c); if (e) roofTower(b.c[0] + 2, b.c[1] - 2, e.top); }
  const COUNTERS = ['#7b3f98', '#e8c22a', '#2f62b0', '#7b3f98', '#e8c22a', '#3a8fd0', '#8a4aa0', '#f0c419', '#2f62b0'];
  for (const st of RF.stalls) {
    if (st.kind === 'stall_row') for (let k = 0; k < st.n; k++) stall(st.x0, st.y0 + k * st.dy, st.facing === 'W' ? Math.PI : 0, COUNTERS[k % COUNTERS.length], 300 + k);
    else if (st.kind === 'kiosk') kiosk(st.x, st.y, -Math.PI / 4);
    else if (st.kind === 'cabinet') cabinet(st.x, st.y, -Math.PI / 2);
    else if (st.kind === 'umbrella_stall') { const [, i] = nearestOnMain(st.x, hy); const [px, py] = beside(st.x, st.side === 'N' ? 1 : -1, shoulderOff(st.side === 'N' ? 1 : -1, i) + 1.6); umbrellaStall(px, py, heading(i) + (st.side === 'N' ? -Math.PI / 2 : Math.PI / 2)); }
  }
  // park forecourt (south side, x -170..-66): tea stall, blue kiosks, parked cars, big trees; and the bus stand
  const rf = rng(91), fore = (x, extra) => { const [, i] = nearestOnMain(x, MAINP.find(p => p[0] >= x)[1]); const [px, py] = beside(x, -1, asphHalf(i) + extra); return [px, py, heading(i) + Math.PI / 2]; };
  for (const st of RF.stalls) {
    if (st.kind === 'tea_stall') { const [px, py, a] = fore(st.x, 3.6); stall(px, py, a, '#6d4a2c', 77); }
    else if (st.kind === 'kiosk_blue') { const [px, py, a] = fore(st.x, 3.4); kiosk(px, py, a, '#2f62b0', '#3f74c0'); }
  }
  for (const c of RF.parked || []) { const [px, py, a] = fore(c.x, 3.2); addVehicle(rf() < 0.5 ? 'hatch' : 'sedan', px, py, a - Math.PI / 2 + (rf() - 0.5) * 0.3, CAR_COLS[Math.floor(rf() * CAR_COLS.length)], 0.04); }
  for (const t of RF.forecourt_trees || []) { const [px, py] = fore(t.x, 6.5); EXTRA_TREES.push({ x: px, y: py, h: hAt(px, py), s: 9 + rf() * 3, variant: 'oak' }); }
  for (const b of RF.bus_stops) { const [px, py, a] = fore(b.x, 3.4); busShelter(px, py, a); }
  for (const sg of RF.signals) {
    if (sg.side === 'median') { const [nx, ny, ni] = beside(sg.x, 1, 0); signalPole(nx, ny, heading(ni) + Math.PI, 0); }
    else if (sg.type === 'gantry') gantry(sg.x, sg.y, 0); // arm points east, over Railway Colony Rd; signal faces south
    else signalPole(sg.x, sg.y, -Math.PI / 2);
  }
  // plastic tubs, crates and a tarp heap by the stalls
  const r = rng(77);
  // two-wheelers parked nose-in on the dusty shoulders, both sides, west and east of the junction
  for (let k = 0; k < 26; k++) {
    const s = k % 2 ? 1 : -1, x = -540 + r() * 85; if (Math.abs(x - hx) < 9 || (s === 1 && x > -492 && x < -486)) continue;
    const [px, py, i] = beside(x, s, asphHalf(nearestOnMain(x, hy)[1]) + 0.9 + r() * 1.2);
    addVehicle(r() < 0.55 ? 'scooter' : 'moto', px, py, heading(i) + s * (Math.PI / 2 + (r() - 0.5) * 0.5), TWO_COLS[Math.floor(r() * TWO_COLS.length)], 0.04);
  }
  // south side: totos and autos waiting in front of the shops, cycle-rickshaws, a small blue truck
  for (let k = 0; k < 5; k++) { const [px, py, i] = beside(-468 + k * 3.4, -1, asphHalf(nearestOnMain(-468 + k * 3.4, hy)[1]) - 0.8); addVehicle(k % 3 === 2 ? 'auto' : 'toto', px, py, heading(i) + (k % 2 ? 0 : Math.PI) + (r() - 0.5) * 0.2, k % 3 === 2 ? '#2f7d3a' : TOTO_COLS[k % TOTO_COLS.length], 0.06); }
  for (let k = 0; k < 3; k++) { const [px, py, i] = beside(-506 - k * 1.6, -1, 7.2); addVehicle('cyclerick', px, py, heading(i) + Math.PI / 2 + (r() - 0.5) * 0.3, '#fff', 0.04); }
  { const [px, py, i] = beside(-520, -1, 7.0); addVehicle('truck', px, py, heading(i), '#2c63b8', 0.04); }
  { const [px, py, i] = beside(-512, 1, 6.6); addVehicle('cyclerick', px, py, heading(i) + 0.2, '#fff', 0.04); }
  // big shade trees by the corners
  for (const [x, y, s, v] of [[-478, -52, 10, 'oak'], [-520, -88, 9, 'ash'], [-458, -55, 8, 'oak'], [-505, -58, 10, 'ash']]) EXTRA_TREES.push({ x, y, h: hAt(x, y), s, variant: v });
  // canopy over the sunken upper Railway Colony Rd (pano n6dev6yxA3mnQbD9EJ-sAw)
  for (const [x, y, s, v] of [[-509, 64, 11, 'oak'], [-495, 72, 10, 'ash'], [-510, 85, 12, 'oak'], [-496, 92, 10, 'oak'], [-509, 103, 11, 'ash'], [-493, 108, 10, 'oak']]) EXTRA_TREES.push({ x, y, h: hAt(x, y), s, variant: v });
}
const EXTRA_TREES = [];

// ---- traffic on Mother Teresa Rd (drive on the left), parked vehicles, field-side carts ----
function buildTraffic({ lanes = true } = {}) {
  const r = rng(5150);
  // lanes: false drops the vehicles frozen in the driving lanes (the game drives real ones); the rng still advances the same way so the parked vehicles stay where they were
  const put = lanes ? addVehicle : () => {};
  for (let i = 4; i < MAINP.length - 4; i += 1) {
    if (r() > 0.1) continue;
    const p = MAINP[i], x = p[0]; if (Math.abs(x - HAT.x) < 10) continue;
    const eastbound = r() < 0.5, s = eastbound ? 1 : -1, m = medHalf(x), a0 = m + 1.0, a1 = asphHalf(i) - 1.0; // eastbound keeps left = north half
    const lane = a0 + r() * Math.max(0, a1 - a0), px = p[0] + NRM[i][0] * s * lane, py = p[1] + NRM[i][1] * s * lane, a = heading(i) + (eastbound ? 0 : Math.PI);
    const roll = r();
    if (roll < 0.05) put('bus', px, py, a, r() < 0.5 ? '#e8b923' : '#f2f2ef');
    else if (roll < 0.2) put('toto', px, py, a, TOTO_COLS[Math.floor(r() * TOTO_COLS.length)]);
    else if (roll < 0.27) put('auto', px, py, a, '#2f7d3a');
    else if (roll < 0.45) put(r() < 0.6 ? 'scooter' : 'moto', px, py, a, TWO_COLS[Math.floor(r() * TWO_COLS.length)]);
    else if (roll < 0.5) put('truck', px, py, a, '#2c63b8');
    else put(roll < 0.62 ? 'suv' : roll < 0.8 ? 'hatch' : 'sedan', px, py, a, CAR_COLS[Math.floor(r() * CAR_COLS.length)]);
  }
  // a few cars and two-wheelers parked on the shoulders along the main road
  for (let i = 6; i < MAINP.length - 6; i += 3) {
    if (r() > 0.12 || Math.abs(MAINP[i][0] - HAT.x) < 45) continue;
    const s = r() < 0.5 ? 1 : -1; if (s === 1 && MAINP[i][0] > FIELD_X0 - 2 && MAINP[i][0] < 36) continue; // field frontage kept for the kiosks and carts
    const off = shoulderOff(s, i) + 1.1, p = MAINP[i], px = p[0] + NRM[i][0] * s * off, py = p[1] + NRM[i][1] * s * off;
    if (clsAt(px, py) === 2 || clsAt(px, py) === 3) continue;
    if (r() < 0.6) addVehicle(r() < 0.5 ? 'scooter' : 'moto', px, py, heading(i) + s * Math.PI / 2, TWO_COLS[Math.floor(r() * TWO_COLS.length)], 0.04);
    else addVehicle('hatch', p[0] + NRM[i][0] * s * (off + 0.4), p[1] + NRM[i][1] * s * (off + 0.4), heading(i) + (r() < 0.5 ? 0 : Math.PI), CAR_COLS[Math.floor(r() * CAR_COLS.length)], 0.04);
  }
  // a few cars parked along the wider lanes
  for (const rd of GEO.roads) { if (rd.w < 4.5 || r() > 0.25) continue; const P = resample(rd.p, 6); if (P.length < 3) continue; const k = 1 + Math.floor(r() * (P.length - 2)), a = P[k], b = P[k + 1] || P[k - 1], d = Math.atan2(b[1] - a[1], b[0] - a[0]), nn = [-Math.sin(d), Math.cos(d)], off = rd.w / 2 - 1.0;
    addVehicle(r() < 0.5 ? 'hatch' : 'sedan', a[0] + nn[0] * off, a[1] + nn[1] * off, d, CAR_COLS[Math.floor(r() * CAR_COLS.length)], 0.07); }
  // vendor carts on the shoulder (road_features.json)
  for (const c of RF.stalls.filter(c => c.kind === 'handcart')) { const s = c.side === 'N' ? 1 : -1, [, i] = nearestOnMain(c.x, MAINP.find(p => p[0] >= c.x)[1]); const [px, py] = beside(c.x, s, c.offset === 'forecourt' ? asphHalf(i) + 2.2 : hw(i) + 1.3); handcart(px, py, heading(i), c.color, false); }
}

// ---- concrete electric poles with cross-arms, transformers and the tangle of overhead wires seen on every street ----
function buildPoles() {
  const poles = [], spans = [], heavy = [], laneSp = [], lr = rng(505);
  for (const s of [1, -1]) {
    let last = null;
    for (let i = 3; i < MAINP.length; i += 14) {
      const off = shoulderOff(s, i) + (edgeKind(s, i) === 'kerb' ? 0.6 : 1.0), p = MAINP[i], x = p[0] + NRM[i][0] * s * off, y = p[1] + NRM[i][1] * s * off;
      if (Math.hypot(x - HAT.x, y - HAT.y) < 9) continue;
      const cur = { x, y, z: hAt(x, y), h: 9.5, main: true, i, s };
      poles.push(cur); if (last) { spans.push([last, cur, 4]); heavy.push([last, cur]); } last = cur;
    }
  }
  for (const rd of GEO.roads) {
    const P = resample(rd.p, 30); if (P.length < 2) continue; let last = null; const nn = normalsOf(P);
    for (let i = 0; i < P.length; i++) { const x = P[i][0] + nn[i][0] * (rd.w / 2 + 0.6), y = P[i][1] + nn[i][1] * (rd.w / 2 + 0.6); if (clsAt(x, y) === 2 || clsAt(x, y) === 3) { last = null; continue; } const near = poles.find(q => Math.hypot(q.x - x, q.y - y) < 14); if (near) { if (last && last !== near) spans.push([last, near, 3]); last = near; continue; } // reuse a pole close by (overlapping lane pieces)
      const cur = { x, y, z: hAt(x, y), h: 8 }; poles.push(cur); if (last) { spans.push([last, cur, 3 + Math.floor(lr() * 3)]); laneSp.push([last, cur]); } last = cur; }
  }
  // square-section prestressed concrete pole, tapering; galvanised cross-arm with white pin insulators
  const pg = new THREE.CylinderGeometry(0.1, 0.17, 1, 4, 1); pg.rotateY(Math.PI / 4); pg.translate(0, 0.5, 0);
  const pm = new THREE.InstancedMesh(pg, M.poleConcrete, poles.length); pm.name = 'poles';
  const am = new THREE.InstancedMesh(new THREE.BoxGeometry(1.7, 0.08, 0.08), std('#55595c', { metalness: 0.5, roughness: 0.5 }), poles.length * 2); am.name = 'pole_arms';
  const ins = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.035, 0.05, 0.16, 8), std('#e9e6dc', { roughness: 0.3 }), poles.length * 6); ins.name = 'pole_insulators';
  const dm = new THREE.Object3D(); let ai = 0, ii = 0;
  poles.forEach((p, k) => {
    const ang = p.main ? Math.atan2(NRM[p.i][1], NRM[p.i][0]) : (k * 1.7) % 3.14;
    dm.position.set(p.x, p.z, -p.y); dm.rotation.set(0, 0, 0); dm.scale.set(1, p.h, 1); dm.updateMatrix(); pm.setMatrixAt(k, dm.matrix);
    dm.scale.set(1, 1, 1);
    for (const dz of p.main ? [0.35, 1.25] : [0.35]) {
      dm.position.set(p.x, p.z + p.h - dz, -p.y); dm.rotation.set(0, ang + Math.PI / 2, 0); dm.updateMatrix(); am.setMatrixAt(ai++, dm.matrix);
      for (const d of [-0.7, 0, 0.7]) { const c = Math.cos(ang + Math.PI / 2), sn = Math.sin(ang + Math.PI / 2); dm.position.set(p.x + c * d, p.z + p.h - dz + 0.12, -(p.y + sn * d)); dm.rotation.set(0, 0, 0); dm.updateMatrix(); ins.setMatrixAt(ii++, dm.matrix); }
    }
  });
  am.count = ai; ins.count = ii;
  pm.castShadow = am.castShadow = true; scene.add(pm, am, ins);
  // transformers on H-frames (two poles, channel beams, a finned tank with bushings) beside some main-road poles
  const tr = [], beams = [], fins = [], ups = [];
  poles.filter(p => p.main).forEach((p, k) => {
    if (k % 7 !== 4) return;
    const t = [NRM[p.i][1], -NRM[p.i][0]], x2 = p.x + t[0] * 2.4, y2 = p.y + t[1] * 2.4, z2 = hAt(x2, y2);
    const q = pg.clone(); q.scale(1, 9, 1); q.translate(x2, z2, -y2); ups.push(q);
    const mx = (p.x + x2) / 2, my = (p.y + y2) / 2, ang = Math.atan2(t[1], t[0]), z = Math.max(p.z, z2);
    for (const bz of [3.4, 4.3]) { const b = new THREE.BoxGeometry(2.8, 0.1, 0.12); b.rotateY(ang); b.translate(mx, z + bz, -my); beams.push(b); }
    const tank = new THREE.BoxGeometry(1.0, 1.25, 0.8); tank.rotateY(ang); tank.translate(mx, z + 4.35 + 0.62, -my); tr.push(tank);
    for (let f = 0; f < 6; f++) { const fn = new THREE.BoxGeometry(0.04, 0.95, 0.95); fn.rotateY(ang); fn.translate(mx + Math.cos(ang) * (-0.4 + f * 0.16), z + 4.95, -(my + Math.sin(ang) * (-0.4 + f * 0.16))); fins.push(fn); }
    for (let f = 0; f < 3; f++) { const bu = new THREE.CylinderGeometry(0.05, 0.07, 0.35, 8); bu.translate(mx + Math.cos(ang) * (-0.3 + f * 0.3), z + 5.75, -(my + Math.sin(ang) * (-0.3 + f * 0.3))); tr.push(bu); }
    const fb = new THREE.BoxGeometry(0.5, 0.6, 0.25); fb.rotateY(ang); fb.translate(p.x, p.z + 1.6, -p.y); beams.push(fb);
  });
  mergeAdd(ups, M.poleConcrete, true); mergeAdd(beams, std('#4f5356', { metalness: 0.5 }), true); mergeAdd(tr.concat(fins), std('#6b7a74', { metalness: 0.4, roughness: 0.5 }), true);
  // street lights on the poles of the undivided stretch at Hatigarh (single arm reaching over the road)
  const lampGeo = [], heads = [], lampPoles = [];
  for (const l of RF.street_lights.filter(l => l.type === 'single_arm_pole')) {
    const s = l.side === 'N' ? 1 : -1, [, i] = nearestOnMain(l.x, MAINP.find(p => p[0] >= l.x)[1]), off = shoulderOff(s, i) + 0.9;
    const p = { x: MAINP[i][0] + NRM[i][0] * s * off, y: MAINP[i][1] + NRM[i][1] * s * off, h: 9 }; p.z = hAt(p.x, p.y);
    const q = pg.clone(); q.scale(1, p.h, 1); q.translate(p.x, p.z, -p.y); lampPoles.push(q);
    const ang = Math.atan2(-NRM[i][1] * s, -NRM[i][0] * s);
    const curve = new THREE.QuadraticBezierCurve3(new THREE.Vector3(0, p.h - 1.6, 0), new THREE.Vector3(0.4, p.h - 0.6, 0), new THREE.Vector3(2.2, p.h - 0.8, 0));
    const tube = new THREE.TubeGeometry(curve, 8, 0.04, 5); tube.rotateY(ang); tube.translate(p.x, p.z, -p.y); lampGeo.push(tube);
    const hd = new THREE.BoxGeometry(0.55, 0.12, 0.25); hd.translate(2.35, p.h - 0.85, 0); hd.rotateY(ang); hd.translate(p.x, p.z, -p.y); heads.push(hd);
  }
  mergeAdd(lampPoles, M.poleConcrete, true); mergeAdd(lampGeo, M.steel, true); mergeAdd(heads, std('#c9ccc8', { emissive: '#2a2618', roughness: 0.5 }), true);
  // overhead wires: thin lines everywhere, plus thick sagging cable bundles and coils on the main road
  const pos = [];
  for (const [a, b, wires] of spans) {
    for (let w = 0; w < wires; w++) {
      const dz = -0.3 - w * 0.3, ox = (w - wires / 2) * 0.45, L = Math.hypot(b.x - a.x, b.y - a.y), sag = 0.25 + L * 0.012 + w * 0.05;
      let prev = null;
      for (let k = 0; k <= 8; k++) { const t = k / 8, x = a.x + (b.x - a.x) * t + ox, y = a.y + (b.y - a.y) * t, z = a.z + a.h + (b.z + b.h - a.z - a.h) * t + dz - sag * 4 * t * (1 - t);
        if (prev) pos.push(prev[0], prev[1], prev[2], x, z, -y); prev = [x, z, -y]; }
    }
  }
  const lg = new THREE.BufferGeometry(); lg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  scene.add(new THREE.LineSegments(lg, new THREE.LineBasicMaterial({ color: '#1c1c1c', transparent: true, opacity: 0.8 })));
  const cables = [], r = rng(404);
  for (const [a, b] of heavy) for (let w = 0; w < 3; w++) {
    const L = Math.hypot(b.x - a.x, b.y - a.y), sag = 0.6 + L * 0.02 + r() * 0.6, h0 = a.h - 2.2 - w * 0.25, h1 = b.h - 2.2 - w * 0.25, oz = (w - 1) * 0.12;
    const pts = []; for (let k = 0; k <= 10; k++) { const t = k / 10; pts.push(new THREE.Vector3(a.x + (b.x - a.x) * t + oz, a.z + h0 + (b.z + h1 - a.z - h0) * t - sag * 4 * t * (1 - t), -(a.y + (b.y - a.y) * t))); }
    cables.push(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 12, 0.018 + r() * 0.012, 4));
  }
  for (const p of poles.filter(p => p.main)) if (r() < 0.45) { const c = new THREE.TorusGeometry(0.28 + r() * 0.15, 0.04, 5, 16); c.rotateY(r() * 3); c.translate(p.x + 0.2, p.z + p.h - 2.8 - r(), -p.y); cables.push(c); }
  // lane poles carry the same tangle: two heavy sagging bundles per span (the thin lines above give 3-5 more) and a coil of slack cable on every 4th pole
  for (const [a, b] of laneSp) for (let w = 0; w < 2; w++) {
    const L = Math.hypot(b.x - a.x, b.y - a.y), sag = 0.5 + L * 0.025 + r() * 0.7, h0 = a.h - 1.2 - w * 0.35, h1 = b.h - 1.2 - w * 0.35, oz = (w - 0.5) * 0.3;
    const pts = []; for (let k = 0; k <= 10; k++) { const t = k / 10; pts.push(new THREE.Vector3(a.x + (b.x - a.x) * t + oz, a.z + h0 + (b.z + h1 - a.z - h0) * t - sag * 4 * t * (1 - t), -(a.y + (b.y - a.y) * t))); }
    cables.push(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 12, 0.014 + r() * 0.01, 4));
  }
  poles.filter(p => !p.main).forEach((p, k) => { if (k % 4 === 0) { const c = new THREE.TorusGeometry(0.22 + r() * 0.12, 0.035, 5, 14); c.rotateY(r() * 3); c.translate(p.x + 0.15, p.z + p.h - 2.0 - r() * 0.8, -p.y); cables.push(c); } });
  mergeAdd(cables, std('#121212', { roughness: 0.7 }), true);
  // the high-mast light by the field (position approximate)
  const HM = RF.high_mast, [hx, hy] = beside(HM.x, HM.side === 'N' ? 1 : -1, hw(nearestOnMain(HM.x, -56)[1]) + 6.5); highMast(hx, hy); // inside the field, behind the frontage wall (about 3.95 m beyond the right of way); the exact spot is estimated
}

export { buildHatigarh, buildTraffic, buildPoles, EXTRA_TREES, beside };
