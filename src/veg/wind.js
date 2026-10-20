import * as THREE from 'three';

// ---------- shared vegetation shader state: wind, near/far crossfade, foliage shading ----------
// Every vegetation material is patched through patchVeg(), which works for MeshStandardMaterial and for the
// MeshDepthMaterial used in the shadow pass (both expose begin_vertex and clipping_planes_fragment).
const VEG_U = {
  uTime: { value: 0 },
  uWind: { value: new THREE.Vector2(0.8, 0.6) },  // map-space direction (x east, y north), length = strength
  uViewPos: { value: new THREE.Vector3() },       // main camera position, also used inside the shadow pass
  uNearR: { value: 80 },                           // near EZ-Tree models fully visible inside uNearR - uFadeW
  uFadeW: { value: 14 },
};

// opts:
//  sway:    {h, amp}  bend the whole instance by (y/h)^2 * amp * h (trees, palms)
//  attr:    true      use the per-vertex aWind (x = sway weight in metres, y = flutter weight) instead
//  flutter: number    small fast leaf motion
//  fade:    'near' | 'far'   dithered crossfade between near models and impostors
//  foliage: {center: Vector3, radius: Vector3, mix, ao}  spherical crown normals and crown-depth darkening
//  upNormals: true    don't flip normals on back faces (alpha cards lit like the canopy around them)
function patchVeg(mat, opts = {}) {
  const key = JSON.stringify(opts, (k, v) => (v && v.isVector3 ? v.toArray().map(n => +n.toFixed(3)) : v));
  const prev = mat.onBeforeCompile;
  mat.onBeforeCompile = (sh, r) => {
    if (prev) prev(sh, r);
    Object.assign(sh.uniforms, VEG_U);
    const inst = '\n#ifdef USE_INSTANCING\n  vec3 vegI = instanceMatrix[3].xyz; float vegSc = length(instanceMatrix[1].xyz);\n#else\n  vec3 vegI = vec3(0.0); float vegSc = 1.0;\n#endif\n';
    let vHead = 'uniform float uTime; uniform vec2 uWind; uniform vec3 uViewPos; uniform float uNearR; uniform float uFadeW;\nvarying float vVegFade; varying float vVegAO;\n';
    if (opts.attr) vHead += 'attribute vec2 aWind;\n';
    let vBody = inst + '  vec3 vegW = (modelMatrix * vec4(vegI, 1.0)).xyz;\n  float vegPh = dot(vegW.xz, vec2(0.071, 0.113));\n';
    vBody += '  float vegG = 0.65 + 0.35 * sin(uTime * 0.37 + vegW.x * 0.013 + vegW.z * 0.009);\n'; // slow gusts drifting across town
    vBody += '  float vegS = (sin(uTime * 1.15 + vegPh) * 0.6 + sin(uTime * 2.3 + vegPh * 1.7) * 0.25) * vegG;\n';
    // wind is given in map space (x, y) = world (x, -z); convert to the instance's local frame
    vBody += '  vec3 vegWD = vec3(uWind.x, 0.0, -uWind.y);\n#ifdef USE_INSTANCING\n  vegWD = inverse(mat3(instanceMatrix)) * vegWD;\n#endif\n';
    if (opts.sway) vBody += `  { float hy = clamp(transformed.y / ${(+opts.sway.h).toFixed(3)}, 0.0, 1.5); transformed += vegWD * (hy * hy * ${(opts.sway.amp * opts.sway.h).toFixed(4)} * vegSc * vegS); }\n`;
    if (opts.attr) vBody += '  transformed += vegWD * (aWind.x * vegS);\n';
    if (opts.flutter) {
      const w = opts.attr ? 'aWind.y' : (opts.sway ? `clamp(transformed.y / ${(+opts.sway.h).toFixed(3)}, 0.0, 1.0)` : '1.0');
      vBody += `  transformed += vec3(sin(uTime * 5.3 + dot(position, vec3(3.1, 2.3, 4.7)) + vegPh), sin(uTime * 6.1 + dot(position, vec3(2.7, 4.1, 1.9))), cos(uTime * 4.7 + dot(position, vec3(1.3, 3.7, 2.9)))) * (${(+opts.flutter).toFixed(4)} * ${w} * vegG / vegSc);\n`;
    }
    vBody += '  vVegFade = clamp((distance(vegW, uViewPos) - (uNearR - uFadeW)) / uFadeW, 0.0, 1.0);\n  vVegAO = 1.0;\n';
    if (opts.foliage) {
      const f = opts.foliage, c = `vec3(${f.center.x.toFixed(3)}, ${f.center.y.toFixed(3)}, ${f.center.z.toFixed(3)})`, rr = `vec3(${f.radius.x.toFixed(3)}, ${f.radius.y.toFixed(3)}, ${f.radius.z.toFixed(3)})`;
      vBody += `  { vec3 vegD = (position - ${c}) / ${rr}; vVegAO = mix(${(f.ao ?? 0.45).toFixed(2)}, 1.0, smoothstep(0.15, 1.0, length(vegD))); }\n`;
      // spherical normals: the crown shades like one soft volume instead of thousands of random cards
      sh.vertexShader = sh.vertexShader.replace('#include <beginnormal_vertex>', `#include <beginnormal_vertex>\n  objectNormal = normalize(mix(objectNormal, normalize(position - ${c}), ${(f.mix ?? 0.65).toFixed(2)}));`);
    }
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\n' + vHead).replace('#include <begin_vertex>', '#include <begin_vertex>\n' + vBody);
    let fHead = 'varying float vVegFade; varying float vVegAO;\nfloat vegIGN(vec2 p) { return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715)))); }\n';
    let fBody = '';
    if (opts.fade === 'near') fBody += '  if (vegIGN(gl_FragCoord.xy) < vVegFade) discard;\n';
    if (opts.fade === 'far') fBody += '  if (vegIGN(gl_FragCoord.xy) >= vVegFade) discard;\n';
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\n' + fHead).replace('#include <clipping_planes_fragment>', '#include <clipping_planes_fragment>\n' + fBody);
    if (opts.foliage && sh.fragmentShader.includes('#include <map_fragment>')) sh.fragmentShader = sh.fragmentShader.replace('#include <map_fragment>', '#include <map_fragment>\n  diffuseColor.rgb *= vVegAO;');
    if (opts.upNormals) sh.fragmentShader = sh.fragmentShader.replace('#include <normal_fragment_begin>', '#include <normal_fragment_begin>\n  normal = normalize(vNormal);\n  { vec3 vegV = normalize(vViewPosition); float vegNV = dot(normal, vegV); if (vegNV < 0.25) normal = normalize(normal + vegV * (0.25 - vegNV)); }');
  };
  mat.customProgramCacheKey = () => 'veg' + key;
  mat.needsUpdate = true;
  return mat;
}
// matching shadow-pass material for an alpha-tested, wind-swayed instanced mesh
function vegDepth(map, opts, alphaTest = 0.5) {
  const m = new THREE.MeshDepthMaterial({ map, alphaTest });
  return patchVeg(m, { ...opts, foliage: undefined, upNormals: undefined });
}
function tickVeg(t, camPos) { VEG_U.uTime.value = t; VEG_U.uViewPos.value.copy(camPos); }

export { VEG_U, patchVeg, vegDepth, tickVeg };
