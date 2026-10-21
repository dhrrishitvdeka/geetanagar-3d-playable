import * as THREE from 'three';
import { scene } from '../core/context.js';
import { VP, hAt } from '../core/geo.js';
import { mode, player } from '../ui/controls.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { rng } from '../core/geo.js';
import { canvasTex } from './materials.js';
import { footRaise } from './road/footpath.js';

// The View point is a paved hilltop terrace, not a raised deck. Visitor photos on its Google Maps page (2022-2023)
// show square grey floor tiles and a black iron railing with gold spear finials, looking south over red tin roofs
// to the city and the hills. Centre = the Maps place pin (26.1752971 N, 91.7907812 E).
const DECK = (() => {
  const cx = 78.0, cy = 199.1, w = 10, d = 7; // size estimated from the photos
  let g = -1e9; for (let x = cx - w / 2; x <= cx + w / 2; x += 1) for (let y = cy - d / 2; y <= cy + d / 2; y += 1) g = Math.max(g, hAt(x, y));
  return { cx, cy, w, d, top: g + 0.2 };
})();
const VP_EYE = DECK.top + 1.62;
function inDeck(x, y, pad = 0) { return Math.abs(x - DECK.cx) <= DECK.w / 2 + pad && Math.abs(y - DECK.cy) <= DECK.d / 2 + pad; }
function groundAt(x, y) { // terrain, plus the level terrace, plus raised footpaths, the mandir apron and the median
  return (inDeck(x, y) ? Math.max(hAt(x, y), DECK.top) : hAt(x, y)) + footRaise(x, y);
}
// sightline from the deck: anything in the southern wedge that rises above this gets kept low or cleared
function inViewWedge(x, y) {
  const dx = x - DECK.cx, dy = y - DECK.cy, dist = Math.hypot(dx, dy);
  if (dy > 2 || dist > 320) return null;
  const a = Math.atan2(dx, -dy); // 0 = due south
  return Math.abs(a) < 1.35 ? dist : null;
}
const sightTop = dist => VP_EYE - 1.6 - dist * 0.085;

function buildDeck() {
  const { cx, cy, w, d, top } = DECK;
  const tileTex = canvasTex(256, 256, (g, W, H) => { // 60 cm grey floor tiles with dark joints and wear
    const r = rng(41), n = 4, t = W / n;
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) { const v = 0.86 + r() * 0.12; g.fillStyle = `rgb(${190 * v},${184 * v},${172 * v})`; g.fillRect(i * t + 1, j * t + 1, t - 2, t - 2); }
    g.fillStyle = 'rgba(70,64,56,0.18)'; for (let k = 0; k < 30; k++) g.fillRect(r() * W, r() * H, 4 + r() * 20, 2 + r() * 8);
  });
  const floor = new THREE.Mesh(new THREE.BoxGeometry(w, 1, d), new THREE.MeshStandardMaterial({ map: tileTex, roughness: 0.8 }));
  // the terrace is levelled on the crest; a plastered retaining wall drops to the ground on the low (south) side
  const low = Math.min(hAt(cx - w / 2, cy - d / 2), hAt(cx + w / 2, cy - d / 2), hAt(cx, cy - d / 2)) - 0.3, depth = top - low;
  floor.scale.y = depth; floor.position.set(cx, top - depth / 2, -cy);
  const uv = floor.geometry.attributes.uv; for (let k = 0; k < uv.count; k++) uv.setXY(k, uv.getX(k) * w / 2.4, uv.getY(k) * d / 2.4);
  scene.add(floor);
  // black iron railing with gold spear finials on the posts, on the three open sides; open to the north (entry)
  const rail = [[cx - w / 2, cy + d / 2], [cx - w / 2, cy - d / 2], [cx + w / 2, cy - d / 2], [cx + w / 2, cy + d / 2]];
  const iron = new THREE.MeshStandardMaterial({ color: '#16181a', roughness: 0.5, metalness: 0.6 });
  const gold = new THREE.MeshStandardMaterial({ color: '#c9a03a', roughness: 0.35, metalness: 0.8 });
  const bars = [], posts = [], tips = [];
  for (let i = 1; i < rail.length; i++) {
    const a = rail[i - 1], b = rail[i], L = Math.hypot(b[0] - a[0], b[1] - a[1]), an = Math.atan2(b[1] - a[1], b[0] - a[0]);
    for (const hgt of [0.12, 1.0]) { const r = new THREE.BoxGeometry(L, 0.05, 0.05); r.rotateY(an); r.translate((a[0] + b[0]) / 2, top + hgt, -(a[1] + b[1]) / 2); bars.push(r); }
    const n = Math.round(L / 0.14);
    for (let k = 1; k < n; k++) { const t = k / n, v = new THREE.BoxGeometry(0.022, 0.88, 0.022); v.translate(a[0] + (b[0] - a[0]) * t, top + 0.56, -(a[1] + (b[1] - a[1]) * t)); bars.push(v); }
    const np = Math.max(1, Math.round(L / 2));
    for (let k = 0; k <= np; k++) {
      const t = k / np, x = a[0] + (b[0] - a[0]) * t, y = a[1] + (b[1] - a[1]) * t;
      const p = new THREE.BoxGeometry(0.07, 1.2, 0.07); p.translate(x, top + 0.6, -y); posts.push(p);
      const f = new THREE.ConeGeometry(0.05, 0.2, 6); f.translate(x, top + 1.3, -y); tips.push(f);
    }
    DECK_RAILS.push([a, b]);
  }
  for (const [geos, mat] of [[bars.concat(posts), iron], [tips, gold]]) { const m = new THREE.Mesh(mergeGeometries(geos, false), mat); m.castShadow = true; scene.add(m); }
  floor.castShadow = floor.receiveShadow = true;
}
const DECK_RAILS = [];
function deckBlocked(x, y, z) { // the railing stops you on the terrace; from below the retaining wall does
  if (z < DECK.top - 0.5) return inDeck(x, y);
  for (const [a, b] of DECK_RAILS) {
    const dx = b[0] - a[0], dy = b[1] - a[1], L2 = dx * dx + dy * dy || 1; let t = ((x - a[0]) * dx + (y - a[1]) * dy) / L2; t = Math.max(0, Math.min(1, t));
    if (Math.hypot(x - a[0] - dx * t, y - a[1] - dy * t) < 0.35) return true;
  }
  return false;
}

function nearDeck() { return mode === 'walk' && Math.hypot(player.x - DECK.cx, player.y - DECK.cy) < 30; }

export { inDeck, groundAt, inViewWedge, buildDeck, deckBlocked, nearDeck, DECK, VP_EYE, sightTop, DECK_RAILS };
