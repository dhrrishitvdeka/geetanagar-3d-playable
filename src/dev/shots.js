// Dev-only: fixed comparison viewpoints, captured to screenshots/<milestone>/<name>.png
// through the /__shot endpoint in vite.config.js. Usage in the console: await __geet.shots('m1')
import { camera, renderer } from '../core/context.js';
import { renderFrame } from '../render/post.js';
import { refreshEnv, setFogDensity } from '../world/sky.js';
import { nearDeck } from '../world/deck.js';
import { fogFor } from '../render/quality.js';
import { updateNearTrees } from '../veg/trees.js';
import { updateGrass } from '../veg/grass.js';
import { enterOrbit, enterWalk, mode, orbit, player, stepWalk } from '../ui/controls.js';

export const VIEWS = {
  viewpoint: () => enterWalk('viewpoint'),
  field: () => enterWalk('field'),
  mandir: () => enterWalk('mandir'),
  hatigarh: () => enterWalk('hatigarh'),
  here: () => {}, // capture the current camera as is
  aerial: () => {
    enterOrbit();
    orbit.target.set(-150, 10, 40);
    camera.position.set(-150 + 380, 560, 40 + 620);
  },
};

// wait n animation frames, or 2 s when the tab is hidden and rAF is throttled
const frames = n => Promise.race([new Promise(r => { const f = () => (n-- > 0 ? requestAnimationFrame(f) : r()); f(); }), new Promise(r => setTimeout(r, 2000))]);

export async function shot(milestone, name, file = name) {
  VIEWS[name]();
  await frames(40); // let near-tree LOD and grass refresh around the new position
  if (mode === 'walk') stepWalk(1e-4); else orbit.update(); // place the camera even when rAF is throttled
  setFogDensity(fogFor(mode === 'walk' && !nearDeck())); // same rule as the render loop
  refreshEnv(performance.now() / 1000);
  try { updateNearTrees(true); updateGrass(); } catch (e) { /* vegetation unavailable */ }
  renderFrame();
  const png = renderer.domElement.toDataURL('image/png');
  const res = await fetch(`/__shot?dir=${encodeURIComponent(milestone)}&name=${encodeURIComponent(file)}`, { method: 'POST', body: png });
  return res.ok;
}

export async function shots(milestone) {
  const out = {};
  for (const name of Object.keys(VIEWS).filter(n => n !== 'here')) out[name] = await shot(milestone, name);
  return out;
}

export { player };
