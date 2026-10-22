import assert from 'node:assert/strict';
import test from 'node:test';
import { createWindow, decide, reset, sweep } from '../src/index.js';
import { assertFrozenWindow } from './helpers.js';

test('reset deletes one key and leaves the others', () => {
  let state = createWindow({ limit: 1, windowMs: 10 });
  state = decide(state, 'a', 1).state;
  state = decide(state, 'b', 1).state;
  const kept = state.entries.b;
  const cleared = reset(state, 'a');
  assert.equal(cleared.removed, true);
  assert.equal(Object.hasOwn(cleared.state.entries, 'a'), false);
  assert.equal(cleared.state.entries.b, kept);
  assertFrozenWindow(cleared.state);
  const next = decide(cleared.state, 'a', 1);
  assert.equal(next.allowed, true);
  assert.equal(next.remaining, 0);
});

test('reset of a missing key on a canonical state returns that state', () => {
  const state = createWindow({ limit: 1, windowMs: 10 });
  const cleared = reset(state, 'missing');
  assert.equal(cleared.removed, false);
  assert.equal(cleared.state, state);
});

test('reset of a missing key republishes a plain state', () => {
  const state = { limit: 1, windowMs: 10, maxKeys: null, entries: {} };
  const cleared = reset(state, 'missing');
  assert.equal(cleared.removed, false);
  assert.notEqual(cleared.state, state);
  assert.equal(Object.isFrozen(cleared.state), true);
  assert.equal(Object.getPrototypeOf(cleared.state.entries), null);
});

test('reset removes a key whose hit expiry is outside the safe integer range', () => {
  const state = {
    limit: 1,
    windowMs: 1,
    maxKeys: null,
    entries: {
      a: { hits: [{ atMs: Number.MAX_SAFE_INTEGER, count: 1 }] },
      b: { hits: [{ atMs: 0, count: 1 }] },
    },
  };
  const cleared = reset(state, 'a');
  assert.equal(cleared.removed, true);
  assert.deepEqual(Object.keys(cleared.state.entries), ['b']);
  assert.equal(state.entries.a.hits.length, 1);
});

test('sweep drops expired keys, trims prefixes, and sorts removed names', () => {
  const state = {
    limit: 3,
    windowMs: 100,
    maxKeys: null,
    entries: {
      b: { hits: [{ atMs: 0, count: 1 }] },
      a: {
        hits: [
          { atMs: 0, count: 1 },
          { atMs: 50, count: 1 },
        ],
      },
      10: { hits: [{ atMs: 0, count: 1 }] },
      2: { hits: [{ atMs: 40, count: 1 }] },
    },
  };
  const swept = sweep(state, 100);
  assert.equal(swept.removed, 2);
  assert.deepEqual(swept.keys, ['10', 'b']);
  assert.deepEqual(Object.keys(swept.state.entries).sort(), ['2', 'a']);
  assert.deepEqual(swept.state.entries.a.hits, [{ atMs: 50, count: 1 }]);
  assert.deepEqual(swept.state.entries['2'].hits, [{ atMs: 40, count: 1 }]);
  const again = sweep(swept.state, 100);
  assert.equal(again.removed, 0);
  assert.deepEqual(again.keys, []);
  assert.equal(again.state, swept.state);
});

test('sweep of a canonical state with nothing expired returns that state', () => {
  const state = decide(createWindow({ limit: 1, windowMs: 10 }), 'a', 4).state;
  const swept = sweep(state, 4);
  assert.equal(swept.state, state);
  assert.equal(swept.removed, 0);
});

test('sweep can run behind the latest hit and keeps it', () => {
  const state = decide(createWindow({ limit: 1, windowMs: 100 }), 'a', 50).state;
  const swept = sweep(state, 0);
  assert.equal(swept.removed, 0);
  assert.equal(swept.state.entries.a.hits[0].atMs, 50);
});

test('sweep removes a key exactly at expiry', () => {
  const state = decide(createWindow({ limit: 1, windowMs: 30 }), 'a', 10).state;
  const swept = sweep(state, 40);
  assert.equal(swept.removed, 1);
  assert.deepEqual(swept.keys, ['a']);
  assert.deepEqual(Object.keys(swept.state.entries), []);
});
