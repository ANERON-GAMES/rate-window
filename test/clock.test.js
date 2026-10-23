import assert from 'node:assert/strict';
import test from 'node:test';
import { MAX_WINDOW_MS, createWindow, decide, peek, reset } from '../src/index.js';
import { assertError } from './helpers.js';

test('a nowMs earlier than the latest hit throws and leaves state unchanged', () => {
  const first = decide(createWindow({ limit: 2, windowMs: 1000 }), 'upload', 100);
  const before = JSON.stringify(first.state);
  assertError(
    () => decide(first.state, 'upload', 99),
    'clock_regression',
    'nowMs is earlier than the latest hit for "upload"',
  );
  assertError(
    () => peek(first.state, 'upload', 50),
    'clock_regression',
    'nowMs is earlier than the latest hit for "upload"',
  );
  assert.equal(JSON.stringify(first.state), before);
  assert.equal(decide(first.state, 'upload', 100).allowed, true);
});

test('clock regression is per key', () => {
  const first = decide(createWindow({ limit: 1, windowMs: 100 }), 'a', 40);
  const other = decide(first.state, 'b', 0);
  assert.equal(other.allowed, true);
  assert.equal(other.state.entries.a, first.state.entries.a);
});

test('moving to the latest hit is allowed and does not throw', () => {
  const first = decide(createWindow({ limit: 2, windowMs: 10 }), 'a', 5);
  assert.equal(decide(first.state, 'a', 5).allowed, true);
});

test('a far-forward nowMs drops the old hit', () => {
  const first = decide(createWindow({ limit: 1, windowMs: 10 }), 'a', 0);
  const next = decide(first.state, 'a', 10);
  assert.equal(next.allowed, true);
  assert.deepEqual(next.state.entries.a.hits, [{ atMs: 10, count: 1 }]);
});

test('reset clears a key after a regression error', () => {
  const first = decide(createWindow({ limit: 1, windowMs: 100 }), 'a', 80);
  assertError(
    () => decide(first.state, 'a', 1),
    'clock_regression',
    'nowMs is earlier than the latest hit for "a"',
  );
  const cleared = reset(first.state, 'a');
  assert.equal(cleared.removed, true);
  assert.equal(decide(cleared.state, 'a', 1).allowed, true);
});

test('recording a hit whose expiry is not a safe integer throws and keeps state', () => {
  const state = createWindow({ limit: 2, windowMs: MAX_WINDOW_MS });
  const first = decide(state, 'a', 0);
  assert.equal(first.allowed, true);
  assert.equal(first.state.entries.a.hits[0].atMs + MAX_WINDOW_MS, MAX_WINDOW_MS);
  assertError(
    () => decide(first.state, 'a', 1),
    'expiry_overflow',
    'recording a hit at this nowMs expires outside the safe integer range',
  );
  assert.equal(first.state.entries.a.hits.length, 1);
  assertError(
    () => peek(state, 'b', 1),
    'expiry_overflow',
    'recording a hit at this nowMs expires outside the safe integer range',
  );
  assert.deepEqual(Object.keys(state.entries), []);
});

test('a stored hit whose expiry is not a safe integer is rejected before the key is used', () => {
  const state = {
    limit: 1,
    windowMs: 1,
    maxKeys: null,
    entries: {
      a: { hits: [{ atMs: Number.MAX_SAFE_INTEGER, count: 1 }] },
      b: { hits: [{ atMs: 0, count: 1 }] },
    },
  };
  assertError(
    () => decide(state, 'b', 0),
    'expiry_overflow',
    'entry "a" hit 0 expires outside the safe integer range',
  );
  assertError(
    () => peek(state, 'b', 0),
    'expiry_overflow',
    'entry "a" hit 0 expires outside the safe integer range',
  );
  assert.equal(state.entries.a.hits[0].atMs, Number.MAX_SAFE_INTEGER);
});

test('an invalid nowMs is reported before clock regression', () => {
  const first = decide(createWindow({ limit: 1, windowMs: 10 }), 'a', 5);
  assertError(
    () => decide(first.state, 'a', Number.NaN),
    'invalid_now',
    'nowMs must be a safe integer',
  );
});

test('decisions do not read the clock or draw random numbers', () => {
  const now = Date.now;
  const random = Math.random;
  Date.now = () => {
    throw new Error('Date.now');
  };
  Math.random = () => {
    throw new Error('Math.random');
  };
  try {
    const state = createWindow({ limit: 2, windowMs: 10 });
    const first = decide(state, 'a', 0);
    peek(first.state, 'a', 0);
    decide(first.state, 'a', 1);
    reset(first.state, 'a');
  } finally {
    Date.now = now;
    Math.random = random;
  }
});
