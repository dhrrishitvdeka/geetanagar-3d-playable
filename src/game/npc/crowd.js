import * as THREE from 'three';
import { camera, scene } from '../../core/context.js';
import { HIP_Y, JN, NJ, charMaterial, evalFrames, geo, mulA, newFrames, poseTarget, rootMatrix } from './humanoid.js';

// ---------- the crowd: one InstancedMesh per part type (14 draw calls for every NPC), matrices composed on the CPU ----------
// Body parts exist once per NPC (arms and legs twice); clothing and props are packed, so a part's count is the number of
// NPCs that wear it. Colours come from instanceColor times the geometry's vertex colours; one shared material.
const CAP = 160, DRAW_R = 140, DRAW_R2 = DRAW_R * DRAW_R;
const PLAN = [ // kind, capacity (all draws are rewritten every frame, so only visible NPCs cost anything)
  ['torso', CAP], ['pelvis', CAP], ['head', CAP], ['uArm', CAP * 2], ['fArm', CAP * 2], ['thigh', CAP * 2], ['shin', CAP * 2],
  ['hair', CAP], ['skirt', CAP], ['mekhela', CAP], ['sador', CAP], ['wrap', CAP], ['gamosa', CAP], ['hat', CAP * 2], ['blob', CAP * 5], ['box', CAP * 3],
];
const M = {}; // kind -> { mesh, arr, car, n, cap }
let built = false, drawn = 0;
const F = newFrames(), R = new Float32Array(16);
const frustum = new THREE.Frustum(), vp = new THREE.Matrix4(), sph = new THREE.Sphere();
const FRAME_OF = [F.hips, F.torso, F.head, F.handL, F.handR]; // indexed by FR.* in humanoid.js
const SIT_HIP = (() => { const J = new Float32Array(NJ); poseTarget(J, 3, 0, 0, 0, 0, 0); return HIP_Y + J[JN.ROOTY]; })(); // hip height of the sit pose at scale 1

function initCrowd() {
  if (built) return; built = true;
  const mat = charMaterial();
  for (const [kind, cap] of PLAN) {
    const mesh = new THREE.InstancedMesh(geo(kind), mat, cap);
    mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage); mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
    mesh.count = 0; mesh.frustumCulled = false; mesh.castShadow = true; mesh.receiveShadow = true; mesh.userData.noMerge = true; mesh.name = 'crowd_' + kind;
    scene.add(mesh); M[kind] = { mesh, arr: mesh.instanceMatrix.array, car: mesh.instanceColor.array, n: 0, cap };
  }
}
// write one instance: matrix from src (a frame) or frame * local, colour c
function put(kind, frame, local, c) {
  const k = M[kind]; if (k.n >= k.cap) return;
  const i = k.n++, o = i * 16;
  if (local) mulA(k.arr, o, frame, local); else k.arr.set(frame, o);
  const j = i * 3; k.car[j] = c[0]; k.car[j + 1] = c[1]; k.car[j + 2] = c[2];
}
// list[i] needs: x, y, z (absolute height), heading, state, speed, hold, animDt, rig (Animator), recipe, dead/hidden flags.
// Draws every NPC within 140 m that is (nearly) on screen; poses are only evaluated for those.
function drawCrowd(list, count) {
  if (!built) return 0;
  for (const kind in M) M[kind].n = 0;
  camera.updateMatrixWorld();
  vp.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse); frustum.setFromProjectionMatrix(vp);
  const ce = camera.matrixWorld.elements, cx = ce[12], cz = ce[14]; // three.js space; map y = -z
  let nd = 0;
  for (let q = 0; q < count; q++) {
    const n = list[q]; if (n.dead || n.hidden || n.real || !n.recipe) continue; // n.real: drawn as a rigged model by realpool.js
    const dx = n.x - cx, dy = n.y + cz; if (dx * dx + dy * dy > DRAW_R2) continue;
    sph.center.set(n.x, n.z + 0.9, -n.y); sph.radius = 5; // generous: off-screen people still throw shadows into view
    if (!frustum.intersectsSphere(sph)) continue;
    if (nd >= CAP) break; nd++;
    const rc = n.recipe, T = rc.tint, J = n.rig.step(Math.min(n.animDt, 0.1), n.state, n.speed, n.hold, false); n.animDt = 0;
    const lift = n.seatH > 0 && n.state === 'sit' ? n.seatH + 0.07 * rc.s - SIT_HIP * rc.s : 0; // the sit pose's hips are over the feet: raise them to the seat
    rootMatrix(R, n.x, n.z + lift, n.y, n.heading, rc.s, rc.bw); evalFrames(F, R, J, rc.hs);
    put('torso', F.torso, null, T.torso); put('pelvis', F.hips, null, T.pelvis); put('head', F.head, null, T.head);
    put('uArm', F.uArmL, null, T.uArm); put('uArm', F.uArmR, null, T.uArm); put('fArm', F.fArmL, null, T.fArm); put('fArm', F.fArmR, null, T.fArm);
    put('thigh', F.thighL, null, T.thigh); put('thigh', F.thighR, null, T.thigh); put('shin', F.shinL, null, T.shin); put('shin', F.shinR, null, T.shin);
    const it = rc.items; for (let k = 0; k < it.length; k++) { const e = it[k]; put(e.k, FRAME_OF[e.f], e.m, e.c); }
  }
  for (const kind in M) {
    const k = M[kind], m = k.mesh; m.count = k.n;
    if (k.n) { m.instanceMatrix.clearUpdateRanges(); m.instanceMatrix.addUpdateRange(0, k.n * 16); m.instanceMatrix.needsUpdate = true; m.instanceColor.clearUpdateRanges(); m.instanceColor.addUpdateRange(0, k.n * 3); m.instanceColor.needsUpdate = true; }
  }
  return (drawn = nd);
}
const crowdStats = () => ({ drawn, calls: PLAN.length });

export { initCrowd, drawCrowd, crowdStats, DRAW_R };
