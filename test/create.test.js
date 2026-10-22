import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DEFAULTS,
  DEFAULT_LIMIT,
  DEFAULT_MAX_KEYS,
  DEFAULT_WINDOW_MS,
  MAX_LIMIT,
  MAX_WINDOW_MS,
  createWindow,
} from '../src/index.js';
import { assertError, assertFrozenWindow, label } from './helpers.js';

const LIMIT_MESSAGE = `limit must be an integer from 1 through ${MAX_LIMIT}`;
const WINDOW_MESSAGE = `windowMs must be an integer from 1 through ${MAX_WINDOW_MS}`;
const MAX_KEYS_MESSAGE = `maxKeys must be null or an integer from 1 through ${MAX_WINDOW_MS}`;

test('constants and defaults stay fixed', () => {
  assert.equal(DEFAULT_LIMIT, 10);
  assert.equal(DEFAULT_WINDOW_MS, 1000);
  assert.equal(DEFAULT_MAX_KEYS, null);
  assert.equal(MAX_LIMIT, 10000);
  assert.equal(MAX_WINDOW_MS, Number.MAX_SAFE_INTEGER);
  assert.deepEqual(DEFAULTS, { limit: 10, windowMs: 1000, maxKeys: null });
  assert.equal(Object.isFrozen(DEFAULTS), true);
  assert.throws(() => {
    DEFAULTS.limit = 1;
  }, TypeError);
});

test('createWindow without options returns a frozen empty map', () => {
  const state = createWindow();
  assert.equal(state.limit, 10);
  assert.equal(state.windowMs, 1000);
  assert.equal(state.maxKeys, null);
  assert.deepEqual(Object.keys(state.entries), []);
  assertFrozenWindow(state);
  assert.throws(() => {
    state.limit = 1;
  }, TypeError);
  assert.throws(() => {
    state.entries.a = {};
  }, TypeError);
});

test('each createWindow call returns its own state', () => {
  const left = createWindow();
  const right = createWindow();
  assert.notEqual(left, right);
  assert.notEqual(left.entries, right.entries);
});

test('options override defaults and undefined fields fall back', () => {
  const options = { limit: 2, windowMs: 40, maxKeys: undefined, label: undefined };
  assert.throws(
    () => createWindow(options),
    (error) => error.code === 'unknown_option',
  );
  const state = createWindow({ limit: 2, windowMs: 40, maxKeys: undefined });
  assert.equal(state.limit, 2);
  assert.equal(state.windowMs, 40);
  assert.equal(state.maxKeys, null);
});

test('null maxKeys is unlimited and frozen or null-prototype options are read', () => {
  assert.equal(createWindow({ maxKeys: null }).maxKeys, null);
  assert.equal(createWindow(Object.freeze({ limit: 4 })).limit, 4);
  const options = Object.create(null);
  options.limit = 6;
  options.windowMs = 7;
  options.maxKeys = 8;
  const state = createWindow(options);
  assert.equal(state.limit, 6);
  assert.equal(state.windowMs, 7);
  assert.equal(state.maxKeys, 8);
});

test('boundary integers are accepted', () => {
  const state = createWindow({
    limit: MAX_LIMIT,
    windowMs: MAX_WINDOW_MS,
    maxKeys: MAX_WINDOW_MS,
  });
  assert.equal(state.limit, MAX_LIMIT);
  assert.equal(state.windowMs, MAX_WINDOW_MS);
  assert.equal(state.maxKeys, MAX_WINDOW_MS);
});

test('options are not mutated', () => {
  const options = { limit: 2, windowMs: 5, maxKeys: 3 };
  const state = createWindow(options);
  options.limit = 9;
  assert.equal(state.limit, 2);
});

for (const value of [null, 0, 'options', [], () => {}, new Date(), 1n, new Map()]) {
  test(`rejects options ${label(value)}`, () => {
    assertError(() => createWindow(value), 'invalid_options', 'options must be a plain object');
  });
}

test('rejects options that inherit fields', () => {
  assertError(
    () => createWindow(Object.create({ limit: 1 })),
    'invalid_options',
    'options must be a plain object',
  );
});

test('rejects a class instance as options', () => {
  class Options {
    constructor() {
      this.limit = 1;
    }
  }
  assertError(
    () => createWindow(new Options()),
    'invalid_options',
    'options must be a plain object',
  );
});

test('reports the lexicographically first unknown option', () => {
  assertError(
    () => createWindow({ zeta: 1, alpha: 2, limit: 1 }),
    'unknown_option',
    'unknown option "alpha"',
  );
});

test('an unknown option is reported before an invalid limit', () => {
  assertError(() => createWindow({ zeta: 1, limit: 0 }), 'unknown_option', 'unknown option "zeta"');
});

test('rejects an empty-string option key', () => {
  assertError(() => createWindow({ '': 1 }), 'unknown_option', 'unknown option ""');
});

test('rejects a non-enumerable unknown option', () => {
  const options = { limit: 1 };
  Object.defineProperty(options, 'hidden', { value: 1, enumerable: false });
  assertError(() => createWindow(options), 'unknown_option', 'unknown option "hidden"');
});

test('rejects symbol keys on options', () => {
  assertError(
    () => createWindow({ [Symbol('x')]: 1 }),
    'unknown_option',
    'options must not contain symbol keys',
  );
});

test('prefers an unknown option name over a symbol key', () => {
  assertError(
    () => createWindow({ extra: 1, [Symbol('x')]: 1 }),
    'unknown_option',
    'unknown option "extra"',
  );
});

test('does not call an option accessor', () => {
  let calls = 0;
  const options = {};
  Object.defineProperty(options, 'limit', {
    enumerable: true,
    get() {
      calls += 1;
      return 1;
    },
  });
  assertError(() => createWindow(options), 'invalid_limit', LIMIT_MESSAGE);
  assert.equal(calls, 0);
});

for (const value of [-1, 0, 1.5, Number.NaN, Infinity, -0, '1', null, true, 1n, MAX_LIMIT + 1]) {
  test(`rejects limit ${label(value)}`, () => {
    assertError(() => createWindow({ limit: value }), 'invalid_limit', LIMIT_MESSAGE);
  });
}

for (const value of [
  -1,
  0,
  1.5,
  Number.NaN,
  Infinity,
  -0,
  '1',
  null,
  true,
  1n,
  MAX_WINDOW_MS + 1,
]) {
  test(`rejects windowMs ${label(value)}`, () => {
    assertError(() => createWindow({ windowMs: value }), 'invalid_window', WINDOW_MESSAGE);
  });
}

for (const value of [-1, 0, 1.5, Number.NaN, Infinity, -0, '1', true, 1n, MAX_WINDOW_MS + 1]) {
  test(`rejects maxKeys ${label(value)}`, () => {
    assertError(() => createWindow({ maxKeys: value }), 'invalid_max_keys', MAX_KEYS_MESSAGE);
  });
}

test('checks limit before windowMs and maxKeys', () => {
  assertError(
    () => createWindow({ limit: 0, windowMs: 0, maxKeys: 0 }),
    'invalid_limit',
    LIMIT_MESSAGE,
  );
  assertError(() => createWindow({ windowMs: 0, maxKeys: 0 }), 'invalid_window', WINDOW_MESSAGE);
});
