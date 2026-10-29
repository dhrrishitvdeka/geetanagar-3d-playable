import { GEO, hash2 } from '../../core/geo.js';
import { findOpen, walkable } from '../../ui/controls.js';
import { GATE_POSTS } from '../../world/compound.js';
import { MAINP, asphHalf, nearestOnMain } from '../../world/mainroad.js';
import { beside } from '../../world/streetlife.js';
import { Aborted, BY_ID, say } from '../content/npcs.js';
import { on } from '../core/bus.js';
import { state } from '../core/state.js';
import { greetLine, noteTalk } from '../friends.js';
import { getNPC, npcMoveTo, npcSay, npcSetBehavior, removeNPC, spawnNPC } from './agents.js';
import { nearestNode, nodeXY, randomPoint } from './nav.js';

// ================= daily life: the regulars who live here, and the named people's day =================
// The regulars each have a home behind an open gate on a real lane and a day plan: commuters walk to the bus stand and catch a city
// bus, come back on one in the evening and walk home; students go to school and come out for the afternoon; homemakers do the
// morning shopping and take an evening cup of sah; the old people walk round the field at dawn and sit at the namghar in the
// evening. A plan is a list of legs: at hour `at`, walk from wherever the last leg ended to `to`, then stay there doing something,
// or go out of sight (into the house, the school, onto a bus). The clock runs 30x real time and people walk ~1.2 m/s, so a walk
// of 150 m takes about an hour of the day: departures are worked back from when each person wants to arrive.
// Nobody is simulated off-screen. Where a regular is at any moment follows from the plan and the clock (virtualAt), so when the
// player comes within reach they are put there (walking the right way, or doing their thing) and handed to agents.js until the
// player leaves again.
const REACH = 170, DROP = 230, EVERY = 0.4;
const hrs = (d, v) => d * 1.35 / v / 120; // walking time in game hours: 1 game hour = 120 real seconds, paths ~35% longer than straight
const rr = (id, k) => hash2(id.length * 13.1 + id.charCodeAt(0) * 0.7 + k * 3.3, id.charCodeAt(id.length - 1) * 1.9 - k); // per person, per thing
const D = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const isActive = id => { const q = state.quests[id]; return !!q && q.status === 'active'; };
const isDone = id => { const q = state.quests[id]; return !!q && q.status === 'done'; };

// ---------- who ----------
// plan: commute | school | kid | market | elder. near: the place their day turns around (homes are picked 40-130 m from it).
const PEOPLE = [
  { id: 'r_pranab', name: 'Pranab', female: false, role: 'office', title: 'bank clerk', plan: 'commute', work: 'the bank in Paltan Bazar' },
  { id: 'r_nilima', name: 'Nilima', female: true, role: 'office', title: 'nurse', plan: 'commute', work: 'the hospital in Bhangagarh' },
  { id: 'r_gautam', name: 'Gautam', female: false, role: 'office', title: 'clerk', plan: 'commute', work: 'the secretariat at Dispur' },
  { id: 'r_ritu', name: 'Ritu', female: true, role: 'office', title: 'teacher', plan: 'commute', work: 'a school in Maligaon' },
  { id: 'r_arup', name: 'Arup', female: false, role: 'commuter', title: 'shop assistant', plan: 'commute', work: 'a cloth shop in Fancy Bazar' },
  { id: 'r_mitu', name: 'Mitu', female: true, role: 'student', title: 'college student', plan: 'school', school: 2 },
  { id: 'r_pinky', name: 'Pinky', female: true, role: 'student', title: 'student', plan: 'school', school: 0 },
  { id: 'r_bubu', name: 'Bubu', female: false, role: 'student', title: 'student', plan: 'school', school: 0 },
  { id: 'r_babul', name: 'Babul', female: false, role: 'kid', title: 'schoolboy', plan: 'kid', school: 1 },
  { id: 'r_bornali', name: 'Bornali', female: true, role: 'mekhela', title: 'neighbour', plan: 'market' },
  { id: 'r_jyoti', name: 'Jyoti', female: true, role: 'sari', title: 'neighbour', plan: 'market' },
  { id: 'r_kamal', name: 'Kamal', female: false, role: 'shopper', title: 'neighbour', plan: 'market' },
  { id: 'r_hemen', name: 'Hemen Khura', female: false, role: 'elder', title: 'retired', plan: 'elder' },
  { id: 'r_rajen', name: 'Rajen Khura', female: false, role: 'elder', title: 'retired postmaster', plan: 'elder' },
  { id: 'r_dolly', name: 'Dolly Pehi', female: true, role: 'elder', title: 'retired', plan: 'elder' },
];
const SPEED = { elder: 0.85, kid: 1.05 };

// ---------- where ----------
const P = {}; // places, worked out once the world and the named people exist
const snapNode = (x, y) => { const k = nearestNode(x, y), o = [x, y]; if (k >= 0) nodeXY(k, o); return { x: o[0], y: o[1] }; };
const open = (x, y) => { const [ox, oy] = findOpen(x, y); return { x: ox, y: oy }; };
function customer(id, gap = 1.4) { // where a customer stands at a named seller's counter, facing them
  const d = BY_ID[id], n = getNPC(id) || d; if (!d) return null;
  const f = d.face || [n.x, n.y + 1], l = Math.hypot(f[0] - n.x, f[1] - n.y) || 1, c = open(n.x + (f[0] - n.x) / l * gap, n.y + (f[1] - n.y) / l * gap);
  return { ...c, face: [n.x, n.y], who: id };
}
const lm = t => { const l = GEO.labels.find(l => l.t === t); return l ? [l.x, l.y] : null; };
function places() {
  const [, bi] = nearestOnMain(-57, -74), bs = beside(-57, -1, asphHalf(bi) + 2.3), road = MAINP[bi], nx = road[0] - bs[0], ny = road[1] - bs[1], nl = Math.hypot(nx, ny) || 1;
  P.bus = { x: bs[0], y: bs[1], face: [road[0], road[1]], n: [nx / nl, ny / nl], along: [-ny / nl, nx / nl] }; // n: toward the road
  P.schools = ['Geetanagar High School', 'Geetanagar LP School', 'Kanya Mahavidyalaya'].map((t, k) => { const p = lm(t) || [[-45, 24], [-68, 16], [-79, 84]][k]; return snapNode(p[0], p[1]); });
  P.shops = ['mamoni', 'hari', 'rupa', 'khagen'].map(id => customer(id)).filter(Boolean);
  P.teas = [customer('bina', 1.6), customer('khagen')].filter(Boolean); // an evening cup: Bina Baideu's stall or Khagen Da's kiosk, whichever is nearer home
  const ng = lm('Sarbojonin Namghar') || [-100, 115]; P.namghar = open(ng[0], ng[1] - 6); P.namghar.face = ng;
  const sc = lm('Geetanagar High School') || [-45, 24], fm = FIELD_MID(), between = k => open(sc[0] + (fm[0] - sc[0]) * k, sc[1] + (fm[1] - sc[1]) * k);
  const pb = between(0.45), hb = between(0.3); P.photo = snapNode(pb.x, pb.y); P.hang = snapNode(hb.x, hb.y); // the field's school side: Anjali's photographs, and where the school crowd
  // hangs about after class (on the walk graph: findPath only goes the last stretch to a goal within 25 m of a node)
}
const FIELD_MID = () => [(GEO.field[0] + GEO.field[2]) / 2, (GEO.field[1] + GEO.field[3]) / 2];
function laneName(x, y) { // the lane a gate opens onto, for "I live on ...": the map's lane labels, or "a lane off" the nearest one
  let best = null, bd = 160;
  for (const l of GEO.labels) { if (!/\b(Ln|Lane|Byelane|Path|Rd|Road)\b/.test(l.t)) continue; const d = Math.hypot(l.x - x, l.y - y); if (d < bd) { bd = d; best = l.t; } }
  return best && bd > 35 ? 'a lane off ' + best : best;
}
// a home for each regular: an open gate whose yard can be walked into, 40-130 m from the place their day turns around
function pickHomes() {
  const used = new Set(), cand = GATE_POSTS.filter(g => g.open).map(g => ({ g, yard: { x: g.x - g.nx * 1.8, y: g.y - g.ny * 1.8 }, door: { x: g.x + g.nx * 1.1, y: g.y + g.ny * 1.1 } })).filter(c => walkable(c.yard.x, c.yard.y) && walkable(c.door.x, c.door.y));
  for (const r of PEOPLE) {
    const hub = r.plan === 'commute' ? P.bus : r.plan === 'school' || r.plan === 'kid' ? P.schools[r.school] : r.plan === 'market' ? P.shops[0] || P.bus : P.namghar, far = r.plan === 'elder' ? 90 : 130;
    const ok = cand.filter(c => !used.has(c) && D(c.door, hub) > 30 && D(c.door, hub) < far).sort((a, b) => D(a.door, hub) - D(b.door, hub));
    const c = ok[Math.floor(rr(r.id, 1) * ok.length)]; if (!c) continue;
    used.add(c); r.home = c; r.lane = c.g.lane ? laneName(c.g.x, c.g.y) : 'Mother Teresa Rd';
  }
}

// ---------- the day plan ----------
// leg: { at, to, mode: 'stay' | 'gone' | 'board' | 'bus' (comes off a bus at the stand, then walks on), beh, face, floor, anchor, what }
function plan(r) {
  const v = r.v, H = r.home.yard, s = k => rr(r.id, 10 + k + state.day * 7), legs = [], from = [H], done = [0]; // from: where the last leg ended, done: when
  const go = (arrive, to, mode, o = {}) => { const T = hrs(D(from[0], to), v), at = Math.max(arrive - T, done[0]); legs.push({ at, to, mode, ...o }); from[0] = to; done[0] = at + T; }; // never leave before getting there
  if (r.plan === 'commute') {
    const k = PEOPLE.filter(q => q.plan === 'commute').indexOf(r), u = P.bus.along, spot = open(P.bus.x + u[0] * (k - 2) * 1.4 - P.bus.n[0] * (k % 2) * 0.6, P.bus.y + u[1] * (k - 2) * 1.4 - P.bus.n[1] * (k % 2) * 0.6); // each their own bit of kerb
    const arrive = 8.3 + s(1) * 0.6; go(arrive, spot, 'stay', { beh: 'idle', face: P.bus.face, what: 'bus' });
    legs.push({ at: done[0] + 0.15, to: spot, mode: 'board', what: 'bus' });
    const back = 16.0 + s(2) * 0.7; legs.push({ at: back, to: H, mode: 'gone', fromBus: true, what: 'home' }); from[0] = H; done[0] = back + hrs(D(P.bus, H), v);
  } else if (r.plan === 'school' || r.plan === 'kid') {
    const sc = P.schools[r.school]; go(7.8 + s(1) * 0.2, sc, 'gone', { what: 'school' });
    const out = Math.max(13.6 + s(2) * 0.4, done[0]); legs.push({ at: out, to: H, mode: 'gone', what: 'home' }); from[0] = H; done[0] = out + hrs(D(sc, H), v);
    const hang = r.school === 0 || r.plan === 'kid' ? P.hang : sc; // the field side by the high school, or their own college gate
    go(15.3 + s(3) * 0.5, hang, 'stay', { beh: r.plan === 'kid' ? 'play' : 'pace', anchor: { x: hang.x, y: hang.y, r: r.plan === 'kid' ? 7 : 3 }, what: 'hangout' });
    go(17.6, H, 'gone', { what: 'home' });
  } else if (r.plan === 'market') {
    const shop = P.shops.slice().sort((a, b) => D(a, H) - D(b, H))[Math.floor(s(1) * 2)] || P.shops[0];
    go(9.2 + s(2) * 0.8, shop, 'stay', { beh: 'idle', face: shop.face, what: 'shop', who: shop.who });
    go(9.2 + s(2) * 0.8 + 0.35 + hrs(D(shop, H), v), H, 'gone', { what: 'home' });
    const tea = P.teas.slice().sort((a, b) => D(a, H) - D(b, H))[0];
    go(15.9 + s(3) * 0.4, tea, 'stay', { beh: 'idle', face: tea.face, what: 'tea' });
    go(17.1 + s(4) * 0.3 + hrs(D(tea, H), v), H, 'gone', { what: 'home' });
  } else { // elder
    const w1 = randomPoint(H, 35, 60), w2 = w1 && randomPoint(w1, 30, 55); // a slow round of their own lanes in the cool of the morning
    if (w1 && w2) { go(6.9 + s(2) * 0.3, { x: w1.x, y: w1.y }, 'stay', { beh: 'idle', what: 'walk', pass: true }); go(0, { x: w2.x, y: w2.y }, 'stay', { beh: 'idle', what: 'walk', pass: true }); }
    go(8.6 + s(3) * 0.4, H, 'gone', { what: 'home' });
    const k = PEOPLE.filter(q => q.plan === 'elder').indexOf(r), mat = open(P.namghar.x + (k - 1) * 0.95, P.namghar.y); // side by side on the mat
    go(16.1 + s(4) * 0.4, mat, 'stay', { beh: 'sit', floor: true, face: P.namghar.face, what: 'namghar' });
  }
  return legs;
}
// where a regular is at hour t, from the plan alone: { mode: 'home' | 'walk' | 'stay' | 'gone', leg, x, y, from }
function virtualAt(r, t) {
  let k = -1; for (let i = 0; i < r.legs.length; i++) if (r.legs[i].at <= t) k = i;
  if (k < 0) return { mode: 'home', leg: -1 };
  const L = r.legs[k], o = L.fromBus ? P.bus : k ? r.legs[k - 1].to : r.home.yard;
  if (L.mode === 'board') return t < L.at + 0.25 ? { mode: 'stay', leg: k - 1, x: L.to.x, y: L.to.y } : { mode: 'gone', leg: k };
  const T = hrs(D(o, L.to), r.v), f = T > 0 ? (t - L.at) / T : 1;
  if (f < 1) return { mode: 'walk', leg: k, x: o.x + (L.to.x - o.x) * f, y: o.y + (L.to.y - o.y) * f };
  return L.mode === 'stay' ? { mode: 'stay', leg: k, x: L.to.x, y: L.to.y } : { mode: 'gone', leg: k };
}

// ---------- in the world ----------
let ready = false, acc = 0, lastT = 0, PL = null;
function spawn(r, x, y) {
  const n = spawnNPC({ id: r.id, name: r.name, role: r.role, title: r.title, x, y, heading: r.home.g ? Math.atan2(r.home.g.ny, r.home.g.nx) : 0, female: r.female, kind: 'resident', behavior: 'idle',
    appearance: r.role === 'kid' ? { kid: true, height: 0.78, female: r.female } : undefined, onTalk: npc => talkResident(r, npc) });
  n.vWalk = r.v; r.n = n; r.leg = null; r.hideAt = 0; return n;
}
function drop(r) { if (r.n) removeNPC(r.id); r.n = null; r.leg = null; r.waitBus = 0; }
// start leg k for a regular who is in the world: walk to it, then do what it says on arrival
function startLeg(r, k) {
  r.leg = k; const L = r.legs[k], n = r.n; if (!n) return;
  if (L.mode === 'board') return; // waits at the stand for a bus (bus:stopped)
  const arrive = () => {
    if (r.leg !== k || !r.n) return;
    if (L.mode === 'gone') { r.hideAt = state.time + 0.12; return; } // out of sight once the player isn't right there (see tick)
    if (L.pass) return; // passing through on a walk: the next leg takes them on
    npcSetBehavior(r.id, L.beh, { face: L.face, anchor: L.anchor, floor: L.floor });
  };
  npcMoveTo(r.id, L.to.x, L.to.y, { onArrive: arrive });
}
function tick(t) {
  for (const r of PEOPLE) {
    if (!r.legs) continue;
    const n = r.n && getNPC(r.id) === r.n ? r.n : (r.n = null), near = PL && (n ? Math.hypot(n.x - PL.x, n.y - PL.y) : 0);
    if (n) {
      if (near > DROP) { drop(r); continue; }
      if (n.talking) continue;
      // gone: out of sight as soon as nobody is right there watching them step in
      if (r.hideAt && (Math.hypot(n.x - PL.x, n.y - PL.y) > 12 || t > r.hideAt)) { drop(r); continue; }
      let k = -1; for (let i = 0; i < r.legs.length; i++) if (r.legs[i].at <= t) k = i;
      if (k > (r.leg ?? -1) && !(r.legs[k].fromBus && r.waitBus)) { r.hideAt = 0; startLeg(r, k); }
      const L = r.legs[r.leg]; if (L && L.mode === 'board' && t > L.at + 0.6 && near > 30) drop(r); // no bus came: they caught one out of sight
      continue;
    }
    // not in the world: put them there if the player is near where the plan says they are
    const V = virtualAt(r, t), L = r.legs[V.leg];
    if (L && L.fromBus && V.mode === 'walk' && r.waitBus !== -1 && t - L.at < 0.7 && PL && D(PL, P.bus) < 120) { // the player is at the stand: they come off the next bus
      r.waitBus = r.waitBus || L.at + 0.4; if (t < r.waitBus) continue;
      const [sx, sy] = findOpen(P.bus.x, P.bus.y); spawn(r, sx, sy); r.waitBus = -1; startLeg(r, V.leg); continue; // none came: off one you didn't see, and on their way
    }
    if (V.mode === 'gone' || V.mode === 'home' || !PL || Math.hypot(V.x - PL.x, V.y - PL.y) > REACH) continue;
    const [x, y] = V.mode === 'walk' ? (() => { const s = snapNode(V.x, V.y); return [s.x, s.y]; })() : [V.x, V.y];
    spawn(r, x, y); r.waitBus = 0;
    if (V.mode === 'walk') startLeg(r, V.leg);
    else { r.leg = V.leg; const S = r.legs[V.leg]; if (S && S.mode === 'stay' && !S.pass) npcSetBehavior(r.id, S.beh, { face: S.face, anchor: S.anchor, floor: S.floor }); }
  }
}
// a bus at the stand: whoever is waiting gets on, and anyone due home in the evening gets off
const ROUTES = ['Paltan Bazar! Maligaon! Uthok, uthok!', 'Jalukbari, Jalukbari! Get in, get in!', 'Beltola, Ganeshguri! Ek-dom fast!'];
on('bus:stopped', ({ x, y }) => {
  if (!ready) return; const t = state.time;
  const bh = getNPC('bhaiti'); if (bh && !bh.talking && Math.hypot(bh.x - x, bh.y - y) < 40) npcSay('bhaiti', ROUTES[Math.floor(Math.random() * ROUTES.length)], 3000); // the conductor cries the routes
  for (const r of PEOPLE) {
    if (!r.legs) continue; const n = r.n;
    if (n && !n.talking && Math.hypot(n.x - x, n.y - y) < 25) {
      const k = r.legs.findIndex(L => L.mode === 'board'); if (k < 0 || r.leg !== k || t < r.legs[k].at) continue;
      r.leg = k; npcMoveTo(r.id, x + (n.x - x) * 0.25, y + (n.y - y) * 0.25, { onArrive: () => drop(r) }); // up the steps
    } else if (!n && r.waitBus && t < r.waitBus) {
      const k = r.legs.findIndex(L => L.fromBus); r.waitBus = 0;
      const [sx, sy] = findOpen(P.bus.x + (x - P.bus.x) * 0.3, P.bus.y + (y - P.bus.y) * 0.3); spawn(r, sx, sy); startLeg(r, k);
    }
  }
});

// ---------- what they say ----------
const SAYS = {
  bus: ['The city bus comes when it comes. I just wait.', 'If I miss this one I am late again, and the boss remembers everything.'],
  home: ['Home at last. Ma will have the tea ready.', 'A long day. Nothing a cup of sah cannot fix.'],
  school: ['Late, late, late! The bell has gone already, I know it.', 'Exams next month. Do not remind me.'],
  hangout: ['School is over. Finally the day starts.', 'We meet here every afternoon. Nobody plans it, it just happens.'],
  shop: ['Just a few things for the kitchen. Everything is so dear today.', 'Fish for tonight, if the price is right.'],
  tea: ['The evening sah at Bina Baideu\'s. That is my one luxury.', 'Half the lane comes here at this hour. You hear all the news.'],
  walk: ['Two rounds of the field every morning. That is the whole secret.', 'At my age you walk early, before the sun gets serious.'],
  namghar: ['The naam starts soon. Sit with us, if you like.', 'Every evening I come here. The singing settles the mind.'],
};
async function talkResident(r, npc) {
  try {
    await say(npc, greetLine(npc) || 'Nomoskar!'); // hello first, by how well they know you
    await noteTalk(npc);
    const L = r.legs && r.legs[r.leg ?? -1], what = (L && L.what) || 'home';
    const lines = [SAYS[what][Math.floor(rr(r.id, state.day) * SAYS[what].length)]];
    if (r.plan === 'commute' && what === 'bus') lines.push(`I work at ${r.work}. Every day, there and back on the city bus.`);
    if (r.lane && rr(r.id, 77) < 0.6) lines.push(`I live just there, on ${r.lane}. The gate with the ${r.home.g.lane ? 'open' : 'steel'} leaves.`);
    for (const t of lines) await say(npc, t);
  } catch (err) { if (!(err instanceof Aborted)) console.error('[routines] talk', err); }
}

// ---------- the named people's day ----------
// [from hour, where, how they spend it, when (optional)]. 'home' is their usual spot. Quests read live positions, so markers follow.
const DAY = {
  dadu: [
    { at: 6.6, to: () => P.teas[0], beh: 'idle', face: () => P.teas[0].face, when: () => isDone('morning_sah'), say: 'Ek gilas lal sah, Bina. The usual.' }, // his own morning tea, once you have shown him the way
    { at: 9.6, to: 'home' },
    { at: 14.5, to: () => open(P.namghar.x + 2.2, P.namghar.y), beh: 'sit', floor: true, face: () => P.namghar.face, when: () => !isActive('rongali_bihu'), say: 'Time for the evening naam at the namghar.' },
  ],
  anjali: [{ at: 13.9, to: () => P.photo, beh: 'pace', anchor: () => ({ x: P.photo.x, y: P.photo.y, r: 4 }), say: 'Classes are done. Now the good light starts.' }],
};
const named = {}; // id -> { cur: entry | 'home' }
function namedTick(t, dayStart) {
  for (const id in DAY) {
    const n = getNPC(id), d = BY_ID[id]; if (!n || !d || n.talking) continue;
    let cur = 'home'; for (const e of DAY[id]) if (t >= e.at && (!e.when || e.when())) cur = e.to === 'home' ? 'home' : e;
    const st = named[id] || (named[id] = { cur: 'home' }); if (st.cur === cur && !dayStart) continue; st.cur = cur;
    const to = cur === 'home' ? { x: d.anchor ? d.anchor.x : d.x, y: d.anchor ? d.anchor.y : d.y } : cur.to();
    const settle = () => cur === 'home' ? npcSetBehavior(id, d.behavior || 'idle', { anchor: d.anchor, face: d.face }) : npcSetBehavior(id, cur.beh, { face: cur.face && cur.face(), anchor: cur.anchor && cur.anchor(), floor: cur.floor });
    const far = !PL || (Math.hypot(n.x - PL.x, n.y - PL.y) > 90 && Math.hypot(to.x - PL.x, to.y - PL.y) > 90);
    if (dayStart || (far && Math.hypot(to.x - n.x, to.y - n.y) > 0.5 && t - (cur === 'home' ? 0 : cur.at) > 1)) { n.x = to.x; n.y = to.y; settle(); continue; } // a new day, or long since gone and nobody watching
    if (cur !== 'home' && cur.say && PL && Math.hypot(n.x - PL.x, n.y - PL.y) < 15) npcSay(id, cur.say, 3000);
    npcMoveTo(id, to.x, to.y, { onArrive: settle });
  }
}

// ---------- api ----------
function initRoutines() {
  if (ready) return;
  try { places(); pickHomes(); } catch (err) { console.error('[routines] places failed', err); return; }
  for (const r of PEOPLE) { r.v = SPEED[r.role] || 1.15 + rr(r.id, 3) * 0.12; if (r.home) r.legs = plan(r); }
  const dadu = getNPC('dadu'); if (dadu) dadu.vWalk = 0.9; // an old man's pace
  ready = true; lastT = state.time;
  console.info(`[routines] ${PEOPLE.filter(r => r.legs).length} regulars with homes, ${Object.keys(DAY).length} named people on a schedule`);
}
function updateRoutines(dt, player) {
  if (!ready || !player) return; PL = player;
  const t = state.time, dayStart = t < lastT - 1; // the clock went back: a new morning
  if (dayStart) for (const r of PEOPLE) { drop(r); if (r.home) r.legs = plan(r); }
  lastT = t;
  if ((acc += dt) < EVERY && !dayStart) return; acc = 0;
  try { tick(t); namedTick(t, dayStart); } catch (err) { console.error('[routines] tick failed', err); }
}
const regulars = () => PEOPLE;

export { initRoutines, updateRoutines, regulars };
