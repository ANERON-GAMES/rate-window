import assert from 'node:assert/strict';
import test from 'node:test';
import { createWindow, decide, peek } from '../src/index.js';
import { assertDecision, assertFrozenWindow, assertPeek } from './helpers.js';

test('the usage sample allows three hits, denies inside the window, and opens on expiry', () => {
  const limits = createWindow({ limit: 3, windowMs: 1000 });
  const first = decide(limits, 'upload', 5000);
  const second = decide(first.state, 'upload', 5200);
  const third = decide(second.state, 'upload', 5400);
  const blocked = decide(third.state, 'upload', 5600);
  const viewed = peek(blocked.state, 'upload', 5600);
  const later = decide(blocked.state, 'upload', 6000);

  assertDecision(first, {
    allowed: true,
    decision: 'allow',
    remaining: 2,
    retryAfterMs: 0,
    active: 1,
    limit: 3,
    evictedKeys: [],
  });
  assertDecision(second, {
    allowed: true,
    decision: 'allow',
    remaining: 1,
    retryAfterMs: 0,
    active: 2,
    limit: 3,
    evictedKeys: [],
  });
  assertDecision(third, {
    allowed: true,
    decision: 'allow',
    remaining: 0,
    retryAfterMs: 600,
    active: 3,
    limit: 3,
    evictedKeys: [],
  });
  assertDecision(blocked, {
    allowed: false,
    decision: 'deny',
    remaining: 0,
    retryAfterMs: 400,
    active: 3,
    limit: 3,
    evictedKeys: [],
  });
  assertPeek(viewed, {
    allowed: false,
    decision: 'deny',
    remaining: 0,
    retryAfterMs: 400,
    active: 3,
    limit: 3,
  });
  assertDecision(later, {
    allowed: true,
    decision: 'allow',
    remaining: 0,
    retryAfterMs: 200,
    active: 3,
    limit: 3,
    evictedKeys: [],
  });
  assert.deepEqual(later.state.entries.upload.hits, [
    { atMs: 5200, count: 1 },
    { atMs: 5400, count: 1 },
    { atMs: 6000, count: 1 },
  ]);
  assert.equal(blocked.state, third.state);
  assertFrozenWindow(later.state);
});

test('a limit of one denies until the hit expires and allows on that instant', () => {
  const state = createWindow({ limit: 1, windowMs: 1000 });
  const first = decide(state, 'a', 0);
  const early = decide(first.state, 'a', 999);
  const boundary = decide(first.state, 'a', 1000);
  assertDecision(first, {
    allowed: true,
    decision: 'allow',
    remaining: 0,
    retryAfterMs: 1000,
    active: 1,
    limit: 1,
    evictedKeys: [],
  });
  assertDecision(early, {
    allowed: false,
    decision: 'deny',
    remaining: 0,
    retryAfterMs: 1,
    active: 1,
    limit: 1,
    evictedKeys: [],
  });
  assert.equal(early.state, first.state);
  assertDecision(boundary, {
    allowed: true,
    decision: 'allow',
    remaining: 0,
    retryAfterMs: 1000,
    active: 1,
    limit: 1,
    evictedKeys: [],
  });
  assert.deepEqual(boundary.state.entries.a.hits, [{ atMs: 1000, count: 1 }]);
});

test('hits at the same timestamp share one run and expire together', () => {
  let state = createWindow({ limit: 3, windowMs: 1000 });
  state = decide(state, 'a', 0).state;
  state = decide(state, 'a', 0).state;
  const full = decide(state, 'a', 0);
  const denied = decide(full.state, 'a', 0);
  const before = decide(full.state, 'a', 999);
  const opened = decide(full.state, 'a', 1000);
  assert.deepEqual(full.state.entries.a.hits, [{ atMs: 0, count: 3 }]);
  assert.equal(full.remaining, 0);
  assert.equal(full.retryAfterMs, 1000);
  assert.equal(denied.allowed, false);
  assert.equal(denied.retryAfterMs, 1000);
  assert.equal(before.allowed, false);
  assert.equal(before.retryAfterMs, 1);
  assert.equal(opened.allowed, true);
  assert.equal(opened.remaining, 2);
  assert.equal(opened.active, 1);
  assert.deepEqual(opened.state.entries.a.hits, [{ atMs: 1000, count: 1 }]);
});

test('only the expired prefix is dropped when the window slides', () => {
  let state = createWindow({ limit: 2, windowMs: 1000 });
  state = decide(state, 'a', 0).state;
  state = decide(state, 'a', 100).state;
  const next = decide(state, 'a', 1000);
  assert.equal(next.allowed, true);
  assert.equal(next.remaining, 0);
  assert.equal(next.retryAfterMs, 100);
  assert.equal(next.active, 2);
  assert.deepEqual(next.state.entries.a.hits, [
    { atMs: 100, count: 1 },
    { atMs: 1000, count: 1 },
  ]);
});

test('keys do not share a window', () => {
  const state = createWindow({ limit: 1, windowMs: 1000 });
  const left = decide(state, 'left', 10);
  const right = decide(left.state, 'right', 10);
  const again = decide(right.state, 'left', 11);
  assert.equal(left.allowed, true);
  assert.equal(right.allowed, true);
  assert.equal(again.allowed, false);
  assert.deepEqual(Object.keys(right.state.entries).sort(), ['left', 'right']);
  assert.equal(right.state.entries.left, left.state.entries.left);
});

test('forks from the same state do not see each other', () => {
  const state = createWindow({ limit: 1, windowMs: 50 });
  const left = decide(state, 'a', 5);
  const right = decide(state, 'a', 5);
  assert.equal(left.allowed, true);
  assert.equal(right.allowed, true);
  assert.notEqual(left.state, right.state);
  assert.equal(decide(left.state, 'a', 5).allowed, false);
  assert.equal(decide(state, 'b', 5).allowed, true);
  assert.deepEqual(Object.keys(state.entries), []);
});

test('callers can pass the same nowMs again and the hit merges', () => {
  const state = createWindow({ limit: 2, windowMs: 10 });
  const first = decide(state, 'a', 4);
  const second = decide(first.state, 'a', 4);
  assert.equal(second.allowed, true);
  assert.equal(second.remaining, 0);
  assert.deepEqual(second.state.entries.a.hits, [{ atMs: 4, count: 2 }]);
});

test('a later nowMs on another key does not move this key', () => {
  const state = createWindow({ limit: 1, windowMs: 100 });
  const first = decide(state, 'a', 0);
  const other = decide(first.state, 'b', 1000);
  const blocked = decide(other.state, 'a', 50);
  assert.equal(other.allowed, true);
  assert.equal(blocked.allowed, false);
  assert.equal(blocked.retryAfterMs, 50);
});

test('negative timestamps use the same expiry rule', () => {
  const state = createWindow({ limit: 1, windowMs: 10 });
  const first = decide(state, 'a', -20);
  const blocked = decide(first.state, 'a', -15);
  const opened = decide(first.state, 'a', -10);
  assert.equal(first.allowed, true);
  assert.equal(first.retryAfterMs, 10);
  assert.equal(blocked.allowed, false);
  assert.equal(blocked.retryAfterMs, 5);
  assert.equal(opened.allowed, true);
  assert.deepEqual(opened.state.entries.a.hits, [{ atMs: -10, count: 1 }]);
});

test('negative zero is stored as zero', () => {
  const state = createWindow({ limit: 1, windowMs: 5 });
  const first = decide(state, 'a', -0);
  assert.equal(Object.is(first.state.entries.a.hits[0].atMs, 0), true);
  assert.equal(decide(first.state, 'a', -0).allowed, false);
});

test('a full window denies without changing a canonical state', () => {
  const first = decide(createWindow({ limit: 1, windowMs: 8 }), 'a', 2);
  const denied = decide(first.state, 'a', 3);
  assert.equal(denied.state, first.state);
  assert.equal(denied.evictedKeys.length, 0);
});

test('whitespace and case are part of the key', () => {
  let state = createWindow({ limit: 1, windowMs: 10 });
  state = decide(state, 'A', 0).state;
  state = decide(state, 'a', 0).state;
  state = decide(state, ' a', 0).state;
  state = decide(state, 'a ', 0).state;
  assert.deepEqual(Object.keys(state.entries).sort(), [' a', 'A', 'a', 'a ']);
});

test('prototype keys stay data on a null-prototype map', () => {
  const names = ['__proto__', 'constructor', 'toString'];
  let state = createWindow({ limit: 1, windowMs: 10 });
  for (const name of names) {
    state = decide(state, name, 1).state;
  }
  assert.equal(Object.getPrototypeOf(state.entries), null);
  assert.equal(Object.prototype.hits, undefined);
  for (const name of names) {
    assert.equal(Object.hasOwn(state.entries, name), true);
    assert.equal(decide(state, name, 1).allowed, false);
  }
  const parsed = JSON.parse(JSON.stringify(state));
  const denied = decide(parsed, '__proto__', 1);
  assert.equal(denied.allowed, false);
  assert.equal(Object.getPrototypeOf(denied.state.entries), null);
  assert.equal(Object.hasOwn(denied.state.entries, '__proto__'), true);
});

test('input state and hit objects are not mutated', () => {
  const hit = { atMs: 0, count: 1 };
  const entries = { a: { hits: [hit] } };
  const state = { limit: 2, windowMs: 10, maxKeys: null, entries };
  const result = decide(state, 'a', 4);
  assert.equal(hit.count, 1);
  assert.equal(entries.a.hits, state.entries.a.hits);
  assert.equal(state.entries.a.hits.length, 1);
  assert.equal(Object.isFrozen(state), false);
  assert.notEqual(result.state, state);
  assert.deepEqual(result.state.entries.a.hits, [
    { atMs: 0, count: 1 },
    { atMs: 4, count: 1 },
  ]);
  hit.count = 9;
  assert.equal(result.state.entries.a.hits[0].count, 1);
});

test('a frozen canonical state can be decided again', () => {
  const first = decide(createWindow({ limit: 2, windowMs: 20 }), 'a', 3);
  assert.equal(Object.isFrozen(first.state), true);
  const second = decide(first.state, 'a', 4);
  assert.equal(second.allowed, true);
  assert.equal(second.state.entries.a.hits[0], first.state.entries.a.hits[0]);
});

test('the default window allows ten hits and denies the eleventh', () => {
  let state = createWindow();
  for (let count = 0; count < 10; count += 1) {
    const result = decide(state, 'a', 0);
    assert.equal(result.allowed, true);
    assert.equal(result.remaining, 9 - count);
    state = result.state;
  }
  const denied = decide(state, 'a', 0);
  assert.equal(denied.allowed, false);
  assert.equal(denied.retryAfterMs, 1000);
  assert.equal(denied.active, 10);
  assert.deepEqual(denied.state.entries.a.hits, [{ atMs: 0, count: 10 }]);
});

test('the maximum limit is one merged run', () => {
  let state = createWindow({ limit: 10000, windowMs: 5 });
  for (let count = 0; count < 10000; count += 1) {
    state = decide(state, 'a', 2).state;
  }
  const denied = decide(state, 'a', 2);
  assert.equal(denied.allowed, false);
  assert.equal(denied.state.entries.a.hits[0].count, 10000);
  assert.equal(decide(state, 'a', 7).allowed, true);
});

test('a window of one millisecond expires on the next millisecond', () => {
  const first = decide(createWindow({ limit: 1, windowMs: 1 }), 'a', 8);
  assert.equal(decide(first.state, 'a', 8).allowed, false);
  assert.equal(decide(first.state, 'a', 9).allowed, true);
});

test('hand-built expired hits are removed when a new hit is recorded', () => {
  const state = {
    limit: 2,
    windowMs: 10,
    maxKeys: null,
    entries: {
      a: {
        hits: [
          { atMs: 0, count: 1 },
          { atMs: 5, count: 1 },
        ],
      },
    },
  };
  const result = decide(state, 'a', 10);
  assert.equal(result.allowed, true);
  assert.equal(result.remaining, 0);
  assert.deepEqual(result.state.entries.a.hits, [
    { atMs: 5, count: 1 },
    { atMs: 10, count: 1 },
  ]);
  assert.equal(state.entries.a.hits.length, 2);
});

test('a quote in a key round-trips through the map', () => {
  const key = 'say "hello"';
  const result = decide(createWindow({ limit: 1, windowMs: 4 }), key, 1);
  assert.equal(Object.hasOwn(result.state.entries, key), true);
  assert.equal(decide(result.state, key, 1).allowed, false);
});
