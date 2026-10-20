import * as THREE from 'three';
import { $, camera, renderer, scene, stage } from './core/context.js';
import { GEO } from './core/geo.js';
import { CENTER, enterOrbit, enterWalk, findOpen, mode, orbit, player, stepWalk } from './ui/controls.js';
import { setShowLabels, updateLabels } from './ui/labels.js';
import { drawMini, makeMiniBase, mini } from './ui/minimap.js';
import { loadAssets } from './veg/assets.js';
import { buildFlowersAndRocks, buildGrass, updateGrass } from './veg/grass.js';
import { buildTreeMeshes, collectTrees, updateNearTrees } from './veg/trees.js';
import { buildAll } from './world/buildings.js';
import { DECK, buildDeck, nearDeck } from './world/deck.js';
import { applySun, placeShadow } from './world/lighting.js';
import { refreshEnv, setFogDensity } from './world/sky.js';
import { renderFrame, resizePost, setQuality } from './render/post.js';
import { QUALITY, saveQuality, fogFor } from './render/quality.js';
import { mergeStatic } from './render/staticmerge.js';
import { buildMandir } from './world/mandir.js';
import { buildOuter } from './world/outer.js';
import { buildKiosks } from './world/shops.js';
import { buildHatigarh, buildPoles, buildTraffic } from './world/streetlife.js';
import { buildStreets } from './world/streets.js';
import { buildCompoundWalls } from './world/compound.js';
import { applyGroundTextures, paintGround } from './world/terrain.js';

// ---------- UI ----------
$('btn-walk').addEventListener('click', () => enterWalk($('spot').value));
$('btn-orbit').addEventListener('click', enterOrbit);
$('spot').addEventListener('change', e => enterWalk(e.target.value));
// the preset also sizes geometry and textures at load, so a change is saved and the page reloads
$('quality').value = QUALITY;
$('quality').addEventListener('change', e => { saveQuality(e.target.value); location.reload(); });
setQuality(QUALITY);
$('tog-labels').addEventListener('change', e => { setShowLabels(e.target.checked); });
const clock = $('clock');
const fmt = h => { const hh = Math.floor(h), mm = Math.round((h - hh) * 60); return `${((hh + 11) % 12) + 1}:${String(mm).padStart(2, '0')} ${hh >= 12 ? 'pm' : 'am'}`; };
$('sun').addEventListener('input', e => { const h = parseFloat(e.target.value); applySun(h); clock.textContent = fmt(h); });

function resize() {
  const w = stage.clientWidth, h = stage.clientHeight; renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix();
  resizePost(w, h);
  const small = w < 600; mini.width = small ? 130 : 190; mini.height = small ? 130 : 190;
}
addEventListener('resize', resize); resize();

// ---------- boot ----------
camera.fov = 50; camera.updateProjectionMatrix();
orbit.target.copy(CENTER).setY(10);
camera.position.set(CENTER.x + 380, 520 * Math.max(1, 1.4 / camera.aspect), CENTER.z + 620 * Math.max(1, 1.4 / camera.aspect));
let ready = false;
(async () => {
  $('loading').textContent = 'Loading trees and textures…';
  await loadAssets();
  $('loading').textContent = 'Laying out Geetanagar…';
  await new Promise(r => setTimeout(r, 30));
  // each builder is isolated: one failing module logs an error instead of leaving the world half-built
  const BOOT_MS = {}; window.__bootMs = BOOT_MS; // per-builder load time, for profiling
  const safe = (name, fn) => { const t0 = performance.now(); try { return fn(); } catch (err) { console.error(`[boot] ${name} failed`, err); } finally { BOOT_MS[name] = Math.round(performance.now() - t0); } };
  safe('paintGround', paintGround); safe('applyGroundTextures', applyGroundTextures); safe('buildAll', buildAll); safe('buildStreets', buildStreets); safe('buildCompoundWalls', buildCompoundWalls);
  safe('buildMandir', buildMandir); safe('buildKiosks', buildKiosks); safe('buildDeck', buildDeck); safe('buildHatigarh', buildHatigarh);
  safe('buildTraffic', buildTraffic); safe('buildPoles', buildPoles); safe('buildOuter', buildOuter);
  const palms = safe('collectTrees', collectTrees) || [];
  safe('buildTreeMeshes', () => buildTreeMeshes(palms)); safe('buildGrass', buildGrass); safe('buildFlowersAndRocks', buildFlowersAndRocks); safe('makeMiniBase', makeMiniBase);
  safe('mergeStatic', () => mergeStatic(scene)); // fewer draw calls: small static meshes merged per material per 120 m cell
  applySun(parseFloat($('sun').value)); clock.textContent = fmt(parseFloat($('sun').value));
  safe('updateNearTrees', () => updateNearTrees(true));
  $('count').textContent = GEO.buildings.length.toLocaleString('en-IN');
  $('loading').hidden = true;
  ready = true;
})();

let last = performance.now();
renderer.setAnimationLoop(now => {
  const dt = Math.min(0.05, (now - last) / 1000); last = now;
  if (mode === 'walk') { stepWalk(dt); if (nearDeck()) placeShadow(DECK.cx, -(DECK.cy - 260), 430); else placeShadow(player.x, -player.y, 90); }
  else { orbit.update(); placeShadow(orbit.target.x, orbit.target.z, 720); }
  if (ready) { try { updateNearTrees(false); updateGrass(); } catch (e) { /* vegetation failed to build */ } }
  setFogDensity(fogFor(mode === 'walk' && !nearDeck()));
  refreshEnv(now / 1000);
  renderFrame();
  updateLabels(); drawMini();
});
window.__geet = { player, enterWalk, enterOrbit, findOpen, isReady: () => ready };
if (import.meta.env.DEV) import('./dev/shots.js').then(m => Object.assign(window.__geet, { shot: m.shot, shots: m.shots }));

