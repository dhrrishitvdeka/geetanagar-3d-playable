import { GEO, MANDIR } from '../../core/geo.js';
import { DECK } from '../../world/deck.js';
import { MAINP, NRM, asphHalf, hw, nearestOnMain } from '../../world/mainroad.js';
import { beside } from '../../world/streetlife.js';
import { findOpen } from '../../ui/controls.js';
import { spawnNPC } from '../npc/agents.js';
import { isUIBlocking, showDialogue } from '../hud.js';
import { openShop } from '../items.js';

// ---------- the named people of Geetanagar: where they stand, how they look, what they say ----------
// Positions are worked out from the same helpers the world builders use, then nudged onto walkable ground at spawn time
// (colliders only exist once the world is built, so findOpen has to run in spawnNamedNPCs, not here).
const lm = t => { const l = GEO.labels.find(l => l.t === t); return l ? [l.x, l.y] : null; };
const FIELD_C = [(GEO.field[0] + GEO.field[2]) / 2, (GEO.field[1] + GEO.field[3]) / 2];
const FIELD_ANCHOR = { x: FIELD_C[0], y: FIELD_C[1], r: 14 };

// next to a field-side kiosk (same placement as shops.js buildKiosks), `along` metres down the road, facing the carriageway
function kioskSide(kx, along) {
  const [, i] = nearestOnMain(kx, -50), p = MAINP[i], n = NRM[i], off = hw(i) + 1.6;
  return { x: p[0] + n[0] * off + n[1] * along, y: p[1] + n[1] * off - n[0] * along, face: [p[0] + n[1] * along, p[1] - n[0] * along] };
}
function roadPt(x, side, extra) { const [, i] = nearestOnMain(x, -70); const [px, py] = beside(x, side, asphHalf(i) + extra); return [px, py]; }
const K_KHAGEN = kioskSide(24, 2.0), K_MAMONI = kioskSide(31, 2.0), K_RUPA = kioskSide(-44, 2.0), K_HARI = kioskSide(-37, 2.0);
const TEA = roadPt(-121, -1, 3.95);              // behind the counter of the forecourt tea stall (stall front faces the road)
const BUS = roadPt(-52.5, -1, 1.8);              // between the bus shelter and the carriageway
const TOTO = roadPt(-457, -1, 1.7);              // south shoulder, beside the waiting totos
const FLOWER = (() => { const [, i] = nearestOnMain(37.75, -50); return beside(37.75, 1, hw(i) + 1.3); })(); // between the two yellow carts
const sbi = lm('SBI Branch Gitanagar') || [168.9, -172.2];
const school = lm('Geetanagar High School') || [-45, 24.4];
const face = (a, b) => [a, b];

// ---------- look: partial Appearance per person (colours as css hex) ----------
const A = {
  dadu: { skin: '#a9744c', hair: '#d4cfc6', hairStyle: 'short', top: '#f1e6c8', topStyle: 'kurta', bottom: '#efe9dc', bottomStyle: 'dhoti', gamosa: true, height: 0.97, build: 0.95 },
  bina: { skin: '#a2694a', hair: '#1c1612', hairStyle: 'bun', top: '#8e2f5b', topStyle: 'blouse', bottom: '#d9b44a', bottomStyle: 'mekhela', wrap: '#f3ead2', height: 0.93 },
  rinku: { skin: '#9a6540', hair: '#16110e', hairStyle: 'short', top: '#2a6fb5', topStyle: 'tshirt', bottom: '#2c3e50', bottomStyle: 'shorts', kid: true, height: 0.8 },
  moni: { skin: '#b07a52', hair: '#16110e', hairStyle: 'short', top: '#c0392b', topStyle: 'tshirt', bottom: '#33383f', bottomStyle: 'shorts', kid: true, height: 0.74 },
  bablu: { skin: '#8f5b3a', hair: '#16110e', hairStyle: 'cap', top: '#2e8b57', topStyle: 'tshirt', bottom: '#1f3a5f', bottomStyle: 'shorts', kid: true, height: 0.77 },
  purohit: { skin: '#a16a45', hair: '#1a1410', hairStyle: 'bald', top: '#e8892b', topStyle: 'robe', bottom: '#f2eadb', bottomStyle: 'dhoti', gamosa: true, height: 1.0 },
  jonali: { skin: '#a8714a', hair: '#1c1612', hairStyle: 'long', top: '#e3b51e', topStyle: 'blouse', bottom: '#2f7d4f', bottomStyle: 'mekhela', wrap: '#f6efe0', height: 0.94 },
  khagen: { skin: '#946037', hair: '#2a2420', hairStyle: 'short', top: '#4a78a8', topStyle: 'shirt', bottom: '#2c2c34', bottomStyle: 'pants', gamosa: true, height: 1.02, build: 1.12 },
  mamoni: { skin: '#a46c47', hair: '#2a2420', hairStyle: 'bun', top: '#b0447a', topStyle: 'blouse', bottom: '#6a3d8a', bottomStyle: 'sari', wrap: '#6a3d8a', height: 0.95 },
  rupa: { skin: '#9d6a48', hair: '#5a534d', hairStyle: 'bun', top: '#2b6f87', topStyle: 'blouse', bottom: '#d8a034', bottomStyle: 'mekhela', wrap: '#f3ead2', height: 0.92, build: 1.08 },
  hari: { skin: '#8d5a3b', hair: '#1a1410', hairStyle: 'short', top: '#e8e0c8', topStyle: 'shirt', bottom: '#3a3a40', bottomStyle: 'pants', hat: 'cap', height: 0.99 },
  raju: { skin: '#8a5636', hair: '#16110e', hairStyle: 'short', top: '#6d7c5a', topStyle: 'shirt', bottom: '#2f3a4a', bottomStyle: 'pants', gamosa: true, height: 1.0 },
  dipen: { skin: '#a06a45', hair: '#16110e', hairStyle: 'short', top: '#2d4f87', topStyle: 'tshirt', bottom: '#3b3f48', bottomStyle: 'pants', bag: '#d1632c', hat: 'cap', height: 1.03 },
  bahadur: { skin: '#c99a74', hair: '#14100d', hairStyle: 'short', top: '#a89968', topStyle: 'uniform', bottom: '#6b5d3f', bottomStyle: 'pants', hat: 'cap', height: 1.02, build: 1.12 },
  kakati: { skin: '#9b6a46', hair: '#c8c3ba', hairStyle: 'short', top: '#8a8f6a', topStyle: 'shirt', bottom: '#4b4f58', bottomStyle: 'pants', hat: 'topi', bag: '#6b4a2c', height: 0.99, build: 0.95 },
  anjali: { skin: '#b07a52', hair: '#1c1612', hairStyle: 'long', top: '#e07b9b', topStyle: 'tshirt', bottom: '#2c3e6a', bottomStyle: 'pants', bag: '#2f2f33', height: 0.97 },
  bhaiti: { skin: '#9a6540', hair: '#1a1410', hairStyle: 'short', top: '#f2f2f2', topStyle: 'shirt', bottom: '#2f2f3a', bottomStyle: 'pants', bag: '#7a4a2a', height: 1.0 },
};

// ---------- the cast ----------
// shop: shop id for the "Buy something" choice; chat: rotating small talk (one or two lines each, with hints); greet: first line
const NAMED = [
  { id: 'dadu', name: 'Dadu', role: 'elder', title: 'retired teacher', x: -24.5, y: -37.5, face: face(-24.5, -20), behavior: 'sit', anchor: { x: -24.5, y: -37.5, r: 1.5 }, appearance: A.dadu,
    lines: ['Mind the cyclists, beta. They never ring the bell.', 'I taught half this neighbourhood to read a map.'],
    chat: [['The field was a swamp when I was your age. We drained it ourselves, with buckets and bad jokes.'], ['Every sunrise I count the crows on the wall. Eleven today. A good number.'], ['Walk the whole road once, from the mandir to Hatigarh. Then you will know Geetanagar.']] },
  { id: 'bina', name: 'Bina Baideu', role: 'vendor', title: 'tea stall', x: TEA[0], y: TEA[1], face: face(TEA[0], TEA[1] + 20), behavior: 'vendor', anchor: { x: TEA[0], y: TEA[1], r: 1.2 }, shop: 'tea_stall', appearance: A.bina,
    greet: 'Ahok, ahok! Lal sah, doodh sah, or something to nibble?',
    lines: ['Hot tea, hot tea. The kettle never gets cold here.'],
    chat: [['My lal sah is just tea leaves, water and patience. No milk, a little sugar.', 'Half of Geetanagar has a morning that starts at this stall.'], ['See that tall water tank over the fence? It is inside the Children\'s Park. Lovely at sunset.'], ['The bus stand is a short walk east along the road. Bhaiti shouts the routes loud enough to hear from here.'], ['Hatigarh is the big junction far to the west. The totos wait there, and a dog called Pori.']] },
  { id: 'rinku', name: 'Rinku', role: 'kid', title: 'captain of the field', x: FIELD_C[0] + 1, y: FIELD_C[1] + 1, heading: 0.4, behavior: 'play', anchor: { ...FIELD_ANCHOR }, appearance: A.rinku,
    lines: ['Pass, pass! Not to the wall!', 'Our team is unbeaten. Mostly.'], chat: [['Dadu says I should study. I say the goalposts will not guard themselves.']] },
  { id: 'moni', name: 'Moni', role: 'kid', title: 'forward', x: FIELD_C[0] - 4, y: FIELD_C[1] + 4, heading: 1.2, behavior: 'play', anchor: { ...FIELD_ANCHOR }, appearance: A.moni,
    lines: ['I scored twice yesterday. Ask anyone.'], chat: [['Rinku always says he is the captain. We voted. Nobody voted.']] },
  { id: 'bablu', name: 'Bablu', role: 'kid', title: 'goalkeeper', x: FIELD_C[0] + 5, y: FIELD_C[1] - 4, heading: 2.4, behavior: 'play', anchor: { ...FIELD_ANCHOR }, appearance: A.bablu,
    lines: ['I am the goalkeeper. Shoot at me, I dare you.'], chat: [['The goal is seven steps wide. I counted. I stand in the middle and hope.']] },
  { id: 'purohit', name: 'Purohit Sarma', role: 'priest', title: 'priest', x: MANDIR.gx - 2.6, y: MANDIR.stairTop + 1.8, face: face(MANDIR.gx, MANDIR.stairFoot - 12), behavior: 'idle', anchor: { x: MANDIR.gx - 2.6, y: MANDIR.stairTop + 1.8, r: 1.5 }, appearance: A.purohit,
    lines: ['Hari Om. Mind your head under the gate.'], chat: [['The bell at the gate is rung to tell the gods someone has arrived. Do not ring it just for fun.']] },
  { id: 'jonali', name: 'Jonali', role: 'vendor', title: 'flower seller', x: FLOWER[0], y: FLOWER[1], face: face(FLOWER[0], FLOWER[1] - 10), behavior: 'vendor', anchor: { x: FLOWER[0], y: FLOWER[1], r: 1.5 }, shop: 'flower_cart', appearance: A.jonali,
    greet: 'Fresh marigolds this morning! Garlands too, if you need them.',
    lines: ['Flowers for the puja, flowers for the heart.'],
    chat: [['Marigold for the puja, hibiscus for the goddess. The mandir is right behind me, up the steps.'], ['Purohit Sarma notices a wilted petal from the gate. That is why mine are always fresh.'], ['The flowers come from Narengi at five in the morning, straight off the first bus.']] },
  { id: 'khagen', name: 'Khagen Da', role: 'vendor', title: 'pan and tea', x: K_KHAGEN.x, y: K_KHAGEN.y, face: K_KHAGEN.face, behavior: 'vendor', anchor: { x: K_KHAGEN.x, y: K_KHAGEN.y, r: 1.5 }, shop: 'pan_tea', appearance: A.khagen,
    greet: 'Ki khobor? Pan, tea, the morning paper. What will it be?',
    lines: ['The whole news of Geetanagar passes through this kiosk.'],
    chat: [['I read every newspaper before I sell it. That is not stealing, that is quality control.'], ['People who borrow my scooter bring it back with the tank fuller than before. I only lend to people I trust.']] },
  { id: 'mamoni', name: 'Mamoni Baideu', role: 'vendor', title: 'store', x: K_MAMONI.x, y: K_MAMONI.y, face: K_MAMONI.face, behavior: 'vendor', anchor: { x: K_MAMONI.x, y: K_MAMONI.y, r: 1.5 }, shop: 'store', appearance: A.mamoni,
    greet: 'Come, come. Soap, biscuits, matchboxes, if it exists I have it.',
    lines: ['If I do not have it, nobody has it.'],
    chat: [['Khagen Da next door lends his scooter to people he trusts. Do not tell him I said so.'], ['Biscuits are the best thing for a dog, and for a person with a long walk ahead.']] },
  { id: 'rupa', name: 'Rupa Khuri', role: 'vendor', title: 'snacks', x: K_RUPA.x, y: K_RUPA.y, face: K_RUPA.face, behavior: 'vendor', anchor: { x: K_RUPA.x, y: K_RUPA.y, r: 1.5 }, shop: 'snacks', appearance: A.rupa,
    greet: 'Garom garom! Samosa, jalebi, whatever is hot.',
    lines: ['Eat while it is hot. Cold samosa is a sad samosa.'],
    chat: [['Pitha on festival days, samosa on every other day. The dog at Hatigarh gets the crumbs, but samosa is too spicy for her. Take her biscuits.'], ['Hari next door has the sweetest small bananas in Geetanagar. Do not tell him I said so.']] },
  { id: 'hari', name: 'Hari', role: 'vendor', title: 'fruit seller', x: K_HARI.x, y: K_HARI.y, face: K_HARI.face, behavior: 'vendor', anchor: { x: K_HARI.x, y: K_HARI.y, r: 1.5 }, shop: 'fruits', appearance: A.hari,
    greet: 'Fresh fruit, fresh fruit! Bananas from the village, small and sweet.',
    lines: ['A banana before a long walk. Doctor\'s advice. Hari\'s doctor.'],
    chat: [['A banana a day keeps your legs from giving up. I made that up, but it works.'], ['If you need to climb up to the View point, go steady. The hill is steeper than it looks.']] },
  { id: 'raju', name: 'Raju', role: 'driver', title: 'toto driver', x: TOTO[0], y: TOTO[1], face: face(TOTO[0], TOTO[1] + 8), behavior: 'idle', anchor: { x: TOTO[0], y: TOTO[1], r: 2 }, appearance: A.raju,
    lines: ['Toto, toto! Cheaper than a taxi, quieter than an auto.'],
    chat: [['Hop onto one of the totos at the stand and ride down the road. It is slow, but you see everything.'], ['The park is a straight run east along the main road. About five minutes if you walk.'], ['The dog by the stalls is Pori. She knows my toto from the sound of the horn.']] },
  { id: 'dipen', name: 'Dipen', role: 'courier', title: 'parcel dispatcher', x: -492.0, y: -55.3, face: face(-480, -55.3), behavior: 'idle', anchor: { x: -492, y: -55.3, r: 1.5 }, appearance: A.dipen,
    lines: ['Parcels! Anything that goes anywhere in Geetanagar goes through me.'],
    chat: [['Faster means more money. Late means less money. Slow means no money. Simple maths.']] },
  { id: 'bahadur', name: 'Bahadur', role: 'guard', title: 'SBI guard', x: sbi[0] - 10, y: sbi[1] + 7, face: face(sbi[0], sbi[1]), behavior: 'pace', anchor: { x: sbi[0] - 10, y: sbi[1] + 7, r: 3 }, appearance: A.bahadur,
    lines: ['Good morning. The bank opens at ten.'],
    chat: [['Eleven years on this door. I know the regulars by their footsteps.'], ['Anything for the bank comes straight to me, please. No stopping to chat on the way.']] },
  { id: 'kakati', name: 'Kakati Khura', role: 'elder', title: 'retired surveyor', x: DECK.cx + 3.0, y: DECK.cy - 1.0, exact: true, face: face(DECK.cx + 3.0, DECK.cy - 30), behavior: 'sit', anchor: { x: DECK.cx + 3.0, y: DECK.cy - 1.0, r: 1 }, appearance: A.kakati,
    lines: ['Forty years with a measuring chain. This view is the best day of the job.'],
    chat: [['From up here you can see the whole of Geetanagar. That is why I sit here every morning.'], ['I measured half these roads with a chain and two assistants. The hill looked smaller then.']] },
  { id: 'anjali', name: 'Anjali', role: 'student', title: 'college student', x: school[0] + 8, y: school[1] - 9, face: face(school[0], school[1]), behavior: 'wander', anchor: { x: school[0] + 8, y: school[1] - 9, r: 8 }, appearance: A.anjali,
    lines: ['I could take a hundred photos here and still miss the best one.'],
    chat: [['I am putting together a project on how the neighbourhood looks. A proper photograph is harder than it seems.']] },
  { id: 'bhaiti', name: 'Bhaiti', role: 'conductor', title: 'bus conductor', x: BUS[0], y: BUS[1], face: face(BUS[0], BUS[1] + 12), behavior: 'idle', anchor: { x: BUS[0], y: BUS[1], r: 1.5 }, appearance: A.bhaiti,
    lines: ['Paltan Bazar, Maligaon, Jalukbari! Ek-dom fast!'],
    chat: [['Paltan Bazar, Maligaon, Jalukbari, Beltola: all the buses go down this road. Ask anyone, they all know me.'], ['The 6:30 bus is never at 6:30. I am only the conductor. I do not control time.']] },
];
const BY_ID = Object.fromEntries(NAMED.map(d => [d.id, d]));

// ---------- talking helpers (quests.js uses these too) ----------
// A dialogue the HUD force-closed (pause, day change) resolves null while a modal is still up: that throws Aborted, which the
// talk wrappers swallow, so a conversation just ends and state is only ever changed after the player's final choice.
class Aborted extends Error {}
async function say(npc, text) { await showDialogue({ speaker: npc.name, role: npc.title, text }); if (isUIBlocking()) throw new Aborted(); }
async function ask(npc, text, choices) { const v = await showDialogue({ speaker: npc.name, role: npc.title, text, choices }); if (v == null && isUIBlocking()) throw new Aborted(); return v; }
async function sayAll(npc, lines) { for (const t of lines) await say(npc, t); }
const turn = new Map();
async function chat(npc) { // rotates through the person's small talk
  const list = (npc.def && npc.def.chat) || (BY_ID[npc.id] && BY_ID[npc.id].chat) || [['Hmm, nice weather, isn\'t it?']];
  const k = turn.get(npc.id) || 0; turn.set(npc.id, k + 1);
  await sayAll(npc, list[k % list.length]);
}
// greeting, then Buy / (extras) / Chat / Bye. Returns 'buy', 'chat', 'bye' or the value of an extra choice.
async function shopTalk(npc, o = {}) {
  const shop = (npc.def && npc.def.shop) || (BY_ID[npc.id] && BY_ID[npc.id].shop);
  const choices = [...(shop ? [{ text: 'Buy something', value: 'buy' }] : []), ...(o.extras || []), { text: 'Chat', value: 'chat' }, { text: 'Bye', value: 'bye' }];
  const v = await ask(npc, o.greet || (BY_ID[npc.id] && BY_ID[npc.id].greet) || 'Ki khobor? What can I do for you?', choices);
  if (v === 'buy') { await openShop(shop); return 'buy'; }
  if (v === 'chat') { await chat(npc); return 'chat'; }
  return v == null ? 'bye' : v;
}
// quest givers register their own talk here (quests.js); everyone else falls back to the shop or small talk
const TALK = {};
async function talk(npc) {
  try {
    const h = TALK[npc.id];
    if (h) return await h(npc);
    const d = BY_ID[npc.id];
    if (d && d.shop) return await shopTalk(npc);
    return await chat(npc);
  } catch (err) { if (!(err instanceof Aborted)) console.error(`[npcs] talk ${npc.id}`, err); }
}
for (const d of NAMED) d.onTalk = npc => talk(npc);

function spawnNamedNPCs() {
  const out = [];
  for (const d of NAMED) {
    try {
      const [x, y] = d.exact ? [d.x, d.y] : findOpen(d.x, d.y);
      d.x = x; d.y = y; // quests read these as fallback target positions
      if (d.anchor && !d.exact && d.anchor.r <= 3) { d.anchor.x = x; d.anchor.y = y; } // tight anchors follow the nudged spot
      const heading = d.face ? Math.atan2(d.face[1] - y, d.face[0] - x) : d.heading || 0;
      out.push(spawnNPC({ ...d, heading }));
    } catch (err) { console.error(`[npcs] could not place ${d.id}`, err); }
  }
  return out;
}

export { NAMED, BY_ID, TALK, Aborted, spawnNamedNPCs, say, ask, sayAll, chat, shopTalk, FIELD_C, FIELD_ANCHOR };
