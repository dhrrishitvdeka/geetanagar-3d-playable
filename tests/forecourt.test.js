import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import * as THREE from 'three';

const read = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8');
const strip = text => text.replace(/^import .*$/gm, '').replace(/^export \{.*\};?$/gm, '').replace(/export class /g, 'class ').replace(/export function /g, 'function ');
function make() {
  const meshes = [];
  const context = vm.createContext({ THREE, hAt: () => 2, scene: { add: mesh => meshes.push(mesh) }, rng: () => { let seed = 7; return () => ((seed = Math.imul(seed, 1664525) + 1013904223 >>> 0) / 4294967296); } });
  vm.runInContext(strip(read('src/world/bldg/mesh.js')), context);
  vm.runInContext(strip(read('src/world/forecourt.js')), context);
  return { context, meshes };
}

test('surveyed concrete pavilion has finite, correctly wound geometry and leaves the front entrance open', () => {
  const { context, meshes } = make();
  const result = context.buildTeaShelter(-121, -79, Math.PI / 2);
  assert.equal(result.meshes, 2);
  assert.ok(result.vertices > 500 && result.vertices < 5000);
  for (const mesh of meshes) {
    const pos = mesh.geometry.attributes.position, normals = mesh.geometry.attributes.normal, idx = mesh.geometry.index;
    assert.ok([...pos.array].every(Number.isFinite));
    assert.ok([...normals.array].every(Number.isFinite));
    assert.ok(mesh.geometry.boundingSphere.radius < 5);
    for (let k = 0; k < idx.count; k += 3) {
      const a = idx.getX(k), b = idx.getX(k + 1), c = idx.getX(k + 2);
      const A = new THREE.Vector3().fromBufferAttribute(pos, a), B = new THREE.Vector3().fromBufferAttribute(pos, b), C = new THREE.Vector3().fromBufferAttribute(pos, c);
      const cross = B.sub(A).cross(C.sub(A));
      assert.ok(cross.dot(new THREE.Vector3().fromBufferAttribute(normals, a)) > 0, 'Faces match their normals');
    }
    for (let k = 0; k < pos.count; k++) {
      // At this heading, along = east; the front is north. No waist-height fixtures span the approach.
      const x = pos.getX(k) + 121, forward = -pos.getZ(k) + 79, z = pos.getY(k) - 2;
      assert.ok(!(Math.abs(x) < 0.8 && forward > 0.4 && z > 0.1 && z < 2.3));
    }
  }
});

test('pavilion rotation preserves its footprint and repeated construction does not duplicate meshes', () => {
  for (const angle of [0, Math.PI / 3, Math.PI, -Math.PI / 2]) {
    const { context, meshes } = make();
    context.buildTeaShelter(40, 70, angle);
    const before = meshes.length;
    assert.equal(context.buildTeaShelter(40, 70, angle), undefined);
    assert.equal(meshes.length, before);
    for (const mesh of meshes) for (let i = 0; i < mesh.geometry.attributes.position.count; i++) {
      const p = mesh.geometry.attributes.position;
      assert.ok(Math.hypot(p.getX(i) - 40, p.getZ(i) + 70) < 3.1);
    }
  }
});

test('actual road alignment faces the tea interaction and clears the neighboring blue kiosks', () => {
  const { context, meshes } = make();
  const GEO = JSON.parse(read('data/geo.json'));
  GEO.roads = JSON.parse(read('data/roads.json')).roads;
  context.GEO = GEO;
  context.RF = JSON.parse(read('data/road_features.json'));
  const geom = read('src/world/geom.js');
  vm.runInContext(geom.slice(geom.indexOf('function resample('), geom.indexOf('// a strip between')), context);
  const main = strip(read('src/world/mainroad.js'));
  vm.runInContext(main.slice(0, main.indexOf('function buildMain(')), context);
  const street = read('src/world/streetlife.js');
  vm.runInContext(street.slice(street.indexOf('function beside('), street.indexOf('function buildHatigarh(')), context);
  vm.runInContext(street.split('\n').find(line => line.includes('const rf = rng(91), fore =')), context);
  const world = read('src/game/worldobjects.js');
  vm.runInContext(world.slice(world.indexOf('const roadHeading ='), world.indexOf('function toRoad(')), context);
  const { center, kiosks, interaction } = vm.runInContext(`({
    center: fore(RF.stalls.find(st => st.kind === 'tea_stall').x, 3.6),
    kiosks: RF.stalls.filter(st => st.kind === 'kiosk_blue').map(st => fore(st.x, 3.4)),
    interaction: onMain(-121, -1, 2.0)
  })`, context);
  const [x, y, angle] = center;
  context.buildTeaShelter(x, y, angle);
  const front = new THREE.Vector2(Math.cos(angle), Math.sin(angle));
  const along = new THREE.Vector2(Math.sin(angle), -Math.cos(angle));
  const local = (wx, wy) => { const delta = new THREE.Vector2(wx - x, wy - y); return [delta.dot(along), delta.dot(front)]; };
  const [customerAlong, customerForward] = local(interaction.x, interaction.y);
  assert.ok(Math.abs(customerAlong) < 0.01);
  assert.ok(customerForward > 1.55 && customerForward < 1.65, 'Existing shop marker is in front, toward the road');
  // Physical roof span along the road is at most 2.395 m either side; blue kiosk roof half-span is 1 m.
  for (const [kx, ky] of kiosks) assert.ok(Math.abs(local(kx, ky)[0]) > 3.395, 'Neighbor kiosk roofs remain separate');
  for (const offset of [-0.6, 0, 0.6]) {
    const origin = new THREE.Vector3(interaction.x + along.x * offset, 3, -interaction.y - along.y * offset);
    const direction = new THREE.Vector3(-front.x, 0, front.y);
    const ray = new THREE.Raycaster(origin, direction, 0, customerForward - 0.45);
    for (const mesh of meshes) mesh.updateMatrixWorld(true);
    assert.equal(ray.intersectObjects(meshes).length, 0, 'Customer approach stays open');
  }
});
