import { MAINP } from '../mainroad.js';

// Nearest-vertex lookup on a 4 m grid, replacing the linear scans over the main road (nearestOnMain, trees' distMain).
// Exact: rings of grid cells are searched outwards from the query cell until nothing in the next ring can be closer.
// maxD (optional) bounds the search: it returns -1 when no vertex lies within maxD, so far-away queries stay cheap.
// Without maxD a miss within 60 rings falls back to the linear scan, so the answer is always the true nearest.
const G = 4, RMAX = 60, key = (i, j) => i * 65536 + j;
function gridNearest(P) {
  const grid = new Map();
  P.forEach((p, i) => { const k = key(Math.floor(p[0] / G), Math.floor(p[1] / G)); (grid.get(k) || grid.set(k, []).get(k)).push(i); });
  return function nearestIdx(x, y, maxD = Infinity) {
    const cx = Math.floor(x / G), cy = Math.floor(y / G), R = isFinite(maxD) ? Math.ceil(maxD / G) : RMAX; let best = Infinity, bi = -1;
    const scan = (i, j) => { const l = grid.get(key(i, j)); if (l) for (const k of l) { const d = (P[k][0] - x) ** 2 + (P[k][1] - y) ** 2; if (d < best) { best = d; bi = k; } } };
    for (let r = 0; r <= R; r++) {
      if (r === 0) scan(cx, cy);
      else { for (let dx = -r; dx <= r; dx++) { scan(cx + dx, cy - r); scan(cx + dx, cy + r); } for (let dy = -r + 1; dy < r; dy++) { scan(cx - r, cy + dy); scan(cx + r, cy + dy); } }
      if (bi >= 0 && best <= (r * G) ** 2) return isFinite(maxD) && best > maxD * maxD ? -1 : bi; // everything in a later ring is at least r * G away
    }
    if (isFinite(maxD)) return bi >= 0 && best <= maxD * maxD ? bi : -1;
    best = Infinity; bi = 0; for (let k = 0; k < P.length; k++) { const d = (P[k][0] - x) ** 2 + (P[k][1] - y) ** 2; if (d < best) { best = d; bi = k; } }
    return bi;
  };
}
// index into MAINP of the vertex nearest to (x, y)
const nearestMainIdx = gridNearest(MAINP);

export { gridNearest, nearestMainIdx };
