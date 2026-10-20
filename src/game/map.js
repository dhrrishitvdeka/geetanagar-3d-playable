import { GEO, CX0, CX1, CY0, CY1 } from '../core/geo.js';
import { player as cam } from '../ui/controls.js';
import { miniBase } from '../ui/minimap.js';
import { emit } from './core/bus.js';
import { getPlayer } from './player.js';

// ---------- marker kinds ----------
// rim: markers that matter enough to stay visible as an arrow on the minimap edge when out of range
const KINDS = {
  quest: { c: '#e8b923', name: 'Quest', rim: true },
  shop: { c: '#1b998b', name: 'Shop' },
  npc: { c: '#3d7bd9', name: 'Person' },
  travel: { c: '#7b52c9', name: 'Travel' },
  collectible: { c: '#d9363e', name: 'Collectible' },
  poi: { c: '#8b918a', name: 'Place' },
  job: { c: '#ee7d1c', name: 'Job', rim: true },
};
const BG = '#7c8f5f', INK = 'rgba(20,24,20,.78)', PIN = '#d6336c';
const MINI_S = 0.6; // minimap px per metre (the base image is 0.25, so 2.4x)
const markers = new Map(), list = []; // list mirrors the map so the draw loop doesn't allocate iterators
let waypoint = null;
let inited = false;

function addMarker(id, o) {
  if (!o) return;
  id = String(id);
  // moving markers: keep a reference to the caller's object and read x/y from it each draw
  markers.set(id, { id, kind: KINDS[o.kind] ? o.kind : 'poi', src: o }); rebuild();
}
function removeMarker(id) { if (markers.delete(String(id))) rebuild(); }
function rebuild() { list.length = 0; for (const m of markers.values()) list.push(m); }
const mx = m => m.src.x, my = m => m.src.y;
const getWaypoint = () => (waypoint ? { x: waypoint.x, y: waypoint.y } : null);
function clearWaypoint(reached) { if (!waypoint) return; waypoint = null; fmDirty = true; if (reached) emit('waypoint:reached', {}); }

// ---------- shared drawing ----------
// draws the part of the base raster that lies within hw x hh metres of (cx, cy); origin of the current transform = (cx, cy)
function drawBase(g, cx, cy, S, hw, hh) {
  if (!miniBase) return;
  const x0 = Math.max(CX0, cx - hw), x1 = Math.min(CX1, cx + hw), y0 = Math.max(CY0, cy - hh), y1 = Math.min(CY1, cy + hh);
  if (x1 <= x0 || y1 <= y0) return;
  const B = miniBase.width / (CX1 - CX0);
  g.imageSmoothingEnabled = true;
  g.drawImage(miniBase, (x0 - CX0) * B, (CY1 - y1) * B, (x1 - x0) * B, (y1 - y0) * B, (x0 - cx) * S, (cy - y1) * S, (x1 - x0) * S, (y1 - y0) * S);
}
function shape(g, kind, r, color) {
  g.fillStyle = color || KINDS[kind].c; g.strokeStyle = INK; g.lineWidth = Math.max(1, r * 0.2); g.beginPath();
  if (kind === 'quest') { g.moveTo(0, -r * 1.3); g.lineTo(r * 1.05, 0); g.lineTo(0, r * 1.3); g.lineTo(-r * 1.05, 0); g.closePath(); }
  else if (kind === 'travel') g.rect(-r * 0.9, -r * 0.9, r * 1.8, r * 1.8);
  else if (kind === 'job') g.rect(-r * 1.0, -r * 0.75, r * 2, r * 1.5);
  else if (kind === 'collectible') { g.arc(0, 0, r * 0.85, 0, 6.2832); g.fillStyle = '#fff'; g.fill(); g.stroke(); g.beginPath(); g.arc(0, 0, r * 0.45, 0, 6.2832); g.fillStyle = color || KINDS.collectible.c; g.fill(); return; }
  else g.arc(0, 0, r * (kind === 'npc' ? 0.8 : kind === 'poi' ? 0.7 : 1), 0, 6.2832);
  g.fill(); g.stroke();
  if (kind === 'job') { g.beginPath(); g.moveTo(-r, -r * 0.1); g.lineTo(r, -r * 0.1); g.strokeStyle = 'rgba(255,255,255,.7)'; g.stroke(); }
}
function pin(g, r) { // teardrop with its tip at the origin
  g.beginPath(); g.moveTo(0, 0); g.lineTo(-r * 0.72, -r * 1.1); g.arc(0, -r * 1.8, r, Math.PI * 0.75, Math.PI * 2.25); g.closePath();
  g.fillStyle = PIN; g.strokeStyle = '#fff'; g.lineWidth = Math.max(1.2, r * 0.2); g.fill(); g.stroke();
  g.beginPath(); g.arc(0, -r * 1.8, r * 0.38, 0, 6.2832); g.fillStyle = '#fff'; g.fill();
}
function arrow(g, color) { g.beginPath(); g.moveTo(5.5, 0); g.lineTo(-4, -5); g.lineTo(-2, 0); g.lineTo(-4, 5); g.closePath(); g.fillStyle = color; g.strokeStyle = INK; g.lineWidth = 1; g.fill(); g.stroke(); }
function you(g, r) { // the player's arrow, pointing up
  g.beginPath(); g.moveTo(0, -r * 1.3); g.lineTo(r * 0.85, r); g.lineTo(0, r * 0.45); g.lineTo(-r * 0.85, r); g.closePath();
  g.fillStyle = '#b3282d'; g.strokeStyle = '#fff'; g.lineWidth = Math.max(1.5, r * 0.25); g.lineJoin = 'round'; g.fill(); g.stroke();
}

// ---------- minimap ----------
let mc, mg, msize = 170, dpr = 1, accum = 0;
function layoutMini() {
  dpr = Math.min(2, window.devicePixelRatio || 1);
  msize = innerWidth <= 640 || innerHeight <= 480 ? 120 : 170;
  mc.style.width = mc.style.height = msize + 'px'; mc.width = mc.height = Math.round(msize * dpr);
}
function drawMini() {
  const g = mg, R = msize / 2, S = MINI_S, p = getPlayer(), yaw = cam.yaw || 0;
  g.setTransform(dpr, 0, 0, dpr, 0, 0); g.fillStyle = BG; g.fillRect(0, 0, msize, msize);
  g.save(); g.translate(R, R); g.rotate(yaw); // camera forward points up
  drawBase(g, p.x, p.y, S, R / S, R / S);
  const lim = R - 5;
  for (let pass = 0; pass < 2; pass++) for (let i = 0; i < list.length; i++) {
    const m = list[i], K = KINDS[m.kind]; if (!!K.rim !== (pass === 1)) continue;
    const dx = (mx(m) - p.x) * S, dy = -(my(m) - p.y) * S; if (!(dx === dx && dy === dy)) continue;
    const d = Math.hypot(dx, dy);
    g.save();
    if (d <= lim) { g.translate(dx, dy); g.rotate(-yaw); shape(g, m.kind, 5, m.src.color); }
    else if (K.rim) { const a = Math.atan2(dy, dx); g.translate(Math.cos(a) * (R - 8), Math.sin(a) * (R - 8)); g.rotate(a); arrow(g, m.src.color || K.c); }
    g.restore();
  }
  if (waypoint) {
    const dx = (waypoint.x - p.x) * S, dy = -(waypoint.y - p.y) * S, d = Math.hypot(dx, dy); g.save();
    if (d <= lim) { g.translate(dx, dy); g.rotate(-yaw); pin(g, 4.5); }
    else { const a = Math.atan2(dy, dx); g.translate(Math.cos(a) * (R - 8), Math.sin(a) * (R - 8)); g.rotate(a); arrow(g, PIN); }
    g.restore();
  }
  g.restore();
  // view cone and the character's heading relative to the camera
  g.save(); g.translate(R, R);
  g.fillStyle = 'rgba(179,40,45,0.18)'; g.beginPath(); g.moveTo(0, 0); g.arc(0, 0, R * 0.42, -Math.PI / 2 - 0.55, -Math.PI / 2 + 0.55); g.fill();
  g.rotate(yaw + Math.PI / 2 - (p.heading || 0)); you(g, 6); g.restore();
  // north indicator, rotates with the map
  const nx = R + Math.sin(yaw) * (R - 11), ny = R - Math.cos(yaw) * (R - 11);
  g.beginPath(); g.arc(nx, ny, 8, 0, 6.2832); g.fillStyle = 'rgba(255,255,255,.92)'; g.fill();
  g.fillStyle = '#b3282d'; g.font = '700 10px system-ui, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('N', nx, ny + 0.5);
  g.lineWidth = 2; g.strokeStyle = 'rgba(255,255,255,.85)'; g.beginPath(); g.arc(R, R, R - 1, 0, 6.2832); g.stroke();
}

// ---------- full map ----------
let fm, fcv, fg, fw = 0, fh = 0, fopen = false, fmDirty = true, fmAcc = 0;
let vx = 0, vy = 0, vs = 0.5, minS = 0.2; const MAX_S = 1.8;
let hover = null, wpText = '', css = null; const ptrs = new Map(); let drag = null, pinch0 = 0, pinchS = 0;
const isOpen = () => fopen;
const isFullMapOpen = isOpen;
const wxOf = lx => vx + (lx - fw / 2) / vs, wyOf = ly => vy - (ly - fh / 2) / vs;
const sxOf = x => fw / 2 + (x - vx) * vs, syOf = y => fh / 2 - (y - vy) * vs;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
function clampView() { vs = clamp(vs, minS, MAX_S); vx = clamp(vx, CX0, CX1); vy = clamp(vy, CY0, CY1); }
function zoomAt(lx, ly, k) { const x = wxOf(lx), y = wyOf(ly); vs = clamp(vs * k, minS, MAX_S); vx = x - (lx - fw / 2) / vs; vy = y + (ly - fh / 2) / vs; clampView(); fmDirty = true; }
function sizeFull() {
  dpr = Math.min(2, window.devicePixelRatio || 1);
  fw = fcv.clientWidth; fh = fcv.clientHeight; fcv.width = Math.max(1, Math.round(fw * dpr)); fcv.height = Math.max(1, Math.round(fh * dpr));
  minS = Math.min(fw / (CX1 - CX0), fh / (CY1 - CY0)); clampView(); fmDirty = true;
}
function readTheme() {
  const cs = getComputedStyle(document.documentElement), v = n => cs.getPropertyValue(n).trim();
  css = { ink: v('--ink') || '#1d221d', panel: v('--panel') || 'rgba(248,249,244,.92)', accent: v('--accent') || '#b3282d', leaf: v('--leaf') || '#4f6b45' };
}
function toggleFullMap(force) {
  const want = typeof force === 'boolean' ? force : !fopen;
  if (!fm || want === fopen) return fopen;
  fopen = want; fm.hidden = !want;
  if (want) {
    try { document.exitPointerLock && document.exitPointerLock(); } catch (e) { /* not locked */ }
    readTheme(); sizeFull(); const p = getPlayer(); vx = p.x; vy = p.y; vs = clamp(0.55, minS, MAX_S); clampView(); hover = null; drag = null; ptrs.clear(); fmDirty = true; drawFull();
  } else if (fm.contains(document.activeElement)) document.activeElement.blur();
  return fopen;
}
const placed = [], widths = new Map();
function tw(g, text) { const k = g.font + text; let w = widths.get(k); if (w == null) { w = g.measureText(text).width; widths.set(k, w); } return w; }
function free(x0, y0, x1, y1) { for (let i = 0; i < placed.length; i += 4) if (x0 < placed[i + 2] && x1 > placed[i] && y0 < placed[i + 3] && y1 > placed[i + 1]) return false; placed.push(x0, y0, x1, y1); return true; }
function label(g, text, x, y, dot, bold) { // anchored right of (x, y); skipped if it would overlap an earlier label
  g.font = (bold ? '500 12px' : '400 11px') + ' "IBM Plex Sans", system-ui, sans-serif';
  const w = tw(g, text), ox = dot ? 9 : 0;
  if (x < -w || y < -10 || x > fw + 10 || y > fh + 10) return;
  if (!free(x - 3, y - 8, x + ox + w + 3, y + 8)) return;
  if (dot) { g.beginPath(); g.arc(x, y, 3.6, 0, 6.2832); g.fillStyle = dot; g.fill(); g.strokeStyle = '#fff'; g.lineWidth = 1; g.stroke(); }
  g.lineWidth = 3; g.lineJoin = 'round'; g.strokeStyle = 'rgba(255,255,255,.85)'; g.strokeText(text, x + ox, y); g.fillStyle = '#1d221d'; g.fillText(text, x + ox, y);
}
function drawFull() {
  const g = fg, p = getPlayer(); fmDirty = false;
  g.setTransform(dpr, 0, 0, dpr, 0, 0); g.fillStyle = BG; g.fillRect(0, 0, fw, fh);
  g.save(); g.translate(fw / 2, fh / 2); drawBase(g, vx, vy, vs, fw / 2 / vs, fh / 2 / vs); g.restore();
  g.textBaseline = 'middle'; g.textAlign = 'left'; placed.length = 0;
  for (const L of GEO.labels) if (L.k === 'lm' || L.k === 'pin') label(g, L.t, sxOf(L.x), syOf(L.y), L.k === 'pin' ? css.accent : css.leaf, true);
  if (vs >= 0.7) for (const L of GEO.labels) if (L.k === 'main' || L.k === 'road') label(g, L.t, sxOf(L.x), syOf(L.y), null, L.k === 'main');
  g.textAlign = 'center';
  if (waypoint) { // dashed guide from the player to the pin
    g.setLineDash([6, 5]); g.strokeStyle = PIN; g.lineWidth = 2; g.beginPath(); g.moveTo(sxOf(p.x), syOf(p.y)); g.lineTo(sxOf(waypoint.x), syOf(waypoint.y)); g.stroke(); g.setLineDash([]);
  }
  for (let pass = 0; pass < 2; pass++) for (let i = 0; i < list.length; i++) {
    const m = list[i], K = KINDS[m.kind]; if (!!K.rim !== (pass === 1)) continue;
    const x = sxOf(mx(m)), y = syOf(my(m)); if (x < -12 || y < -12 || x > fw + 12 || y > fh + 12) continue;
    g.save(); g.translate(x, y); shape(g, m.kind, m === hover ? 9 : 7, m.src.color); g.restore();
    if (K.rim && m.src.label) { g.font = '500 11px "IBM Plex Sans", system-ui, sans-serif'; g.textAlign = 'left'; g.lineWidth = 3; g.strokeStyle = 'rgba(255,255,255,.85)'; g.strokeText(m.src.label, x + 12, y); g.fillStyle = '#1d221d'; g.fillText(m.src.label, x + 12, y); }
  }
  if (waypoint) { g.save(); g.translate(sxOf(waypoint.x), syOf(waypoint.y)); pin(g, 8); g.restore(); }
  g.save(); g.translate(sxOf(p.x), syOf(p.y)); g.rotate(Math.PI / 2 - (p.heading || 0)); you(g, 9); g.restore();
  if (hover) { // hovered marker's name
    const x = sxOf(mx(hover)), y = syOf(my(hover)), t = hover.src.label || KINDS[hover.kind].name;
    g.font = '500 12px "IBM Plex Sans", system-ui, sans-serif'; g.textAlign = 'left'; const w = tw(g, t);
    g.fillStyle = 'rgba(25,30,24,.9)'; g.fillRect(x + 11, y - 22, w + 12, 20); g.fillStyle = '#fff'; g.fillText(t, x + 17, y - 12);
  }
  const txt = waypoint ? `Pin: ${Math.round(Math.hypot(waypoint.x - p.x, waypoint.y - p.y))} m away` : '';
  if (txt !== wpText) { wpText = txt; fm.querySelector('.fm-wp').textContent = txt; }
}
function pickMarker(lx, ly) {
  let best = null, bd = 13 * 13;
  for (let i = 0; i < list.length; i++) { const m = list[i], dx = sxOf(mx(m)) - lx, dy = syOf(my(m)) - ly, d = dx * dx + dy * dy; if (d < bd) { bd = d; best = m; } }
  return best;
}
function clickAt(lx, ly) { // pin or un-pin
  if (waypoint && Math.hypot(sxOf(waypoint.x) - lx, syOf(waypoint.y) - 14 - ly) < 16) { clearWaypoint(false); return; }
  const x = wxOf(lx), y = wyOf(ly); if (x < CX0 || x > CX1 || y < CY0 || y > CY1) return;
  waypoint = { x, y }; fmDirty = true;
}
function bindFull() {
  const loc = e => { const r = fcv.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
  fcv.addEventListener('pointerdown', e => {
    try { fcv.setPointerCapture(e.pointerId); } catch (err) { /* synthetic pointer */ }
    ptrs.set(e.pointerId, [e.clientX, e.clientY]);
    if (ptrs.size === 1) drag = { x: e.clientX, y: e.clientY, vx, vy, moved: false };
    else if (ptrs.size === 2) { const [a, b] = [...ptrs.values()]; pinch0 = Math.hypot(a[0] - b[0], a[1] - b[1]) || 1; pinchS = vs; if (drag) drag.moved = true; }
  });
  fcv.addEventListener('pointermove', e => {
    if (ptrs.has(e.pointerId)) ptrs.set(e.pointerId, [e.clientX, e.clientY]);
    if (ptrs.size === 2) { const [a, b] = [...ptrs.values()]; vs = clamp(pinchS * Math.hypot(a[0] - b[0], a[1] - b[1]) / pinch0, minS, MAX_S); clampView(); fmDirty = true; return; }
    if (drag && ptrs.size === 1) {
      const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
      if (!drag.moved && Math.hypot(dx, dy) > 5) drag.moved = true;
      if (drag.moved) { vx = drag.vx - dx / vs; vy = drag.vy + dy / vs; clampView(); fmDirty = true; fcv.style.cursor = 'grabbing'; }
    } else if (!ptrs.size) { const [lx, ly] = loc(e), h = pickMarker(lx, ly); if (h !== hover) { hover = h; fmDirty = true; } }
  });
  const up = e => {
    const was = ptrs.has(e.pointerId); ptrs.delete(e.pointerId); fcv.style.cursor = '';
    if (was && drag && !drag.moved && ptrs.size === 0 && e.type === 'pointerup') { const [lx, ly] = loc(e); clickAt(lx, ly); }
    if (!ptrs.size) drag = null;
  };
  fcv.addEventListener('pointerup', up); fcv.addEventListener('pointercancel', up);
  fcv.addEventListener('pointerleave', () => { if (hover) { hover = null; fmDirty = true; } });
  fcv.addEventListener('wheel', e => { e.preventDefault(); e.stopPropagation(); const [lx, ly] = loc(e); zoomAt(lx, ly, Math.exp(-e.deltaY * (e.deltaMode === 1 ? 0.05 : 0.0015))); }, { passive: false });
  fm.addEventListener('click', e => {
    const b = e.target.closest && e.target.closest('button[data-a]'); if (!b) return; const a = b.dataset.a;
    if (a === 'in') zoomAt(fw / 2, fh / 2, 1.4); else if (a === 'out') zoomAt(fw / 2, fh / 2, 1 / 1.4);
    else if (a === 'me') { const p = getPlayer(); vx = p.x; vy = p.y; clampView(); fmDirty = true; }
    else if (a === 'clear') clearWaypoint(false);
    else if (a === 'close') toggleFullMap(false);
  });
  // capture phase so the game's own key handler never sees M / Esc while the map is open (else it would reopen or pause)
  addEventListener('keydown', e => {
    if (!fopen) return;
    if (e.code === 'KeyM' || e.code === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); if (!e.repeat) toggleFullMap(false); }
    else if (e.key === '+' || e.key === '=' || e.code === 'NumpadAdd') { e.stopImmediatePropagation(); zoomAt(fw / 2, fh / 2, 1.4); }
    else if (e.key === '-' || e.key === '_' || e.code === 'NumpadSubtract') { e.stopImmediatePropagation(); zoomAt(fw / 2, fh / 2, 1 / 1.4); }
  }, true);
  addEventListener('resize', () => { layoutMini(); if (fopen) sizeFull(); });
}

// ---------- setup ----------
const STYLE = `
#minimap { position: absolute; top: calc(12px + env(safe-area-inset-top, 0px)); right: max(16px, env(safe-area-inset-right, 0px)); border-radius: 50%; border: 2px solid var(--panel); box-shadow: 0 0 0 1px var(--line), 0 2px 10px rgba(0,0,0,.28); background: ${BG}; cursor: pointer; pointer-events: auto; touch-action: manipulation; z-index: 4; }
#fullmap { position: fixed; inset: 0; z-index: 70; background: rgba(10,14,10,.55); display: flex; align-items: center; justify-content: center; padding: max(20px, env(safe-area-inset-top, 0px)) max(20px, env(safe-area-inset-right, 0px)) max(20px, env(safe-area-inset-bottom, 0px)) max(20px, env(safe-area-inset-left, 0px)); font-family: var(--body); color: var(--ink); pointer-events: auto; }
#fullmap .fm-panel { position: relative; width: 100%; height: 100%; max-width: 1500px; border-radius: 12px; overflow: hidden; border: 1px solid var(--line); background: var(--bg); box-shadow: 0 8px 40px rgba(0,0,0,.4); }
#fullmap .fm-cv { position: absolute; inset: 0; width: 100%; height: 100%; display: block; cursor: grab; touch-action: none; }
#fullmap .fm-bar { position: absolute; top: 10px; left: 10px; right: 10px; display: flex; align-items: center; gap: 8px; pointer-events: none; }
#fullmap .fm-bar > * { pointer-events: auto; }
#fullmap .fm-title { background: var(--panel); border: 1px solid var(--line); border-radius: 8px; padding: 5px 12px; font-family: var(--display); font-weight: 700; font-size: 17px; letter-spacing: -0.01em; }
#fullmap .fm-wp { color: var(--ink); background: var(--panel); border-radius: 8px; padding: 0 8px; font-family: var(--mono); font-size: 12px; pointer-events: none; }
#fullmap .fm-wp:empty { display: none; }
#fullmap .fm-sp { flex: 1; pointer-events: none; }
#fullmap button { background: var(--panel); border: 1px solid var(--line); border-radius: 8px; color: var(--ink); padding: 6px 12px; min-width: 38px; font: 500 14px var(--body); cursor: pointer; }
#fullmap button:hover { background: var(--bg); }
#fullmap button:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
#fullmap .fm-legend { position: absolute; left: 10px; bottom: 10px; max-width: calc(100% - 20px); display: flex; flex-wrap: wrap; gap: 4px 14px; align-items: center; background: var(--panel); border: 1px solid var(--line); border-radius: 8px; padding: 7px 12px; font-size: 12px; pointer-events: none; }
#fullmap .fm-legend span { display: inline-flex; align-items: center; gap: 6px; white-space: nowrap; }
#fullmap .fm-sw { width: 12px; height: 12px; display: inline-block; border: 1px solid rgba(20,24,20,.7); box-sizing: border-box; }
#fullmap .fm-sw.diamond { transform: rotate(45deg) scale(.85); }
#fullmap .fm-sw.circle { border-radius: 50%; }
#fullmap .fm-sw.box { width: 14px; height: 10px; }
#fullmap .fm-hint { position: absolute; right: 10px; bottom: 10px; background: var(--panel); border: 1px solid var(--line); border-radius: 8px; padding: 6px 12px; font-size: 12px; color: var(--mute); pointer-events: none; max-width: 360px; }
@media (max-width: 640px) {
  #fullmap { padding: 6px; } #fullmap .fm-hint { display: none; } #fullmap .fm-title { font-size: 15px; padding: 4px 9px; } #fullmap .fm-legend { gap: 2px 10px; font-size: 11px; padding: 5px 9px; }
}`;
const SW = { quest: 'diamond', shop: 'circle', npc: 'circle', travel: '', collectible: 'circle', poi: 'circle', job: 'box' };
function initMap() {
  if (inited) return; inited = true;
  const root = document.getElementById('hud') || document.body;
  const st = document.createElement('style'); st.id = 'map-style'; st.textContent = STYLE; document.head.appendChild(st);
  mc = document.createElement('canvas'); mc.id = 'minimap'; mc.setAttribute('role', 'button'); mc.setAttribute('aria-label', 'Minimap. Click to open the full map.');
  mg = mc.getContext('2d'); layoutMini(); root.appendChild(mc);
  mc.addEventListener('click', () => toggleFullMap(true));
  const legend = Object.entries(KINDS).map(([k, v]) => `<span><i class="fm-sw ${SW[k]}" style="background:${v.c}"></i>${v.name}</span>`).join('');
  fm = document.createElement('div'); fm.id = 'fullmap'; fm.hidden = true; fm.setAttribute('role', 'dialog'); fm.setAttribute('aria-label', 'Map of Geetanagar');
  fm.innerHTML = `<div class="fm-panel"><canvas class="fm-cv"></canvas>
    <div class="fm-bar"><div class="fm-title">Geetanagar</div><div class="fm-wp"></div><div class="fm-sp"></div>
      <button type="button" data-a="clear" title="Remove the pin">Clear pin</button><button type="button" data-a="me" title="Centre on you">Me</button>
      <button type="button" data-a="in" aria-label="Zoom in">+</button><button type="button" data-a="out" aria-label="Zoom out">&minus;</button><button type="button" data-a="close" aria-label="Close map">&times;</button></div>
    <div class="fm-legend">${legend}<span><i class="fm-sw circle" style="background:#b3282d"></i>You</span><span><i class="fm-sw circle" style="background:${PIN}"></i>Pin</span></div>
    <div class="fm-hint">Drag to move, scroll to zoom, click to drop a pin (click it again to remove). M or Esc closes.</div></div>`;
  root.appendChild(fm); fcv = fm.querySelector('.fm-cv'); fg = fcv.getContext('2d'); bindFull();
}

function updateMap(dt) {
  if (!mc) return;
  if (waypoint) { const p = getPlayer(); if (Math.hypot(waypoint.x - p.x, waypoint.y - p.y) < 8) clearWaypoint(true); }
  fmAcc += dt;
  if (fopen) { if (fmDirty || fmAcc >= 1 / 15) { fmAcc = 0; drawFull(); } return; }
  if (fmAcc < 1 / 30) return; fmAcc = 0; // ~30 fps
  if (document.hidden || mc.offsetParent === null) return; // HUD hidden (title menu etc.)
  drawMini();
}

export { initMap, updateMap, addMarker, removeMarker, toggleFullMap, isFullMapOpen, getWaypoint };
