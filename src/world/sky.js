import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';
import { renderer, scene } from '../core/context.js';

// ---- physical sky (Preetham) tuned for Guwahati's pre-monsoon haze: pale, whitish horizon, soft sun ----
// Street View (Mar 2026) shows a washed-out blue-grey sky, never deep blue, and distant hills fading into haze.
const sky = new Sky();
sky.scale.setScalar(4000); sky.frustumCulled = false;
const U = sky.material.uniforms;
// the raw sun disc reaches ~6e4; clamp so bloom gives a soft glow instead of whiting out the frame
// and wash the colour ~45% towards a warm grey: Preetham stays clear-day blue overhead even at high turbidity
sky.material.fragmentShader = sky.material.fragmentShader.replace('gl_FragColor = vec4( texColor, 1.0 );',
  'vec3 hz = mix( texColor, vec3( dot( texColor, vec3( 0.299, 0.587, 0.114 ) ) ) * vec3( 1.0, 0.985, 0.955 ), 0.45 );\n\tgl_FragColor = vec4( min( hz, vec3( 3.0 ) ), 1.0 );');
U.turbidity.value = 18; U.rayleigh.value = 0.7; U.mieCoefficient.value = 0.011; U.mieDirectionalG.value = 0.86;
U.cloudCoverage.value = 0.32; U.cloudDensity.value = 0.35; U.cloudScale.value = 0.00025;
scene.add(sky);

// the same sky, moved into its own scene while it is baked into the PMREM so ambient light matches what you see
const envScene = new THREE.Scene();
const pmrem = new THREE.PMREMGenerator(renderer);
let envRT = null, envDirty = true;

const hazeNoon = new THREE.Color('#c3cacd'), hazeLow = new THREE.Color('#d9c2a4'), fogCol = new THREE.Color();
scene.fog = new THREE.FogExp2(fogCol, 0.0011);

function updateSky(k, dir) {
  U.sunPosition.value.copy(dir);
  fogCol.copy(hazeNoon).lerp(hazeLow, Math.pow(1 - k, 1.5));
  scene.fog.color.copy(fogCol);
  scene.background = null;
  envDirty = true;
}
// regenerate the environment map at most once per frame, only after the sun moved
// rebake = false keeps the dirty flag and skips the expensive bake (the game bakes every half game hour)
function refreshEnv(t = 0, rebake = true) {
  U.time.value = t;
  if (!envDirty || !rebake) return;
  envDirty = false;
  // without the sun disc: the directional light already carries the sun, and the disc would blow out the ambient
  U.showSunDisc.value = 0; envScene.add(sky);
  const rt = pmrem.fromScene(envScene, 0, 0.1, 10000);
  U.showSunDisc.value = 1; scene.add(sky);
  if (envRT) envRT.dispose();
  envRT = rt; scene.environment = rt.texture;
}
// thinner haze when looking from the air, so the whole neighbourhood stays readable
function setFogDensity(d) { scene.fog.density = d; }

export { updateSky, refreshEnv, setFogDensity, sky };
