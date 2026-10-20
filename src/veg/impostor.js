import * as THREE from 'three';
import { renderer } from '../core/context.js';
import { patchVeg } from './wind.js';

// ---------- tree impostors: each EZ-Tree model is rendered once at load into an atlas of views ----------
// AZ azimuths x EL elevations; each cell holds albedo (with crown-depth darkening) and a model-space normal.
// The far trees are camera-facing quads that pick and blend the nearest views, lit by the scene like any mesh.
const SWAY = '0.012';
const AZ = 8, EL = 3, ELEV = [0, 0.62, 1.2]; // radians: horizon, ~35 deg, ~70 deg

const BAKE_VS = /* glsl */`
uniform vec3 uC, uR;
varying vec2 vUv; varying vec3 vN, vP; varying float vAO;
void main() {
  vUv = uv; vN = normalize(normal); vP = position;
  vAO = mix(0.45, 1.0, smoothstep(0.15, 1.0, length((position - uC) / uR)));
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;
const BAKE_FS = /* glsl */`
uniform sampler2D map; uniform vec3 tint, uC; uniform float leaf, mode;
varying vec2 vUv; varying vec3 vN, vP; varying float vAO;
void main() {
  vec4 t = texture2D(map, vUv);
  if (leaf > 0.5 && t.a < 0.5) discard;
  if (mode < 0.5) { gl_FragColor = vec4(t.rgb * tint * (leaf > 0.5 ? vAO : 1.0), 1.0); return; }
  vec3 n = gl_FrontFacing ? vN : -vN;
  if (leaf > 0.5) n = normalize(mix(n, normalize(vP - uC), 0.65));
  gl_FragColor = vec4(n * 0.5 + 0.5, 1.0);
}`;

// mp: modelParts() result; mats: [{map, tint: Color, leaf: bool}] aligned with mp.parts
function bakeImpostor(mp, mats, cell = 256) {
  const S = Math.max(mp.h, mp.w) * 1.04, cy = mp.h / 2;
  const center = new THREE.Vector3(0, mp.h * 0.62, 0), radius = new THREE.Vector3(mp.w * 0.5, mp.h * 0.4, mp.w * 0.5);
  const scene = new THREE.Scene();
  const mats2 = [0, 1].map(mode => mats.map(m => new THREE.ShaderMaterial({
    vertexShader: BAKE_VS, fragmentShader: BAKE_FS, side: THREE.DoubleSide,
    uniforms: { map: { value: m.map }, tint: { value: m.tint || new THREE.Color(1, 1, 1) }, leaf: { value: m.leaf ? 1 : 0 }, mode: { value: mode }, uC: { value: center }, uR: { value: radius } },
  })));
  const meshes = mp.parts.map((p, i) => { const me = new THREE.Mesh(p.geo, mats2[0][i]); scene.add(me); return me; });
  const cam = new THREE.OrthographicCamera(-S / 2, S / 2, S / 2, -S / 2, 0.1, S * 4);
  const W = AZ * cell, H = EL * cell;
  const mk = () => { const rt = new THREE.WebGLRenderTarget(W, H, { type: THREE.HalfFloatType, generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter, magFilter: THREE.LinearFilter, depthBuffer: true }); return rt; };
  const rtA = mk(), rtN = mk();
  const prevRT = renderer.getRenderTarget(), prevClear = renderer.getClearColor(new THREE.Color()), prevAlpha = renderer.getClearAlpha(), prevAuto = renderer.autoClear;
  const prevTone = renderer.toneMapping, prevShadow = renderer.shadowMap.autoUpdate;
  renderer.shadowMap.autoUpdate = false;
  for (const [rt, mode, clear] of [[rtA, 0, new THREE.Color(0.06, 0.09, 0.035)], [rtN, 1, new THREE.Color(0.5, 0.75, 0.5)]]) {
    meshes.forEach((me, i) => { me.material = mats2[mode][i]; });
    renderer.setRenderTarget(rt); renderer.setClearColor(clear, 0); renderer.autoClear = false; renderer.clear(true, true, true);
    for (let e = 0; e < EL; e++) for (let a = 0; a < AZ; a++) {
      const az = (a / AZ) * Math.PI * 2, el = ELEV[e];
      cam.position.set(Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el)).multiplyScalar(S * 2).add(new THREE.Vector3(0, cy, 0));
      cam.up.set(0, 1, 0); cam.lookAt(0, cy, 0); cam.updateMatrixWorld();
      rt.viewport.set(a * cell, e * cell, cell, cell); rt.scissor.set(a * cell, e * cell, cell, cell); rt.scissorTest = true;
      renderer.setRenderTarget(rt);
      renderer.clearDepth();
      renderer.render(scene, cam);
    }
    rt.scissorTest = false;
  }
  renderer.setRenderTarget(prevRT); renderer.setClearColor(prevClear, prevAlpha); renderer.autoClear = prevAuto; renderer.toneMapping = prevTone; renderer.shadowMap.autoUpdate = prevShadow;
  for (const ms of mats2) for (const m of ms) m.dispose();
  return { albedo: rtA.texture, normal: rtN.texture, S, cy, h: mp.h };
}

// shared GLSL: billboard and view selection (vertex), atlas sampling (fragment)
const IMP_VS_HEAD = /* glsl */`
uniform float uImpS, uImpCy;
varying vec4 vImpA; varying vec4 vImpB; varying vec3 vImpW; varying float vImpYaw;
`;
// replaces begin_vertex: builds the camera-facing quad in instance-local space and the frame indices
const IMP_VS_BODY = /* glsl */`
  {
    vec3 iPos = (modelMatrix * vec4(instanceMatrix[3].xyz, 1.0)).xyz;
    float sx = length(instanceMatrix[0].xyz), sy = length(instanceMatrix[1].xyz);
    float yaw = atan(-instanceMatrix[0].z, instanceMatrix[0].x);
    vec3 cw = iPos + vec3(0.0, uImpCy * sy, 0.0);
    vec3 toC = normalize(cameraPosition - cw);
    // view direction in the tree's own (unrotated) frame
    float c = cos(yaw), s = sin(yaw);
    vec3 dl = vec3(c * toC.x - s * toC.z, toC.y, s * toC.x + c * toC.z);
    float az = atan(dl.x, dl.z); if (az < 0.0) az += 6.2831853;
    float fa = az / 6.2831853 * ${AZ}.0, el = asin(clamp(dl.y, -1.0, 1.0));
    float a0 = floor(fa), wa = fa - a0;
    float fe = el < ${ELEV[1]} ? max(el, 0.0) / ${ELEV[1]} : 1.0 + (el - ${ELEV[1]}) / (${ELEV[2]} - ${ELEV[1]});
    fe = clamp(fe, 0.0, ${EL - 1}.0);
    float e0 = min(floor(fe), ${EL - 2}.0), we = fe - e0;
    vImpA = vec4(mod(a0, ${AZ}.0), mod(a0 + 1.0, ${AZ}.0), e0, wa); vImpB = vec4(we, 0.0, 0.0, 0.0);
    vImpYaw = yaw;
    // quad in world space, facing the camera (spherical billboard); vertical size eases from sy to sx when seen from above
    vec3 right = normalize(cross(vec3(0.0, 1.0, 0.0), toC)); if (abs(toC.y) > 0.999) right = vec3(1.0, 0.0, 0.0);
    vec3 up = cross(toC, right);
    float vs = mix(sy, sx, clamp(abs(toC.y) * 1.2, 0.0, 1.0));
    vec3 wp = cw + right * position.x * uImpS * sx + up * position.y * uImpS * vs;
    // gentle sway of the upper crown, in step with the near models' wind (uniforms from wind.js)
    float ph = dot(iPos.xz, vec2(0.071, 0.113)), g = 0.65 + 0.35 * sin(uTime * 0.37 + iPos.x * 0.013 + iPos.z * 0.009);
    float sw = (sin(uTime * 1.15 + ph) * 0.6 + sin(uTime * 2.3 + ph * 1.7) * 0.25) * g;
    float hq = clamp(position.y + 0.5, 0.0, 1.0);
    wp += vec3(uWind.x, 0.0, -uWind.y) * (hq * hq * sw * ${SWAY} * uImpS * sy);
    vImpW = vec3(position.xy + 0.5, 0.0);
    // back into instance-local space so the standard instancing / shadow code paths stay intact
    transformed = (inverse(modelMatrix * instanceMatrix) * vec4(wp, 1.0)).xyz;
  }
`;
const IMP_FS_HEAD = /* glsl */`
uniform sampler2D uImpAlb, uImpNrm;
varying vec4 vImpA; varying vec4 vImpB; varying vec3 vImpW; varying float vImpYaw;
vec2 impUV(float a, float e, vec2 q) { return (vec2(a, e) + clamp(q, 0.004, 0.996)) / vec2(${AZ}.0, ${EL}.0); }
vec4 impSample(sampler2D t, vec2 q) {
  float wa = vImpA.w, we = vImpB.x;
#ifdef IMP_FAST
  // low preset: one texture fetch from the nearest view instead of four blended ones
  return texture2D(t, impUV(wa < 0.5 ? vImpA.x : vImpA.y, vImpA.z + (we < 0.5 ? 0.0 : 1.0), q));
#endif
  vec4 r0 = mix(texture2D(t, impUV(vImpA.x, vImpA.z, q)), texture2D(t, impUV(vImpA.y, vImpA.z, q)), wa);
  vec4 r1 = mix(texture2D(t, impUV(vImpA.x, vImpA.z + 1.0, q)), texture2D(t, impUV(vImpA.y, vImpA.z + 1.0, q)), wa);
  return mix(r0, r1, we);
}
`;

function makeImpostorMesh(bake, count, opts = {}) {
  const geo = new THREE.PlaneGeometry(1, 1);
  const mat = new THREE.MeshStandardMaterial({ map: bake.albedo, alphaTest: 0.42, roughness: 0.92, side: THREE.DoubleSide });
  const uniforms = { uImpS: { value: bake.S }, uImpCy: { value: bake.cy }, uImpAlb: { value: bake.albedo }, uImpNrm: { value: bake.normal } };
  const patch = (sh, depth) => {
    Object.assign(sh.uniforms, uniforms);
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\n' + IMP_VS_HEAD).replace('#include <begin_vertex>', '#include <begin_vertex>\n' + IMP_VS_BODY);
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\n' + IMP_FS_HEAD)
      .replace('#include <map_fragment>', depth ? '{ float ia = impSample(uImpAlb, vImpW.xy).a; diffuseColor.a *= ia; }'
        : '{ vec4 ia = impSample(uImpAlb, vImpW.xy); diffuseColor *= ia; }');
    if (!depth) sh.fragmentShader = sh.fragmentShader.replace('#include <normal_fragment_maps>', /* glsl */`
  {
    vec3 nm = impSample(uImpNrm, vImpW.xy).xyz * 2.0 - 1.0;
    float c = cos(vImpYaw), s = sin(vImpYaw);
    vec3 nw = normalize(vec3(c * nm.x + s * nm.z, nm.y, -s * nm.x + c * nm.z));
    normal = normalize((viewMatrix * vec4(nw, 0.0)).xyz);
  }`);
  };
  // the quad must not be culled or flipped: the billboard always faces the viewer
  mat.onBeforeCompile = sh => patch(sh, false);
  patchVeg(mat, { fade: opts.fade });
  const depth = new THREE.MeshDepthMaterial({ alphaTest: 0.42 });
  depth.onBeforeCompile = sh => patch(sh, true);
  patchVeg(depth, { fade: opts.fade });
  const im = new THREE.InstancedMesh(geo, mat, count);
  im.customDepthMaterial = depth; im.frustumCulled = false; im.castShadow = true; im.receiveShadow = true;
  im.userData.setFast = fast => { for (const m of [mat, depth]) { const had = !!m.defines?.IMP_FAST; if (had === fast) continue; m.defines = { ...(m.defines || {}) }; if (fast) m.defines.IMP_FAST = 1; else delete m.defines.IMP_FAST; m.needsUpdate = true; } };
  return im;
}

export { bakeImpostor, makeImpostorMesh };
