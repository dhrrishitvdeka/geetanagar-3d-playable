import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

// These browser modules import the renderer at module scope. Exercise their actual functions
// with small DOM/state adapters so the regressions can run without a GPU or browser.
const read = path => readFileSync(new URL(`../src/game/${path}`, import.meta.url), 'utf8');
const section = (source, first, next) => source.slice(source.indexOf(first), source.indexOf(next, source.indexOf(first)));
const hud = read('hud.js'), npcs = read('content/npcs.js'), quests = read('quests.js');
const helpers = section(npcs, 'class Aborted extends Error {}', 'async function sayAll(');

test('acknowledged dialogue continues, while forced close aborts without a replacement menu', async () => {
  const make = Function('showDialogue', helpers + '; return { say, ask, Aborted };');
  const acknowledged = make(async () => true);
  await acknowledged.say({ name: 'Dadu' }, 'Tea?');
  const cancelled = make(async () => null);
  await assert.rejects(cancelled.say({ name: 'Dadu' }, 'Tea?'), cancelled.Aborted);
  await assert.rejects(cancelled.ask({ name: 'Dadu' }, 'Tea?', []), cancelled.Aborted);
});

test('ordinary line advancement is distinct from cancellation', () => {
  let result;
  const advance = Function('dlg', 'completeText', 'pickChoice', 'endDialogue',
    section(hud, 'function advance() {', 'function pickChoice(') + ';return advance;')(
    { typing: false, choices: [] }, () => {}, () => {}, value => { result = value; });
  advance();
  assert.equal(result, true);
});

test('forced close cancels both the visible dialogue and queued lines', async () => {
  const values = [];
  const item = { resolve: v => values.push(v) };
  const close = Function('dlg', 'dlgQueue',
    section(hud, 'function closeDialogues() {', 'function closeModals(') + ';return closeDialogues;')(
    { item, box: { remove() {} }, catcher: { remove() {} } }, [item, item]);
  close();
  assert.deepEqual(values, [null, null, null]);
});

test('pre-quest binocular sightings survive saving and are credited once', () => {
  const state = { flags: {} };
  const make = Function('state', 'SPOTS_3', 'setFlag',
    section(quests, 'function rememberBinocularSight(', "def({ id: 'eyes_on_city'")
    + ';return { rememberBinocularSight, priorBinocularSightings };');
  const bind = s => make(s, ['field', 'hatigarh', 'park_tank'], (key, value) => { s.flags[key] = value; });
  const api = bind(state);
  api.rememberBinocularSight({ placeId: 'field' });
  api.rememberBinocularSight({ placeId: 'field' });
  api.rememberBinocularSight({ placeId: 'sbi' });
  assert.deepEqual(api.priorBinocularSightings(), ['field']);
  const restored = bind(JSON.parse(JSON.stringify(state)));
  assert.deepEqual(restored.priorBinocularSightings(), ['field']);
  restored.rememberBinocularSight({ placeId: 'hatigarh' });
  restored.rememberBinocularSight({ placeId: 'park_tank' });
  assert.equal(restored.priorBinocularSightings().length, 3);
});

test('manual save uses the last safe spot rather than a riding or seated location', () => {
  const state = {};
  const saveNow = Function('started', 'getSafePos', 'state', 'save',
    section(hud, 'function savePlayerNow() {', 'function resumeGame(') + ';return savePlayerNow;')(
    true, () => ({ x: 12, y: 34, heading: 1.2 }), state, () => true);
  assert.equal(saveNow(), true);
  assert.deepEqual(state.player, { x: 12, y: 34, heading: 1.2 });
});
