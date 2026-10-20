import * as THREE from 'three';
import { $ } from '../core/context.js';
import { CX0, CX1, CY0, CY1, clsAt, hAt } from '../core/geo.js';
import { enterWalk, findOpen, mode, orbit, player } from './controls.js';

// ---------- mini map ----------
const mini = $('mini'), mctx = mini.getContext('2d');
let miniBase = null, mapOpen = true;
function makeMiniBase() {
  const c = document.createElement('canvas'); const S = 0.25; // px per metre
  c.width = Math.round((CX1 - CX0) * S); c.height = Math.round((CY1 - CY0) * S);
  const g = c.getContext('2d'), id = g.createImageData(c.width, c.height), d = id.data;
  const PAL = { 0: [232, 230, 220], 1: [150, 156, 166], 2: [196, 190, 178], 3: [214, 196, 150], 4: [170, 200, 140], 5: [200, 160, 120] };
  for (let y = 0; y < c.height; y++) for (let x = 0; x < c.width; x++) {
    const wx = CX0 + (x + 0.5) / S, wy = CY1 - (y + 0.5) / S; let col = PAL[clsAt(wx, wy)] || PAL[0];
    const h = hAt(wx, wy); const shade = 1 - Math.min(0.35, h / 110);
    const o = (y * c.width + x) * 4; d[o] = col[0] * shade; d[o + 1] = col[1] * shade; d[o + 2] = col[2] * shade; d[o + 3] = 255;
  }
  g.putImageData(id, 0, 0); miniBase = c;
}
function toggleMap() { mapOpen = !mapOpen; mini.hidden = !mapOpen; $('btn-map').setAttribute('aria-pressed', String(mapOpen)); }
$('btn-map').addEventListener('click', toggleMap);
function drawMini() {
  if (!miniBase || !mapOpen) return;
  const W = mini.width, H = mini.height, S = 0.25 * (mode === 'walk' ? 2.4 : 1);
  const cx = mode === 'walk' ? player.x : (orbit.target.x), cy = mode === 'walk' ? player.y : -orbit.target.z;
  mctx.save(); mctx.fillStyle = '#7c8f5f'; mctx.fillRect(0, 0, W, H);
  mctx.imageSmoothingEnabled = true;
  const k = S / 0.25;
  mctx.drawImage(miniBase, W / 2 - (cx - CX0) * S, H / 2 - (CY1 - cy) * S, miniBase.width * k, miniBase.height * k);
  // you-are-here marker
  mctx.translate(W / 2, H / 2);
  if (mode === 'walk') { mctx.rotate(-player.yaw); mctx.fillStyle = 'rgba(179,40,45,0.22)'; mctx.beginPath(); mctx.moveTo(0, 0); mctx.arc(0, 0, 38, -Math.PI / 2 - 0.55, -Math.PI / 2 + 0.55); mctx.fill(); }
  mctx.fillStyle = '#b3282d'; mctx.strokeStyle = '#fff'; mctx.lineWidth = 2;
  mctx.beginPath(); mctx.moveTo(0, -8); mctx.lineTo(6, 6); mctx.lineTo(0, 3); mctx.lineTo(-6, 6); mctx.closePath(); mctx.fill(); mctx.stroke();
  mctx.restore();
  mctx.fillStyle = 'rgba(29,34,29,.75)'; mctx.font = '600 10px system-ui, sans-serif'; mctx.fillText('N', W - 14, 14);
}
mini.addEventListener('click', e => { // click the map to jump there (walk mode)
  const r = mini.getBoundingClientRect(), S = 0.25 * (mode === 'walk' ? 2.4 : 1);
  const cx = mode === 'walk' ? player.x : orbit.target.x, cy = mode === 'walk' ? player.y : -orbit.target.z;
  const x = cx + ((e.clientX - r.left) * (mini.width / r.width) - mini.width / 2) / S, y = cy - ((e.clientY - r.top) * (mini.height / r.height) - mini.height / 2) / S;
  if (mode !== 'walk') enterWalk('field');
  [player.x, player.y] = findOpen(x, y);
});

export { makeMiniBase, toggleMap, drawMini, mini, mctx, miniBase, mapOpen };
