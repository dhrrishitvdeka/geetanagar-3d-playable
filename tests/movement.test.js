import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { movePlanar } from '../src/game/core/movement.js';
import { addCollider, blockedBySeg, COLL } from '../src/world/colliders.js';

beforeEach(() => COLL.clear());

test('late frame cannot jump completely across a thin wall', () => {
  addCollider([10, 0], [10, 9]);
  const player = { x: 9.6, y: 5 };
  assert.equal(blockedBySeg(10.4, 5), false); // endpoint-only check would permit tunneling
  const hit = movePlanar(player, 0.8, 0, (x, y) => !blockedBySeg(x, y));
  assert.equal(hit.blockedX, true);
  assert.ok(player.x < 9.71);
});

test('diagonal movement continues along a wall after contact', () => {
  addCollider([10, 0], [10, 9]);
  const player = { x: 9.6, y: 5 };
  const hit = movePlanar(player, 0.8, 0.8, (x, y) => !blockedBySeg(x, y));
  assert.equal(hit.blockedX, true);
  assert.equal(hit.blockedY, false);
  assert.ok(player.x < 9.71);
  assert.ok(Math.abs(player.y - 5.8) < 1e-10);
});

test('forward and reverse vehicle motion stop before a thin wall', () => {
  addCollider([10, 0], [10, 9]);
  for (const [start, delta] of [[8, 4], [12, -4]]) {
    const vehicle = { x: start, y: 5 };
    const hit = movePlanar(vehicle, delta, 0, (x, y) => !blockedBySeg(x, y, 0.6), { slide: false });
    assert.equal(hit.blocked, true);
    assert.equal(Math.sign(vehicle.x - 10), Math.sign(start - 10));
    assert.ok(Math.abs(vehicle.x - 10) >= 0.6);
  }
});

test('open movement preserves exact total displacement and bounds every probe', () => {
  const body = { x: -2, y: 3 };
  const hit = movePlanar(body, 3, -4, (nx, ny, ox, oy) => {
    assert.ok(Math.hypot(nx - ox, ny - oy) <= 0.15 + 1e-10);
    assert.ok(Math.abs(body.x - ox) + Math.abs(body.y - oy) < 1e-10);
    return true;
  });
  assert.equal(hit.blocked, false);
  assert.ok(Math.abs(body.x - 1) + Math.abs(body.y + 1) < 1e-10);
});

test('terrain policy receives the local start at each step and can refuse a kerb', () => {
  const body = { x: 0, y: 0 };
  const terrain = x => x < 0.5 ? x * 0.2 : 1;
  movePlanar(body, 1, 0, (nx, ny, ox) => {
    const climb = terrain(nx) - terrain(ox);
    return climb <= 0.45 && climb / Math.abs(nx - ox) < 1.2;
  });
  assert.ok(body.x > 0.3 && body.x < 0.5);
});
