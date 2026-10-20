import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// ---------- static mesh merging ----------
// Merges small, plain, opaque meshes into one mesh per material look, shadow flags and spatial cell.
// Cells keep frustum culling useful; big or special meshes are left alone.

const visibleChain = o => { for (let p = o; p; p = p.parent) if (!p.visible) return false; return true; };

function isCandidate(o) {
  if (!o.isMesh || o.isInstancedMesh || o.isSkinnedMesh) return false;
  const m = o.material, g = o.geometry;
  if (Array.isArray(m) || m.isShaderMaterial || m.isRawShaderMaterial || m.transparent) return false;
  if (o.frustumCulled === false || o.userData.noMerge) return false;
  if (o.onBeforeRender !== THREE.Object3D.prototype.onBeforeRender) return false;
  const pos = g.attributes.position;
  if (!pos || pos.count === 0 || pos.count > 20000) return false;
  if (Object.keys(g.morphAttributes).length > 0) return false;
  return visibleChain(o);
}

// Give every candidate geometry the same attribute set so neighbours can merge.
function normalise(g) {
  if (!g.attributes.normal) g.computeVertexNormals();
  if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
}

const TEX = ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'emissiveMap', 'bumpMap', 'alphaMap', 'aoMap', 'envMap'];
const hookIds = new WeakMap();
let hookN = 0;

// Material look: materials from separate std() calls with equal settings share a signature.
function matSig(m) {
  let hook = '';
  if (m.onBeforeCompile !== THREE.Material.prototype.onBeforeCompile) {
    if (!hookIds.has(m.onBeforeCompile)) hookIds.set(m.onBeforeCompile, ++hookN);
    hook = hookIds.get(m.onBeforeCompile);
  }
  const tex = TEX.map(k => (m[k] ? m[k].uuid : '')).join(',');
  return [m.type, m.color?.getHex(), m.emissive?.getHex(), m.emissiveIntensity, m.roughness, m.metalness, m.opacity,
    m.side, m.vertexColors, m.flatShading, m.alphaTest, m.fog, m.envMapIntensity, m.wireframe, m.depthWrite, tex, hook].join('|');
}

// Everything that must match for two meshes to share one merged geometry and one draw call.
function keyOf(o, cell) {
  const g = o.geometry, a = g.attributes;
  if (!g.boundingBox) g.computeBoundingBox();
  const c = g.boundingBox.clone().applyMatrix4(o.matrixWorld).getCenter(new THREE.Vector3());
  const attrs = Object.keys(a).sort().map(n => n + ':' + a[n].itemSize + ':' + a[n].normalized + ':' + a[n].array.constructor.name).join(',');
  return [matSig(o.material), o.castShadow, o.receiveShadow, o.layers.mask, o.renderOrder, !!g.index,
    o.matrixWorld.determinant() < 0, attrs, Math.floor(c.x / cell), Math.floor(c.z / cell)].join('|');
}

export function mergeStatic(scene, cell = 120) {
  scene.updateMatrixWorld(true);
  const count = () => { let n = 0; scene.traverse(o => { if (o.isMesh && o.visible) n++; }); return n; };
  const before = count();

  // how many objects in the scene use each geometry, so shared ones are not disposed
  const users = new Map();
  scene.traverse(o => { if (o.geometry) users.set(o.geometry, (users.get(o.geometry) || 0) + 1); });

  const buckets = new Map();
  scene.traverse(o => {
    if (!isCandidate(o)) return;
    normalise(o.geometry);
    const k = keyOf(o, cell);
    if (!buckets.has(k)) buckets.set(k, []);
    buckets.get(k).push(o);
  });

  const inv = new THREE.Matrix4().copy(scene.matrixWorld).invert();
  const parents = new Set();
  let merged = 0, nGroups = 0;

  for (const list of buckets.values()) {
    if (list.length < 2) continue;
    const common = list.map(o => new Set(Object.keys(o.geometry.attributes)))
      .reduce((x, y) => new Set([...x].filter(n => y.has(n))));
    const geos = list.map(o => {
      const m = new THREE.Matrix4().multiplyMatrices(inv, o.matrixWorld);
      const g = o.geometry.clone().applyMatrix4(m);
      g.clearGroups();
      for (const n of Object.keys(g.attributes)) if (!common.has(n)) g.deleteAttribute(n);
      return g;
    });
    const geo = mergeGeometries(geos, false);
    if (!geo) continue;

    const first = list[0];
    const mesh = new THREE.Mesh(geo, first.material);
    mesh.castShadow = first.castShadow;
    mesh.receiveShadow = first.receiveShadow;
    mesh.layers.mask = first.layers.mask;
    mesh.renderOrder = first.renderOrder;
    mesh.name = 'merged';
    geo.computeBoundingSphere();
    geo.computeBoundingBox();
    scene.add(mesh);

    const dropped = new Set();
    for (const o of list) {
      const g = o.geometry;
      users.set(g, users.get(g) - 1);
      dropped.add(g);
      if (o.parent) parents.add(o.parent);
      o.removeFromParent();
    }
    for (const g of dropped) if (users.get(g) === 0) g.dispose();
    merged += list.length;
    nGroups++;
  }

  // drop groups that the removals left empty
  for (const p of parents) {
    let q = p;
    while (q && q !== scene && q.isGroup && q.children.length === 0) {
      const up = q.parent;
      q.removeFromParent();
      q = up;
    }
  }

  const after = count();
  console.info(`[merge] meshes ${before} -> ${after}, ${merged} originals merged into ${nGroups} groups`);
  return { before, after, merged, groups: nGroups };
}
