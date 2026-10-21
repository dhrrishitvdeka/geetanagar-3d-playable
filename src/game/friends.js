import { BY_ID, ask, say } from './content/npcs.js';
import { on } from './core/bus.js';
import { addItem, removeItem, state } from './core/state.js';
import { sfx } from './audio.js';
import { toast } from './hud.js';
import { ITEMS } from './items.js';

// ---------- friendships: the people you talk to remember you ----------
// state.friends[id] = { p: points, day: last day you talked, gift: last day you gave them something, perk: last day they gave you
// something, name, title, likes: true once you know what they like }. Points come from the first chat of each day (+3), quests done
// for them (+8) and gifts they like (+6, or +10 for a favourite; one a day). The level (Stranger, Acquaintance, Friend, Close friend)
// changes how they greet you, in conversation and in passing; friends who keep a shop knock 10% off (20% for close friends), and a
// close friend sometimes gives you something on your first visit of the day.
const LEVELS = [{ at: 0, name: 'Stranger' }, { at: 6, name: 'Acquaintance' }, { at: 18, name: 'Friend' }, { at: 36, name: 'Close friend' }];
const levelOf = p => { let k = 0; LEVELS.forEach((L, i) => { if (p >= L.at) k = i; }); return k; };
// favourites first: [loved, ...liked]
const LIKES = {
  dadu: ['lal_sah', 'pitha', 'newspaper'], bina: ['marigold', 'cake'], nabin: ['pitha', 'jalebi'], purohit: ['marigold', 'banana'], jonali: ['cake', 'jalebi'],
  khagen: ['samosa', 'jalebi'], mamoni: ['cake', 'pitha'], rupa: ['banana', 'cake'], hari: ['lal_sah', 'samosa'], raju: ['lal_sah', 'samosa'], dipen: ['samosa', 'water'],
  bahadur: ['doodh_sah', 'biscuits'], kakati: ['newspaper', 'lal_sah'], anjali: ['cake', 'jalebi'], bhaiti: ['lal_sah', 'samosa'],
  rinku: ['jalebi', 'cake', 'biscuits'], moni: ['jalebi', 'cake', 'biscuits'], bablu: ['jalebi', 'cake', 'biscuits'],
};
const ROLE_LIKES = { elder: ['pitha', 'lal_sah'], kid: ['jalebi', 'cake'], student: ['cake', 'jalebi'] }, ANY_LIKES = ['pitha', 'lal_sah', 'samosa'];
const PERK = { bina: 'lal_sah', hari: 'banana', mamoni: 'biscuits', rupa: 'samosa', jonali: 'marigold', khagen: 'newspaper', dadu: 'pitha' };
// what each quest's people think of you for it
const QUEST_BONDS = { morning_sah: { dadu: 8, bina: 3 }, rongali_bihu: { nabin: 8, dadu: 4 }, puja_flowers: { purohit: 8, jonali: 3 }, scooter_errand: { khagen: 8, mamoni: 2 },
  lost_ball: { rinku: 8 }, football_match: { rinku: 6, moni: 4, bablu: 4 }, pori: { raju: 8 }, eyes_on_city: { kakati: 8 }, photo_walk: { anjali: 8 }, parcel_run: { dipen: 2 } };

const rec = n => { const f = state.friends || (state.friends = {}); return f[n.id] || (f[n.id] = { p: 0, day: 0, gift: 0, perk: 0, name: n.name, title: n.title || '' }); };
const likesOf = n => LIKES[n.id] || ROLE_LIKES[n.role] || ANY_LIKES;
const female = () => { const a = { ...(state.look || {}), ...(state.wear || {}) }; return !!a.female || /mekhela|sari|skirt/.test(a.bottomStyle || ''); };
// how they address you: the old call you bopai / aai (dear boy / dear girl), children call you Dada / Baideu (big brother / sister),
// everyone else dada / baideu, and a close friend says bondhu (friend)
function term(n, lvl) {
  if (n.role === 'elder' || n.role === 'priest') return female() ? 'aai' : 'bopai';
  if (n.role === 'kid') return female() ? 'Baideu' : 'Dada';
  return lvl >= 3 ? 'bondhu' : female() ? 'baideu' : 'dada';
}
function friendLevel(id) { const f = state.friends && state.friends[id]; return f ? levelOf(f.p) : 0; }
// add points; a new level gets a toast and a little chime
function bond(n, pts) {
  const r = rec(n), before = levelOf(r.p); r.p = Math.max(0, r.p + pts); const after = levelOf(r.p);
  if (after > before) { toast(after === 3 ? `${r.name} counts you as a close friend now.` : after === 2 ? `${r.name} counts you as a friend now.` : `${r.name} knows you now.`, { kind: 'good' }); sfx('pickup', { vol: 0.5 }); }
  return after;
}
// a greeting by how well they know you, or null for a stranger
function greetLine(n) {
  const lvl = friendLevel(n.id), t = term(n, lvl);
  if (lvl >= 3) return `There you are, ${t}! I was just thinking about you.`;
  if (lvl === 2) return `Ahok, ahok, ${t}! Good to see you again.`;
  if (lvl === 1) return `Oh, it is you again. Ki khobor, ${t}?`;
  return null;
}
// what someone you know calls out when you pass by (agents.js shows it as a speech bubble)
function passGreeting(n) {
  if (!n || (n.kind !== 'named' && n.kind !== 'resident')) return null;
  const lvl = friendLevel(n.id), t = term(n, lvl);
  return lvl >= 2 ? ['Ki khobor, ' + t + '!', 'Hoi, ' + t + '! Bhal ne?', 'Nomoskar, ' + t + '!'][Math.floor(Math.random() * 3)] : lvl === 1 ? 'Nomoskar, ' + t + '!' : null;
}
// items a quest still needs are never offered as gifts
function questNeeds() {
  const q = state.quests || {}, need = new Set(), act = id => q[id] && q[id].status === 'active';
  if (act('morning_sah')) need.add('lal_sah'); if (act('puja_flowers')) need.add('marigold'); if (act('rongali_bihu')) need.add('pitha');
  return need;
}
// called at the start of every conversation (npcs.js talk, the regulars' talk): the day's chat, a hello by how well they know you,
// a present from a close friend, and the chance to give them something they like
async function noteTalk(n) {
  const r = rec(n), today = state.day, first = r.day !== today; r.name = n.name; r.title = n.title || r.title;
  if (!first) return;
  r.day = today; const lvl0 = friendLevel(n.id), lvl = bond(n, 3);
  if (lvl0 >= 1 && n.kind !== 'resident') await say(n, greetLine(n)); // the regulars fold this into their own first line
  if (lvl >= 3 && r.perk !== today && PERK[n.id] && ITEMS[PERK[n.id]]) { r.perk = today; addItem(PERK[n.id]); await say(n, `Here, take a ${ITEMS[PERK[n.id]].name.toLowerCase()}. No, no, keep your money. For you, today it is free.`); }
  if (r.gift === today) return;
  const need = questNeeds(), likes = likesOf(n), held = likes.find(id => (state.inv[id] || 0) > 0 && !need.has(id));
  if (!held) return;
  const v = await ask(n, `${n.name.split(' ')[0]} looks at the ${ITEMS[held].name.toLowerCase()} in your bag.`, [{ text: `Give the ${ITEMS[held].name.toLowerCase()}`, value: 'give' }, { text: 'Not now', value: 'no' }]);
  if (v !== 'give' || !removeItem(held)) return;
  r.gift = today; r.likes = true; const loved = held === likes[0];
  bond(n, loved ? 10 : 6); sfx('pickup', { vol: 0.6 });
  await say(n, loved ? `For me? My favourite! You remembered. Dhanyabad, ${term(n, friendLevel(n.id))}.` : `Oh, how kind of you. Dhanyabad!`);
}
// shop discount from a seller who counts you as a friend
const discountFor = id => [0, 0, 0.1, 0.2][friendLevel(id)];
// for the journal: everyone you have talked to, best friends first
function peopleList() {
  const f = state.friends || {};
  return Object.entries(f).map(([id, r]) => ({ id, name: r.name, title: r.title, level: levelOf(r.p), label: LEVELS[levelOf(r.p)].name, p: r.p,
    next: LEVELS[levelOf(r.p) + 1] ? LEVELS[levelOf(r.p) + 1].at : null, likes: r.likes ? (LIKES[id] || []).map(i => ITEMS[i] && ITEMS[i].name).filter(Boolean) : null }))
    .sort((a, b) => b.p - a.p);
}
let inited = false;
function initFriends() {
  if (inited) return; inited = true;
  on('quest:completed', ({ id }) => { const b = QUEST_BONDS[id]; if (b) for (const who in b) { const d = BY_ID[who]; bond({ id: who, name: d ? d.name : who, title: d ? d.title : '' }, b[who]); } });
}

export { initFriends, noteTalk, greetLine, passGreeting, friendLevel, discountFor, peopleList, LEVELS };
