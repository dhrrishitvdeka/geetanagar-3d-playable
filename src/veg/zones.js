import { QUALITY } from '../render/quality.js';
import { MANDIR, pointInPoly } from '../core/geo.js';
import { noiseAt } from './noise.js';

// ---------- vegetation zones shared by terrain painting, trees, palms and grass ----------
// Forest polygon on the ridge north of Mother Teresa Rd (hand-drawn, see NOTES.md)
const FOREST_POLY = [[16, -36], [200, -34], [232, 100], [205, 214], [-62, 214], [-62, 24], [16, 24]];
// the query point is shifted by up to 5 m of noise, so the forest line is ragged instead of a ruler-straight hand-drawn edge
function inForestPoly(x, y) { return pointInPoly(x + (noiseAt(1, x / 120, y / 120) - 0.5) * 10, y + (noiseAt(1, x / 120 + 0.5, y / 120 + 0.25) - 0.5) * 10, FOREST_POLY); }
// how forested a spot is, 0..1: the polygon, and the hills above ~4 m, which fade in over 3 m of height instead of switching at a line
function forestAmt(x, y, h) { if (inForestPoly(x, y)) return 1; const t = Math.max(0, Math.min(1, (h - 2.5) / 3)); return t * t * (3 - 2 * t); }
// keep the mandir stair, path and shrine free of trees and grass
function inMandirClear(x, y) { return x > MANDIR.x0 - 3 && x < MANDIR.x1 + 3 && y > MANDIR.stairFoot - 2 && y < MANDIR.stairTop + 4 || (Math.abs(x - MANDIR.gx) < 3.5 && y > MANDIR.stairTop && y < MANDIR.back + 6) || (Math.abs(x - MANDIR.gx) < 9 && Math.abs(y - (MANDIR.back - 1)) < 8); }
// asphalt the class raster misses: Railway Colony Rd running north from Hatigarh Chariali (streets session, docs/notes-streets.md)
const NO_VEG = [[-500, -488, -60, -26]];
function onUntracedRoad(x, y) { for (const [x0, x1, y0, y1] of NO_VEG) if (x > x0 && x < x1 && y > y0 && y < y1) return true; return false; }
// the quality preset decided before load (render/quality.js)
function quality() { return QUALITY; }

export { FOREST_POLY, inForestPoly, forestAmt, inMandirClear, onUntracedRoad, quality };
