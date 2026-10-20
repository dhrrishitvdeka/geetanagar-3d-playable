import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { scene } from '../core/context.js';
import { GEO, hAt, rng } from '../core/geo.js';
import { addCollider, disc, mergeAdd, polyMesh, resample } from './geom.js';
import { M } from './materials.js';

// ================= Lakhipriya Devi Baruani Children's Park (LDB Children Park) =================
// Evidence (2026-10-15): Google satellite at z20 (screenshots/audit/park_z20.png) and Street View panos
// 3_qRnWZanWudTCw74Lodrw / kEM0kEBZ4oUXOCakZBgK1g (Mar 2026), and the Maps pin at (-110, -100).
//   verified: outline (Google's park polygon), white picket fence on a dark plinth, open grassy interior,
//             a round feature at (-129.5, -94.2) ~3 m radius, two red-roofed sheds inside the north fence
//             at x ~ -132 and ~ -100, trees concentrated along the edges, pink bougainvillea.
//   approximate: shed sizes, gate position, the elevated water tank's exact spot (seen in Street View between
//             the fence and the road), whether the round feature is a bed or a dry fountain.
// The prototype's swings, slide, benches and three flower beds were invented and are gone.
const SHEDS = [{ x: -132, y: -89.3, w: 7.5, d: 3.2 }, { x: -100, y: -89.3, w: 7.5, d: 3.2 }];
const ROUND = { x: -129.5, y: -94.2, r: 3.0 };
const GATE = { x: -116, w: 2.4 };          // on the north (road) side, between the sheds
const TANK = { x: -108.6, y: -82.4 };       // elevated concrete water tank in the forecourt

function shed(s, geos) { // open pavilion: square concrete posts, low parapet at the back, red pitched roof
  const g = hAt(s.x, s.y), H = 2.6;
  for (const dx of [-s.w / 2 + 0.15, 0, s.w / 2 - 0.15]) for (const dy of [-s.d / 2 + 0.15, s.d / 2 - 0.15]) {
    const p = new THREE.BoxGeometry(0.22, H, 0.22); p.translate(s.x + dx, g + H / 2, -(s.y + dy)); geos.post.push(p);
  }
  const back = new THREE.BoxGeometry(s.w, 0.9, 0.15); back.translate(s.x, g + 0.45, -(s.y + s.d / 2 - 0.1)); geos.post.push(back);
  const floor = new THREE.BoxGeometry(s.w + 0.3, 0.2, s.d + 0.3); floor.translate(s.x, g + 0.1, -s.y); geos.post.push(floor);
  for (const side of [-1, 1]) { // two roof slopes meeting at a ridge along x
    const r = new THREE.BoxGeometry(s.w + 0.8, 0.06, s.d / 2 + 0.6); r.translate(0, 0, side * (s.d / 4 + 0.3)); r.rotateX(side * 0.38); r.translate(s.x, g + H + 0.35, -s.y); geos.roof.push(r);
  }
  const bench = new THREE.BoxGeometry(s.w - 0.8, 0.08, 0.45); bench.translate(s.x, g + 0.45, -(s.y + s.d / 2 - 0.5)); geos.post.push(bench);
  addCollider([s.x - s.w / 2, s.y + s.d / 2], [s.x + s.w / 2, s.y + s.d / 2]);
}

function waterTank(geos) { // ~11 m concrete frame tower with a cylindrical tank on top (Street View)
  const { x, y } = TANK, g = hAt(x, y), H = 10.5, S = 1.6;
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) { const c = new THREE.BoxGeometry(0.35, H, 0.35); c.translate(x + sx * S, g + H / 2, -(y + sy * S)); geos.conc.push(c); }
  for (const h of [3.5, 7]) for (const [ax, ay, L, rot] of [[0, S, 2 * S, 0], [0, -S, 2 * S, 0], [S, 0, 2 * S, 1], [-S, 0, 2 * S, 1]]) {
    const b = new THREE.BoxGeometry(L, 0.3, 0.3); if (rot) b.rotateY(Math.PI / 2); b.translate(x + ax, g + h, -(y + ay)); geos.conc.push(b);
  }
  const slab = new THREE.BoxGeometry(2 * S + 0.8, 0.3, 2 * S + 0.8); slab.translate(x, g + H, -y); geos.conc.push(slab);
  const tank = new THREE.CylinderGeometry(1.9, 1.9, 2.4, 20); tank.translate(x, g + H + 1.35, -y); geos.conc.push(tank);
  for (const [a, b] of [[[x - S, y - S], [x + S, y - S]], [[x + S, y - S], [x + S, y + S]], [[x + S, y + S], [x - S, y + S]], [[x - S, y + S], [x - S, y - S]]]) addCollider(a, b);
}

function buildParkGrounds({ trees, beds }) {
  const Pk = GEO.parkPoly;
  polyMesh(Pk, M.lawn, 0.06, 4);
  // white picket fence on a dark plinth all round, open at the gate
  const ring = resample([...Pk, Pk[0]], 0.5), plinth = [], pick = [];
  const picket = new THREE.BoxGeometry(0.09, 0.75, 0.04); picket.translate(0, 0.37 + 0.35, 0);
  const atGate = m => Math.abs(m[0] - GATE.x) < GATE.w / 2 && m[1] > -88;
  for (let i = 1; i < ring.length; i++) {
    const a = ring[i - 1], b = ring[i], mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    if (atGate(mid)) continue;
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]), an = Math.atan2(b[1] - a[1], b[0] - a[0]), h = hAt(mid[0], mid[1]);
    const pl = new THREE.BoxGeometry(L + 0.02, 0.35, 0.22); pl.rotateY(an); pl.translate(mid[0], h + 0.175, -mid[1]); plinth.push(pl);
    const pc = picket.clone(); pc.rotateY(an); pc.translate(a[0], hAt(a[0], a[1]), -a[1]); pick.push(pc);
    addCollider(a, b);
  }
  mergeAdd(plinth, M.black, true); mergeAdd(pick, M.white, true);
  // gate posts
  const gp = [];
  for (const s of [-1, 1]) { const p = new THREE.BoxGeometry(0.4, 1.6, 0.4); const gx = GATE.x + s * (GATE.w / 2 + 0.2); p.translate(gx, hAt(gx, -85.4) + 0.8, 85.4); gp.push(p); }
  mergeAdd(gp, M.white, true);
  // round bed with a white kerb ring (verified shape; contents approximate)
  const bedMat = new THREE.MeshStandardMaterial({ color: '#6e4a34', roughness: 1, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 });
  const d = new THREE.Mesh(disc(ROUND.x, ROUND.y, ROUND.r, 0.1), bedMat); d.receiveShadow = true; scene.add(d);
  const kerb = new THREE.Mesh(new THREE.TorusGeometry(ROUND.r, 0.14, 6, 40), M.white); kerb.rotation.x = Math.PI / 2; kerb.position.set(ROUND.x, hAt(ROUND.x, ROUND.y) + 0.14, -ROUND.y); kerb.castShadow = true; scene.add(kerb);
  beds.push([ROUND.x, ROUND.y, ROUND.r]);
  // sheds and the water tank
  const geos = { post: [], roof: [], conc: [] };
  for (const s of SHEDS) shed(s, geos);
  waterTank(geos);
  const roofMat = new THREE.MeshStandardMaterial({ color: '#a8432f', roughness: 0.7 });
  const concMat = new THREE.MeshStandardMaterial({ color: '#b8b2a6', roughness: 0.95 });
  for (const [list, mat] of [[geos.post, M.white], [geos.roof, roofMat], [geos.conc, concMat]]) {
    const m = new THREE.Mesh(mergeGeometries(list, false), mat); m.castShadow = m.receiveShadow = true; scene.add(m);
  }
  // trees along the edges (satellite: canopy around the rim, open grass in the middle); some pink-flowering
  const r = rng(91), cx = Pk.reduce((s, p) => s + p[0], 0) / Pk.length, cy = Pk.reduce((s, p) => s + p[1], 0) / Pk.length;
  const clearOf = (x, y) => SHEDS.every(s => Math.abs(x - s.x) > s.w / 2 + 2 || Math.abs(y - s.y) > s.d / 2 + 2) && Math.hypot(x - ROUND.x, y - ROUND.y) > ROUND.r + 2.5 && Math.abs(x - GATE.x) > 3;
  for (let i = 0; i < ring.length; i += 11) {
    const p = ring[i], dx = cx - p[0], dy = cy - p[1], L = Math.hypot(dx, dy) || 1, inset = 2.2 + r() * 2.5;
    const x = p[0] + dx / L * inset, y = p[1] + dy / L * inset;
    if (clearOf(x, y)) trees.push({ x, y, s: 5 + r() * 4, pink: r() < 0.3 });
  }
}

export { buildParkGrounds, SHEDS, ROUND, GATE, TANK };
