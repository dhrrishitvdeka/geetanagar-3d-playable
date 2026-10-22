import * as THREE from 'three';
import { $, renderer, scene } from '../core/context.js';
import { rng } from '../core/geo.js';
import * as T from './road/textures.js';
import { QUALITY } from '../render/quality.js';

function canvasTex(w, h, draw, repeat = true) {
  const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = Math.min(renderer.capabilities.getMaxAnisotropy(), QUALITY === 'low' ? 4 : QUALITY === 'medium' ? 8 : Infinity);
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping; return t;
}
function speckle(g, w, h, n, cols, size = 1.6) { const r = rng(n); for (let i = 0; i < n; i++) { g.fillStyle = cols[Math.floor(r() * cols.length)]; const s = r() * size + 0.4; g.fillRect(r() * w, r() * h, s, s); } }
const TEX = {
  asphalt: canvasTex(512, 512, (g, w, h) => { // worn grey asphalt with aggregate and patch repairs
    g.fillStyle = '#6b6d70'; g.fillRect(0, 0, w, h);
    const r = rng(5);
    for (let i = 0; i < 26; i++) { g.fillStyle = r() < 0.5 ? 'rgba(40,42,46,0.16)' : 'rgba(150,150,150,0.10)'; g.beginPath(); g.ellipse(r() * w, r() * h, 20 + r() * 70, 14 + r() * 40, r() * 3, 0, 7); g.fill(); }
    speckle(g, w, h, 26000, ['#55575b', '#7a7c7f', '#8c8c8a', '#4a4c50', '#636568']);
  }),
  paver: canvasTex(256, 256, (g, w, h) => { // interlocking footpath tiles, grey and terracotta
    const r = rng(8), tw = 32, th = 64;
    for (let y = 0; y < h; y += th) for (let x = 0; x < w; x += tw) {
      const red = ((x / tw + y / th) % 4 === 0); const v = 0.9 + r() * 0.15;
      g.fillStyle = red ? `rgb(${168 * v},${96 * v},${80 * v})` : `rgb(${176 * v},${172 * v},${164 * v})`; g.fillRect(x + 1, y + 1, tw - 2, th - 2);
    }
    g.fillStyle = 'rgba(60,55,50,0.35)'; for (let i = 0; i < 40; i++) g.fillRect(r() * w, r() * h, 3 + r() * 10, 2 + r() * 6);
    speckle(g, w, h, 3000, ['rgba(0,0,0,0.15)', 'rgba(255,255,255,0.12)']);
  }),
  footSlab: canvasTex(256, 256, (g, w, h) => { // grey concrete slab footpath, 1 m per tile (world UV = 1): a joint every metre, wear and speckle
    const r = rng(12);
    g.fillStyle = '#bdb9af'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 60; i++) { g.fillStyle = r() < 0.5 ? 'rgba(90,84,74,0.10)' : 'rgba(235,230,220,0.12)'; g.beginPath(); g.ellipse(r() * w, r() * h, 10 + r() * 40, 8 + r() * 24, r() * 3, 0, 7); g.fill(); }
    speckle(g, w, h, 3500, ['#9d998f', '#cfcbc1', '#a8a398', '#8f8b82']);
    g.fillStyle = '#8a867d'; g.fillRect(0, 0, 4, h); g.fillRect(0, 0, w, 4);
  }),
  speedBreaker: canvasTex(64, 8, (g, w, h) => { // yellow and black bands across a speed breaker: one repeat = 0.7 m along the road
    g.fillStyle = '#e8b81c'; g.fillRect(0, 0, w / 2, h); g.fillStyle = '#1d1e20'; g.fillRect(w / 2, 0, w / 2, h);
    speckle(g, w, h, 60, ['rgba(110,92,70,0.35)', 'rgba(0,0,0,0.2)']);
  }),
  kerb: canvasTex(256, 32, (g, w, h) => { // the black-and-white painted kerb seen all along Mother Teresa Rd
    for (let x = 0; x < w; x += 64) { g.fillStyle = '#e9e8e2'; g.fillRect(x, 0, 32, h); g.fillStyle = '#1f2124'; g.fillRect(x + 32, 0, 32, h); }
    speckle(g, w, h, 900, ['rgba(120,100,80,0.35)', 'rgba(0,0,0,0.25)']);
  }),
  earth: canvasTex(512, 512, (g, w, h) => { // bare red-brown earth of Geetanagar Field
    g.fillStyle = '#a4704c'; g.fillRect(0, 0, w, h);
    const r = rng(12);
    for (let i = 0; i < 60; i++) { g.fillStyle = r() < 0.5 ? 'rgba(130,85,55,0.25)' : 'rgba(190,140,100,0.22)'; g.beginPath(); g.ellipse(r() * w, r() * h, 20 + r() * 60, 10 + r() * 40, r() * 3, 0, 7); g.fill(); }
    speckle(g, w, h, 20000, ['#8e5f40', '#b8845d', '#9b6848', '#c39672', '#7d5537']);
  }),
  lawn: canvasTex(256, 256, (g, w, h) => {
    g.fillStyle = '#6f9a4a'; g.fillRect(0, 0, w, h);
    for (let x = 0; x < w; x += 64) { g.fillStyle = 'rgba(255,255,255,0.05)'; g.fillRect(x, 0, 32, h); }
    speckle(g, w, h, 14000, ['#5f8a3e', '#7fae55', '#557d38', '#8ab862', '#6a8f45']);
  }),
  soil: canvasTex(256, 256, (g, w, h) => { // dark watered soil of the median beds
    g.fillStyle = '#5a4634'; g.fillRect(0, 0, w, h); speckle(g, w, h, 9000, ['#4a3a2b', '#6b5440', '#3f3226', '#56603a', '#7a6650'], 2);
  }),
  brick: canvasTex(128, 64, (g, w, h) => {
    g.fillStyle = '#d9cdbd'; g.fillRect(0, 0, w, h); const r = rng(3);
    for (let y = 0; y < h; y += 8) for (let x = (y / 8) % 2 ? -8 : 0; x < w; x += 16) { const v = 0.85 + r() * 0.25; g.fillStyle = `rgb(${170 * v},${70 * v},${50 * v})`; g.fillRect(x + 1, y + 1, 14, 6); }
  }),
};
// PBR-ish procedural sets (colour + roughness + bump) from road/textures.js
const PBR = { asphalt: T.asphalt(), shoulder: T.shoulder(), kerb: T.kerb(), concrete: T.concrete(), brick: T.brick(), kerbGreen: T.kerb('#4d7348'), footKerb: T.kerb('#f3f1ea', 0.3), pole: T.concrete(131, '#b3afa6') };
const rep = (set, x, y) => { for (const k of ['map', 'roughnessMap', 'bumpMap']) if (set[k]) set[k].repeat.set(x, y); return set; };
const M = {
  // world-UV strips use 1 unit = 6 m for asphalt, so the 8 m texture is scaled by 6/8
  asphalt: new THREE.MeshStandardMaterial({ ...rep(PBR.asphalt, 0.75, 0.75), bumpScale: 1.2, roughness: 1, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }),
  dust: new THREE.MeshStandardMaterial({ map: T.dustEdge(), transparent: true, depthWrite: false, roughness: 1, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 }),
  shoulder: new THREE.MeshStandardMaterial({ ...PBR.shoulder, bumpScale: 1.5, roughness: 1, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -1.5, polygonOffsetUnits: -1.5 }),
  // lanes: pale, dusty, older asphalt (~sRGB 120-135) and reddish-brown dust verges (~sRGB 140,115,90)
  laneAsphalt: new THREE.MeshStandardMaterial({ map: PBR.asphalt.map, roughnessMap: PBR.asphalt.roughnessMap, bumpMap: PBR.asphalt.bumpMap, bumpScale: 1, color: new THREE.Color(1.55, 1.52, 1.47), roughness: 1, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }),
  laneConcrete: new THREE.MeshStandardMaterial({ ...PBR.concrete, color: new THREE.Color(1.18, 1.16, 1.12), bumpScale: 1, roughness: 1, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }),
  verge: new THREE.MeshStandardMaterial({ map: PBR.shoulder.map, roughnessMap: PBR.shoulder.roughnessMap, bumpMap: PBR.shoulder.bumpMap, bumpScale: 1.5, color: new THREE.Color(1.12, 0.86, 0.66), roughness: 1, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -1.5, polygonOffsetUnits: -1.5 }),
  laneDust: null,
  edge: new THREE.MeshStandardMaterial({ color: '#b6b0a2', roughness: 0.95, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }),
  paver: new THREE.MeshStandardMaterial({ map: TEX.paver, roughness: 0.9, side: THREE.DoubleSide }),
  speedBreaker: new THREE.MeshStandardMaterial({ map: TEX.speedBreaker, roughness: 0.85, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 }),
  footSlab: new THREE.MeshStandardMaterial({ map: TEX.footSlab, roughness: 0.95, side: THREE.DoubleSide }),
  kerb: new THREE.MeshStandardMaterial({ ...PBR.kerb, bumpScale: 1, roughness: 1, side: THREE.DoubleSide }),
  footKerb: new THREE.MeshStandardMaterial({ ...PBR.footKerb, color: new THREE.Color(1.3, 1.3, 1.3), emissive: new THREE.Color(1, 1, 1), emissiveMap: PBR.footKerb.map, emissiveIntensity: 0.45, bumpScale: 1, roughness: 1, side: THREE.DoubleSide }), // the footpath's painted face is 0.4 m tall and the south side's is always in shadow: fresher paint, lifted by its own map so the white blocks still read
  kerbGreen: new THREE.MeshStandardMaterial({ ...PBR.kerbGreen, bumpScale: 1, roughness: 1, side: THREE.DoubleSide }),
  concrete: new THREE.MeshStandardMaterial({ ...PBR.concrete, bumpScale: 1.5, roughness: 1 }),
  poleConcrete: new THREE.MeshStandardMaterial({ ...PBR.pole, bumpScale: 1, roughness: 1 }),
  median: new THREE.MeshStandardMaterial({ map: TEX.soil, roughness: 1, side: THREE.DoubleSide }),
  earth: new THREE.MeshStandardMaterial({ map: TEX.earth, roughness: 1, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 }),
  lawn: new THREE.MeshStandardMaterial({ map: TEX.lawn, roughness: 1, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 }),
  brick: new THREE.MeshStandardMaterial({ ...PBR.brick, bumpScale: 2, roughness: 1 }),
  black: new THREE.MeshStandardMaterial({ color: '#1d1e20', roughness: 0.55, metalness: 0.5 }),
  railInfill: new THREE.MeshStandardMaterial({ color: '#1d1e20', map: T.railBars(), alphaTest: 0.5, alphaToCoverage: QUALITY !== 'low', side: THREE.DoubleSide, roughness: 0.55, metalness: 0.5 }),
  fieldPanel: new THREE.MeshStandardMaterial({ map: T.fieldPanel(), roughness: 0.7, metalness: 0.2 }),
  // Baikuntha Rd side of the field: brick wall painted terracotta red, chain-link above it (Street View, Mar 2026)
  redWall: new THREE.MeshStandardMaterial({ ...PBR.concrete, color: '#c4604a', bumpScale: 1.5, roughness: 1 }),
  chainLink: new THREE.MeshStandardMaterial({ color: '#9aa0a3', map: T.chainLink(), alphaTest: 0.5, alphaToCoverage: QUALITY !== 'low', side: THREE.DoubleSide, roughness: 0.5, metalness: 0.6 }),
  yellow: new THREE.MeshStandardMaterial({ color: '#d9b62b', roughness: 0.6, metalness: 0.2 }),
  maroon: new THREE.MeshStandardMaterial({ color: '#7d2630', roughness: 0.6 }),
  white: new THREE.MeshStandardMaterial({ color: '#f1efe8', roughness: 0.8 }),
  steel: new THREE.MeshStandardMaterial({ color: '#8e9499', roughness: 0.4, metalness: 0.6 }),
};
// road anti-tiling: the asphalt texture repeats every 8 m, so a slow world-space value noise (a patch every ~20 m, plus a finer one) varies its brightness by +-12%.
// terrain.js does the same with its noise texture; this one is procedural so the road materials need no extra sampler.
function antiTile(m) {
  const prev = m.onBeforeCompile;
  m.onBeforeCompile = function (sh) {
    if (prev) prev.call(this, sh);
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vAT;').replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvAT = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>
varying vec3 vAT;
float atH(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float atN(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f); return mix(mix(atH(i), atH(i + vec2(1.0, 0.0)), f.x), mix(atH(i + vec2(0.0, 1.0)), atH(i + vec2(1.0, 1.0)), f.x), f.y); }`)
      .replace('#include <map_fragment>', '#include <map_fragment>\ndiffuseColor.rgb *= 0.88 + 0.24 * (atN(vAT.xz * 0.05) * 0.65 + atN(vAT.xz * 0.21) * 0.35);');
  };
  m.customProgramCacheKey = () => (m.userData.pck || 'std') + 'antitile';
}
antiTile(M.asphalt); antiTile(M.laneAsphalt);
M.laneDust = M.dust.clone(); M.laneDust.color = new THREE.Color(1.08, 0.88, 0.7); // the lane edges fade into reddish dust
const box = (w, h, d, mat) => new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
const std = (color, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.75, ...extra });
const MAT = {
  temple: std('#f4f1ea', { roughness: 0.6 }), pink: std('#e8a29c'), saffron: std('#e98a35'), gold: std('#d6a73a', { metalness: 0.6, roughness: 0.35 }),
  niche: std('#3b2d2a'), lion: std('#e68a2e'), grey: std('#9ea3a6', { metalness: 0.5, roughness: 0.4 }), stone: std('#cfc9bd'), earth: std('#8a6a4c', { roughness: 1 }),
  tin: std('#7c8a96', { metalness: 0.4, roughness: 0.5 }), wood: std('#7a5532'),
};
function place(m, x, y, z, rot = 0) { m.position.set(x, z, -y); m.rotation.y = rot; m.castShadow = true; m.receiveShadow = true; scene.add(m); return m; }

export { canvasTex, speckle, place, TEX, M, box, std, MAT, PBR };
