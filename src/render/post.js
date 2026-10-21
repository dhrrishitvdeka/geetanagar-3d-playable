import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { camera, renderer, scene } from '../core/context.js';
import { setShadowSize, setShadowsEnabled } from '../world/lighting.js';
import { sky } from '../world/sky.js';

// ---------- post-processing and quality presets ----------
// High: GTAO + bloom + MSAA, 4k shadows. Medium: MSAA, 2k shadows. Low: direct render, no shadows, no composer.
const PRESETS = {
  low: { composer: false, ao: false, bloom: false, samples: 0, pixelRatio: 0.85, shadow: 0, far: 3500 },
  medium: { composer: true, ao: false, bloom: false, samples: 2, pixelRatio: 1, shadow: 2048, far: 6000 },
  high: { composer: true, ao: true, bloom: true, samples: 4, pixelRatio: 1.5, shadow: 4096, far: 9500 },
};
let Q = PRESETS.high, composer = null, aoPass = null, bloomPass = null, ready = false;

// dynamic resolution: scale is a fraction of the preset pixel ratio, from 0.6 up to 1
const MIN_SCALE = 0.6;
let scale = 1, lastT = 0, avgMs = 16, slowMs = 0, fastMs = 0;

function pixelRatio() { return Math.min(window.devicePixelRatio || 1, Q.pixelRatio) * scale; }
function setScale(s) {
  scale = Math.min(1, Math.max(MIN_SCALE, Math.round(s * 10) / 10));
  renderer.setPixelRatio(pixelRatio());
  if (composer) {
    const w = renderer.domElement.clientWidth || 1, h = renderer.domElement.clientHeight || 1;
    composer.setPixelRatio(renderer.getPixelRatio()); composer.setSize(w, h);
  }
}
function adapt() {
  const now = performance.now(), dt = lastT ? now - lastT : 0; lastT = now;
  if (!dt || dt > 250) return; // tab hidden or loading
  avgMs += 0.05 * (dt - avgMs);
  if (avgMs > 33) { slowMs += dt; fastMs = 0; }
  else if (avgMs < 18) { fastMs += dt; slowMs = 0; }
  else { slowMs = 0; fastMs = 0; }
  if (slowMs >= 2000) { slowMs = 0; if (scale > MIN_SCALE) setScale(scale - 0.1); }
  else if (fastMs >= 4000) { fastMs = 0; if (scale < 1) setScale(scale + 0.1); }
}

function build() {
  const w = renderer.domElement.clientWidth || 1, h = renderer.domElement.clientHeight || 1;
  if (Q.shadow) { setShadowsEnabled(true); setShadowSize(Q.shadow); } else setShadowsEnabled(false);
  camera.far = Q.far; camera.updateProjectionMatrix();
  sky.scale.setScalar(Math.min(9000, Q.far * 1.1)); // the box corner sits at scale * 0.866, so it stays inside the far plane
  renderer.setPixelRatio(pixelRatio());
  if (composer) composer.dispose();
  composer = null; aoPass = null; bloomPass = null;
  if (Q.composer) {
    const rt = new THREE.WebGLRenderTarget(w, h, { type: THREE.HalfFloatType, samples: Q.samples });
    composer = new EffectComposer(renderer, rt);
    composer.setPixelRatio(renderer.getPixelRatio()); composer.setSize(w, h);
    composer.addPass(new RenderPass(scene, camera));
    if (Q.ao) {
      aoPass = new GTAOPass(scene, camera, w, h);
      aoPass.updateGtaoMaterial({ radius: 1.6, distanceExponent: 1.5, thickness: 2.0, scale: 1.0, samples: 12 });
      aoPass.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 6, rings: 2, samples: 12 });
      aoPass.blendIntensity = 0.85;
      composer.addPass(aoPass);
    }
    if (Q.bloom) { bloomPass = new UnrealBloomPass(new THREE.Vector2(w, h), 0.05, 0.4, 2.5); composer.addPass(bloomPass); }
    composer.addPass(new OutputPass());
  }
  ready = true;
}
function setQuality(name) { Q = PRESETS[name] || PRESETS.high; scale = 1; lastT = 0; slowMs = 0; fastMs = 0; build(); return name; }
function resizePost(w, h) { if (composer) { composer.setPixelRatio(renderer.getPixelRatio()); composer.setSize(w, h); } }
function renderFrame() {
  if (!ready) build();
  adapt();
  if (composer) composer.render(); else renderer.render(scene, camera);
}
function getPixelRatioScale() { return scale; }

export { setQuality, resizePost, renderFrame, getPixelRatioScale, PRESETS };
