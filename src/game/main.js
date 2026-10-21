import { camera, canvas, renderer, scene, stage } from '../core/context.js';
import { GEO, hAt } from '../core/geo.js';
import { enterWalk, setLookGate } from '../ui/controls.js';
import { setShowLabels } from '../ui/labels.js';
import { makeMiniBase } from '../ui/minimap.js';
import { loadAssets } from '../veg/assets.js';
import { buildFlowersAndRocks, buildGrass, updateGrass } from '../veg/grass.js';
import { buildTreeMeshes, collectTrees, updateNearTrees } from '../veg/trees.js';
import { buildAll } from '../world/buildings.js';
import { DECK, buildDeck, groundAt, nearDeck } from '../world/deck.js';
import { applySun, placeShadow } from '../world/lighting.js';
import { refreshEnv, setFogDensity } from '../world/sky.js';
import { renderFrame, resizePost, setQuality } from '../render/post.js';
import { QUALITY, fogFor } from '../render/quality.js';
import { mergeStatic } from '../render/staticmerge.js';
import { buildMandir } from '../world/mandir.js';
import { buildOuter } from '../world/outer.js';
import { buildKiosks } from '../world/shops.js';
import { buildHatigarh, buildPoles, buildTraffic } from '../world/streetlife.js';
import { buildStreets } from '../world/streets.js';
import { setFieldGateOpen } from '../world/road/fieldedge.js';
import { buildCompoundWalls } from '../world/compound.js';
import { buildDetails } from '../world/details.js';
import { applyGroundTextures, paintGround } from '../world/terrain.js';
import { emit, on } from './core/bus.js';
import { CLOCK, advanceClock, hasSave, load, newGame, nextDay, save, state } from './core/state.js';
import { endFrame, initInput, pressed, requestLock, setInputGate, setKeysCaptured } from './input.js';
import { dismount, getPlayer, getSafePos, initPlayer, setCameraMode, getCameraMode, setLook, teleport, updatePlayer } from './player.js';
import { initNPCs, updateNPCs } from './npc/agents.js';
import { updateRoutines } from './npc/routines.js';
import { preloadCharacters } from './npc/realchars.js';
import { initAnimals, updateAnimals } from './animals.js';
import { initTraffic, updateTraffic } from './traffic.js';
import { initWorldObjects, takePhoto, updateWorldObjects } from './worldobjects.js';
import { initLoose, updateLoose } from './loose.js';
import './perfhud.js'; // game.html?fps shows a frame-rate readout
import { initQuests, updateQuests } from './quests.js';
import { tryInteract, updateInteract } from './interact.js';
import { bigMessage, closeModals, fade, getOpenMenu, initHUD, isUIBlocking, setLoading, showMenu, updateHUD } from './hud.js';
import { initMap, isFullMapOpen, toggleFullMap, updateMap } from './map.js';
import { initAudio, setListener } from './audio.js';

// ---------- Geetanagar: the game. Same world as the explorer, plus people, traffic, animals and things to do ----------
setQuality(QUALITY);
function resize() { const w = stage.clientWidth, h = stage.clientHeight; renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix(); resizePost(w, h); }
addEventListener('resize', resize); resize();

const BOOT_MS = {}; window.__bootMs = BOOT_MS;
const safe = (name, fn) => { const t0 = performance.now(); try { return fn(); } catch (err) { console.error(`[boot] ${name} failed`, err); } finally { BOOT_MS[name] = Math.round(performance.now() - t0); } };
safe('initInput', initInput); safe('initAudio', initAudio); safe('initHUD', initHUD);
setInputGate(isUIBlocking); // keys pressed under a modal never count as presses
setLookGate(() => started && !paused && !transitioning && !isUIBlocking()); // no pointer lock or look-drag under menus or on the title

const sunHour = () => Math.max(6, Math.min(17.5, state.time)); // applySun is only defined for 6..17.5
let ready = false, started = false, paused = false, transitioning = false; // transitioning: the day-change fade
let spawn = { x: 0, y: 0, heading: Math.PI / 2 };
(async () => {
  setLoading('Loading trees and textures…');
  // the rigged people load alongside the trees; if they fail the game keeps the procedural humanoids
  const charsReady = preloadCharacters().catch(err => console.warn('[chars] rigged models unavailable, using the procedural ones', err));
  await loadAssets();
  setLoading('Laying out Geetanagar…');
  await new Promise(r => setTimeout(r, 30));
  safe('paintGround', paintGround); safe('applyGroundTextures', applyGroundTextures); safe('buildAll', buildAll);
  setFieldGateOpen(true, -26); // open the field gate where the road frontage is clear
  safe('buildStreets', buildStreets); safe('buildCompoundWalls', buildCompoundWalls); safe('buildDetails', buildDetails);
  safe('buildMandir', buildMandir); safe('buildKiosks', buildKiosks); safe('buildDeck', buildDeck); safe('buildHatigarh', buildHatigarh);
  safe('buildTraffic', () => buildTraffic({ lanes: false })); safe('buildPoles', buildPoles); safe('buildOuter', buildOuter); // moving traffic replaces the frozen lane vehicles
  const palms = safe('collectTrees', collectTrees) || [];
  safe('buildTreeMeshes', () => buildTreeMeshes(palms)); safe('buildGrass', buildGrass); safe('buildFlowersAndRocks', buildFlowersAndRocks); safe('makeMiniBase', makeMiniBase);
  safe('mergeStatic', () => mergeStatic(scene));
  moveSun(true);
  // the shared modules (grass, labels, terrace) follow the explorer's walking player; player.js keeps it in sync
  safe('enterWalk', () => enterWalk('field'));
  camera.fov = state.settings.fov || 70; camera.updateProjectionMatrix(); // enterWalk forces fov 70
  setShowLabels(false); // no floating place names in the game: they live on the full map (M)
  setLoading('Waking up the neighbourhood…');
  await new Promise(r => setTimeout(r, 30));
  // game systems come after mergeStatic so nothing dynamic is baked into the static batches
  // traffic first: it turns parked vehicles into colliders, which the NPC walk graph then respects
  await charsReady;
  safe('initMap', initMap); safe('initPlayer', initPlayer); safe('initTraffic', initTraffic); safe('initAnimals', initAnimals);
  safe('initNPCs', initNPCs); safe('initWorldObjects', initWorldObjects); safe('initLoose', initLoose); safe('initQuests', initQuests);
  safe('updateNearTrees', () => updateNearTrees(true));
  { const p = getPlayer(); spawn = { x: p.x, y: p.y, heading: p.heading }; } // where a new game starts: the field, as the explorer does
  // compile every material in the scene now, behind the loading screen, instead of stalling the first frames that see it
  setLoading('Preparing shaders…');
  const tc = performance.now(); try { await renderer.compileAsync(scene, camera); } catch (err) { /* materials compile on first use instead */ } BOOT_MS.compileShaders = Math.round(performance.now() - tc);
  setLoading(null);
  ready = true;
  showMenu('title');
  if (new URLSearchParams(location.search).has('autostart')) startGame(!hasSave(), false);
})();

// ---------- title backdrop: a slow circle over the field at 60-120 m while the menu is up ----------
const TC = { x: (GEO.field[0] + GEO.field[2]) / 2, y: (GEO.field[1] + GEO.field[3]) / 2 };
function titleCam(t) {
  const a = t * 0.05, r = 150 + 45 * Math.sin(t * 0.07), alt = 90 + 30 * Math.sin(t * 0.11);
  const x = TC.x + Math.cos(a) * r, y = TC.y + Math.sin(a) * r;
  camera.position.set(x, groundAt(x, y) + alt, -y); camera.lookAt(TC.x, hAt(TC.x, TC.y) + 6, -TC.y);
  const f = state.settings.fov || 70; if (camera.fov !== f) { camera.fov = f; camera.updateProjectionMatrix(); }
}

// ---------- start, pause, resume ----------
function startGame(fresh, viaClick = true) {
  const picked = state.look; // chosen on the title screen before any save was read
  if (fresh || !load()) newGame();
  if (picked) state.look = picked;
  setLook(state.look); // rebuild the character from the loaded (or picked) look before anything hears game:start
  if (state.player) teleport(state.player.x, state.player.y, state.player.heading); else teleport(spawn.x, spawn.y, spawn.heading);
  moveSun(true);
  started = true; paused = false; showMenu(null); setKeysCaptured(true);
  if (viaClick) requestLock();
  emit('game:start', { newGame: !!fresh });
}
on('ui:start', ({ newGame: fresh }) => startGame(fresh));
function resume(relock) { if (!paused) return; paused = false; showMenu(null); if (relock) requestLock(); emit('game:resume', {}); }
on('ui:resume', () => resume(true));
on('ui:settings', ({ settings }) => {
  if (getCameraMode() !== 'binocular') { camera.fov = settings.fov; camera.updateProjectionMatrix(); }
});
const sleep = ms => new Promise(r => setTimeout(r, ms));
const fadeTo = (toBlack, ms) => Promise.race([Promise.resolve(fade(toBlack, ms)).catch(() => {}), sleep(ms + 1200)]); // a stuck fade must not freeze the game
on('day:end', async () => {
  if (transitioning) return; transitioning = true;
  try { closeModals(); await fadeTo(true, 800); }
  finally { nextDay(); state.stamina = 1; moveSun(true); }
  try { bigMessage(`Day ${state.day}`, 'A new morning in Geetanagar'); await fadeTo(false, 800); }
  finally { transitioning = false; autosave(); }
});
function pause() {
  if (!started || paused) return;
  paused = true; closeModals(); showMenu('pause'); emit('game:pause', {});
  try { if (document.pointerLockElement) document.exitPointerLock(); } catch (e) { /* already free */ }
}
// anything in front of the view (menus, dialogue, the full map) is expected to take the mouse; only a stray loss of the lock pauses
const uiBusy = () => isUIBlocking() || getOpenMenu() !== null || isFullMapOpen();
let wasLocked = false;
document.addEventListener('pointerlockchange', () => {
  if (document.pointerLockElement) { wasLocked = true; return; }
  if (!wasLocked) return; wasLocked = false;
  if (!started || paused) return;
  setTimeout(() => { if (started && !paused && !document.pointerLockElement && !uiBusy()) pause(); }, 120);
});

addEventListener('blur', () => { if (started && !transitioning) pause(); });
document.addEventListener('visibilitychange', () => { if (document.hidden && started && !transitioning) pause(); });

// ---------- sun: the light follows every 0.02 game hours, the (expensive) environment map every half hour, every 2 on Low ----------
let sunAt = -1, envAt = -99, envForce = true;
function moveSun(force) {
  const h = sunHour();
  if (force) { sunAt = h; applySun(h); envForce = true; }
  else if (Math.abs(h - sunAt) >= 0.02) { sunAt = h; applySun(h); }
}

// ---------- saving: every minute, on quest completion and when the tab goes away ----------
function autosave() { const p = getSafePos(); state.player = { x: p.x, y: p.y, heading: p.heading }; save(); } // always the last spot on foot: never a vehicle or a seat
addEventListener('beforeunload', () => { if (started && !transitioning) autosave(); });
addEventListener('pagehide', () => { if (started && !transitioning) autosave(); });
on('quest:completed', () => { if (started) autosave(); });

// ---------- frame ----------
let last = performance.now(), saveT = 0, busyPrev = false, grassT = 0;
renderer.setAnimationLoop(now => {
  const dt = Math.min(0.05, (now - last) / 1000); last = now;
  if (ready) {
    if (!started) titleCam(now / 1000);
    else if (paused) { if (pressed('pause')) resume(false); }
    else if (!transitioning) { // the day-change fade runs with the game frozen
      // busyPrev: a menu the HUD already closed on this very Esc must not count as a fresh Esc for the pause menu
      if (pressed('pause')) {
        if (!busyPrev && !uiBusy()) pause();
        else if (getOpenMenu() !== null) showMenu(null);
        else if (isFullMapOpen()) toggleFullMap(false);
      }
      if (!paused && !isUIBlocking()) {
        if (pressed('interact')) { if (getPlayer().riding) dismount(); else tryInteract(); }
        if (pressed('map')) toggleFullMap();
        if (pressed('journal')) showMenu(getOpenMenu() === 'journal' ? null : 'journal');
        if (pressed('inventory')) showMenu(getOpenMenu() === 'inventory' ? null : 'inventory');
        if (pressed('help')) showMenu('help');
        if (pressed('photo')) takePhoto();
        if (pressed('camera')) setCameraMode(getCameraMode() === 'third' ? 'first' : 'third');
      }
      if (!paused) {
        advanceClock(dt);
        moveSun(false);
        updatePlayer(dt);
        const p = getPlayer();
        updateNPCs(dt, p); updateRoutines(dt, p); updateAnimals(dt, p); updateTraffic(dt, p); updateWorldObjects(dt, p); updateLoose(dt, p); updateQuests(dt, p);
        updateInteract(p);
        setListener(p.x, p.y, p.heading);
        if (!transitioning && (saveT += dt) > 60) { saveT = 0; autosave(); }
      }
    }
    const p = getPlayer();
    if (started && nearDeck()) placeShadow(DECK.cx, -(DECK.cy - 260), 430); // from the terrace the shadows cover the whole view, as in the explorer
    else if (started) placeShadow(p.x, -p.y, 90);
    else placeShadow(TC.x, -TC.y, 150);
    // the grass only needs refreshing every so often at vehicle speed
    const grassDue = !p.riding || (grassT += dt) >= 0.6; if (grassDue) grassT = 0;
    try { updateNearTrees(false); if (grassDue) updateGrass(); } catch (e) { /* vegetation failed to build */ }
  }
  setFogDensity(fogFor(!(started && nearDeck())));
  const rebake = !ready || envForce || Math.abs(sunAt - envAt) >= (QUALITY === 'low' ? 2 : 0.5);
  refreshEnv(now / 1000, rebake); if (rebake && ready) { envAt = sunAt; envForce = false; }
  renderFrame();
  if (ready) { updateMap(dt); updateHUD(dt); busyPrev = paused || uiBusy(); }
  endFrame();
});
window.__game = { state, getPlayer, teleport, startGame, pause, resume, autosave, setCameraMode, CLOCK, isReady: () => ready };
