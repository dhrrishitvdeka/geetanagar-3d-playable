// ---------- tiny event bus shared by the game modules (see docs/game.md for the event list) ----------
const subs = new Map();
function on(type, fn) { (subs.get(type) || subs.set(type, new Set()).get(type)).add(fn); return () => off(type, fn); }
function off(type, fn) { const s = subs.get(type); if (s) s.delete(fn); }
function once(type, fn) { const u = on(type, p => { u(); fn(p); }); return u; }
function emit(type, payload) {
  const s = subs.get(type); if (!s) return;
  for (const fn of [...s]) { try { fn(payload); } catch (err) { console.error(`[bus] ${type} handler failed`, err); } }
}

export { on, off, once, emit };
