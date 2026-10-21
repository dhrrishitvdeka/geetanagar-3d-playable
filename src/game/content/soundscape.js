import { GEO, MANDIR } from '../../core/geo.js';
import { BLD } from '../../world/buildings.js';
import { addSoundSpot } from '../audio.js';
import { BY_ID } from './npcs.js';

// ---------- what Geetanagar sounds like, place by place and hour by hour ----------
// audio.js plays each of these when the listener is within reach and the hour is right. The houses are the town's own: a cooker
// whistle or a conch comes from a real building 15-70 m from wherever you stand.
//   mornings: devotees ringing the mandir bell, a conch for the morning puja in some houses, the school bells
//   midday: pressure cookers whistling in the kitchens as lunch goes on
//   evenings: naam-kirtan from the namghars (cymbals, khol, voices), and the conch at dusk (sondhiya) as the lamps are lit
//   all day: glasses and the kettle at Bina Baideu's tea stall
const CELL = 50, grid = new Map();
const key = (x, y) => Math.floor(x / CELL) * 4096 + Math.floor(y / CELL);
function nearHouse(lx, ly) { // a random house 15-70 m away, or null
  if (!grid.size) for (const b of BLD) { const k = key(b.c[0], b.c[1]); (grid.get(k) || grid.set(k, []).get(k)).push(b.c); }
  for (let tries = 0; tries < 10; tries++) {
    const cell = grid.get(key(lx + (Math.random() * 3 - 1.5) * CELL, ly + (Math.random() * 3 - 1.5) * CELL)); if (!cell) continue;
    const c = cell[Math.floor(Math.random() * cell.length)], d = Math.hypot(c[0] - lx, c[1] - ly);
    if (d > 15 && d < 70) return c;
  }
  return null;
}
const lm = t => { const l = GEO.labels.find(l => l.t === t); return l ? [l.x, l.y] : null; };

let inited = false;
function initSoundscape() {
  if (inited) return; inited = true;
  addSoundSpot({ at: nearHouse, r: 75, hours: [6.5, 7.4], every: [25, 50], sound: 'conch', vol: 0.4 });
  addSoundSpot({ at: nearHouse, r: 75, hours: [11.4, 13.4], every: [8, 22], sound: 'cooker', vol: 0.5 });
  addSoundSpot({ at: nearHouse, r: 75, hours: [17.0, 18.0], every: [9, 22], sound: 'conch', vol: 0.5 });
  const gate = [MANDIR.gx, MANDIR.stairTop];
  addSoundSpot({ x: gate[0], y: gate[1], r: 80, hours: [6.5, 9.0], every: [5, 14], sound: 'bell', vol: 0.45 });
  addSoundSpot({ x: gate[0], y: gate[1], r: 80, hours: [9.0, 18.0], every: [35, 90], sound: 'bell', vol: 0.4 });
  for (const t of ['Sarbojonin Namghar', 'Rajohua Namghar', 'Hatigarh Sarbojanin Namghar', 'Akanir Namghar']) {
    const p = lm(t); if (p) addSoundSpot({ x: p[0], y: p[1], r: 90, hours: [16.0, 18.0], every: [3.98, 4.02], sound: 'kirtan', vol: 0.3 }); // back to back: one bar after another
  }
  for (const t of ['Geetanagar High School', 'Geetanagar LP School', 'Kanya Mahavidyalaya']) {
    const p = lm(t); if (!p) continue;
    for (const h of [7.85, 10.9, 13.55]) addSoundSpot({ x: p[0], y: p[1], r: 120, hours: [h, h + 0.12], every: [900, 900], sound: 'schoolbell', vol: 0.5 }); // assembly, the break, home time
  }
  const bina = BY_ID.bina; if (bina) addSoundSpot({ x: bina.x, y: bina.y, r: 30, hours: [6.5, 18], every: [4, 11], sound: 'teastall', vol: 0.5 });
}

export { initSoundscape };
