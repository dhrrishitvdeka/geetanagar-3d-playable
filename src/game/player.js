import { camera, scene, stage } from '../core/context.js';
import { clsAt } from '../core/geo.js';
import { findOpen, player as walker, walkable } from '../ui/controls.js';
import { deckBlocked, groundAt } from '../world/deck.js';
import { blockedBySeg } from '../world/geom.js';
import { on, emit } from './core/bus.js';
import { state } from './core/state.js';
import { axis, isDown, pressed, wheel } from './input.js';
import { makeCharacter, randomAppearance } from './npc/humanoid.js';
import { npcBlocking } from './npc/agents.js';
import { animalBlocking } from './animals.js';
import { vehicleAt } from './traffic.js';
import { engine, sfx } from './audio.js';
import { flash, isUIBlocking, toast } from './hud.js';

// ---------- the player: a third-person character, its camera, and whatever it rides ----------
// Map space: x east, y north, z up; heading is a map angle (east = 0) and models face +x, so group.rotation.y = heading.
// The explorer's `player` (walker) keeps owning the camera angles: ui/controls.js turns the mouse and touch drags into
// walker.yaw / walker.pitch (yaw 0 = north, camera forward in map space = (-sin yaw, cos yaw)). We scale those deltas by
// the sensitivity setting, clamp pitch, and mirror the character position into walker.x / walker.y for grass, labels and the terrace.
const WALK = 3.0, SPRINT = 6.6, SPEED_BUFF = 1.25, ACCEL = 14, TURN = 10;       // m/s, m/s, x, 1/s, rad/s
const CROUCH_SPEED = 0.45, CROUCH_DROP = 0.5, TURN_GAIN = 8, TURN_LAG = 22;       // x walk speed; metres the eye drops; body yaw eases toward the heading (gain 1/s, lag 1/s) instead of snapping
const JUMP_V = 4.2, GRAV = 14, SLOPE = 1.2;
const STAM_DRAIN = 0.16, STAM_REGEN = 0.12, STAM_RESUME = 0.2;
const CAM = { dist: 4, min: 2.2, max: 9, head: 1.55, eye: 1.58, ground: 0.35, steps: 8, pitch3: [-0.85, 0.5], pitch1: 1.3 };
// the rider sits a little above and behind the vehicle origin; tweak here for different models
const RIDE = { lift: 0.35, back: 0.25, head: 1.3, accel: 3.5, brake: 8, drag: 1.2, max: 12, radius: 0.6 };
const KNOCK_V = 5, KNOCK_T = 0.4, FALL_T = 1.2;
const BINOCULAR_FOV = 14;

const P = { x: 0, y: 0, z: 0, heading: Math.PI / 2, speed: 0, vx: 0, vy: 0, riding: null, seated: false, crouching: false, cameraMode: 'third', stamina: 1 };
const ZERO = { x: 0, y: 0 };
const SAFE = { x: 0, y: 0, heading: Math.PI / 2 }; // last place the player stood on foot; what the autosave writes
const ANIM = { state: 'idle', speed: 0 };
const STEP = { x: 0, y: 0, vol: 0.6 };

let ch = null, group = null, scale = 1;                       // current character model, its group, its height scale
let onGround = true, zv = 0, exhausted = false, jumpBuf = 0;
let inputLocked = false, fallT = 0, knockT = 0, kdx = 0, kdy = 0, emote = null, emoteT = 0, stepT = 0.25, hitToastAt = 0;
let lastYaw = 0, lastPitch = 0, idleLook = 0;                 // for scaling the mouse deltas and the vehicle chase camera
let camDist = CAM.dist, effDist = CAM.dist, charShown = true;
let pvx = 0, pvy = 0, pvz = 0;                                // smoothed camera pivot, three.js space
let crouchK = 0, turnV = 0;                                   // eye drop 0..1 (eased); body yaw rate
let seat = null, vs = 0, roll = 0, running = false;           // seat being used; signed vehicle speed; vehicle lean; sprinting this frame
let stuckT = 0;                                               // time spent standing somewhere walkable() refuses

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const wrapPi = a => { a = (a + Math.PI) % (Math.PI * 2); if (a < 0) a += Math.PI * 2; return a - Math.PI; };
const mulberry = seed => () => { seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };

// ---------- character model ----------
function buildLook() {
  // a young local in a white gamosa over a t-shirt and jeans, unless the title screen picked something else
  const a = { ...randomAppearance(mulberry(2026), { female: false }), female: false, hairStyle: 'short', gamosa: true, topStyle: 'tshirt', bottomStyle: 'pants', wrap: null, hat: null, umbrella: null, ...state.look };
  const next = makeCharacter(a);
  if (group) scene.remove(group);
  ch = next; group = ch.group; group.userData.noMerge = true; scale = a.height || 1;
  group.visible = charShown; scene.add(group); placeGroup();
}
function setLook(a) { if (a && a !== state.look) state.look = a; buildLook(); }

function placeGroup() {
  if (P.riding) {
    const h = P.riding.heading;
    group.position.set(P.riding.x - Math.cos(h) * RIDE.back, P.z + RIDE.lift, -(P.riding.y - Math.sin(h) * RIDE.back)); group.rotation.y = h;
  } else { group.position.set(P.x, P.z, -P.y); group.rotation.y = P.heading; }
}

// ---------- collision, as in the explorer's stepWalk plus the things that move ----------
const gets = (b, nx, ny, ox, oy) => b.x === undefined || Math.hypot(nx - b.x, ny - b.y) < Math.hypot(ox - b.x, oy - b.y) - 1e-4; // only blocks moves that close in; lets you walk out of an overlap
function othersBlock(nx, ny, ox, oy, rn, ra, rv, ignore) {
  let b = npcBlocking(nx, ny, rn); if (b && gets(b, nx, ny, ox, oy)) return true;
  b = animalBlocking(nx, ny, ra); if (b && gets(b, nx, ny, ox, oy)) return true;
  b = vehicleAt(nx, ny, rv); if (b && b !== ignore && gets(b, nx, ny, ox, oy)) return true;
  return false;
}
function canStand(nx, ny, ox, oy, h0) {
  if (!walkable(nx, ny) || deckBlocked(nx, ny, h0)) return false;
  const dist = Math.hypot(nx - ox, ny - oy) || 1;
  if ((groundAt(nx, ny) - h0) / dist >= SLOPE) return false;
  return !othersBlock(nx, ny, ox, oy, 0.45, 0.5, 0.5, null);
}
function canRide(nx, ny, ox, oy, h0, v, dirSign) { // a wider footprint, with a probe at the nose in the direction of travel
  const hx = Math.cos(v.heading) * RIDE.radius * dirSign, hy = Math.sin(v.heading) * RIDE.radius * dirSign;
  if (deckBlocked(nx, ny, h0)) return false;
  // a vehicle that starts life touching a wall must still be able to drive away, so only the plain footprint check applies then
  if (!walkable(nx, ny)) return false;
  const startedClear = walkable(ox, oy) && !blockedBySeg(ox, oy, RIDE.radius);
  if (startedClear && (!walkable(nx + hx, ny + hy) || blockedBySeg(nx, ny, RIDE.radius))) return false;
  const dist = Math.hypot(nx - ox, ny - oy) || 1;
  if ((groundAt(nx, ny) - h0) / dist >= SLOPE) return false;
  return !othersBlock(nx, ny, ox, oy, RIDE.radius, RIDE.radius, RIDE.radius, v);
}

// ---------- init ----------
function initPlayer() {
  P.x = walker.x; P.y = walker.y; P.heading = walker.yaw + Math.PI / 2; P.z = groundAt(P.x, P.y);
  SAFE.x = P.x; SAFE.y = P.y; SAFE.heading = P.heading;
  walker.pitch = -0.12; lastYaw = walker.yaw; lastPitch = walker.pitch;
  buildLook(); snapCamera();
  on('ui:look', ({ look }) => setLook(look || state.look));
  on('player:hit', onHit);
  on('npc:talk', () => playEmote('talk', 2.5));
}
function snapCamera() { pvx = P.x; pvz = -P.y; pvy = P.z + CAM.head * scale; effDist = camDist; }

// ---------- per-frame ----------
function updatePlayer(dt) {
  if (!ch) return;
  readLook(dt);
  for (const k in state.buffs) if ((state.buffs[k] -= dt) <= 0) delete state.buffs[k];
  const blocked = inputLocked || isUIBlocking();
  const binoc = P.cameraMode === 'binocular';
  const free = !blocked && !binoc && fallT <= 0;
  const ax = free ? axis() : ZERO;
  const w = wheel(); if (w && !blocked) camDist = clamp(camDist + w * 0.004, CAM.min, CAM.max);
  if (pressed('jump') && free) { jumpBuf = 0.12; P.crouching = false; } else jumpBuf = Math.max(0, jumpBuf - dt); // a jump stands you up first
  if (free && !P.riding && !P.seated) { if (pressed('crouch') && onGround) P.crouching = !P.crouching; else if (pressed('sprint')) P.crouching = false; }
  crouchK += ((P.crouching ? 1 : 0) - crouchK) * (1 - Math.exp(-9 * dt));
  if (fallT > 0) fallT -= dt;
  if (emoteT > 0) emoteT -= dt;

  if (P.riding) updateRiding(dt, ax);
  else if (P.seated) updateSeated(dt, ax, free);
  else updateWalking(dt, ax, free, binoc);
  // a teleport, a knockback or a dismount can leave you inside a collider or a building pixel, where every step is refused: step out
  if (!P.riding && !P.seated && !walkable(P.x, P.y)) { if ((stuckT += dt) > 0.3) { [P.x, P.y] = findOpen(P.x, P.y); P.z = groundAt(P.x, P.y); stuckT = 0; } }
  else stuckT = 0;

  walker.x = P.x; walker.y = P.y;
  if (!P.riding && !P.seated && onGround) { SAFE.x = P.x; SAFE.y = P.y; SAFE.heading = P.heading; }
  P.stamina = state.stamina;
  updateCharacter(dt);
  updateCamera(dt);
}

function readLook(dt) {
  const dy = walker.yaw - lastYaw, dp = walker.pitch - lastPitch;
  if (dy || dp) {
    const k = (state.settings.sens ?? 1) * clamp(camera.fov / (state.settings.fov || 70), 0.15, 1); // slower aim when zoomed in
    walker.yaw = lastYaw + dy * k; walker.pitch = lastPitch + dp * k * (state.settings.invertY ? -1 : 1);
    if (Math.abs(dy) > 1e-4 || Math.abs(dp) > 1e-4) idleLook = 0;
  }
  walker.pitch = P.cameraMode === 'third' ? clamp(walker.pitch, CAM.pitch3[0], CAM.pitch3[1]) : clamp(walker.pitch, -CAM.pitch1, CAM.pitch1);
  lastYaw = walker.yaw; lastPitch = walker.pitch; idleLook += dt;
}

function regen(dt, mult) { state.stamina = clamp(state.stamina + STAM_REGEN * mult * dt, 0, 1); }

// ---------- on foot ----------
function updateWalking(dt, ax, free, binoc) {
  const sy = Math.sin(walker.yaw), cy = Math.cos(walker.yaw);
  const mag = Math.min(1, Math.hypot(ax.x, ax.y)), moving = mag > 0.05;
  const mx = -sy * ax.y + cy * ax.x, my = cy * ax.y + sy * ax.x;      // camera-relative wish direction in map space
  const noDrain = state.buffs.stamina > 0;
  const sprinting = free && moving && !P.crouching && isDown('sprint') && (noDrain || (!exhausted && state.stamina > 0));
  const top = (sprinting ? SPRINT : WALK * (P.crouching ? CROUCH_SPEED : 1)) * (state.buffs.speed > 0 ? SPEED_BUFF : 1);
  const k = 1 - Math.exp(-ACCEL * dt);
  P.vx += (mx * top - P.vx) * k; P.vy += (my * top - P.vy) * k;
  let kx = 0, ky = 0;
  if (knockT > 0) { const f = KNOCK_V * (knockT / KNOCK_T); kx = kdx * f; ky = kdy * f; knockT -= dt; }

  const ox = P.x, oy = P.y, dx = (P.vx + kx) * dt, dy = (P.vy + ky) * dt;
  if (Math.abs(dx) + Math.abs(dy) > 1e-6) {
    const h0 = groundAt(ox, oy);
    if (canStand(ox + dx, oy + dy, ox, oy, h0)) { P.x = ox + dx; P.y = oy + dy; }
    else if (canStand(ox + dx, oy, ox, oy, h0)) { P.x = ox + dx; P.vy = 0; }  // slide along the wall
    else if (canStand(ox, oy + dy, ox, oy, h0)) { P.y = oy + dy; P.vx = 0; }
    else { P.vx = P.vy = 0; }
  }
  const md = Math.hypot(P.x - ox, P.y - oy);
  P.speed += (md / Math.max(dt, 1e-4) - P.speed) * (1 - Math.exp(-12 * dt));
  if (P.speed < 0.05) P.speed = 0;
  state.stats.distance += md;

  // heading: turn toward where you are going; in first person and binoculars the body follows the view
  if (binoc || P.cameraMode === 'first') { P.heading = walker.yaw + Math.PI / 2; turnV = 0; }
  else if (fallT <= 0 && moving) { // a lagged rate toward the wanted turn: eases in and out
    turnV += (clamp(wrapPi(Math.atan2(my, mx) - P.heading) * TURN_GAIN, -TURN, TURN) - turnV) * (1 - Math.exp(-TURN_LAG * dt)); P.heading += turnV * dt;
  } else { turnV *= Math.exp(-14 * dt); P.heading += turnV * dt; }

  // jump and ground follow
  const g = groundAt(P.x, P.y);
  if (jumpBuf > 0 && onGround && free) { onGround = false; zv = JUMP_V; jumpBuf = 0; emoteT = 0; }
  if (onGround) {
    if (P.z - g > 0.35 + md * 1.5) { onGround = false; zv = 0; } else P.z = g; // stepped off a ledge: fall instead of snapping
  }
  if (!onGround) {
    zv -= GRAV * dt; P.z += zv * dt;
    if (P.z <= g) {
      if (zv <= 0) { if (zv < -4) { STEP.x = P.x; STEP.y = P.y; STEP.vol = 0.9; sfx('step', STEP); } P.z = g; zv = 0; onGround = true; stepT = 0.2; }
      else P.z = g; // ground rose into us while going up
    }
  }

  // stamina
  if (sprinting && P.speed > 1) { if (!noDrain) state.stamina = Math.max(0, state.stamina - STAM_DRAIN * dt); }
  else regen(dt, 1);
  if (state.stamina <= 0) exhausted = true; else if (state.stamina > STAM_RESUME) exhausted = false;

  // footsteps
  if (onGround && P.speed > 0.8) {
    const run = sprinting && P.speed > 3.6, sneak = P.crouching;
    if ((stepT += dt) >= (run ? 0.32 : sneak ? 0.7 : 0.5)) { stepT = 0; STEP.x = P.x; STEP.y = P.y; STEP.vol = run ? 0.9 : sneak ? 0.3 : 0.6; sfx('step', STEP); }
  } else stepT = Math.max(stepT, 0.25);
  if (P.speed > 0.5 || !onGround) emoteT = 0;
  running = sprinting;
}

// ---------- seated ----------
function updateSeated(dt, ax, free) {
  P.vx = P.vy = P.speed = 0; knockT = 0;
  if (seat) { P.x = seat.x; P.y = seat.y; P.heading = seat.heading ?? P.heading; P.z = seat.z ?? groundAt(seat.x, seat.y); }
  regen(dt, 3);
  if (free && (Math.hypot(ax.x, ax.y) > 0.2 || jumpBuf > 0)) { jumpBuf = 0; setSeated(null); }
}
function setSeated(s) {
  if (!s) { seat = null; P.seated = false; return; }
  if (P.riding) dismount();
  seat = s; P.seated = true; P.crouching = false; vs = 0; emoteT = 0; fallT = 0; knockT = 0; onGround = true; zv = 0;
  P.x = s.x; P.y = s.y; P.heading = s.heading ?? P.heading; P.z = s.z ?? groundAt(s.x, s.y); P.vx = P.vy = P.speed = 0;
  walker.x = P.x; walker.y = P.y;
}

// ---------- riding ----------
function mountVehicle(v) {
  if (!v || !v.mesh) return;
  if (P.riding) dismount();
  if (P.seated) setSeated(null);
  if (v.x === undefined) { v.x = v.mesh.position.x; v.y = -v.mesh.position.z; }
  if (v.heading === undefined) v.heading = v.mesh.rotation.y;
  v.mesh.rotation.order = 'YXZ'; // yaw first, then lean about the vehicle's own forward axis
  P.riding = v; P.crouching = false; vs = v.speed || 0; roll = 0; knockT = 0; emoteT = 0; fallT = 0;
  P.x = v.x; P.y = v.y; P.z = groundAt(v.x, v.y); P.heading = v.heading; onGround = true; zv = 0;
  stage.classList.add('riding');
  try { sfx('engine_start', { x: v.x, y: v.y }); } catch (e) { /* audio is optional */ }
  emit('vehicle:mount', { kind: v.kind });
}
function updateRiding(dt, ax) {
  const v = P.riding, max = v.maxSpeed || RIDE.max, revMax = Math.min(3.5, max * 0.3);
  const thr = ax.y, steer = ax.x;
  if (thr > 0.1) vs = Math.min(max * thr, vs + RIDE.accel * thr * dt);
  else if (thr < -0.1) { if (vs > 0.3) vs = Math.max(0, vs - RIDE.brake * dt); else vs = Math.max(-revMax, vs + thr * RIDE.accel * 0.6 * dt); }
  else { const d = (RIDE.drag + 0.08 * Math.abs(vs)) * dt; vs = Math.abs(vs) <= d ? 0 : vs - Math.sign(vs) * d; }
  vs = clamp(vs, -revMax, max);
  const lead = clamp(Math.abs(vs) / 3, 0, 1) * (1 - 0.55 * clamp(Math.abs(vs) / max, 0, 1)); // turns tighter when slow
  v.heading += -steer * 2.1 * lead * dt * (vs >= 0 ? 1 : -1);

  const ox = v.x, oy = v.y, h = v.heading, nx = ox + Math.cos(h) * vs * dt, ny = oy + Math.sin(h) * vs * dt;
  if (Math.abs(vs) > 1e-3) {
    if (canRide(nx, ny, ox, oy, groundAt(ox, oy), v, vs >= 0 ? 1 : -1)) { v.x = nx; v.y = ny; }
    else { vs *= -0.25; if (Math.abs(vs) < 0.4) vs = 0; }
  }
  const md = Math.hypot(v.x - ox, v.y - oy);
  state.stats.distance += md;
  P.x = v.x; P.y = v.y; P.z = groundAt(v.x, v.y); P.heading = v.heading;
  P.speed = Math.abs(vs); P.vx = Math.cos(h) * vs; P.vy = Math.sin(h) * vs;
  regen(dt, 1);
  if (state.stamina > STAM_RESUME) exhausted = false;

  // the vehicle mesh follows, leaning into turns (bikes more than anything with four wheels)
  const lean = /scooter|bike|cycle|moto/i.test(v.kind || '') ? 1 : 0.3;
  roll += (steer * clamp(vs / max, -1, 1) * 0.28 * lean - roll) * (1 - Math.exp(-8 * dt));
  v.mesh.position.set(v.x, P.z, -v.y); v.mesh.rotation.y = v.heading; v.mesh.rotation.x = roll;
  try { engine(true, P.speed / max); } catch (e) { /* audio is optional */ }

  // chase camera: drift to behind the vehicle once the mouse has been still for a while
  if (idleLook > 1.5 && P.speed > 1) {
    walker.yaw += wrapPi(v.heading - Math.PI / 2 - walker.yaw) * (1 - Math.exp(-1.8 * dt)); lastYaw = walker.yaw;
  }
}
function dismount() {
  const v = P.riding; if (!v) return;
  const gz = groundAt(v.x, v.y);
  let px = v.x, py = v.y, ok = false;
  for (const r of [1.3, 1.9, 2.7]) {
    for (const a of [-Math.PI / 2, Math.PI / 2, Math.PI, 0, -Math.PI / 4, Math.PI / 4, -2.4, 2.4]) {
      const cx = v.x + Math.cos(v.heading + a) * r, cy = v.y + Math.sin(v.heading + a) * r;
      if (walkable(cx, cy) && !deckBlocked(cx, cy, gz) && !othersBlock(cx, cy, v.x, v.y, 0.45, 0.5, 0.5, v)) { px = cx; py = cy; ok = true; break; }
    }
    if (ok) break;
  }
  if (!ok) [px, py] = findOpen(v.x, v.y);
  v.mesh.position.set(v.x, gz, -v.y); v.mesh.rotation.y = v.heading; v.mesh.rotation.x = 0; // the vehicle stays where it stopped
  v.speed = 0;
  P.riding = null; vs = 0; roll = 0; P.x = px; P.y = py; P.z = groundAt(px, py); P.vx = P.vy = P.speed = 0; P.heading = v.heading;
  onGround = true; zv = 0; stage.classList.remove('riding');
  try { engine(false, 0); } catch (e) { /* audio is optional */ }
  walker.x = P.x; walker.y = P.y;
  if (v.onDismount) { try { v.onDismount(v); } catch (err) { console.error('[player] onDismount failed', err); } }
  emit('vehicle:dismount', { kind: v.kind });
}

// ---------- hits ----------
function onHit({ dx = 0, dy = 0 } = {}) {
  if (P.riding) dismount();
  if (P.seated) setSeated(null);
  P.crouching = false;
  const l = Math.hypot(dx, dy) || 1; kdx = dx / l; kdy = dy / l; knockT = KNOCK_T; fallT = FALL_T; emoteT = 0; P.vx = P.vy = 0;
  flash('#b3282d', 350);
  const now = performance.now();
  if (now - hitToastAt > 4000) { hitToastAt = now; toast('Careful! Traffic on Mother Teresa Rd', { kind: 'warn' }); }
}

// ---------- character animation ----------
function updateCharacter(dt) {
  let st = 'idle';
  if (fallT > 0) st = 'fall';
  else if (P.riding) st = 'ride';
  else if (P.seated) st = 'sit';
  else if (emoteT > 0 && emote && !P.crouching) st = emote;
  else if (!onGround) st = 'jump';
  else if (P.crouching) st = 'crouch';
  else if (P.speed > 0.4) st = running && P.speed > 3.6 ? 'run' : 'walk';
  ANIM.state = st; ANIM.speed = P.speed;
  ch.animate(dt, ANIM);
  placeGroup();
  const show = P.cameraMode === 'third' && effDist > 0.75;
  if (show !== charShown) { charShown = show; group.visible = show; }
}
function playEmote(name, seconds = 2) { emote = name; emoteT = seconds; } // wave, pray, kick, talk... cancelled by moving

// ---------- camera ----------
function updateCamera(dt) {
  const cp = Math.cos(walker.pitch), sp = Math.sin(walker.pitch), sy = Math.sin(walker.yaw), cy = Math.cos(walker.yaw);
  const dx = -sy * cp, dy = sp, dz = -cy * cp;                       // view direction in three.js space
  const lift = P.riding ? RIDE.lift : 0;
  if (P.cameraMode !== 'third') {
    const ez = P.z + lift + (P.riding ? RIDE.head : CAM.eye - CROUCH_DROP * crouchK) * scale;
    camera.position.set(P.x, ez, -P.y); camera.lookAt(P.x + dx, ez + dy, -P.y + dz);
    pvx = P.x; pvz = -P.y; pvy = ez; effDist = camDist; // so going back to third person doesn't swing
    updateFov(dt); return;
  }
  const kxz = 1 - Math.exp(-22 * dt), ky = 1 - Math.exp(-9 * dt);
  pvx += (P.x - pvx) * kxz; pvz += (-P.y - pvz) * kxz;
  pvy += (P.z + lift + (P.riding ? RIDE.head : CAM.head - CROUCH_DROP * crouchK) * scale - pvy) * ky;
  // pull the camera in where the line back from the pivot would pass through a building or wall
  let allowed = camDist;
  for (let i = 1; i <= CAM.steps; i++) {
    const t = camDist * i / CAM.steps, sx = pvx - dx * t, sy2 = -(pvz - dz * t);
    const c = clsAt(sx, sy2);
    if (c === 2 || c === 3 || blockedBySeg(sx, sy2, 0.25)) { allowed = camDist * (i - 1) / CAM.steps; break; }
  }
  allowed = Math.max(0.5, allowed);
  effDist += (allowed - effDist) * (1 - Math.exp(-(allowed < effDist ? 25 : 3) * dt));
  const cx = pvx - dx * effDist, cz = pvz - dz * effDist; let cyv = pvy - dy * effDist;
  const floor = groundAt(cx, -cz) + CAM.ground; if (cyv < floor) cyv = floor;
  camera.position.set(cx, cyv, cz); camera.lookAt(pvx, pvy, pvz);
  updateFov(dt);
}
function updateFov(dt) {
  const tf = P.cameraMode === 'binocular' ? BINOCULAR_FOV : (state.settings.fov || 70);
  let f = camera.fov + (tf - camera.fov) * (1 - Math.exp(-10 * dt)); if (Math.abs(f - tf) < 0.05) f = tf;
  if (f !== camera.fov) { camera.fov = f; camera.updateProjectionMatrix(); }
}
function setCameraMode(m) {
  if (m !== 'third' && m !== 'first' && m !== 'binocular') return;
  P.cameraMode = m;
  stage.classList.toggle('first-person', m === 'first'); stage.classList.toggle('binocular', m === 'binocular');
  if (ch) { charShown = m === 'third'; group.visible = charShown; }
  if (m === 'third') walker.pitch = clamp(walker.pitch, CAM.pitch3[0], CAM.pitch3[1]);
  lastPitch = walker.pitch;
  if (m === 'binocular') { P.vx = P.vy = 0; }
}
const getCameraMode = () => P.cameraMode;

// ---------- misc API ----------
function getPlayer() { return P; }
function getSafePos() { return SAFE; }
function teleport(x, y, heading) {
  P.x = x; P.y = y; P.z = groundAt(x, y); P.vx = P.vy = P.speed = 0; zv = 0; onGround = true; knockT = 0; fallT = 0; emoteT = 0; turnV = 0;
  if (heading !== undefined) { P.heading = heading; walker.yaw = heading - Math.PI / 2; lastYaw = walker.yaw; }
  if (P.riding) { P.riding.x = x; P.riding.y = y; if (heading !== undefined) P.riding.heading = heading; vs = 0; }
  walker.x = x; walker.y = y; SAFE.x = x; SAFE.y = y; SAFE.heading = P.heading;
  if (ch) { placeGroup(); snapCamera(); }
}
function setInputLocked(on) { inputLocked = !!on; }
function addBuff(name, seconds) { state.buffs[name] = Math.max(state.buffs[name] || 0, seconds); }

export { initPlayer, updatePlayer, getPlayer, getSafePos, teleport, mountVehicle, dismount, setSeated, setCameraMode, getCameraMode, setInputLocked, addBuff, setLook, playEmote };
