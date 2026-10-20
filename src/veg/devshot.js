// Dev-only capture helper for the vegetation work; never imported by the app.
// Renders synchronously (works while the browser pane is hidden and requestAnimationFrame is paused):
//   const { vshot } = await import('/src/veg/devshot.js'); await vshot('field', 'field_after');
import { VIEWS } from '../dev/shots.js';
import { updateNearTrees } from './trees.js';
import { updateGrass } from './grass.js';
import { renderFrame } from '../render/post.js';
import { mode, orbit, player, stepWalk } from '../ui/controls.js';
import { placeShadow } from '../world/lighting.js';
import { refreshEnv, setFogDensity } from '../world/sky.js';
import { renderer } from '../core/context.js';

export async function vshot(name, file = name, dir = 'veg', pose, tweak) {
  if (name) VIEWS[name]();
  if (pose) pose();
  for (let i = 0; i < 3; i++) {
    if (mode === 'walk') { stepWalk(0.016); placeShadow(player.x, -player.y, 90); } else { const dmp = orbit.enableDamping; orbit.enableDamping = false; orbit.update(); orbit.enableDamping = dmp; placeShadow(orbit.target.x, orbit.target.z, 720); } // no damping: nothing settles between frames here
    updateNearTrees(true); updateGrass();
  }
  if (tweak) tweak();
  setFogDensity(mode === 'walk' ? 0.0008 : 0.00035); refreshEnv(performance.now() / 1000);
  renderFrame(); renderFrame();
  if (!file) return true;
  const png = renderer.domElement.toDataURL('image/png');
  const res = await fetch(`/__shot?dir=${dir}&name=${encodeURIComponent(file)}`, { method: 'POST', body: png });
  return res.ok;
}
