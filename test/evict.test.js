import assert from 'node:assert/strict';
import test from 'node:test';
import { createWindow, decide } from '../src/index.js';

function hit(atMs, count = 1) {
  return { hits: [{ atMs, count }] };
}

test('a new key evicts the least recently used key when the map is full', () => {
  let state = createWindow({ limit: 1, windowMs: 1000, maxKeys: 2 });
  state = decide(state, 'a', 0).state;
  state = decide(state, 'b', 10).state;
  const kept = state.entries.b;
  const inserted = decide(state, 'c', 20);
  assert.equal(inserted.allowed, true);
  assert.deepEqual(inserted.evictedKeys, ['a']);
  assert.equal(Object.hasOwn(inserted.state.entries, 'a'), false);
  assert.equal(inserted.state.entries.b, kept);
  assert.equal(Object.hasOwn(inserted.state.entries, 'c'), true);
});

test('equal timestamps evict the key that sorts first', () => {
  const state = {
    limit: 1,
    windowMs: 1000,
    maxKeys: 2,
    entries: {
      b: hit(0),
      a: hit(0),
    },
  };
  const inserted = decide(state, 'c', 5);
  assert.deepEqual(inserted.evictedKeys, ['a']);
  assert.equal(Object.hasOwn(inserted.state.entries, 'b'), true);
  assert.equal(Object.hasOwn(inserted.state.entries, 'c'), true);
});

test('integer-like keys use code unit order when timestamps match', () => {
  const state = {
    limit: 1,
    windowMs: 100,
    maxKeys: 2,
    entries: {
      2: hit(0),
      10: hit(0),
    },
  };
  const inserted = decide(state, '3', 1);
  assert.deepEqual(inserted.evictedKeys, ['10']);
  assert.equal(Object.hasOwn(inserted.state.entries, '2'), true);
});

test('an expired key is evicted before a live key', () => {
  const state = {
    limit: 1,
    windowMs: 10,
    maxKeys: 2,
    entries: {
      live: hit(100),
      old: hit(0),
    },
  };
  const inserted = decide(state, 'next', 50);
  assert.deepEqual(inserted.evictedKeys, ['old']);
  assert.equal(Object.hasOwn(inserted.state.entries, 'live'), true);
  assert.deepEqual(inserted.state.entries.next.hits, [{ atMs: 50, count: 1 }]);
});

test('expired keys are ordered by their earliest hit', () => {
  const state = {
    limit: 2,
    windowMs: 10,
    maxKeys: 1,
    entries: {
      late: { hits: [{ atMs: 2, count: 1 }] },
      early: {
        hits: [
          { atMs: 0, count: 1 },
          { atMs: 4, count: 1 },
        ],
      },
    },
  };
  const inserted = decide(state, 'next', 30);
  assert.deepEqual(inserted.evictedKeys, ['early', 'late']);
  assert.deepEqual(Object.keys(inserted.state.entries), ['next']);
});

test('updating a live key does not evict even when the map is over the cap', () => {
  const open = createWindow({ limit: 2, windowMs: 100 });
  const seeded = decide(decide(open, 'a', 0).state, 'b', 5).state;
  const state = {
    limit: seeded.limit,
    windowMs: seeded.windowMs,
    maxKeys: 1,
    entries: seeded.entries,
  };
  const updated = decide(state, 'a', 6);
  assert.equal(updated.allowed, true);
  assert.deepEqual(updated.evictedKeys, []);
  assert.deepEqual(Object.keys(updated.state.entries).sort(), ['a', 'b']);
  assert.equal(updated.state.entries.b, seeded.entries.b);
  assert.equal(Object.hasOwn(seeded.entries, 'a'), true);
});

test('a deny does not evict', () => {
  const state = {
    limit: 1,
    windowMs: 100,
    maxKeys: 1,
    entries: {
      a: hit(0),
      b: hit(5),
    },
  };
  const denied = decide(state, 'a', 1);
  assert.equal(denied.allowed, false);
  assert.deepEqual(denied.evictedKeys, []);
  assert.equal(Object.hasOwn(denied.state.entries, 'b'), true);
});

test('refreshing an expired key reuses its slot before evicting others', () => {
  const state = {
    limit: 1,
    windowMs: 10,
    maxKeys: 1,
    entries: {
      a: hit(0),
    },
  };
  const refreshed = decide(state, 'a', 20);
  assert.equal(refreshed.allowed, true);
  assert.deepEqual(refreshed.evictedKeys, []);
  assert.deepEqual(Object.keys(refreshed.state.entries), ['a']);
});

test('an expired key is removed before a live neighbor is evicted for the same insert', () => {
  const state = {
    limit: 1,
    windowMs: 10,
    maxKeys: 1,
    entries: {
      a: hit(0),
      b: hit(100),
    },
  };
  const refreshed = decide(state, 'a', 50);
  assert.deepEqual(refreshed.evictedKeys, ['b']);
  assert.deepEqual(Object.keys(refreshed.state.entries), ['a']);
});

test('eviction does not mutate the input map', () => {
  const entries = { a: hit(0) };
  const state = { limit: 1, windowMs: 10, maxKeys: 1, entries };
  const inserted = decide(state, 'b', 1);
  assert.equal(Object.hasOwn(entries, 'a'), true);
  assert.equal(Object.hasOwn(entries, 'b'), false);
  assert.deepEqual(inserted.evictedKeys, ['a']);
  assert.equal(Object.hasOwn(inserted.state.entries, 'b'), true);
});

test('a second key is stored while the map is under the cap', () => {
  const state = createWindow({ limit: 1, windowMs: 10, maxKeys: 2 });
  const first = decide(state, 'a', 0);
  const second = decide(first.state, 'b', 0);
  assert.deepEqual(second.evictedKeys, []);
  assert.equal(second.state.entries.a, first.state.entries.a);
});
