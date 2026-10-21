import * as THREE from 'three';
import { renderer, scene } from '../core/context.js';
import { updateSky } from './sky.js';

// ---------- lights: a sun plus sky-derived image-based ambient (see sky.js) ----------
// the hemisphere light only adds a little warm bounce from the dusty ground
const hemi = new THREE.HemisphereLight('#dfe6ea', '#9a8466', 0.35); scene.add(hemi);
const sun = new THREE.DirectionalLight('#fff2dc', 3.2);
sun.castShadow = true; sun.shadow.mapSize.set(4096, 4096); sun.shadow.bias = -0.0003; sun.shadow.normalBias = 0.35; sun.shadow.radius = 2;
scene.add(sun, sun.target);
const sunDir = new THREE.Vector3();
const sunLow = new THREE.Color('#ffae6a'), sunHigh = new THREE.Color('#fff1dc');
// Guwahati, 26.17 N: the sun crosses a little south of overhead; simple day arc from 5:30 to 17:30
function applySun(hour) {
  const t = (hour - 5.5) / 12, e = Math.max(4, Math.sin(Math.PI * t) * 68) * Math.PI / 180, az = (90 + 180 * t) * Math.PI / 180;
  sunDir.set(Math.sin(az) * Math.cos(e), Math.sin(e), -Math.cos(az) * Math.cos(e));
  const k = Math.min(1, Math.sin(e) * 1.6);
  sun.intensity = 0.8 + 2.6 * k; sun.color.copy(sunLow).lerp(sunHigh, k); hemi.intensity = 0.2 + 0.2 * k;
  renderer.toneMappingExposure = 0.9 * Math.pow(3.4 / sun.intensity, 0.3); // noon 0.9, dawn ~1.4: the eye adapts, so dawn is dimmer but not murky
  scene.environmentIntensity = 0.18 + 0.17 * k;
  updateSky(k, sunDir);
}
function placeShadow(cx, cz, half) {
  const sc = sun.shadow.camera;
  if (sc.right !== half) { sc.left = -half; sc.right = half; sc.top = half; sc.bottom = -half; sc.near = 1; sc.far = 3000; sc.updateProjectionMatrix(); }
  // snap to texel grid to stop shimmering while walking
  const texel = (2 * half) / sun.shadow.mapSize.x; cx = Math.round(cx / texel) * texel; cz = Math.round(cz / texel) * texel;
  sun.target.position.set(cx, 20, cz); sun.position.set(cx, 20, cz).addScaledVector(sunDir, 1200);
}
function setShadowSize(n) {
  if (sun.shadow.mapSize.x === n) return;
  sun.shadow.mapSize.set(n, n); if (sun.shadow.map) { sun.shadow.map.dispose(); sun.shadow.map = null; }
}
function setShadowsEnabled(on) {
  renderer.shadowMap.enabled = on; sun.castShadow = on;
  if (!on && sun.shadow.map) { sun.shadow.map.dispose(); sun.shadow.map = null; }
}

export { applySun, placeShadow, setShadowSize, setShadowsEnabled, hemi, sun, sunDir };
