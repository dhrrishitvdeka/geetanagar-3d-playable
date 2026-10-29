import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { addCollider, blockedBySeg, COLL } from '../src/world/colliders.js';

beforeEach(() => COLL.clear());

test('wall across a positive cell boundary blocks a nearby center', () => {
  addCollider([10, 0], [10, 9]);
  assert.equal(blockedBySeg(9.9, 5), true);
  assert.equal(blockedBySeg(10.1, 5), true);
  assert.equal(blockedBySeg(9.6, 5), false);
});

test('wall across a negative cell boundary blocks from both sides', () => {
  addCollider([-10, -9], [-10, -1]);
  assert.equal(blockedBySeg(-10.1, -5), true);
  assert.equal(blockedBySeg(-9.9, -5), true);
});

test('endpoint can block a circle in a diagonally adjacent cell', () => {
  addCollider([10, 10], [13, 13]);
  assert.equal(blockedBySeg(9.9, 9.9), true);
  assert.equal(blockedBySeg(9.7, 9.7), false);
});

test('vehicle radius can reach across more than one cell', () => {
  addCollider([20, 0], [20, 9]);
  assert.equal(blockedBySeg(9.5, 5, 11), true);
  assert.equal(blockedBySeg(9.5, 5, 10), false);
});

test('degenerate wall and an empty grid remain well defined', () => {
  assert.equal(blockedBySeg(1, 1), false);
  addCollider([10, 10], [10, 10]);
  assert.equal(blockedBySeg(9.9, 9.9), true);
  assert.equal(blockedBySeg(9.5, 9.5), false);
});

test('indexed queries agree with a brute force distance oracle', () => {
  const walls = [[[10, -15], [10, 15]], [[-24, -10], [24, -10]], [[-16, 18], [24, -22]]];
  for (const wall of walls) addCollider(...wall);
  for (let x = -25; x <= 25; x += 0.37) for (let y = -24; y <= 24; y += 0.91) {
    const radius = 0.6;
    const expected = walls.some(([a, b]) => {
      const dx = b[0] - a[0], dy = b[1] - a[1];
      const fraction = Math.max(0, Math.min(1, ((x - a[0]) * dx + (y - a[1]) * dy) / (dx * dx + dy * dy)));
      return Math.hypot(x - a[0] - fraction * dx, y - a[1] - fraction * dy) < radius;
    });
    assert.equal(blockedBySeg(x, y, radius), expected, `at (${x}, ${y})`);
  }
});
