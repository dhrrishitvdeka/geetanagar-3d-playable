import * as THREE from 'three';
import { camera } from '../../core/context.js';
import { GEO } from '../../core/geo.js';
import { QUALITY } from '../../render/quality.js';
import { walkable } from '../../ui/controls.js';
import { groundAt } from '../../world/deck.js';
import { MAINP, NRM, asphHalf, hw, nearestOnMain } from '../../world/mainroad.js';
import { beside } from '../../world/streetlife.js';
import { emit, on } from '../core/bus.js';
import { state } from '../core/state.js';
import { bubble, showDialogue } from '../hud.js';
import { register, unregister } from '../interact.js';
import { vehicleAt } from '../traffic.js';
import { drawCrowd, initCrowd } from './crowd.js';
import { Animator, buildRecipe, randomAppearance } from './humanoid.js';
import { initRealPool, releaseReal, updateRealPool } from './realpool.js';
import { buildNav, findPath, nearestNode, nodeXY, randomPoint, randomPointDir } from './nav.js';
import { claimSeat, releaseSeat } from '../seats.js';
import { FIELD, ballInField, ballRef, npcKick, pushBall } from '../worldobjects.js';
import { kickLoose, nearLoose } from '../loose.js';

// ---------- NPC simulation: ambient crowd, named people, behaviours, avoidance, talking ----------
const TARGET = { low: 24, medium: 40, high: 64 }[QUALITY] || 40; // ambient population by quality tier
const NEAR = 60, FAR_DT = 0.15, SPAWN_R = 200, RECYCLE_R = 230;
const ALL = [], BYID = new Map(), AMB = [], SPOTS = [], PQ = [];
let ready = false, P = null, ambSeq = 0, hour = 7, camAng = 0, greetT = 8, bubT = 0, spotT = 0;
const wrap = a => Math.atan2(Math.sin(a), Math.cos(a));
const rnd = (a, b) => a + Math.random() * (b - a), pickOf = arr => arr[Math.floor(Math.random() * arr.length)], chance = p => Math.random() < p;

// ---------- words ----------
const NAMES_M = ['Bikash', 'Pranjal', 'Dipankar', 'Bhaskar', 'Hiren', 'Debajit', 'Kaustav', 'Manab', 'Rupjyoti', 'Mridul', 'Jitu', 'Rajib', 'Nabajyoti', 'Utpal', 'Bhabesh', 'Dhiraj', 'Prasanta', 'Monoj', 'Anup', 'Jayanta', 'Himangshu', 'Ranjit'];
const NAMES_F = ['Rituparna', 'Mousumi', 'Pallavi', 'Nayanmoni', 'Gitanjali', 'Ankita', 'Bidisha', 'Trishna', 'Kabita', 'Manjula', 'Dipali', 'Runumi', 'Priyanka', 'Anjana', 'Lakhimi', 'Mitali', 'Nirmali', 'Parbati'];
const LINES = [
  'Nomoskar! Ki khobor? Nice weather for a walk, no?', 'Looks like rain is coming. The sky over the Brahmaputra is turning grey.', 'Hatigarh is jammed again. Every day the same, but where else would the totos go?',
  "Have you had sah yet? Bina Baideu's stall by the park makes the best lal sah.", 'The boys are playing cricket at the field again. Mind the ball!', 'Cricket in the morning, football in the evening. The field never rests.',
  'Go to the View point at sunset. The whole city turns gold. Bhal lagibo, you will like it.', 'Bihu is coming, and Ma has started making pitha already. The whole house smells of rice and coconut.',
  'The Brahmaputra looks so calm from the hill today.', 'I saw someone drop a gamosa near the mandir. Somebody must be looking for it.', 'Pori the dog hangs around Hatigarh all day. She loves biscuits, you know.',
  'Dipen at the Hatigarh stalls pays for parcel runs, if you want some extra rupees.', 'They say the View point has binoculars now. You can see all across the city.', 'Dhire dhire, no? There is no hurry in Geetanagar.',
  'The tea at the kiosks by the field is hot and sweet. Perfect when the wind blows.', 'Every morning the crows wake the whole lane before the milkman does.', 'Baideu always says: pitha in the morning, sah in the evening, and everything is fine.',
  'That mandir gate is lovely in the morning light. People leave flowers there.', 'Buses stop at the bus stand, but the totos stop wherever they like.', 'I walk to Hatigarh every Sunday, just to look at the stalls.',
  'Khura told me this road was a mud track once. Hard to believe now.', 'My Khuri makes the best masor tenga. Fish, tomato, lemon, a little sour. Heaven.', 'Mind the scooters, they come from everywhere.',
  'Good that the rain held off today. The lanes get so muddy.', 'The park forecourt is quiet in the morning. Good for a slow cup of sah.', 'If you get lost, just follow Mother Teresa Road. All of Geetanagar is on it.',
  'I love the smell after the first rain. The whole neighbourhood smells of wet earth.', 'The kids here know every shortcut between the lanes. Ask them if you are in a hurry.',
  'My grandmother wears her mekhela chador every festival. She says no other dress feels like home.', 'Look at the hills beyond the houses. On clear days they seem close enough to touch.',
  'A little jalebi from the stall, and the day gets better.', 'I come to the field for the evening games. Everyone cheers, even for the missed goals.', 'Ki bhal din! Nice to see someone out for a walk.',
  'The shopkeepers know everyone by name here. It is that kind of place.', 'The mandir stairs are steep, so mind your step with a heavy bag.', 'Tea first, work second. That is my rule.',
  'If you need anything, ask at the stalls. They always know.', 'Come again, we chat more than we work in this lane, hahaha.', 'The evening breeze from the river is the best part of the day.', 'Nomoskar! You look like you are exploring. Take your time.',
];
const ROLE_LINES = {
  student: ['Exams are coming and I have not opened my books. Do not tell my teacher!', 'School is fun, except Mondays.', 'After class we are playing football at the field.'],
  jogger: ['Three rounds of the field before the sun gets harsh.', 'Morning runs are the best. The air is cool and the road is empty.'],
  elder: ['In my time we walked everywhere. No scooters, no honking.', 'Take care of your knees while you are young, beta.'],
  kid: ['Catch me if you can!', 'Come and play with us!'],
  shopper: ['I am looking for fresh vegetables. Everything is dear today.', 'Banana, tomato, potato. The list never ends.'],
  office: ['Late for the office again. The Hatigarh signal is to blame.', 'Meetings, meetings. Give me a tea stall any day.'],
  phone: ['Sorry, just finishing a message. What were you saying?', 'The network is terrible near the field.'],
  mekhela: ['It is only a mekhela chador, but it takes thirty minutes to put on.', 'We dress up on festival days. It makes the whole lane brighter.'],
  sari: ['Today is a family function, so I am a little overdressed.', 'The shops near Hatigarh have lovely silk this season.'],
  commuter: ['The bus to the city is always late.', 'I take the same road every day, but I still find new things on it.'],
};
const GREET = ['Nomoskar!', 'Ki khobor?', 'Bhal ne?', 'Nomoskar, bhal ne?', 'Aah, nomoskar!'], FLINCH = ['Arey! Saabdhane!', 'Careful!', 'Dhire dhire!'], BANTER = ['Hoi hoi, thik ase.', 'Aru ki khobor?', 'Bhal bhal!', 'Hahaha!'];
const ROLE_LABEL = { commuter: 'Commuter', shopper: 'Shopper', student: 'Student', elder: 'Elder', jogger: 'Jogger', kid: 'Kid', mekhela: 'Local', sari: 'Local', office: 'Office worker', phone: 'Local', vendor: 'Vendor', priest: 'Priest', guard: 'Guard' };

// ---------- places people walk to (snapped to the walk graph when used) ----------
const lm = t => { const l = GEO.labels.find(l => l.t === t); return l ? [l.x, l.y] : null; };
const SCHOOLS = [lm('Geetanagar High School') || [-45, 24.4], lm('Kanya Mahavidyalaya') || [-78.9, 83.6], lm('Geetanagar LP School') || [-68, 16]];
const FIELD_C = [(GEO.field[0] + GEO.field[2]) / 2, (GEO.field[1] + GEO.field[3]) / 2];
const POIS = { shop: [], other: [] };
function initPlaces() {
  const kiosk = kx => { const [, i] = nearestOnMain(kx, -50), s = NRM[i][1] > 0 ? 1 : -1, off = hw(i) + 1.6; return [MAINP[i][0] + NRM[i][0] * s * off, MAINP[i][1] + NRM[i][1] * s * off]; };
  for (const kx of [24, 31, -44, -37]) POIS.shop.push(kiosk(kx));
  try { const [, i] = nearestOnMain(-121, -70); const b = beside(-121, -1, asphHalf(i) + 2.4); POIS.shop.push([b[0], b[1]]); } catch (e) { /* forecourt helpers missing */ }
  for (let k = 0; k < 9; k += 2) POIS.shop.push([-486.5, -60.2 + k * 2.45]);
  POIS.shop.push([37.7, -39]); // flower carts by the mandir
  POIS.other.push([-57, -74], [-497, -60], [49.5, -45], [FIELD_C[0], GEO.field[1] - 6], [78, 195], [-110, -85]); // bus stand, Hatigarh, mandir, field edge, view point, park forecourt
}
const snap = (x, y, out) => { const n = nearestNode(x, y); if (n < 0) { out[0] = x; out[1] = y; return out; } return nodeXY(n, out); };

// ---------- spatial hash (rebuilt every frame): neighbour queries, collision answers ----------
const HN = 2048, HEAD = new Int32Array(HN), NEXT = new Int32Array(1024), QOUT = new Array(256);
const HL = []; let qStamp = 0, HC = 3;
const hk = (cx, cy) => ((cx * 73856093) ^ (cy * 19349663)) & (HN - 1);
function rebuildHash() {
  HEAD.fill(-1); HL.length = 0; const n = Math.min(ALL.length, NEXT.length); // HL is a snapshot: ALL shifts when people are dropped mid-frame, the bucket indices must not
  for (let i = 0; i < n; i++) { const o = ALL[i]; HL.push(o); if (o.dead) continue; const h = hk(Math.floor(o.x / HC), Math.floor(o.y / HC)); NEXT[i] = HEAD[h]; HEAD[h] = i; }
}
function collect(x, y, r) { // fills QOUT with live NPCs near (x, y); returns the count (do not nest)
  const x0 = Math.floor((x - r) / HC), x1 = Math.floor((x + r) / HC), y0 = Math.floor((y - r) / HC), y1 = Math.floor((y + r) / HC); let c = 0; qStamp++;
  for (let cx = x0; cx <= x1; cx++) for (let cy = y0; cy <= y1; cy++) for (let j = HEAD[hk(cx, cy)]; j >= 0; j = NEXT[j]) {
    const o = HL[j]; if (o.qs === qStamp || o.dead) continue; o.qs = qStamp; if (c < QOUT.length) QOUT[c++] = o;
  }
  return c;
}

// ---------- creating NPCs ----------
function makeNPC(id, name, role, x, y, heading, app, def, kind) {
  const n = { id, name, role, title: def.title, x, y, z: groundAt(x, y), heading, speed: 0, state: 'idle', behavior: def.behavior || 'idle', def, talking: false,
    kind, dead: false, hidden: false, real: false, slot: null, pick: 0, recipe: buildRecipe(app), rig: new Animator(), animDt: 0, hold: 0, qs: 0, vx: 0, vy: 0, vWalk: 1.3, vRun: 3.4, run: false, path: null, pi: 0, wait: 0, acc: 0, k: ALL.length,
    goto: null, anchor: def.anchor || null, tget: null, hasW: false, dist: 2, faceT: null, idleState: 'idle', talkCd: 0, greetCd: rnd(0, 20), flinchT: 0, slideX: 0, slideY: 0, bumpCd: 0, sayCd: rnd(3, 10), stuck: 0,
    pathReq: false, pc: 0, partner: null, spot: null, t1: rnd(0, 5), t2: 0, _label: '', _ft: [0, 0], _pos: [x, y, 0], _head: new THREE.Vector3(), _hfn: null, _posFn: null, onPathEnd: null };
  n.hold = n.recipe.hold; n._hfn = () => n._head.set(n.x, n.z + 1.95 * n.recipe.s, -n.y);
  n._posFn = () => { n._pos[0] = n.x; n._pos[1] = n.y; n._pos[2] = n.z + 1; return n._pos; };
  setLabel(n); return n;
}
const aim = (n, x, y) => { const f = n._ft; f[0] = x; f[1] = y; return f; }; // per-NPC look-at point, rewritten in place (faceT is only ever read, never kept)
const setLabel = n => { n._label = 'Talk to ' + n.name + (n.title ? ' (' + n.title + ')' : ''); };
function reg(n) { if (n.def.talk !== false) register({ id: 'npc:' + n.id, pos: n._posFn, r: 2.2, label: () => n._label, kind: 'npc', onInteract: () => talkTo(n) }); }
function addToWorld(n) { ALL.push(n); BYID.set(n.id, n); n.k = ALL.length; reg(n); }
function dropFromWorld(n) {
  if (n.real) releaseReal(n); releaseSeat(n); n.dead = true; unregister('npc:' + n.id); BYID.delete(n.id); const i = ALL.indexOf(n); if (i >= 0) ALL.splice(i, 1);
  const a = AMB.indexOf(n); if (a >= 0) AMB.splice(a, 1);
  if (n.spot) { const s = n.spot.npcs.indexOf(n); if (s >= 0) n.spot.npcs.splice(s, 1); }
  const f = FB.indexOf(n); if (f >= 0) FB.splice(f, 1); if (fbFetch === n) fbFetch = null; if (fbChase[0] === n) fbChase[0] = null; if (fbChase[1] === n) fbChase[1] = null;
}
let nameUse = new Set();
function pickName(female) { for (let t = 0; t < 8; t++) { const nm = pickOf(female ? NAMES_F : NAMES_M); if (!nameUse.has(nm)) return nm; } return pickOf(female ? NAMES_F : NAMES_M); }
function hashStr(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
function seeded(seed) { let a = seed | 0; return () => { a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
const ROLE_KEYS = ['priest', 'guard', 'vendor', 'student', 'elder', 'kid', 'jogger', 'office'];
function roleHint(def) { const s = ((def.role || '') + ' ' + (def.title || '')).toLowerCase(); for (const k of ROLE_KEYS) if (s.includes(k)) return k; if (/pujari|purohit/.test(s)) return 'priest'; if (/seller|shop|stall|kiosk|owner/.test(s)) return 'vendor'; if (/child/.test(s)) return 'kid'; return 'commuter'; }

// ---------- ambient population ----------
function rollRole() {
  const am = hour >= 7.3 && hour < 9.7, pm = hour >= 13.8 && hour < 16.8, school = am || pm;
  const w = [['commuter', 0.15 + (am ? 0.1 : 0)], ['shopper', 0.12], ['student', 0.06 + (school ? 0.16 : 0)], ['elder', 0.09], ['jogger', hour < 8.8 ? 0.16 : 0.025], ['kid', 0.07 + (pm ? 0.05 : 0)], ['mekhela', 0.1], ['sari', 0.07], ['office', 0.07 + (am ? 0.06 : 0)], ['phone', 0.07]];
  let t = 0; for (const e of w) t += e[1]; let r = Math.random() * t; for (const e of w) { r -= e[1]; if (r <= 0) return e[0]; } return 'commuter';
}
const SPEEDS = { commuter: [1.25, 1.6], office: [1.3, 1.6], shopper: [1.0, 1.3], student: [1.1, 1.5], elder: [0.8, 1.0], jogger: [2.6, 3.2], kid: [1.0, 1.3], mekhela: [1.0, 1.3], sari: [1.0, 1.3], phone: [0.85, 1.1] };
// give an ambient slot a new identity and a new place; returns false if the walk graph has nothing to offer
function placeAmbient(n, initial) {
  const role = rollRole(); let pt = null;
  if (role === 'student' && ((hour >= 7.3 && hour < 9.7) || (hour >= 13.8 && hour < 16.8)) && chance(0.6)) {
    const sc = pickOf(SCHOOLS); if (initial ? Math.hypot(sc[0] - P.x, sc[1] - P.y) < SPAWN_R - 20 : Math.hypot(sc[0] - P.x, sc[1] - P.y) > 130 && Math.hypot(sc[0] - P.x, sc[1] - P.y) < RECYCLE_R - 20) pt = randomPoint({ x: sc[0], y: sc[1] }, 8, 45);
  }
  if (!pt) pt = initial ? randomPoint(P, 14, SPAWN_R) : randomPointDir(P, 120, 190, camAng + Math.PI, 1.25);
  if (!pt || pt.node < 0) return false;
  const app = randomAppearance(Math.random, { role }), female = !!app.female;
  nameUse.delete(n.name); n.name = pickName(female); nameUse.add(n.name);
  n.role = role; n.title = undefined; n.def = { talk: true, behavior: role === 'kid' ? 'play' : 'wander' }; setLabel(n);
  n.recipe = buildRecipe(app); n.hold = n.recipe.hold; n.x = pt.x; n.y = pt.y; n.z = groundAt(pt.x, pt.y); n.heading = rnd(0, 6.28); n.vx = n.vy = n.speed = 0; n.state = 'idle'; n.idleState = 'idle';
  const sp = SPEEDS[role] || [1.1, 1.5]; n.vWalk = rnd(sp[0], sp[1]); n.run = role === 'jogger'; n.vRun = role === 'jogger' ? n.vWalk : rnd(2.4, 3.4);
  n.path = null; n.pi = 0; n.goto = null; n.wait = rnd(0, 4); n.pathReq = false; n.talking = false; n.flinchT = 0; n.faceT = null; n.acc = 0; n.stuck = 0; n.tget = null; n.hasW = false; n.dead = false;
  n.behavior = n.def.behavior; n.anchor = role === 'kid' ? { x: pt.x, y: pt.y, r: rnd(7, 12) } : null; n.rig = new Animator();
  return true;
}
function spawnAmbient(initial) {
  const n = makeNPC('amb' + (ambSeq++), '', 'commuter', P.x, P.y, 0, {}, { talk: true }, 'ambient');
  if (!placeAmbient(n, initial)) { return false; }
  AMB.push(n); addToWorld(n); return true;
}
function recycle(n) {
  if (n.talking || n.goto) return; unregister('npc:' + n.id);
  if (placeAmbient(n, false)) reg(n); else { dropFromWorld(n); }
}

// ---------- fixed spots: vendors, sitters, chatting pairs, kids at play (appear when the player is within ~200 m) ----------
function spot(x, y, h0, h1, make) { SPOTS.push({ x, y, h0, h1, make, npcs: [], active: false }); }
function buildSpots() {
  // Hatigarh stall row: every stall but the first (that one belongs to a named seller) has someone behind the counter
  for (let k = 1; k < 9; k++) spot(-489.3, -60.2 + k * 2.45, 6, 18.5, sp => [{ role: 'vendor', x: sp.x + 1.4, y: sp.y, heading: Math.PI, behavior: 'vendor' }]);
  // bus shelter: two people waiting on the bench, facing the road
  try {
    const [bx, by, bi] = beside(-57, -1, asphHalf(nearestOnMain(-57, -74)[1]) + 3.4), toRoad = Math.atan2(MAINP[bi][1] - by, MAINP[bi][0] - bx);
    spot(bx, by, 7, 18, sp => [{ role: 'commuter', x: sp.x - 0.6, y: sp.y, heading: toRoad, behavior: 'sit' }, { role: 'office', x: sp.x + 0.6, y: sp.y, heading: toRoad, behavior: 'sit', phone: true }]);
  } catch (e) { /* bus stand helpers missing */ }
  // View point terrace: two friends standing at the south railing looking out (visitor photos show people standing, not sitting on the tiles)
  spot(78, 197, 8, 18, sp => [{ role: 'commuter', x: 77.4, y: 196.9, heading: -Math.PI / 2 + 0.25, behavior: 'chat' }, { role: 'mekhela', x: 78.6, y: 196.9, heading: -Math.PI / 2 - 0.25, behavior: 'chat' }]);
  // chatting pairs near shops, the park forecourt and Hatigarh
  const pair = (x, y, roles) => { const s = snap(x, y, [0, 0]); spot(s[0], s[1], 6.5, 18, sp => { const a = rnd(0, 3.14); return [0, 1].map(k => ({ role: roles[k], x: sp.x + Math.cos(a) * 0.55 * (k ? -1 : 1), y: sp.y + Math.sin(a) * 0.55 * (k ? -1 : 1), heading: a + (k ? 0 : Math.PI), behavior: 'chat' })); }); };
  pair(-110, -88, ['mekhela', 'sari']); pair(-456, -66, ['commuter', 'elder']); pair(28, -49, ['shopper', 'office']); pair(-60, -60, ['elder', 'elder']); pair(FIELD_C[0] + 24, GEO.field[1] - 5, ['commuter', 'phone']);
  // kids at play on the field and on the park forecourt
  // a 3-a-side match on the field: a keeper, a defender and an attacker per team (see football() below)
  spot(FIELD.cx, FIELD.cy, 6.5, 18, () => [0, 1, 2, 3, 4, 5].map(k => {
    const team = k < 3 ? 0 : 1, j = k % 3, g = FIELD.goals[team], [x, y] = fieldXY(j === 0 ? g.t + g.inward * 1.2 : (team ? 1 : -1) * (j === 1 ? 9 : 3),(j === 1 ? -5 : j === 2 ? 5 : 0) * (team ? -1 : 1));
    return { role: 'kid', x, y, heading: team ? Math.atan2(-FIELD.uy, -FIELD.ux) : Math.atan2(FIELD.uy, FIELD.ux), behavior: 'football', team, fpos: SLOTS3[j], side: j === 1 ? -1 : 1 };
  }));
  spot(-105, -100, 7, 18, sp => [0, 1].map(k => ({ role: 'kid', x: sp.x + rnd(-4, 4), y: sp.y + rnd(-4, 4), heading: rnd(0, 6.28), behavior: 'play', anchor: { x: sp.x, y: sp.y, r: 9 } })));
}
function activateSpot(sp) {
  sp.active = true;
  for (const c of sp.make(sp)) {
    if (c.behavior !== 'sit' && !walkable(c.x, c.y)) continue; // never stand a person inside a stall or wall
    const app = randomAppearance(Math.random, { role: c.role, kid: c.role === 'kid' ? true : undefined }); if (c.phone) app.phone = true;
    if (c.team !== undefined) { app.top = TEAM_TOP[c.team]; app.topStyle = 'tshirt'; app.bottomStyle = 'pants'; app.bag = app.umbrella = app.wrap = null; } // bibs: one team red, the other blue
    const n = makeNPC('spot' + (ambSeq++), pickName(!!app.female), c.role, c.x, c.y, c.heading, app, { talk: true, behavior: c.behavior }, 'spot');
    n.name = n.name || 'Local'; setLabel(n); n.spot = sp; n.behavior = c.behavior; n.anchor = c.anchor || null; n.idleState = c.floor ? 'floor' : c.behavior === 'sit' ? 'sit' : 'idle';
    n.vWalk = rnd(1.0, 1.3); n.vRun = rnd(2.6, 3.4); sp.npcs.push(n); addToWorld(n);
    if (c.team !== undefined) { n.team = c.team; n.fpos = c.fpos; n.side = c.side; n.kickT = 0; n.cel = 0; FB.push(n); }
  }
  for (const n of sp.npcs) if (n.behavior === 'chat') { const o = sp.npcs.find(m => m !== n && m.behavior === 'chat'); if (o) { n.partner = o; n.t1 = rnd(0, 3); n.t2 = n === sp.npcs[0] ? 1 : 0; } }
}
function manageSpots() {
  for (const sp of SPOTS) {
    const d = Math.hypot(sp.x - P.x, sp.y - P.y), open = hour >= sp.h0 && hour < sp.h1;
    if (!sp.active && open && d < SPAWN_R) activateSpot(sp);
    else if (sp.active && (!open || d > RECYCLE_R + 30)) { // drop in order without copying: dropFromWorld splices n out of sp.npcs, so only step on when n stayed (talking)
      const L = sp.npcs; for (let i = 0; i < L.length;) { const n = L[i]; if (!n.talking) dropFromWorld(n); if (L[i] === n) i++; }
      if (!sp.npcs.length) sp.active = false;
    }
  }
}

// ---------- movement ----------
const W = { go: false, x: 0, y: 0, v: 1.3, arrive: false };
// body yaw eases toward the wanted angle: a lagged turn rate (at most `rate` rad/s) rather than a constant-speed snap
function turnTo(n, ang, rate, dt) { const d = wrap(ang - n.heading), w = Math.max(-rate, Math.min(rate, d * rate * 0.8)); n.hv = (n.hv || 0) + (w - (n.hv || 0)) * (1 - Math.exp(-18 * dt)); n.heading = wrap(n.heading + n.hv * dt); }
function want(x, y, v, arrive) { W.go = true; W.x = x; W.y = y; W.v = v; W.arrive = !!arrive; }
// walk a path of waypoints; true while there is more to do
function follow(n, dt) {
  const p = n.path; if (!p || n.pi >= p.length) return false;
  let w = p[n.pi], d = Math.hypot(w[0] - n.x, w[1] - n.y);
  if (d < 0.9 + n.speed * 0.15) { n.pi++; n.stuck = 0; if (n.pi >= p.length) return false; w = p[n.pi]; d = Math.hypot(w[0] - n.x, w[1] - n.y); }
  if (w[2] === 1 && n.pi > 0 && p[n.pi - 1][2] !== 1 && d < 3 && vehicleAt(n.x, n.y, 16)) { W.go = false; return true; } // wait at the kerb for traffic to pass
  want(w[0], w[1], n.goto && n.goto.run ? n.vRun : n.run ? n.vRun : n.vWalk, false);
  if (n.speed < 0.1 && W.go) { n.stuck += dt; if (n.stuck > 3) { n.pi++; n.stuck = 0; } } else n.stuck = 0;
  return true;
}
function queuePath(n) { if (!n.pathReq) { n.pathReq = true; PQ.push(n); } }
function pickDest(n, out) {
  const r = n.role, am = hour >= 7.3 && hour < 9.7, pm = hour >= 13.8 && hour < 16.8, roll = Math.random();
  let p = null;
  if (r === 'student' && (am || pm) && roll < 0.65) p = pickOf(SCHOOLS);
  else if ((r === 'shopper' || r === 'mekhela' || r === 'sari') && roll < 0.6) p = pickOf(POIS.shop);
  else if ((r === 'commuter' || r === 'office') && roll < 0.45) p = pickOf(POIS.other);
  else if (r === 'jogger' && roll < 0.5) { const f = GEO.field, c = [[f[0] - 6, f[1] - 6], [f[2] + 6, f[1] - 6], [f[2] + 6, f[3] + 6], [f[0] - 6, f[3] + 6]]; p = pickOf(c); }
  else if (r === 'elder' && roll < 0.2) p = pickOf(POIS.other);
  if (p) { snap(p[0] + rnd(-3, 3), p[1] + rnd(-3, 3), out); n.pc = 1; return true; }
  n.pc = 0;
  const q = r === 'elder' || r === 'phone' ? randomPoint(n, 20, 80) : r === 'jogger' ? randomPointDir(n, 110, 260, n.heading, 1.4) : randomPointDir(n, 50, 170, n.heading, 1.5);
  if (!q || q.node < 0) return false; out[0] = q.x; out[1] = q.y; return true;
}
const _d = [0, 0];
function processPaths() {
  for (let k = 0; k < 2 && PQ.length; k++) {
    const n = PQ.shift(); n.pathReq = false; if (n.dead) continue;
    if (n.goto) {
      const g = n.goto, p = findPath(n.x, n.y, g.x, g.y, n.heading);
      if (p && p.length) { g.path = p; n.path = p; n.pi = 0; } else if (Math.hypot(g.x - n.x, g.y - n.y) < 80) { g.path = [[g.x, g.y]]; n.path = g.path; n.pi = 0; } else { n.x = g.x; n.y = g.y; n.path = [[g.x, g.y]]; n.pi = 0; }
      continue;
    }
    if (n.behavior !== 'wander') continue;
    if (!pickDest(n, _d)) { n.wait = rnd(1.5, 3); continue; }
    const p = findPath(n.x, n.y, _d[0], _d[1], n.heading);
    if (p && p.length > 1) { n.path = p; n.pi = 0; } else n.wait = rnd(1.5, 4);
  }
}
function arrived(n) { // dwell at the end of a walk: shoppers face the stall, students linger at the gate
  n.path = null; const r = n.role;
  n.wait = r === 'student' && n.pc ? rnd(15, 40) : r === 'shopper' || r === 'mekhela' || r === 'sari' ? (n.pc ? rnd(6, 14) : rnd(2, 6)) : r === 'elder' ? rnd(6, 20) : r === 'phone' ? rnd(5, 15) : r === 'jogger' ? rnd(0.5, 2) : rnd(2, 9);
  if (n.pc && POIS.shop.length) { let best = null, bd = 12; for (const s of POIS.shop) { const d = Math.hypot(s[0] - n.x, s[1] - n.y); if (d < bd) { bd = d; best = s; } } n.faceT = best; }
}
function moveGoto(n, dt) {
  const g = n.goto;
  if (!g.path) { if (!n.pathReq) { n.path = null; queuePath(n); } return; }
  if (!follow(n, dt)) { n.goto = null; n.path = null; try { if (g.onArrive) g.onArrive(n); } catch (e) { console.error('[npc] onArrive failed', e); } }
}
// two wanderers passing within 2 m now and then stop to chat for a few seconds (not joggers or kids, never while the player watches up close)
function meet(n, dt) {
  n.meetCd = (n.meetCd == null ? rnd(2, 8) : n.meetCd) - dt; if (n.meetCd > 0) return;
  n.meetCd = rnd(5, 10); if (n.role === 'jogger' || n.role === 'kid' || n.kind !== 'ambient') return;
  const c = collect(n.x, n.y, 2.2);
  for (let i = 0; i < c; i++) {
    const o = QOUT[i]; if (o === n || o.behavior !== 'wander' || o.pause > 0 || o.role === 'jogger' || o.role === 'kid' || o.kind !== 'ambient') continue;
    if (Math.hypot(o.x - n.x, o.y - n.y) > 2 || !chance(0.15)) continue;
    const t = rnd(4, 9); n.pause = t; o.pause = t + rnd(-0.5, 0.5); n.mate = o; o.mate = n; n.t2 = 0; o.t2 = rnd(1, 2); o.meetCd = rnd(20, 40); n.meetCd = rnd(20, 40);
    if (P && Math.hypot(P.x - n.x, P.y - n.y) < 14 && chance(0.3)) say(n, pickOf(GREET), 2000);
    break;
  }
}
function behave(n, dt) {
  switch (n.behavior) {
    case 'wander':
      if (n.pause > 0) { // stopped for a word with someone met on the way
        n.pause -= dt; const o = n.mate; if (o && !o.dead) n.faceT = aim(n, o.x, o.y);
        if (n.pause <= 0 || !o || o.dead) { n.pause = 0; n.idleState = 'idle'; n.faceT = null; n.mate = null; } else { n.t2 -= dt; if (n.t2 <= 0) { n.t2 = rnd(1.5, 3.5); n.idleState = n.idleState === 'talk' ? 'idle' : 'talk'; } }
        break;
      }
      if (n.path) { meet(n, dt); if (!follow(n, dt)) arrived(n); } else if (n.wait > 0) n.wait -= dt; else { n.faceT = null; queuePath(n); }
      break;
    case 'pace': {
      const a = n.anchor || { x: n.x, y: n.y, r: 3 };
      if (n.wait > 0) { n.wait -= dt; break; }
      if (!n.hasW || Math.hypot(n.t1 - n.x, n.t2 - n.y) < 0.6) { const ang = n.heading + (chance(0.5) ? 0 : Math.PI), d = rnd(0.6, 1) * a.r; n.t1 = a.x + Math.cos(ang) * d; n.t2 = a.y + Math.sin(ang) * d; n.hasW = true; if (!walkable(n.t1, n.t2)) { n.t1 = a.x; n.t2 = a.y; } n.wait = chance(0.6) ? rnd(1.5, 5) : 0; if (n.wait > 0) { n.hasW = false; break; } }
      want(n.t1, n.t2, Math.min(n.vWalk, 1.0), false); break;
    }
    case 'patrol': {
      const path = n.def.path; if (!path || !path.length) break;
      if (n.wait > 0) { n.wait -= dt; break; }
      const w = path[n.pi % path.length]; if (Math.hypot(w[0] - n.x, w[1] - n.y) < 0.9) { n.pi = (n.pi + 1) % path.length; n.wait = chance(0.25) ? rnd(0.8, 2.5) : 0; break; }
      want(w[0], w[1], n.vWalk, false); break;
    }
    case 'follow': {
      const t = n.tget && n.tget(); if (!t) break; const tx = Array.isArray(t) ? t[0] : t.x, ty = Array.isArray(t) ? t[1] : t.y, dx = n.x - tx, dy = n.y - ty, d = Math.hypot(dx, dy) || 1;
      if (d > n.dist + 0.7) want(tx + dx / d * n.dist, ty + dy / d * n.dist, d > 10 ? n.vRun : Math.min(n.vRun * 0.6, 0.9 + (d - n.dist) * 0.6), true); else n.faceT = aim(n, tx, ty);
      break;
    }
    case 'play': {
      const a = n.anchor || { x: n.x, y: n.y, r: 8 }, t = n.tget ? n.tget() : null;
      if (t) { const tx = Array.isArray(t) ? t[0] : t.x, ty = Array.isArray(t) ? t[1] : t.y, d = Math.hypot(tx - n.x, ty - n.y); if (d > 1.6) { want(tx, ty, n.vRun, true); break; } n.idleState = 'wave'; break; }
      if (n.kickT > 0) { // the foot meets the ball ~0.17 s into the kick
        n.kickT -= dt; if (n.kickIn > 0 && (n.kickIn -= dt) <= 0 && n.kO && Math.hypot(n.kO.x - n.x, n.kO.y - n.y) < 0.9) kickLoose(n.kO, n.kA, n.kV, n.kL);
        if (n.kickT <= 0) { n.idleState = 'idle'; n.faceT = null; } break;
      }
      const lb = n.spot ? nearLoose('ball', a.x, a.y, a.r + 14) : null; // a kickabout: whichever kid of the group is nearest the ball goes for it, fetching it if it rolled off
      if (lb) {
        n.lookOn = true; n.lookX = lb.x; n.lookY = lb.y; n.lookZ = lb.z;
        let near = n, nd = Math.hypot(lb.x - n.x, lb.y - n.y); for (const m of n.spot.npcs) { const d = Math.hypot(lb.x - m.x, lb.y - m.y); if (m.behavior === 'play' && !m.talking && d < nd - 0.5) { near = m; nd = d; } }
        if (near === n) {
          if (nd > 0.5) { want(lb.x, lb.y, n.vRun, false); break; }
          const sib = n.spot.npcs.find(m => m !== n && !m.dead), tx = sib ? sib.x : a.x, ty = sib ? sib.y : a.y;
          n.kickT = 0.45; n.kickIn = 0.17; n.kO = lb; n.kA = Math.atan2(ty - lb.y, tx - lb.x) + rnd(-0.25, 0.25); n.kV = clampN(Math.hypot(tx - lb.x, ty - lb.y) * 0.8 + 1.5, 3, 7); n.kL = rnd(0.3, 1.8);
          n.idleState = 'kick'; n.faceT = aim(n, lb.x, lb.y); n.hasW = false; break;
        }
      }
      if (n.wait > 0) { n.wait -= dt; if (n.wait <= 0) n.idleState = 'idle'; break; }
      if (!n.hasW || Math.hypot(n.t1 - n.x, n.t2 - n.y) < 0.8) {
        for (let k = 0; k < 4; k++) { const ang = rnd(0, 6.28), d = rnd(2, a.r); n.t1 = a.x + Math.cos(ang) * d; n.t2 = a.y + Math.sin(ang) * d; if (walkable(n.t1, n.t2)) break; n.t1 = a.x; n.t2 = a.y; }
        n.hasW = true; if (chance(0.45)) { n.wait = rnd(0.6, 2.5); n.idleState = chance(0.5) ? 'wave' : 'idle'; break; }
      }
      want(n.t1, n.t2, n.vRun, false); break;
    }
    case 'vendor': {
      n.t1 -= dt; if (n.t1 > 0) break;
      if (!P) break; const d = Math.hypot(P.x - n.x, P.y - n.y);
      if (n.idleState === 'talk') { n.idleState = 'idle'; n.t1 = rnd(3, 8); } else if (d < 14 && chance(0.5)) { n.idleState = d < 9 && chance(0.3) ? 'wave' : 'talk'; n.t1 = rnd(2, 4); n.faceT = [P.x, P.y]; } else { n.t1 = rnd(2, 6); n.faceT = null; }
      break;
    }
    case 'chat': {
      n.t1 -= dt; const o = n.partner; if (o && !o.dead) n.faceT = aim(n, o.x, o.y);
      if (n.t1 <= 0) { n.t1 = rnd(2.5, 6); n.idleState = n.idleState === 'talk' ? 'idle' : 'talk'; if (o && !o.dead) o.idleState = n.idleState === 'talk' ? 'idle' : 'talk'; if (n.idleState === 'talk' && P && Math.hypot(P.x - n.x, P.y - n.y) < 16 && chance(0.18)) say(n, pickOf(BANTER), 2200); }
      break;
    }
    case 'football': football(n, dt); break;
    case 'sit': break;
    default: break; // idle
  }
}
// ---------- football: the kids' 3-a-side match ----------
// A team brain (footballBrain, once a frame) picks who goes for the ball: per team the nearest outfield kid, the keeper only when the
// ball is in his box, and whoever has it keeps it unless a teammate is clearly closer, so they don't swap every frame. Everyone else
// holds a spot relative to the ball (defender behind it, attacker ahead of it, keeper on his line tracking it sideways). The chaser
// gets round behind the ball, then shoots when in range, passes to an open teammate further up, or dribbles with short touches.
// Shots and passes play the kick animation and the ball leaves when the foot arrives; dribble touches are taken in stride.
const SLOTS3 = ['keep', 'def', 'att'], TEAM_TOP = ['#c8322d', '#2f6fc0'], FB = [], fbChase = [null, null];
let fbFetch = null, fbShout = 0;
const SHOUT = ['Pass! Pass!', 'Idhar! Over here!', 'Shoot!', 'Arey, mark him!'], CHEER = ['GOAL!', 'Goooal!', 'Hoi! Goal!'], ASK = ['Ball dia! Give us the ball!', 'Dada, the ball please!', 'Throw it here!'];
const fT = (x, y) => (x - FIELD.cx) * FIELD.ux + (y - FIELD.cy) * FIELD.uy, fL = (x, y) => -(x - FIELD.cx) * FIELD.uy + (y - FIELD.cy) * FIELD.ux; // along the pitch, across it
const _fp = [0, 0], clampN = (v, a, b) => Math.max(a, Math.min(b, v));
function fieldXY(t, l, out = [0, 0]) { out[0] = FIELD.cx + FIELD.ux * t - FIELD.uy * l; out[1] = FIELD.cy + FIELD.uy * t + FIELD.ux * l; return out; }
function inBox(n, b) { const g = FIELD.goals[n.team]; return (fT(b.x, b.y) - g.t) * g.inward < 9 && Math.abs(fL(b.x, b.y)) < 8; }
function footballBrain(dt) {
  const b = ballRef(); if (!b || !FB.length) return;
  fbShout -= dt;
  const inPlay = !b.carried && b.resetT <= 0 && ballInField();
  for (let t = 0; t < 2; t++) {
    let best = null, bd = 1e9; const cur = fbChase[t];
    for (const n of FB) {
      if (n.team !== t || n.talking || (n.fpos === 'keep' && !inBox(n, b))) continue;
      const d = Math.hypot(b.x - n.x, b.y - n.y) - (n === cur ? 2 : 0); if (d < bd) { bd = d; best = n; }
    }
    fbChase[t] = inPlay ? best : null;
  }
  // over the touchline with nobody holding it: the nearest kid fetches it and throws it back in
  if (!b.carried && b.resetT <= 0 && !ballInField() && Math.hypot(b.x - FIELD.cx, b.y - FIELD.cy) < 80) {
    if (!fbFetch) { let bd = 1e9; for (const n of FB) { if (n.talking) continue; const d = Math.hypot(b.x - n.x, b.y - n.y); if (d < bd) { bd = d; fbFetch = n; } } }
  } else if (fbFetch && !(fbFetch.kickT > 0)) fbFetch = null;
  // a kid's body shoves the ball out of the way, so nobody runs through it (only near the player, where it shows)
  if (P && Math.hypot(b.x - P.x, b.y - P.y) < 60) for (const n of FB) if (!(n.kickT > 0)) pushBall(n.x, n.y, 0.22, n.speed);
}
function startKick(n, b, ang, v, lift, anim) { // anim: 'kick' (shot or pass) or 'pickup' (throw-in)
  n.kickT = anim === 'pickup' ? 0.95 : 0.5; n.kickIn = anim === 'pickup' ? 0.85 : 0.17; n.kA = ang; n.kV = v; n.kL = lift; n.idleState = anim; n.faceT = aim(n, b.x, b.y);
}
function football(n, dt) {
  const b = ballRef(); if (!b) return;
  n.lookOn = true; n.lookX = b.x; n.lookY = b.y; n.lookZ = b.z;
  if (n.kickT > 0) { // mid-kick or mid-pickup: stand still and let the animation play; the ball leaves when the foot (or the throw) arrives
    n.kickT -= dt;
    if (n.kickIn > 0 && (n.kickIn -= dt) <= 0 && Math.hypot(b.x - n.x, b.y - n.y) < 1.1) npcKick(n.kA, n.kV, n.kL);
    if (n.kickT <= 0) { n.idleState = 'idle'; n.faceT = null; if (fbFetch === n) fbFetch = null; }
    return;
  }
  if (n.cel > 0) { n.cel -= dt; if (n.cel <= 0) { n.idleState = 'idle'; n.faceT = null; } return; }
  if (b.carried && P) { // the player walked off with it: stand, face them and ask for it back
    n.faceT = aim(n, P.x, P.y); lookAtPlayer(n);
    const d = Math.hypot(P.x - n.x, P.y - n.y);
    if (d > 7 && d < 35) want(P.x + (n.x - P.x) / d * 5, P.y + (n.y - P.y) / d * 5, n.vWalk * 1.3, true);
    n.t1 -= dt; if (n.t1 <= 0) { n.t1 = rnd(1.5, 3.5); n.idleState = chance(0.5) ? 'wave' : 'idle'; if (fbShout <= 0 && d < 25) { say(n, pickOf(ASK), 2400); fbShout = rnd(6, 10); } }
    return;
  }
  n.faceT = null; if (n.idleState === 'wave') n.idleState = 'idle';
  if (fbFetch === n) { // run to the ball, pick it up, throw it toward the middle
    const d = Math.hypot(b.x - n.x, b.y - n.y);
    if (d > 0.55) { want(b.x, b.y, n.vRun, true); return; }
    const [tx, ty] = fieldXY(clampN(fT(b.x, b.y), FIELD.lo + 10, FIELD.hi - 10) * 0.6, 0, _fp), a = Math.atan2(ty - b.y, tx - b.x);
    startKick(n, b, a, clampN(Math.hypot(tx - b.x, ty - b.y) * 0.55, 5, 9), 3.2, 'pickup'); return;
  }
  const opp = FIELD.goals[1 - n.team], own = FIELD.goals[n.team], dir = n.team ? -1 : 1;
  if (fbChase[n.team] === n) { chaseBall(n, b, opp); return; }
  // off the ball: hold a spot relative to it, re-picked now and then so the shape breathes instead of sliding with every roll
  if ((n.t1 -= dt) <= 0 || n.sx === undefined) {
    n.t1 = rnd(0.5, 1.2); const bt = fT(b.x, b.y), bl = fL(b.x, b.y); let t, l;
    if (n.fpos === 'keep') { t = own.t + own.inward * 1.2; l = clampN(bl * 0.3, -3, 3); }
    else if (n.fpos === 'def') { t = dir > 0 ? clampN(bt - 8, own.t + 5, Math.max(bt, own.t + 5)) : clampN(bt + 8, Math.min(bt, own.t - 5), own.t - 5); l = clampN(bl * 0.5 + n.side * 5, FIELD.wlo + 3, FIELD.whi - 3); }
    else { t = clampN(bt + dir * rnd(6, 10), FIELD.lo + 4, FIELD.hi - 4); l = clampN(bl * 0.3 + n.side * rnd(5, 9), FIELD.wlo + 3, FIELD.whi - 3); }
    fieldXY(t, l, _fp); n.sx = _fp[0]; n.sy = _fp[1];
  }
  const d = Math.hypot(n.sx - n.x, n.sy - n.y);
  if (d > 0.8) want(n.sx, n.sy, d > 6 ? n.vRun : Math.max(1.3, n.vRun * 0.5), true); else n.faceT = aim(n, b.x, b.y);
  if (n.fpos === 'att' && fbShout <= 0 && P && Math.hypot(P.x - n.x, P.y - n.y) < 20 && chance(0.004)) { say(n, pickOf(SHOUT), 1800); fbShout = rnd(5, 9); }
}
function chaseBall(n, b, opp) {
  const gx = opp.x - b.x, gy = opp.y - b.y, gd = Math.hypot(gx, gy) || 1, ux = gx / gd, uy = gy / gd; // ball -> the goal they attack
  const lead = Math.min(0.5, Math.hypot(b.x - n.x, b.y - n.y) / 7), bx = b.x + b.vx * lead, by = b.y + b.vy * lead; // run to where it is going
  const rx = n.x - bx, ry = n.y - by, d = Math.hypot(rx, ry) || 1e-3, behind = -(rx * ux + ry * uy) / d; // 1: straight behind it, -1: between it and the goal
  if (d < 0.7 && behind > 0.2 && b.z - n.z < 0.6) {
    if (n.fpos === 'keep') { startKick(n, b, Math.atan2(uy, ux) + rnd(-0.4, 0.4), rnd(11, 14), rnd(4, 6), 'kick'); return; } // clear it upfield
    if (gd < 17) { // shoot: somewhere between the posts
      const [tx, ty] = fieldXY(opp.t, rnd(-3.2, 3.2), _fp); startKick(n, b, Math.atan2(ty - b.y, tx - b.x), rnd(9, 12.5), rnd(0.4, 3), 'kick');
      if (fbShout <= 0 && chance(0.3)) { say(n, 'Shoot!', 1200); fbShout = 4; } return;
    }
    let mate = null, ma = 2;
    for (const m of FB) {
      if (m.team !== n.team || m === n || m.fpos === 'keep') continue;
      const ahead = (m.x - b.x) * ux + (m.y - b.y) * uy, md = Math.hypot(m.x - b.x, m.y - b.y); if (ahead < ma || md > 24 || md < 4) continue;
      let open = true; for (const o of FB) if (o.team !== n.team && Math.hypot(o.x - m.x, o.y - m.y) < 2.5) { open = false; break; }
      if (open) { ma = ahead; mate = m; }
    }
    let press = false; for (const o of FB) if (o.team !== n.team && Math.hypot(o.x - n.x, o.y - n.y) < 2.2) { press = true; break; }
    if (mate && chance(press ? 0.8 : 0.35)) { // pass into the teammate's run
      const px = mate.x + mate.vx * 0.6, py = mate.y + mate.vy * 0.6, pd = Math.hypot(px - b.x, py - b.y);
      startKick(n, b, Math.atan2(py - b.y, px - b.x), clampN(pd * 0.7 + 3, 5, 11), 0.3, 'kick'); return;
    }
    npcKick(Math.atan2(uy, ux) + rnd(-0.35, 0.35) + (press ? (chance(0.5) ? 0.6 : -0.6) : 0), Math.max(n.speed, 1.5) + rnd(1.0, 2.0), 0); // dribble: a touch ahead, in stride; under pressure, cut away
  }
  // come at the ball from behind; on the wrong side of it, swing round instead of running through it
  let tx, ty;
  if (behind > -0.2 || d > 4) { tx = bx - ux * 0.45; ty = by - uy * 0.45; }
  else { const s = (rx * -uy + ry * ux) > 0 ? 1 : -1; tx = bx - ux * 0.9 - uy * s; ty = by - uy * 0.9 + ux * s; }
  want(tx, ty, n.vRun, false);
}
on('ball:goal', ({ goal, byPlayer }) => {
  const scorer = goal === 1 ? 0 : 1; let said = false; // team 0 attacks goals[1]
  for (const n of FB) {
    n.cel = rnd(2, 3); n.kickT = 0; n.idleState = n.team === scorer && !byPlayer ? 'wave' : 'idle'; n.faceT = null; n.sx = undefined;
    if (!said && P && Math.hypot(P.x - n.x, P.y - n.y) < 35 && (byPlayer || n.team === scorer)) { say(n, byPlayer ? 'Bhal shot! Nice one!' : pickOf(CHEER), 2200); said = true; }
  }
});

// wanting to move but getting nowhere: sidestep at an angle (1 s), then ask for a new route (3 s), then, out of the
// player's sight, hop to the nearest walk-graph node (7 s). Alternates the sidestep side so two people don't mirror each other.
const _u = [0, 0];
function unstick(n, dt, cheap) {
  if (!W.go || cheap) { n.stuckT = 0; return; }
  if (n.speed > 0.3 || Math.hypot(W.x - n.x, W.y - n.y) < 0.8) { n.stuckT = Math.max(0, (n.stuckT || 0) - dt * 2); n.stuckS = 0; return; }
  n.stuckT = (n.stuckT || 0) + dt; const t = n.stuckT;
  if (t > 1 && !n.stuckS) { n.stuckS = 1; n.dsign = -(n.dsign || 1); n.detour = n.dsign * rnd(0.9, 1.6); n.detourT = rnd(0.7, 1.1); }
  else if (t > 3 && n.stuckS === 1) {
    n.stuckS = 2; n.dsign = -n.dsign; n.detour = n.dsign * rnd(1.2, 2.0); n.detourT = 1;
    if (n.goto) { n.goto.path = null; n.path = null; queuePath(n); } else if (n.path) { n.path = null; n.wait = rnd(0.3, 1); } else n.hasW = false;
  } else if (t > 7) {
    n.stuckT = 0; n.stuckS = 0;
    if (!P || Math.hypot(P.x - n.x, P.y - n.y) > 18) { const k = nearestNode(n.x, n.y); if (k >= 0) { nodeXY(k, _u); n.x = _u[0]; n.y = _u[1]; n.vx = n.vy = 0; } }
    if (n.goto) { n.goto.path = null; n.path = null; queuePath(n); } else { n.path = null; n.hasW = false; n.wait = rnd(0.5, 2); }
  }
}
const SLIDE = [0.6, -0.6, 1.2, -1.2];
function locomote(n, dt, cheap) {
  let tvx = 0, tvy = 0, slow = 1;
  if (W.go) {
    const dx = W.x - n.x, dy = W.y - n.y, d = Math.hypot(dx, dy) || 1; let v = W.v; if (W.arrive) v = Math.min(v, d * 1.6 + 0.2);
    let ux = dx / d, uy = dy / d, ax = 0, ay = 0;
    if (n.detourT > 0) { n.detourT -= dt; const c = Math.cos(n.detour), s = Math.sin(n.detour); const rx = ux * c - uy * s; uy = ux * s + uy * c; ux = rx; } // unsticking: walk off at an angle for a moment
    if (!cheap) {
      // look-ahead avoidance: people up to ~2.6 m ahead are passed on one side (keep left, as on Indian roads) instead of
      // being pushed into head-on; anyone closer than 1 m still pushes apart
      const c = collect(n.x, n.y, 2.7);
      for (let i = 0; i < c; i++) {
        const o = QOUT[i]; if (o === n) continue; const rx = o.x - n.x, ry = o.y - n.y, dd = Math.hypot(rx, ry); if (dd > 2.6 || dd < 1e-3) continue;
        if (dd < 1.0) { const w = (1.0 - dd) / 1.0; ax -= rx / dd * w * 1.8; ay -= ry / dd * w * 1.8; }
        const ahead = (rx * ux + ry * uy) / dd; if (ahead < 0.35) continue;
        const side = rx * -uy + ry * ux; // > 0: the other is on my left
        const oncoming = o.speed > 0.2 && (o.vx * ux + o.vy * uy) < 0, k = (2.6 - dd) / 2.6 * ahead * (oncoming ? 1.3 : 0.9);
        const dir = Math.abs(side) < 0.25 ? 1 : side > 0 ? -1 : 1; // dead ahead: go left; otherwise away from them
        ax += -uy * dir * k * 1.4; ay += ux * dir * k * 1.4;
        if (dd < 1.2 && ahead > 0.8 && o.speed < 0.3) slow = Math.min(slow, 0.5); // someone standing right in the way
      }
      if (P) { // the player: give way by stepping round, slow right down only when very close
        const rx = P.x - n.x, ry = P.y - n.y, dd = Math.hypot(rx, ry);
        if (dd < 3 && dd > 1e-3) {
          if (dd < 1.6) { const w = (1.6 - dd) / 1.6; ax -= rx / dd * w * 2.4; ay -= ry / dd * w * 2.4; }
          const ahead = (rx * ux + ry * uy) / dd;
          if (ahead > 0.3) { const side = rx * -uy + ry * ux, dir = side > 0 ? -1 : 1, k = (3 - dd) / 3 * ahead; ax += -uy * dir * k * 2; ay += ux * dir * k * 2; if (dd < 1.0 && ahead > 0.8) slow = Math.min(slow, 0.25); }
        }
      }
    }
    tvx = ux * v * slow + ax; tvy = uy * v * slow + ay;
    const tv = Math.hypot(tvx, tvy), vmax = Math.max(v, 0.6) * 1.15; if (tv > vmax) { tvx *= vmax / tv; tvy *= vmax / tv; }
  }
  const k = Math.min(1, dt * 5); n.vx += (tvx - n.vx) * k; n.vy += (tvy - n.vy) * k;
  let sp = Math.hypot(n.vx, n.vy);
  if (sp > 0.04) {
    let nx = n.x + n.vx * dt, ny = n.y + n.vy * dt;
    if (!cheap && !walkable(nx, ny)) {
      // blocked: slide along the obstacle, trying the axes and then directions rotated off the blocked one
      let ok = false;
      if (walkable(nx, n.y)) { ny = n.y; ok = true; } else if (walkable(n.x, ny)) { nx = n.x; ok = true; }
      else for (const a of SLIDE) { const c = Math.cos(a), s = Math.sin(a), qx = n.x + (n.vx * c - n.vy * s) * dt, qy = n.y + (n.vx * s + n.vy * c) * dt; if (walkable(qx, qy)) { nx = qx; ny = qy; ok = true; break; } }
      if (!ok) { nx = n.x; ny = n.y; n.vx *= 0.3; n.vy *= 0.3; sp = 0; }
    }
    const moved = Math.hypot(nx - n.x, ny - n.y);
    n.x = nx; n.y = ny; if (sp > 0.15) turnTo(n, Math.atan2(n.vy, n.vx), 7, dt);
    sp = Math.min(sp, moved / Math.max(dt, 1e-3)); // the animation follows real progress, so nobody moonwalks into a wall
  } else sp = 0;
  n.speed = sp;
  unstick(n, dt, cheap);
  if (sp > 0.15) n.state = sp > 1.9 && (n.run || sp > 2.2) ? 'run' : 'walk';
  else {
    n.state = n.idleState;
    if (n.faceT) turnTo(n, Math.atan2(n.faceT[1] - n.y, n.faceT[0] - n.x), 4, dt);
  }
}
function stepNPC(n, dt, cheap) {
  n.z = groundAt(n.x, n.y);
  n.lookOn = false;
  if (n.talking) { if (P) { turnTo(n, Math.atan2(P.y - n.y, P.x - n.x), 6, dt); lookAtPlayer(n); } n.state = 'talk'; n.speed = 0; n.vx = n.vy = 0; return; }
  if (n.flinchT > 0) { n.flinchT -= dt; n.x += n.slideX * dt; n.y += n.slideY * dt; n.state = 'flinch'; n.speed = 0; return; }
  if (n.bumpCd > 0) n.bumpCd -= dt; if (n.greetCd > 0) n.greetCd -= dt; if (n.sayCd > 0) n.sayCd -= dt;
  W.go = false;
  if (n.goto) moveGoto(n, dt); else behave(n, dt);
  if (n.behavior === 'sit' && !n.goto) {
    // a sitter placed next to a bench sits on it: snap to the nearest free slot, facing the way the bench faces
    if (!n.seatTry && n.idleState === 'sit') { n.seatTry = true; const st = claimSeat(n.x, n.y, n); if (st) { n.x = st.x; n.y = st.y; n.z = st.z; n.heading = st.heading; n.faceT = null; } }
    n.state = n.idleState; n.speed = 0; n.vx = n.vy = 0; return;
  }
  locomote(n, dt, cheap);
  if (n.kickT > 0 || n.cel > 0) n.state = n.idleState; // kick, throw-in, celebration: the pose holds even while still sliding to a stop
  if (!n.lookOn && !cheap) glance(n);
}
// where the head turns (realpool.js reads lookOn / lookX / lookY / lookZ): someone close by with the player in front of them
// notices the player; people stopped for a word look at each other. The body keeps its heading, only the head and neck follow.
function lookAtPlayer(n) { n.lookOn = true; n.lookX = P.x; n.lookY = P.y; n.lookZ = (P.z || 0) + 1.55; }
function glance(n) {
  if (P && n.state !== 'run') { const dx = P.x - n.x, dy = P.y - n.y, d2 = dx * dx + dy * dy; if (d2 < 49 && dx * Math.cos(n.heading) + dy * Math.sin(n.heading) > -0.3 * Math.sqrt(d2)) { lookAtPlayer(n); return; } }
  const o = n.partner || n.mate; if (o && !o.dead && Math.hypot(o.x - n.x, o.y - n.y) < 3) { n.lookOn = true; n.lookX = o.x; n.lookY = o.y; n.lookZ = o.z + 1.5 * o.recipe.s; }
}

// ---------- speech and talking ----------
function say(n, text, ms = 3200) { bubble('npc:' + n.id, n._hfn, text, ms); }
function pickLines(n) {
  const d = n.def, own = d.lines && d.lines.length ? d.lines : null, out = [];
  if (own) { out.push(pickOf(own)); if (own.length > 1 && chance(0.4)) { let b = pickOf(own); if (b === out[0]) b = own[(own.indexOf(b) + 1) % own.length]; out.push(b); } return out; }
  const rl = ROLE_LINES[n.role]; out.push(rl && chance(0.45) ? pickOf(rl) : pickOf(LINES));
  if (chance(0.4)) { let b = pickOf(LINES); if (b === out[0]) b = pickOf(LINES); if (b !== out[0]) out.push(b); }
  return out;
}
async function talkTo(n) {
  if (n.talking || n.dead) return;
  n.talking = true; n.state = 'talk'; n.speed = 0; n.vx = n.vy = 0; n.flinchT = 0;
  try {
    emit('npc:talk', { id: n.id, name: n.name }); state.stats.talks = (state.stats.talks || 0) + 1;
    if (n.def.onTalk) await n.def.onTalk(n);
    else for (const text of pickLines(n)) { const r = await showDialogue({ speaker: n.name, role: n.title || ROLE_LABEL[n.role] || 'Local', text }); if (r === null) break; } // null: closed by the HUD, treat as "Bye"
  } catch (e) { console.error('[npc] talk failed', e); }
  finally { n.talking = false; n.faceT = null; }
}

// ---------- reactions to the player ----------
function reactions(dt) {
  if (bubT > 0) bubT -= dt; if (greetT > 0) greetT -= dt;
  const fast = (P.speed || 0) > 4.2 || !!P.riding;
  if (fast) {
    const c = collect(P.x, P.y, 1.3);
    for (let i = 0; i < c; i++) {
      const n = QOUT[i]; if (n.talking || n.flinchT > 0 || n.bumpCd > 0 || n.dead) continue; const dx = n.x - P.x, dy = n.y - P.y, d = Math.hypot(dx, dy); if (d > 1.2) continue;
      // step aside, across the player's path
      let vx = P.vx || Math.cos(P.heading || 0), vy = P.vy || Math.sin(P.heading || 0); const vl = Math.hypot(vx, vy) || 1; vx /= vl; vy /= vl;
      let sx = -vy, sy = vx; if (sx * dx + sy * dy < 0) { sx = -sx; sy = -sy; }
      const mv = n.behavior === 'sit' ? 0 : 2.0; n.flinchT = 0.55; n.slideX = sx * mv; n.slideY = sy * mv; n.bumpCd = 4; n.path = n.goto ? n.path : null; n.pathReq = false;
      if (n.behavior === 'wander' && !n.goto) n.wait = rnd(0.3, 1);
      if (bubT <= 0) { say(n, pickOf(FLINCH), 2200); bubT = 1.4; }
      emit('npc:bumped', { id: n.id });
    }
  }
  if (greetT <= 0 && !fast) {
    const c = collect(P.x, P.y, 4.5);
    for (let i = 0; i < c; i++) { const n = QOUT[i]; if (n.talking || n.greetCd > 0 || n.dead || n.flinchT > 0) continue; if (chance(0.3)) { say(n, pickOf(GREET), 2400); n.greetCd = 90; greetT = rnd(12, 26); break; } }
    if (greetT <= 0) greetT = 2;
  }
}

// ---------- public API ----------
function initNPCs() {
  if (ready) return;
  let nav = null; try { nav = buildNav(); } catch (e) { console.error('[npc] walk graph failed', e); }
  try { initCrowd(); } catch (e) { console.error('[npc] crowd failed', e); }
  try { initRealPool(); } catch (e) { console.error('[npc] real models failed', e); }
  try { initPlaces(); buildSpots(); } catch (e) { console.error('[npc] places failed', e); }
  ready = true;
  if (nav) console.info('[npc] walk graph', nav.nodes, 'nodes,', nav.alive, 'connected');
}
// first frame with a player: fill the ambient population around them
function fillInitial() {
  hour = state.time; for (let k = 0, tries = 0; AMB.length < TARGET && tries < TARGET * 3; k++, tries++) spawnAmbient(true);
}
let filled = false;
function updateNPCs(dt, player) {
  if (!ready || !player) return;
  P = player; hour = state.time;
  const dd = camera.getWorldDirection(_v3); camAng = Math.atan2(-dd.z, dd.x);
  if (!filled) { filled = true; fillInitial(); }
  rebuildHash();
  // ambient upkeep: top up (at most two per frame), recycle people left far behind
  if (AMB.length < TARGET) for (let k = 0; k < 2 && AMB.length < TARGET; k++) { if (!spawnAmbient(false)) break; }
  let rc = 0; for (let i = 0; i < AMB.length && rc < 2; i++) { const n = AMB[i], dx = n.x - P.x, dy = n.y - P.y; if (dx * dx + dy * dy > RECYCLE_R * RECYCLE_R) { recycle(n); rc++; } }
  if ((spotT -= dt) <= 0) { spotT = 0.5; manageSpots(); }
  processPaths();
  footballBrain(dt);
  for (let i = 0; i < ALL.length; i++) {
    const n = ALL[i]; n.animDt += dt; const dx = n.x - P.x, dy = n.y - P.y, far = dx * dx + dy * dy > NEAR * NEAR;
    if (far) { n.acc += dt; if (n.acc < FAR_DT) continue; stepNPC(n, n.acc, true); n.acc = 0; } else { stepNPC(n, n.acc + dt, false); n.acc = 0; }
  }
  reactions(dt);
  updateRealPool(ALL, ALL.length, dt); // nearest people become rigged models (n.real), the crowd draws the rest
  drawCrowd(ALL, ALL.length);
}
const _v3 = new THREE.Vector3();
function spawnNPC(def) {
  const old = BYID.get(def.id); if (old) dropFromWorld(old);
  const rand = seeded(def.seed !== undefined ? def.seed : hashStr(String(def.id))), hint = roleHint(def);
  const A = def.appearance, app = { ...randomAppearance(rand, { role: hint, female: def.female, kid: A && A.kid }), ...(A || {}) };
  if (A) for (const k of ['wrap', 'bag', 'umbrella', 'hat', 'stick', 'phone', 'hatColor', 'bagStyle', 'sleeves']) if (!(k in A)) app[k] = null; // a hand-written look has no random extras
  if (A && !('gamosa' in A)) app.gamosa = false;
  // the rigged bodies come in two kinds, so named people need a definite one: explicit, else read from the hand-written look
  if (A) app.female = def.female !== undefined ? !!def.female : A.female !== undefined ? !!A.female : /mekhela|sari|skirt/.test(A.bottomStyle || '') || A.topStyle === 'blouse' || A.hairStyle === 'long' || A.hairStyle === 'bun';
  let heading = def.heading; if (heading === undefined && Array.isArray(def.face)) heading = Math.atan2(def.face[1] - def.y, def.face[0] - def.x);
  const n = makeNPC(def.id, def.name || 'Local', def.role || hint, def.x, def.y, heading || 0, app, def, 'named');
  n.behavior = def.behavior || 'idle'; n.idleState = n.behavior === 'sit' ? (def.floor ? 'floor' : 'sit') : 'idle'; n.anchor = def.anchor || null; n.vWalk = rnd(1.0, 1.25);
  if (n.behavior === 'play') { n.anchor = n.anchor || { x: def.x, y: def.y, r: 8 }; n.vRun = rnd(2.8, 3.6); }
  if (n.behavior === 'vendor') n.t1 = rnd(0, 4);
  if (def.path) n.pi = 0;
  addToWorld(n); if (ready) rebuildHash(); return n;
}
const getNPC = id => BYID.get(id);
const allNPCs = () => ALL;
function npcBlocking(x, y, r = 0.45, ignoreId) {
  const c = collect(x, y, r + 0.3), rr = r + 0.25;
  for (let i = 0; i < c; i++) { const n = QOUT[i]; if (n.dead || n.id === ignoreId) continue; const dx = n.x - x, dy = n.y - y; if (dx * dx + dy * dy < rr * rr) return n; }
  return null;
}
function npcSay(id, text, ms) { const n = BYID.get(id); if (n) say(n, text, ms || 3200); }
function npcSetBehavior(id, behavior, opts = {}) {
  const n = BYID.get(id); if (!n) return;
  releaseSeat(n); n.seatTry = false; n.behavior = behavior; n.goto = null; n.path = null; n.pi = 0; n.wait = 0; n.hasW = false; n.tget = opts.target || null; n.faceT = opts.face || null;
  if (opts.anchor) n.anchor = opts.anchor; if (opts.dist) n.dist = opts.dist; if (opts.path) n.def = { ...n.def, path: opts.path };
  n.idleState = behavior === 'sit' ? (opts.floor ? 'floor' : 'sit') : 'idle';
  if (behavior === 'play' && !n.anchor) n.anchor = { x: n.x, y: n.y, r: 8 };
}
function npcMoveTo(id, x, y, opts = {}) {
  const n = BYID.get(id); if (!n) return;
  n.goto = { x, y, run: !!opts.run, onArrive: opts.onArrive, path: null }; n.path = null; n.pi = 0; n.faceT = null; if (n.behavior === 'sit') { n.idleState = 'idle'; releaseSeat(n); n.seatTry = false; }
  queuePath(n);
}
function npcFace(id, x, y) { const n = BYID.get(id); if (!n) return; n.heading = Math.atan2(y - n.y, x - n.x); n.faceT = [x, y]; }
function removeNPC(id) { const n = BYID.get(id); if (n) dropFromWorld(n); }

export { initNPCs, updateNPCs, spawnNPC, getNPC, allNPCs, npcBlocking, npcSay, npcSetBehavior, npcMoveTo, npcFace, removeNPC };
