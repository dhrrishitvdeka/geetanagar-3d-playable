import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { renderer, scene } from '../core/context.js';

// ================= free assets: EZ-Tree trees (MIT), Poly Haven bark & HDRI (CC0), grass, dirt, flowers, rocks =================
const ASSET = {};
async function loadAssets() {
  const tl = new THREE.TextureLoader(), gl = new GLTFLoader();
  const tex = (u, srgb = true) => new Promise(res => tl.load(u, t => { if (srgb) t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = renderer.capabilities.getMaxAnisotropy(); res(t); }, undefined, () => res(null)));
  const glb = u => new Promise(res => gl.load('assets/' + u, g => res(g), undefined, () => res(null)));
  const names = ['oak_color_1k.jpg', 'oak_normal_1k.jpg', 'birch_color_1k.jpg', 'oak_color.png', 'ash_color.png', 'aspen_color.png', 'grass.jpg', 'dirt_color.jpg', 'dirt_normal.jpg'];
  const t = await Promise.all(names.map((n, i) => tex('assets/' + n, !/normal/.test(n))));
  [ASSET.bark, ASSET.barkN, ASSET.birch, ASSET.leafOak, ASSET.leafAsh, ASSET.leafAspen, ASSET.grass, ASSET.dirt, ASSET.dirtN] = t;
  // grass.glb is no longer loaded: near grass is procedural (veg/grass.js)
  [ASSET.trees, ASSET.flowerW, ASSET.flowerY] = await Promise.all(['trees.glb', 'flower_white.glb', 'flower_yellow.glb'].map(glb));
  console.info('missing assets:', JSON.stringify(Object.entries(ASSET).filter(([k, v]) => !v).map(([k]) => k)));
  // ambient light now comes from the physical sky (world/sky.js); env.exr is kept for a later night/overcast mode
}
// merge every mesh of a loaded model into one geometry per material, normalised so its base sits at y=0
function modelParts(root) {
  root.updateMatrixWorld(true);
  const parts = new Map();
  root.traverse(o => { if (!o.isMesh) return; const g = o.geometry.clone().applyMatrix4(o.matrixWorld); for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(k)) g.deleteAttribute(k); if (!g.attributes.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2)); if (!g.index) g.setIndex([...Array(g.attributes.position.count).keys()]); const key = o.material; (parts.get(key) || parts.set(key, []).get(key)).push(g); });
  const out = []; const bb = new THREE.Box3();
  for (const [mat, gs] of parts) { const g = mergeGeometries(gs, false); g.computeBoundingBox(); bb.union(g.boundingBox); out.push({ geo: g, mat }); }
  for (const p of out) p.geo.translate(-(bb.min.x + bb.max.x) / 2, -bb.min.y, -(bb.min.z + bb.max.z) / 2);
  return { parts: out, h: bb.max.y - bb.min.y, w: Math.max(bb.max.x - bb.min.x, bb.max.z - bb.min.z) };
}

export { loadAssets, modelParts, ASSET };
