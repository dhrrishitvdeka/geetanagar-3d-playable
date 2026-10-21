import * as THREE from 'three';
import { scene } from '../../core/context.js';
import { hAt } from '../../core/geo.js';
import { addCollider, mergeAdd, polyMesh, railing, strip } from '../geom.js';
import { M } from '../materials.js';

// ---------- Geetanagar Field frontage on the north side of Mother Teresa Rd (Street View, pano at x ~ -24) ----------
// asphalt edge -> dusty earth shoulder (2-4 m, kiosks and carts stand on it) -> concrete footing slab ->
// black iron railing (~1.1 m) with square terracotta-motif panels between the posts -> red brick wall (~1.25 m) with a gate.
const FIELD_X0 = -58, FIELD_X1 = 18;
const GATE_X = -20, GATE_W = 3.6; // gate position along the frontage: approximate, the pano was blocked by a pandal scaffold
const F = { foot0: 2.5, foot1: 3.4, footH: 0.22, rail: 2.95, wall: 3.95 };
// the explorer shows the gate shut; the game swings it open so people can walk onto the field from the road
let gateOpen = false, gateX = GATE_X;
// x: where to put the open gate (the surveyed spot has stray building pixels in the class raster right behind it)
function setFieldGateOpen(on, x = GATE_X) { gateOpen = !!on; gateX = x; }
const fieldGateX = () => gateX;

function buildFieldEdge(Q, a, s, o, H, shoulder) {
  const NRM = Q.map((p, i) => { const q0 = Q[Math.max(0, i - 1)], q1 = Q[Math.min(Q.length - 1, i + 1)], dx = q1[0] - q0[0], dy = q1[1] - q0[1], l = Math.hypot(dx, dy) || 1; return [-dy / l, dx / l]; });
  const at = (i, off) => [Q[i][0] + NRM[i][0] * s * off, Q[i][1] + NRM[i][1] * s * off];
  const inGate = m => Math.abs(m[0] - gateX) < GATE_W / 2;
  shoulder.push(strip(Q, i => s * o(i), i => s * (H(i) + F.foot0), 0.04, 0.04, 4));
  // footing slab (top + front face + back face)
  const foot = [
    strip(Q, i => s * (H(i) + F.foot0), i => s * (H(i) + F.foot1), F.footH, F.footH, 2),
    strip(Q, i => s * (H(i) + F.foot0), i => s * (H(i) + F.foot0), 0.0, F.footH, 2, true),
    strip(Q, i => s * (H(i) + F.foot1), i => s * (H(i) + F.foot1), F.footH, 0.0, 2, true),
  ];
  mergeAdd(foot, M.concrete, true);
  // railing: posts every 1.8 m, bottom/middle/top rails, vertical bars, a square ornamental panel in each bay
  const railLine = Q.map((p, i) => at(i, H(i) + F.rail));
  railing(railLine, { h: 1.1, spacing: 1.8, base: F.footH, rails: [0.06, 0.32, 0.78, 1.0], post: 0.08, infill: 'railInfill', infillSpan: [0.06, 1.0], skip: inGate });
  const panels = [];
  let acc = 0;
  for (let i = 1; i < railLine.length; i++) {
    const p0 = railLine[i - 1], p1 = railLine[i], L = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]); acc += L;
    if (acc < 1.8) continue; acc -= 1.8;
    const m = [(p0[0] + p1[0]) / 2, (p0[1] + p1[1]) / 2]; if (inGate(m)) continue;
    panels.push([m[0], m[1], Math.atan2(p1[1] - p0[1], p1[0] - p0[0])]);
  }
  const pm = new THREE.InstancedMesh(new THREE.BoxGeometry(0.4, 0.4, 0.03), M.fieldPanel, panels.length), dm = new THREE.Object3D(); pm.name = 'field_panels';
  panels.forEach(([x, y, an], k) => { dm.position.set(x, hAt(x, y) + F.footH + 0.55, -y); dm.rotation.set(0, an, 0); dm.updateMatrix(); pm.setMatrixAt(k, dm.matrix); });
  pm.castShadow = true; scene.add(pm);
  // brick wall with a concrete coping and pillars, broken by the gate
  const wall = [], cope = [], piers = [], WH = 1.25;
  const wl = Q.map((p, i) => at(i, H(i) + F.wall));
  const boxUV = (g, u, v) => { const uv = g.attributes.uv; for (let k = 0; k < uv.count; k++) uv.setXY(k, uv.getX(k) * u, uv.getY(k) * v); return g; };
  let since = 0;
  for (let i = 1; i < wl.length; i++) {
    const p0 = wl[i - 1], p1 = wl[i], mid = [(p0[0] + p1[0]) / 2, (p0[1] + p1[1]) / 2], L = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]); if (inGate(mid) || L < 0.01) continue;
    const an = Math.atan2(p1[1] - p0[1], p1[0] - p0[0]), h0 = Math.min(hAt(p0[0], p0[1]), hAt(p1[0], p1[1])) - 0.15;
    const w = boxUV(new THREE.BoxGeometry(L + 0.03, WH + 0.15, 0.23), (L + 0.03) / 1.8, (WH + 0.15) / 0.9); w.rotateY(an); w.translate(mid[0], h0 + (WH + 0.15) / 2, -mid[1]); wall.push(w);
    const c = new THREE.BoxGeometry(L + 0.03, 0.07, 0.32); c.rotateY(an); c.translate(mid[0], h0 + WH + 0.15 + 0.035, -mid[1]); cope.push(c);
    since += L; if (since > 3.6) { since = 0; const pr = boxUV(new THREE.BoxGeometry(0.38, WH + 0.35, 0.38), 0.38 / 1.8, (WH + 0.35) / 0.9); pr.rotateY(an); pr.translate(p1[0], h0 + (WH + 0.35) / 2, -p1[1]); piers.push(pr); }
    addCollider(p0, p1);
  }
  // gate pillars and a pair of black iron gate leaves
  const gi = Q.findIndex(p => p[0] > gateX); const gateMat = new THREE.MeshStandardMaterial({ color: '#1d1e20', map: M.railInfill.map, alphaTest: 0.5, side: THREE.DoubleSide, metalness: 0.5, roughness: 0.5 });
  if (gi > 0) {
    const gn = NRM[gi], an = Math.atan2(-gn[0], gn[1]), c = at(gi, H(gi) + F.wall), tx = Math.cos(an), ty = Math.sin(an), gh = hAt(c[0], c[1]) - 0.15;
    for (const d of [-1, 1]) { const pr = boxUV(new THREE.BoxGeometry(0.5, 1.9, 0.5), 0.5 / 1.8, 1.9 / 0.9); pr.rotateY(an); pr.translate(c[0] + tx * d * (GATE_W / 2 + 0.25), gh + 0.95, -(c[1] + ty * d * (GATE_W / 2 + 0.25))); piers.push(pr);
      const cap = new THREE.BoxGeometry(0.62, 0.1, 0.62); cap.translate(c[0] + tx * d * (GATE_W / 2 + 0.25), gh + 1.95, -(c[1] + ty * d * (GATE_W / 2 + 0.25))); cope.push(cap); }
    const nx = gn[0] * s, ny = gn[1] * s, openAn = Math.atan2(ny, nx); // inward, towards the field
    for (const d of [-1, 1]) { const leaf = new THREE.Mesh(new THREE.PlaneGeometry(GATE_W / 2 - 0.05, 1.5), gateMat);
      if (gateOpen) { const hx = c[0] + tx * d * GATE_W / 2, hy = c[1] + ty * d * GATE_W / 2; leaf.position.set(hx + nx * GATE_W / 4, gh + 0.95, -(hy + ny * GATE_W / 4)); leaf.rotation.y = openAn; }
      else { leaf.position.set(c[0] + tx * d * GATE_W / 4, gh + 0.95, -(c[1] + ty * d * GATE_W / 4)); leaf.rotation.y = an; }
      leaf.castShadow = true; scene.add(leaf);
      const frame = new THREE.Mesh(new THREE.BoxGeometry(GATE_W / 2 - 0.05, 0.06, 0.05), M.black); frame.position.copy(leaf.position); frame.position.y += 0.75; frame.rotation.y = leaf.rotation.y; scene.add(frame); }
    if (!gateOpen) { const g0 = [c[0] - tx * GATE_W / 2, c[1] - ty * GATE_W / 2], g1 = [c[0] + tx * GATE_W / 2, c[1] + ty * GATE_W / 2]; addCollider(g0, g1); }
  }
  mergeAdd(wall.concat(piers), M.brick, true); mergeAdd(cope, M.concrete, true);
}

// ---------- the Baikuntha Rd side (Street View, pano O7OpOyLpLLFmj4JrMQhC-g, Mar 2026) ----------
// a ~0.9 m brick wall painted terracotta red right at the road edge, galvanised chain-link (~1.3 m) on posts above it,
// a black iron side gate, and bare earth with trees between the wall and the pitch. The line is the lane centreline
// offset 3.7 m towards the field; it turns north at the bend and stops at the school corner. Gate spot is approximate.
const WEST = [[-60.2, -44], [-59.3, -33], [-61.3, -21], [-66.9, -7.9], [-74.8, -1.0], [-75.4, 4], [-75.4, 10]];
const WEST_GATE = [-64.1, -14.5], WEST_GATE_W = 2.6;
function buildFieldWest() {
  const WH = 0.9, inGate = m => Math.hypot(m[0] - WEST_GATE[0], m[1] - WEST_GATE[1]) < WEST_GATE_W / 2;
  // densify so the wall follows the ground and the gate gap is clean
  const pts = []; for (let i = 1; i < WEST.length; i++) { const a = WEST[i - 1], b = WEST[i], n = Math.max(1, Math.round(Math.hypot(b[0] - a[0], b[1] - a[1]) / 1.2)); for (let k = i === 1 ? 0 : 1; k <= n; k++) pts.push([a[0] + (b[0] - a[0]) * k / n, a[1] + (b[1] - a[1]) * k / n]); }
  const wall = [], cope = [];
  for (let i = 1; i < pts.length; i++) {
    const p0 = pts[i - 1], p1 = pts[i], mid = [(p0[0] + p1[0]) / 2, (p0[1] + p1[1]) / 2], L = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]); if (inGate(mid)) continue;
    const an = Math.atan2(p1[1] - p0[1], p1[0] - p0[0]), h0 = Math.min(hAt(p0[0], p0[1]), hAt(p1[0], p1[1])) - 0.15;
    const w = new THREE.BoxGeometry(L + 0.03, WH + 0.15, 0.23); w.rotateY(an); w.translate(mid[0], h0 + (WH + 0.15) / 2, -mid[1]); wall.push(w);
    const c = new THREE.BoxGeometry(L + 0.03, 0.06, 0.28); c.rotateY(an); c.translate(mid[0], h0 + WH + 0.18, -mid[1]); cope.push(c);
  }
  mergeAdd(wall, M.redWall, true); mergeAdd(cope, M.redWall, true);
  // chain-link on thin black posts along the top of the wall; railing() adds the colliders
  railing(pts, { h: 1.3, spacing: 2.4, base: WH + 0.1, rails: [1.0], post: 0.05, infill: 'chainLink', infillSpan: [0, 1], skip: inGate });
  // gate pillars (red, like the wall) and one black leaf standing half open
  const gi = pts.findIndex(p => Math.hypot(p[0] - WEST_GATE[0], p[1] - WEST_GATE[1]) < 1.2), a = pts[Math.max(0, gi - 1)], b = pts[Math.min(pts.length - 1, gi + 1)];
  const an = Math.atan2(b[1] - a[1], b[0] - a[0]), tx = Math.cos(an), ty = Math.sin(an), gh = hAt(WEST_GATE[0], WEST_GATE[1]) - 0.15, piers = [];
  for (const d of [-1, 1]) { const px = WEST_GATE[0] + tx * d * (WEST_GATE_W / 2 + 0.2), py = WEST_GATE[1] + ty * d * (WEST_GATE_W / 2 + 0.2), pr = new THREE.BoxGeometry(0.4, 2.1, 0.4); pr.rotateY(an); pr.translate(px, gh + 1.05, -py); piers.push(pr); }
  mergeAdd(piers, M.redWall, true);
  const leaf = new THREE.Mesh(new THREE.PlaneGeometry(WEST_GATE_W - 0.1, 1.6), M.railInfill), hx = WEST_GATE[0] - tx * WEST_GATE_W / 2, hy = WEST_GATE[1] - ty * WEST_GATE_W / 2, oa = an + 1.1; // swung ~60 degrees into the field
  leaf.position.set(hx + Math.cos(oa) * WEST_GATE_W / 2, gh + 0.95, -(hy + Math.sin(oa) * WEST_GATE_W / 2)); leaf.rotation.y = oa; leaf.castShadow = true; scene.add(leaf);
  // bare earth from the wall to the pitch, where the satellite shows no grass
  polyMesh([[-59.3, -40], [-59.3, -33], [-61.3, -21], [-66.9, -7.9], [-55.2, -3.8], [-56.1, -21.4], [-50.5, -36.4]], M.earth, 0.05, 6);
}

export { buildFieldEdge, buildFieldWest, setFieldGateOpen, fieldGateX, FIELD_X0, FIELD_X1, GATE_X, F as FIELD_EDGE };
