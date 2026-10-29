import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';
import vm from 'node:vm';
import test from 'node:test';
import * as THREE from 'three';

const read = file => readFileSync(new URL('../' + file, import.meta.url), 'utf8');
const withoutImports = source => source.replace(/^import .*$/gm, '').replace(/^export \{.*\};?$/gm, '').replace(/export class /g, 'class ').replace(/export function /g, 'function ');
const geom = read('src/world/geom.js');
const helpers = geom.slice(geom.indexOf('function resample('), geom.indexOf('// a strip between'));
const polygon = (x, y, poly) => { let inside = false; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
  const a = poly[i], b = poly[j]; if ((a[1] > y) !== (b[1] > y) && x < (b[0] - a[0]) * (y - a[1]) / (b[1] - a[1]) + a[0]) inside = !inside;
} return inside; };
function setup({ quality = 'high', GEO, hAt, clsAt, gates = [], mainDistance = () => [1000, 0], width = r => r.w }) {
  const meshes = [], context = vm.createContext({ THREE, GEO, QUALITY: quality, hAt, clsAt, GATE_POSTS: gates,
    laneWidth: width, nearestOnMain: mainDistance, MAINP: [[-1000, -1000]], hw: () => 13.5, pointInPoly: polygon,
    hash2: (x, y) => { const v = Math.sin(x * 127.1 + y * 311.7) * 43758.5453; return v - Math.floor(v); },
    scene: { add: mesh => meshes.push(mesh) } });
  vm.runInContext(helpers, context);
  vm.runInContext(withoutImports(read('src/world/bldg/mesh.js')), context);
  vm.runInContext(withoutImports(read('src/world/lanedetails.js')), context);
  return { context, meshes };
}
function fixture(flat = false) {
  return { GEO: { roads: [{ p: [[0, 100], [100, 100]], w: 4, name: 'Test Lane' }, { p: [[70, 100], [70, 130]], w: 4 }],
    fieldPoly: [[1000, 1000], [1001, 1000], [1000, 1001]], parkPoly: [[1100, 1100], [1101, 1100], [1100, 1101]] },
    hAt: flat ? () => 0 : (_x, y) => -0.4 * (y - 100),
    clsAt: (x, y) => x < 50 && y > 102.3 && y < 103.1 ? 2 : 0,
    gates: [{ x: 30, y: 103.7, hg: 1.5, lane: true, open: true }] };
}
test('retaining faces require downhill terrain; existing drains and open driveways get coherent details', () => {
  const { context, meshes } = setup(fixture()), stat = context.buildLaneDetails();
  assert.ok(stat.drainSegments > 0 && stat.retainingSegments > 0 && stat.bridges === 1, JSON.stringify(stat));
  const flat = setup(fixture(true)).context.buildLaneDetails();
  assert.equal(flat.retainingSegments, 0, 'Flat ground cannot justify a retaining face');
  assert.ok(meshes.length > 0);
  for (const mesh of meshes.filter(m => m.name.includes('_raised_'))) {
    const p = mesh.geometry.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), y = -p.getZ(i);
      if (Math.abs(y - 100) < 5) assert.ok(Math.abs(y - 100) >= 2 - 1e-4, 'Raised detail intrudes into lane');
      assert.ok(!(x > 28.5 && x < 31.5 && y > 102), 'Raised detail blocks an existing gate approach');
      assert.ok(!(Math.abs(x - 70) < 2 && y > 100 && y < 130), 'Raised detail crosses another lane');
    }
  }
  assert.equal(context.buildLaneDetails(), undefined, 'Builder must be idempotent');
});

test('drain ribbons track existing strip heights and bridges remain shallow', () => {
  const { context } = setup(fixture());
  vm.runInContext(`
    const lane = { P: [[0,100],[2,100]], N: [[0,1],[0,1]], w: 4 };
    for (const q of [0, 0.2, 0.8, 1]) {
      const p = drainPoint(lane, 0, 1, q, 0.007);
      if (Math.abs(p[2] - hAt(p[0],p[1]) - 0.057) > 1e-6) throw Error('Drain floats off existing strip');
      const b = bridgePoint(lane, 0.4, 1, q);
      if (Math.abs(b[2] - hAt(b[0],b[1]) - 0.077) > 1e-6) throw Error('Bridge height changes approach clearance');
    }
  `, context);
});

test('seams follow the source triangles on nonlinear terrain rather than sampling terrain below the decal', () => {
  const { context } = setup({ ...fixture(), hAt: (x, y) => x * y * 0.1 });
  vm.runInContext(`
    const lane = { P: [[0,100],[2,100]], N: [[0,1],[0,1]], w: 4 };
    const p = laneSurfacePoint(lane, 0.4, 0.3);
    // First source triangle: A=(0,98,.07), B=(0,102,.07), C=(2,98,19.67).
    if (Math.abs(p[2] - (19.6 * 0.4 + 0.082)) > 1e-6) throw Error('Seam does not follow the source triangle');
    if (Math.abs(p[2] - hAt(p[0],p[1]) - 0.082) < 0.01) throw Error('Test does not distinguish direct DEM sampling');
    const center = [1,100], angle = 0.17, radius = 1.7, q = cornerSurfacePoint(center,4,radius,angle);
    const step = Math.PI*2/18, A = new THREE.Vector3(1,100,hAt(1,100)+0.081);
    const B = new THREE.Vector3(3,100,hAt(3,100)+0.081);
    const C = new THREE.Vector3(1+2*Math.cos(step),100+2*Math.sin(step),hAt(1+2*Math.cos(step),100+2*Math.sin(step))+0.081);
    const plane = new THREE.Plane().setFromCoplanarPoints(A,B,C);
    if (Math.abs(plane.distanceToPoint(new THREE.Vector3(...q))) > 1e-6) throw Error('Corner wear floats off the existing cap triangle');
  `, context);
});

// The repository's class PNG is 8-bit grayscale. Decode its real filter rows so
// the coverage/budget test uses the same footprint classification as the game.
function classRaster() {
  const png = readFileSync(new URL('../data/cls.png', import.meta.url)), width = png.readUInt32BE(16), height = png.readUInt32BE(20), chunks = [];
  assert.equal(png[24], 8); assert.equal(png[25], 0);
  for (let i = 8; i < png.length;) { const length = png.readUInt32BE(i), type = png.toString('ascii', i + 4, i + 8); if (type === 'IDAT') chunks.push(png.subarray(i + 8, i + 8 + length)); i += length + 12; }
  const raw = inflateSync(Buffer.concat(chunks)), out = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (width + 1)];
    for (let x = 0; x < width; x++) {
      const k = y * width + x, left = x ? out[k - 1] : 0, up = y ? out[k - width] : 0, diagonal = x && y ? out[k - width - 1] : 0;
      let predictor = 0;
      if (filter === 1) predictor = left;
      if (filter === 2) predictor = up;
      if (filter === 3) predictor = Math.floor((left + up) / 2);
      if (filter === 4) { const p = left + up - diagonal, a = Math.abs(p - left), b = Math.abs(p - up), c = Math.abs(p - diagonal); predictor = a <= b && a <= c ? left : b <= c ? up : diagonal; }
      out[k] = raw[y * (width + 1) + x + 1] + predictor;
    }
  }
  return out;
}

test('real lane footprints and terrain produce bounded finite geometry at every quality', () => {
  const GEO = JSON.parse(read('data/geo.json')); GEO.roads = JSON.parse(read('data/roads.json')).roads;
  const HG = JSON.parse(read('data/terrain.json')).hgrid, bytes = Buffer.from(HG.b64, 'base64'), raster = classRaster();
  const hAt = (x, y) => {
    const fx = Math.max(0, Math.min(HG.nx - 1.001, (x - HG.x0) / HG.step)), fy = Math.max(0, Math.min(HG.ny - 1.001, (y - HG.y0) / HG.step));
    const i = Math.floor(fx), j = Math.floor(fy), u = fx - i, v = fy - j, get = k => bytes.readUInt16LE(k * 2) / 10;
    return (get(j * HG.nx + i) * (1 - u) + get(j * HG.nx + i + 1) * u) * (1 - v)
      + (get((j + 1) * HG.nx + i) * (1 - u) + get((j + 1) * HG.nx + i + 1) * u) * v;
  };
  const clsAt = (x, y) => { const i = Math.floor((x - GEO.bounds[0]) / GEO.res), j = Math.floor((GEO.bounds[3] - y) / GEO.res); return i < 0 || j < 0 || i >= GEO.w || j >= GEO.h ? 9 : raster[j * GEO.w + i]; };
  const totals = [];
  for (const quality of ['low', 'medium', 'high']) {
    const { context, meshes } = setup({ quality, GEO, hAt, clsAt });
    // Evaluate the same actual main-road frame/width rules without its renderer.
    context.RF = JSON.parse(read('data/road_features.json'));
    vm.runInContext(withoutImports(read('src/world/mainroad.js').split('function buildMain(')[0]), context);
    const stat = context.buildLaneDetails();
    assert.ok(stat.drainSegments > 0 && stat.seams > 0, JSON.stringify(stat));
    assert.ok(stat.vertices < 30000 && stat.meshes <= (quality === 'low' ? 60 : 150), JSON.stringify(stat));
    for (const mesh of meshes) assert.ok([...mesh.geometry.attributes.position.array].every(Number.isFinite));
    totals.push(stat.vertices); console.log(quality, stat);
  }
  assert.ok(totals[0] < totals[1] && totals[1] < totals[2], 'Higher quality adds bounded detail');
});
