import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import * as THREE from 'three';

// Load the pure planning section without importing browser renderer/context initialization.
const source = readFileSync(new URL('../src/world/outer.js', import.meta.url), 'utf8');
const pure = source.slice(source.indexOf('function outerPlanHash('), source.indexOf('function buildOuter('));
const { planOuterBuildings, outerPieceTransform } = await import('data:text/javascript,' + encodeURIComponent(pure + '\nexport { planOuterBuildings, outerPieceTransform };'));
const bounds = { x0: -845, x1: 510, y0: -610, y1: 425 };
const inputs = { bounds, heightAt: () => 0, densityAt: () => 0.65 };
const high = planOuterBuildings(inputs);

test('outer plans are reproducible, capped, and contain varied coherent house forms', () => {
  assert.deepEqual(planOuterBuildings(inputs), high);
  assert.ok(high.length > 1000 && high.length <= 7000);
  assert.ok(high.some(b => b.pitched));
  assert.ok(high.some(b => b.stepped && b.detail));
  const angles = new Map();
  for (const b of high) {
    const cluster = b.id.split(':').slice(0, 2).join(':');
    if (angles.has(cluster)) assert.equal(b.angle, angles.get(cluster));
    angles.set(cluster, b.angle);
  }
});

test('entire footprints and their eaves stay beyond the surveyed area', () => {
  for (const b of high) {
    const distance = Math.hypot(Math.max(bounds.x0 - b.x, 0, b.x - bounds.x1), Math.max(bounds.y0 - b.y, 0, b.y - bounds.y1));
    assert.ok(distance >= b.radius + 6, b.id);
    assert.ok(Math.hypot(b.x, b.y) + b.radius <= 2300);
  }
});

test('house footprints have a conservative gap even across cluster boundaries', () => {
  const cells = new Map();
  for (const b of high) {
    const cx = Math.floor(b.x / 48), cy = Math.floor(b.y / 48);
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
      for (const other of cells.get(`${cx + dx},${cy + dy}`) || []) {
        assert.ok(Math.hypot(b.x - other.x, b.y - other.y) >= b.radius + other.radius + 1.5, `${b.id}, ${other.id}`);
      }
    }
    const key = `${cx},${cy}`;
    if (!cells.has(key)) cells.set(key, []);
    cells.get(key).push(b);
  }
});

test('low and medium retain unchanged nested subsets of the high layout', () => {
  const medium = planOuterBuildings({ ...inputs, quality: 'medium' });
  const low = planOuterBuildings({ ...inputs, quality: 'low' });
  const byId = new Map(high.map(b => [b.id, b])), mediumIds = new Set(medium.map(b => b.id));
  assert.ok(low.length < medium.length && medium.length < high.length);
  for (const b of medium) assert.deepEqual(b, byId.get(b.id));
  for (const b of low) { assert.ok(mediumIds.has(b.id)); assert.deepEqual(b, byId.get(b.id)); }
});

test('high terrain and sharp slopes remain unbuilt', () => {
  assert.equal(planOuterBuildings({ ...inputs, heightAt: () => 11 }).length, 0);
  assert.equal(planOuterBuildings({ ...inputs, heightAt: x => x * 0.8 }).length, 0);
});

test('instance transforms are finite, positive, and correctly rotate local offsets', () => {
  const dm = new THREE.Object3D();
  for (const b of high) {
    const tr = outerPieceTransform(b, b.width * 0.2, b.floors * 3.1, b.depth * 0.15, b.width * 0.7, 0.55, b.depth * 0.6);
    assert.ok([...tr.position, ...tr.scale, tr.angle].every(Number.isFinite));
    assert.ok(tr.scale.every(n => n > 0));
    dm.position.fromArray(tr.position); dm.scale.fromArray(tr.scale); dm.rotation.set(0, tr.angle, 0); dm.updateMatrix();
    assert.ok(dm.matrix.elements.every(Number.isFinite));
  }
  const tr = outerPieceTransform({ x: 10, y: 20, ground: 3, angle: Math.PI / 2 }, 2, 4, 5, 1, 1, 1);
  assert.ok(Math.abs(tr.position[0] - 15) < 1e-9);
  assert.deepEqual(tr.position.slice(1), [7, -22]);
});

test('real-terrain scene construction stays within sixteen batches with finite instances and nested tree presets', () => {
  const terrain = JSON.parse(readFileSync(new URL('../data/terrain.json', import.meta.url), 'utf8'));
  const HG = terrain.hgrid, bytes = Buffer.from(HG.b64, 'base64');
  const hAt = (x, y) => {
    const fx = Math.max(0, Math.min(HG.nx - 1.001, (x - HG.x0) / HG.step));
    const fy = Math.max(0, Math.min(HG.ny - 1.001, (y - HG.y0) / HG.step));
    const i = Math.floor(fx), j = Math.floor(fy), u = fx - i, v = fy - j;
    const h = (a, b) => bytes.readUInt16LE((b * HG.nx + a) * 2) / 10;
    return (h(i, j) * (1 - u) + h(i + 1, j) * u) * (1 - v) + (h(i, j + 1) * (1 - u) + h(i + 1, j + 1) * u) * v;
  };
  const geo = readFileSync(new URL('../src/core/geo.js', import.meta.url), 'utf8');
  const seeded = geo.slice(geo.indexOf('function rng('), geo.indexOf('// ---------- terrain heights'));
  const { rng, hash2 } = Function(seeded + ';return {rng, hash2};')();
  const code = source.replace(/^import .*\r?\n/gm, '').replace(/export \{[^}]*\};/, 'return { buildOuter, OUTER_TREES };');
  const trees = [];
  for (const q of ['low', 'medium', 'high']) {
    const objects = [];
    const mod = Function('THREE', 'scene', 'HG', 'HGX1', 'HGY1', 'TERRAIN', 'hAt', 'hash2', 'rng', 'getNoiseTex', 'quality', code)(
      THREE, { add: mesh => objects.push(mesh) }, HG, HG.x0 + (HG.nx - 1) * HG.step,
      HG.y0 + (HG.ny - 1) * HG.step, terrain, hAt, hash2, rng, () => null, () => q);
    mod.buildOuter();
    const batches = objects.filter(m => m.isInstancedMesh);
    assert.ok(batches.length > 0 && batches.length <= 16);
    for (const mesh of batches) {
      assert.ok(mesh.instanceMatrix.array.every(Number.isFinite));
      assert.ok(Number.isFinite(mesh.boundingSphere.radius));
      mesh.geometry.dispose(); mesh.material.dispose();
    }
    assert.ok(mod.OUTER_TREES.length <= 12000);
    assert.ok(mod.OUTER_TREES.every(t => t.length === 5 && [t[0], t[1], t[2], t[4]].every(Number.isFinite)));
    trees.push(new Set(mod.OUTER_TREES.map(t => t.join(':'))));
  }
  for (const id of trees[0]) assert.ok(trees[1].has(id));
  for (const id of trees[1]) assert.ok(trees[2].has(id));
});
