import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { inflateSync } from 'node:zlib';

const read = file => readFileSync(new URL('../' + file, import.meta.url), 'utf8');
const geo = read('src/core/geo.js');
const hash2 = Function(geo.slice(geo.indexOf('const hash2'), geo.indexOf('// ---------- terrain heights')) + ';return hash2')();
const pointInPoly = Function(geo.slice(geo.indexOf('function pointInPoly('), geo.indexOf('export {')) + ';return pointInPoly')();

function fixtures(count = 1, floors = 3) {
  const buildings = [], built = [], roofs = [];
  for (let i = 0; i < count; i++) {
    const x = (i % 20) * 22, y = Math.floor(i / 20) * 22;
    const p = [[x, y], [x + 10, y], [x + 10, y + 10], [x, y + 10]], c = [x + 5, y + 5];
    buildings.push({ p, c, a: 100, d: 60, k: 0 });
    built.push({ c, top: floors * 3.1, floors });
    if (floors > 1) roofs.push({ c, pts: p, E: p.map(() => ({ hid: -Infinity })), z1: floors * 3.1 });
  }
  return { buildings, built, roofs };
}

function harness(data, quality = 'high', heightAt = () => 0, classAt = () => 0) {
  const scene = new THREE.Scene();
  const meshCode = read('src/world/bldg/mesh.js').replace(/^import .*\r?\n/gm, '').replaceAll('export class ', 'class ').replaceAll('export function ', 'function ');
  const { MeshBuilder, simplifyRing } = Function('THREE', 'scene', meshCode + ';return {MeshBuilder,simplifyRing}')(THREE, scene);
  const src = read('src/world/residential.js').replace(/^import .*\r?\n/gm, '').replace(/^export .*;\r?\n/gm, '');
  const api = Function('THREE', 'GEO', 'hAt', 'clsAt', 'hash2', 'pointInPoly', 'QUALITY', 'BLD', 'ROOFS', 'MeshBuilder', 'simplifyRing', 'LANDMARK_STYLE', 'OVERRIDES',
    src + ';return {buildResidentialDetails,planResidentialDetails,BUDGETS};')(
    THREE, { buildings: data.buildings }, heightAt, classAt, hash2, pointInPoly, quality, data.built, data.roofs, MeshBuilder, simplifyRing, new Map(), {});
  return { ...api, scene };
}

test('deterministic quality budgets are nested and Low builds less geometry', () => {
  const data = fixtures(320), runs = {};
  for (const quality of ['low', 'medium', 'high']) {
    const api = harness(data, quality), plan = api.planResidentialDetails();
    assert.equal(plan.length, api.BUDGETS[quality]);
    runs[quality] = { plan, count: api.buildResidentialDetails() };
    assert.deepEqual(api.planResidentialDetails().map(p => p.center), plan.map(p => p.center));
  }
  assert.deepEqual(runs.low.plan.map(p => p.center), runs.high.plan.slice(0, 36).map(p => p.center));
  assert.deepEqual(runs.medium.plan.map(p => p.center), runs.high.plan.slice(0, 120).map(p => p.center));
  assert.ok(runs.low.count.vertices < runs.medium.count.vertices);
  assert.equal(runs.low.count.condensers, 0);
});

test('occupied setbacks, roads, parks and steep ground prevent facade assemblies', () => {
  const data = fixtures();
  for (const cls of [1, 4, 5]) assert.equal(harness(data, 'high', () => 0, () => cls).planResidentialDetails().length, 0);
  assert.equal(harness(data, 'high', (x, y) => x * 2 + y * 2).planResidentialDetails().length, 0);
  const wall = data.buildings[0];
  data.buildings.push({ p: [[-2, -2], [12, -2], [12, 12], [-2, 12]], c: [5, 5], a: 196, d: 60, k: 0 });
  assert.equal(harness(data).planResidentialDetails().filter(p => p.source === wall).length, 0);
});

test('services attach to the exact built roof and follow local terrain', () => {
  const data = fixtures();
  const h = (x, y) => 0.02 * x + 0.03 * y;
  const api = harness(data, 'high', h), [entry] = api.planResidentialDetails();
  assert.equal(entry.top, data.built[0].top);
  const x = entry.a[0] + entry.u[0] * (entry.length - 0.35), y = entry.a[1] + entry.u[1] * (entry.length - 0.35);
  assert.equal(entry.pipeGround, h(x, y));
  assert.equal(entry.flat, true);
  assert.equal(api.buildResidentialDetails().flatRoofDrains, 1);
});

test('tin-house eaves stay separate from unfinished flat construction', () => {
  const tin = harness(fixtures(1, 1));
  assert.equal(tin.buildResidentialDetails().eaveDrains, 1);
  const unfinished = fixtures(1, 3); unfinished.roofs = [];
  assert.equal(harness(unfinished).planResidentialDetails().length, 0);
});

test('idempotent spatial batches have finite geometry, valid indices and matching winding', () => {
  const api = harness(fixtures(80));
  const first = api.buildResidentialDetails(), meshes = api.scene.children.length;
  assert.equal(api.buildResidentialDetails(), first);
  assert.equal(api.scene.children.length, meshes);
  assert.ok(meshes <= 2 * 80);
  assert.ok(api.scene.children.every(mesh => mesh.name.startsWith('residential_')));
  assert.equal(new Set(api.scene.children.map(mesh => mesh.material)).size, 2);
  for (const mesh of api.scene.children) {
    const g = mesh.geometry, position = g.attributes.position;
    assert.ok([...position.array].every(Number.isFinite));
    assert.ok([...g.index.array].every(i => i < position.count));
    for (let i = 0; i < g.index.count; i += 3) {
      const ids = g.index.array.slice(i, i + 3), [a, b, c] = [...ids].map(id => new THREE.Vector3().fromBufferAttribute(position, id));
      const cross = new THREE.Vector3().subVectors(b, a).cross(new THREE.Vector3().subVectors(c, a));
      assert.ok(cross.dot(new THREE.Vector3().fromBufferAttribute(g.attributes.normal, ids[0])) >= -1e-6);
    }
  }
  console.log('Residential geometry:', first);
});

test('real patched footprints, terrain and class raster leave usable clear service placements', () => {
  const data = JSON.parse(read('data/geo.json')), fixes = JSON.parse(read('data/footprint_fixes.json'));
  for (const [index, fix] of Object.entries(fixes.replace)) Object.assign(data.buildings[index], fix);
  data.buildings.push(...fixes.append);
  for (const index of Object.keys(fixes.skip)) data.buildings[index].p = [];
  const HG = JSON.parse(read('data/terrain.json')).hgrid, bytes = Buffer.from(HG.b64, 'base64');
  const HV = Float32Array.from(new Uint16Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 2), value => value / 10);
  const heightAt = Function('HG', 'HV', geo.slice(geo.indexOf('function hAtBase('), geo.indexOf('// ---------- class map')) + ';return hAtBase')(HG, HV);
  // Decode the project's exact 8-bit grayscale class PNG, including all PNG row filters.
  const png = readFileSync(new URL('../data/cls.png', import.meta.url)), chunks = [];
  const width = png.readUInt32BE(16), height = png.readUInt32BE(20);
  assert.equal(png[24], 8); assert.equal(png[25], 0);
  for (let offset = 8; offset < png.length;) {
    const size = png.readUInt32BE(offset);
    if (png.toString('ascii', offset + 4, offset + 8) === 'IDAT') chunks.push(png.subarray(offset + 8, offset + 8 + size));
    offset += size + 12;
  }
  const raw = inflateSync(Buffer.concat(chunks)), raster = new Uint8Array(width * height);
  const paeth = (a, b, c) => { const p = a + b - c, da = Math.abs(p - a), db = Math.abs(p - b), dc = Math.abs(p - c); return da <= db && da <= dc ? a : db <= dc ? b : c; };
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (width + 1)];
    for (let x = 0; x < width; x++) {
      const i = y * width + x, left = x ? raster[i - 1] : 0, up = y ? raster[i - width] : 0, corner = x && y ? raster[i - width - 1] : 0;
      raster[i] = raw[y * (width + 1) + x + 1] + [0, left, up, Math.floor((left + up) / 2), paeth(left, up, corner)][filter];
    }
  }
  const classAt = (x, y) => {
    const ix = Math.floor((x - data.bounds[0]) / data.res), iy = Math.floor((data.bounds[3] - y) / data.res);
    return ix < 0 || iy < 0 || ix >= width || iy >= height ? 9 : raster[iy * width + ix];
  };
  // Attach fixture roof heights to actual footprints: this tests clearance against real
  // map data without pretending to reproduce the browser's complete massing/landmarks.
  const built = data.buildings.filter(b => b.p.length >= 3).map(b => ({ c: b.c, top: Math.max(...b.p.map(p => heightAt(...p))) + 3.1, floors: 1 }));
  const api = harness({ buildings: data.buildings, built, roofs: [] }, 'high', heightAt, classAt);
  const plan = api.planResidentialDetails();
  assert.ok(plan.length > 10, 'real world should retain clear side-lane houses');
  for (const p of plan) {
    assert.ok(p.source.d >= 35);
    assert.ok(p.groundMax - p.groundMin <= 0.8);
    for (let t = 0; t <= 1; t += 0.125) {
      const al = p.length - 2.65 + t * 2.43;
      const x = p.a[0] + p.u[0] * al + p.n[0] * 0.55, y = p.a[1] + p.u[1] * al + p.n[1] * 0.55;
      assert.ok(![1, 2, 3, 4, 5].includes(classAt(x, y)));
    }
  }
  console.log('Real footprint/raster clear placements:', plan.length);
});
