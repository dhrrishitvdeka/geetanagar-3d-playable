import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';

// Exercise the browser simulation functions with flat ground and inert rendering/audio.
const source = path => readFileSync(new URL('../src/game/' + path, import.meta.url), 'utf8');
const between = (text, start, end) => text.slice(text.indexOf(start), text.indexOf(end, text.indexOf(start)));
const vector = () => ({ set() { return this; }, normalize() { return this; } });
const looseSource = source('loose.js');
function loose() {
  const context = vm.createContext({ BODY_R: 0.24, G: 9.8, groundAt: () => 0, walkable: () => true, sfx() {},
    _ax: vector(), _q: { setFromAxisAngle() { return this; } } });
  vm.runInContext(between(looseSource, 'function hit(', '// ---------- the player kicks'), context);
  return context;
}
const object = kind => ({ kind, k: { r: 0.09, h: 0.18, bounce: 0.6, roll: 0.35, push: 1.35 },
  x: 0.2, y: 0, z: 0.09, vx: 0, vy: 0, vz: 0, down: false, ax: 0, hitCd: 0, q: { premultiply() {} } });

test('park ball remains free to roll in a new direction after a body contact', () => {
  const physics = loose(), ball = object('ball');
  physics.hit(ball, 0, 0, 1);
  assert.equal(ball.down, false);
  ball.vx = 0; ball.vy = 7; ball.vz = 2.2;
  for (let i = 0; i < 20; i++) physics.step(ball, 0.05);
  assert.ok(ball.y > 6, `Ball travelled only ${ball.y} metres`);
});

test('cans still fall over and damp sliding along their cylinder axis', () => {
  const physics = loose(), can = object('can');
  physics.hit(can, 0, 0, 1);
  assert.equal(can.down, true);
  can.vx = 0; can.vy = 7; can.vz = 2.2;
  for (let i = 0; i < 20; i++) physics.step(can, 0.05);
  assert.ok(can.y < 1);
});

const routineSource = source('npc/routines.js');
function busStop(leg) {
  const moves = [], resident = { id: 'commuter', leg, n: { x: 0, y: 0, talking: false },
    legs: [{ at: 8, mode: 'stay' }, { at: 8.5, mode: 'board' }, { at: 16, fromBus: true, mode: 'gone' }] };
  let handler;
  const context = vm.createContext({ ready: true, state: { time: leg === 2 ? 16.2 : 8.6 }, PEOPLE: [resident],
    getNPC: () => null, npcMoveTo: (...args) => moves.push(args), on: (_event, callback) => { handler = callback; } });
  vm.runInContext(between(routineSource, "on('bus:stopped'", '// ---------- what they say'), context);
  handler({ x: 0, y: 0 });
  return moves;
}
test('waiting morning commuters board the bus', () => assert.equal(busStop(1).length, 1));
test('commuters walking home after their return do not board again', () => assert.equal(busStop(2).length, 0));

const worldSource = source('worldobjects.js');
function goalAfterTouch(npcTouches) {
  const goals = [], ball = { x: 0, y: 0, z: 0.11, r: 0.11, vx: 9, vy: 0, vz: 0, lastPlayer: 9.8,
    lastKid: -99, resetT: 0, mesh: { quaternion: { premultiply() {} } } };
  const context = vm.createContext({ ball, T: 10, groundAt: () => 0, walkable: () => true, sfx() {}, syncBall() {},
    tmpAx: vector(), tmpQ: { setFromAxisAngle() {} }, FIELD: { cx: 0, cy: 0, ux: 1, uy: 0,
      goals: [{ x: -1, y: 0, t: -1, inward: 1 }, { x: 1, y: 0, t: 1, inward: -1 }] },
    scoreGoal: byPlayer => { goals.push(byPlayer); ball.resetT = 2; } });
  vm.runInContext(between(worldSource, 'function stepBall(', 'function setBallPosition('), context);
  vm.runInContext(between(worldSource, 'function npcKick(', '// a body at'), context);
  if (npcTouches) context.npcKick(0, 9, 0);
  context.stepBall(0.2, { x: 100, y: 100, z: 0 });
  return goals;
}
test('a goal from a player touch is credited to the player', () => assert.deepEqual(goalAfterTouch(false), [true]));
test('an intervening NPC kick removes player goal credit', () => assert.deepEqual(goalAfterTouch(true), [false]));
