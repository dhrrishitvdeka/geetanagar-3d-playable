import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { camera, scene } from '../core/context.js';
import { GEO, pointInPoly } from '../core/geo.js';
import { findOpen, walkable } from '../ui/controls.js';
import { addSeat } from './seats.js';
import { mergeStatic } from '../render/staticmerge.js';
import { DECK, groundAt } from '../world/deck.js';
import { MAINP, NRM, RF, asphHalf, hw, nearestOnMain } from '../world/mainroad.js';
import { canvasTex } from '../world/materials.js';
import { GATE, TANK } from '../world/park.js';
import { baked } from '../world/road/vehicles.js';
import { beside } from '../world/streetlife.js';
import { emit, on } from './core/bus.js';
import { addItem, addMoney, getFlag, isCollected, itemCount, markCollected, removeItem, setFlag, spend, state } from './core/state.js';
import { sfx } from './audio.js';
import { bigMessage, fade, flash, showDialogue, toast } from './hud.js';
import { register, unregister } from './interact.js';
import { openShop } from './items.js';
import { addMarker, removeMarker } from './map.js';
import { addBuff, getCameraMode, getPlayer, mountVehicle, playEmote, setCameraMode, setInputLocked, setSeated, teleport } from './player.js';
import { PLACES } from './content/places.js';

// ---------- shared helpers ----------
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const rnd = (a, b) => a + Math.random() * (b - a);
const pick = a => a[Math.floor(Math.random() * a.length)];
const open = (x, y) => (walkable(x, y) ? [x, y] : findOpen(x, y));
const dummy = new THREE.Object3D(), tmpC = new THREE.Color(), tmpV = new THREE.Vector3(), tmpAx = new THREE.Vector3(), tmpQ = new THREE.Quaternion();
const ER = new THREE.Euler(), MX = new THREE.Matrix4(), FWD = new THREE.Vector3();
let T = 0, inited = false;
const failed = new Set();
function run(name, fn, a, b) { try { fn(a, b); } catch (err) { if (!failed.has(name)) { failed.add(name); console.error(`[worldobjects] ${name} failed`, err); } } }

const roadHeading = i => { const a = MAINP[Math.max(0, i - 1)], b = MAINP[Math.min(MAINP.length - 1, i + 1)]; return Math.atan2(b[1] - a[1], b[0] - a[0]); };
// a point beside Mother Teresa Rd: side +1 north / -1 south, `extra` metres past the asphalt edge; h = road heading (east = 0)
function onMain(x, side, extra) {
  const t = MAINP.find(p => p[0] >= x) || MAINP[MAINP.length - 1], [, i] = nearestOnMain(x, t[1]);
  const [px, py] = beside(x, side, asphHalf(i) + extra);
  return { x: px, y: py, h: roadHeading(i), i };
}
function toRoad(x, y) { // map angle from (x, y) to the nearest lane or main-road sample, so benches and pumps face the street
  let bd = 1e18, bx = x, by = y;
  const look = p => { const d = (p[0] - x) ** 2 + (p[1] - y) ** 2; if (d < bd) { bd = d; bx = p[0]; by = p[1]; } };
  for (const r of GEO.roads) for (const p of r.p) look(p);
  for (const p of MAINP) look(p);
  return Math.atan2(by - y, bx - x);
}
// register a spot with a standard shape; z is absolute height
function spot(id, x, y, label, onInteract, o = {}) { return register({ id, x, y, z: o.z ?? groundAt(x, y), r: 2.4, label, onInteract, ...o }); }

// ---------- procedural pieces: geometry in a local frame (+x forward, +y up, +z right), vertex colours, merged per prop ----------
const BOX = (w, h, d) => new THREE.BoxGeometry(w, h, d), CYL = (a, b, h, n = 10) => new THREE.CylinderGeometry(a, b, h, n), SPH = (r, n = 8) => new THREE.SphereGeometry(r, n, Math.max(4, n >> 1));
function piece(geo, col, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) {
  let g = geo; if (geo.index) { g = geo.toNonIndexed(); geo.dispose(); }
  if (rx || ry || rz) g.applyMatrix4(MX.makeRotationFromEuler(ER.set(rx, ry, rz)));
  g.translate(x, y, z);
  if (col) {
    tmpC.set(col); const n = g.attributes.position.count, a = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { a[i * 3] = tmpC.r; a[i * 3 + 1] = tmpC.g; a[i * 3 + 2] = tmpC.b; }
    g.setAttribute('color', new THREE.BufferAttribute(a, 3));
  }
  return g;
}
// a sign cell from the 2 x 2 atlas (see signTex), a plane facing local +x
function sign(cell, w, h, x, y, z) {
  const g = new THREE.PlaneGeometry(w, h), uv = g.attributes.uv, c = cell % 2, r = cell >> 1;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, c * 0.5 + uv.getX(i) * 0.5, 0.5 - r * 0.5 + uv.getY(i) * 0.5);
  return piece(g, null, x, y, z, 0, Math.PI / 2, 0);
}
const PROPS = new THREE.Group(); // static props: built as meshes, merged per material and cell by mergeStatic, then added to the scene
let MAT_SOLID, MAT_GLOW, MAT_SIGN;
function addProp(parts, mat, x, y, h, o = {}) {
  if (!parts.length) return null;
  const geo = mergeGeometries(parts, false); for (const p of parts) p.dispose();
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, o.z ?? groundAt(x, y), -y); m.rotation.y = h; m.castShadow = o.cast !== false; m.receiveShadow = true;
  PROPS.add(m); return m;
}
function signTex() {
  return canvasTex(1024, 512, (g, w, h) => {
    const cell = (c, r, bg, draw) => { g.save(); g.translate(c * 512, r * 256); g.fillStyle = bg; g.fillRect(0, 0, 512, 256); g.strokeStyle = 'rgba(255,255,255,0.85)'; g.lineWidth = 8; g.strokeRect(10, 10, 492, 236); g.textAlign = 'center'; g.textBaseline = 'middle'; draw(); g.restore(); };
    cell(0, 0, '#1d5fa8', () => { g.fillStyle = '#fff'; g.font = 'bold 120px Arial, sans-serif'; g.fillText('ATM', 256, 104); g.font = 'bold 34px Arial, sans-serif'; g.fillText('CASH  24 HRS', 256, 195); });
    cell(1, 0, '#f2c12e', () => { g.fillStyle = '#1b1b1b'; g.font = 'bold 76px Arial, sans-serif'; g.fillText('SCOOTY RENT', 256, 88); g.fillStyle = '#b3261e'; g.font = 'bold 58px Arial, sans-serif'; g.fillText('Rs 30 a ride', 256, 168); });
    cell(0, 1, '#2f7d3a', () => { g.fillStyle = '#fff'; g.font = 'bold 84px Arial, sans-serif'; g.fillText('TOTO STAND', 256, 96); g.font = 'bold 40px Arial, sans-serif'; g.fillText('Hill and town  Rs 20-40', 256, 182); });
    cell(1, 1, '#a9814f', () => {
      g.fillStyle = '#3a2a16'; g.font = 'bold 50px Arial, sans-serif'; g.fillText('PARCEL JOBS', 256, 52);
      const cols = ['#f5f0dc', '#f7e9a0', '#e9f0f5'];
      for (let i = 0; i < 6; i++) { g.save(); g.translate(60 + i * 78 + (i % 2) * 8, 150 + (i % 3) * 8); g.rotate((i - 2.5) * 0.05); g.fillStyle = cols[i % 3]; g.fillRect(-30, -52, 62, 100); g.fillStyle = '#7a6a50'; for (let k = 0; k < 5; k++) g.fillRect(-22, -40 + k * 16, 46 - (k % 2) * 14, 4); g.fillStyle = '#b3261e'; g.beginPath(); g.arc(0, -52, 5, 0, 7); g.fill(); g.restore(); }
    });
  }, false);
}

function benchParts() {
  const W1 = '#8b5a2f', W2 = '#7a4c28', I = '#26292c', a = [];
  for (let k = -1; k <= 1; k++) a.push(piece(BOX(0.15, 0.04, 1.6), k ? W1 : W2, 0.06 + k * 0.17, 0.45, 0));
  a.push(piece(BOX(0.04, 0.13, 1.6), W1, -0.26, 0.64, 0, 0, 0, -0.12), piece(BOX(0.04, 0.13, 1.6), W2, -0.29, 0.82, 0, 0, 0, -0.12));
  for (const z of [-0.72, 0.72]) a.push(piece(BOX(0.05, 0.45, 0.05), I, 0.26, 0.225, z), piece(BOX(0.05, 0.9, 0.05), I, -0.24, 0.45, z), piece(BOX(0.46, 0.04, 0.05), I, 0.02, 0.66, z));
  return a;
}
function pumpParts() {
  const G = '#2c5f78', a = [];
  a.push(piece(CYL(0.24, 0.28, 0.14, 12), '#a9a498', 0, 0.07, 0), piece(CYL(0.08, 0.1, 1.0, 10), G, 0, 0.64, 0), piece(BOX(0.34, 0.2, 0.16), G, 0.04, 1.08, 0));
  a.push(piece(CYL(0.035, 0.035, 0.3, 8), G, 0.24, 0.98, 0, 0, 0, Math.PI / 2), piece(CYL(0.42, 0.42, 0.02, 14), '#59615e', 0.5, 0.012, 0), piece(CYL(0.03, 0.03, 0.12, 6), '#1f2326', -0.02, 1.2, 0, Math.PI / 2, 0, 0));
  return a;
}
function lampParts() { // a stone stand with a brass lamp: the prayer spot at a namghar
  return { solid: [piece(BOX(0.5, 0.75, 0.5), '#bdb6a6', 0, 0.375, 0), piece(BOX(0.62, 0.06, 0.62), '#a9a498', 0, 0.78, 0), piece(CYL(0.14, 0.1, 0.08, 10), '#b8892b', 0, 0.85, 0)], glow: [piece(SPH(0.05, 6), '#ffb347', 0, 0.94, 0)] };
}
function frameParts() { // temple bell frame: two posts and a beam along local z; the bell itself is a separate moving mesh
  const a = []; for (const z of [-0.95, 0.95]) a.push(piece(BOX(0.16, 2.6, 0.16), '#6b3f22', 0, 1.3, z), piece(BOX(0.5, 0.1, 0.4), '#a9a498', 0, 0.05, z));
  a.push(piece(BOX(0.18, 0.16, 2.1), '#6b3f22', 0, 2.62, 0), piece(BOX(0.5, 0.06, 0.3), '#b8892b', 0, 2.72, 0));
  return a;
}
function binocularParts() {
  const a = [piece(CYL(0.2, 0.22, 0.05, 10), '#3b3f44', 0, 0.025, 0), piece(CYL(0.035, 0.04, 1.3, 8), '#555a5f', 0, 0.68, 0), piece(BOX(0.12, 0.1, 0.14), '#c9a03a', -0.08, 1.0, 0)];
  for (const z of [-0.07, 0.07]) a.push(piece(CYL(0.06, 0.07, 0.36, 10), '#1e2f4a', 0.12, 1.4, z, 0, 0, Math.PI / 2), piece(CYL(0.04, 0.04, 0.08, 8), '#111', -0.1, 1.4, z, 0, 0, Math.PI / 2), piece(CYL(0.075, 0.075, 0.04, 10), '#111', 0.3, 1.4, z, 0, 0, Math.PI / 2));
  a.push(piece(BOX(0.1, 0.05, 0.16), '#1e2f4a', 0.05, 1.4, 0), piece(BOX(0.08, 0.2, 0.08), '#555a5f', 0.0, 1.3, 0));
  return a;
}
function boardParts(w, h = 0.75, baseY = 1.25) { // a signboard on two posts, front toward local +x
  const a = []; for (const z of [-(w / 2 - 0.08), w / 2 - 0.08]) a.push(piece(BOX(0.1, baseY + h / 2 + 0.3, 0.1), '#6b4a2a', 0, (baseY + h / 2 + 0.3) / 2, z));
  a.push(piece(BOX(0.06, h + 0.1, w), '#4a3520', -0.02, baseY + h / 2, 0)); // the printed face is a sign plane, added through signAt
  return a;
}
function atmParts() {
  const solid = [piece(BOX(1.9, 0.12, 1.9), '#9a968c', 0, 0.06, 0), piece(BOX(1.5, 2.4, 1.5), '#d9dde0', 0, 1.2, 0), piece(BOX(1.52, 0.45, 1.52), '#1d5fa8', 0, 2.05, 0), piece(BOX(1.8, 0.08, 1.8), '#8a9096', 0, 2.44, 0),
    piece(BOX(0.04, 1.8, 0.7), '#2b4558', 0.76, 1.05, -0.4), piece(BOX(0.14, 0.05, 0.34), '#3a3f44', 0.82, 1.05, 0.42), piece(BOX(0.06, 0.5, 0.5), '#3a3f44', 0.78, 1.25, 0.42)];
  return { solid, glow: [piece(BOX(0.03, 0.3, 0.4), '#7fe0ff', 0.8, 1.36, 0.42)], sign: [sign(0, 1.0, 0.5, 0.77, 2.05, 0)] };
}

// ---------- static props: benches, pumps, ATMs, signs, bell frame, binocular stand, prayer lamps ----------
const BENCHES = [], PUMPS = [], PUMP_SPOTS = [[-58.8, -40.9], [-165.2, 90.5], [133.1, 139.0], [-460.8, 134.8]];
let handles = null;
function bench(id, x, y, h) {
  [x, y] = open(x, y); const z = groundAt(x, y);
  addProp(benchParts(), MAT_SOLID, x, y, h, { z });
  const seat = { x, y, z, heading: h }; // z is where the feet go: the sit pose itself lifts the hips to seat height
  BENCHES.push(addSeat(seat));
  spot(`bench:${id}`, x, y, () => (getPlayer().seated ? 'Stand up' : 'Sit down'), () => { const p = getPlayer(); if (p.seated) setSeated(null); else { setSeated(seat); } }, { r: 1.5, z });
}
function buildBenches() {
  bench('terrace1', 75, 197.2, -Math.PI / 2); bench('terrace2', 81, 197.2, -Math.PI / 2);
  bench('park1', -129.5, -99.4, Math.PI / 2); bench('park2', -124.1, -94.2, Math.PI); bench('park3', -110, -104, Math.PI / 2);
  bench('field1', -30, -39.8, Math.PI / 2); bench('field2', -53, -21, 0);
  bench('lane1', -117.2, 60.1, toRoad(-117.2, 60.1)); bench('lane2', -103, 126.2, toRoad(-103, 126.2));
  // inside the bus shelter: bench at local x = -0.9, facing the road
  const b = onMain(RF.bus_stops[0].x, -1, 3.4), oh = b.h + Math.PI / 2, bx = b.x - Math.cos(oh) * 0.9, by = b.y - Math.sin(oh) * 0.9, z = groundAt(bx, by);
  const seat = { x: bx, y: by, z, heading: oh }; BENCHES.push(addSeat(seat));
  spot('bench:shelter', bx, by, () => (getPlayer().seated ? 'Stand up' : 'Sit down'), () => { if (getPlayer().seated) setSeated(null); else setSeated(seat); }, { r: 1.5, z });
}
// ---------- plastic chairs: put down on demand under people who sit where there is no bench (npc/agents.js) ----------
const CHAIR_CAP = 24; let chairMesh = null, chairN = 0;
function chairParts() { // a moulded plastic chair; the origin is where the hips go, the seat top is 0.44 up, the back toward local -x
  const C = '#e8e4da', a = [piece(BOX(0.42, 0.035, 0.44), C, 0, 0.425, 0), piece(BOX(0.035, 0.42, 0.42), C, -0.22, 0.66, 0, 0, 0, 0.12)];
  for (const x of [-0.18, 0.19]) for (const z of [-0.19, 0.19]) a.push(piece(BOX(0.035, 0.42, 0.035), C, x, 0.21, z));
  for (const z of [-0.21, 0.21]) a.push(piece(BOX(0.3, 0.03, 0.035), C, -0.04, 0.62, z)); // arm rests
  return a;
}
function buildChairs() {
  const parts = chairParts(), g = mergeGeometries(parts, false); for (const p of parts) p.dispose();
  chairMesh = new THREE.InstancedMesh(g, MAT_SOLID, CHAIR_CAP); chairMesh.count = 0; chairMesh.castShadow = chairMesh.receiveShadow = true; chairMesh.name = 'chairs';
  chairMesh.frustumCulled = false; chairMesh.userData.noMerge = true; scene.add(chairMesh);
}
// a chair at (x, y) facing map angle h, registered as a one-person seat; null when there is no room left (or before init)
function placeChair(x, y, h) {
  if (!chairMesh || chairN >= CHAIR_CAP) return null;
  const z = groundAt(x, y); dummy.position.set(x, z, -y); dummy.rotation.set(0, h, 0); dummy.scale.set(1, 1, 1); dummy.updateMatrix();
  chairMesh.setMatrixAt(chairN++, dummy.matrix); chairMesh.count = chairN; chairMesh.instanceMatrix.needsUpdate = true;
  return addSeat({ x, y, z, heading: h, h: 0.44, single: true });
}
function buildPumps() {
  for (let i = 0; i < PUMP_SPOTS.length; i++) {
    let [x, y] = open(PUMP_SPOTS[i][0], PUMP_SPOTS[i][1]); const h = toRoad(x, y) + rnd(-0.4, 0.4), z = groundAt(x, y);
    addProp(pumpParts(), MAT_SOLID, x, y, h, { z });
    const P = { x, y, z, h, t: 99 }; PUMPS.push(P);
    spot(`pump:${i}`, x, y, 'Pump some water', () => { P.t = 0; sfx('splash', { x, y }); state.stamina = 1; toast('Cool tube-well water. You feel refreshed.', { kind: 'good' }); }, { r: 1.9, z });
  }
  // one InstancedMesh for the handles (the only moving part); pivot at the head of the pump
  const geo = BOX(0.9, 0.04, 0.05); geo.translate(-0.42, 0, 0);
  handles = new THREE.InstancedMesh(geo, new THREE.MeshStandardMaterial({ color: '#1f2326', roughness: 0.5, metalness: 0.6 }), PUMPS.length); handles.name = 'pump_handles';
  handles.frustumCulled = false; handles.userData.noMerge = true; scene.add(handles);
  PUMPS.forEach((P, i) => setHandle(i, -0.45));
}
function setHandle(i, ang) {
  const P = PUMPS[i]; dummy.position.set(P.x, P.z + 1.2, -P.y); dummy.rotation.set(0, P.h, ang); dummy.scale.set(1, 1, 1); dummy.updateMatrix();
  handles.setMatrixAt(i, dummy.matrix); handles.instanceMatrix.needsUpdate = true;
}
function updatePumps(dt) {
  for (let i = 0; i < PUMPS.length; i++) {
    const P = PUMPS[i]; if (P.t > 1.4) continue;
    P.t += dt; const k = P.t / 1.4;
    setHandle(i, k >= 1 ? -0.45 : -0.45 + 0.7 * Math.abs(Math.sin(k * Math.PI * 3)) * (1 - k * 0.4));
  }
}

// ---------- ATMs ----------
function buildATMs() {
  for (const [id, x, y, h] of [['sbi_main', -340, -78.6, Math.PI / 2], ['sbi_branch', 164.4, -172.0, 0]]) {
    const p = atmParts(), z = groundAt(x, y);
    addProp(p.solid, MAT_SOLID, x, y, h, { z }); addProp(p.glow, MAT_GLOW, x, y, h, { z, cast: false }); addProp(p.sign, MAT_SIGN, x, y, h, { z, cast: false });
    spot(`atm:${id}`, x + Math.cos(h) * 1.9, y + Math.sin(h) * 1.9, 'Use the ATM', () => {
      const key = `atm_${state.day}`;
      if (getFlag(key)) { toast('Daily limit reached. Try again tomorrow.', { kind: 'warn' }); sfx('error'); return; }
      setFlag(key, true); addMoney(100, 'ATM'); sfx('coin'); toast('You withdrew Rs 100.', { kind: 'good' });
    }, { r: 2.2, z });
  }
}

// ---------- shops: counters at the stalls (the shopkeepers themselves are NPCs from the content unit) ----------
function kioskFront(kx) { // same placement as buildKiosks in world/shops.js; the counter faces the road
  const [, i] = nearestOnMain(kx, -50), p = MAINP[i], n = NRM[i], side = n[1] > 0 ? 1 : -1, off = hw(i) + 1.6;
  const x = p[0] + n[0] * side * off, y = p[1] + n[1] * side * off, ang = Math.atan2(-n[0] * side, n[1] * side);
  return { x, y, ang, fx: x + Math.sin(ang) * 1.7, fy: y - Math.cos(ang) * 1.7, i };
}
function buildShops() {
  const shop = (id, label, x, y, r = 2.5) => spot(`shop:${id}`, x, y, label, () => openShop(id), { r, kind: 'shop' });
  const tea = onMain(-121, -1, 2.0); shop('tea_stall', 'Buy from Bina Baideu', tea.x, tea.y, 3.0);
  const pt = kioskFront(24), st = kioskFront(31), sn = kioskFront(-44), fr = kioskFront(-37);
  shop('pan_tea', 'Buy from Khagen Da', pt.fx, pt.fy); shop('store', 'Buy from Mamoni', st.fx, st.fy); shop('snacks', 'Buy from Rupa Khuri', sn.fx, sn.fy); shop('fruits', 'Buy from Hari', fr.fx, fr.fy);
  const cx = c => { const [, i] = nearestOnMain(c, (MAINP.find(p => p[0] >= c) || MAINP[MAINP.length - 1])[1]); return beside(c, 1, hw(i) + 1.3); };
  const c1 = cx(36), c2 = cx(39.5); shop('flower_cart', 'Buy from Jonali', (c1[0] + c2[0]) / 2, (c1[1] + c2[1]) / 2 - 1.2, 3.4);
  shop('hatigarh_kiosk', 'Buy from the kiosk', -501 + Math.cos(-Math.PI / 4) * 1.6, -61.6 + Math.sin(-Math.PI / 4) * 1.6, 2.6);
  shop('sweets', 'Buy from the sweet stall', RF.stalls[0].x0 - 1.5, RF.stalls[0].y0, 2.4);
}

// ---------- scooters: one vertex-coloured mesh each ----------
let SCOOTER_MAT = null;
function scooterGroup(color) {
  const parts = [];
  for (const [m, geo] of baked('scooter')) {
    const g = geo.clone(), n = g.attributes.position.count, a = new Float32Array(n * 3), c = m.userData.tint ? tmpC.set(color) : m.color;
    for (let i = 0; i < n; i++) { a[i * 3] = c.r; a[i * 3 + 1] = c.g; a[i * 3 + 2] = c.b; }
    g.setAttribute('color', new THREE.BufferAttribute(a, 3)); parts.push(g);
  }
  const mesh = new THREE.Mesh(mergeGeometries(parts, false), SCOOTER_MAT); mesh.castShadow = true; mesh.userData.noMerge = true;
  const grp = new THREE.Group(); grp.add(mesh); grp.userData.noMerge = true; return grp;
}
const SCOOTERS = []; let unlocked = false;
function addScooter(id, x, y, heading, color, owner) {
  [x, y] = open(x, y);
  // park it so it can ride off forwards: if the nose is against a wall and the tail is clear, turn it round
  const clear = d => walkable(x + Math.cos(heading) * d, y + Math.sin(heading) * d);
  if (!clear(1.2) && clear(-1.2)) heading += Math.PI;
  const mesh = scooterGroup(color), S = { id, x, y, heading, mesh, owner, riding: false, handle: null };
  mesh.position.set(x, groundAt(x, y), -y); mesh.rotation.y = heading; scene.add(mesh);
  const paid = () => getFlag(`rent_${id}`) === state.day;
  const mount = () => {
    if (getPlayer().seated) setSeated(null);
    S.riding = true;
    mountVehicle({ mesh, kind: 'scooter', x: S.x, y: S.y, heading: S.heading, maxSpeed: 12, onDismount: v => {
      S.riding = false; if (v && typeof v.x === 'number') { S.x = v.x; S.y = v.y; if (typeof v.heading === 'number') S.heading = v.heading; }
      mesh.position.set(S.x, groundAt(S.x, S.y), -S.y); mesh.rotation.y = S.heading; S.handle.set({ x: S.x, y: S.y, z: groundAt(S.x, S.y) });
    } });
  };
  const label = owner === 'rent' ? () => (paid() ? 'Ride the rented scooter' : 'Rent a scooter (Rs 30)') : () => (unlocked ? 'Ride Khagen Da\'s scooter' : 'Khagen Da\'s scooter');
  const act = owner === 'rent'
    ? () => { if (!paid()) { if (!spend(30)) { toast('Not enough money for the rental (Rs 30).', { kind: 'warn' }); return; } setFlag(`rent_${id}`, state.day); toast('Rented for the day. Ride safe.', { kind: 'good' }); } mount(); }
    : () => { if (!unlocked) { toast('That is Khagen Da\'s scooter. Ask him if you can borrow it.', { kind: 'info' }); return; } mount(); };
  S.handle = spot(`scooter:${id}`, x, y, label, act, { r: 2.0, z: groundAt(x, y), enabled: () => !S.riding, priority: owner === 'rent' ? 1 : 0 }); // someone else's scooter never outranks a person
  SCOOTERS.push(S); return S;
}
function buildScooters() {
  SCOOTER_MAT = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.5, metalness: 0.3 });
  const a = onMain(-482, 1, 3.8), b = onMain(-479.2, 1, 3.8), s = onMain(-480.6, 1, 5.9);
  addScooter('rent1', a.x, a.y, a.h, '#d6402c', 'rent'); addScooter('rent2', b.x, b.y, b.h, '#2a6fbd', 'rent');
  addProp(boardParts(1.5, 0.6, 1.1), MAT_SOLID, s.x, s.y, s.h - Math.PI / 2);
  signAt.push([1, 1.5, 0.6, 1.1, s.x, s.y, s.h - Math.PI / 2]);
  // Khagen Da's scooter, parked on the far side of his kiosk (the field kiosk at x 24) from where he stands, so his prompt and the scooter's don't fight
  const k = kioskFront(24), rh = roadHeading(k.i);
  addScooter('khagen', k.x - Math.cos(rh) * 3.5, k.y - Math.sin(rh) * 3.5, rh, '#2f8f4e', 'khagen');
}
function setScooterUnlocked(on) { unlocked = !!on; setFlag('scooter_unlocked', unlocked); }

// ---------- fast travel: the bus shelter and the toto stand ----------
let travelling = false;
const lookH = (x, y, tx, ty) => Math.atan2(ty - y, tx - x);
let STOPS = null;
function stops() {
  if (STOPS) return STOPS;
  const mk = (id, name, x, y, h) => ({ id, name, x, y, h });
  const hat = onMain(-470, -1, 2.4), park = onMain(-116, -1, 2.0), east = onMain(250, -1, 2.4);
  STOPS = {
    bus: [mk('hatigarh', 'Hatigarh Chariali', hat.x, hat.y, lookH(hat.x, hat.y, -492, -52)), mk('park', 'Children\'s Park', park.x, park.y, lookH(park.x, park.y, GATE.x, -90)),
      mk('field', 'Geetanagar Field', -20, -38.5, Math.PI / 2), mk('mandir', 'Mandir gate', 49.5, -44.5, Math.PI / 2), mk('east', 'Chinaki Path (east end)', east.x, east.y, east.h)],
    hill: [mk('viewpoint', 'View point', 78, 201.2, -Math.PI / 2), mk('fss', 'Faculty School', 111, 216, lookH(111, 216, 119.2, 241.2)),
      mk('sbi', 'SBI Branch', 154.9, -164.2, lookH(154.9, -164.2, 168.9, -172.2)), mk('kanya', 'Kanya Mahavidyalaya', -78.8, 89, lookH(-78.8, 89, -78.9, 83.6))],
  };
  return STOPS;
}
async function travel(d, fare, verb) {
  if (travelling) return;
  travelling = true; let moved = false, faded = false;
  try {
    if (!spend(fare)) { toast('Not enough money.', { kind: 'warn' }); return; }
    try {
      if (getPlayer().seated) setSeated(null);
      setInputLocked(true); faded = true; await fade(true, 450);
      const [x, y] = open(d.x, d.y); teleport(x, y, d.h); moved = true;
    } finally {
      if (!moved) addMoney(fare, 'refund'); // never take the fare without moving the player
      if (faded) { try { await fade(false, 450); } catch (err) { /* overlay already gone */ } }
      setInputLocked(false);
    }
    if (moved) toast(`${verb} ${d.name}.`, { kind: 'info' });
  } finally { travelling = false; }
}
async function travelMenu(kind) {
  if (travelling) return;
  const p = getPlayer(), S = stops(), toto = kind === 'toto';
  const list = (toto ? S.bus.concat(S.hill) : S.bus).filter(d => Math.hypot(d.x - p.x, d.y - p.y) > 40);
  const fareOf = d => (toto ? clamp(Math.round((20 + 20 * Math.min(1, Math.hypot(d.x + 462, d.y + 80) / 650)) / 5) * 5, 20, 40) : 10);
  const choices = list.map(d => ({ text: `${d.name} (Rs ${fareOf(d)})`, value: d.id, disabled: state.money < fareOf(d) }));
  choices.push({ text: 'Never mind', value: null });
  const id = await showDialogue({ speaker: toto ? 'Toto driver' : 'Bus stand', role: toto ? 'Hatigarh toto stand' : 'Geetanagar bus stop', text: toto ? 'Where to? I can take you up the hill too.' : 'The bus is coming. Where are you headed?', choices });
  if (id == null) return; // closed, or "never mind"
  const d = list.find(q => q.id === id); if (d) await travel(d, fareOf(d), toto ? 'The toto drops you at' : 'The bus drops you at');
}
function buildTravel() {
  const b = onMain(RF.bus_stops[0].x, -1, 3.4), oh = b.h + Math.PI / 2;
  spot('travel:bus', b.x + Math.cos(oh) * 0.5, b.y + Math.sin(oh) * 0.5, 'Wait for the bus (Rs 10)', () => travelMenu('bus'), { r: 2.4, kind: 'travel', priority: 1 });
  const t = onMain(-462, -1, 2.0), th = t.h + Math.PI / 2;
  addProp(boardParts(1.4, 0.6, 1.3), MAT_SOLID, t.x, t.y, th);
  spot('travel:toto', t.x, t.y, 'Hire a toto', () => travelMenu('toto'), { r: 2.6, kind: 'travel', priority: 0 }); // Raju waits a few metres east; people win ties
  signAt.push([2, 1.4, 0.6, 1.3, t.x, t.y, th]);
}
const signAt = []; // sign planes need the sign material, added after the boards: [cell, w, h, baseY, x, y, heading]

// ---------- world markers: a bobbing diamond and a tall faint beam; never cast shadows ----------
const MARK = new Map();
let diaGeo = null, beamGeo = null;
function setWorldMarker(id, o = {}) {
  if (!o || typeof o.x !== 'number' || typeof o.y !== 'number') return;
  if (!diaGeo) { diaGeo = new THREE.OctahedronGeometry(0.5, 0); diaGeo.scale(1, 1.5, 1); beamGeo = new THREE.CylinderGeometry(0.22, 0.22, 160, 10, 1, true); beamGeo.translate(0, 80, 0); }
  let m = MARK.get(id);
  if (!m) {
    const dia = new THREE.Mesh(diaGeo, new THREE.MeshStandardMaterial({ color: '#ffffff', emissive: '#ffcc33', emissiveIntensity: 1.7, roughness: 0.3, fog: false }));
    const beam = new THREE.Mesh(beamGeo, new THREE.MeshBasicMaterial({ color: '#ffcc33', transparent: true, opacity: 0.16, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false }));
    for (const q of [dia, beam]) { q.userData.noMerge = true; q.castShadow = false; q.receiveShadow = false; q.frustumCulled = false; scene.add(q); }
    m = { dia, beam, x: 0, y: 0, z: 0 }; MARK.set(id, m);
  }
  const col = o.color || '#ffcc33'; m.dia.material.emissive.set(col); m.dia.material.color.set(col); m.beam.material.color.set(col);
  m.x = o.x; m.y = o.y; m.z = o.z != null ? o.z : groundAt(o.x, o.y);
  m.beam.position.set(m.x, m.z, -m.y);
}
function clearWorldMarker(id) {
  const m = MARK.get(id); if (!m) return;
  for (const q of [m.dia, m.beam]) { scene.remove(q); q.material.dispose(); }
  MARK.delete(id);
}
function updateMarkers() {
  for (const m of MARK.values()) {
    const dx = camera.position.x - m.x, dz = camera.position.z + m.y, d = Math.sqrt(dx * dx + dz * dz);
    const bs = clamp(d / 60, 1, 9), ds = clamp(d / 25, 1, 9);
    m.beam.scale.set(bs, 1, bs); m.dia.scale.setScalar(ds);
    m.dia.position.set(m.x, m.z + 3 + Math.sin(T * 2.2) * 0.25, -m.y); m.dia.rotation.y = T * 1.8;
  }
}

// ---------- gamosa collectibles: 24 hidden cloths, one InstancedMesh for the cloth and one for the glow ----------
const GAMOSA_SPOTS = [
  [-47, 6], [-30, -37], [11, -19], [-122, -101], [-76, -92], [47.5, -37.5], [49.5, -14], [75.5, 200.2], [97.1, 214], [84, 234], [-491, -48], [-490, 40],
  [-45, 29], [-65, 10], [-78.8, 89], [119, 235], [-104.4, 116.1], [239, 88], [168.9, -166], [-51.3, -77.3], [-309, 251], [-383, 40], [209, 130], [-228, 300],
];
const GAM = []; let gamCloth = null, gamGlow = null; const mapShown = new Set();
function clothTex() {
  return canvasTex(256, 160, (g, w, h) => {
    g.fillStyle = '#f6f1e6'; g.fillRect(0, 0, w, h);
    g.strokeStyle = 'rgba(120,110,90,0.12)'; g.lineWidth = 1; for (let x = 0; x < w; x += 4) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, h); g.stroke(); } for (let y = 0; y < h; y += 4) { g.beginPath(); g.moveTo(0, y); g.lineTo(w, y); g.stroke(); }
    g.fillStyle = '#c4161c'; g.fillRect(0, 0, w, 30); g.fillRect(0, h - 30, w, 30);
    g.fillStyle = '#f6f1e6'; for (let x = 10; x < w; x += 20) { for (const y of [15, h - 15]) { g.beginPath(); g.moveTo(x, y - 7); g.lineTo(x + 7, y); g.lineTo(x, y + 7); g.lineTo(x - 7, y); g.fill(); } }
    g.fillStyle = '#c4161c'; for (let i = 0; i < 3; i++) { const x = 64 + i * 64; g.beginPath(); g.moveTo(x, 60); g.lineTo(x + 12, 80); g.lineTo(x, 100); g.lineTo(x - 12, 80); g.fill(); }
    g.strokeStyle = '#c4161c'; g.lineWidth = 3; g.beginPath(); g.moveTo(0, 34); g.lineTo(w, 34); g.moveTo(0, h - 34); g.lineTo(w, h - 34); g.stroke();
  }, false);
}
function glowTex() {
  return canvasTex(64, 64, (g, w) => { const r = g.createRadialGradient(32, 32, 0, 32, 32, 32); r.addColorStop(0, 'rgba(255,240,200,0.9)'); r.addColorStop(0.4, 'rgba(255,220,160,0.35)'); r.addColorStop(1, 'rgba(255,200,120,0)'); g.fillStyle = r; g.fillRect(0, 0, w, w); }, false);
}
function buildGamosas() {
  const ct = clothTex();
  gamCloth = new THREE.InstancedMesh(BOX(0.62, 0.05, 0.4), new THREE.MeshStandardMaterial({ map: ct, emissive: '#ffd9b0', emissiveMap: ct, emissiveIntensity: 0.35, roughness: 0.9 }), GAMOSA_SPOTS.length); gamCloth.name = 'gamosa_cloth';
  gamGlow = new THREE.InstancedMesh(new THREE.PlaneGeometry(1.7, 1.7), new THREE.MeshBasicMaterial({ map: glowTex(), color: '#ffe3b0', transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }), GAMOSA_SPOTS.length); gamGlow.name = 'gamosa_glow';
  for (const m of [gamCloth, gamGlow]) { m.frustumCulled = false; m.castShadow = false; m.receiveShadow = false; m.userData.noMerge = true; scene.add(m); }
  GAMOSA_SPOTS.forEach(([x0, y0], i) => { const [x, y] = open(x0, y0); GAM.push({ id: `gamosa_${i + 1}`, x, y, z: groundAt(x, y), got: false, shown: false }); });
  refreshGamosas();
}
function hideGam(i) { dummy.position.set(0, -50, 0); dummy.scale.set(0, 0, 0); dummy.updateMatrix(); gamCloth.setMatrixAt(i, dummy.matrix); gamGlow.setMatrixAt(i, dummy.matrix); gamCloth.instanceMatrix.needsUpdate = gamGlow.instanceMatrix.needsUpdate = true; GAM[i].shown = false; }
function refreshGamosas() { // from the save: collected ones stay hidden
  GAM.forEach((g, i) => { g.got = isCollected(g.id); g.shown = false; hideGam(i); });
}
function gamosaCount() { let n = 0; for (const c of state.collected) if (c.startsWith('gamosa_')) n++; return n; }
function syncGamosaMap() {
  const want = !!getFlag('gamosa_map');
  if (!want) { if (mapShown.size) { for (const id of mapShown) removeMarker(id); mapShown.clear(); } return; }
  for (const g of GAM) if (!g.got && !mapShown.has(g.id)) { addMarker(g.id, { x: g.x, y: g.y, kind: 'collectible', label: 'Gamosa' }); mapShown.add(g.id); }
}
let mapT = 0;
function updateGamosas(dt, p) {
  mapT -= dt; if (mapT <= 0) { mapT = 0.5; syncGamosaMap(); }
  let dirty = false;
  for (let i = 0; i < GAM.length; i++) {
    const g = GAM[i]; if (g.got) continue;
    const dx = g.x - p.x, dy = g.y - p.y, d2 = dx * dx + dy * dy;
    if (d2 > 8100) { if (g.shown) hideGam(i); continue; }
    g.shown = true; dirty = true;
    const bob = g.z + 1.05 + Math.sin(T * 2 + i) * 0.1;
    dummy.position.set(g.x, bob, -g.y); dummy.rotation.set(0.5, T * 1.6 + i, 0.15); dummy.scale.set(1, 1, 1); dummy.updateMatrix(); gamCloth.setMatrixAt(i, dummy.matrix);
    dummy.quaternion.copy(camera.quaternion); dummy.updateMatrix(); gamGlow.setMatrixAt(i, dummy.matrix);
    if (d2 < 1 && Math.abs(p.z - g.z) < 1.8) collectGamosa(i);
  }
  if (dirty) gamCloth.instanceMatrix.needsUpdate = gamGlow.instanceMatrix.needsUpdate = true;
}
function collectGamosa(i) {
  const g = GAM[i]; if (g.got || !markCollected(g.id)) { g.got = true; hideGam(i); return; }
  g.got = true; hideGam(i);
  addMoney(5, 'gamosa'); sfx('pickup', { x: g.x, y: g.y });
  const count = gamosaCount(); emit('collectible:found', { id: g.id, count, total: GAM.length });
  toast(`Gamosa found (${count}/${GAM.length})`, { kind: 'good' });
  if (mapShown.has(g.id)) { removeMarker(g.id); mapShown.delete(g.id); }
}

// ---------- football ----------
const FIELD = (() => { // goals sit on the polygon's long (PCA) axis, 5 m in from each end, as in buildField
  const F = GEO.fieldPoly, cx = F.reduce((s, p) => s + p[0], 0) / F.length, cy = F.reduce((s, p) => s + p[1], 0) / F.length;
  let sxx = 0, syy = 0, sxy = 0; for (const p of F) { const dx = p[0] - cx, dy = p[1] - cy; sxx += dx * dx; syy += dy * dy; sxy += dx * dy; }
  const ang = 0.5 * Math.atan2(2 * sxy, sxx - syy), ux = Math.cos(ang), uy = Math.sin(ang);
  let lo = 1e9, hi = -1e9; for (const p of F) { const t = (p[0] - cx) * ux + (p[1] - cy) * uy; lo = Math.min(lo, t); hi = Math.max(hi, t); }
  let wlo = 1e9, whi = -1e9; for (const p of F) { const l = -(p[0] - cx) * uy + (p[1] - cy) * ux; wlo = Math.min(wlo, l); whi = Math.max(whi, l); } // lateral extent, for the kids' formation
  return { cx, cy, ux, uy, lo, hi, wlo, whi, goals: [{ t: lo + 5, inward: 1 }, { t: hi - 5, inward: -1 }].map(g => ({ ...g, x: cx + ux * g.t, y: cy + uy * g.t })) };
})();
const ball = { x: FIELD.cx, y: FIELD.cy, z: 0, vx: 0, vy: 0, vz: 0, r: 0.11, mesh: null, lastPlayer: -99, lastKid: -99, resetT: 0, pos: [0, 0, 0], carried: false, handle: null };
function ballTex() {
  return canvasTex(256, 128, (g, w, h) => {
    g.fillStyle = '#f4f4f0'; g.fillRect(0, 0, w, h); g.fillStyle = '#1b1b1d';
    for (let r = 0; r < 3; r++) for (let c = 0; c < 6; c++) { const x = (c + 0.5 + (r % 2) * 0.5) * w / 6, y = (r + 0.5) * h / 3; g.beginPath(); for (let k = 0; k < 5; k++) { const a = k * 1.2566 - 1.5708; g.lineTo(x + Math.cos(a) * 15, y + Math.sin(a) * 15); } g.fill(); }
  }, false);
}
function placeBall(x, y) {
  ball.x = x; ball.y = y; ball.vx = ball.vy = ball.vz = 0; ball.lastPlayer = ball.lastKid = -99; ball.z = groundAt(x, y) + ball.r; syncBall();
}
function syncBall() { ball.mesh.position.set(ball.x, ball.z, -ball.y); ball.pos[0] = ball.x; ball.pos[1] = ball.y; ball.pos[2] = ball.z; }
function buildBall() {
  ball.mesh = new THREE.Mesh(new THREE.SphereGeometry(ball.r, 14, 10), new THREE.MeshStandardMaterial({ map: ballTex(), roughness: 0.6 }));
  ball.mesh.userData.noMerge = true; ball.mesh.castShadow = true; scene.add(ball.mesh);
  placeBall(FIELD.cx, FIELD.cy);
  // on the field you kick it; anywhere else you pick it up and carry it (dribbling through walled lanes is no fun)
  ball.handle = register({ id: 'ball', pos: () => ball.pos, r: 1.6, priority: 1, kind: 'ball', onInteract: useBall,
    label: () => (ball.carried ? 'Drop the ball' : ballInField() ? 'Kick the ball' : 'Pick up the ball') });
}
const ballInField = () => pointInPoly(ball.x, ball.y, GEO.fieldPoly);
function useBall() {
  if (ball.carried) { dropBall(); return; }
  if (!ballInField()) { ball.carried = true; ball.vx = ball.vy = ball.vz = 0; ball.handle.set({ priority: -1 }); sfx('pickup', { vol: 0.5 }); playEmote('pickup', 0.85); toast('Got the ball. Carry it back onto the field.', { kind: 'quest' }); return; }
  kickBall();
}
function dropBall() {
  const p = getPlayer(), h = p.heading || 0; let x = p.x + Math.cos(h) * 0.7, y = p.y + Math.sin(h) * 0.7;
  if (!walkable(x, y)) { x = p.x; y = p.y; }
  ball.carried = false; ball.handle.set({ priority: 1 }); placeBall(x, y);
}
function kickBall() { // the ball leaves when the swinging foot arrives (see the kick in npc/realchars.js)
  if (ball.kickIn > 0) return;
  ball.kickIn = 0.2; ball.kickH = getPlayer().heading || 0; playEmote('kick', 0.5);
}
function launchBall() {
  const h = ball.kickH;
  ball.vx = Math.cos(h) * 9; ball.vy = Math.sin(h) * 9; ball.vz = 2.8; ball.lastPlayer = T; sfx('kick', { x: ball.x, y: ball.y });
}
function scoreGoal(byPlayer, gi) {
  ball.resetT = 2; emit('ball:goal', { goal: gi, byPlayer });
  if (byPlayer) { state.stats.goals += 1; emit('goal:scored', { goals: state.stats.goals }); sfx('goal'); bigMessage('GOAL!'); }
  else { sfx('goal', { vol: 0.4 }); toast('The kids score a goal!', { kind: 'info' }); }
}
function stepBall(dt, p) {
  if (ball.kickIn > 0 && (ball.kickIn -= dt) <= 0 && !ball.carried) launchBall();
  if (ball.carried) { // held at the hip; stepping onto the field drops it there
    const h = p.heading || 0; ball.x = p.x + Math.cos(h) * 0.32 - Math.sin(h) * 0.18; ball.y = p.y + Math.sin(h) * 0.32 + Math.cos(h) * 0.18; ball.z = (p.z || 0) + 0.95; syncBall();
    if (pointInPoly(p.x, p.y, GEO.fieldPoly)) { dropBall(); toast('Ball back on the field!', { kind: 'good' }); }
    return;
  }
  if (ball.resetT > 0) { ball.resetT -= dt; if (ball.resetT <= 0) { ball.resetT = 0; placeBall(FIELD.cx, FIELD.cy); } }
  // the player dribbles by walking into it
  if (!p.riding && !p.seated && ball.z - (p.z || 0) < 0.9) {
    const dx = ball.x - p.x, dy = ball.y - p.y, d = Math.hypot(dx, dy);
    if (d < 0.52) {
      const nx = d > 1e-3 ? dx / d : Math.cos(p.heading || 0), ny = d > 1e-3 ? dy / d : Math.sin(p.heading || 0), px = p.x + nx * 0.52, py = p.y + ny * 0.52;
      if (walkable(px, py)) { ball.x = px; ball.y = py; }
      const sp = p.speed || 0;
      if (sp > 0.4) { const want = sp * 1.35 + 0.6, along = ball.vx * nx + ball.vy * ny; if (along < want) { ball.vx += nx * (want - along); ball.vy += ny * (want - along); } ball.lastPlayer = T; }
    }
  }
  // the kids' match itself (who chases, passes, shoots) lives in npc/agents.js and acts through npcKick / pushBall below
  const sp0 = Math.hypot(ball.vx, ball.vy), gz0 = groundAt(ball.x, ball.y) + ball.r;
  if (sp0 < 0.02 && ball.vz === 0 && ball.z <= gz0 + 0.005) { ball.vx = ball.vy = 0; ball.z = gz0; syncBall(); return; }
  const n = Math.min(4, Math.max(1, Math.ceil(sp0 * dt / 0.25))), h = dt / n;
  for (let k = 0; k < n; k++) {
    const ox = ball.x, oy = ball.y, gz = groundAt(ball.x, ball.y) + ball.r;
    ball.vz -= 9.8 * h; ball.z += ball.vz * h;
    if (ball.z <= gz) { ball.z = gz; ball.vz = ball.vz < -1.2 ? -ball.vz * 0.55 : 0; }
    const nx = ball.x + ball.vx * h, ny = ball.y + ball.vy * h;
    if (walkable(nx, ny)) { ball.x = nx; ball.y = ny; }
    else if (walkable(nx, ball.y)) { ball.x = nx; ball.vy = -ball.vy * 0.5; }
    else if (walkable(ball.x, ny)) { ball.y = ny; ball.vx = -ball.vx * 0.5; }
    else { ball.vx = -ball.vx * 0.5; ball.vy = -ball.vy * 0.5; }
    if (ball.z <= groundAt(ball.x, ball.y) + ball.r + 0.01) { // rolling friction
      const s = Math.hypot(ball.vx, ball.vy);
      if (s > 0) { const ns = Math.max(0, s - (0.5 + 0.2 * s) * h) / s; ball.vx *= ns; ball.vy *= ns; }
    }
    if (ball.resetT <= 0) for (let gi = 0; gi < 2; gi++) { const g = FIELD.goals[gi]; // crossing the goal line between the posts, under the bar
      const t0 = (ox - FIELD.cx) * FIELD.ux + (oy - FIELD.cy) * FIELD.uy - g.t, t1 = (ball.x - FIELD.cx) * FIELD.ux + (ball.y - FIELD.cy) * FIELD.uy - g.t;
      if (t0 * g.inward > 0 && t1 * g.inward <= 0) {
        const lat = -(ball.x - FIELD.cx) * FIELD.uy + (ball.y - FIELD.cy) * FIELD.ux, glat = -(g.x - FIELD.cx) * FIELD.uy + (g.y - FIELD.cy) * FIELD.ux;
        if (Math.abs(lat - glat) < 3.66 && ball.z - groundAt(ball.x, ball.y) < 2.44 + ball.r) { scoreGoal(T - ball.lastPlayer < 8, gi); break; }
      }
    }
  }
  // roll the texture about the axis perpendicular to the velocity
  const s = Math.hypot(ball.vx, ball.vy);
  if (s > 0.05) { tmpAx.set(-ball.vy, 0, -ball.vx).normalize(); tmpQ.setFromAxisAngle(tmpAx, s * dt / ball.r); ball.mesh.quaternion.premultiply(tmpQ); }
  syncBall();
}
function setBallPosition(x, y) { if (!ball.mesh) return; if (!walkable(x, y)) [x, y] = findOpen(x, y); ball.resetT = 0; ball.carried = false; if (ball.handle) ball.handle.set({ priority: 1 }); placeBall(x, y); }
function getBall() { return { x: ball.x, y: ball.y, carried: ball.carried, inField: !ball.carried && ballInField() }; }
const ballRef = () => (ball.mesh ? ball : null); // the live ball for per-frame readers (no allocation); treat it as read-only
// an NPC strikes the ball: map angle, ground speed, upward speed. Refused while it is held, in the goal reset or just kicked
function npcKick(ang, v, lift) {
  if (!ball.mesh || ball.carried || ball.resetT > 0 || T - ball.lastKid < 0.3) return false;
  ball.vx = Math.cos(ang) * v; ball.vy = Math.sin(ang) * v; ball.vz = lift; ball.lastKid = T; ball.lastPlayer = -99;
  if (v > 2.5) sfx('kick', { x: ball.x, y: ball.y, vol: Math.min(1, v / 9) }); return true;
}
// a body at (x, y) with radius r shoves a rolling ball out of itself (feet, shins), so nobody runs through it
function pushBall(x, y, r, sp) {
  if (!ball.mesh || ball.carried || ball.z - groundAt(ball.x, ball.y) > 0.6) return;
  const dx = ball.x - x, dy = ball.y - y, d = Math.hypot(dx, dy), rr = r + ball.r; if (d >= rr || d < 1e-3) return;
  const nx = dx / d, ny = dy / d, px = x + nx * rr, py = y + ny * rr; if (walkable(px, py)) { ball.x = px; ball.y = py; }
  const want = (sp || 0) * 1.2 + 0.3, along = ball.vx * nx + ball.vy * ny; if (along < want) { ball.vx += nx * (want - along); ball.vy += ny * (want - along); }
}

// ---------- temple bell, binoculars, prayers ----------
let bell = null;
function buildBell() {
  const gx = 52.2, gy = -31.2, h = Math.PI / 2, z = groundAt(gx, gy);
  addProp(frameParts(), MAT_SOLID, gx, gy, h, { z });
  const body = new THREE.LatheGeometry([[0, 0.02], [0.07, 0], [0.12, -0.08], [0.16, -0.2], [0.22, -0.32], [0.3, -0.42], [0.32, -0.46]].map(([r, y]) => new THREE.Vector2(r, y)), 18);
  const clap = new THREE.SphereGeometry(0.05, 8, 6); clap.translate(0, -0.47, 0); const rope = new THREE.CylinderGeometry(0.012, 0.012, 0.3, 5); rope.translate(0, 0.17, 0);
  const mesh = new THREE.Mesh(mergeGeometries([body, clap, rope], false), new THREE.MeshStandardMaterial({ color: '#b8892b', metalness: 0.9, roughness: 0.35, side: THREE.DoubleSide }));
  mesh.castShadow = true; mesh.userData.noMerge = true;
  const pivot = new THREE.Object3D(); pivot.position.set(gx, z + 2.55, -gy); pivot.rotation.set(0, h, 0); pivot.add(mesh); pivot.userData.noMerge = true; scene.add(pivot);
  bell = { pivot, h, t: 99 };
  spot('bell', gx, gy, 'Ring the bell', () => { bell.t = 0; sfx('bell', { x: gx, y: gy }); emit('bell:rung', {}); toast('The bell rings out across the mandir.', { kind: 'info' }); }, { r: 2.8, z });
}
function updateBell(dt) {
  if (!bell || bell.t > 7) return;
  bell.t += dt; const a = bell.t > 7 ? 0 : 0.5 * Math.exp(-bell.t * 0.8) * Math.sin(bell.t * 6.5);
  bell.pivot.rotation.set(0, bell.h, a);
}
const BINO_TARGETS = [
  { id: 'hatigarh', name: 'Hatigarh Chariali', x: -499.7, y: -78 }, { id: 'field', name: 'Geetanagar Field', x: -2.5, y: -16.7 }, { id: 'park_tank', name: 'the park water tank', x: TANK.x, y: TANK.y },
  { id: 'mandir', name: 'the Mandir gate', x: 49.5, y: -33.5 }, { id: 'sbi', name: 'SBI Branch Gitanagar', x: 168.9, y: -172.2 }, { id: 'kanya', name: 'Kanya Mahavidyalaya', x: -78.9, y: 83.6 },
];
const BINO = { x: 78, y: 196.6, h: -Math.PI / 2, spotted: new Set(), cur: null, t: 0 };
function buildBinoculars() {
  const z = DECK.top; BINO.z = z;
  addProp(binocularParts(), MAT_SOLID, BINO.x, BINO.y, BINO.h, { z });
  for (const t of BINO_TARGETS) t.z = groundAt(t.x, t.y) + (t.id === 'park_tank' ? 12 : 6);
  spot('binoculars', BINO.x, BINO.y + 1.0, () => (getCameraMode() === 'binocular' ? 'Step back' : 'Look through the binoculars'), () => { setCameraMode(getCameraMode() === 'binocular' ? 'third' : 'binocular'); }, { r: 1.9, z, priority: 1 });
}
function updateBinoculars(dt, p) {
  if (getCameraMode() !== 'binocular') { BINO.cur = null; BINO.t = 0; return; }
  if (p.riding || Math.hypot(p.x - BINO.x, p.y - BINO.y) > 5) { setCameraMode('third'); return; }
  camera.getWorldDirection(FWD);
  let best = null, bd = 0.99756; // cos 4 degrees
  for (const t of BINO_TARGETS) {
    tmpV.set(t.x - camera.position.x, t.z - camera.position.y, -t.y - camera.position.z); const len = tmpV.length(); if (len < 1) continue;
    const c = tmpV.dot(FWD) / len; if (c > bd) { bd = c; best = t; }
  }
  if (!best || BINO.spotted.has(best.id)) { BINO.cur = best; BINO.t = 0; return; }
  if (BINO.cur !== best) { BINO.cur = best; BINO.t = 0; }
  BINO.t += dt;
  if (BINO.t >= 1) { BINO.spotted.add(best.id); emit('binocular:spotted', { placeId: best.id, name: best.name }); toast(`Spotted: ${best.name}`, { kind: 'good' }); }
}
const PRAYER_LINES = ['The lamp flickers softly. For a moment the lane noise fades away.', 'You fold your hands and breathe out slowly.', 'A calm settles over you. Somewhere a bell rings, far and gentle.',
  'You say a quiet thank-you for the day.', 'The incense smoke curls up and the world slows down.'];
function buildPrayers() {
  for (const [id, name, x0, y0] of [['sarbojonin', 'Sarbojonin Namghar', -100, 115], ['rajohua', 'Rajohua Namghar', 239.2, 83.6], ['shiv', 'Shiv Mandir', -315, 251]]) {
    const [x, y] = open(x0, y0), z = groundAt(x, y), lp = lampParts();
    addProp(lp.solid, MAT_SOLID, x, y, 0, { z }); addProp(lp.glow, MAT_GLOW, x, y, 0, { z, cast: false });
    spot(`prayer:${id}`, x, y, 'Offer a prayer', () => {
      const key = `prayer_${id}_${state.day}`;
      if (getFlag(key)) { toast(`You already prayed at ${name} today. It is still peaceful here.`, { kind: 'info' }); return; }
      setFlag(key, true); addBuff('stamina', 120); sfx('bell', { x, y, vol: 0.4 }); toast(pick(PRAYER_LINES), { kind: 'good', ms: 5000 });
    }, { r: 3.4, z });
  }
}

// ---------- photos ----------
let photoT = 0;
function takePhoto() {
  if (T - photoT < 0.5) return; photoT = T;
  const p = getPlayer(); flash('#ffffff', 120); sfx('shutter'); state.stats.photos += 1;
  const list = PLACES && PLACES.length ? PLACES : GEO.labels.filter(l => l.k === 'lm' || l.k === 'pin').map(l => ({ id: l.t.toLowerCase().replace(/[^a-z0-9]+/g, '_'), name: l.t, x: l.x, y: l.y }));
  let best = null, bs = 9;
  camera.updateMatrixWorld();
  for (const pl of list) {
    if (Math.hypot(pl.x - p.x, pl.y - p.y) > 150) continue;
    tmpV.set(pl.x, groundAt(pl.x, pl.y) + 4, -pl.y).applyMatrix4(camera.matrixWorldInverse);
    if (tmpV.z > -0.5) continue; // behind the camera
    tmpV.applyMatrix4(camera.projectionMatrix);
    if (Math.abs(tmpV.x) >= 0.75 || Math.abs(tmpV.y) >= 0.75) continue;
    const s = Math.hypot(tmpV.x, tmpV.y); if (s < bs) { bs = s; best = pl; }
  }
  emit('photo:taken', { placeId: best ? best.id : null, name: best ? best.name : null });
  toast(best ? `Photo: ${best.name}` : 'Nice shot', { kind: 'info' });
}

// ---------- delivery jobs ----------
let job = null;
function centroid(b) { if (b.c) return b.c; let x = 0, y = 0; for (const q of b.p) { x += q[0]; y += q[1]; } return [x / b.p.length, y / b.p.length]; }
function doorFor(c) { // walk from the centre toward the nearest lane until the ground is open, then one step further
  const a = toRoad(c[0], c[1]), ca = Math.cos(a), sa = Math.sin(a);
  for (let d = 0.6; d < 30; d += 0.6) { const x = c[0] + ca * d, y = c[1] + sa * d; if (walkable(x, y)) { const x2 = x + ca, y2 = y + sa; return walkable(x2, y2) ? [x2, y2] : [x, y]; } }
  const o = findOpen(c[0], c[1]); return walkable(o[0], o[1]) ? o : null;
}
function streetName(x, y) {
  let bd = 3600, name = null;
  for (const r of GEO.roads) if (r.name) for (const q of r.p) { const d = (q[0] - x) ** 2 + (q[1] - y) ** 2; if (d < bd) { bd = d; name = r.name; } }
  if (name) return name;
  bd = 8100; for (const l of GEO.labels) if (l.k === 'road') { const d = (l.x - x) ** 2 + (l.y - y) ** 2; if (d < bd) { bd = d; name = l.t; } }
  if (name) return name;
  return nearestOnMain(x, y)[0] < 45 ? 'Mother Teresa Rd' : 'a lane off Mother Teresa Rd';
}
function startDelivery() {
  if (job) return job;
  const p = getPlayer(), B = GEO.buildings; let found = null;
  for (let tries = 0; tries < 500 && !found; tries++) {
    const b = B[(Math.random() * B.length) | 0]; if (!b || !b.p || b.p.length < 3 || (b.a != null && b.a < 20)) continue;
    const c = centroid(b), d = Math.hypot(c[0] - p.x, c[1] - p.y); if (d < 120 || d > 450) continue;
    const door = doorFor(c); if (door) found = { door, d: Math.hypot(door[0] - p.x, door[1] - p.y) };
  }
  if (!found) { toast('No parcel jobs right now. Check again in a while.', { kind: 'info' }); return null; }
  const [x, y] = found.door, street = streetName(x, y), base = Math.round(25 + found.d / 8);
  job = { id: 'delivery', x, y, label: `House ${1 + ((Math.random() * 80) | 0)}, ${street}`, street, dist: found.d, reward: base, maxReward: Math.round(base * 1.5), timeLeft: found.d / 3 + 40, late: false };
  addItem('parcel', 1);
  setWorldMarker('delivery', { x, y, color: '#ffd23f' }); addMarker('delivery', { x, y, kind: 'job', label: 'Parcel drop' });
  register({ id: 'delivery_door', x, y, z: groundAt(x, y), r: 2.3, kind: 'job', priority: 1, label: 'Hand over the parcel', enabled: () => !!job && itemCount('parcel') > 0, onInteract: handOver });
  toast(`Parcel job: ${job.label}. Rs ${job.maxReward} if you are on time.`, { kind: 'quest', ms: 6000 });
  return job;
}
function handOver() {
  if (!job || !removeItem('parcel', 1)) return;
  const onTime = job.timeLeft > 0, reward = Math.round(job.reward * (onTime ? 1.5 : 1));
  state.stats.deliveries += 1; addMoney(reward, 'delivery'); sfx('coin');
  cleanupJob(); emit('delivery:done', { reward, onTime });
  toast(onTime ? `Delivered on time. Rs ${reward}.` : `Delivered, but late. Rs ${reward}.`, { kind: 'good' });
}
function cleanupJob() { job = null; unregister('delivery_door'); clearWorldMarker('delivery'); removeMarker('delivery'); }
function cancelDelivery() { const had = !!job; cleanupJob(); const n = itemCount('parcel'); if (n > 0 && had) removeItem('parcel', n); }
function getDelivery() { return job; }
function updateDelivery(dt) {
  if (!job) return;
  job.timeLeft = Math.max(0, job.timeLeft - dt);
  if (job.timeLeft === 0 && !job.late) { job.late = true; toast('You are running late. The parcel is still waiting.', { kind: 'warn' }); }
}

// ---------- build and state ----------
function buildJobBoard() {
  const x = -489.3, y = -38.2, h = Math.PI; // north end of the Hatigarh stall row, facing the lane
  addProp(boardParts(1.5, 0.75, 1.2), MAT_SOLID, x, y, h);
  signAt.push([3, 1.5, 0.75, 1.2, x, y, h]);
  spot('jobboard', x - 1.6, y, 'Check the job board', () => { if (job) { toast(`You still have a parcel for ${job.label}.`, { kind: 'info' }); return; } startDelivery(); }, { r: 2.4, kind: 'job' });
}
function flushSigns() {
  // sign planes: the board pieces above carry the posts; these are the printed faces
  for (const [cell, w, h, baseY, x, y, hd] of signAt) addProp([sign(cell, w, h, 0.04, baseY + h / 2, 0)], MAT_SIGN, x, y, hd, { cast: false });
  signAt.length = 0;
}
function applySave() { // idempotent: runs on every game:start, after load() or newGame() replaced the state objects
  cancelDelivery(); const n = itemCount('parcel'); if (n > 0) removeItem('parcel', n);
  unlocked = !!getFlag('scooter_unlocked');
  if (gamCloth) { refreshGamosas(); for (const id of mapShown) removeMarker(id); mapShown.clear(); syncGamosaMap(); }
  for (const P of PUMPS) P.t = 99;
  if (ball.mesh) { ball.resetT = 0; ball.carried = false; if (ball.handle) ball.handle.set({ priority: 1 }); placeBall(FIELD.cx, FIELD.cy); }
  BINO.spotted.clear();
}
function initWorldObjects() {
  if (inited) return; inited = true;
  MAT_SOLID = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.78, metalness: 0.12 });
  MAT_GLOW = new THREE.MeshBasicMaterial({ vertexColors: true });
  const st = signTex(); MAT_SIGN = new THREE.MeshStandardMaterial({ map: st, roughness: 0.6, emissive: '#ffffff', emissiveMap: st, emissiveIntensity: 0.2, side: THREE.DoubleSide });
  for (const [name, fn] of [['benches', buildBenches], ['pumps', buildPumps], ['atms', buildATMs], ['shops', buildShops], ['scooters', buildScooters], ['travel', buildTravel], ['jobboard', buildJobBoard],
    ['bell', buildBell], ['binoculars', buildBinoculars], ['prayers', buildPrayers], ['gamosas', buildGamosas], ['ball', buildBall], ['chairs', buildChairs]]) run(`init ${name}`, fn);
  run('init signs', flushSigns);
  try { mergeStatic(PROPS); } catch (err) { console.error('[worldobjects] mergeStatic failed', err); }
  scene.add(PROPS);
  on('game:start', () => run('game:start', applySave));
}
function updateWorldObjects(dt, player) {
  if (!inited || !player) return;
  T += dt;
  run('markers', updateMarkers); run('gamosas', updateGamosas, dt, player); run('ball', stepBall, dt, player); run('bell', updateBell, dt);
  run('pumps', updatePumps, dt); run('binoculars', updateBinoculars, dt, player); run('delivery', updateDelivery, dt);
}

export { initWorldObjects, updateWorldObjects, takePhoto, setWorldMarker, clearWorldMarker, startDelivery, getDelivery, cancelDelivery, setBallPosition, getBall, setScooterUnlocked, FIELD, ballRef, ballInField, npcKick, pushBall, placeChair };
