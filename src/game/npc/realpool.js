import * as THREE from 'three';
import { camera, scene } from '../../core/context.js';
import { QUALITY } from '../../render/quality.js';
import { makeRealCharacter, realReady } from './realchars.js';

// ---------- rigged models for the people nearest the camera ----------
// A fixed pool of real-model slots (6 / 12 / 16 by quality tier). Every ~0.25 s the nearest people within ~45 m get a slot, named
// people first (within 70 m) and anyone mid-conversation before everyone else. A person who already holds a slot keeps it a little
// longer than a newcomer would get one (distance bonus plus a wider keep radius), so nobody flickers between models. An assigned NPC
// has n.real = true, which makes crowd.js skip it; its slot model then follows n.x / n.z / n.y / n.heading / n.state / n.speed.
// A slot is reconfigured (appearance only, no new meshes) when it moves to another person or the person's recipe changes (recycled
// ambient people). If anything throws, the pool switches itself off and the instanced crowd draws everyone again.
const SLOTS = { low: 6, medium: 12, high: 16 }[QUALITY] || 12;
const RANGE = 45, NAMED_RANGE = 70, KEEP = 10, EVERY = 0.25, CULL_R = 3.5, FAR = 25, FAR_DT = 0.05;
const pool = [], selN = new Array(SLOTS).fill(null), selS = new Float32Array(SLOTS);
const ANIM = { state: 'idle', speed: 0, seated: false, restart: false };
const frustum = new THREE.Frustum(), vp = new THREE.Matrix4(), sph = new THREE.Sphere();
let built = false, off = false, timer = 0, stamp = 0;

function initRealPool() {
  if (built || !realReady()) return; built = true;
  for (let i = 0; i < SLOTS; i++) { // both bodies are built up front so a slot can change gender without a hitch
    const ch = makeRealCharacter({}, { warm: true }); ch.group.visible = false; scene.add(ch.group); pool.push({ ch, npc: null, recipe: null, acc: 0 });
  }
}
function release(s) {
  const n = s.npc; if (n) { n.real = false; n.slot = null; }
  s.npc = null; s.recipe = null; s.ch.group.visible = false;
}
const releaseReal = n => { if (n.slot) release(n.slot); };

// pick the best SLOTS people (smallest score first) and hand out slots
function reassign(list, count, cx, cz) {
  let ns = 0;
  for (let q = 0; q < count; q++) {
    const n = list[q]; if (n.dead || n.hidden || !n.recipe) continue;
    const dx = n.x - cx, dy = n.y + cz, named = n.kind === 'named', lim = (named ? NAMED_RANGE : RANGE) + (n.real ? KEEP : 0);
    if (dx * dx + dy * dy > lim * lim) continue;
    const score = Math.sqrt(dx * dx + dy * dy) - (named ? 100 : 0) - (n.talking ? 200 : 0) - (n.real ? 6 : 0);
    if (ns === SLOTS && score >= selS[ns - 1]) continue;
    let k = ns < SLOTS ? ns++ : SLOTS - 1;
    while (k > 0 && selS[k - 1] > score) { selS[k] = selS[k - 1]; selN[k] = selN[k - 1]; k--; }
    selS[k] = score; selN[k] = n;
  }
  stamp++; for (let k = 0; k < ns; k++) selN[k].pick = stamp;
  for (let i = 0; i < pool.length; i++) { const s = pool[i]; if (s.npc && (s.npc.dead || s.npc.pick !== stamp)) release(s); }
  for (let k = 0; k < ns; k++) {
    const n = selN[k]; selN[k] = null; if (n.real) continue;
    for (let i = 0; i < pool.length; i++) { const s = pool[i]; if (!s.npc) { s.npc = n; s.recipe = null; s.acc = 0; n.real = true; n.slot = s; break; } }
  }
}

function updateRealPool(list, count, dt) {
  if (!built || off) return;
  try {
    camera.updateMatrixWorld();
    const ce = camera.matrixWorld.elements, cx = ce[12], cz = ce[14]; // three.js space; map y = -z
    if ((timer -= dt) <= 0) { timer = EVERY; reassign(list, count, cx, cz); }
    vp.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse); frustum.setFromProjectionMatrix(vp);
    const gone2 = 100 * 100, near2 = FAR * FAR;
    for (let i = 0; i < pool.length; i++) {
      const s = pool[i], n = s.npc; if (!n) continue;
      const dx = n.x - cx, dy = n.y + cz, d2 = dx * dx + dy * dy;
      if (n.dead || d2 > gone2) { release(s); continue; } // removed, or recycled to the far side of the map
      if (s.recipe !== n.recipe) { s.ch.setAppearance(n.recipe.a); s.recipe = n.recipe; }
      const g = s.ch.group; g.position.set(n.x, n.z, -n.y); g.rotation.y = n.heading;
      sph.center.set(n.x, n.z + 0.9, -n.y); sph.radius = CULL_R;
      const vis = frustum.intersectsSphere(sph); g.visible = vis;
      if (!vis) { s.acc = 0; continue; }
      s.acc += dt; if (d2 > near2 && s.acc < FAR_DT) continue; // distant people animate at ~20 Hz
      ANIM.state = n.state; ANIM.speed = n.speed; ANIM.seated = n.behavior === 'sit' && !n.goto;
      s.ch.animate(Math.min(s.acc, 0.1), ANIM); s.acc = 0;
    }
  } catch (e) {
    off = true; console.error('[npc] real models failed, the instanced crowd takes over', e);
    for (let i = 0; i < pool.length; i++) release(pool[i]);
  }
}

export { initRealPool, updateRealPool, releaseReal };
