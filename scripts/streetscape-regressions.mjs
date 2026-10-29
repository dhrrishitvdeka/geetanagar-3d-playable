import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import * as THREE from 'three';

const read = file => readFileSync(new URL('../' + file, import.meta.url), 'utf8');
const importsRemoved = text => text.replace(/^import .*$/gm, '').replace(/^export \{.*\};?$/gm, '').replace(/export class /g, 'class ').replace(/export function /g, 'function ');
function setup(quality) {
  const GEO = JSON.parse(read('data/geo.json'));
  GEO.roads = JSON.parse(read('data/roads.json')).roads;
  const meshes = [], context = vm.createContext({ THREE, GEO, QUALITY: quality, RF: JSON.parse(read('data/road_features.json')),
    hAt: (x, y) => x * 0.001 + y * 0.002, scene: { add: mesh => meshes.push(mesh) },
    rng: () => { let n = 9061; return () => ((n = Math.imul(n, 1664525) + 1013904223 >>> 0) / 4294967296); } });
  const geom = read('src/world/geom.js');
  vm.runInContext(geom.slice(geom.indexOf('function resample('), geom.indexOf('function mergeAdd(')), context);
  const road = read('src/world/mainroad.js');
  vm.runInContext(importsRemoved(road.slice(0, road.indexOf('function buildMain('))), context);
  vm.runInContext(importsRemoved(read('src/world/bldg/mesh.js')), context);
  vm.runInContext(importsRemoved(read('src/world/streetscape.js')), context);
  return { context, meshes };
}

test('surface details follow the existing sampled path surface and avoid road openings', () => {
  const { context } = setup('high');
  vm.runInContext(`
    for (const s of [1, -1]) for (let i = 2; i < MAINP.length - 3; i++) {
      if (edgeKind(s, i) !== 'kerb' || fpHeightAt(s, i) < FP_H - 0.001 || fpHeightAt(s, i + 1) < FP_H - 0.001) continue;
      for (const q of [0.1, 0.5, 0.9]) {
        const p = surfacePoint(s, i + 0.3, q, 'path');
        if (Math.abs(p[2] - (hAt(p[0], p[1]) + FP_H + 0.005)) > 1e-6) throw Error('Path detail floats above its slab');
      }
    }
    for (const c of RF.crossings) {
      const [, i] = nearestOnMain(c.x, HAT.y);
      if (Math.abs(MAINP[i][0] - c.x) < 2.5 && clearSpan(1, i - 0.2, i + 0.4)) throw Error('Detail intersects crossing');
    }
  `, context);
});

test('all quality tiers produce finite, bounded static geometry with cheaper low settings', () => {
  const totals = [];
  for (const quality of ['low', 'medium', 'high']) {
    const { context, meshes } = setup(quality), counts = context.buildStreetscape();
    assert.ok(counts.joints > 5 && counts.drains > 0 && counts.patches > 5, JSON.stringify(counts));
    assert.ok(counts.vertices < 20000 && counts.meshes < 50, JSON.stringify(counts));
    for (const mesh of meshes) {
      assert.equal(mesh.castShadow, false);
      assert.ok([...mesh.geometry.attributes.position.array].every(Number.isFinite));
      assert.ok(mesh.geometry.boundingSphere.radius > 0);
    }
    assert.equal(context.buildStreetscape(), undefined, 'Repeated build must not duplicate geometry');
    totals.push(counts.vertices);
    console.log(quality, counts);
  }
  assert.ok(totals[0] < totals[1] && totals[1] < totals[2]);
});
