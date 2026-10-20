import * as THREE from 'three';
import { $, camera, labelLayer, stage } from '../core/context.js';
import { GEO, P, hAt } from '../core/geo.js';
import { mode } from './controls.js';
import { nearDeck } from '../world/deck.js';

// ---------- labels ----------
const labels = [];
for (const L of GEO.labels) {
  const e = document.createElement('div'); e.className = 'lbl ' + L.k; e.textContent = L.t; labelLayer.appendChild(e);
  labels.push({ e, pos: P(L.x, L.y, hAt(L.x, L.y) + (L.k === 'lm' || L.k === 'pin' ? 16 : 3)), k: L.k });
}
let showLabels = true;
const v3 = new THREE.Vector3();
function updateLabels() {
  const w = stage.clientWidth, h = stage.clientHeight, walk = mode === 'walk' && !nearDeck();
  for (const L of labels) {
    v3.copy(L.pos); if (walk) v3.y -= L.k === 'road' ? 0.5 : 8;
    const d = camera.position.distanceTo(v3);
    const maxD = walk ? (L.k === 'road' ? 70 : 160) : (L.k === 'road' ? 520 : 1800);
    v3.project(camera);
    const vis = showLabels && v3.z < 1 && d < maxD && Math.abs(v3.x) < 1.05 && Math.abs(v3.y) < 1.05;
    if (vis !== L.on) { L.e.style.visibility = vis ? 'visible' : 'hidden'; L.on = vis; }
    if (vis) L.e.style.transform = `translate(${((v3.x + 1) / 2 * w).toFixed(1)}px, ${((1 - v3.y) / 2 * h).toFixed(1)}px) translate(-50%, -50%)`;
  }
}

const setShowLabels = on => { showLabels = on; };

export { updateLabels, labels, showLabels, setShowLabels, v3 };
