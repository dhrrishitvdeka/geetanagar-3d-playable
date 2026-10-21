// Dev-only GPU benchmark: stands the player at fixed spots and times the main pass and the shadow pass with GPU timer queries
// (median of 9; the scene pass only, no post-processing). Run from the console on game.html once the world has loaded: (await import('/src/dev/gpubench.js')).bench()
import { camera, renderer, scene } from '../core/context.js';
import { getPlayer, teleport, updatePlayer } from '../game/player.js';
import { updateGrass } from '../veg/grass.js';
import { updateNearTrees } from '../veg/trees.js';
import { placeShadow } from '../world/lighting.js';

const SPOTS = [['field', -20, -60, Math.PI / 2], ['hatigarh', -470, -70, Math.PI], ['lanes', -100, 60, 0.3]];
const wait = ms => new Promise(r => setTimeout(r, ms));

async function gpuMs(gl, ext, fn, n = 9) {
  fn(); gl.finish(); const qs = [];
  for (let i = 0; i < n; i++) { const q = gl.createQuery(); gl.beginQuery(ext.TIME_ELAPSED_EXT, q); fn(); gl.endQuery(ext.TIME_ELAPSED_EXT); gl.finish(); qs.push(q); }
  const ms = [];
  for (const q of qs) { for (let k = 0; k < 100 && !gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE); k++) await wait(5); ms.push(gl.getQueryParameter(q, gl.QUERY_RESULT) / 1e6); gl.deleteQuery(q); }
  ms.sort((a, b) => a - b); return +ms[n >> 1].toFixed(2);
}

export async function bench() {
  const gl = renderer.getContext(), ext = gl.getExtension('EXT_disjoint_timer_query_webgl2');
  if (!ext) return 'no GPU timer queries in this browser';
  // a fixed 960 x 540 canvas at pixel ratio 1 (re-applied per spot: the game's dynamic resolution may change it in between)
  const fix = () => { renderer.setPixelRatio(1); renderer.setSize(960, 540, false); camera.aspect = 960 / 540; camera.updateProjectionMatrix(); };
  const out = {}, auto = renderer.shadowMap.autoUpdate;
  for (const [name, x, y, h] of SPOTS) {
    teleport(x, y, h); await wait(300);
    for (let i = 0; i < 90; i++) updatePlayer(1 / 60); // settle the follow camera (the frame loop may not be running)
    const p = getPlayer(); placeShadow(p.x, -p.y, 90); updateNearTrees(true); updateGrass(); fix();
    renderer.shadowMap.autoUpdate = false;
    const main = await gpuMs(gl, ext, () => renderer.render(scene, camera));
    const both = await gpuMs(gl, ext, () => { renderer.shadowMap.needsUpdate = true; renderer.render(scene, camera); });
    // what was drawn (deterministic, unlike the timings on a throttling laptop GPU): calls and triangles per pass
    renderer.info.autoReset = false; renderer.info.reset(); renderer.render(scene, camera); const m = [renderer.info.render.calls, renderer.info.render.triangles];
    renderer.info.reset(); renderer.shadowMap.needsUpdate = true; renderer.render(scene, camera); const t = [renderer.info.render.calls, renderer.info.render.triangles];
    renderer.info.autoReset = true; renderer.shadowMap.autoUpdate = auto;
    out[name] = { main, shadow: +(both - main).toFixed(2), total: both, mainDraw: `${m[0]} calls ${(m[1] / 1e6).toFixed(2)}M tris`, shadowDraw: `${t[0] - m[0]} calls ${((t[1] - m[1]) / 1e6).toFixed(2)}M tris`, at: [Math.round(p.x), Math.round(p.y)] };
  }
  out.canvas = [renderer.domElement.width, renderer.domElement.height];
  return out;
}
