import { GEO, MANDIR, pointInPoly } from '../core/geo.js';
import { DECK } from '../world/deck.js';
import { GATE } from '../world/park.js';
import { fieldGateX } from '../world/road/fieldedge.js';
import { findOpen, walkable } from '../ui/controls.js';
import { emit, on } from './core/bus.js';
import { addItem, addMoney, discover, hasItem, removeItem, setFlag, state } from './core/state.js';
import { getNPC, npcSay, npcSetBehavior } from './npc/agents.js';
import { bigMessage, setObjectiveTarget, setQuestTracker, toast } from './hud.js';
import { addMarker, removeMarker } from './map.js';
import { clearWorldMarker, getBall, getDelivery, setBallPosition, setScooterUnlocked, setWorldMarker, startDelivery } from './worldobjects.js';
import { SHOPS } from './items.js';
import { allAnimals, setDogFollow } from './animals.js';
import { sfx } from './audio.js';
import { addBuff } from './player.js';
import { PLACES, PLACE_BY_ID } from './content/places.js';
import { Aborted, BY_ID, FIELD_ANCHOR, FIELD_C, NAMED, TALK, ask, chat, say, sayAll, shopTalk, spawnNamedNPCs } from './content/npcs.js';

// ---------- quest engine ----------
// state.quests[id] = { status: 'active' | 'done', step, data }. A quest is a list of steps; a step may have
//   text (string or fn of the quest), t (target filler for the tracker, map and compass), done (auto-advance test),
//   back (step-back test, e.g. you ate the tea you were supposed to deliver), quiet (no toast when it auto-advances).
// Event hooks (`on`) mutate q.data; the 0.3 s poll (or a dirty flag) runs the done/back tests. Talk handlers advance
// steps directly. Nothing here allocates per frame: the poll, marker sweep and tracker run at a few Hz.
const QUESTS = {}, ORDER = [];
const GOLD = '#f2c14e';
const def = d => { d.mk = 'quest:' + d.id; d.gk = 'give:' + d.id; d.available = d.available || (() => true); QUESTS[d.id] = d; ORDER.push(d.id); };
const qs = id => state.quests[id];
const isActive = id => { const q = state.quests[id]; return !!q && q.status === 'active'; };
const isDone = id => { const q = state.quests[id]; return !!q && q.status === 'done'; };
const stepOf = (d, q) => d.steps[Math.min(q.step, d.steps.length - 1)];
const txt = (s, q) => (typeof s.text === 'function' ? s.text(q) : s.text);
const fmtTime = s => { s = Math.max(0, Math.ceil(s)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
const NAMES = { lal_sah: 'lal sah', marigold: 'marigolds', biscuits: 'biscuits', cash_bag: 'cash bag' };

let live = false, dirty = false, trackerDirty = false, uSeq = 0, pl = { x: FIELD_C[0], y: -30 };
let tickAcc = 0, uiAcc = 0, secAcc = 0, pIdx = 0, found = new Uint8Array(PLACES.length);

// targets: fill the shared scratch {x, y, label}; return false when the step has no place to point at
const tNpc = (id, label) => (q, o) => { const n = getNPC(id) || BY_ID[id]; o.x = n.x; o.y = n.y; o.label = label || BY_ID[id].name; return true; };
const tPt = (x, y, label) => (q, o) => { o.x = x; o.y = y; o.label = label; return true; };
const tField = tPt(FIELD_C[0], FIELD_C[1], 'Geetanagar Field');
// outside the field the compass points at its road gate (the only way in from Mother Teresa Rd), inside at the centre
const tFieldWay = (q, o) => { if (pointInPoly(pl.x, pl.y, GEO.fieldPoly)) return tField(q, o); o.x = fieldGateX(); o.y = -40; o.label = 'Field gate'; return true; };

function startQuest(id) {
  const d = QUESTS[id]; if (!d) return false;
  const cur = qs(id);
  if (cur && (cur.status === 'active' || (cur.status === 'done' && !d.repeatable))) return false;
  const data = d.init ? d.init(cur ? cur.data : null) : {};
  data.u = ++uSeq;
  state.quests[id] = { status: 'active', step: 0, data };
  const q = qs(id);
  if (d.begin) d.begin(q);
  emit('quest:started', { id, title: d.title, step: txt(d.steps[0], q) });
  sfx('quest'); toast(`New quest: ${d.title}`, { kind: 'quest' });
  settle(id); refreshAll();
  return true;
}
function settle(id) { // run the done/back tests for the current step until nothing changes
  const d = QUESTS[id];
  for (let n = 0; n < 6; n++) {
    const q = qs(id); if (!q || q.status !== 'active') return;
    const s = d.steps[q.step];
    if (s.back && q.step > 0 && s.back(q)) { toStep(id, q.step - 1); continue; }
    if (s.done && s.done(q)) { advance(id); continue; }
    return;
  }
}
function advance(id) {
  const d = QUESTS[id], q = qs(id), prev = d.steps[q.step];
  q.step++; q.data.u = ++uSeq;
  if (q.step >= d.steps.length) return complete(id);
  const s = d.steps[q.step], text = txt(s, q);
  emit('quest:updated', { id, title: d.title, step: text });
  if (!prev.quiet) { sfx('quest'); toast(text, { kind: 'quest' }); }
  trackerDirty = true; uiAcc = 1;
}
function toStep(id, n) {
  const d = QUESTS[id], q = qs(id); q.step = n; q.data.u = ++uSeq;
  const text = txt(d.steps[n], q);
  emit('quest:updated', { id, title: d.title, step: text });
  toast(text, { kind: 'warn' }); trackerDirty = true; uiAcc = 1;
}
function complete(id, o = {}) {
  const d = QUESTS[id], q = qs(id);
  const reward = o.reward != null ? o.reward : d.reward || 0;
  q.status = 'done'; q.step = d.steps.length; q.data.u = ++uSeq;
  if (d.onComplete) d.onComplete(q, o);
  if (reward && o.pay !== false) addMoney(reward, 'quest');
  emit('quest:completed', { id, title: d.title, reward });
  sfx('quest');
  if (d.quiet) toast(o.note || d.title, { kind: 'good' });
  else bigMessage(d.big ? d.big[0] : 'Quest complete', d.big ? d.big[1] : reward ? `${d.title}  -  Rs ${reward}` : d.title);
  refreshAll();
}
function refreshAll() { refreshTracker(); refreshMarkers(); }

// ---------- tracker, map markers, compass target ----------
const tgt = { x: 0, y: 0, label: '' }, bestT = { u: -1, x: 0, y: 0, label: '' }, lastObj = { x: 1e9, y: 1e9, label: '' };
const shown = new Map(), keep = new Set();
function putMarker(key, x, y, label, color) {
  let m = shown.get(key);
  if (m && Math.abs(m.x - x) < 1 && Math.abs(m.y - y) < 1 && m.label === label) return;
  if (!m) { m = { x, y, label }; shown.set(key, m); } else { m.x = x; m.y = y; m.label = label; }
  addMarker(key, color ? { x, y, kind: 'quest', label, color } : { x, y, kind: 'quest', label });
}
function refreshTracker() {
  trackerDirty = false;
  const ids = ORDER.filter(id => isActive(id) && !QUESTS[id].hideTracker).sort((a, b) => qs(b).data.u - qs(a).data.u).slice(0, 3);
  const entries = ids.map(id => { const d = QUESTS[id], q = qs(id); return { title: d.title, steps: [{ text: txt(stepOf(d, q), q), done: false }] }; });
  setQuestTracker(entries); // the live delivery countdown has its own line in the HUD tracker
}
function refreshMarkers() {
  keep.clear(); bestT.u = -1;
  const tutorial = isDone('morning_sah');
  for (let i = 0; i < ORDER.length; i++) {
    const id = ORDER[i], d = QUESTS[id], q = qs(id);
    if (q && q.status === 'active') {
      const s = stepOf(d, q);
      if (s.t && s.t(q, tgt)) {
        if (!d.noMarker) { putMarker(d.mk, tgt.x, tgt.y, tgt.label, null); keep.add(d.mk); }
        if (q.data.u > bestT.u) { bestT.u = q.data.u; bestT.x = tgt.x; bestT.y = tgt.y; bestT.label = tgt.label; }
      }
    } else if (d.giver && tutorial && (!q || (d.repeatable && q.status === 'done')) && d.available()) {
      const n = getNPC(d.giver) || BY_ID[d.giver];
      putMarker(d.gk, n.x, n.y, BY_ID[d.giver].name, GOLD); keep.add(d.gk);
    }
  }
  for (const k of shown.keys()) if (!keep.has(k)) { shown.delete(k); removeMarker(k); }
  if (bestT.u >= 0) {
    if (Math.abs(lastObj.x - bestT.x) > 1 || Math.abs(lastObj.y - bestT.y) > 1 || lastObj.label !== bestT.label) {
      lastObj.x = bestT.x; lastObj.y = bestT.y; lastObj.label = bestT.label;
      setObjectiveTarget({ x: bestT.x, y: bestT.y, label: bestT.label }); setWorldMarker('quest', { x: bestT.x, y: bestT.y });
    }
  } else if (lastObj.label !== null) { lastObj.x = lastObj.y = 1e9; lastObj.label = null; setObjectiveTarget(null); clearWorldMarker('quest'); }
}

// ---------- helpers for the quest content ----------
function ballSpot() { // a lane spot 60-120 m north of the field that a person can walk to; pure function of the map, so it survives reloads
  const cx = FIELD_C[0], cy = FIELD_C[1] + 90; let best = null, bd = 1e9;
  const ok = (x, y) => walkable(x, y) && walkable(x + 1.5, y) && walkable(x - 1.5, y) && walkable(x, y + 1.5) && walkable(x, y - 1.5);
  for (const r of GEO.roads) for (let k = 1; k < r.p.length; k++) {
    const a = r.p[k - 1], b = r.p[k], n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / 4));
    for (let j = 0; j <= n; j++) {
      const x = a[0] + (b[0] - a[0]) * j / n, y = a[1] + (b[1] - a[1]) * j / n;
      if (y < FIELD_C[1] + 60 || y > FIELD_C[1] + 120) continue;
      const d = Math.hypot(x - cx, y - cy); if (d < bd && ok(x, y)) { bd = d; best = [x, y]; }
    }
  }
  return best || findOpen(cx, cy);
}
function poriPos() { const a = allAnimals(); for (let i = 0; i < a.length; i++) if (a[i].id === 'pori' || a[i].name === 'Pori') return a[i]; return null; }
let biscuitShop = null;
function findBiscuitShop() { // the nearest-to-Hatigarh shop that sells biscuits, once items.js has its shop table
  if (biscuitShop) return biscuitShop;
  const opts = [{ shop: 'hatigarh_kiosk', x: -501, y: -61.6, name: 'Hatigarh kiosk' }, { shop: 'sweets', x: -489.3, y: -60.2, name: 'Hatigarh sweets stall' }, ...NAMED.filter(d => d.shop).map(d => ({ shop: d.shop, x: d.x, y: d.y, name: d.name }))];
  for (const o of opts) { const S = SHOPS && SHOPS[o.shop]; if (S && S.items && S.items.includes('biscuits')) return (biscuitShop = o); }
  return opts[0];
}
const PORI_PARK = { x: -118, y: -97 }; // her spot on the park lawn once the quest is done
const SPOTS_3 = ['hatigarh', 'field', 'park_tank'], SPOT_NAME = { hatigarh: 'Hatigarh', field: 'the field', park_tank: 'the park water tank' };
const PHOTO_IDS = ['mandir', 'viewpoint', 'hatigarh', 'park', 'field', 'fss'];
const inPark = () => pointInPoly(pl.x, pl.y, GEO.parkPoly);
function kids(playing) { // while the ball is lost the boys stand about waiting; otherwise they play
  for (const id of ['rinku', 'moni', 'bablu']) { try { npcSetBehavior(id, playing ? 'play' : 'idle', { anchor: { ...FIELD_ANCHOR } }); } catch (e) { /* npc module not ready */ } }
}

// ---------- the quests ----------
def({ id: 'morning_sah', title: "Dadu's morning tea", reward: 30, hint: 'Say hello to Dadu by the field',
  desc: "Dadu cannot start his morning without a glass of lal sah. Fetch one from Bina Baideu's stall and learn how to get around.",
  steps: [
    { text: 'Talk to Dadu by the field (press E near him)', t: tNpc('dadu') },
    { text: "Buy a lal sah at Bina Baideu's tea stall by the Children's Park", t: tNpc('bina'), done: () => hasItem('lal_sah') },
    { text: 'Bring the lal sah to Dadu', t: tNpc('dadu'), back: () => !hasItem('lal_sah') },
  ] });

def({ id: 'lost_ball', title: 'The lost ball', reward: 40, giver: 'rinku', hint: 'Talk to Rinku on the field',
  desc: "The boys' ball flew over the wall into a lane up north. Find it and carry it back onto the field.",
  init: () => ({ spot: ballSpot() }),
  begin: q => { setBallPosition(q.data.spot[0], q.data.spot[1]); kids(false); },
  restore: q => { q.data.spot = q.data.spot || ballSpot(); setBallPosition(q.data.spot[0], q.data.spot[1]); if (q.step > 1) q.step = 1; kids(false); },
  onComplete: () => { kids(true); toast('Rinku is itching for a proper match. Talk to him.', { kind: 'info' }); },
  steps: [
    { text: 'Talk to Rinku on the field', t: tNpc('rinku'), done: () => true, quiet: true },
    { text: 'Find the lost ball in the lanes north of the field', t: (q, o) => { const b = getBall(); o.x = b ? b.x : q.data.spot[0]; o.y = b ? b.y : q.data.spot[1]; o.label = 'Lost ball'; return true; },
      done: q => { const b = getBall(); return !!b && (Math.hypot(pl.x - b.x, pl.y - b.y) < 6 || Math.hypot(b.x - q.data.spot[0], b.y - q.data.spot[1]) > 3); } },
    { text: 'Carry the ball back onto the field (E to pick it up)', t: tFieldWay, done: () => { const b = getBall(); return !!b && !!b.inField; } },
  ] });

def({ id: 'football_match', title: 'Match on the field', reward: 60, giver: 'rinku', available: () => isDone('lost_ball'), hint: 'Finish the lost ball favour for Rinku first',
  desc: 'Rinku wants a real match. Score three goals on the field.',
  init: () => ({ goals: 0 }),
  on: { 'goal:scored': q => { if (q.step === 1) { q.data.goals++; trackerDirty = true; toast(`Goal! ${Math.min(3, q.data.goals)}/3`, { kind: 'quest' }); } } },
  steps: [
    { text: 'Talk to Rinku on the field', t: tNpc('rinku'), done: () => true, quiet: true },
    { text: q => `Score 3 goals on the field (${Math.min(3, q.data.goals)}/3)`, t: tField, done: q => q.data.goals >= 3 },
  ] });

def({ id: 'puja_flowers', title: 'Flowers for the puja', reward: 25, giver: 'purohit', hint: 'Talk to Purohit Sarma at the Mandir gate',
  desc: 'Purohit Sarma needs fresh marigolds for the morning puja. Bring them, offer them and ring the bell for a blessing.',
  onComplete: () => { addBuff('stamina', 300); toast('Blessing: your stamina lasts longer for five minutes', { kind: 'good' }); npcSay('purohit', 'Kalyan hok! May the road be kind to you.', 5000); },
  on: { 'bell:rung': q => { if (q.step === 3) complete('puja_flowers'); } },
  steps: [
    { text: 'Talk to Purohit Sarma at the Mandir gate', t: tNpc('purohit'), done: () => true, quiet: true },
    { text: "Buy marigolds from Jonali's flower cart by the steps", t: tNpc('jonali'), done: () => hasItem('marigold') },
    { text: 'Offer the marigolds to Purohit Sarma', t: tNpc('purohit'), back: () => !hasItem('marigold') },
    { text: 'Ring the bell at the Mandir gate', t: tPt(MANDIR.gx, MANDIR.stairTop + 0.6, 'Mandir bell') },
  ] });

def({ id: 'pori', title: 'A friend for Pori', reward: 20, giver: 'raju', hint: 'Talk to Raju, the toto driver at Hatigarh',
  desc: "Pori, the stray at Hatigarh, is hungry. Feed her and walk her to the Children's Park, where she can rest on the lawn.",
  init: () => ({ fed: false }),
  restore: q => { if (q.step >= 3) setDogFollow('pori', true); },
  onComplete: () => { setDogFollow('pori', false, PORI_PARK); toast("Pori settles down on the park lawn", { kind: 'good' }); },
  on: { 'dog:fed': (q, p) => { if (q.step >= 1 && (!p || !p.id || p.id === 'pori')) q.data.fed = true; } },
  steps: [
    { text: 'Talk to Raju at Hatigarh', t: tNpc('raju'), done: () => true, quiet: true },
    { text: () => `Buy biscuits for Pori (try the ${findBiscuitShop().name})`, t: (q, o) => { const s = findBiscuitShop(); o.x = s.x; o.y = s.y; o.label = s.name; return true; }, done: q => q.data.fed || hasItem('biscuits') },
    { text: 'Feed Pori near the Hatigarh stalls', t: (q, o) => { const p = poriPos(); o.x = p ? p.x : -470; o.y = p ? p.y : -70; o.label = 'Pori'; return true; }, done: q => q.data.fed, back: q => !q.data.fed && !hasItem('biscuits') },
    { text: "Walk Pori to the Children's Park", t: tPt(GATE.x, -84, "Children's Park"),
      done: q => { if (!inPark()) return false; const p = poriPos(); return !!p && Math.hypot(p.x - pl.x, p.y - pl.y) < 20; } },
  ] });

def({ id: 'eyes_on_city', title: 'Eyes on the city', reward: 50, giver: 'kakati', hint: 'Talk to Kakati Khura at the View point',
  desc: 'Kakati Khura wants you to find three places through his binoculars from the View point terrace. He knows where the gamosa are hiding.',
  init: () => ({ seen: [] }),
  onComplete: () => { setFlag('gamosa_map', true); toast('Now you know where to look: gamosa markers show on your map', { kind: 'good' }); },
  on: { 'binocular:spotted': (q, p) => {
    if (q.step !== 1 || !p || !SPOTS_3.includes(p.placeId) || q.data.seen.includes(p.placeId)) return;
    q.data.seen.push(p.placeId); trackerDirty = true; toast(`Spotted ${SPOT_NAME[p.placeId]} (${q.data.seen.length}/3)`, { kind: 'quest' });
  } },
  steps: [
    { text: 'Talk to Kakati Khura at the View point', t: tNpc('kakati'), done: () => true, quiet: true },
    { text: q => `Spot ${SPOTS_3.filter(s => !q.data.seen.includes(s)).map(s => SPOT_NAME[s]).join(', ')} through the binoculars (${q.data.seen.length}/3)`, t: tPt(DECK.cx, DECK.cy - 2, 'View point'), done: q => q.data.seen.length >= 3 },
  ] });

def({ id: 'parcel_run', title: 'Parcel run', reward: 0, giver: 'dipen', repeatable: true, quiet: true, noMarker: true, hideTracker: true, hint: 'Talk to Dipen at the Hatigarh stalls',
  desc: 'Dipen at the Hatigarh stalls hands out parcels for delivery. Be quick for the full pay. You can take as many as you like.',
  init: prev => ({ runs: prev ? prev.runs | 0 : 0, jobId: null }),
  poll: q => { if (q.step >= 1 && !getDelivery()) complete('parcel_run', { pay: false, reward: 0, note: 'The parcel run is over' }); },
  on: { 'delivery:done': (q, p) => {
    q.data.runs = (q.data.runs | 0) + 1;
    complete('parcel_run', { pay: false, reward: p && p.reward || 0, note: p && p.onTime === false ? 'Parcel delivered, a little late' : 'Parcel delivered on time' });
    npcSay('dipen', p && p.onTime === false ? 'Late, but it arrived. Next time faster, shabash!' : 'Right on time! You are the best runner I have had.', 5000);
  } },
  steps: [
    { text: 'Talk to Dipen at the Hatigarh stalls', t: tNpc('dipen'), done: () => true, quiet: true },
    { text: 'Deliver the parcel', t: (q, o) => { const j = getDelivery(); if (!j) return false; o.x = j.x; o.y = j.y; o.label = j.label; return true; } },
  ] });

def({ id: 'gamosa_trail', title: 'The gamosa trail', reward: 500, big: ['Geetanagar Guide', 'You found every gamosa: Rs 500'], hint: 'Find a gamosa lying somewhere in the neighbourhood',
  desc: 'Red-and-white gamosa lie scattered across Geetanagar. Find all 24. Kakati Khura at the View point can show you where to look.',
  init: () => ({ count: 0, total: 24 }),
  onComplete: () => { setFlag('title', 'Geetanagar Guide'); },
  on: { 'collectible:found': (q, p) => { q.data.count = p && p.count != null ? p.count : state.collected.length; if (p && p.total) q.data.total = p.total; trackerDirty = true; } },
  steps: [
    { text: q => `Find all ${q.data.total} gamosa around Geetanagar (${q.data.count}/${q.data.total})`, done: q => q.data.count >= q.data.total },
  ] });

def({ id: 'photo_walk', title: 'Photo walk', reward: 80, giver: 'anjali', hint: 'Talk to Anjali near the high school',
  desc: 'Anjali needs five good photographs of Geetanagar: the mandir, View point, Hatigarh, the Children\'s Park, the field or the FSS school. Take them with the camera key.',
  init: () => ({ shots: [] }),
  on: { 'photo:taken': (q, p) => {
    if (q.step !== 1 || !p || !PHOTO_IDS.includes(p.placeId) || q.data.shots.includes(p.placeId)) return;
    q.data.shots.push(p.placeId); trackerDirty = true; toast(`Photo of ${PLACE_BY_ID[p.placeId].name} (${q.data.shots.length}/5)`, { kind: 'quest' });
  } },
  steps: [
    { text: 'Talk to Anjali near the high school', t: tNpc('anjali'), done: () => true, quiet: true },
    { text: q => `Photograph 5 of 6 places (${q.data.shots.length}/5): ${PHOTO_IDS.filter(s => !q.data.shots.includes(s)).map(s => PLACE_BY_ID[s].name.replace('Faculty Senior Secondary School', 'FSS school')).join(', ')}`,
      t: (q, o) => { // point at the nearest place still to be photographed
        let best = null, bd = 1e9;
        for (let i = 0; i < PHOTO_IDS.length; i++) { const p = PLACE_BY_ID[PHOTO_IDS[i]]; if (q.data.shots.includes(p.id)) continue; const d = Math.hypot(p.x - pl.x, p.y - pl.y); if (d < bd) { bd = d; best = p; } }
        if (!best) return false; o.x = best.x; o.y = best.y; o.label = best.name; return true;
      }, done: q => q.data.shots.length >= 5 },
  ] });

def({ id: 'scooter_errand', title: 'Scooter errand', reward: 70, giver: 'khagen', available: () => isDone('morning_sah'), hint: 'Help Dadu first, then see Khagen Da at the PAN and TEA kiosk',
  desc: "Khagen Da lends you his scooter. Get a bag of cash to Bahadur at the SBI branch within two minutes. Late still pays, a little.",
  init: () => ({ left: 120 }),
  begin: q => { setScooterUnlocked(true); setFlag('scooter_unlocked', true); addItem('cash_bag', 1); },
  restore: () => setScooterUnlocked(true),
  steps: [
    { text: 'Talk to Khagen Da at the PAN and TEA kiosk', t: tNpc('khagen'), done: () => true, quiet: true },
    { text: q => (q.data.left > 0 ? `Take the cash bag to Bahadur at the SBI branch (${fmtTime(q.data.left)})` : 'Late! Still take the cash bag to Bahadur at the SBI branch'), t: tNpc('bahadur') },
  ] });

// ---------- discovery ----------
function placesTick() { // a few places per frame, round robin
  for (let k = 0; k < 4; k++) {
    const i = pIdx; pIdx = (pIdx + 1) % PLACES.length;
    if (found[i]) continue;
    const p = PLACES[i], dx = pl.x - p.x, dy = pl.y - p.y;
    if (dx * dx + dy * dy > p.r * p.r) continue;
    found[i] = 1;
    if (discover(p.id, p.name)) { toast(`Discovered: ${p.name}`, { kind: 'good' }); addMoney(5, 'discovery'); sfx('pickup'); }
  }
}

// ---------- per-frame ----------
function updateQuests(dt, player) {
  if (!live) return;
  pl = player;
  placesTick();
  const sc = state.quests.scooter_errand;
  if (sc && sc.status === 'active' && sc.data.left > 0) { sc.data.left -= dt; if (sc.data.left <= 0) { sc.data.left = 0; trackerDirty = true; toast("Time's up! Bahadur is still waiting for the bag", { kind: 'warn' }); } }
  tickAcc += dt;
  if (dirty || tickAcc >= 0.3) {
    tickAcc = 0; dirty = false;
    for (let i = 0; i < ORDER.length; i++) { const id = ORDER[i], q = qs(id); if (q && q.status === 'active') { const d = QUESTS[id]; if (d.poll) d.poll(q); settle(id); } }
  }
  secAcc += dt;
  if (secAcc >= 1) { secAcc = 0; if ((sc && sc.status === 'active' && sc.data.left > 0) || getDelivery()) trackerDirty = true; }
  uiAcc += dt;
  if (uiAcc >= 0.5) { uiAcc = 0; refreshMarkers(); }
  if (trackerDirty) refreshTracker();
}

// ---------- save, load, new game ----------
function onStart() {
  live = true; // idempotent: may run again after a load or a new game, so clear what the previous run put up first
  for (const k of shown.keys()) removeMarker(k);
  shown.clear(); lastObj.x = lastObj.y = 1e9; lastObj.label = null;
  setObjectiveTarget(null); clearWorldMarker('quest'); setQuestTracker([]);
  dirty = trackerDirty = false;
  found = new Uint8Array(PLACES.length);
  PLACES.forEach((p, i) => { if (state.discovered.includes(p.id)) found[i] = 1; });
  uSeq = 0; for (const id of ORDER) { const q = qs(id); if (q && q.data && q.data.u > uSeq) uSeq = q.data.u; }
  if (!qs('morning_sah')) startQuest('morning_sah');
  if (!qs('gamosa_trail') && state.collected.length) { startQuest('gamosa_trail'); qs('gamosa_trail').data.count = state.collected.length; }
  for (const id of ORDER) { const q = qs(id), d = QUESTS[id]; if (q && q.status === 'active' && d.restore) { try { d.restore(q); } catch (e) { console.error(`[quests] restore ${id}`, e); } } }
  setScooterUnlocked(!!state.flags.scooter_unlocked);
  if (isDone('pori')) setDogFollow('pori', false, PORI_PARK, true); // she lives in the park now
  else if (!isActive('pori') || qs('pori').step < 3) setDogFollow('pori', false);
  kids(!isActive('lost_ball'));
  for (const id of ORDER) if (isActive(id)) settle(id);
  tickAcc = 0; uiAcc = 0; refreshAll();
}

// ---------- the log for the journal ----------
function getQuestLog() {
  const act = [], todo = [], fin = [];
  for (const id of ORDER) {
    const d = QUESTS[id], q = qs(id), base = { id, title: d.title, desc: d.desc, reward: d.reward || 0 };
    if (id === 'parcel_run') {
      const runs = Math.max(state.stats.deliveries | 0, q ? q.data.runs | 0 : 0);
      if (!q && !runs) { todo.push({ ...base, status: 'locked', steps: [{ text: d.hint, done: false }] }); continue; }
      const live = q && q.status === 'active';
      const row = { ...base, status: live ? 'active' : 'done', steps: [{ text: `Parcels delivered: ${runs}`, done: runs > 0 }, { text: live ? 'Deliver the current parcel' : 'Dipen always has another one for you', done: false }] };
      (live ? act : fin).push(row); continue;
    }
    if (!q) { todo.push({ ...base, status: 'locked', steps: [{ text: d.hint, done: false }] }); continue; }
    const row = { ...base, status: q.status, steps: d.steps.map((s, i) => ({ text: txt(s, q), done: q.status === 'done' || i < q.step })) };
    if (q.status === 'active') { row.u = q.data.u; act.push(row); } else fin.push(row);
  }
  act.sort((a, b) => b.u - a.u);
  return [...act, ...todo, ...fin];
}

// ---------- talking ----------
const SUGGEST = [
  ['lost_ball', 'Rinku and the boys have lost their ball again. Find them on the field, they could use a runner.'],
  ['puja_flowers', 'Purohit Sarma, up at the Mandir gate, needs marigolds for the puja. Jonali sells them at the yellow carts by the steps.'],
  ['eyes_on_city', 'Kakati Khura sits up at the View point with his binoculars. Ask him where the gamosa are hiding.'],
  ['pori', 'Far west at Hatigarh there is a thin dog called Pori. Raju the toto driver will tell you her story.'],
  ['photo_walk', 'A college girl, Anjali, is near the high school with a camera. She is short of a good photographer.'],
  ['scooter_errand', 'Khagen Da at the PAN and TEA kiosk has a scooter and a favour to ask.'],
  ['parcel_run', 'Dipen at the Hatigarh stalls pays well for quick feet.'],
  ['football_match', 'Rinku has been talking about a proper match all week.'],
];
function suggestions(n) { const out = []; for (const [id, line] of SUGGEST) { if (out.length >= n) break; if (!qs(id) && QUESTS[id].available()) out.push(line); } return out; }
const reg = (id, fn) => { TALK[id] = async npc => { try { settleAllNow(); await fn(npc); } catch (e) { if (!(e instanceof Aborted)) console.error(`[quests] talk ${id}`, e); } }; };
function settleAllNow() { for (const id of ORDER) if (isActive(id)) settle(id); }
const yes = [{ text: 'Sure', value: 'y' }, { text: 'Not now', value: 'n' }];

async function talkDadu(npc) {
  const q = qs('morning_sah');
  if (q.status === 'active' && q.step === 0) {
    await sayAll(npc, [
      'Ah, there you are! Kene aso, beta? I am Hemanta Bora, but all of Geetanagar just says Dadu.',
      'Forty years I taught geography at the high school over there. Now I teach the crows on that wall.',
      'Whenever you stand near a person, a stall or something interesting, press E. That is how you talk, buy things and ring bells. You just did it.',
      "Now, a small favour. A morning is not a morning without a glass of lal sah, red tea. Bina Baideu keeps a stall by the Children's Park, west along Mother Teresa Road.",
    ]);
    for (;;) {
      const v = await ask(npc, 'Bring me one? Your money is in the top corner of the screen, and the list under it keeps track of what we agreed.', [{ text: 'Of course, Dadu', value: 'ok' }, { text: 'Where is that stall?', value: 'where' }, { text: 'Maybe later', value: 'later' }]);
      if (v === 'where') { await say(npc, "West along the main road, a few minutes' walk. South side, a tin-roofed stall near the white fence and the tall water tank. The gold marker on your minimap will point the way."); continue; }
      if (v === 'ok') { if (isActive('morning_sah') && qs('morning_sah').step === 0) advance('morning_sah'); await say(npc, 'Dhonyobaad! Thirty rupees when you are back, and the tea is on me.'); }
      else await say(npc, 'As you like. I will be here, I am always here.');
      return;
    }
  }
  if (q.status === 'active' && q.step === 1) { await say(npc, "One glass of lal sah from Bina Baideu's stall, by the Children's Park. West along the road. Stand near her and press E."); return; }
  if (q.status === 'active' && q.step === 2) {
    await say(npc, hasItem('lal_sah') ? 'Ahhh, lal sah. Still hot. You are a good child.' : 'Where is my tea? Did you drink it on the way?');
    if (!hasItem('lal_sah') || !isActive('morning_sah') || qs('morning_sah').step !== 2) return;
    removeItem('lal_sah', 1); complete('morning_sah');
    await say(npc, 'Here is something for your trouble. Now you know how it works: people, stalls, bells, all with E.');
    const s = suggestions(3);
    if (s.length) { await say(npc, 'Let me tell you who could use a hand around here.'); await sayAll(npc, s); }
    await say(npc, 'And look out for gamosa, red-and-white scarves lying about in odd places. Kakati Khura on the View point can show you where to look.');
    return;
  }
  const s = suggestions(1);
  if (s.length) { await say(npc, 'Good to see you again, beta.'); await say(npc, s[0]); }
  else if (!state.flags.gamosa_map) { await say(npc, 'Have you been up to see Kakati Khura? He knows where the gamosa are hiding.'); }
  else await chat(npc);
}

async function talkRinku(npc) {
  const lost = qs('lost_ball'), match = qs('football_match');
  if (!lost) {
    await sayAll(npc, ['Oi, you! Yes, you. Can you run?', 'Our ball flew over the wall into some lane up north. If we leave the goal, Moni will score on us for sure.']);
    if (await ask(npc, 'Will you find it? Pick it up and bring it back onto the field.', [{ text: "I'll find it", value: 'y' }, { text: 'Not now', value: 'n' }]) === 'y') { startQuest('lost_ball'); await say(npc, 'Dhonyobaad! Check the lanes north of the field. It is black and white, you cannot miss it.'); }
    else await say(npc, 'Hmm. Okay. We will wait. But not for long.');
    return;
  }
  if (lost.status === 'active') { await say(npc, lost.step <= 1 ? 'The ball? Up the lanes north of the field. Look for the white-and-black spots on the ground.' : 'You have it? Bring it back onto the field, anywhere inside counts!'); return; }
  if (!match) {
    await say(npc, 'You found the ball! You are officially an honorary member of the team.');
    if (await ask(npc, 'Want a proper game? Score three goals past Bablu and the field is yours.', yes) === 'y') { startQuest('football_match'); await say(npc, 'Yes! Walk into the ball to dribble it, and kick it at the goal. Bablu will not make it easy.'); }
    else await say(npc, 'Come back when you feel lucky.');
    return;
  }
  if (match.status === 'active') { await say(npc, `Three goals and you win. You have ${Math.min(3, match.data.goals)} so far. Keep going!`); return; }
  await say(npc, 'Three goals past Bablu! Nobody has done that since last Bihu.');
}
async function talkKid(npc) {
  if (isActive('lost_ball')) await say(npc, "Rinku says you are looking for the ball? Try the lanes north of the field. It bounced off a roof, I swear.");
  else if (isActive('football_match')) await say(npc, 'Go on, then. Score three goals and I will let you call yourself captain.');
  else if (isDone('lost_ball')) await say(npc, 'You found our ball. Everyone is talking about it.');
  else await chat(npc);
}

async function talkPurohit(npc) {
  const q = qs('puja_flowers');
  if (!q) {
    await say(npc, 'Hari Om. You are new here, I think. Welcome.');
    await say(npc, 'The morning puja needs fresh marigolds, and my knees do not like those steps.');
    if (await ask(npc, "Would you fetch some from Jonali's cart down by the stairs? Bring them to me, and ring the bell at the gate after.", yes) === 'y') { startQuest('puja_flowers'); await say(npc, 'Kalyan hok. Take your time, but do not let the petals wilt.'); }
    else await say(npc, 'The gods are patient. So am I. Mostly.');
    return;
  }
  if (q.status === 'active') {
    if (q.step === 1) await say(npc, "Marigolds from Jonali's cart, right by the steps. Fresh ones, please.");
    else if (q.step === 2) {
      await say(npc, 'Marigolds! Fresh as the morning. Dhonyobaad.');
      if (!hasItem('marigold') || !isActive('puja_flowers') || qs('puja_flowers').step !== 2) return;
      advance('puja_flowers'); removeItem('marigold', 1);
      await say(npc, 'Now ring the bell at the gate, once, and let the gods know someone is here.');
    } else await say(npc, 'The bell is just at the gate. One ring, calm and clear.');
    return;
  }
  await say(npc, 'May the road be kind to you. Come again, any morning.');
}

async function talkRaju(npc) {
  const q = qs('pori');
  if (q && q.status === 'active') {
    await say(npc, q.step <= 1 ? 'Biscuits, any shop or the kiosk will do. Pori loves them more than my toto.' : q.step === 2 ? 'Pori should be around the stalls. She goes to whoever has biscuits.' : "Take her to the Children's Park, east along the main road. She will follow you if she likes you.");
    return;
  }
  const choices = [...(q ? [] : [{ text: 'Who is Pori?', value: 'pori' }]), { text: 'Chat', value: 'chat' }, { text: 'Bye', value: 'bye' }];
  const v = await ask(npc, q ? 'Pori told me about you. She has a new favourite person.' : 'Toto? Or just talking today?', choices);
  if (v === 'chat') await chat(npc);
  else if (v === 'pori') {
    await sayAll(npc, ['Pori is the dog by the stalls. Thin as a bamboo stick, and sweeter than anyone you will meet.', "There is a lawn in the Children's Park where she would be much happier than on this dusty road."]);
    if (await ask(npc, 'Will you buy her biscuits and walk her over there?', yes) === 'y') { startQuest('pori'); await say(npc, 'Dhonyobaad. Show her the biscuits, she will follow. Keep her away from the traffic.'); }
    else await say(npc, 'No hurry. She is not going anywhere. That is the problem.');
  }
}

async function talkKakati(npc) {
  const q = qs('eyes_on_city');
  if (!q) {
    await sayAll(npc, ['Careful on the steps. Come, stand with me. Forty years I measured this city with a chain. This view is the best part of the job.', 'South of here you can see all of Geetanagar.']);
    if (await ask(npc, 'Want to learn to read it? Look through the binoculars on the terrace and find Hatigarh, the field and the water tank in the Children\'s Park.', yes) === 'y') { startQuest('eyes_on_city'); await say(npc, 'Good eyes! When you have spotted all three, I will tell you where the gamosa tend to hide.'); }
    else await say(npc, 'The view will still be here. It has not moved in forty years.');
    return;
  }
  if (q.status === 'active') { await say(npc, `Use the binoculars on the terrace. ${q.data.seen.length} of 3 found: Hatigarh, the field and the water tank in the park.`); return; }
  await say(npc, 'You have the eyes now. Look out for the gamosa: red-and-white, and they stay where people forget them. They show on your map now.');
}

async function talkAnjali(npc) {
  const q = qs('photo_walk');
  if (!q) {
    await sayAll(npc, ['Oh, hi! Do you have a minute? I am putting together a project on how Geetanagar looks.', 'I need five good photographs from this list: the mandir, the View point, Hatigarh, the Children\'s Park, the field or the FSS school.']);
    if (await ask(npc, 'Could you take them? Use the photo key (P) with the place in the frame.', yes) === 'y') { startQuest('photo_walk'); await say(npc, 'Thank you! Five of the six is plenty. Keep the landmark in the frame so it counts.'); }
    else await say(npc, 'No worries. The neighbourhood is not going anywhere.');
    return;
  }
  if (q.status === 'active') { await say(npc, `Five out of six: mandir, View point, Hatigarh, park, field, FSS. You have ${q.data.shots.length} so far. Frame the place with the camera and press P.`); return; }
  await say(npc, 'The photographs came out beautifully. My teacher actually smiled. Thank you!');
}

async function talkDipen(npc) {
  const job = getDelivery(), q = qs('parcel_run'), runs = Math.max(state.stats.deliveries | 0, q ? q.data.runs | 0 : 0);
  if (job) { await say(npc, `You still have a parcel for ${job.label}. ${fmtTime(job.timeLeft)} left, go go go!`); return; }
  const v = await ask(npc, runs ? `Back for more? ${runs} parcels delivered so far. Want another?` : 'Parcels! Anything that goes anywhere in Geetanagar goes through me. Want some work?', [{ text: 'Give me a parcel', value: 'job' }, { text: 'Chat', value: 'chat' }, { text: 'Bye', value: 'bye' }]);
  if (v === 'chat') await chat(npc);
  else if (v === 'job') {
    const j = startDelivery();
    if (!j) { await say(npc, 'Nothing waiting right now. Come back in a while.'); return; }
    startQuest('parcel_run'); if (qs('parcel_run')) qs('parcel_run').data.jobId = j.id;
    await say(npc, `This one goes to ${j.label}. Rs ${j.reward}, and the faster you are, the better the pay.`);
  }
}

async function talkBahadur(npc) {
  const q = qs('scooter_errand');
  if (q && q.status === 'active') {
    if (!hasItem('cash_bag')) { await say(npc, 'Sir, madam, where is the bag? Khagen Da will want to hear this.'); return; }
    const onTime0 = q.data.left > 0;
    await say(npc, onTime0 ? 'Cash bag from Khagen Da? Right on time. Very good.' : 'The cash bag from Khagen Da. Hmm, that was meant to be two minutes. Assam time or normal time?');
    const cur = qs('scooter_errand');
    if (!cur || cur.status !== 'active' || !hasItem('cash_bag')) return;
    const onTime = cur.data.left > 0; // judged at hand-over, so a forced close cannot shortchange anyone
    removeItem('cash_bag', 1); complete('scooter_errand', { reward: onTime ? 70 : 30 });
    await say(npc, onTime ? 'He will be pleased. Here is something for the scooter petrol.' : 'Here is a little for your trouble. And a lot of patience, which is free.');
    return;
  }
  await chat(npc);
}

async function talkKhagen(npc) {
  const q = qs('scooter_errand'), open = isDone('morning_sah') && !q;
  const extras = open ? [{ text: 'Any work for me?', value: 'work' }] : q && q.status === 'active' && !hasItem('cash_bag') ? [{ text: 'I need the bag again', value: 'bag' }] : [];
  const greet = q && q.status === 'active' ? 'Bahadur is waiting at the SBI branch! Hurry, hurry.' : q ? 'My scooter is back where it belongs. Pan and tea?' : null;
  const v = await shopTalk(npc, { greet: greet || undefined, extras });
  if (v === 'bag') { if (!hasItem('cash_bag')) addItem('cash_bag', 1); await say(npc, 'Careful this time. It is not my money, it is the bank\'s.'); }
  else if (v === 'work') {
    await say(npc, 'Dadu says you are reliable. He is a good judge, that old man.');
    await say(npc, "I have a bag of cash for Bahadur at the SBI branch, east along the road and then south. Two minutes. My scooter is parked right by the kiosk: climb on with E.");
    if (await ask(npc, 'Will you do it?', [{ text: "I'll do it", value: 'y' }, { text: 'Not now', value: 'n' }]) === 'y') { startQuest('scooter_errand'); await say(npc, 'Shabash! The clock starts now. Do not forget the helmet. I do not have one.'); }
    else await say(npc, 'Hmm. The offer stands.');
  }
}

async function talkBina(npc) {
  const q = qs('morning_sah');
  await shopTalk(npc, q && q.status === 'active' && q.step === 1 ? { greet: 'Dadu sent you? One lal sah coming up, hot as ever.' } : {});
}
async function talkJonali(npc) {
  const q = qs('puja_flowers');
  await shopTalk(npc, q && q.status === 'active' && q.step === 1 ? { greet: 'Marigolds for Purohit Sarma? He is picky, so I picked the best ones.' } : {});
}

// ---------- init ----------
let inited = false;
function initQuests() {
  if (inited) return; inited = true;
  try { spawnNamedNPCs(); } catch (err) { console.error('[quests] spawnNamedNPCs failed', err); }
  reg('dadu', talkDadu); reg('rinku', talkRinku); reg('moni', talkKid); reg('bablu', talkKid); reg('purohit', talkPurohit);
  reg('raju', talkRaju); reg('kakati', talkKakati); reg('anjali', talkAnjali); reg('dipen', talkDipen); reg('bahadur', talkBahadur);
  reg('khagen', talkKhagen); reg('bina', talkBina); reg('jonali', talkJonali);
  // event hooks: one listener per event type; quests mutate their own data, then the next poll runs the step tests
  const events = new Set(); for (const id of ORDER) if (QUESTS[id].on) for (const ev of Object.keys(QUESTS[id].on)) events.add(ev);
  for (const ev of events) on(ev, p => {
    if (!live) return;
    if (ev === 'collectible:found' && !qs('gamosa_trail')) startQuest('gamosa_trail');
    for (const id of ORDER) { const q = qs(id), h = QUESTS[id].on && QUESTS[id].on[ev]; if (q && q.status === 'active' && h) h(q, p); }
    dirty = true;
  });
  for (const ev of ['shop:bought', 'inv:changed', 'item:used']) on(ev, () => { dirty = true; });
  on('place:discovered', ({ id }) => { const i = PLACES.findIndex(p => p.id === id); if (i >= 0) found[i] = 1; });
  on('game:start', onStart);
}

export { initQuests, updateQuests, getQuestLog, startQuest };
