import { MAINP, NRM, asphHalf, MED_H, medHalf, inMedGap, fpHeightAt, fpWidth, humpAt } from '../mainroad.js';

// footRaise(x, y): the height people stand at above the terrain on Mother Teresa Rd's footpaths, mandir apron and median;
// deck.js adds it to groundAt. The heights themselves are defined once in mainroad.js (fpHeightAt), next to the geometry.
// coarse grid of nearby main-road indices (MAINP is resampled every 2.5 m)
const G = 4, GRID = new Map();
MAINP.forEach((p, i) => { const cx = Math.floor(p[0] / G), cy = Math.floor(p[1] / G); for (let dx = -4; dx <= 4; dx++) for (let dy = -4; dy <= 4; dy++) { const k = (cx + dx) * 65536 + (cy + dy); (GRID.get(k) || GRID.set(k, []).get(k)).push(i); } });
// the median exists on a 2.5 m piece when both of its end samples do (buildMain drops the samples at crossings and U-turn gaps)
const medOn = k => k >= 0 && k < MAINP.length && medHalf(MAINP[k][0]) > 0 && !inMedGap(MAINP[k][0]);
export function footRaise(x, y) {
  const l = GRID.get(Math.floor(x / G) * 65536 + Math.floor(y / G)); if (!l) return 0;
  let bi = -1, bd = Infinity; for (const i of l) { const d = (MAINP[i][0] - x) ** 2 + (MAINP[i][1] - y) ** 2; if (d < bd) { bd = d; bi = i; } }
  const P = MAINP[bi], n = NRM[bi], lat = (x - P[0]) * n[0] + (y - P[1]) * n[1], d = Math.abs(lat), s = lat >= 0 ? 1 : -1;
  const f = bi + ((x - P[0]) * n[1] - (y - P[1]) * n[0]) / 2.5; // along = toward higher indices (eastward)
  if (d < medHalf(P[0])) { const j = Math.floor(f); return medOn(j) && medOn(j + 1) ? MED_H : 0; }
  const o = asphHalf(bi); if (d < o) return humpAt(f); // a speed breaker across the carriageways
  if (d > o + fpWidth(s, bi)) return 0;
  return fpHeightAt(s, f);
}
