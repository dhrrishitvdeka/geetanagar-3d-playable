import { emit } from './bus.js';

// ---------- game state: money, inventory, quests, flags, clock; one save slot in localStorage ----------
const KEY = 'geet.game.v1', SKEY = 'geet.game.settings';
// 1 game hour = 2 real minutes; the playable day runs 6:30 am to 6 pm, then the next morning starts
const CLOCK = { DAY_START: 6.5, DAY_END: 18, MINUTES_PER_SECOND: 0.5 };
const DEFAULT_SETTINGS = { sens: 1, volume: 0.8, invertY: false, fov: 70 };

const fresh = () => ({
  money: 50, inv: {}, quests: {}, flags: {}, collected: [], discovered: [],
  stats: { distance: 0, goals: 0, deliveries: 0, photos: 0, talks: 0 },
  time: 7.0, day: 1, player: null, look: null,
});
function loadSettings() {
  try { return { ...DEFAULT_SETTINGS, ...JSON.parse(localStorage.getItem(SKEY) || '{}') }; } catch (e) { return { ...DEFAULT_SETTINGS }; }
}
const state = { ...fresh(), settings: loadSettings(), stamina: 1, buffs: {} };
const PERSIST = Object.keys(fresh());

// the look picked on the title screen survives a fresh start
function newGame() { const look = state.look; Object.assign(state, fresh()); state.look = look; state.stamina = 1; state.buffs = {}; dayEnded = false; }
function save() {
  try { const out = {}; for (const k of PERSIST) out[k] = state[k]; localStorage.setItem(KEY, JSON.stringify(out)); return true; } catch (e) { return false; }
}
function load() {
  try {
    const raw = localStorage.getItem(KEY); if (!raw) return false;
    const base = fresh(), saved = JSON.parse(raw);
    Object.assign(state, base, saved); state.stats = { ...base.stats, ...(saved.stats || {}) }; // saves from older builds may lack newer counters
    state.stamina = 1; state.buffs = {}; dayEnded = false;
    if (!(state.time >= CLOCK.DAY_START)) state.time = CLOCK.DAY_START;
    if (state.time >= CLOCK.DAY_END) nextDay(); // closed the tab during the night fade: start the next morning
    return true;
  } catch (e) { return false; }
}
function hasSave() { try { return !!localStorage.getItem(KEY); } catch (e) { return false; } }
function saveSettings() { try { localStorage.setItem(SKEY, JSON.stringify(state.settings)); } catch (e) { /* storage blocked */ } }

// ---------- money and inventory ----------
function addMoney(n, reason = '') { state.money = Math.max(0, Math.round(state.money + n)); emit('money:changed', { money: state.money, delta: n, reason }); }
function spend(n) {
  if (state.money < n) { emit('money:short', { need: n, have: state.money }); return false; }
  addMoney(-n, 'spend'); return true;
}
function itemCount(id) { return state.inv[id] || 0; }
function hasItem(id, qty = 1) { return itemCount(id) >= qty; }
function addItem(id, qty = 1) { state.inv[id] = itemCount(id) + qty; emit('inv:changed', { id, qty: state.inv[id], delta: qty }); }
function removeItem(id, qty = 1) {
  if (!hasItem(id, qty)) return false;
  state.inv[id] -= qty; if (state.inv[id] <= 0) delete state.inv[id];
  emit('inv:changed', { id, qty: itemCount(id), delta: -qty }); return true;
}

// ---------- flags, collectibles, places ----------
function setFlag(k, v = true) { state.flags[k] = v; }
function getFlag(k) { return state.flags[k]; }
function isCollected(id) { return state.collected.includes(id); }
function markCollected(id) { if (isCollected(id)) return false; state.collected.push(id); return true; }
function discover(id, name = id) {
  if (state.discovered.includes(id)) return false;
  state.discovered.push(id); emit('place:discovered', { id, name }); return true;
}

// ---------- clock ----------
let dayEnded = false;
function advanceClock(dt) {
  const h0 = Math.floor(state.time);
  state.time += dt * CLOCK.MINUTES_PER_SECOND / 60;
  if (Math.floor(state.time) !== h0) emit('clock:hour', { hour: Math.floor(state.time), day: state.day });
  if (!dayEnded && state.time >= CLOCK.DAY_END) { dayEnded = true; emit('day:end', { day: state.day }); }
}
function nextDay() { state.day += 1; state.time = CLOCK.DAY_START; dayEnded = false; }
function clockText(h = state.time) {
  const hh = Math.floor(h), mm = Math.floor((h - hh) * 60);
  return `${((hh + 11) % 12) + 1}:${String(mm).padStart(2, '0')} ${hh >= 12 ? 'pm' : 'am'}`;
}

export {
  state, CLOCK, newGame, save, load, hasSave, saveSettings, addMoney, spend, itemCount, hasItem, addItem, removeItem,
  setFlag, getFlag, isCollected, markCollected, discover, advanceClock, nextDay, clockText,
};
