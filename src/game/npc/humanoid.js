import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { makeRealCharacter, realReady } from './realchars.js';

// ---------- shared body: proportions, pose function, parts and clothing recipes ----------
// One body for everyone. The player is a real joint hierarchy (makeCharacter); the crowd composes the very same
// frames on the CPU (evalFrames) and draws them with instanced meshes (crowd.js). Both read the same joint vector J.
// Local frame: +x forward, +y up, +z the character's right. Height 1 = 1.65 m, feet at y = 0.
const HIP_Y = 0.82, HIP_Z = 0.095, THIGH = 0.42, SHIN = 0.40, SH_Y = 0.47, SH_Z = 0.19, NECK_Y = 0.54, UARM = 0.30, FARM = 0.25;
const BASE_H = 1.65;

// joint vector layout (radians unless noted). lean/neck > 0 = bow forward, knee/elbow > 0 = flexed, pitch > 0 = fall backwards
const JN = { ROOTY: 0, ROOTX: 1, PITCH: 2, LEAN: 3, TWIST: 4, ROLL: 5, HIP_L: 6, KN_L: 7, HIP_R: 8, KN_R: 9, SH_L: 10, EL_L: 11, AB_L: 12, SH_R: 13, EL_R: 14, AB_R: 15, NECK: 16, YAW: 17, TILT: 18, SPLAY: 19 };
const NJ = 20;
const { ROOTY, ROOTX, PITCH, LEAN, TWIST, ROLL, HIP_L, KN_L, HIP_R, KN_R, SH_L, EL_L, AB_L, SH_R, EL_R, AB_R, NECK, YAW, TILT, SPLAY } = JN;
const STATE_ID = { idle: 0, walk: 1, run: 2, sit: 3, talk: 4, wave: 5, kick: 6, ride: 7, fall: 8, jump: 9, pray: 10, flinch: 11, floor: 12, crouch: 13, pickup: 14 };
const HOLD = { NONE: 0, PHONE: 1, UMBRELLA: 2, BAG: 3, STICK: 4 };
const strideFor = sp => 0.9 + 0.38 * sp; // metres per full gait cycle: 1.4 m at a walk (1.3 m/s)
const sstep = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

// the lowest foot sits on the ground: hip height follows the legs, which gives bobbing, sitting and kneeling for free
function groundRoot(J) {
  const dl = THIGH * Math.cos(J[HIP_L]) + SHIN * Math.cos(J[HIP_L] - J[KN_L]), dr = THIGH * Math.cos(J[HIP_R]) + SHIN * Math.cos(J[HIP_R] - J[KN_R]);
  return Math.max(dl, dr) - HIP_Y;
}
function idlePose(J, tm) {
  const br = Math.sin(tm * 1.9);
  J[LEAN] = 0.02 + 0.01 * br; J[ROLL] = 0.012 * Math.sin(tm * 0.7); J[SH_L] = 0.03 * br; J[SH_R] = -0.03 * br; J[YAW] = 0.18 * Math.sin(tm * 0.37 + 1.3); J[NECK] = 0.02;
}
// target pose for a state; ph = gait phase, t = seconds in the state (one-shots), sp = speed m/s, tm = free-running clock
function poseTarget(J, st, ph, t, sp, hold, tm) {
  J.fill(0); J[AB_L] = J[AB_R] = 0.07; J[EL_L] = J[EL_R] = 0.12; J[KN_L] = J[KN_R] = 0.03;
  let ground = true, holdOk = true;
  const s = Math.sin(ph), c = Math.cos(ph);
  switch (st) {
    case 1: { // walk
      const g = Math.min(1, sp / 0.5), u = Math.min(1, sp / 1.5), A = (0.16 + 0.3 * u) * g;
      idlePose(J, tm); for (let k = 0; k < 20; k++) if (k !== AB_L && k !== AB_R) J[k] *= 1 - g; J[AB_L] = J[AB_R] = 0.07;
      J[HIP_L] = A * s; J[HIP_R] = -A * s; J[KN_L] = 0.04 + 1.5 * A * Math.max(0, Math.cos(ph - 0.2)); J[KN_R] = 0.04 + 1.5 * A * Math.max(0, -Math.cos(ph - 0.2));
      J[SH_L] = -A * s; J[SH_R] = A * s; J[EL_L] = J[EL_R] = 0.15 + 0.5 * A; J[TWIST] = 0.08 * s * g; J[ROLL] = 0.03 * c * g; J[LEAN] = (0.03 + 0.04 * u) * g; J[YAW] = -0.4 * J[TWIST]; break;
    }
    case 2: { // run
      const r = Math.max(0.3, Math.min(1, (sp - 1.5) / 4)), A = 0.55 + 0.4 * r;
      J[HIP_L] = A * s; J[HIP_R] = -A * s; J[KN_L] = 0.25 + 1.6 * r * Math.max(0, Math.cos(ph - 0.1)); J[KN_R] = 0.25 + 1.6 * r * Math.max(0, -Math.cos(ph - 0.1));
      J[SH_L] = -(0.55 + 0.55 * r) * s; J[SH_R] = (0.55 + 0.55 * r) * s; J[EL_L] = J[EL_R] = 1.2 + 0.3 * r; J[LEAN] = 0.12 + 0.2 * r; J[TWIST] = 0.15 * s * r; J[ROLL] = 0.03 * c; J[YAW] = -0.4 * J[TWIST]; break;
    }
    case 3: // sit on a bench or kerb: thighs level, shins vertical
      J[HIP_L] = J[HIP_R] = 1.5; J[KN_L] = J[KN_R] = 1.5; J[SPLAY] = 0.05; J[LEAN] = 0.05; J[SH_L] = J[SH_R] = 0.45; J[EL_L] = J[EL_R] = 1.15; J[AB_L] = J[AB_R] = 0.1; J[YAW] = 0.25 * Math.sin(tm * 0.5); J[NECK] = 0.03; break;
    case 12: // sit on the floor, legs out, leaning back on the hands
      J[HIP_L] = J[HIP_R] = 1.45; J[KN_L] = J[KN_R] = 0.08; J[SPLAY] = 0.14; J[LEAN] = -0.1; J[SH_L] = J[SH_R] = -0.5; J[EL_L] = J[EL_R] = 0.1; J[AB_L] = J[AB_R] = 0.25; J[YAW] = 0.3 * Math.sin(tm * 0.4); break;
    case 13: { // crouch: knees and hips bent deep, torso leaning forward, short low steps when moving
      const g = Math.min(1, sp / 0.4), A = 0.22 * g;
      idlePose(J, tm); J[HIP_L] = 1.2 + A * s; J[HIP_R] = 1.2 - A * s; J[KN_L] = 1.7 + 0.9 * A * Math.max(0, Math.cos(ph - 0.2)); J[KN_R] = 1.7 + 0.9 * A * Math.max(0, -Math.cos(ph - 0.2));
      J[LEAN] = 0.45 + 0.03 * g; J[NECK] = -0.3; J[SPLAY] = 0.06; J[SH_L] = 0.45 - 0.5 * A * s; J[SH_R] = 0.45 + 0.5 * A * s; J[EL_L] = J[EL_R] = 0.9; J[AB_L] = J[AB_R] = 0.15; J[TWIST] = 0.05 * s * g; holdOk = false; break;
    }
    case 14: { // pickup: bend down, reach for the ground and come back up (one-shot ~0.8 s)
      const p = t / 0.8; if (p >= 1) { idlePose(J, tm); break; }
      const b = Math.sin(Math.PI * sstep(0, 1, p));
      J[HIP_L] = 0.7 * b; J[HIP_R] = 0.9 * b; J[KN_L] = J[KN_R] = 1.1 * b + 0.03; J[LEAN] = 0.9 * b; J[NECK] = -0.5 * b; J[SH_R] = 0.35 * b; J[EL_R] = 0.25 * b; J[SH_L] = 0.1 * b; holdOk = false; break;
    }
    case 4: { // talk: idle with hand gestures and nods
      idlePose(J, tm); const e = 0.5 + 0.5 * Math.sin(tm * 0.9);
      J[SH_R] = 0.7 + 0.5 * Math.sin(tm * 3.1) * e; J[EL_R] = 1.0 + 0.4 * Math.sin(tm * 4.3 + 1); J[AB_R] = 0.15; J[SH_L] = 0.3 + 0.25 * Math.sin(tm * 2.3 + 2) * (1 - e); J[EL_L] = 0.7;
      J[NECK] = 0.05 + 0.06 * Math.sin(tm * 3.7); J[YAW] = 0.12 * Math.sin(tm * 0.6); J[TWIST] = 0.05 * Math.sin(tm * 0.8); holdOk = hold === HOLD.UMBRELLA; break;
    }
    case 5: // wave
      idlePose(J, tm); J[SH_R] = 2.5; J[AB_R] = 0.45; J[EL_R] = 0.5 + 0.5 * Math.sin(tm * 9); J[LEAN] = -0.03; holdOk = false; break;
    case 6: { // kick: one-shot right-leg swing in ~0.4 s
      const p = t / 0.4;
      if (p >= 1) { idlePose(J, tm); break; }
      const w = sstep(0, 0.35, p), k = sstep(0.35, 0.55, p), rc = sstep(0.6, 1, p);
      J[HIP_R] = (-0.7 * w * (1 - k) + 1.35 * k) * (1 - rc); J[KN_R] = (1.3 * w * (1 - k) + 0.1 * k) * (1 - rc) + 0.04; J[HIP_L] = -0.08 * k * (1 - rc);
      J[LEAN] = (0.06 * w - 0.12 * k) * (1 - rc); J[SH_L] = 0.7 * k * (1 - rc); J[SH_R] = -0.5 * k * (1 - rc); J[EL_L] = J[EL_R] = 0.4; holdOk = false; break;
    }
    case 7: // ride: seated, hands on the bars, feet on the floorboard (origin = feet, hips ~0.55 m above them)
      J[HIP_L] = J[HIP_R] = 1.15; J[KN_L] = J[KN_R] = 1.45; J[SPLAY] = 0.12; J[LEAN] = 0.1; J[SH_L] = J[SH_R] = 1.0; J[EL_L] = J[EL_R] = 0.55; J[AB_L] = J[AB_R] = 0.18; J[YAW] = 0.1 * Math.sin(tm * 0.6); J[NECK] = -0.05; holdOk = false; break;
    case 8: { // fall: stumble, tumble onto the back, sit up on the ground (~1.2 s, then stays seated)
      const a = sstep(0, 0.3, t), b = sstep(0.3, 0.7, t), cu = sstep(0.85, 1.2, t);
      J[PITCH] = 1.45 * b * (1 - cu); J[LEAN] = 0.35 * a * (1 - b) + 0.15 * cu;
      J[SH_L] = J[SH_R] = 1.8 * a * (1 - b) + 0.5 * b * (1 - cu) + 0.55 * cu; J[AB_L] = J[AB_R] = 0.3 + 0.9 * b * (1 - cu); J[EL_L] = J[EL_R] = 0.3;
      J[HIP_L] = 0.5 * a * (1 - b) + 1.45 * cu; J[HIP_R] = 1.45 * cu; J[KN_L] = J[KN_R] = 0.25 + 0.3 * b * (1 - cu) - 0.2 * cu; J[SPLAY] = 0.25 * b; J[NECK] = -0.15 * b * (1 - cu);
      ground = false; { const gr = groundRoot(J), w = Math.min(1, J[PITCH] / 1.2); J[ROOTY] = gr + (-0.72 - gr) * w; } holdOk = false; break;
    }
    case 9: // jump: legs tucked, arms up (the controller lifts the group)
      J[HIP_L] = J[HIP_R] = 0.9; J[KN_L] = J[KN_R] = 1.5; J[SH_L] = J[SH_R] = 0.9; J[EL_L] = J[EL_R] = 0.6; J[AB_L] = J[AB_R] = 0.4; J[LEAN] = 0.1; ground = false; holdOk = false; break;
    case 10: // pray: hands together at the chest, slight bow
      J[LEAN] = 0.12 + 0.03 * Math.sin(tm * 1.2); J[NECK] = 0.35; J[SH_L] = J[SH_R] = 0.55; J[EL_L] = J[EL_R] = 1.9; J[AB_L] = J[AB_R] = -0.55; holdOk = false; break;
    case 11: // flinch: startled step back, arms up (used when something rushes past)
      J[LEAN] = -0.15; J[TWIST] = 0.4; J[SH_L] = 0.9; J[SH_R] = 0.7; J[EL_L] = J[EL_R] = 0.7; J[AB_L] = J[AB_R] = 0.5; J[HIP_L] = J[HIP_R] = 0.25; J[KN_L] = J[KN_R] = 0.5; J[NECK] = -0.1; holdOk = false; break;
    default: idlePose(J, tm);
  }
  if (hold && holdOk) { // what the right hand is doing (the pose keeps the left arm free)
    if (hold === HOLD.PHONE && st !== 2) { J[SH_R] = 0.6; J[EL_R] = 1.6; J[AB_R] = -0.15; J[NECK] += 0.4; }
    else if (hold === HOLD.UMBRELLA) { J[SH_R] = 1.0; J[EL_R] = 1.9; J[AB_R] = 0.12; }
    else if (hold === HOLD.BAG) { J[SH_R] = 0.05; J[EL_R] = 0.2; J[AB_R] = 0.22; }
    else if (hold === HOLD.STICK) { J[SH_R] = 0.3; J[EL_R] = 0.35; J[AB_R] = 0.12; }
  }
  if (ground) J[ROOTY] = groundRoot(J);
}

// pose state per body: gait phase, one-shot clock, ~0.15 s blend between states
const BLEND = 0.15;
class Animator {
  constructor() { this.J = new Float32Array(NJ); this.from = new Float32Array(NJ); this.T = new Float32Array(NJ); this.st = -1; this.t = 0; this.ph = Math.random() * 6.28; this.tm = Math.random() * 20; this.bt = 1; }
  step(dt, state, sp, hold = 0, restart = false) {
    const id = STATE_ID[state] !== undefined ? STATE_ID[state] : 0;
    if (id !== this.st || restart) { if (this.st < 0) this.bt = 1; else { this.from.set(this.J); this.bt = 0; } this.st = id; this.t = 0; }
    this.tm += dt; this.t += dt;
    if (id === 1 || id === 2 || id === 13) this.ph += dt * sp * 6.2832 / strideFor(sp);
    poseTarget(this.T, id, this.ph, this.t, sp, hold, this.tm);
    if (this.bt < 1) { this.bt += dt / BLEND; const w = sstep(0, 1, this.bt), J = this.J, F = this.from, T = this.T; for (let k = 0; k < NJ; k++) J[k] = F[k] + (T[k] - F[k]) * w; } else this.J.set(this.T);
    return this.J;
  }
}

// ---------- frames: the same joint chain as 4x4 affine matrices (column-major, like Matrix4.elements) ----------
// out = parent * (T(tx,ty,tz) * Rz(rz) * Rx(rx) * Ry(ry) * S(sc)): the Euler order 'ZXY' the player's pivots use
function frame(o, p, tx, ty, tz, rz, rx, ry, sc) {
  let cz = 1, sz = 0, cx = 1, sx = 0, cy = 1, sy = 0;
  if (rz) { cz = Math.cos(rz); sz = Math.sin(rz); } if (rx) { cx = Math.cos(rx); sx = Math.sin(rx); } if (ry) { cy = Math.cos(ry); sy = Math.sin(ry); }
  const r00 = (cz * cy - sz * sx * sy) * sc, r10 = (sz * cy + cz * sx * sy) * sc, r20 = -cx * sy * sc;
  const r01 = -sz * cx * sc, r11 = cz * cx * sc, r21 = sx * sc, r02 = (cz * sy + sz * sx * cy) * sc, r12 = (sz * sy - cz * sx * cy) * sc, r22 = cx * cy * sc;
  o[0] = p[0] * r00 + p[4] * r10 + p[8] * r20; o[1] = p[1] * r00 + p[5] * r10 + p[9] * r20; o[2] = p[2] * r00 + p[6] * r10 + p[10] * r20; o[3] = 0;
  o[4] = p[0] * r01 + p[4] * r11 + p[8] * r21; o[5] = p[1] * r01 + p[5] * r11 + p[9] * r21; o[6] = p[2] * r01 + p[6] * r11 + p[10] * r21; o[7] = 0;
  o[8] = p[0] * r02 + p[4] * r12 + p[8] * r22; o[9] = p[1] * r02 + p[5] * r12 + p[9] * r22; o[10] = p[2] * r02 + p[6] * r12 + p[10] * r22; o[11] = 0;
  o[12] = p[0] * tx + p[4] * ty + p[8] * tz + p[12]; o[13] = p[1] * tx + p[5] * ty + p[9] * tz + p[13]; o[14] = p[2] * tx + p[6] * ty + p[10] * tz + p[14]; o[15] = 1;
}
// out[oo..] = a * b for affine matrices (a: frame, b: item-local)
function mulA(o, oo, a, b) {
  for (let j = 0; j < 12; j += 4) {
    const b0 = b[j], b1 = b[j + 1], b2 = b[j + 2];
    o[oo + j] = a[0] * b0 + a[4] * b1 + a[8] * b2; o[oo + j + 1] = a[1] * b0 + a[5] * b1 + a[9] * b2; o[oo + j + 2] = a[2] * b0 + a[6] * b1 + a[10] * b2; o[oo + j + 3] = 0;
  }
  const b0 = b[12], b1 = b[13], b2 = b[14];
  o[oo + 12] = a[0] * b0 + a[4] * b1 + a[8] * b2 + a[12]; o[oo + 13] = a[1] * b0 + a[5] * b1 + a[9] * b2 + a[13]; o[oo + 14] = a[2] * b0 + a[6] * b1 + a[10] * b2 + a[14]; o[oo + 15] = 1;
}
const newFrames = () => { const F = {}; for (const k of ['hips', 'torso', 'head', 'thighL', 'shinL', 'thighR', 'shinR', 'uArmL', 'fArmL', 'handL', 'uArmR', 'fArmR', 'handR']) F[k] = new Float32Array(16); return F; };
// R = root matrix (world position, heading and body scale), hs = head scale (kids have bigger heads)
function evalFrames(F, R, J, hs) {
  frame(F.hips, R, J[ROOTX], HIP_Y + J[ROOTY], 0, J[PITCH], 0, 0, 1);
  frame(F.torso, F.hips, 0, 0, 0, -J[LEAN], J[ROLL], J[TWIST], 1);
  frame(F.head, F.torso, 0, NECK_Y, 0, -J[NECK], J[TILT], J[YAW], hs);
  frame(F.thighL, F.hips, 0, 0, -HIP_Z, J[HIP_L], J[SPLAY], 0, 1); frame(F.shinL, F.thighL, 0, -THIGH, 0, -J[KN_L], 0, 0, 1);
  frame(F.thighR, F.hips, 0, 0, HIP_Z, J[HIP_R], -J[SPLAY], 0, 1); frame(F.shinR, F.thighR, 0, -THIGH, 0, -J[KN_R], 0, 0, 1);
  frame(F.uArmL, F.torso, 0, SH_Y, -SH_Z, J[SH_L], J[AB_L], 0, 1); frame(F.fArmL, F.uArmL, 0, -UARM, 0, J[EL_L], 0, 0, 1); frame(F.handL, F.fArmL, 0, -FARM, 0, 0, 0, 0, 1);
  frame(F.uArmR, F.torso, 0, SH_Y, SH_Z, J[SH_R], -J[AB_R], 0, 1); frame(F.fArmR, F.uArmR, 0, -UARM, 0, J[EL_R], 0, 0, 1); frame(F.handR, F.fArmR, 0, -FARM, 0, 0, 0, 0, 1);
}
// root matrix from a map position (z = absolute height), map heading, uniform scale s and width factor bw
function rootMatrix(o, x, z, y, heading, s, bw) {
  const c = Math.cos(heading), sn = Math.sin(heading);
  o[0] = s * c; o[1] = 0; o[2] = -s * sn; o[3] = 0; o[4] = 0; o[5] = s; o[6] = 0; o[7] = 0; o[8] = s * bw * sn; o[9] = 0; o[10] = s * bw * c; o[11] = 0; o[12] = x; o[13] = z; o[14] = -y; o[15] = 1;
}

// ---------- part geometry: low poly, flat shaded, vertex colours (white = take the tint) ----------
const GEOS = {};
const rgb = (g, r, gr, b) => { const n = g.attributes.position.count, a = new Float32Array(n * 3); for (let i = 0; i < n; i++) { a[i * 3] = r; a[i * 3 + 1] = gr; a[i * 3 + 2] = b; } g.setAttribute('color', new THREE.BufferAttribute(a, 3)); return g; };
const bit = (g, c = [1, 1, 1], x = 0, y = 0, z = 0) => { g = g.index ? g.toNonIndexed() : g; g.deleteAttribute('uv'); g.translate(x, y, z); return rgb(g, c[0], c[1], c[2]); };
const boxG = (w, h, d, x, y, z, c) => bit(new THREE.BoxGeometry(w, h, d), c, x, y, z);
const cylG = (rt, rb, h, seg, y, c, open = false) => bit(new THREE.CylinderGeometry(rt, rb, h, seg, 1, open), c, 0, y, 0);
const merge = list => mergeGeometries(list, false);
function build(kind) {
  switch (kind) {
    case 'torso': { // tapered box: 0.30 wide at the waist, 0.38 at the shoulders; spans 0.02..0.54 above the hips
      const g = new THREE.BoxGeometry(1, 1, 1), p = g.attributes.position;
      for (let i = 0; i < p.count; i++) { const top = p.getY(i) > 0; p.setXYZ(i, p.getX(i) * (top ? 0.22 : 0.20), p.getY(i) * 0.52 + 0.28, p.getZ(i) * (top ? 0.38 : 0.30)); }
      return bit(g);
    }
    case 'pelvis': return boxG(0.21, 0.15, 0.32, 0, 0.01, 0);
    case 'head': { // neck, skull, nose (reads as facing), dark eyes, ears
      const sk = new THREE.SphereGeometry(1, 7, 5); sk.scale(0.105, 0.12, 0.098);
      return merge([cylG(0.045, 0.05, 0.08, 6, 0.04, [0.9, 0.85, 0.85]), bit(sk, [1, 1, 1], 0, 0.19, 0), boxG(0.035, 0.04, 0.035, 0.112, 0.175, 0, [0.86, 0.76, 0.72]),
        boxG(0.012, 0.02, 0.03, 0.1, 0.215, 0.042, [0.06, 0.05, 0.05]), boxG(0.012, 0.02, 0.03, 0.1, 0.215, -0.042, [0.06, 0.05, 0.05]), boxG(0.02, 0.04, 0.015, 0, 0.19, 0.1, [0.95, 0.9, 0.9]), boxG(0.02, 0.04, 0.015, 0, 0.19, -0.1, [0.95, 0.9, 0.9])]);
    }
    case 'hair': { // a cap of hair: full ellipsoid with its lower rim pulled up to the hairline (low at the nape, high at the brow)
      const g = new THREE.SphereGeometry(1, 7, 5); g.scale(0.118, 0.13, 0.112); g.translate(0, 0.2, 0); const p = g.attributes.position;
      for (let i = 0; i < p.count; i++) { const x = p.getX(i), fl = x > 0 ? 0.11 + 0.135 * Math.min(1, x / 0.07) : 0.11; if (p.getY(i) < fl) p.setY(i, fl); }
      return bit(g);
    }
    case 'uArm': return cylG(0.04, 0.034, UARM, 6, -UARM / 2);
    case 'fArm': return cylG(0.034, 0.027, FARM, 6, -FARM / 2);
    case 'thigh': return cylG(0.072, 0.052, THIGH, 6, -THIGH / 2);
    case 'shin': return merge([cylG(0.05, 0.034, 0.34, 6, -0.17), boxG(0.2, 0.06, 0.09, 0.045, -0.37, 0, [0.1, 0.09, 0.09])]);
    case 'skirt': { // open frustum hanging from the waist, scaled in y to the garment length; darker waist band, lighter hem border
      const g = new THREE.CylinderGeometry(0.17, 0.26, 1, 8, 8, true); g.deleteAttribute('uv'); g.translate(0, -0.5, 0); const g2 = g.toNonIndexed(), p = g2.attributes.position, a = new Float32Array(p.count * 3);
      for (let i = 0; i < p.count; i++) { const y = p.getY(i), c = y > -0.1 ? [0.78, 0.78, 0.78] : y < -0.87 ? [1, 0.86, 0.58] : [1, 1, 1]; a[i * 3] = c[0]; a[i * 3 + 1] = c[1]; a[i * 3 + 2] = c[2]; }
      g2.setAttribute('color', new THREE.BufferAttribute(a, 3)); return g2;
    }
    case 'wrap': { // chador / sari pallu: a sash across the chest and a drape down the back, darker border at the hem
      const sash = new THREE.BoxGeometry(0.035, 0.62, 0.17); sash.rotateX(0.55);
      const cape = new THREE.BoxGeometry(0.035, 0.68, 0.36); cape.translate(0, 0.0, 0);
      return merge([bit(sash, [1, 1, 1], 0.118, 0.3, 0), bit(cape, [1, 1, 1], -0.115, 0.2, 0), boxG(0.04, 0.09, 0.36, -0.115, -0.185, 0, [0.62, 0.55, 0.5]), boxG(0.1, 0.035, 0.4, 0, 0.545, 0, [1, 1, 1])]);
    }
    case 'gamosa': { // white cotton scarf round the neck with red ends hanging on the chest
      const ring = new THREE.TorusGeometry(0.1, 0.028, 5, 10); ring.rotateX(Math.PI / 2);
      return merge([bit(ring, [0.95, 0.95, 0.93], 0, 0.55, 0), boxG(0.02, 0.12, 0.075, 0.118, 0.46, 0.045, [0.95, 0.95, 0.93]), boxG(0.02, 0.1, 0.075, 0.118, 0.35, 0.045, [1, 0.08, 0.06])]);
    }
    case 'hat': return merge([cylG(0.1, 0.5, 0.8, 10, 0.4), cylG(0.02, 0.1, 0.2, 10, 0.9, [1, 0.1, 0.08])]); // cone, base radius 0.5, red knob on top
    case 'blob': return bit(new THREE.IcosahedronGeometry(0.5, 1));
    case 'box': return boxG(1, 1, 1, 0, 0, 0);
  }
}
const geo = kind => GEOS[kind] || (GEOS[kind] = build(kind));
// one shared material for every character part: vertex colour times tint (instanceColor in the crowd, baked colours on the player)
let MAT = null;
function charMaterial() { return MAT || (MAT = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.9, metalness: 0, side: THREE.DoubleSide })); }

// ---------- clothing recipe: which parts an Appearance wears and where ----------
const FR = { HIPS: 0, TORSO: 1, HEAD: 2, HANDL: 3, HANDR: 4 };
const tmpC = new THREE.Color(), _p = new THREE.Vector3(), _q = new THREE.Quaternion(), _s = new THREE.Vector3(), _e = new THREE.Euler(), _m = new THREE.Matrix4();
const col = hex => { tmpC.set(hex); return [tmpC.r, tmpC.g, tmpC.b]; };
function local(pos, scl, rot) { // item-local transform as a Float32Array(16)
  _p.set(pos[0], pos[1], pos[2]); _s.set(scl[0], scl[1], scl[2]); _e.set(rot ? rot[0] : 0, rot ? rot[1] : 0, rot ? rot[2] : 0); _q.setFromEuler(_e);
  return Float32Array.from(_m.compose(_p, _q, _s).elements);
}
const DEFAULTS = { skin: '#a46c47', hair: '#17120e', hairStyle: 'short', top: '#4a78a8', topStyle: 'shirt', bottom: '#2c2c34', bottomStyle: 'pants', wrap: null, gamosa: false, hat: null, bag: null, umbrella: null, height: 1, build: 1, kid: false };
const SHORT_SLEEVE = { tshirt: 1, blouse: 1, uniform: 1 };
const CAPS = ['#2b4c7e', '#b33a3a', '#2f2f33', '#3c6e47', '#d0a437'];
function buildRecipe(app) {
  const a = { ...DEFAULTS, ...app }, kid = !!a.kid, items = [];
  const skin = col(a.skin), top = col(a.top), bot = col(a.bottom), hair = col(a.hair);
  const add = (k, f, pos, scl, rot, c) => items.push({ k, f, m: pos ? local(pos, scl, rot) : null, c });
  const longSleeve = !SHORT_SLEEVE[a.topStyle], rolled = a.topStyle === 'shirt' && a.sleeves === 'short';
  const tint = { torso: top, pelvis: bot, head: skin, uArm: top, fArm: longSleeve && !rolled ? top : skin, thigh: bot, shin: skin };
  if (a.bottomStyle === 'pants') tint.shin = bot;
  // hair and headwear
  const hs = a.hairStyle;
  if (hs !== 'bald') add('hair', FR.HEAD, null, null, null, hair);
  if (hs === 'long') add('blob', FR.HEAD, [-0.075, 0.0, 0], [0.15, 0.44, 0.24], null, hair);
  if (hs === 'bun') add('blob', FR.HEAD, [-0.115, 0.27, 0], [0.13, 0.13, 0.13], null, hair);
  const hatTint = col(a.hatColor || CAPS[(a.top.charCodeAt(1) + a.top.charCodeAt(3)) % CAPS.length]);
  const hat = a.hat || (hs === 'cap' ? 'cap' : null);
  if (hat === 'japi') add('hat', FR.HEAD, [0, 0.255, 0], [0.58, 0.2, 0.58], null, col('#cdb072'));
  else if (hat === 'cap') { add('hat', FR.HEAD, [0, 0.255, 0], [0.27, 0.1, 0.27], null, hatTint); add('blob', FR.HEAD, [0.125, 0.235, 0], [0.14, 0.022, 0.17], null, hatTint); }
  else if (hat === 'topi') add('hat', FR.HEAD, [0, 0.255, 0], [0.25, 0.11, 0.25], null, col('#efe6d0'));
  // garments below the waist: skirts are one open frustum scaled to length and width
  const skirt = (len, w, c) => add('skirt', FR.HIPS, [0, 0.07, 0], [w, len, w], null, c);
  const bs = a.bottomStyle;
  if (bs === 'mekhela' || bs === 'sari') skirt(0.78, 1.0, bot); else if (bs === 'skirt') skirt(kid ? 0.3 : 0.36, 0.95, bot); else if (bs === 'dhoti') { skirt(0.66, 0.78, bot); tint.thigh = bot; }
  if (a.topStyle === 'kurta') skirt(0.5, 0.86, top); else if (a.topStyle === 'robe') skirt(0.8, 1.04, top);
  if (a.wrap) add('wrap', FR.TORSO, null, null, null, col(a.wrap));
  if (a.gamosa) add('gamosa', FR.TORSO, null, null, null, [1, 1, 1]);
  // what the right hand holds (one thing), and carried bags
  let hold = HOLD.NONE;
  const bagBack = a.bagStyle ? a.bagStyle === 'back' : (a.topStyle === 'uniform' || kid);
  if (a.phone) hold = HOLD.PHONE;
  else if (a.umbrella) { hold = HOLD.UMBRELLA; add('hat', FR.HIPS, [UMB.x, UMB.y, UMB.z], [1.15, 0.26, 1.15], null, col(a.umbrella)); add('box', FR.HIPS, [UMB.x, UMB.y - 0.2, UMB.z], [0.022, 0.75, 0.022], null, [0.2, 0.2, 0.2]); }
  else if (a.stick) { hold = HOLD.STICK; add('box', FR.HIPS, [STK.x, -0.41, STK.z], [0.03, 0.84, 0.03], null, col('#6b4a2c')); }
  if (a.bag) {
    if (bagBack) add('box', FR.TORSO, [-0.165, 0.27, 0], [0.13, 0.34, 0.27], null, col(a.bag));
    else { add('box', FR.HANDR, [0, -0.13, 0], [0.1, 0.2, 0.16], null, col(a.bag)); if (hold === HOLD.NONE) hold = HOLD.BAG; }
  }
  if (a.phone) add('box', FR.HANDR, [0.03, -0.045, 0], [0.02, 0.1, 0.06], null, [0.08, 0.08, 0.1]);
  for (const f of [FR.HANDL, FR.HANDR]) add('blob', f, [0, -0.03, 0], [0.075, 0.085, 0.07], null, skin);
  return { a, s: a.height, bw: a.build, hs: kid ? 1.28 : 1, tint, items, hold };
}
// where the umbrella's pole and the walking stick stand (hips frame), chosen so the right hand's pose lands on them
const UMB = { x: 0.31, y: 0.97, z: 0.2 }, STK = { x: 0.24, z: 0.24 };

// ---------- the player's character: a real joint hierarchy, merged into one mesh per rigid segment ----------
const PRIVATE_ORDER = 'ZXY';
function makeProceduralCharacter(appearance = randomAppearance()) {
  const group = new THREE.Group(); group.userData.noMerge = true;
  const mk = (parent, x, y, z) => { const g = new THREE.Group(); g.rotation.order = PRIVATE_ORDER; g.position.set(x, y, z); parent.add(g); return g; };
  const hips = mk(group, 0, HIP_Y, 0), torso = mk(hips, 0, 0, 0), head = mk(torso, 0, NECK_Y, 0);
  const thighL = mk(hips, 0, 0, -HIP_Z), shinL = mk(thighL, 0, -THIGH, 0), thighR = mk(hips, 0, 0, HIP_Z), shinR = mk(thighR, 0, -THIGH, 0);
  const uArmL = mk(torso, 0, SH_Y, -SH_Z), fArmL = mk(uArmL, 0, -UARM, 0), uArmR = mk(torso, 0, SH_Y, SH_Z), fArmR = mk(uArmR, 0, -UARM, 0);
  const anim = new Animator(); let rec = null, meshes = [], hold = 0;
  // bake a part (or item) with its tint into a vertex-coloured geometry, optionally moved by a matrix
  const baked = (kind, c, m) => {
    const g = geo(kind).clone(), col = g.attributes.color, a = col.array;
    for (let i = 0; i < a.length; i += 3) { a[i] *= c[0]; a[i + 1] *= c[1]; a[i + 2] *= c[2]; }
    if (m) g.applyMatrix4(_m.fromArray(m)); return g;
  };
  const handOff = Float32Array.from([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, -FARM, 0, 1]);
  const compose = (a, b) => { const o = new Float32Array(16); mulA(o, 0, a, b); return o; };
  const seg = (pivot, kind, tintC, frameId, handFrame) => {
    const list = [baked(kind, tintC, null)];
    if (kind === 'fArm') for (const it of rec.items) if (it.f === handFrame) list.push(baked(it.k, it.c, it.m ? compose(handOff, it.m) : handOff));
    if (frameId !== undefined) for (const it of rec.items) if (it.f === frameId) list.push(baked(it.k, it.c, it.m));
    const mesh = new THREE.Mesh(merge(list), charMaterial()); mesh.castShadow = true; mesh.userData.noMerge = true; pivot.add(mesh); meshes.push(mesh); list.forEach(g => g.dispose()); return mesh;
  };
  function setAppearance(app) {
    for (const m of meshes) { m.parent.remove(m); m.geometry.dispose(); } meshes = [];
    rec = buildRecipe(app); hold = rec.hold; const T = rec.tint;
    seg(hips, 'pelvis', T.pelvis, FR.HIPS); seg(torso, 'torso', T.torso, FR.TORSO); seg(head, 'head', T.head, FR.HEAD);
    seg(thighL, 'thigh', T.thigh); seg(shinL, 'shin', T.shin); seg(thighR, 'thigh', T.thigh); seg(shinR, 'shin', T.shin);
    seg(uArmL, 'uArm', T.uArm); seg(fArmL, 'fArm', T.fArm, undefined, FR.HANDL); seg(uArmR, 'uArm', T.uArm); seg(fArmR, 'fArm', T.fArm, undefined, FR.HANDR);
    group.scale.set(rec.s, rec.s, rec.s * rec.bw); head.scale.setScalar(rec.hs); out.height = BASE_H * rec.s;
  }
  function animate(dt, o = {}) {
    const J = anim.step(dt, o.state || 'idle', o.speed || 0, hold, !!o.restart);
    hips.position.set(J[ROOTX], HIP_Y + J[ROOTY], 0); hips.rotation.z = J[PITCH];
    torso.rotation.set(J[ROLL], J[TWIST], -J[LEAN]); head.rotation.set(J[TILT], J[YAW], -J[NECK]);
    thighL.rotation.set(J[SPLAY], 0, J[HIP_L]); shinL.rotation.z = -J[KN_L]; thighR.rotation.set(-J[SPLAY], 0, J[HIP_R]); shinR.rotation.z = -J[KN_R];
    uArmL.rotation.set(J[AB_L], 0, J[SH_L]); fArmL.rotation.z = J[EL_L]; uArmR.rotation.set(-J[AB_R], 0, J[SH_R]); fArmR.rotation.z = J[EL_R];
  }
  const out = { group, animate, setAppearance, height: BASE_H };
  setAppearance(appearance); animate(0, { state: 'idle' });
  return out;
}

// the rigged Quaternius model when preloadCharacters() succeeded, otherwise (or if building it fails) the procedural one above
function makeCharacter(appearance = randomAppearance()) {
  if (realReady()) { try { return makeRealCharacter(appearance); } catch (e) { console.error('[chars] real model failed, using the procedural one', e); } }
  return makeProceduralCharacter(appearance);
}

// ---------- variety: skin, hair, outfits by role ----------
const SKIN = ['#efc59c', '#e2b088', '#d49c6e', '#c48a5c', '#b07a52', '#9d6a48', '#8d5a3b', '#79492f', '#63391f'];
const HAIR = ['#0e0b09', '#15100d', '#1c1511', '#261b14'], GREY = ['#5d5955', '#8a867f', '#b8b4ad', '#d4d0c8'];
const M_SHIRT = ['#c9d3da', '#f0efe6', '#3e6b8a', '#7b8f5a', '#b04a3a', '#d9a441', '#6f6a8a', '#2f4f4f', '#e8e0cf', '#9a3b2e', '#8aa6b8'];
const M_TEE = ['#c0392b', '#1f77b4', '#2e8b57', '#f39c12', '#8e44ad', '#16a085', '#e67e22', '#34495e', '#d35400', '#e84393', '#2c3e50'];
const M_KURTA = ['#f0ead8', '#e8d9b5', '#7aa7c7', '#9ab973', '#d7a86e', '#b36b5e', '#c9c0d8'];
const M_PANTS = ['#2b2f3a', '#3a3f4b', '#5b4a3a', '#6b6f78', '#252525', '#4a5568', '#3b5b8c', '#2f4a73', '#47658f'];
const M_SHORTS = ['#6b7a8f', '#8a7a5a', '#3b4a5a', '#2c3e50', '#556b4f'];
// mekhela, sador, blouse, motif, fabric: muga (golden beige) and pat (ivory) silk with red motifs; cotton for daily wear
const MEKHELA = [['#cdae6c', '#d8bd7f', '#8e1f2f', '#a3172b', 'silk'], ['#efe6cf', '#f3ecd9', '#1f6a45', '#b3202e', 'silk'], ['#e9c46a', '#f1e3b8', '#2a6f6b', '#1d6e5a', 'cotton'],
  ['#f2a2b4', '#f6d2da', '#7a1c3c', '#7a1c3c', 'cotton'], ['#7fb3d5', '#d6e7f2', '#1f3f6b', '#1f3f6b', 'cotton'], ['#c94f4f', '#e8b4a0', '#3a2a1a', '#e2b84f', 'cotton']];
const SARI = [['#b03060', '#b03060', '#e8c46a'], ['#2e6f95', '#2e6f95', '#f0e6d0'], ['#c77d3a', '#e8c46a', '#5a2a3a'], ['#6a8d3a', '#6a8d3a', '#f4ead0'], ['#8b2a5a', '#d9a0b8', '#2f2f3a'], ['#d1495b', '#d1495b', '#f1e6d4'], ['#3d5a80', '#98c1d9', '#ffffff']];
const KURTI = ['#6aa5c8', '#d98e73', '#9bc59d', '#c78fb5', '#e3c16f', '#d3687c'], SALWAR = ['#f0e6d6', '#3d4a6b', '#6a3d5a', '#e9e2cf', '#2f5d50'], DUPATTA = ['#f4e9d8', '#c9406a', '#5a8fb8', '#d9b44a'];
const UNI_BOT = ['#232f55', '#5d6168', '#6d2330'], BAGS = ['#2a4d8f', '#b5392f', '#2f2f33', '#3c7a4a', '#d98a2a', '#7a4a8a', '#6b4a2c'], UMBR = ['#161616', '#161616', '#161616', '#c0392b', '#2a6fb5', '#e6b422', '#3c8a4a'];
const pick = (r, a) => a[Math.floor(r() * a.length) % a.length], chance = (r, p) => r() < p, rng2 = (r, a, b) => a + (b - a) * r();
function randomAppearance(rand = Math.random, opts = {}) {
  const role = opts.role || 'commuter';
  let female = opts.female; if (female === undefined) female = role === 'mekhela' || role === 'sari' ? true : role === 'priest' || role === 'guard' ? false : chance(rand, 0.46);
  const kid = opts.kid !== undefined ? !!opts.kid : role === 'kid', elder = role === 'elder';
  const a = { skin: pick(rand, SKIN), hair: elder ? pick(rand, GREY) : pick(rand, HAIR), hairStyle: 'short', top: '#4a78a8', topStyle: 'shirt', bottom: '#2c2c34', bottomStyle: 'pants', wrap: null, gamosa: false, hat: null, bag: null, umbrella: null, height: 1, build: rng2(rand, 0.9, 1.12), kid };
  if (female) a.female = true;
  if (kid) {
    a.height = rng2(rand, 0.62, 0.75); a.build = rng2(rand, 0.9, 1.0); a.hairStyle = female && chance(rand, 0.6) ? 'long' : 'short'; a.topStyle = 'tshirt'; a.top = pick(rand, M_TEE);
    if (female && chance(rand, 0.5)) { a.bottomStyle = 'skirt'; a.bottom = pick(rand, ['#c9406a', '#2a6fb5', '#e6b422', '#7a4a8a']); } else { a.bottomStyle = 'shorts'; a.bottom = pick(rand, M_SHORTS); }
    if (chance(rand, 0.25)) { a.bag = pick(rand, BAGS); a.bagStyle = 'back'; } return a;
  }
  const style = opts.style || (role === 'mekhela' ? 'mekhela' : role === 'sari' ? 'sari' : female ? (role === 'jogger' ? 'sport' : role === 'student' ? 'uniform' : role === 'office' ? pick(rand, ['salwar', 'sari', 'western']) : pick(rand, ['mekhela', 'mekhela', 'sari', 'salwar', 'salwar', 'western'])) : 'man');
  a.height = female ? rng2(rand, 0.91, 1.0) : rng2(rand, 0.97, 1.08);
  if (elder) { a.height *= 0.96; a.build *= 0.94; }
  if (role === 'student') { a.height = rng2(rand, 0.74, 0.95); a.kid = a.height < 0.8; a.build = rng2(rand, 0.9, 1.0); }
  if (female) {
    a.hairStyle = chance(rand, 0.5) ? 'long' : chance(rand, 0.8) ? 'bun' : 'short';
    if (style === 'mekhela') { const [m, w, b, mo, fab] = pick(rand, MEKHELA); a.bottom = m; a.bottomStyle = 'mekhela'; a.wrap = w; a.top = b; a.topStyle = 'blouse'; a.motif = mo; a.fabric = fab; }
    else if (style === 'sari') { const [m, w, b] = pick(rand, SARI); a.bottom = m; a.bottomStyle = 'sari'; a.wrap = w; a.top = b; a.topStyle = 'blouse'; }
    else if (style === 'salwar') { a.top = pick(rand, KURTI); a.topStyle = 'kurta'; a.bottom = pick(rand, SALWAR); a.bottomStyle = 'pants'; if (chance(rand, 0.6)) a.wrap = pick(rand, DUPATTA); }
    else if (style === 'uniform') { a.top = '#f2f2f0'; a.topStyle = 'uniform'; a.bottom = pick(rand, UNI_BOT); a.bottomStyle = chance(rand, 0.6) ? 'skirt' : 'pants'; a.bag = pick(rand, BAGS); a.bagStyle = 'back'; a.hairStyle = chance(rand, 0.6) ? 'long' : 'short'; }
    else if (style === 'sport') { a.top = pick(rand, M_TEE); a.topStyle = 'tshirt'; a.bottom = pick(rand, ['#1f1f26', '#2a2f4a', '#3a3a3a']); a.bottomStyle = 'pants'; a.hairStyle = chance(rand, 0.7) ? 'bun' : 'short'; if (chance(rand, 0.3)) { a.hat = 'cap'; } }
    else { a.top = pick(rand, M_TEE); a.topStyle = chance(rand, 0.5) ? 'tshirt' : 'shirt'; a.bottom = pick(rand, M_PANTS); a.bottomStyle = 'pants'; }
    if (elder) { a.hair = pick(rand, GREY); a.hairStyle = 'bun'; }
    if (role === 'shopper' || chance(rand, 0.2)) { a.bag = pick(rand, BAGS); a.bagStyle = style === 'western' || style === 'salwar' ? pick(rand, ['hand', 'back']) : 'hand'; }
  } else {
    a.hairStyle = chance(rand, 0.07) ? 'bald' : chance(rand, 0.1) ? 'cap' : 'short';
    const r = rand();
    if (role === 'jogger') { a.topStyle = 'tshirt'; a.top = pick(rand, M_TEE); a.bottomStyle = 'shorts'; a.bottom = pick(rand, M_SHORTS); if (chance(rand, 0.35)) a.hat = 'cap'; }
    else if (role === 'student') { a.topStyle = 'uniform'; a.top = '#f2f2f0'; a.bottom = pick(rand, UNI_BOT); a.bottomStyle = a.kid && chance(rand, 0.5) ? 'shorts' : 'pants'; a.bag = pick(rand, BAGS); a.bagStyle = 'back'; }
    else if (role === 'priest') { a.topStyle = 'robe'; a.top = '#e0831f'; a.bottomStyle = 'dhoti'; a.bottom = '#f2eadb'; a.hairStyle = 'bald'; a.gamosa = true; }
    else if (role === 'guard') { a.topStyle = 'uniform'; a.top = '#a99a6a'; a.bottom = '#6b5d3f'; a.bottomStyle = 'pants'; a.hat = 'cap'; a.hatColor = '#6b5d3a'; a.build = rng2(rand, 1.05, 1.15); }
    else if (elder && r < 0.5) { a.topStyle = 'kurta'; a.top = pick(rand, M_KURTA); a.bottomStyle = chance(rand, 0.6) ? 'dhoti' : 'pants'; a.bottom = a.bottomStyle === 'dhoti' ? '#efe9dc' : pick(rand, M_PANTS); }
    else if (r < 0.4) { a.topStyle = 'shirt'; a.top = pick(rand, M_SHIRT); a.bottom = pick(rand, M_PANTS); if (chance(rand, 0.3)) a.sleeves = 'short'; }
    else if (r < 0.78) { a.topStyle = 'tshirt'; a.top = pick(rand, M_TEE); if (chance(rand, 0.18)) { a.bottomStyle = 'shorts'; a.bottom = pick(rand, M_SHORTS); } else a.bottom = pick(rand, M_PANTS); }
    else { a.topStyle = 'kurta'; a.top = pick(rand, M_KURTA); a.bottomStyle = chance(rand, 0.25) ? 'dhoti' : 'pants'; a.bottom = a.bottomStyle === 'dhoti' ? '#efe9dc' : pick(rand, M_PANTS); }
    if (role === 'office') { a.topStyle = 'shirt'; a.top = pick(rand, M_SHIRT); a.bottomStyle = 'pants'; a.bottom = pick(rand, M_PANTS.slice(0, 6)); a.hairStyle = chance(rand, 0.05) ? 'bald' : 'short'; a.bag = chance(rand, 0.7) ? pick(rand, ['#2f2f33', '#4a3a2a', '#1f2a44']) : null; a.bagStyle = 'hand'; }
    if (role === 'shopper') { a.bag = pick(rand, BAGS); a.bagStyle = 'hand'; }
    if (role === 'commuter' && chance(rand, 0.35)) { a.bag = pick(rand, BAGS); a.bagStyle = 'back'; }
    if (elder) { a.hair = pick(rand, GREY); if (a.hairStyle === 'cap') a.hairStyle = 'short'; }
    if (role !== 'priest' && role !== 'guard' && role !== 'student' && role !== 'jogger' && chance(rand, elder ? 0.55 : role === 'vendor' ? 0.4 : 0.12)) a.gamosa = true;
    if (!a.hat && role !== 'priest' && chance(rand, role === 'vendor' ? 0.12 : 0.04)) a.hat = chance(rand, 0.6) ? 'japi' : 'topi';
  }
  if (elder) { if (chance(rand, 0.35)) a.stick = true; if (!a.bag && chance(rand, 0.2)) { a.umbrella = pick(rand, UMBR); a.stick = false; } }
  else if (role !== 'jogger' && role !== 'student' && chance(rand, 0.06)) { a.umbrella = pick(rand, UMBR); a.bag = a.bagStyle === 'hand' ? null : a.bag; }
  if (role === 'phone') { a.phone = true; a.umbrella = null; a.stick = false; }
  return a;
}

export { randomAppearance, makeCharacter, makeProceduralCharacter, buildRecipe, Animator, evalFrames, rootMatrix, newFrames, mulA, geo, charMaterial, poseTarget, groundRoot, strideFor, JN, NJ, STATE_ID, HOLD, FR, HIP_Y, BASE_H };
