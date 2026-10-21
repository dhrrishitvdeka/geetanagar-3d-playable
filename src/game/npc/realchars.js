import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';

// ---------- real characters: rigged Quaternius bodies, recoloured clothing, bone-attached dress, mixer animation ----------
// Same contract as humanoid.makeCharacter: group faces +x, origin at the feet, castShadow and userData.noMerge on every mesh.
// The files come from pipeline/chars_build.mjs. The bodies are bare, so clothing is painted by a patched material: every vertex is
// classified once (head, top, bottom, shoes) from its dominant skin bone and carries its distance along the arm or leg, and the
// fragment shader paints skin, top, bottom and shoe colours from per-character uniforms while keeping the texture's shading.
// Dress that has volume (skirts, wraps, hats, bags...) is built per character into ONE skinned mesh weighted to the shared skeleton.
const BASE_H = 1.65, ASSET = 'assets/chars/';
const DEF = { skin: '#a46c47', hair: '#17120e', hairStyle: 'short', top: '#4a78a8', topStyle: 'shirt', bottom: '#2c2c34', bottomStyle: 'pants', wrap: null, gamosa: false, hat: null, bag: null, umbrella: null, height: 1, build: 1, kid: false };
const CAPS = ['#2b4c7e', '#b33a3a', '#2f2f33', '#3c6e47', '#d0a437'], SHOES = ['#2b2622', '#3a2c22', '#1f2229', '#5a4535', '#8c7a62'];
const CLIPS = ['Idle_Loop', 'Walk_Loop', 'Walk_Formal_Loop', 'Jog_Fwd_Loop', 'Sprint_Loop', 'Sitting_Idle_Loop', 'Sitting_Talking_Loop', 'Idle_Talking_Loop', 'Crouch_Idle_Loop', 'Crouch_Fwd_Loop', 'Jump_Start', 'Jump_Loop', 'Jump_Land', 'Sitting_Enter', 'Sitting_Exit', 'Driving_Loop', 'Interact', 'Hit_Chest', 'Hit_Head'];
// fade-in seconds per clip (the clip that is coming in sets the speed of the whole blend): short for jump and land, longer for idle <-> walk
const FI = { Idle_Loop: 0.3, Walk_Loop: 0.25, Walk_Formal_Loop: 0.25, Jog_Fwd_Loop: 0.22, Sprint_Loop: 0.2, Crouch_Idle_Loop: 0.25, Crouch_Fwd_Loop: 0.22, Jump_Start: 0.06, Jump_Loop: 0.12, Jump_Land: 0.05, Sitting_Enter: 0.2, Sitting_Exit: 0.12, Sitting_Idle_Loop: 0.15, Hit_Chest: 0.06, Driving_Loop: 0.3 };
const SYNC = new Set(['Walk_Loop', 'Walk_Formal_Loop', 'Jog_Fwd_Loop', 'Sprint_Loop', 'Crouch_Fwd_Loop']); // gait loops share one phase so blending between them keeps the feet in step
const ONCE = new Set(['Jump_Start', 'Jump_Land', 'Sitting_Enter', 'Sitting_Exit', 'Hit_Chest']);
const JS = { from: 0.07, ts: 1.5, end: 0.75 }, JL = { ts: 1.7, end: 0.85 }, KICK_T = 0.5, PICK_T = 0.85; // jump start / land: clip time to start at, speed, clip time to stop at
const AXB = ['upperarm_r', 'upperarm_l', 'lowerarm_r', 'lowerarm_l', 'hand_r', 'hand_l', 'thigh_r', 'thigh_l', 'calf_r', 'calf_l', 'pelvis', 'spine_01', 'spine_03', 'neck_01', 'Head', 'clavicle_l', 'clavicle_r'];
const CK = { stance: 0, arm: 1, shoulder: 2, finger: 3 };
// per state: blend weight of each correction [stance, arm, shoulder, finger]
const CW = { crouch: [0, 0.5, 0.5, 0.5], idle: [1, 1, 1, 0.55], talk: [1, 1, 1, 0.55], walk: [0.35, 0.7, 1, 0.55], run: [0, 0.3, 0.5, 0.3], sit: [0, 0.7, 1, 0.55], floor: [0, 0.5, 0.5, 0.5], wave: [0.5, 0, 0.3, 0.15], pray: [0.5, 0, 0.3, 0.15] }, CW_DEF = [0, 0.3, 0.5, 0.4];
const _q = new THREE.Quaternion();
let TPL = null, HAIR = null, ready = false, loading = null;
const hashStr = s => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; };
const smooth = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const _c = new THREE.Color();

// ---------- loading ----------
function preloadCharacters() {
  if (ready) return Promise.resolve(true);
  if (loading) return loading;
  const gl = new GLTFLoader(), load = f => gl.loadAsync(ASSET + f);
  loading = Promise.all(['male.glb', 'female.glb', 'hair.glb', 'anims.glb'].map(load)).then(([m, f, h, a]) => {
    HAIR = readHair(h); TPL = { male: makeTemplate(m, 'male', a), female: makeTemplate(f, 'female', a) }; ready = true; return true;
  }).catch(e => { loading = null; throw e; });
  return loading;
}
const realReady = () => ready;
function readHair(g) {
  const out = { mats: [], styles: {} };
  g.scene.traverse(o => {
    if (!o.isMesh) return; const mi = o.material.name === 'Hair2' ? 1 : 0; out.mats[mi] = out.mats[mi] || o.material;
    out.styles[o.name] = { geometry: o.geometry, tex: mi };
  });
  return out;
}
const classOf = n => /^(spine|clavicle|upperarm|lowerarm)/.test(n) ? 1 : /^(pelvis|thigh|calf)/.test(n) ? 2 : /^(foot|ball)/.test(n) ? 3 : 0; // 0 skin, 1 top, 2 bottom, 3 shoes
const isArm = n => /^(upperarm|lowerarm|hand|thumb|index|middle|ring|pinky)/.test(n);

// one template per body: classified geometry, retargeted clips, bind-pose measurements used to size the dress
function makeTemplate(gltf, gender, anim) {
  const root = gltf.scene; root.updateMatrixWorld(true);
  let body = null, eyes = null, brows = null;
  root.traverse(o => { if (!o.isSkinnedMesh) return; const n = o.material.name; if (n === 'Body') body = o; else if (n === 'Eyes') eyes = o; else if (n === 'Eyebrows') brows = o; });
  if (!body || !eyes || !brows) throw new Error('character meshes missing in ' + gender);
  const skel = body.skeleton, bones = skel.bones, bi = {}; bones.forEach((b, i) => { bi[b.name] = i; });
  const Wb = skel.boneInverses.map(m => m.clone().invert()), wy = n => Wb[bi[n]].elements[13];
  const t = { gender, root, body, eyes, brows, bi, Wb, clips: {}, speed: {}, pelvisY: wy('pelvis'), s1Y: wy('spine_01'), s3Y: wy('spine_03'), clavY: wy('clavicle_l'), neckY: wy('neck_01'), neckZ: Wb[bi.neck_01].elements[14], handIdle: {}, Mhand: {}, off: {}, ax: {}, sg: { hip: 1, knee: 1, lean: 1, arm: 1 } };
  classify(t);
  buildClips(t, anim);
  return t;
}

// ---------- vertex classification: aMask (skin, top, bottom, shoes), aLimb (arm and leg coordinate), aFlat (smooth normal), torso cross-sections, head box ----------
// The Superhero bodies are slimmed here (once, on the shared geometry) so residents look ordinary: narrower shoulders and chest, thinner
// arms and legs. The arms are also moved in with the shoulder bones (t.shift, applied to every instance) so they still hang from the body.
const SY0 = 0.78, SY1 = 1.56, SN = 40;
const SLIM = { male: { chest: 0.86, depth: 0.9, arm: 0.85, leg: 0.9, waist: 0.97 }, female: { chest: 0.92, depth: 0.94, arm: 0.9, leg: 0.94, waist: 0.98 } };
function classify(t) {
  const g = t.body.geometry, pos = g.attributes.position, nor = g.attributes.normal, si = g.attributes.skinIndex, sw = g.attributes.skinWeight, n = pos.count, names = t.body.skeleton.bones.map(b => b.name);
  const cls = names.map(classOf), arm = names.map(isArm), head = names.map(x => x === 'Head'), low = names.map(x => /^(upperarm|lowerarm)/.test(x));
  const W = t.Wb, bi = t.bi, xSh = Math.abs(W[bi.upperarm_l].elements[12]), xEl = Math.abs(W[bi.lowerarm_l].elements[12]), thY = W[bi.thigh_l].elements[13], caY = W[bi.calf_l].elements[13];
  const cat = new Uint8Array(n), AW = new Float32Array(n), LW = new Float32Array(n), HW = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const cw = [0, 0, 0, 0];
    for (let k = 0; k < 4; k++) { const b = si.getComponent(i, k), w = sw.getComponent(i, k); if (!w) continue; cw[cls[b]] += w; if (arm[b]) AW[i] += w; if (low[b]) LW[i] += w; if (head[b]) HW[i] += w; }
    let c = 0; for (let k = 1; k < 4; k++) if (cw[k] > cw[c]) c = k; cat[i] = c;
  }
  // slim the body (arms about their axis, torso about the spine, legs about their axes); head, neck, hands and feet are left alone
  const S = SLIM[t.gender], ay = W[bi.upperarm_l].elements[13], az = W[bi.upperarm_l].elements[14], thx = Math.abs(W[bi.thigh_l].elements[12]), thz = W[bi.thigh_l].elements[14], pz = W[bi.pelvis].elements[14], s3z = W[bi.spine_03].elements[14];
  for (let i = 0; i < n; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i); if (HW[i] > 0.5 || y > t.neckY - 0.01) continue;
    if (LW[i] >= 0.5) { const u = Math.max(0, (Math.abs(x) - xSh) / (xEl - xSh)), s = S.arm + (1 - S.arm) * 0.5 * Math.min(1, Math.max(0, u - 1)); pos.setY(i, ay + (y - ay) * s); pos.setZ(i, az + (z - az) * s); continue; }
    if (AW[i] >= 0.5 || cat[i] === 3) continue;
    if (y >= t.pelvisY - 0.05) {
      const wy = smooth(t.pelvisY, t.s3Y, y), sx = S.waist + (S.chest - S.waist) * wy, sz = 1 - (1 - S.depth) * wy, zc = pz + (s3z - pz) * wy;
      pos.setX(i, x * sx); pos.setZ(i, zc + (z - zc) * sz);
    }
    if (cat[i] === 2 && y < t.pelvisY + 0.02) {
      const wl = 1 - smooth(thY - 0.25, thY - 0.02, y), s = 1 - (1 - S.leg) * wl, cx = pos.getX(i), cz = pos.getZ(i), lx = cx >= 0 ? thx : -thx;
      pos.setX(i, lx + (cx - lx) * s); pos.setZ(i, thz + (cz - thz) * s);
    }
  }
  const mask = new Float32Array(n * 4), limb = new Float32Array(n * 2), rx = new Float32Array(SN).fill(-1), zf = new Float32Array(SN).fill(-1e9), zb = new Float32Array(SN).fill(1e9), rs = new Float32Array(SN);
  let maxY = -1e9, hx = 0, hz = 0, hn = 0; const headV = [];
  for (let i = 0; i < n; i++) {
    const c = cat[i], x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i); mask[i * 4 + c] = 1; if (y > maxY) maxY = y;
    if (AW[i] >= 0.5) limb[i * 2] = Math.max(0, (Math.abs(x) - xSh) / (xEl - xSh));
    if (c >= 2) limb[i * 2 + 1] = Math.max(0, Math.min(4, (thY - y) / (thY - caY)));
    if (y >= SY0 && y <= SY1) {
      const b = Math.round((y - SY0) / (SY1 - SY0) * (SN - 1));
      if (AW[i] < 0.5 && (c === 1 || c === 2)) { rx[b] = Math.max(rx[b], Math.abs(x)); zf[b] = Math.max(zf[b], z); zb[b] = Math.min(zb[b], z); }
      else if (LW[i] >= 0.5 && limb[i * 2] < 0.5) rs[b] = Math.max(rs[b], Math.abs(x)); // the shoulder cap, for things that wrap over the shoulders
    }
    if (HW[i] > 0.6) headV.push(i);
  }
  for (let b = 0; b < SN; b++) if (rx[b] < 0) { let k = 1; while (b - k >= 0 || b + k < SN) { const j = b - k >= 0 && rx[b - k] >= 0 ? b - k : b + k < SN && rx[b + k] >= 0 ? b + k : -1; if (j >= 0) { rx[b] = rx[j]; zf[b] = zf[j]; zb[b] = zb[j]; break; } k++; } }
  t.H = maxY; t.secRx = rx; t.secZf = zf; t.secZb = zb;
  let hmax = -1e9, hhw = 0; for (const i of headV) hmax = Math.max(hmax, pos.getY(i));
  for (const i of headV) if (pos.getY(i) > hmax - 0.1) { hx += pos.getX(i); hz += pos.getZ(i); hn++; hhw = Math.max(hhw, Math.abs(pos.getX(i))); }
  t.headTop = hmax; t.headX = hn ? hx / hn : 0; t.headZ = hn ? hz / hn : 0; t.headHW = hhw || 0.075;
  t.sec = (y, o) => { const f = Math.max(0, Math.min(1, (y - SY0) / (SY1 - SY0))) * (SN - 1), i = Math.min(SN - 2, Math.floor(f)), u = f - i; o.rx = rx[i] + (rx[i + 1] - rx[i]) * u; o.zf = zf[i] + (zf[i + 1] - zf[i]) * u; o.zb = zb[i] + (zb[i + 1] - zb[i]) * u; o.rs = rs[i] + (rs[i + 1] - rs[i]) * u; return o; };
  // aFlat: a smooth outward direction per vertex (cylinder round the limb, ellipse round the torso). Clothed regions are lit and puffed along
  // it, so the sculpted chest, abs and biceps stop showing through the garments.
  const flat = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i); let fx = nor.getX(i), fy = nor.getY(i), fz = nor.getZ(i);
    if (HW[i] <= 0.5 && y <= t.neckY) {
      if (AW[i] >= 0.5) { fx = 0; fy = y - ay; fz = z - az; }
      else if (cat[i] >= 2 && y < thY - 0.02) { const lx = x >= 0 ? thx : -thx; fx = x - lx; fy = 0; fz = z - thz; }
      else if (cat[i] <= 2) { t.sec(y, SC); const rz = Math.max(0.05, (SC.zf - SC.zb) / 2), r = Math.max(0.05, SC.rx); fx = x / (r * r); fy = 0; fz = (z - (SC.zf + SC.zb) / 2) / (rz * rz); }
    }
    const l = Math.hypot(fx, fy, fz) || 1; flat[i * 3] = fx / l; flat[i * 3 + 1] = fy / l; flat[i * 3 + 2] = fz / l;
  }
  g.setAttribute('aMask', new THREE.BufferAttribute(mask, 4)); g.setAttribute('aLimb', new THREE.BufferAttribute(limb, 2)); g.setAttribute('aFlat', new THREE.BufferAttribute(flat, 3));
  pos.needsUpdate = true;
  // the arms follow the narrower chest: shift each upperarm bone inward (in its parent's frame)
  t.shift = {};
  for (const s of ['l', 'r']) { const m = new THREE.Matrix4().extractRotation(W[bi['clavicle_' + s]]).invert(); t.shift[s] = new THREE.Vector3((s === 'l' ? -1 : 1) * (1 - S.chest) * xSh, 0, 0).applyMatrix4(m); }
}
const SC = { rx: 0, zf: 0, zb: 0, rs: 0 };

// ---------- clips: the shared animation rig retargeted to this body ----------
// Only rotations (and the pelvis position) are stored in anims.glb, so each body keeps its own bone lengths. The pelvis track is
// scaled to this body's hip height and lifted so the lowest foot sits on the ground; natural gait speeds are measured here too.
function buildClips(t, anim) {
  const src = {}; for (const c of anim.animations) src[c.name] = c;
  const upel = anim.scene.getObjectByName('pelvis'), cpel = t.root.getObjectByName('pelvis'), ratio = cpel.position.z / upel.position.z;
  const probe = cloneSkinned(t.root), mx = new THREE.AnimationMixer(probe), B = n => probe.getObjectByName(n);
  const ft = [B('ball_l'), B('ball_r'), B('foot_l'), B('foot_r')], pel = B('pelvis'), restY = [t.Wb[t.bi.ball_l].elements[13], t.Wb[t.bi.ball_r].elements[13], t.Wb[t.bi.foot_l].elements[13], t.Wb[t.bi.foot_r].elements[13]];
  const sample = (clip, time) => { mx.stopAllAction(); const a = mx.clipAction(clip); a.play(); mx.setTime(time); probe.updateMatrixWorld(true); return a; };
  for (const s of ['l', 'r']) B('upperarm_' + s).position.add(t.shift[s]); // the narrowed shoulders (see classify)
  for (const name of CLIPS) {
    const c = src[name]; if (!c) throw new Error('clip missing: ' + name);
    const clip = c.clone(), tr = clip.tracks.find(k => k.name === 'pelvis.position');
    if (tr) for (let i = 0; i < tr.values.length; i++) tr.values[i] *= ratio;
    if (tr) { // lift the pelvis so the lowest sole touches the ground (jumps too: the controller lifts the whole group)
      let low = 1e9; const N = 24; for (let i = 0; i < N; i++) { sample(clip, clip.duration * i / N); for (let k = 0; k < 4; k++) low = Math.min(low, ft[k].matrixWorld.elements[13] - restY[k]); }
      for (let i = 2; i < tr.values.length; i += 3) tr.values[i] -= low;
    }
    t.clips[name] = clip;
  }
  for (const [key, name] of [['walk', 'Walk_Loop'], ['formal', 'Walk_Formal_Loop'], ['jog', 'Jog_Fwd_Loop'], ['sprint', 'Sprint_Loop'], ['crouch', 'Crouch_Fwd_Loop']]) { // model units per second
    const clip = t.clips[name], N = 48, dt = clip.duration / N, pz = new Float32Array(2), py = new Float32Array(2); let sum = 0, cnt = 0, fmax = -1e9, fi = 0;
    for (let i = 0; i <= N; i++) {
      sample(clip, i * dt); const p = pel.matrixWorld.elements[14];
      if (i < N) { const fz = ft[2].matrixWorld.elements[14] - p; if (fz > fmax) { fmax = fz; fi = i; } } // left foot furthest forward: phase 0 of the shared gait cycle
      for (let k = 0; k < 2; k++) { const e = ft[k].matrixWorld.elements, rz = e[14] - p; if (i > 0 && e[13] < 0.05 && py[k] < 0.05) { const v = -(rz - pz[k]) / dt; if (v > 0.2) { sum += v; cnt++; } } pz[k] = rz; py[k] = e[13]; }
    }
    t.speed[key] = cnt ? sum / cnt : { walk: 1.3, formal: 1.3, jog: 3.2, sprint: 5.2, crouch: 1 }[key]; t.off[name] = fi / N;
  }
  // where the pelvis ends up when seated (model units: y up, z forward of the feet); animate() moves the body so it lands on the seat
  sample(t.clips.Sitting_Idle_Loop, 0); t.sitY = pel.matrixWorld.elements[13]; t.sitZ = pel.matrixWorld.elements[14];
  // where the hands hang in the idle pose: held props are designed there and mapped back to the bind pose (rigid on the hand bone)
  sample(t.clips.Idle_Loop, 0);
  for (const s of ['l', 'r']) {
    const h = B('hand_' + s), W = h.matrixWorld.clone(); t.handIdle[s] = new THREE.Vector3().setFromMatrixPosition(W);
    t.Mhand[s] = t.Wb[t.bi['hand_' + s]].clone().multiply(W.invert());
  }
  const Z = new THREE.Vector3(0, 0, 1), qa = new THREE.Quaternion(), qb = new THREE.Quaternion(), vp = new THREE.Vector3(), corr = [], hs = t.H / 1.81, posOf = n => vp.setFromMatrixPosition(B(n).matrixWorld);
  // parent-frame axes (lateral, up, forward) at the idle pose for the procedural layers (kick, breathing, head look); signs picked by measuring
  const WX = new THREE.Vector3(1, 0, 0), WY = new THREE.Vector3(0, 1, 0), WZ = new THREE.Vector3(0, 0, 1);
  for (const n of AXB) { const b = B(n); b.parent.getWorldQuaternion(qa); qa.invert(); t.ax[n] = { x: WX.clone().applyQuaternion(qa), y: WY.clone().applyQuaternion(qa), z: WZ.clone().applyQuaternion(qa) }; }
  const probeSign = (n, ang, read) => { const b = B(n), saved = b.quaternion.clone(); probe.updateMatrixWorld(true); const a = read(); b.quaternion.premultiply(qb.setFromAxisAngle(t.ax[n].x, ang)); probe.updateMatrixWorld(true); const d = read() - a; b.quaternion.copy(saved); probe.updateMatrixWorld(true); return d; };
  t.sg.hip = probeSign('thigh_r', 0.3, () => posOf('foot_r').z) > 0 ? 1 : -1; // + = leg swings forward
  t.sg.knee = probeSign('calf_r', 0.5, () => posOf('foot_r').z) < 0 ? 1 : -1; // + = knee flexes (foot goes back)
  t.sg.arm = probeSign('upperarm_r', 0.5, () => posOf('hand_r').z) > 0 ? 1 : -1; // + = arm swings forward
  t.sg.lean = probeSign('spine_03', 0.3, () => posOf('Head').z) > 0 ? 1 : -1; // + = leans forward
  // corrections for the clip's stance (a ready-for-a-fight idle): lower the shoulders, bring the arms and feet in, open the fists. Each is a
  // constant rotation in the parent's frame, worked out here on the idle pose (the sign is picked by measuring), blended in per state at runtime.
  const fix = (name, kind, ang, metric) => {
    const b = B(name), saved = b.quaternion.clone(); let best = null, bm = 1e9;
    for (const s of [1, -1]) {
      probe.updateMatrixWorld(true); b.parent.getWorldQuaternion(qa);
      const loc = qa.clone().invert().multiply(qb.setFromAxisAngle(Z, s * ang)).multiply(qa);
      b.quaternion.premultiply(loc); probe.updateMatrixWorld(true); const m = metric(); b.quaternion.copy(saved);
      if (m < bm) { bm = m; best = loc; }
    }
    b.quaternion.premultiply(best); probe.updateMatrixWorld(true); corr.push({ n: name, k: kind, q: best });
  };
  for (const s of ['l', 'r']) fix('clavicle_' + s, CK.shoulder, 0.07, () => posOf('upperarm_' + s).y);
  for (const s of ['l', 'r']) { const tg = 0.25 * hs, ang = Math.min(0.3, Math.abs(Math.abs(posOf('hand_' + s).x) - tg) / 0.5); if (ang > 0.01) fix('upperarm_' + s, CK.arm, ang, () => Math.abs(Math.abs(posOf('hand_' + s).x) - tg)); } // hands about 25 cm off the midline: clear of the hips
  for (const s of ['l', 'r']) { const ang = Math.min(0.3, Math.max(0, (Math.abs(posOf('foot_' + s).x) - 0.125 * hs) / 0.88)); if (ang > 0.005) fix('thigh_' + s, CK.stance, ang, () => Math.abs(posOf('foot_' + s).x)); }
  for (const name in t.bi) if (/^(thumb|index|middle|ring|pinky)_0[1-3]_/.test(name)) corr.push({ n: name, k: CK.finger, rest: t.root.getObjectByName(name).quaternion.clone() });
  t.corr = corr;
  mx.stopAllAction(); mx.uncacheRoot(probe);
}

// ---------- body material: clothing colours from uniforms ----------
// SKIN_GAIN / CLOTH_GAIN are brightness trims against the scene lighting (skin has a low albedo and reads darker than its hex otherwise).
const SKIN_GAIN = '1.45', CLOTH_GAIN = '1.1';
const BODY_PARS = `uniform float uSleeve; uniform float uHem; uniform vec2 uPuff; uniform vec3 uSkin; uniform vec3 uTop; uniform vec3 uBottom; uniform vec3 uShoe; uniform vec3 uSkinRef; uniform float uLumRef; uniform float uShoeSkin;`;
const BODY_VERT_N = `
#include <beginnormal_vertex>
float cwT = aMask.y * (1.0 - smoothstep(uSleeve - 0.15, uSleeve, aLimb.x)), cwB = aMask.z * (1.0 - smoothstep(uHem - 0.15, uHem, aLimb.y));
objectNormal = normalize(mix(objectNormal, aFlat, 0.9 * min(1.0, cwT + cwB)));`;
const BODY_VERT = `
#include <begin_vertex>
vMask = aMask; vLimb = aLimb;
transformed += normalize(mix(normal, aFlat, 0.85)) * (cwT * uPuff.x + cwB * uPuff.y);`;
const BODY_FRAG = `
float gSkin = 1.0;
#include <map_fragment>
#ifdef USE_MAP
{
  vec3 tx = sampledDiffuseColor.rgb;
  float sh = clamp(dot(tx, vec3(0.2126, 0.7152, 0.0722)) / uLumRef, 0.4, 1.5);
  float cutT = 1.0 - smoothstep(uSleeve - 0.04, uSleeve + 0.04, vLimb.x);
  float cutB = 1.0 - smoothstep(uHem - 0.04, uHem + 0.04, vLimb.y);
  vec4 w = vec4(vMask.x + vMask.y * (1.0 - cutT) + vMask.z * (1.0 - cutB), vMask.y * cutT, vMask.z * cutB, vMask.w);
  w = clamp((w - 0.5) * 3.0 + 0.5, 0.0, 1.0); w /= (w.x + w.y + w.z + w.w + 1e-4);
  vec3 skinC = uSkin * ${SKIN_GAIN} * mix(vec3(sh), clamp(tx / uSkinRef, 0.35, 1.8), 0.7);
  float cs = mix(1.0, sh, 0.12) * ${CLOTH_GAIN};
  diffuseColor.rgb = skinC * w.x + uTop * cs * w.y + uBottom * cs * w.z + uShoe * mix(1.0, sh, 0.3) * ${CLOTH_GAIN} * w.w;
  gSkin = w.x + w.w * uShoeSkin;
}
#endif`;
const BODY_NORMAL = `
vec3 nBase = normal;
#include <normal_fragment_maps>
normal = normalize(mix(normal, nBase, 0.85 * (1.0 - gSkin)));`;
function bodyBeforeCompile(shader) {
  Object.assign(shader.uniforms, this.userData.U);
  shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nattribute vec4 aMask; attribute vec2 aLimb; attribute vec3 aFlat; varying vec4 vMask; varying vec2 vLimb;\n' + BODY_PARS)
    .replace('#include <beginnormal_vertex>', BODY_VERT_N).replace('#include <begin_vertex>', BODY_VERT);
  shader.fragmentShader = shader.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec4 vMask; varying vec2 vLimb;\n' + BODY_PARS).replace('#include <map_fragment>', BODY_FRAG)
    .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = mix(0.93, 0.72, gSkin);').replace('#include <normal_fragment_maps>', BODY_NORMAL);
}
function bodyMaterial(base) {
  const m = base.clone(), ref = base.userData.skinRef || [0.39, 0.18, 0.08];
  const col = () => ({ value: new THREE.Color() });
  m.userData = { U: { uSkin: col(), uTop: col(), uBottom: col(), uShoe: col(), uSkinRef: { value: new THREE.Color().setRGB(ref[0], ref[1], ref[2], THREE.LinearSRGBColorSpace) }, uLumRef: { value: base.userData.lumRef || 0.22 },
    uSleeve: { value: 2.2 }, uHem: { value: 3 }, uPuff: { value: new THREE.Vector2(0.025, 0.02) }, uShoeSkin: { value: 0 } } };
  m.onBeforeCompile = bodyBeforeCompile; m.customProgramCacheKey = () => 'realbody1';
  return m;
}
const SLEEVE = { tshirt: 0.5, uniform: 0.65, blouse: 1.0, shirt: 2.2, kurta: 2.2, robe: 2.2 };
function hemFor(a) { const b = a.bottomStyle; return b === 'shorts' ? (a.kid ? 0.8 : 0.85) : b === 'skirt' ? 0.2 : b === 'dhoti' ? 1.6 : 3; }

// ---------- dress: pieces welded into one skinned geometry ----------
// Pieces are given in the bind pose (the T-pose the meshes are authored in) and weighted to bones; hand-held things are designed in the
// idle pose and carried back to the bind pose with the hand bone's matrix, so they sit in the hand when the arm hangs down.
class Acc {
  constructor() { this.p = []; this.n = []; this.c = []; this.uv = []; this.si = []; this.sw = []; this.ix = []; this.count = 0; }
  // g: BufferGeometry (optionally moved by M); col: [r,g,b] or fn(i, x, y, z); infl: [[bone, weight], ...] or fn(i, x, y, z); uvT: optional (u, v) => [u, v] that remaps the geometry's uv (woven cloth samples one atlas)
  geo(g, col, infl, M, uvT) {
    if (M) g.applyMatrix4(M); if (!g.attributes.normal) g.computeVertexNormals();
    const pos = g.attributes.position, nor = g.attributes.normal, uv = g.attributes.uv, ix = g.index, base = this.count;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i), c = typeof col === 'function' ? col(i, x, y, z) : col, f = typeof infl === 'function' ? infl(i, x, y, z) : infl, u = uv ? uv.getX(i) : 0, v = uv ? uv.getY(i) : 0, t = uvT ? uvT(u, v) : [u, v];
      this.p.push(x, y, z); this.n.push(nor.getX(i), nor.getY(i), nor.getZ(i)); this.c.push(c[0], c[1], c[2]); this.uv.push(t[0], t[1]);
      for (let k = 0; k < 4; k++) { this.si.push(k < f.length ? f[k][0] : 0); this.sw.push(k < f.length ? f[k][1] : 0); }
    }
    if (ix) for (let i = 0; i < ix.count; i++) this.ix.push(base + ix.getX(i)); else for (let i = 0; i < pos.count; i++) this.ix.push(base + i);
    this.count += pos.count; g.dispose();
  }
  build() {
    if (!this.count) return null; const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(this.n, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(this.c, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(this.si, 4)); g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(this.sw, 4)); g.setIndex(this.ix); return g;
  }
}
const rgb = hex => { _c.set(hex); return [_c.r, _c.g, _c.b]; };
const mul = (c, k) => [c[0] * k, c[1] * k, c[2] * k];
// a grid surface from P(u, v) -> [x, y, z], cols x rows quads, optionally closed around u (skirts)
function grid(P, cols, rows, closed) {
  const nc = closed ? cols : cols + 1, pos = new Float32Array(nc * (rows + 1) * 3), uv = new Float32Array(nc * (rows + 1) * 2), ix = [];
  for (let r = 0; r <= rows; r++) for (let c = 0; c < nc; c++) { const q = P(c / cols, r / rows), o = (r * nc + c) * 3, k = (r * nc + c) * 2; pos[o] = q[0]; pos[o + 1] = q[1]; pos[o + 2] = q[2]; uv[k] = c / cols; uv[k + 1] = r / rows; }
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const a = r * nc + c, b = r * nc + (c + 1) % nc, cc = (r + 1) * nc + c, d = (r + 1) * nc + (c + 1) % nc; ix.push(a, cc, b, b, cc, d);
  }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.BufferAttribute(uv, 2)); g.setIndex(ix); g.computeVertexNormals(); return g;
}
const SEC = { rx: 0, zf: 0, zb: 0 };
function torsoInfl(t, y) { // weights along the spine for something wrapped round the body
  const b = t.bi;
  if (y >= t.s3Y) return [[b.spine_03, 1]];
  if (y >= t.s1Y) { const w = (y - t.s1Y) / (t.s3Y - t.s1Y); return [[b.spine_01, 1 - w], [b.spine_03, w]]; }
  if (y >= t.pelvisY) { const w = (y - t.pelvisY) / (t.s1Y - t.pelvisY); return [[b.pelvis, 1 - w], [b.spine_01, w]]; }
  return [[b.pelvis, 1]];
}
// one point on a skirt: a around the body (0 = front, + = wearer's left), v from waist (0) to hem (1), out = extra radius
function skirtPoint(t, o, a, v, out = 0) {
  const gr = o.grow || 0.03; t.sec(o.top, SEC); const ax0 = SEC.rx + gr, az0 = (SEC.zf - SEC.zb) / 2 + gr, cz = (SEC.zf + SEC.zb) / 2;
  const y = o.top + (o.hem - o.top) * v; t.sec(Math.max(y, SY0), SEC);
  const fl = o.flare * Math.pow(v, 0.7), rv = o.rv || [0.08, 0.35], mn = o.room && v > rv[0] ? o.room * smooth(rv[0], rv[1], v) : 0, back = mn ? (o.back ?? 0.06) * smooth(0.12, 0.7, v) : 0; // room: a minimum radius for loose skirts so the thighs have space; legs swing back further than forward, so a loose skirt hangs a little behind
  return [Math.sin(a) * (Math.max(ax0 + fl, SEC.rx + gr + 0.01, mn * 1.08) + out), y, cz - back + Math.cos(a) * (Math.max(az0 + fl, (SEC.zf - SEC.zb) / 2 + gr + 0.01, mn * (o.zk ?? 1)) + back + out)];
}
// weights for a skirt: pelvis, both thighs (so the middle of the front and back follows their average) and, low down, the calf on the vertex's own side
function skirtInfl(t, o) {
  const b = t.bi, span = o.top - o.hem || 1;
  return (i, x, y) => {
    const tw = o.tw || [0.1, 0.9], v = (o.top - y) / span, wt = o.thigh * smooth(tw[0], tw[1], v), s = smooth(-0.06, 0.06, x), sd = 2 * s - 1, wc = (o.calf || 0) * smooth(0.45, 1, v) * Math.abs(sd);
    return [[b.pelvis, 1 - wt - wc], [b.thigh_l, wt * s], [b.thigh_r, wt * (1 - s)], [sd >= 0 ? b.calf_l : b.calf_r, wc]];
  };
}
// a flared garment hanging from the waist, following both thighs a little so it does not stay rigid when sitting or striding.
// o.grow is how far it stands off the body (the painted garments are puffed ~2.5 cm, so layers go outward from there).
// o.motif (a colour) makes it a woven mekhela: finer grid and small butas over the body. With o.cloth the garment is textured (clothMaterial) instead of
// painted by vertex colours: an open grid whose last column repeats the first, sampling the left half of the atlas; addPleats adds the folds.
function addSkirt(acc, t, o) {
  const S = o.motif ? 32 : 12, R = o.motif ? 16 : 6, front = a => smooth(0.78, 0.92, Math.cos(a)); // the pleated panel: about 40 degrees either side of the front
  const g = grid((u, v) => { const a = u * Math.PI * 2, pleat = !o.cloth && o.motif && Math.round(u * S) % 2 ? 0.016 * front(a) * smooth(0.04, 0.22, v) : 0; return skirtPoint(t, o, a, v, pleat); }, S, R, !o.cloth);
  if (o.cloth) { // one seam column: share its normals so the shading does not break at the front
    const nor = g.attributes.normal; for (let r = 0; r <= R; r++) { const i = r * (S + 1), j = i + S, x = nor.getX(i) + nor.getX(j), y = nor.getY(i) + nor.getY(j), z = nor.getZ(i) + nor.getZ(j), l = Math.hypot(x, y, z) || 1; nor.setXYZ(i, x / l, y / l, z / l); nor.setXYZ(j, x / l, y / l, z / l); }
    acc.geo(g, [1, 1, 1], skirtInfl(t, o), null, (u, v) => [0.5 * u, 1 - v]); return;
  }
  const span = o.top - o.hem || 1, rimC = [o.col[0] * o.rim[0], o.col[1] * o.rim[1], o.col[2] * o.rim[2]];
  const plain = (i, x, y) => { const v = (o.top - y) / span; return v < 0.07 ? mul(o.col, 0.78) : v > 0.93 ? rimC : o.col; };
  const woven = i => { // grid vertex i = row * S + column (closed grid)
    const c = i % S, r = Math.floor(i / S), M = o.motif;
    if (r === 0) return mul(o.col, 0.78);                                                     // waist band
    if (r >= R - 1) return M;                                                                 // woven hem
    if (r === R - 4 || r === R - 2) return M;                                                 // border lines
    if (r === R - 3) return c % 3 === 0 ? M : c % 3 === 1 ? rimC : o.col;                     // kingkhap-like run between them
    if (r % 3 === 1 && r < R - 5 && c % 4 === (r % 2 ? 0 : 2)) return mul(M, 0.92);            // butas
    return c % 2 && Math.cos(c / S * Math.PI * 2) > 0.8 && r < R - 4 ? mul(o.col, 0.86) : o.col; // shade every other front pleat
  };
  acc.geo(g, o.motif ? woven : plain, skirtInfl(t, o));
}
// the kochi: about nine deep folds tucked in at the waist a little right of centre, fanning out toward the hem
function addPleats(acc, t, o) {
  const A0 = -0.32, W = 0.42, N = 9;
  const g = grid((u, v) => {
    const w = W * (0.55 + 0.45 * smooth(0, 0.3, v)), a = A0 + (u - 0.5) * 2 * w;
    const d = 0.017 * Math.abs(Math.sin(u * N * Math.PI)) * smooth(0, 0.08, u) * (1 - smooth(0.92, 1, u)) * smooth(0.14, 0.3, v); // below the blouse hem only: above it the folds would poke through
    return skirtPoint(t, o, a, v, 0.006 + d);
  }, 48, 12, false);
  acc.geo(g, [1, 1, 1], skirtInfl(t, o), null, (u, v) => [0.5 * (0.42 + 0.16 * u), 1 - v]); // samples the skirt's own texture, hem border included
}
// a point on the torso's surface at height y and angle a (0 = front, +a toward the left), pushed out by grow; the shoulder cap widens it near the clavicles
const GROW = 0.05;
function ringAt(t, y, a, grow) {
  t.sec(y, SEC); const rx = Math.max(SEC.rx, y > t.clavY - 0.14 ? SEC.rs * 0.95 : 0) + grow, zf = SEC.zf + grow, zb = -SEC.zb + grow, c = Math.cos(a);
  return [Math.sin(a) * rx, y, c >= 0 ? zf * c : zb * c];
}
// chador / sari drape: a wide sash from the left shoulder across the chest to the right hip, and a panel down the back, both with a darker
// border. With a motif colour (a mekhela's chador) the borders are woven in that colour and the back panel carries butas.
function addWrap(acc, t, col, motif) {
  const yS = t.clavY + 0.03, yH = t.pelvisY + 0.02, yB = t.pelvisY - 0.2, edge = motif || mul(col, 0.62);
  const SC = motif ? 24 : 16, SR = motif ? 5 : 3, CC = motif ? 16 : 12, CR = motif ? 14 : 10;
  const sash = grid((u, v) => ringAt(t, yS - (yS - yH) * u + (v - 0.5) * 0.22, 1.2 - 2.4 * u, GROW), SC, SR, false);
  acc.geo(sash, (i) => { const r = Math.floor(i / (SC + 1)), c = i % (SC + 1), v = r / SR; if (v < 0.2 || v > 0.8) return edge; return motif && r === 2 && c % 3 === 1 ? mul(motif, 0.95) : col; }, (i, x, y) => torsoInfl(t, y));
  const cape = grid((u, v) => ringAt(t, yS + 0.02 - (yS - yB) * v, Math.PI + (u - 0.5) * 2.6, GROW), CC, CR, false);
  acc.geo(cape, (i) => {
    const r = Math.floor(i / (CC + 1)), c = i % (CC + 1);
    if (r >= CR - 1) return edge;
    if (!motif) return col;
    if (r === CR - 3) return edge;                                       // border line above the woven end
    if (r === CR - 2) return c % 2 ? mul(motif, 0.85) : col;            // the end panel's motif run
    return r % 3 === 1 && c % 3 === (r % 2 ? 0 : 2) && r < CR - 4 ? motif : col; // butas
  }, (i, x, y) => torsoInfl(t, y));
}
// sador / pallu: from the right hip across the chest to the LEFT shoulder, over it, and the end (anchal) hanging down the back to mid-thigh.
// uv.x runs along the cloth's length (0.5..1 of the atlas: the anchal is the end with the big motifs), uv.y across its width.
function addSador(acc, t) {
  const yS = t.clavY + 0.03, yH = t.pelvisY + 0.1, yEnd = t.pelvisY - 0.42, G = GROW + 0.008, AC = 2.35, AW = 0.55;
  const along = (f0, f1) => (u, v) => [0.5 + 0.5 * (f0 + (f1 - f0) * u), v];
  const sash = grid((u, v) => ringAt(t, yH + (yS - yH) * u + (v - 0.5) * 0.3, -1.2 + 2.4 * u, G + 0.035 * (1 - smooth(0, 0.55, u))), 24, 5, false);  // right hip -> left shoulder; stands off the blouse's flared hem at its start
  acc.geo(sash, [1, 1, 1], (i, x, y) => torsoInfl(t, y), null, along(0, 0.5));
  const over = grid((u, v) => ringAt(t, yS + 0.04 * Math.sin(u * Math.PI) + (v - 0.5) * 0.06, 1.2 + (AC - 1.2) * u, G + 0.01), 10, 3, false); // over the left shoulder
  acc.geo(over, [1, 1, 1], (i, x, y) => torsoInfl(t, y), null, along(0.5, 0.62));
  const anchal = grid((u, v) => { const y = yS - (yS - yEnd) * v, yy = Math.max(y, t.pelvisY), p = ringAt(t, yy, AC + (u - 0.5) * 2 * AW, G + 0.03 + 0.05 * smooth(0, 1, (t.pelvisY - y) / (t.pelvisY - yEnd))); p[1] = y; return p; }, 8, 16, false);
  acc.geo(anchal, [1, 1, 1], (i, x, y) => torsoInfl(t, Math.max(y, t.pelvisY)), null, (u, v) => [0.5 + 0.5 * (0.62 + 0.38 * v), u]);
}
// gamosa: a band round the back of the neck and over the shoulders, then a strip hanging down each side of the chest to about the waist
// (white cotton, red woven border at the ends and along the edges), standing a little off the body
function addGamosa(acc, t) {
  const white = [0.95, 0.95, 0.93], red = [0.85, 0.05, 0.04], yN = t.neckY - 0.03, yW = t.pelvisY + 0.1;
  const band = grid((u, v) => ringAt(t, yN + (v - 0.5) * 0.07, 0.55 + u * (Math.PI * 2 - 1.1), 0.035), 20, 1, false);
  acc.geo(band, white, (i, x, y) => torsoInfl(t, y));
  for (const sx of [1, -1]) {
    const strip = grid((u, v) => ringAt(t, yN - (yN - yW) * v, sx * (0.3 + 0.5 * u), 0.04), 4, 24, false);
    acc.geo(strip, (i) => { const r = Math.floor(i / 5) / 24, c = i % 5; return r > 0.84 && (r < 0.9 || r > 0.93) || c === 0 || c === 4 || (r > 0.70 && r < 0.82 && c === 2 && Math.floor(r * 48) % 2 === 0) ? red : white; }, (i, x, y) => torsoInfl(t, y)); // the dashed red diamond row above the woven end
  }
}
function addHat(acc, t, kind, tint) {
  const hw = t.headHW, h = [[t.bi.Head, 1]], cx = t.headX, cz = t.headZ, top = t.headTop;
  if (kind === 'japi') {
    const cone = new THREE.CylinderGeometry(0.02, hw * 3.5, 0.17, 14); cone.translate(cx, top + 0.005, cz); acc.geo(cone, rgb('#cdb072'), h);
    const knob = new THREE.CylinderGeometry(0.008, 0.016, 0.05, 6); knob.translate(cx, top + 0.1, cz); acc.geo(knob, [1, 0.1, 0.08], h);
  } else if (kind === 'cap') {
    const dome = new THREE.SphereGeometry(hw * 1.2, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2); dome.scale(1, 0.9, 1.1); dome.translate(cx, top - 0.075, cz); acc.geo(dome, tint, h);
    const brim = new THREE.BoxGeometry(hw * 1.5, 0.012, 0.085); brim.translate(cx, top - 0.065, cz + hw * 1.25); acc.geo(brim, tint, h);
  } else if (kind === 'topi') {
    const c = new THREE.CylinderGeometry(hw * 1.1, hw * 1.15, 0.085, 14); c.translate(cx, top - 0.01, cz); acc.geo(c, rgb('#efe6d0'), h);
  }
}
// everything the character carries or wears on top of the painted body; returns null when there is nothing to add
function buildDress(t, a) {
  const acc = new Acc(), cloth = new Acc(), b = t.bi, H = t.H, k = H / 1.65, ts = a.topStyle, bs = a.bottomStyle, rim = [1, 0.86, 0.58], kid = !!a.kid;
  const waist = t.pelvisY + 0.07, bot = rgb(a.bottom), top = rgb(a.top);
  const motif = bs === 'mekhela' || bs === 'sari' ? rgb(a.motif || '#a3172b') : null; // the woven motifs, their own colour (red or gold on silk), not the blouse's
  if (bs === 'mekhela' || bs === 'sari') {
    // a mekhela is a straight tube with the pleats (kochi) tucked at the front right; a sari hangs much the same below the waist
    const o = { top: waist, hem: H * 0.045, flare: bs === 'mekhela' ? 0.05 : 0.07, col: bot, rim, thigh: 0.85, calf: 0.3, room: 0.235 * t.H / 1.81, rv: [0.03, 0.2], tw: [0, 0.4], back: 0.1, zk: 1.1, motif, cloth: true }; // room from just below the waist and the cloth following the thighs from the top: a tight tube still has to let a stride through
    addSkirt(cloth, t, o); addPleats(cloth, t, o);
  } else if (bs === 'skirt') addSkirt(acc, t, { top: waist, hem: H * (kid ? 0.35 : 0.3), flare: 0.12, col: bot, rim: [1, 1, 1], thigh: 0.4 });
  else if (bs === 'dhoti') addSkirt(acc, t, { top: waist, hem: H * 0.15, flare: 0.1, col: bot, rim: [1, 1, 1], thigh: 0.4, calf: 0.25, room: 0.22 * t.H / 1.81 });
  if (ts === 'kurta') addSkirt(acc, t, { top: waist + 0.05, hem: H * 0.31, flare: 0.08, col: top, rim: [1, 1, 1], thigh: 0.35, grow: 0.05 });
  else if (ts === 'robe') addSkirt(acc, t, { top: waist + 0.05, hem: H * 0.28, flare: 0.13, col: top, rim: [1, 1, 1], thigh: 0.4, grow: 0.05 });
  else if (ts === 'blouse') addSkirt(acc, t, { top: waist + 0.06, hem: t.pelvisY - 0.06, flare: 0.04, col: top, rim: [1, 1, 1], thigh: 0.1, grow: 0.045 });
  if (a.wrap) { if (bs === 'mekhela' || bs === 'sari') addSador(cloth, t); else addWrap(acc, t, rgb(a.wrap), motif); }
  if (a.gamosa) addGamosa(acc, t);
  const hat = a.hat || (a.hairStyle === 'cap' ? 'cap' : null);
  if (hat) addHat(acc, t, hat, rgb(a.hatColor || CAPS[(a.top.charCodeAt(1) + a.top.charCodeAt(3)) % CAPS.length]));
  // Bihu dress: kopou phool (orchids) in the bun and a gold bangle at each wrist, on silk mekhela only
  if (bs === 'mekhela' && a.fabric === 'silk') {
    const H1 = [[b.Head, 1]], pinks = ['#c25aa8', '#e7a6d6'];
    for (let q = 0; q < 5; q++) { const g = new THREE.SphereGeometry(0.014, 6, 5), an = q / 5 * Math.PI * 2; g.translate(t.headX + Math.cos(an) * 0.03, t.headTop - 0.012 + Math.sin(an) * 0.014, t.headZ - t.headHW * 0.55); acc.geo(g, rgb(pinks[q % 2]), H1); }
    for (const s of ['l', 'r']) { const h = t.handIdle[s], g = new THREE.TorusGeometry(0.04, 0.008, 6, 14); g.rotateX(Math.PI / 2); g.translate(h.x, h.y + 0.02, h.z); acc.geo(g, rgb('#d4a537'), [[b['hand_' + s], 1]], t.Mhand[s]); }
  }
  // footwear: a thin chappal sole under each foot (not for kids, who are often barefoot, nor the robed)
  if (!kid && ts !== 'robe') {
    const sc = rgb(['#3a2a20', '#7a2e2e', '#2a2a2a'][hashStr(a.top + a.bottom) % 3]);
    for (const s of ['l', 'r']) { const f = t.Wb[b['foot_' + s]].elements, bl = t.Wb[b['ball_' + s]].elements, g = new THREE.BoxGeometry(0.085, 0.015, Math.abs(bl[14] - f[14]) + 0.16); g.translate((f[12] + bl[12]) / 2, 0.0075, (f[14] + bl[14]) / 2 + 0.03); acc.geo(g, sc, [[b['foot_' + s], 1]]); }
  }
  // hand-held: phone, umbrella (furled) or stick in the right hand; a hand bag goes to the left when the right is busy
  const hr = t.handIdle.r, hl = t.handIdle.l, hold = a.phone ? 'phone' : a.umbrella ? 'umb' : a.stick ? 'stick' : null, R = [[b.hand_r, 1]], L = [[b.hand_l, 1]];
  if (hold === 'phone') { const g = new THREE.BoxGeometry(0.035, 0.1, 0.014); g.translate(hr.x, hr.y - 0.02, hr.z + 0.03); acc.geo(g, [0.08, 0.08, 0.1], R, t.Mhand.r); }
  else if (hold === 'umb') {
    const pole = new THREE.CylinderGeometry(0.011, 0.011, 0.95 * k, 6); pole.translate(hr.x, hr.y - 0.33 * k, hr.z); acc.geo(pole, [0.2, 0.2, 0.2], R, t.Mhand.r);
    const can = new THREE.CylinderGeometry(0.05, 0.012, 0.62 * k, 8); can.translate(hr.x, hr.y - 0.34 * k, hr.z); acc.geo(can, rgb(a.umbrella), R, t.Mhand.r);
  } else if (hold === 'stick') { const len = (hr.y + 0.07) - 0.02, g = new THREE.CylinderGeometry(0.015, 0.012, len, 6); g.translate(hr.x, 0.02 + len / 2, hr.z); acc.geo(g, rgb('#6b4a2c'), R, t.Mhand.r); }
  if (a.bag) {
    const back = a.bagStyle ? a.bagStyle === 'back' : (ts === 'uniform' || kid);
    if (back) { t.sec(t.s3Y, SEC); const g = new THREE.BoxGeometry(SEC.rx * 1.3, 0.34 * k, 0.13 * k); g.translate(0, t.s3Y + 0.03, SEC.zb - 0.05 - 0.065 * k); acc.geo(g, rgb(a.bag), [[b.spine_03, 1]]); }
    else { const h = hold ? hl : hr, g = new THREE.BoxGeometry(0.1 * k, 0.2 * k, 0.16 * k); g.translate(h.x, h.y - 0.13 * k, h.z); acc.geo(g, rgb(a.bag), hold ? L : R, hold ? t.Mhand.l : t.Mhand.r); }
  }
  return { props: acc.build(), cloth: cloth.build() };
}
let PROP_MAT = null;
const propMaterial = () => PROP_MAT || (PROP_MAT = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, metalness: 0, side: THREE.DoubleSide }));

// one 1024 x 512 canvas per outfit: left half the mekhela (x around the body, y from the waist down to the hem),
// right half the sador (x along its length, the last eighth the anchal; y across its width). Shared across rigs by colour key.
const CLOTH = new Map();
function clothMaterial(base, sador, motif, silk) {
  const key = [base, sador, motif, silk].join(); if (CLOTH.has(key)) return CLOTH.get(key);
  const cv = document.createElement('canvas'); cv.width = 1024; cv.height = 512; const g = cv.getContext('2d');
  const dia = (cx, cy, r, c) => { g.fillStyle = c; g.beginPath(); g.moveTo(cx, cy - r); g.lineTo(cx + r, cy); g.lineTo(cx, cy + r); g.lineTo(cx - r, cy); g.closePath(); g.fill(); };
  // mekhela: plain body with sparse butas, a woven border above the hem (thin line, a run of stepped lozenges, a solid edge)
  g.fillStyle = base; g.fillRect(0, 0, 512, 512);
  g.globalAlpha = 0.06; g.fillStyle = '#000'; for (let x = 0; x < 512; x += 3) g.fillRect(x, 0, 1, 512); g.globalAlpha = 1;
  for (let row = 0; row < 9; row++) for (let col = 0; col < 16; col++) { const y = 140 + row * 30, x = col * 32 + (row % 2) * 16 + 8; if (y < 400) dia(x, y, 4, motif); }
  g.fillStyle = motif; g.fillRect(0, 418, 512, 4); g.fillRect(0, 486, 512, 3); g.fillRect(0, 494, 512, 18);
  for (let x = 0; x < 512; x += 24) { dia(x + 12, 454, 15, motif); dia(x + 12, 454, 8, base); dia(x + 12, 454, 3, motif); }
  // sador: borders along both long edges with a motif run inside them; the anchal end carries rows of big motifs
  g.fillStyle = sador; g.fillRect(512, 0, 512, 512);
  g.fillStyle = motif; g.fillRect(512, 0, 512, 24); g.fillRect(512, 488, 512, 24); g.fillRect(890, 0, 4, 512);
  for (let x = 522; x < 1024; x += 22) { dia(x, 40, 7, motif); dia(x, 472, 7, motif); }
  for (let row = 0; row < 6; row++) for (let x = 905; x < 1024; x += 30) dia(x + (row % 2) * 15, 80 + row * 64, 13, motif);
  const map = new THREE.CanvasTexture(cv); map.colorSpace = THREE.SRGBColorSpace; map.anisotropy = 4;
  const m = new THREE.MeshPhysicalMaterial({ map, roughness: silk ? 0.5 : 0.85, sheen: silk ? 0.8 : 0.25, sheenRoughness: silk ? 0.35 : 0.8, sheenColor: new THREE.Color(silk ? '#fff0c4' : '#ffffff'), side: THREE.DoubleSide });
  CLOTH.set(key, m); return m;
}

// ---------- hair choice ----------
function hairFor(a, female) {
  const hs = a.hairStyle, hat = a.hat || (hs === 'cap' ? 'cap' : null);
  if (hs === 'bald') return null;
  if (hs === 'long') return 'Hair_Long';
  if (hs === 'bun') return 'Hair_Buns';
  if (hs === 'cap' || hat) return female ? 'Hair_BuzzedFemale' : 'Hair_Buzzed';
  return female ? 'Hair_BuzzedFemale' : 'Hair_SimpleParted';
}

// ---------- one body instance ----------
function makeRig(t) {
  const root = cloneSkinned(t.root); let body = null, eyes = null, brows = null;
  root.traverse(o => { if (!o.isSkinnedMesh) return; const n = o.material.name; if (n === 'Body') body = o; else if (n === 'Eyes') eyes = o; else brows = o; });
  const bodyMat = bodyMaterial(body.material), browMat = brows.material.clone(), hairMats = [HAIR.mats[0].clone(), HAIR.mats[1].clone()];
  body.material = bodyMat; brows.material = browMat;
  for (const m of [body, eyes, brows]) { m.frustumCulled = false; m.userData.noMerge = true; }
  body.castShadow = true; body.receiveShadow = true; eyes.castShadow = false; brows.castShadow = false;
  const head = root.getObjectByName('Head'), mk = () => { const m = new THREE.Mesh(undefined, hairMats[0]); m.castShadow = true; m.userData.noMerge = true; m.frustumCulled = false; m.visible = false; head.add(m); return m; };
  for (const s of ['l', 'r']) root.getObjectByName('upperarm_' + s).position.add(t.shift[s]);
  const cb = t.corr.map(c => ({ bone: root.getObjectByName(c.n), k: c.k, q: c.q, rest: c.rest }));
  const bn = {}; for (const n of AXB) bn[n] = root.getObjectByName(n);
  const rig = { cb, cw: new Float32Array(4), cwSet: false, t, root, body, eyes, brows, bodyMat, browMat, hairMats, head, hair: mk(), beard: mk(), props: null, cloth: null, mixer: new THREE.AnimationMixer(root), ent: {}, tw: {}, tm: {}, bn, fq: 1, fresh: true, trk: [], trkOf: new Map() };
  root.visible = false; return rig;
}
function dress(rig, a, female) {
  const t = rig.t, U = rig.bodyMat.userData.U, st = a.topStyle;
  U.uSkin.value.set(a.skin); U.uTop.value.set(a.top); U.uBottom.value.set(a.bottom);
  U.uSleeve.value = st === 'shirt' && a.sleeves === 'short' ? 1.0 : SLEEVE[st] || 2.2; U.uHem.value = hemFor(a);
  const bare = st === 'robe' || (a.kid && hashStr(a.top + a.bottom) % 3 === 0);
  if (bare) { U.uShoe.value.set(a.skin); U.uShoeSkin.value = 1; } else { U.uShoe.value.set(SHOES[hashStr(a.top + a.bottom) % SHOES.length]); U.uShoeSkin.value = 0; }
  // hair, eyebrows, beard
  _c.set(a.hair); const lum = 0.2126 * _c.r + 0.7152 * _c.g + 0.0722 * _c.b, lr = HAIR.mats[0].userData.lumRef || 0.4;
  rig.browMat.color.copy(_c).multiplyScalar(0.75);
  for (let i = 0; i < 2; i++) rig.hairMats[i].color.copy(_c).multiplyScalar(1 / (HAIR.mats[i].userData.lumRef || lr));
  const hn = hairFor(a, female), hs = hn && HAIR.styles[hn];
  rig.hair.visible = !!hs; if (hs) { rig.hair.geometry = hs.geometry; rig.hair.material = rig.hairMats[hs.tex]; }
  const bs = HAIR.styles.Hair_Beard, h = hashStr(a.top + a.hair + a.bottom), beard = a.beard !== undefined ? !!a.beard : !female && !a.kid && a.hairStyle !== 'bald' && ((lum > 0.15 && h % 5 < 3) || h % 7 === 0);
  rig.beard.visible = !!(beard && bs); if (bs) { rig.beard.geometry = bs.geometry; rig.beard.material = rig.hairMats[0]; }
  rig.head.scale.setScalar(a.kid ? 1.25 : 1);
  // dress: rebuilt on every change (small, and changes are rare)
  const d = buildDress(t, a), cmat = d.cloth && clothMaterial(a.bottom, a.wrap || a.bottom, a.motif || '#a3172b', a.fabric === 'silk');
  const put = (key, g, mat) => { // one skinned mesh per kind of piece (painted props, woven cloth), made on first use and re-filled on every re-dress
    let m = rig[key];
    if (!m) { if (!g) return; m = new THREE.SkinnedMesh(g, mat); m.frustumCulled = false; m.castShadow = true; m.userData.noMerge = true; rig.body.parent.add(m); m.bind(rig.body.skeleton, rig.body.bindMatrix); rig[key] = m; return; }
    if (g) { const old = m.geometry; m.geometry = g; m.material = mat; old.dispose(); } m.visible = !!g;
  };
  put('props', d.props, propMaterial()); put('cloth', d.cloth, cmat);
}

// ---------- the character ----------
// Animation: every clip the character can play is a mixer action whose time and weight are driven here (timeScale 0). The gait loops share one
// phase and blend by speed (idle, walk, jog, sprint; crouch idle, crouch walk), so changing speed never switches clips with a pop and the stride
// follows the ground speed. One-shots (jump start / land, sit down / stand up, pick up) run from small sequences; kick, breathing and the idle
// head look are procedural rotations added on top of the mixer's result.
const SPEED_KEY = { Walk_Loop: 'walk', Walk_Formal_Loop: 'formal', Jog_Fwd_Loop: 'jog', Sprint_Loop: 'sprint', Crouch_Fwd_Loop: 'crouch' };
const LOCO_STATES = new Set(['idle', 'walk', 'run', 'crouch', 'kick']);
function makeRealCharacter(appearance = {}, opts = {}) {
  if (!ready) throw new Error('character models are not loaded');
  const group = new THREE.Group(); group.userData.noMerge = true;
  const pivot = new THREE.Group(); pivot.rotation.y = Math.PI / 2; group.add(pivot); // the models face +z, the game wants +x
  const rigs = { male: null, female: null }; let rig = null, A = DEF, sc = 1, stT = 0, lastSt = '', formal = false;
  let ph = Math.random(), jm = 0, jt = 0, sm = 0, sst = 0, pAir = false, pSit = false; // gait phase; jump mode (1 start, 2 loop, 3 land) and clock; sit mode (1 down, 2 seated, 3 up) and clock
  let dnT = Math.random() * 6, bt = Math.random() * 20, bph = Math.random() * 6.28, lookT = 0, lty = 0, ltp = 0, ly = 0, lp = 0; // breathing clock and phase, head look timer, target and current yaw / pitch
  const rigOf = g => { if (!rigs[g]) { rigs[g] = makeRig(TPL[g]); pivot.add(rigs[g].root); } return rigs[g]; };
  function setAppearance(app) {
    const a = { ...DEF, ...app }, female = !!a.female; A = a;
    if (rig) rig.root.visible = false;
    rig = rigOf(female ? 'female' : 'male'); rig.root.visible = true; rig.fresh = true; jm = sm = 0; pAir = pSit = false;
    sc = BASE_H * a.height / rig.t.H; pivot.scale.set(sc * (female ? 0.95 : 0.91) * (a.build || 1), sc, sc * 0.94);
    dress(rig, a, female);
    formal = a.topStyle === 'shirt' && a.bottomStyle === 'pants' && hashStr(a.top + a.bottom) % 2 === 0;
    out.height = BASE_H * a.height; lastSt = '';
  }
  const entOf = n => {
    let e = rig.ent[n]; if (e) return e;
    const clip = rig.t.clips[n], act = rig.mixer.clipAction(clip); act.setLoop(ONCE.has(n) ? THREE.LoopOnce : THREE.LoopRepeat, Infinity); act.clampWhenFinished = true; act.timeScale = 0; act.setEffectiveWeight(0); act.play();
    return (rig.ent[n] = { act, w: 0, t: 0, dur: clip.duration });
  };
  function animate(dt, o = {}) {
    if (!rig) return;
    const state = o.state || 'idle', sp = o.speed || 0, t = rig.t, ent = rig.ent, tw = rig.tw, tm = rig.tm, fresh = rig.fresh, dur = n => t.clips[n].duration;
    if (state !== lastSt) { lastSt = state; stT = 0; } else stT += dt;
    // ----- sequences
    const sitNow = state === 'sit' || (state === 'talk' && !!o.seated), air = state === 'jump';
    if (o.restart) { jm = 0; sm = sitNow ? 2 : 0; }
    if (fresh) { jm = air ? 2 : 0; sm = sitNow ? 2 : 0; }
    else {
      if (air && !pAir) { jm = 1; jt = 0; } else if (!air && pAir) { jm = sp < 1.2 ? 3 : 0; jt = 0; } // landing at a run goes straight into the stride
      if (sitNow && !pSit) { sm = 1; sst = 0; } else if (!sitNow && pSit) { sm = 3; sst = 0; }
    }
    pAir = air; pSit = sitNow; jt += dt; sst += dt;
    if (jm === 1 && JS.from + jt * JS.ts >= JS.end) jm = 2;
    if (jm === 3 && (jt * JL.ts >= JL.end || (sp > 0.8 && jt > 0.15) || !LOCO_STATES.has(state))) jm = 0;
    if (sm === 1 && sst >= dur('Sitting_Enter')) sm = 2;
    if (sm === 3 && (sst >= dur('Sitting_Exit') - 0.05 || (sp > 0.8 && sst > 0.25))) sm = 0;
    // ----- target weights (tw) and forced clip times (tm, -1 = let the loop run)
    for (const k in tw) tw[k] = 0; for (const k in tm) tm[k] = -1;
    const set = (n, w = 1, time = -1) => { tw[n] = (tw[n] || 0) + w; if (time >= 0) tm[n] = time; entOf(n); };
    let loco = false, pk = 0;
    if (state === 'ride') set('Driving_Loop');
    else if (state === 'fall') { if (stT < 0.4) set('Hit_Chest', 1, stT); else set('Crouch_Idle_Loop'); }
    else if (state === 'flinch') set('Hit_Chest', 1, stT);
    else if (sm === 1) set('Sitting_Enter', 1, sst);
    else if (sm === 3) set('Sitting_Exit', 1, sst);
    else if (sitNow) set(state === 'talk' ? 'Sitting_Talking_Loop' : 'Sitting_Idle_Loop');
    else if (state === 'floor') set('Crouch_Idle_Loop');
    else if (state === 'talk') set('Idle_Talking_Loop');
    else if (state === 'wave' || state === 'pray') set('Interact');
    else if (air) { if (jm === 1) set('Jump_Start', 1, JS.from + jt * JS.ts); else set('Jump_Loop'); }
    else if (state === 'pickup' && stT < PICK_T) { const p = stT / PICK_T; pk = smooth(0, 0.4, p) * (1 - smooth(0.6, 1, p)); set('Idle_Loop', 1 - pk); set('Crouch_Idle_Loop', pk); } // squat down (the crouch pose, blended in and out) and reach
    else if (jm === 3) set('Jump_Land', 1, jt * JL.ts);
    else loco = true;
    let fq = rig.fq;
    if (loco) {
      const cr = state === 'crouch', v = state === 'walk' || state === 'run' || cr ? sp : 0;
      if (cr) { const m = smooth(0.15, 0.6, v); set('Crouch_Idle_Loop', 1 - m); set('Crouch_Fwd_Loop', m); }
      else {
        const wn = formal ? 'Walk_Formal_Loop' : 'Walk_Loop', vw = t.speed[formal ? 'formal' : 'walk'] * sc, vj = t.speed.jog * sc, vs = t.speed.sprint * sc;
        const mv = smooth(0.3, 0.9, v), j = smooth(vw * 1.25, Math.max(vj * 0.8, vw * 1.25 + 0.3), v), s = smooth(vj * 1.1, Math.max(vs * 0.85, vj * 1.1 + 0.3), v);
        set('Idle_Loop', 1 - mv); if (mv > 0.001) { set(wn, mv * (1 - j)); if (j > 0) { set('Jog_Fwd_Loop', mv * j * (1 - s)); if (s > 0) set('Sprint_Loop', mv * j * s); } }
      }
      // one cadence for every gait clip in the blend: stride (m per cycle) and natural rate (cycles per s), averaged by weight
      let ws = 0, strd = 0, nat = 0;
      for (const n in SPEED_KEY) { const w = tw[n]; if (w > 0) { const d = dur(n); ws += w; strd += w * t.speed[SPEED_KEY[n]] * sc * d; nat += w / d; } }
      if (ws > 0.01) { nat /= ws; fq = Math.max(0.3, v) / (strd / ws); fq = Math.max(nat * 0.35, Math.min(nat * 1.9, fq)); rig.fq = fq; }
      ph = (ph + fq * dt) % 1;
    }
    // ----- clip times and eased weights
    let pn = '', pw = -1; for (const k in tw) if (tw[k] > pw) { pw = tw[k]; pn = k; }
    const step = dt / (FI[pn] || 0.2);
    let sum = 0;
    for (const n in ent) {
      const e = ent[n], g = tw[n] || 0;
      e.t = tm[n] >= 0 ? Math.min(tm[n], e.dur) : SYNC.has(n) ? ((ph + (t.off[n] || 0)) % 1) * e.dur : ONCE.has(n) ? e.t : (e.t + dt) % e.dur;
      e.w = fresh ? g : e.w + Math.max(-step, Math.min(step, g - e.w)); sum += e.w;
    }
    if (sum < 0.05) { for (const n in ent) ent[n].w = tw[n] || 0; }
    let sum2 = 0; for (const n in ent) { const e = ent[n]; if (e.w < 0.003) e.w = 0; sum2 += e.w; }
    if (sum2 < 1e-4) sum2 = 1;
    for (const n in ent) { const e = ent[n]; e.act.time = e.t; e.act.setEffectiveWeight(e.w / sum2); }
    rig.fresh = false;
    rig.mixer.update(0);
    // ----- on a seat: the clip leaves the hips wherever the shins put them (behind the feet, at knee height), so shift the whole body
    // to sit the pelvis on the seat point at the seat's height (o.seatH above the feet). Eased in through sitting down, out through
    // standing up; kids on a bench end up with their feet off the ground, as they should.
    const sw = !(o.seatH > 0) ? 0 : sm === 2 ? 1 : sm === 1 ? smooth(0.35, 0.9, sst / dur('Sitting_Enter')) : sm === 3 ? 1 - smooth(0.1, 0.6, sst / dur('Sitting_Exit')) : 0;
    if (sw > 0) pivot.position.set(-t.sitZ * pivot.scale.z * sw, (o.seatH + out.height * 0.045 - t.sitY * pivot.scale.y) * sw, 0);
    else if (pivot.position.x || pivot.position.y) pivot.position.set(0, 0, 0);
    // the mixer only rewrites a bone whose animated value changed, so what we added last frame must be taken off again first
    const trk = rig.trk; for (let i = 0; i < trk.length; i++) { const k = trk[i]; if (k.on) { if (k.b.quaternion.equals(k.post)) k.b.quaternion.copy(k.pre); k.on = false; } }
    const touch = b => { let k = rig.trkOf.get(b); if (!k) { k = { b, pre: new THREE.Quaternion(), post: new THREE.Quaternion(), on: false }; rig.trkOf.set(b, k); trk.push(k); } if (!k.on) { k.on = true; k.pre.copy(b.quaternion); } };
    // ----- corrections to the clips' stance, blended per state
    const hi = ((ent.Jog_Fwd_Loop ? ent.Jog_Fwd_Loop.w : 0) + (ent.Sprint_Loop ? ent.Sprint_Loop.w : 0)) / sum2;
    const key = state === 'walk' || state === 'run' ? (hi > 0.5 ? 'run' : 'walk') : state === 'kick' ? 'idle' : state, tg = CW[key] || CW_DEF, cw = rig.cw, kk = rig.cwSet ? Math.min(1, dt * 8) : 1; rig.cwSet = true;
    for (let k = 0; k < 4; k++) cw[k] += (tg[k] - cw[k]) * kk;
    for (let i = 0; i < rig.cb.length; i++) {
      const c = rig.cb[i], w = cw[c.k]; if (w < 0.01) continue;
      touch(c.bone);
      if (c.rest) c.bone.quaternion.slerp(c.rest, w); else { _q.identity().slerp(c.q, w); c.bone.quaternion.premultiply(_q); }
    }
    // ----- procedural layers: idle breathing and head look, kick
    const bn = rig.bn, ax = t.ax, sg = t.sg, R = (n, a, ang) => { if (ang > 1e-4 || ang < -1e-4) { touch(bn[n]); bn[n].quaternion.premultiply(_q.setFromAxisAngle(ax[n][a], ang)); } };
    const ik = Math.min(1, ((ent.Idle_Loop ? ent.Idle_Loop.w : 0) + (ent.Crouch_Idle_Loop ? ent.Crouch_Idle_Loop.w * 0.6 : 0) + (ent.Sitting_Idle_Loop ? ent.Sitting_Idle_Loop.w * 0.7 : 0) + (ent.Idle_Talking_Loop ? ent.Idle_Talking_Loop.w * 0.3 : 0)) / sum2);
    bt += dt;
    // head look: a given target (o.look, o.lookP) is tracked quickly, in any gait; otherwise idle people glance about now and then
    const tgt = Number.isFinite(o.look) && !sitNow && state !== 'talk' ? 1 : 0, lw = tgt ? Math.max(ik, 0.7) : ik;
    if (tgt) { lty = Math.max(-1.15, Math.min(1.15, o.look)); ltp = -sg.lean * Math.max(-0.5, Math.min(0.35, o.lookP || 0)); lookT = 1 + Math.random(); }
    else if (ik > 0.01 && (lookT -= dt) <= 0) { lookT = 1.8 + Math.random() * 3.6; lty = (Math.random() - 0.5) * (Math.random() < 0.25 ? 1.2 : 0.55); ltp = (Math.random() - 0.4) * 0.3; }
    if (lw > 0.01) {
      const e = 1 - Math.exp(-(tgt ? 6 : 2.2) * dt); ly += (lty - ly) * e; lp += (ltp - lp) * e;
      R('Head', 'y', ly * 0.55 * lw); R('neck_01', 'y', ly * 0.45 * lw); R('Head', 'x', lp * lw);
    }
    if (ik > 0.01) {
      const br = Math.sin(bt * 1.7 + bph);
      R('spine_03', 'x', sg.lean * 0.018 * br * ik); R('neck_01', 'x', -sg.lean * 0.008 * br * ik);
      R('pelvis', 'z', 0.022 * Math.sin(bt * 0.42 + bph) * ik); R('spine_01', 'z', -0.015 * Math.sin(bt * 0.42 + bph) * ik);
    }
    if (pk > 0.01) { R('spine_01', 'x', sg.lean * 0.08 * pk); R('spine_03', 'x', sg.lean * 0.12 * pk); R('upperarm_r', 'x', sg.arm * 1.0 * pk); R('Head', 'x', -sg.lean * 0.2 * pk); }
    if (o.dance && (state === 'idle' || state === 'walk')) { // Bihu: arms up and out, wrists turning, hips swaying to the dhol
      dnT += dt; const sw = Math.sin(dnT * 4.2), up = 0.7 + 0.15 * Math.sin(dnT * 2.1);
      R('upperarm_l', 'x', sg.arm * 1.15 * up); R('upperarm_r', 'x', sg.arm * 1.15 * up); R('upperarm_l', 'z', 0.35 + 0.1 * sw); R('upperarm_r', 'z', -0.35 + 0.1 * sw);
      R('lowerarm_l', 'x', sg.arm * 0.5); R('lowerarm_r', 'x', sg.arm * 0.5); R('hand_l', 'y', 0.6 * sw); R('hand_r', 'y', -0.6 * sw);
      R('pelvis', 'z', 0.09 * sw); R('spine_01', 'z', -0.06 * sw); R('spine_03', 'x', -sg.lean * 0.05);
    }
    if (state === 'kick' && stT < KICK_T) { // backswing (foot back, shin cocked), whip the leg through to the ball at ~0.2 s, follow through, recover; the torso leans back into it
      const p = stT / KICK_T, bk = smooth(0, 0.28, p), sw = smooth(0.28, 0.46, p), e = 1 - smooth(0.64, 1, p);
      R('thigh_r', 'x', sg.hip * (-0.4 * bk * (1 - sw) + 1.3 * sw) * e); R('calf_r', 'x', sg.knee * (1.25 * bk * (1 - sw) + 0.15 * sw) * e);
      R('thigh_l', 'x', -sg.hip * 0.12 * sw * e); R('calf_l', 'x', sg.knee * 0.35 * bk * e);
      R('spine_01', 'x', sg.lean * (0.06 * bk * (1 - sw) - 0.12 * sw) * e); R('spine_03', 'x', -sg.lean * 0.08 * sw * e); R('spine_03', 'y', 0.16 * sw * e);
    }
    for (let i = 0; i < trk.length; i++) { const k = trk[i]; if (k.on) k.post.copy(k.b.quaternion); }
  }
  function dispose() {
    if (group.parent) group.parent.remove(group);
    for (const r of [rigs.male, rigs.female]) if (r) { r.mixer.stopAllAction(); r.mixer.uncacheRoot(r.root); r.bodyMat.dispose(); r.browMat.dispose(); r.hairMats.forEach(m => m.dispose()); if (r.props) r.props.geometry.dispose(); if (r.cloth) r.cloth.geometry.dispose(); }
  }
  const out = { group, animate, setAppearance, height: BASE_H, dispose };
  if (opts.warm) { rigOf('male'); rigOf('female'); }
  setAppearance(appearance); animate(0, { state: 'idle' });
  return out;
}

export { preloadCharacters, realReady, makeRealCharacter };
