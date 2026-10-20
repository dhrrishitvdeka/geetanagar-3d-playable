import { isUIBlocking, setPrompt } from './hud.js';

// ---------- interaction registry ----------
// Static specs (fixed x, y) sit in a coarse grid so a scan only looks at the 3x3 cells around the player. Specs that move
// (pos() callbacks, e.g. NPCs) live in a short list that is polled instead. Focus is rescanned at ~14 Hz, and on demand when E is pressed.
const CELL = 24;                       // a spec with r <= CELL / 2 is always found from the 3x3 block around the player
const SPECS = new Map();               // id -> entry { spec, key }
const GRID = new Map();                // cell key -> Set of entries
const DYN = new Set();                 // entries with pos()
const WIDE = new Set();                // entries with a very large r: scanned every time
const cellKey = (x, y) => (Math.floor(x / CELL) + 512) * 1024 + (Math.floor(y / CELL) + 512);

function place(e) {
  const s = e.spec;
  if (e.key !== null && e.key !== undefined) { const set = GRID.get(e.key); if (set) { set.delete(e); if (!set.size) GRID.delete(e.key); } e.key = null; }
  DYN.delete(e); WIDE.delete(e);
  if (s.pos) DYN.add(e);
  else if (typeof s.x === 'number' && typeof s.y === 'number') {
    if ((s.r ?? 2) > CELL / 2) WIDE.add(e);
    else { e.key = cellKey(s.x, s.y); (GRID.get(e.key) || GRID.set(e.key, new Set()).get(e.key)).add(e); }
  }
}
function register(spec) {
  if (SPECS.has(spec.id)) unregister(spec.id);
  const e = { spec, key: null };
  SPECS.set(spec.id, e); place(e);
  return { id: spec.id, remove: () => { if (SPECS.get(spec.id) === e) unregister(spec.id); }, set: p => { Object.assign(spec, p); place(e); focusDirty = true; } };
}
function unregister(id) {
  const e = SPECS.get(id); if (!e) return;
  SPECS.delete(id);
  if (e.key !== null) { const set = GRID.get(e.key); if (set) { set.delete(e); if (!set.size) GRID.delete(e.key); } }
  DYN.delete(e); WIDE.delete(e);
  if (focus === e) { focus = null; focusDirty = true; }
}

// ---------- focus: best enabled spec in range, preferring what the player faces and higher priority ----------
let focus = null, focusDirty = true, lastScan = 0, lastPlayer = null, busy = false, cooldownUntil = 0, shown = null, best = null, bestScore = 0;
function consider(e, px, py, pz, hx, hy) {
  const s = e.spec; let x, y, z;
  if (s.pos) { const p = s.pos(); if (!p) return; x = p[0]; y = p[1]; z = p[2]; } else { x = s.x; y = s.y; z = s.z; }
  const r = s.r ?? 2, dx = x - px, dy = y - py, d2 = dx * dx + dy * dy;
  if (d2 > r * r) return;
  if (z !== undefined && z !== null && Math.abs(z - pz) >= 2.5) return;
  if (s.enabled) { let ok = true; try { ok = !!s.enabled(); } catch (err) { ok = false; } if (!ok) return; }
  const d = Math.sqrt(d2), dot = d > 0.4 ? (dx * hx + dy * hy) / d : 1;
  const score = (s.priority || 0) * 20 + dot * 1.5 - d;
  if (score > bestScore) { bestScore = score; best = e; }
}
function scan(player) {
  best = null; bestScore = -1e9;
  const px = player.x, py = player.y, pz = player.z || 0, hx = Math.cos(player.heading || 0), hy = Math.sin(player.heading || 0);
  const cx = Math.floor(px / CELL), cy = Math.floor(py / CELL);
  for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) {
    const set = GRID.get((cx + i + 512) * 1024 + (cy + j + 512)); if (!set) continue;
    for (const e of set) consider(e, px, py, pz, hx, hy);
  }
  for (const e of WIDE) consider(e, px, py, pz, hx, hy);
  for (const e of DYN) consider(e, px, py, pz, hx, hy);
  return best;
}
function labelOf(e) {
  const l = e.spec.label;
  try { return typeof l === 'function' ? l() : l; } catch (err) { return null; }
}
function show(text) {
  if (text === shown) return;
  shown = text; setPrompt(text || null);
}

function updateInteract(player) {
  lastPlayer = player;
  if (!player || player.riding || isUIBlocking()) { focus = null; show(null); return; }
  const t = performance.now();
  if (focusDirty || t - lastScan > 70) { lastScan = t; focusDirty = false; focus = scan(player); }
  show(focus ? labelOf(focus) : null);
}

function tryInteract() {
  if (busy || !lastPlayer || lastPlayer.riding || performance.now() < cooldownUntil) return false;
  const e = scan(lastPlayer); // fresh scan, in case things moved since the last tick
  if (!e) return false;
  focus = e; focusDirty = true;
  let out;
  try { out = e.spec.onInteract(); } catch (err) { console.error(`[interact] ${e.spec.id} failed`, err); return true; }
  if (out && typeof out.then === 'function') {
    busy = true;
    // stay busy until the promise settles, then a short cooldown so a second E press can't start another conversation or shop
    const done = () => { busy = false; cooldownUntil = performance.now() + 250; focusDirty = true; };
    out.then(done, err => { done(); console.error(`[interact] ${e.spec.id} failed`, err); });
  }
  return true;
}
function getFocused() { return focus ? focus.spec : null; }

export { register, unregister, updateInteract, tryInteract, getFocused };
