import assert from 'node:assert/strict';
import test from 'node:test';
import { createWindow, decide, peek } from '../src/index.js';
import { assertPeek } from './helpers.js';

test('peek reports the decision without recording a hit', () => {
  const state = createWindow({ limit: 2, windowMs: 100 });
  const first = decide(state, 'a', 10);
  const viewed = peek(first.state, 'a', 10);
  const applied = decide(first.state, 'a', 10);
  assertPeek(viewed, {
    allowed: true,
    decision: 'allow',
    remaining: 0,
    retryAfterMs: 100,
    active: 2,
    limit: 2,
  });
  assert.equal(applied.remaining, viewed.remaining);
  assert.equal(applied.retryAfterMs, viewed.retryAfterMs);
  assert.equal(applied.active, viewed.active);
  assert.equal(first.state.entries.a.hits[0].count, 1);
  assert.equal(peek(first.state, 'missing', 10).allowed, true);
  assert.equal(Object.hasOwn(first.state.entries, 'missing'), false);
});

test('peek of an empty key matches decide and leaves the canonical state in place', () => {
  const state = createWindow({ limit: 1, windowMs: 25 });
  const viewed = peek(state, 'a', 4);
  assertPeek(viewed, {
    allowed: true,
    decision: 'allow',
    remaining: 0,
    retryAfterMs: 25,
    active: 1,
    limit: 1,
  });
  assert.deepEqual(Object.keys(state.entries), []);
  const denied = peek(decide(state, 'a', 4).state, 'a', 4);
  assert.equal(denied.allowed, false);
  assert.equal(denied.retryAfterMs, 25);
});

test('peek ignores expired hits without trimming the stored entry', () => {
  let state = createWindow({ limit: 2, windowMs: 100 });
  state = decide(state, 'a', 0).state;
  state = decide(state, 'a', 50).state;
  const viewed = peek(state, 'a', 100);
  assert.equal(viewed.allowed, true);
  assert.equal(viewed.active, 2);
  assert.equal(viewed.remaining, 0);
  assert.equal(viewed.retryAfterMs, 50);
  assert.equal(state.entries.a.hits.length, 2);
});

test('peek of one key does not include another key in the count', () => {
  let state = createWindow({ limit: 1, windowMs: 10 });
  state = decide(state, 'a', 0).state;
  const viewed = peek(state, 'b', 0);
  assert.equal(viewed.allowed, true);
  assert.equal(viewed.active, 1);
});
