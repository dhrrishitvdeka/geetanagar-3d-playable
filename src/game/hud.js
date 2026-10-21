import './game.css';
import * as THREE from 'three';
import { $, camera, stage } from '../core/context.js';
import { groundAt } from '../world/deck.js';
import { QUALITY, saveQuality } from '../render/quality.js';
import { emit, on } from './core/bus.js';
import * as input from './input.js'; // namespace import: resetPresses only exists once the engine adds it
import { clockText, hasSave, save, saveSettings, state } from './core/state.js';
import { getPlayer } from './player.js';
import { getQuestLog } from './quests.js';
import { ITEMS, isWorn, useItem } from './items.js';
import { isFullMapOpen } from './map.js';
import { setVolume, sfx } from './audio.js';
import { getDelivery } from './worldobjects.js';

// ---------- Geetanagar game HUD: status, tracker, prompts, dialogue, shop, menus, toasts, markers, fades ----------
// Everything is plain DOM inside #hud (styles in game.css). Dynamic text always goes through textContent.

// ---------- helpers ----------
const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
const put = (parent, ...kids) => { for (const k of kids) if (k) parent.appendChild(k); return parent; };
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const rupee = n => '₹' + Math.round(n).toLocaleString('en-IN');
const click = () => { try { sfx('ui'); } catch (e) { /* audio not ready */ } };
const releaseLock = () => { try { if (document.pointerLockElement) document.exitPointerLock(); } catch (e) { /* not locked */ } };
const mapIsOpen = () => { try { return !!isFullMapOpen(); } catch (e) { return false; } };
function button(label, cls, fn) {
  const b = el('button', 'g-btn' + (cls ? ' ' + cls : ''), label); b.type = 'button';
  if (fn) b.addEventListener('click', () => { click(); fn(b); });
  return b;
}
const FOCUSABLE = 'button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), [tabindex]:not([tabindex="-1"])';
const pretty = id => String(id).replace(/[_-]+/g, ' ').replace(/^./, c => c.toUpperCase());

// ---------- module state ----------
let inited = false, started = false, app = null, root = null, W = 1, H = 1;
let statusEl, dayEl, clockEl, moneyEl, deltaEl, barEl, barFill, buffsEl, speedRow, speedName, speedVal, bagEl;
let trackerEl, trackerList, delivEl, promptEl, capEl, promptLabel, toastsEl, bigEl, bigTitle, bigSub, objEl, objArrow, objLabel;
let bubsEl, flashEl, fadeEl, touchEl, interactBtn;
let lastDay = -1, lastMin = -1, lastMoney = 0, moneyShown = 0, moneyTxt = -1, lastSt = -1, lastBag = -1, lastSpeed = -1, lastRiding = null;
let deltaAcc = 0, deltaAt = 0, buffTick = 0, delivAt = 0, delivTxt = '';
let lastUi = false, lastModal = false, lastPlay = false, wasMap = false;
const buffChips = new Map();
const tmp = new THREE.Vector3();

// ---------- build ----------
function initHUD() {
  if (inited) return;
  app = stage || $('app'); root = $('hud');
  if (!root || !app) return;
  inited = true;
  root.classList.add('g-root');

  // status card (top left)
  statusEl = el('section', 'g-card g-status'); statusEl.setAttribute('aria-label', 'Status');
  const r1 = el('div', 'g-row'); dayEl = el('span', 'g-day', 'Day 1'); clockEl = el('span', 'g-clock', '');
  put(r1, dayEl, clockEl);
  const r2 = el('div', 'g-row g-moneyrow'); moneyEl = el('span', 'g-money', rupee(0)); deltaEl = el('span', 'g-delta'); bagEl = el('span', 'g-bag', 'Bag 0');
  put(r2, moneyEl, deltaEl, bagEl);
  barEl = el('div', 'g-bar'); barEl.setAttribute('role', 'meter'); barEl.setAttribute('aria-label', 'Stamina'); barEl.setAttribute('aria-valuemin', '0'); barEl.setAttribute('aria-valuemax', '100'); barEl.setAttribute('aria-valuenow', '100');
  barFill = el('i'); barEl.appendChild(barFill);
  buffsEl = el('div', 'g-buffs');
  speedRow = el('div', 'g-row g-speedrow'); speedRow.hidden = true; speedName = el('span', 'g-speedname', 'Riding'); speedVal = el('span', 'g-speedval', '0 km/h'); put(speedRow, speedName, speedVal);
  put(statusEl, r1, r2, barEl, buffsEl, speedRow);

  // quest tracker (left, under the status card; the minimap owns the top right)
  trackerEl = el('section', 'g-card g-tracker'); trackerEl.setAttribute('aria-label', 'Quests'); trackerEl.hidden = true;
  trackerList = el('div', 'g-tlist'); delivEl = el('div', 'g-deliv'); delivEl.hidden = true;
  put(trackerEl, trackerList, delivEl);

  // prompt pill
  promptEl = el('div', 'g-prompt'); promptEl.hidden = true;
  capEl = el('button', 'g-cap', 'E'); capEl.type = 'button'; capEl.tabIndex = -1; capEl.setAttribute('aria-label', 'Interact');
  bindHold(capEl, 'interact');
  promptLabel = el('span', 'g-plabel');
  put(promptEl, capEl, promptLabel);

  toastsEl = el('div', 'g-toasts'); toastsEl.setAttribute('aria-live', 'polite'); toastsEl.setAttribute('role', 'status');
  bigEl = el('div', 'g-big'); bigEl.hidden = true; bigEl.setAttribute('role', 'status');
  bigTitle = el('h2'); bigSub = el('p'); put(bigEl, bigTitle, bigSub);

  // objective marker: 0x0 anchor moved by transform; dot, edge arrow and label hang off it
  objEl = el('div', 'g-obj'); objEl.hidden = true; objEl.setAttribute('aria-hidden', 'true');
  objArrow = el('i', 'g-obj-arrow'); objLabel = el('span', 'g-obj-label');
  put(objEl, objArrow, el('i', 'g-obj-dot'), objLabel);
  bubsEl = el('div', 'g-bubs'); bubsEl.setAttribute('aria-hidden', 'true');

  const cross = el('div', 'g-cross'); cross.setAttribute('aria-hidden', 'true');
  const bino = el('div', 'g-bino'); bino.setAttribute('aria-hidden', 'true');
  flashEl = el('div', 'g-flash'); fadeEl = el('div', 'g-fade');
  touchEl = buildTouch();

  const col = put(el('div', 'g-col'), statusEl, trackerEl);
  put(root, bino, cross, col, objEl, bubsEl, promptEl, touchEl, toastsEl, bigEl, flashEl, fadeEl);
  ensureLoading();

  const size = () => { W = stage.clientWidth || innerWidth; H = stage.clientHeight || innerHeight; };
  size(); addEventListener('resize', size);
  addEventListener('keydown', onKeyDown, true); // capture: while a modal is open the keys must not reach input.js

  // event wiring
  on('game:start', () => {
    // may fire more than once, after load()/newGame() replaced the state objects: drop every cache and redraw (no money delta)
    started = true; lastMoney = state.money; moneyShown = state.money; moneyTxt = -1; lastDay = -1; lastMin = -1; lastSt = -1; lastBag = -1; lastRiding = undefined;
    deltaAcc = 0; deltaEl.textContent = ''; for (const c of buffChips.values()) c.el.remove(); buffChips.clear();
    trackerSig = ''; delivAt = 0; delivTxt = '\0';
    if (pickedLook) { state.look = { ...(state.look || {}), ...pickedLook }; emit('ui:look', { look: state.look }); } // newGame() clears the look the title picked
    lastSpeed = -1;
  });
  on('place:discovered', ({ id, name }) => { if (id) placeNames[id] = name; refreshMenu(); });
  for (const t of ['inv:changed', 'quest:started', 'quest:updated', 'quest:completed', 'item:used', 'collectible:found']) on(t, refreshMenu);
}

// ---------- status card ----------
const BUFF_NAMES = { speed: 'Speed', stamina: 'Stamina' };
function showDelta(d, now) {
  if (!d) return;
  deltaAcc = now - deltaAt < 1400 ? deltaAcc + d : d; deltaAt = now;
  deltaEl.textContent = (deltaAcc > 0 ? '+' : '−') + rupee(Math.abs(deltaAcc));
  deltaEl.className = 'g-delta ' + (deltaAcc > 0 ? 'up' : 'down');
  try {
    for (const a of deltaEl.getAnimations()) a.cancel();
    deltaEl.animate([{ opacity: 0, transform: 'translateY(6px)' }, { opacity: 1, transform: 'none', offset: 0.14 }, { opacity: 1, offset: 0.72 }, { opacity: 0, transform: 'translateY(-4px)' }], { duration: 2000, fill: 'forwards' });
  } catch (e) { deltaEl.style.opacity = '1'; }
}
function updateStatus(dt, now) {
  const s = state;
  if (s.day !== lastDay) { lastDay = s.day; dayEl.textContent = 'Day ' + s.day; }
  const mn = Math.floor(s.time * 60);
  if (mn !== lastMin) { lastMin = mn; clockEl.textContent = clockText(s.time); }
  const m = s.money;
  if (m !== lastMoney) { showDelta(m - lastMoney, now); lastMoney = m; shopMoneyChanged(); }
  if (moneyShown !== m) {
    moneyShown += (m - moneyShown) * Math.min(1, dt * 9);
    if (Math.abs(m - moneyShown) < 0.5) moneyShown = m;
  }
  const r = Math.round(moneyShown);
  if (r !== moneyTxt) { moneyTxt = r; moneyEl.textContent = rupee(r); }
  const st = clamp(s.stamina == null ? 1 : s.stamina, 0, 1);
  if (Math.abs(st - lastSt) > 0.004) {
    lastSt = st; barFill.style.transform = 'scaleX(' + st.toFixed(3) + ')';
    barEl.classList.toggle('low', st < 0.25); barEl.classList.toggle('full', st > 0.99);
    barEl.setAttribute('aria-valuenow', String(Math.round(st * 100)));
  }
  // buffs
  buffTick++;
  for (const k in s.buffs) {
    const sec = Math.ceil(s.buffs[k]); if (!(sec > 0)) continue;
    let c = buffChips.get(k);
    if (!c) { c = { el: el('span', 'g-chip b-' + k), txt: el('b'), sec: -1, tick: 0 }; put(c.el, el('i'), el('span', null, BUFF_NAMES[k] || pretty(k)), c.txt); buffsEl.appendChild(c.el); buffChips.set(k, c); }
    c.tick = buffTick;
    if (c.sec !== sec) { c.sec = sec; c.txt.textContent = sec + 's'; }
  }
  if (buffChips.size) for (const [k, c] of buffChips) if (c.tick !== buffTick) { c.el.remove(); buffChips.delete(k); }
  let bag = 0; for (const k in s.inv) bag += s.inv[k];
  if (bag !== lastBag) { lastBag = bag; bagEl.textContent = 'Bag ' + bag; }
  // riding readout
  const p = getPlayer(), riding = p && p.riding ? (p.riding.kind || 'ride') : null;
  if (riding !== lastRiding) { lastRiding = riding; speedRow.hidden = !riding; if (riding) speedName.textContent = pretty(riding); lastSpeed = -1; }
  if (riding) { const v = Math.round(Math.abs(p.speed || 0) * 3.6); if (v !== lastSpeed) { lastSpeed = v; speedVal.textContent = v + ' km/h'; } }
  // delivery countdown (read from worldobjects so the tracker needs no extra calls)
  if (now - delivAt > 250) { delivAt = now; updateDelivery(); }
}
const mmss = sec => { sec = Math.max(0, Math.ceil(sec)); return Math.floor(sec / 60) + ':' + String(sec % 60).padStart(2, '0'); };
function updateDelivery() {
  let j = null; try { j = getDelivery(); } catch (e) { /* worldobjects not ready */ }
  const txt = j ? 'Delivery' + (j.label ? ': ' + j.label : '') + '  ' + mmss(j.timeLeft == null ? 0 : j.timeLeft) : '';
  if (txt === delivTxt) return;
  delivTxt = txt; delivEl.hidden = !txt; delivEl.textContent = txt;
  delivEl.classList.toggle('hurry', !!j && j.timeLeft != null && j.timeLeft < 30);
  trackerEl.hidden = !txt && !trackerList.firstChild;
}

// ---------- quest tracker ----------
let trackerSig = '';
function setQuestTracker(entries) {
  if (!inited) initHUD(); if (!inited) return;
  const list = Array.isArray(entries) ? entries.slice(0, 3) : [];
  const sig = JSON.stringify(list); if (sig === trackerSig) return; trackerSig = sig;
  trackerList.textContent = '';
  for (const e of list) {
    const sec = el('div', 'g-tq'); const head = el('h3', null, e.title || '');
    const t = e.timer != null ? e.timer : e.timeLeft != null ? e.timeLeft : e.countdown;
    if (t != null) head.appendChild(el('span', 'g-tt', typeof t === 'number' ? mmss(t) : String(t)));
    sec.appendChild(head);
    const ul = el('ul'); for (const st of (e.steps || [])) { const li = el('li', st.done ? 'done' : ''); put(li, el('i', null, st.done ? '✓' : '•'), el('span', null, st.text || '')); ul.appendChild(li); }
    sec.appendChild(ul); trackerList.appendChild(sec);
  }
  trackerEl.hidden = !list.length && delivEl.hidden;
}

// ---------- prompt ----------
let promptText = null, promptKey = 'E';
function setPrompt(text, key = 'E') {
  if (!inited) initHUD(); if (!inited) return;
  text = text == null || text === '' ? null : String(text); key = key || 'E';
  if (text === promptText && key === promptKey) return;
  promptText = text; promptKey = key;
  promptEl.hidden = text == null; interactBtn.classList.toggle('ready', text != null);
  if (text != null) { promptLabel.textContent = text; capEl.textContent = key; capEl.classList.toggle('long', key.length > 2); }
}

// ---------- toasts ----------
const toasts = []; const KINDS = ['info', 'good', 'warn', 'quest'];
function toast(text, opts = {}) {
  if (!inited) initHUD(); if (!inited) return;
  const kind = KINDS.includes(opts.kind) ? opts.kind : 'info', ms = opts.ms > 0 ? opts.ms : 3200; text = String(text == null ? '' : text);
  for (const t of toasts) if (t.text === text && t.kind === kind && !t.gone) { t.n++; t.badge.textContent = '×' + t.n; t.badge.hidden = false; clearTimeout(t.timer); t.timer = setTimeout(() => dropToast(t), ms); return; }
  const t = { text, kind, n: 1, gone: false, timer: 0, el: el('div', 'g-toast k-' + kind), badge: el('b', 'g-tn') };
  t.badge.hidden = true; put(t.el, el('i'), el('span', null, text), t.badge);
  toastsEl.appendChild(t.el); toasts.push(t);
  while (toasts.length > 4) dropToast(toasts.find(x => !x.gone) || toasts[0]);
  t.timer = setTimeout(() => dropToast(t), ms);
}
function dropToast(t) {
  if (t.gone) return; t.gone = true; clearTimeout(t.timer); t.el.classList.add('out');
  const i = toasts.indexOf(t); if (i >= 0) toasts.splice(i, 1);
  setTimeout(() => t.el.remove(), 260);
}

// ---------- big message, flash, fade, loading ----------
let bigAnim = null;
function bigMessage(title, sub, ms = 2600) {
  if (!inited) initHUD(); if (!inited) return;
  bigTitle.textContent = title == null ? '' : String(title); bigSub.textContent = sub || ''; bigSub.hidden = !sub; bigEl.hidden = false;
  try {
    if (bigAnim) bigAnim.cancel();
    bigAnim = bigEl.animate([{ opacity: 0, transform: 'translate(-50%, 10px) scale(.97)' }, { opacity: 1, transform: 'translate(-50%, 0) scale(1)', offset: 0.16 }, { opacity: 1, transform: 'translate(-50%, 0) scale(1)', offset: 0.78 }, { opacity: 0, transform: 'translate(-50%, -6px) scale(1)' }], { duration: ms, easing: 'ease-out' });
    const a = bigAnim; a.onfinish = () => { if (bigAnim === a) bigEl.hidden = true; };
  } catch (e) { setTimeout(() => { bigEl.hidden = true; }, ms); }
}
function flash(color = '#ffffff', ms = 300) {
  if (!inited) initHUD(); if (!inited) return;
  flashEl.style.background = color;
  try { flashEl.animate([{ opacity: 0.6 }, { opacity: 0 }], { duration: ms, easing: 'ease-out' }); } catch (e) { /* no animations */ }
}
function fade(toBlack, ms = 600) {
  if (!inited) initHUD(); if (!inited) return Promise.resolve();
  fadeEl.style.transition = 'opacity ' + ms + 'ms ease';
  fadeEl.style.opacity = toBlack ? '1' : '0';
  return new Promise(r => setTimeout(r, ms));
}
let loadingEl = null, loadingText = null, loadingTimer = 0;
function ensureLoading() {
  loadingEl = $('loading'); if (!loadingEl) return;
  if (loadingText) return;
  loadingEl.textContent = '';
  const wrap = el('div', 'ld-wrap');
  loadingText = el('p', 'ld-text'); loadingText.setAttribute('role', 'status');
  put(wrap, el('h1', 'ld-title', 'Geetanagar'), el('div', 'ld-sub', 'A walk-around game set in Guwahati'), el('div', 'ld-track', null), loadingText);
  wrap.querySelector('.ld-track').appendChild(el('i'));
  loadingEl.appendChild(wrap);
}
function setLoading(text) {
  if (!inited) initHUD();
  if (!loadingEl) ensureLoading();
  const e = loadingEl || $('loading'); if (!e) return;
  clearTimeout(loadingTimer);
  if (text == null) {
    e.classList.add('out'); loadingTimer = setTimeout(() => { e.hidden = true; }, 520);
  } else {
    e.hidden = false; e.classList.remove('out'); if (loadingText) loadingText.textContent = text; else e.textContent = text;
  }
}

// ---------- objective marker ----------
let obj = null, objH = 2, objHAt = -1e9, objKey = -1, objOff = null, objAng = 1e9, objX = -1e9, objY = -1e9, objShown = false;
function setObjectiveTarget(t) {
  if (!inited) initHUD(); if (!inited) return;
  if (!t || !isFinite(t.x) || !isFinite(t.y)) { obj = null; objEl.hidden = true; return; }
  obj = { x: t.x, y: t.y, label: t.label || '' }; objHAt = -1e9; objKey = -1; objOff = null; objEl.hidden = false; objEl.style.visibility = 'hidden'; objShown = false;
}
function updateObjective(p, now) {
  if (now - objHAt > 500) { objHAt = now; try { objH = groundAt(obj.x, obj.y) + 2; } catch (e) { objH = 2; } }
  const dist = Math.hypot(obj.x - p.x, obj.y - p.y), key = dist < 1000 ? Math.round(dist) : 100000 + Math.round(dist / 100);
  if (key !== objKey) { objKey = key; objLabel.textContent = (obj.label ? obj.label + ' · ' : '') + (dist < 1000 ? Math.round(dist) + ' m' : (dist / 1000).toFixed(1) + ' km'); }
  tmp.set(obj.x, objH, -obj.y).applyMatrix4(camera.matrixWorldInverse);
  const P = camera.projectionMatrix.elements, front = tmp.z < -0.05, z = -tmp.z;
  const cx = W / 2, cy = H / 2;
  let sx, sy, off;
  if (front) {
    sx = cx + tmp.x * P[0] / z * cx; sy = cy - tmp.y * P[5] / z * cy;
    off = sx < 40 || sx > W - 40 || sy < 60 || sy > H - 90;
  } else { sx = cx + tmp.x * 1000; sy = cy - tmp.y * 1000; off = true; }
  let ang = 0;
  if (off) {
    let dx = sx - cx, dy = sy - cy; if (!front && Math.abs(dx) < 1 && Math.abs(dy) < 1) dy = 1;
    const ex = W / 2 - 74, ey = H / 2 - 100, k = Math.min(ex / (Math.abs(dx) || 1e-6), ey / (Math.abs(dy) || 1e-6));
    const t = Math.min(k, 1e6); ang = Math.atan2(dy, dx);
    sx = cx + dx * t; sy = cy + dy * t;
  }
  if (off !== objOff) { objOff = off; objEl.classList.toggle('off', off); }
  if (off) { const deg = Math.round(ang * 57.2958); if (deg !== objAng) { objAng = deg; objArrow.style.transform = 'rotate(' + deg + 'deg) translateX(26px)'; } }
  const rx = Math.round(sx), ry = Math.round(sy);
  if (rx !== objX || ry !== objY) { objX = rx; objY = ry; objEl.style.transform = 'translate3d(' + rx + 'px,' + ry + 'px,0)'; }
  if (!objShown) { objShown = true; objEl.style.visibility = 'visible'; } // set once per target, not every frame
}

// ---------- speech bubbles ----------
const BUB_RANGE = 45, BUB_MAX = 8;
const bubs = new Map(), bubArr = [], bubScratch = [];
const byDist = (a, b) => a.d - b.d;
function bubble(key, getPos, text, ms = 3500) {
  if (!inited) initHUD(); if (!inited) return;
  if (!text || typeof getPos !== 'function') { removeBubble(key); return; }
  let b = bubs.get(key);
  if (!b) { b = { key, el: el('div', 'g-bub'), t: el('span'), getPos, until: 0, show: false, vis: false, d: 0, x: 0, y: 0, sx: -1e9, sy: -1e9, out: false }; b.el.appendChild(b.t); b.el.style.visibility = 'hidden'; bubsEl.appendChild(b.el); bubs.set(key, b); bubArr.push(b); }
  b.getPos = getPos; b.t.textContent = String(text).slice(0, 140); b.until = performance.now() + (ms > 0 ? ms : 3500);
  if (b.out) { b.out = false; b.el.classList.remove('out'); }
}
function removeBubble(key) {
  const b = bubs.get(key); if (!b) return; bubs.delete(key);
  const i = bubArr.indexOf(b); if (i >= 0) bubArr.splice(i, 1);
  b.el.remove();
}
function updateBubbles(now) {
  const m = camera.matrixWorldInverse, P = camera.projectionMatrix.elements, cx = W / 2, cy = H / 2;
  bubScratch.length = 0;
  for (let i = bubArr.length - 1; i >= 0; i--) {
    const b = bubArr[i];
    if (now >= b.until) { removeBubble(b.key); continue; }
    if (!b.out && b.until - now < 260) { b.out = true; b.el.classList.add('out'); }
    b.show = false;
    let pos = null; try { pos = b.getPos(); } catch (e) { pos = null; }
    if (!pos) continue;
    tmp.copy(pos).applyMatrix4(m);
    const z = -tmp.z, len = tmp.length();
    if (z < 0.3 || len > BUB_RANGE) continue;
    const sx = cx + tmp.x * P[0] / z * cx, sy = cy - tmp.y * P[5] / z * cy;
    if (sx < -60 || sx > W + 60 || sy < 20 || sy > H + 40) continue;
    b.x = sx; b.y = sy; b.d = len; bubScratch.push(b);
  }
  if (bubScratch.length > BUB_MAX) bubScratch.sort(byDist);
  const n = Math.min(bubScratch.length, BUB_MAX);
  for (let i = 0; i < n; i++) bubScratch[i].show = true;
  for (let i = 0; i < bubArr.length; i++) {
    const b = bubArr[i];
    if (b.show !== b.vis) { b.vis = b.show; b.el.style.visibility = b.show ? 'visible' : 'hidden'; } // cached: no style read per bubble per frame
    if (!b.show) continue;
    const rx = Math.round(b.x), ry = Math.round(b.y);
    if (rx !== b.sx || ry !== b.sy) { b.sx = rx; b.sy = ry; b.el.style.transform = 'translate3d(' + rx + 'px,' + ry + 'px,0) translate(-50%,-100%)'; }
  }
}

// ---------- touch buttons ----------
function bindHold(b, action) {
  let down = false;
  const set = d => { if (down === d) return; down = d; b.classList.toggle('on', d); emit('input:action', { action, down: d }); };
  b.addEventListener('pointerdown', e => { e.preventDefault(); try { b.setPointerCapture(e.pointerId); } catch (err) { /* synthetic pointer */ } set(true); });
  for (const t of ['pointerup', 'pointercancel', 'lostpointercapture']) b.addEventListener(t, () => set(false));
  b.addEventListener('click', e => { if (e.detail === 0) { set(true); setTimeout(() => set(false), 90); } }); // keyboard activation
}
function bindTap(b, action) {
  const tap = () => { emit('input:action', { action, down: true }); setTimeout(() => emit('input:action', { action, down: false }), 90); };
  b.addEventListener('pointerdown', e => { e.preventDefault(); tap(); });
  b.addEventListener('click', e => { if (e.detail === 0) tap(); });
}
function bindToggle(b, action) {
  let down = false;
  const flip = () => { down = !down; b.classList.toggle('on', down); b.setAttribute('aria-pressed', String(down)); emit('input:action', { action, down }); };
  b.setAttribute('aria-pressed', 'false');
  b.addEventListener('pointerdown', e => { e.preventDefault(); flip(); });
  b.addEventListener('click', e => { if (e.detail === 0) flip(); });
}
function buildTouch() {
  const wrap = el('div', 'g-touch'); wrap.setAttribute('role', 'group'); wrap.setAttribute('aria-label', 'Touch controls');
  const a = el('div', 'g-trow'), b = el('div', 'g-trow low');
  const mk = (row, action, label, size, bind, aria) => { const x = el('button', 'g-tb ' + size, label); x.type = 'button'; x.setAttribute('aria-label', aria); x.tabIndex = -1; bind(x, action); row.appendChild(x); return x; };
  mk(a, 'pause', 'Menu', 'sm', bindTap, 'Pause menu'); mk(a, 'map', 'Map', 'sm', bindTap, 'Map'); mk(a, 'photo', 'Photo', 'sm', bindTap, 'Take a photo'); mk(a, 'crouch', 'Crouch', 'sm', bindTap, 'Crouch (toggle)');
  mk(b, 'sprint', 'Run', 'md', bindToggle, 'Sprint (toggle)'); mk(b, 'jump', 'Jump', 'md', bindHold, 'Jump');
  interactBtn = mk(b, 'interact', 'E', 'lg', bindHold, 'Interact');
  return put(wrap, a, b);
}

// ---------- modal bookkeeping ----------
let wasModal = false, focusReturn = null;
function modalSync() {
  const open = !!(dlg || shop || menu);
  if (open && !wasModal) focusReturn = document.activeElement;
  if (!open && wasModal) {
    const t = focusReturn; focusReturn = null;
    if (t && t !== document.body && t.isConnected && typeof t.focus === 'function') t.focus({ preventScroll: true });
    else if (document.activeElement && document.activeElement !== document.body) document.activeElement.blur();
  }
  if (!open && wasModal) { try { if (typeof input.resetPresses === 'function') input.resetPresses(); } catch (e) { /* engine without resetPresses */ } }
  wasModal = open;
  syncBlocking();
}
function syncBlocking() {
  const mapOpen = mapIsOpen(), modal = !!(menu || shop) || mapOpen, ui = modal || !!dlg, play = started && menu !== 'title';
  if (mapOpen && !wasMap) releaseLock(); wasMap = mapOpen;
  if (ui !== lastUi) { lastUi = ui; app.classList.toggle('g-ui', ui); }
  if (modal !== lastModal) { lastModal = modal; app.classList.toggle('g-modal', modal); }
  if (play !== lastPlay) { lastPlay = play; app.classList.toggle('g-play', play); }
  return modal;
}
function focusInto(container, preferred) {
  const t = preferred || container.querySelector('[data-autofocus]') || container.querySelector(FOCUSABLE) || container;
  try { t.focus({ preventScroll: true }); } catch (e) { /* detached */ }
}
function isUIBlocking() { return !!(dlg || shop || menu || mapIsOpen()); }

// ---------- dialogue ----------
const CPS = 90, GUARD_MS = 200;
let dlg = null; const dlgQueue = [];
function showDialogue(req) {
  if (!inited) initHUD();
  return new Promise(resolve => {
    if (!inited) { resolve(null); return; }
    const item = { req: req || {}, resolve };
    if (dlg) dlgQueue.push(item); else openDialogue(item);
  });
}
function openDialogue(item) {
  const r = item.req, text = String(r.text == null ? '' : r.text);
  const choices = Array.isArray(r.choices) ? r.choices.filter(c => c && c.text != null) : [];
  const catcher = el('div', 'g-dlg-catch'), box = el('div', 'g-card g-dlg' + (choices.length ? ' has-choices' : ''));
  box.setAttribute('role', 'dialog'); box.setAttribute('aria-label', r.speaker ? 'Conversation with ' + r.speaker : 'Conversation'); box.tabIndex = -1;
  const head = el('div', 'g-dlg-head'); if (r.speaker) head.appendChild(el('b', null, r.speaker)); if (r.role) head.appendChild(el('span', null, r.role));
  const p = el('p', 'g-dlg-text'), shown = el('span'), rest = el('span', 'rest'); rest.textContent = text; put(p, shown, rest);
  const list = el('ol', 'g-choices'); const btns = [];
  choices.forEach((c, i) => {
    const li = el('li'), b = el('button', 'g-choice'); b.type = 'button'; b.disabled = !!c.disabled;
    put(b, el('span', 'n', String(i + 1)), el('span', 't', String(c.text)));
    b.addEventListener('mouseenter', () => { if (!b.disabled) setSel(i); });
    b.addEventListener('click', ev => { ev.stopPropagation(); if (dlg && dlg.item === item && guardOk()) pickChoice(i); });
    li.appendChild(b); list.appendChild(li); btns.push(b);
  });
  const hint = el('div', 'g-dlg-hint');
  if (choices.length) hint.innerHTML = '<span class="g-k">1–4 or ↑ ↓, then Enter</span><span class="g-t">Tap an answer</span>';
  else hint.innerHTML = '<span class="g-k"><kbd>E</kbd> or Enter to continue</span><span class="g-t">Tap to continue</span>';
  put(box, head, p, list, hint);
  box.addEventListener('click', () => { if (dlg && dlg.item === item && guardOk()) advance(); });
  catcher.addEventListener('click', () => { if (dlg && dlg.item === item && guardOk()) advance(); });
  put(root, catcher, box);
  dlg = { item, text, choices, btns, pos: 0, n: 0, typing: text.length > 0, t0: performance.now(), sel: -1, box, catcher, shown, rest };
  if (!dlg.typing) completeText();
  if (choices.length) releaseLock();
  modalSync(); focusInto(box, box);
}
const guardOk = () => dlg && performance.now() - dlg.t0 > GUARD_MS;
function setSel(i) {
  const d = dlg; if (!d) return; d.sel = i;
  d.btns.forEach((b, j) => b.classList.toggle('sel', j === i));
}
function completeText() {
  const d = dlg; if (!d) return;
  d.typing = false; d.n = d.text.length; d.shown.textContent = d.text; d.rest.textContent = ''; d.box.classList.add('done');
  if (d.choices.length) { const i = d.choices.findIndex(c => !c.disabled); setSel(i); }
}
function typeStep(dt) {
  const d = dlg; d.pos += dt * CPS;
  const n = Math.min(d.text.length, Math.floor(d.pos));
  if (n !== d.n) { d.n = n; d.shown.textContent = d.text.slice(0, n); d.rest.textContent = d.text.slice(n); }
  if (n >= d.text.length) completeText();
}
function advance() { // click, or an advance key, on the dialogue
  const d = dlg; if (!d) return;
  if (d.typing) { completeText(); return; }
  if (d.choices.length) { if (d.sel >= 0) pickChoice(d.sel); return; }
  endDialogue(null);
}
function pickChoice(i) {
  const d = dlg; if (!d || d.typing || !d.choices[i] || d.choices[i].disabled) return;
  click(); endDialogue(d.choices[i].value);
}
function closeDialogues() { // forced close: every pending line, queued or open, resolves with null
  const q = dlgQueue.splice(0), d = dlg; dlg = null;
  if (d) { d.box.remove(); d.catcher.remove(); d.item.resolve(null); }
  for (const it of q) it.resolve(null);
}
function closeModals() {
  if (!inited) return;
  closeDialogues(); closeShop();
  if (menu && menu !== 'title') showMenu(null);
  modalSync();
}
function endDialogue(value) {
  const d = dlg; if (!d) return; dlg = null;
  d.box.remove(); d.catcher.remove();
  d.item.resolve(value === undefined ? null : value);
  if (dlgQueue.length) openDialogue(dlgQueue.shift());
  modalSync();
}
function moveSel(step) {
  const d = dlg; if (!d || !d.choices.length || d.typing) return;
  let i = d.sel; for (let k = 0; k < d.choices.length; k++) { i = (i + step + d.choices.length) % d.choices.length; if (!d.choices[i].disabled) { setSel(i); return; } }
}
function dialogueKey(e) {
  const k = e.key || '', n = k.length === 1 && k >= '1' && k <= '9' ? +k : 0;
  const isAdv = k === 'Enter' || k === ' ' || k === 'e' || k === 'E' || k === 'f' || k === 'F';
  const isMove = k === 'ArrowUp' || k === 'ArrowDown' || k === 'w' || k === 'W' || k === 's' || k === 'S';
  if (!(isAdv || isMove || n || k === 'Tab')) return;
  e.preventDefault();
  if (e.repeat || !guardOk()) return; // the press that opened the dialogue must not also advance it
  if (isAdv) advance();
  else if (isMove) moveSel(k === 'ArrowUp' || k === 'w' || k === 'W' ? -1 : 1);
  else if (n) { const d = dlg; if (d.typing) completeText(); else if (n <= d.choices.length) pickChoice(n - 1); }
}

// ---------- shop ----------
let shop = null, shopMoneyEl = null;
function showShop(opts) {
  if (!inited) initHUD();
  return new Promise(resolve => {
    if (!inited) { resolve(); return; }
    if (shop) closeShop();
    openShop(opts || {}, resolve);
  });
}
function openShop(o, resolve) {
  const wrap = el('div', 'g-modal g-shopwrap'), card = el('div', 'g-card g-menucard m-shop');
  card.setAttribute('role', 'dialog'); card.setAttribute('aria-modal', 'true'); card.tabIndex = -1;
  const head = el('div', 'g-mhead'), titles = el('div'), h = el('h2', null, o.title || 'Shop'); h.id = 'g-shop-h'; card.setAttribute('aria-labelledby', 'g-shop-h');
  put(titles, h, o.subtitle ? el('p', 'g-sub', o.subtitle) : null);
  shopMoneyEl = el('b', 'g-wallet', rupee(state.money)); const wal = el('div', 'g-walletbox'); put(wal, el('span', null, 'You have'), shopMoneyEl);
  put(head, titles, wal);
  const list = el('ul', 'g-shoplist'), rows = [];
  for (const it of (o.items || [])) {
    const li = el('li', 'g-shoprow'), info = el('div', 'g-sinfo');
    const reason = el('span', 'g-reason'); reason.setAttribute('role', 'status');
    put(info, el('b', null, it.name || it.id), it.desc ? el('span', 'g-sdesc', it.desc) : null, reason);
    const price = el('span', 'g-price', rupee(it.price || 0)), buy = button('Buy', 'g-buybtn', () => doBuy(it, row));
    const row = { it, li, buy, reason, price };
    put(li, info, price, buy); list.appendChild(li); rows.push(row);
  }
  if (!rows.length) list.appendChild(el('li', 'g-empty', 'Nothing for sale right now.'));
  const foot = el('div', 'g-mfoot'); put(foot, el('span', 'g-esc', 'Esc to close'), button('Close', 'primary', () => closeShop()));
  put(card, head, list, foot); wrap.appendChild(card); root.appendChild(wrap);
  shop = { wrap, card, rows, resolve, busy: false, onBuy: o.onBuy };
  releaseLock(); shopMoneyChanged(); modalSync();
  focusInto(card, rows.length ? rows[0].buy : null);
}
function doBuy(it, row) {
  const s = shop; if (!s || s.busy) return;
  let r; try { r = s.onBuy ? s.onBuy(it.id) : undefined; } catch (e) { r = 'Could not buy that.'; console.error('[hud] onBuy failed', e); }
  const done = res => {
    if (shop !== s) return;
    if (typeof res === 'string' && res) { row.reason.textContent = res; row.buy.disabled = true; row.li.classList.add('blocked'); sfxSafe('error'); }
    else { row.reason.textContent = ''; row.buy.textContent = 'Bought ✓'; setTimeout(() => { if (shop === s) row.buy.textContent = 'Buy'; }, 900); }
  };
  if (r && typeof r.then === 'function') { s.busy = true; r.then(done, () => done('Could not buy that.')).finally(() => { s.busy = false; }); } else done(r);
}
const sfxSafe = n => { try { sfx(n); } catch (e) { /* audio not ready */ } };
function shopMoneyChanged() {
  if (!shop) return;
  if (shopMoneyEl) shopMoneyEl.textContent = rupee(state.money);
  for (const r of shop.rows) { // a changed wallet may fix the old reason, so let the player try again
    r.price.classList.toggle('short', (r.it.price || 0) > state.money);
    if (r.buy.disabled) { r.buy.disabled = false; r.reason.textContent = ''; r.li.classList.remove('blocked'); }
  }
}
function closeShop() {
  const s = shop; if (!s) return; shop = null; shopMoneyEl = null;
  s.wrap.remove(); s.resolve(); modalSync();
}

// ---------- menus ----------
const LOOKS = [
  { id: 'marigold', name: 'Marigold', skin: '#c68a5c', top: '#e0a526', gamosa: true },
  { id: 'brick', name: 'Brick', skin: '#8d5a3b', top: '#c0392b', gamosa: false },
  { id: 'river', name: 'River', skin: '#e0b08a', top: '#3f7cac', gamosa: true },
  { id: 'leaf', name: 'Leaf', skin: '#a8704a', top: '#4f6b45', gamosa: false },
  { id: 'ink', name: 'Ink', skin: '#6b4228', top: '#2f3a4a', gamosa: true },
  { id: 'lotus', name: 'Lotus', skin: '#f0c8a0', top: '#d96b8e', gamosa: false },
  // in a mekhela sador: muga gold with maroon, and ivory pat silk with green
  { id: 'muga', name: 'Muga', skin: '#b98058', top: '#8e1f2f', gamosa: false, mek: '#d6b25e', wear: { female: true, hairStyle: 'bun', topStyle: 'blouse', bottomStyle: 'mekhela', bottom: '#d6b25e', wrap: '#e2c57a', motif: '#a01e2c', bag: null } },
  { id: 'pat', name: 'Pat', skin: '#d9a37a', top: '#1f6a45', gamosa: false, mek: '#efe7d2', wear: { female: true, hairStyle: 'long', topStyle: 'blouse', bottomStyle: 'mekhela', bottom: '#efe7d2', wrap: '#f2ebd8', motif: '#b3202e', bag: null } },
];
// what a look without its own `wear` resets, so going back from a mekhela look gives the usual t-shirt and jeans
const PLAIN = { female: false, hairStyle: 'short', topStyle: 'tshirt', bottomStyle: 'pants', bottom: '#2c3e50', wrap: null, motif: null };
let pickedLook = null; const placeNames = {};
const lookIndex = () => { const l = pickedLook || state.look; return l ? LOOKS.findIndex(x => x.skin === l.skin && x.top === l.top && !!x.gamosa === !!l.gamosa) : -1; };
function pickLook(i) {
  const L = LOOKS[i]; pickedLook = { skin: L.skin, top: L.top, gamosa: L.gamosa, ...(L.wear || PLAIN) };
  state.look = { ...(state.look || {}), ...pickedLook }; emit('ui:look', { look: state.look });
}

let menu = null, menuParent = null, menuEl = null, menuCard = null, titleConfirm = false, menuRaf = 0;
const MAIN_MENUS = { title: 1, pause: 1 };
function getOpenMenu() { return menu; }
function showMenu(name) {
  if (!inited) initHUD(); if (!inited) return;
  name = name && RENDER[name] ? name : null;
  if (name && (dlg || dlgQueue.length || shop)) { closeDialogues(); closeShop(); }
  if (name === menu) { if (name) renderMenu(); return; }
  if (name && !MAIN_MENUS[name]) menuParent = MAIN_MENUS[menu] ? menu : menu ? menuParent : null; else menuParent = null;
  menu = name; titleConfirm = false;
  if (!name) { if (menuEl) { menuEl.remove(); menuEl = null; menuCard = null; } modalSync(); return; }
  releaseLock(); renderMenu(); modalSync();
}
function refreshMenu() {
  if (menu !== 'journal' && menu !== 'inventory') return;
  if (menuRaf) return; menuRaf = requestAnimationFrame(() => { menuRaf = 0; if (menu === 'journal' || menu === 'inventory') renderMenu(); });
}
function renderMenu() {
  if (!menu) return;
  const keep = document.activeElement && document.activeElement.dataset ? document.activeElement.dataset.fid : null;
  const same = menuCard && menuCard.dataset.name === menu, scroll = same ? menuCard.scrollTop : 0;
  if (!menuEl) { menuEl = el('div', 'g-modal g-menuwrap'); root.appendChild(menuEl); }
  menuEl.dataset.menu = menu; menuEl.textContent = '';
  menuCard = el('div', 'g-card g-menucard m-' + menu); menuCard.dataset.name = menu; menuCard.tabIndex = -1;
  menuCard.setAttribute('role', 'dialog'); menuCard.setAttribute('aria-modal', 'true'); menuCard.setAttribute('aria-labelledby', 'g-menu-h');
  if (same) menuCard.classList.add('again');
  menuEl.appendChild(menuCard);
  RENDER[menu](menuCard);
  menuCard.scrollTop = scroll;
  const f = keep ? menuCard.querySelector('[data-fid="' + keep + '"]') : null;
  focusInto(menuCard, f);
}
function head(card, title, sub, back) {
  const hd = el('div', 'g-mhead'), t = el('div'), h = el('h2', null, title); h.id = 'g-menu-h';
  put(t, h, sub ? el('p', 'g-sub', sub) : null); hd.appendChild(t);
  if (back) hd.appendChild(button('Back', 'ghost g-back', () => escMenu()));
  card.appendChild(hd); return hd;
}
function savePlayerNow() {
  if (!started) return false;
  try { const p = getPlayer(); state.player = { x: p.x, y: p.y, heading: p.heading }; } catch (e) { /* no player yet */ }
  return save();
}
function resumeGame() {
  emit('ui:resume', {});
  if (menu === 'pause') showMenu(null); // main normally closes it; this covers a missing listener
}
function escMenu() {
  if (!menu || menu === 'title') return;
  if (menu === 'pause') { resumeGame(); return; }
  showMenu(menuParent || null);
}

function renderTitle(card) {
  card.classList.add('wide');
  const saved = hasSave();
  put(card, el('div', 'g-kicker', 'Guwahati, Assam'), (() => { const h = el('h1', 'g-bigtitle', 'Geetanagar'); h.id = 'g-menu-h'; return h; })(), el('p', 'g-tag', 'A walk-around game set in Geetanagar, Guwahati'));
  const col = el('div', 'g-stack');
  if (titleConfirm) {
    put(col, el('p', 'g-warn', 'Start over? Your saved game will be replaced.'));
    const row = el('div', 'g-btnrow');
    put(row, button('Yes, start over', 'danger', () => emit('ui:start', { newGame: true })), button('Cancel', 'ghost', () => { titleConfirm = false; renderMenu(); }));
    row.lastChild.dataset.autofocus = '1'; col.appendChild(row);
  } else {
    if (saved) { const c = button('Continue', 'primary', () => emit('ui:start', { newGame: false })); c.dataset.autofocus = '1'; col.appendChild(c); }
    const n = button('New game', saved ? '' : 'primary', () => { if (hasSave()) { titleConfirm = true; renderMenu(); } else emit('ui:start', { newGame: true }); });
    if (!saved) n.dataset.autofocus = '1'; col.appendChild(n);
    put(col, button('How to play', '', () => showMenu('help')), button('Settings', '', () => showMenu('settings')));
    const a = el('a', 'g-btn link', 'Open the 3D explorer'); a.href = 'index.html'; col.appendChild(a);
  }
  card.appendChild(col);
  // look picker
  const box = el('fieldset', 'g-looks'); box.appendChild(el('legend', null, 'Your look'));
  const grid = el('div', 'g-lookgrid'); grid.setAttribute('role', 'radiogroup'); grid.setAttribute('aria-label', 'Your look');
  const cur = lookIndex();
  LOOKS.forEach((L, i) => {
    const b = el('button', 'g-look' + (i === cur ? ' on' : '')); b.type = 'button'; b.dataset.fid = 'look' + i;
    b.setAttribute('role', 'radio'); b.setAttribute('aria-checked', String(i === cur)); b.setAttribute('aria-label', L.name + (L.gamosa ? ', with gamosa' : ''));
    b.style.setProperty('--skin', L.skin); b.style.setProperty('--shirt', L.top);
    if (L.mek) b.style.setProperty('--mek', L.mek);
    const fig = el('span', 'lk'); put(fig, el('i', 'lk-head'), el('i', 'lk-body'), L.gamosa ? el('i', 'lk-gam') : null, L.mek ? el('i', 'lk-mek') : null);
    put(b, fig, el('span', 'lk-name', L.name));
    b.addEventListener('click', () => { click(); pickLook(i); renderMenu(); });
    grid.appendChild(b);
  });
  put(box, grid, el('p', 'g-note', pickedLook ? 'Saved for this game.' : saved ? 'Pick one, or keep the look from your saved game.' : 'Pick one to start with.'));
  card.appendChild(box);
}
function renderPause(card) {
  head(card, 'Paused', null, null);
  const col = el('div', 'g-stack');
  const r = button('Resume', 'primary', () => resumeGame()); r.dataset.autofocus = '1';
  put(col, r, button('Journal', '', () => showMenu('journal')), button('Inventory', '', () => showMenu('inventory')), button('Settings', '', () => showMenu('settings')), button('How to play', '', () => showMenu('help')),
    button('Save game', '', () => { const ok = savePlayerNow(); toast(ok ? 'Game saved' : 'Could not save here', { kind: ok ? 'good' : 'warn' }); }),
    button('Quit to title', 'ghost', () => { savePlayerNow(); location.reload(); }));
  card.appendChild(col);
}
function renderSettings(card) {
  head(card, 'Settings', null, 'back');
  const S = state.settings, form = el('div', 'g-form');
  const apply = () => emit('ui:settings', { settings: S });
  const range = (label, key, min, max, step, fmt, extra) => {
    const row = el('label', 'g-field'), out = el('output', null, fmt(S[key])), inp = el('input'); inp.type = 'range'; inp.min = min; inp.max = max; inp.step = step; inp.value = S[key];
    put(row, el('span', null, label), inp, out);
    inp.addEventListener('input', () => { S[key] = +inp.value; out.textContent = fmt(S[key]); if (extra) extra(S[key]); apply(); });
    inp.addEventListener('change', () => saveSettings());
    return row;
  };
  const check = (label, key) => {
    const row = el('label', 'g-field g-check'), inp = el('input'); inp.type = 'checkbox'; inp.checked = !!S[key];
    put(row, inp, el('span', null, label));
    inp.addEventListener('change', () => { S[key] = inp.checked; saveSettings(); apply(); });
    return row;
  };
  const first = range('Mouse sensitivity', 'sens', 0.3, 2.5, 0.05, v => v.toFixed(2) + '×'); first.querySelector('input').dataset.autofocus = '1';
  put(form, first, check('Invert Y axis', 'invertY'), range('Field of view', 'fov', 55, 95, 1, v => Math.round(v) + '°'),
    range('Volume', 'volume', 0, 1, 0.05, v => Math.round(v * 100) + '%', v => { try { setVolume(v); } catch (e) { /* audio not ready */ } }));
  const q = el('label', 'g-field g-select'), sel = el('select'); sel.setAttribute('aria-describedby', 'g-qnote');
  for (const v of ['low', 'medium', 'high']) { const o = el('option', null, pretty(v)); o.value = v; if (v === QUALITY) o.selected = true; sel.appendChild(o); }
  const go = button('Apply and reload', 'primary', () => { saveQuality(sel.value); savePlayerNow(); location.reload(); }); go.hidden = true;
  sel.addEventListener('change', () => { go.hidden = sel.value === QUALITY; });
  put(q, el('span', null, 'Graphics quality'), sel); form.appendChild(q);
  const note = el('p', 'g-note', 'Changing the graphics quality reloads the page (your progress is saved first).'); note.id = 'g-qnote';
  put(form, note, go);
  card.appendChild(form);
}
function renderHelp(card) {
  head(card, 'How to play', 'Walk around Geetanagar, talk to people, run errands and find the 24 gamosas.', 'back');
  const sec = (title, rows) => {
    const s = el('section', 'g-help'); s.appendChild(el('h3', null, title));
    const dl = el('dl'); for (const [k, v] of rows) { const dt = el('dt'); for (const part of k.split(' / ')) dt.appendChild(el('kbd', null, part)); put(dl, dt, el('dd', null, v)); }
    s.appendChild(dl); return s;
  };
  const touch = el('section', 'g-help'); touch.appendChild(el('h3', null, 'Touch'));
  const ul = el('ul'); for (const t of ['Left joystick: walk', 'Drag anywhere on the view: look around', 'E: talk, buy, pick up or ride (it lights up when something is near)', 'Jump, Run (tap to switch on or off), Crouch (tap to toggle), Photo, Map and Menu sit in the bottom-right']) ul.appendChild(el('li', null, t));
  touch.appendChild(ul);
  put(card, sec('Keyboard and mouse', [
    ['W A S D / Arrows', 'Walk'], ['Mouse', 'Look around (click the view first)'], ['Shift', 'Sprint'], ['C / Ctrl', 'Crouch (toggle, slow and quiet)'], ['Space', 'Jump'], ['E', 'Interact: talk, buy, pick up, ride'],
    ['M', 'Map'], ['J', 'Journal'], ['I', 'Inventory'], ['P', 'Take a photo'], ['V', 'First person'], ['Esc', 'Pause, or close what is open'],
  ]), touch);
  const ok = button('Got it', 'primary', () => escMenu()); ok.dataset.autofocus = '1'; card.appendChild(el('div', 'g-mfoot')).appendChild(ok);
}
const doneRe = /done|complete|finish/i, activeRe = /active|progress|start|running|current/i;
function renderJournal(card) {
  head(card, 'Journal', null, 'back');
  let log = []; try { log = getQuestLog() || []; } catch (e) { log = []; }
  const groups = [['Active', []], ['Leads', []], ['Completed', []]];
  for (const q of log) { const st = String(q.status || ''); (doneRe.test(st) ? groups[2][1] : activeRe.test(st) ? groups[0][1] : groups[1][1]).push(q); }
  const body = el('div', 'g-jbody');
  for (const [name, items] of groups) {
    if (!items.length && name !== 'Active') continue;
    const sec = el('section', 'g-jsec'); sec.appendChild(el('h3', null, name + (items.length ? ' (' + items.length + ')' : '')));
    if (!items.length) sec.appendChild(el('p', 'g-empty', 'Nothing yet. Talk to people around Geetanagar to pick up errands.'));
    for (const q of items) {
      const c = el('article', 'g-jq' + (name === 'Completed' ? ' done' : '')); c.appendChild(el('h4', null, q.title || q.id));
      if (q.desc) c.appendChild(el('p', null, q.desc));
      if (q.steps && q.steps.length) { const ul = el('ul'); for (const st of q.steps) { const li = el('li', st.done ? 'done' : ''); put(li, el('i', null, st.done ? '✓' : '•'), el('span', null, st.text)); ul.appendChild(li); } c.appendChild(ul); }
      sec.appendChild(c);
    }
    body.appendChild(sec);
  }
  const s = state.stats || {}, gam = state.collected.filter(id => /gamosa/i.test(id)).length || state.collected.length;
  const stats = el('section', 'g-jsec'); stats.appendChild(el('h3', null, 'Stats'));
  const grid = el('div', 'g-stats');
  for (const [k, v] of [['Walked', ((s.distance || 0) / 1000).toFixed(1) + ' km'], ['Goals', s.goals || 0], ['Deliveries', s.deliveries || 0], ['Photos', s.photos || 0], ['Gamosas found', Math.min(gam, 24) + ' / 24'], ['Places discovered', state.discovered.length]]) put(grid, put(el('div', 'g-stat'), el('b', null, String(v)), el('span', null, k)));
  stats.appendChild(grid);
  if (state.discovered.length) { const chips = el('div', 'g-places'); for (const id of state.discovered) chips.appendChild(el('span', null, placeNames[id] || pretty(id))); stats.appendChild(chips); }
  body.appendChild(stats); card.appendChild(body);
}
function renderInventory(card) {
  head(card, 'Inventory', null, 'back');
  const ids = Object.keys(state.inv).filter(id => state.inv[id] > 0);
  const list = el('ul', 'g-inv');
  if (!ids.length) list.appendChild(el('li', 'g-empty', 'Your pockets are empty. Buy something at a stall, or pick things up as you walk.'));
  for (const id of ids) {
    const it = ITEMS[id] || {}, li = el('li', 'g-invrow'), info = el('div', 'g-sinfo');
    put(info, el('b', null, it.name || pretty(id)), it.desc ? el('span', 'g-sdesc', it.desc) : null);
    put(li, info, el('span', 'g-qty', '×' + state.inv[id]));
    if (it.use || it.wear) { const u = button(it.wear ? (isWorn(id) ? 'Take off' : 'Wear') : 'Use', '', () => { try { useItem(id); } catch (e) { console.error('[hud] useItem failed', e); } renderMenu(); }); u.dataset.fid = 'use-' + id; li.appendChild(u); }
    list.appendChild(li);
  }
  const wallet = el('p', 'g-note', 'Cash: ' + rupee(state.money));
  put(card, list, wallet);
}
const RENDER = { title: renderTitle, pause: renderPause, settings: renderSettings, journal: renderJournal, inventory: renderInventory, help: renderHelp };

// ---------- keyboard ----------
function trapTab(e, container) {
  const f = container.querySelectorAll(FOCUSABLE), a = document.activeElement;
  if (!f.length) { e.preventDefault(); return; }
  const first = f[0], last = f[f.length - 1];
  if (!container.contains(a)) { e.preventDefault(); first.focus(); }
  else if (e.shiftKey && a === first) { e.preventDefault(); last.focus(); }
  else if (!e.shiftKey && a === last) { e.preventDefault(); first.focus(); }
}
const TOGGLE_KEYS = { KeyJ: 'journal', KeyI: 'inventory', KeyH: 'help' };
function onKeyDown(e) {
  if (!(shop || menu || dlg) || mapIsOpen() || e.ctrlKey || e.metaKey || e.altKey) return;
  e.stopPropagation(); // modal keys never reach input.js (no walking or double interact behind a menu)
  const k = e.key || '';
  if (k === 'Escape') { e.preventDefault(); if (e.repeat) return; if (shop) closeShop(); else if (menu) escMenu(); else if (dlg) endDialogue(null); return; }
  const card = shop ? shop.card : menu ? menuCard : null;
  if (card) {
    if (k === 'Tab') { if (!shop && menu === 'inventory') { e.preventDefault(); if (!e.repeat) escMenu(); } else trapTab(e, card); return; }
    const t = e.code && TOGGLE_KEYS[e.code];
    if (!shop && t && menu === t) { e.preventDefault(); if (!e.repeat) escMenu(); return; }
    if (!shop && t && !MAIN_MENUS[menu] && menu !== t && !e.repeat) { e.preventDefault(); showMenu(t); return; }
    if ((k === 'ArrowDown' || k === 'ArrowUp') && document.activeElement && document.activeElement.tagName === 'BUTTON' && card.contains(document.activeElement)) {
      e.preventDefault(); const f = [...card.querySelectorAll('button:not(:disabled), a[href]')], i = f.indexOf(document.activeElement);
      if (f.length) f[(i + (k === 'ArrowDown' ? 1 : -1) + f.length) % f.length].focus();
    }
    return;
  }
  if (dlg) dialogueKey(e);
}

// ---------- per frame ----------
function updateHUD(dt) {
  if (!inited) return;
  if (!(dt > 0)) dt = 0.016; else if (dt > 0.1) dt = 0.1;
  const now = performance.now(), modal = syncBlocking();
  if (started) updateStatus(dt, now);
  if (dlg && dlg.typing) typeStep(dt);
  if (modal) return;
  if (obj) { const p = getPlayer(); if (p) updateObjective(p, now); }
  if (bubArr.length) updateBubbles(now);
}

export { initHUD, updateHUD, closeModals, toast, setPrompt, showDialogue, isUIBlocking, showMenu, getOpenMenu, showShop, setQuestTracker, setObjectiveTarget, bubble, flash, fade, setLoading, bigMessage };
