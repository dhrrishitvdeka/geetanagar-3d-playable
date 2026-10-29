import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const profiles = JSON.parse(read('data/storefront_profiles.json'));

// Run the actual builders with a scene and texture placeholders, requiring no browser/GPU.
// Geometry, colors, material configuration and profile selection remain the production code.
function harness() {
  const scene = new THREE.Scene();
  const meshCode = read('src/world/bldg/mesh.js').replace(/^import .*\r?\n/gm, '').replaceAll('export class ', 'class ').replaceAll('export function ', 'function ');
  const MeshBuilder = Function('THREE', 'scene', meshCode + ';return MeshBuilder')(THREE, scene);
  const geo = read('src/core/geo.js');
  const rng = Function(geo.slice(geo.indexOf('function rng('), geo.indexOf('const hash2')) + ';return rng')();
  const hash2 = Function(geo.slice(geo.indexOf('const hash2'), geo.indexOf('// ---------- terrain heights')) + ';return hash2')();
  const document = { createElement: () => ({ getContext: () => ({ measureText: value => ({ width: value.length * 10 }) }) }) };
  const texture = () => new THREE.Texture();
  const facadeMaterials = () => ({ trim: new THREE.MeshStandardMaterial({ vertexColors: true }) });
  const source = read('src/world/shops.js').replace(/^import .*\r?\n/gm, '').replace(/^export .*;\r?\n/gm, '');
  const api = Function('THREE', 'scene', 'hAt', 'hash2', 'rng', 'addCollider', 'canvasTex', 'facadeMaterials', 'MeshBuilder', 'STOREFRONTS', 'document',
    source + ';return {buildShopfronts,SHOP_BAYS,signAtlas,_col};')(
    THREE, scene, () => 0, hash2, rng, () => {}, texture, facadeMaterials, MeshBuilder, profiles, document);
  return { ...api, scene };
}

const frontage = (id, extra = {}) => ({ buildingId: id, sign: null, pts: [[0, 0], [68, 0], [68, 10], [0, 10]], edges: [0], top: 0, wall: new THREE.Color('#cccccc'), floors: 3, ...extra });

test('surveyed sign batches share one texture per building across edges', () => {
  const api = harness();
  api.buildShopfronts([frontage(905, { edges: [0, 1] })]);
  const signs = api.scene.children.filter(o => o.material.map && o.material.roughness === 0.83);
  assert.equal(signs.length, 1);
  assert.equal(signs[0].geometry.attributes.position.count, 8);
  assert.equal(signs[0].material.side, THREE.DoubleSide);
  assert.ok(api.SHOP_BAYS.every(bay => bay.name === 'Local shop'));
});

test('surveyed awning variation does not mutate the cached base color', () => {
  const api = harness();
  api.buildShopfronts([frontage(905)]);
  assert.ok(api._col.has(profiles[905].awning), 'frontage must exercise surveyed awnings');
  assert.ok(api._col.get(profiles[905].awning).equals(new THREE.Color(profiles[905].awning)));
});

test('bank identity takes priority over a building appearance profile', () => {
  const api = harness();
  api.buildShopfronts([frontage(905, { sign: 'bank' })]);
  assert.equal(api.scene.children.filter(o => o.material.roughness === 0.83).length, 0);
  assert.equal(api.scene.children.filter(o => o.material.map === api.signAtlas).length, 1);
  assert.equal(api.SHOP_BAYS.length, 0);
});

test('surveyed shutter paint tints quads without changing cached colors or generic shutters', () => {
  const api = harness();
  api.buildShopfronts([frontage(905)]);
  const shutter = api.scene.children.find(o => o.material.metalness === 0.45);
  assert.equal(shutter.material.vertexColors, true);
  const expected = new THREE.Color(profiles[905].shutter).lerp(new THREE.Color(1, 1, 1), 0.55);
  const color = shutter.geometry.attributes.color;
  for (let i = 0; i < color.count; i++) {
    assert.ok(Math.abs(color.getX(i) - expected.r) < 1e-6);
    assert.ok(Math.abs(color.getY(i) - expected.g) < 1e-6);
    assert.ok(Math.abs(color.getZ(i) - expected.b) < 1e-6);
  }
  assert.ok(api._col.get(profiles[905].shutter).equals(new THREE.Color(profiles[905].shutter)));

  const generic = harness();
  generic.buildShopfronts([frontage(123456)]);
  const unchanged = generic.scene.children.find(o => o.material.metalness === 0.45);
  assert.ok([...unchanged.geometry.attributes.color.array].every(channel => channel === 1));
});

test('unprofiled frontage keeps atlas signs and merchant names', () => {
  const api = harness();
  api.buildShopfronts([frontage(123456)]);
  assert.equal(api.scene.children.filter(o => o.material.map === api.signAtlas).length, 1);
  assert.ok(api.SHOP_BAYS.length > 0);
  assert.ok(api.SHOP_BAYS.every(bay => bay.name !== 'Local shop'));
});

test('all configured profiles emit finite indexed geometry with matching normals', () => {
  const api = harness();
  const ids = Object.keys(profiles).filter(id => !id.startsWith('_'));
  api.buildShopfronts(ids.map(id => frontage(Number(id))));
  assert.equal(api.scene.children.filter(o => o.material.roughness === 0.83).length, ids.length);
  for (const mesh of api.scene.children) {
    const geometry = mesh.geometry, position = geometry.attributes.position;
    assert.ok([...position.array].every(Number.isFinite));
    assert.ok([...geometry.index.array].every(index => index < position.count));
    for (let i = 0; i < geometry.index.count; i += 3) {
      const indices = geometry.index.array.slice(i, i + 3);
      const [a, b, c] = [...indices].map(index => new THREE.Vector3().fromBufferAttribute(position, index));
      const face = new THREE.Vector3().subVectors(b, a).cross(new THREE.Vector3().subVectors(c, a));
      const normal = new THREE.Vector3().fromBufferAttribute(geometry.attributes.normal, indices[0]);
      assert.ok(face.dot(normal) >= -1e-6);
    }
  }
});
