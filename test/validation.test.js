import assert from 'node:assert/strict';
import test from 'node:test';
import { MAX_LIMIT, MAX_WINDOW_MS, decide, peek, reset, sweep } from '../src/index.js';
import { assertError, label } from './helpers.js';

const LIMIT_MESSAGE = `state.limit must be an integer from 1 through ${MAX_LIMIT}`;
const WINDOW_MESSAGE = `state.windowMs must be an integer from 1 through ${MAX_WINDOW_MS}`;
const MAX_KEYS_MESSAGE = `state.maxKeys must be null or an integer from 1 through ${MAX_WINDOW_MS}`;
const KEY_MESSAGE = 'key must be a non-empty string';
const NOW_MESSAGE = 'nowMs must be a safe integer';

function state(extra = {}) {
  return {
    limit: 1,
    windowMs: 10,
    maxKeys: null,
    entries: {},
    ...extra,
  };
}

for (const value of [undefined, null, 0, 'state', [], () => {}, new Date(), 1n, true]) {
  test(`rejects state ${label(value)}`, () => {
    assertError(() => decide(value, 'a', 0), 'invalid_state', 'state must be a plain object');
  });
}

test('rejects a state that inherits fields', () => {
  assertError(
    () => decide(Object.create({ limit: 1, windowMs: 1, maxKeys: null, entries: {} }), 'a', 0),
    'invalid_state',
    'state must be a plain object',
  );
});

test('accepts a null-prototype state', () => {
  const value = Object.create(null);
  value.limit = 1;
  value.windowMs = 10;
  value.maxKeys = null;
  value.entries = Object.create(null);
  assert.equal(decide(value, 'a', 0).allowed, true);
});

test('reports the lexicographically first unknown state field', () => {
  assertError(
    () => decide(state({ zeta: 1, alpha: 2 }), 'a', 0),
    'invalid_state',
    'unknown state field "alpha"',
  );
});

test('rejects a non-enumerable unknown state field', () => {
  const value = state();
  Object.defineProperty(value, 'hidden', { value: 1, enumerable: false });
  assertError(() => decide(value, 'a', 0), 'invalid_state', 'unknown state field "hidden"');
});

test('rejects symbol keys on state', () => {
  assertError(
    () => decide(state({ [Symbol('x')]: 1 }), 'a', 0),
    'invalid_state',
    'state must not contain symbol keys',
  );
});

test('prefers an unknown state field over a symbol key', () => {
  assertError(
    () => decide(state({ extra: 1, [Symbol('x')]: 1 }), 'a', 0),
    'invalid_state',
    'unknown state field "extra"',
  );
});

test('checks state before the key and the key before nowMs', () => {
  assertError(() => decide(null, '', Number.NaN), 'invalid_state', 'state must be a plain object');
  assertError(() => decide(state(), '', Number.NaN), 'invalid_key', KEY_MESSAGE);
  assertError(() => decide(state(), 'a', Number.NaN), 'invalid_now', NOW_MESSAGE);
});

test('does not call a state field accessor', () => {
  let calls = 0;
  const value = state();
  Object.defineProperty(value, 'limit', {
    enumerable: true,
    get() {
      calls += 1;
      return 1;
    },
  });
  assertError(() => decide(value, 'a', 0), 'invalid_limit', LIMIT_MESSAGE);
  assert.equal(calls, 0);
});

test('does not call an entries accessor', () => {
  let calls = 0;
  const value = state();
  Object.defineProperty(value, 'entries', {
    enumerable: true,
    get() {
      calls += 1;
      return {};
    },
  });
  assertError(
    () => decide(value, 'a', 0),
    'invalid_entries',
    'state.entries must be a plain object',
  );
  assert.equal(calls, 0);
});

for (const value of [0, 1.5, Number.NaN, Infinity, -1, MAX_LIMIT + 1, '1', null, undefined]) {
  test(`rejects state limit ${label(value)}`, () => {
    assertError(() => decide(state({ limit: value }), 'a', 0), 'invalid_limit', LIMIT_MESSAGE);
  });
}

for (const value of [0, 1.5, Number.NaN, Infinity, -1, MAX_WINDOW_MS + 1, '10', null]) {
  test(`rejects state windowMs ${label(value)}`, () => {
    assertError(() => decide(state({ windowMs: value }), 'a', 0), 'invalid_window', WINDOW_MESSAGE);
  });
}

for (const value of [0, 1.5, Number.NaN, Infinity, -1, undefined, '1']) {
  test(`rejects state maxKeys ${label(value)}`, () => {
    assertError(
      () => decide(state({ maxKeys: value }), 'a', 0),
      'invalid_max_keys',
      MAX_KEYS_MESSAGE,
    );
  });
}

test('state field order is limit, windowMs, maxKeys, entries', () => {
  assertError(
    () => decide({ windowMs: 0, maxKeys: 0, entries: {} }, 'a', 0),
    'invalid_limit',
    LIMIT_MESSAGE,
  );
  assertError(
    () => decide({ limit: 1, windowMs: 0, maxKeys: null, entries: {} }, 'a', 0),
    'invalid_window',
    WINDOW_MESSAGE,
  );
  assertError(
    () => decide({ limit: 1, windowMs: 10, entries: {} }, 'a', 0),
    'invalid_max_keys',
    MAX_KEYS_MESSAGE,
  );
});

for (const value of [null, [], 'entries', 1, new Date()]) {
  test(`rejects entries ${label(value)}`, () => {
    assertError(
      () => decide(state({ entries: value }), 'a', 0),
      'invalid_entries',
      'state.entries must be a plain object',
    );
  });
}

test('rejects an empty entry key before a symbol key', () => {
  const entries = { '': { hits: [{ atMs: 0, count: 1 }] } };
  Object.defineProperty(entries, Symbol('x'), { value: 1 });
  assertError(
    () => decide(state({ entries }), 'a', 0),
    'invalid_entries',
    'state.entries must not contain an empty key',
  );
});

test('reports the lexicographically first non-enumerable entry key', () => {
  const entries = {};
  Object.defineProperty(entries, 'zeta', { value: { hits: [{ atMs: 0, count: 1 }] } });
  Object.defineProperty(entries, 'alpha', { value: { hits: [{ atMs: 0, count: 1 }] } });
  assertError(
    () => decide(state({ entries }), 'a', 0),
    'invalid_entries',
    'state.entries key "alpha" must be enumerable',
  );
});

test('rejects symbol keys on entries after string key problems', () => {
  const entries = {};
  Object.defineProperty(entries, Symbol('x'), { value: 1 });
  assertError(
    () => decide(state({ entries }), 'a', 0),
    'invalid_entries',
    'state.entries must not contain symbol keys',
  );
});

test('does not call an entry accessor', () => {
  let calls = 0;
  const entries = {};
  Object.defineProperty(entries, 'a', {
    enumerable: true,
    get() {
      calls += 1;
      return { hits: [{ atMs: 0, count: 1 }] };
    },
  });
  assertError(
    () => decide(state({ entries }), 'a', 0),
    'invalid_entry',
    'entry "a" must be a plain object',
  );
  assert.equal(calls, 0);
});

for (const value of [null, [], 'entry', 1]) {
  test(`rejects entry ${label(value)}`, () => {
    assertError(
      () => decide(state({ entries: { a: value } }), 'a', 0),
      'invalid_entry',
      'entry "a" must be a plain object',
    );
  });
}

test('reports an unknown entry field before reading hits', () => {
  assertError(
    () => decide(state({ entries: { a: { hits: [], note: 1 } } }), 'a', 0),
    'invalid_entry',
    'entry "a" has unknown field "note"',
  );
});

test('rejects symbol keys on an entry', () => {
  const entry = { hits: [{ atMs: 0, count: 1 }] };
  entry[Symbol('x')] = 1;
  assertError(
    () => decide(state({ entries: { a: entry } }), 'a', 0),
    'invalid_entry',
    'entry "a" must not contain symbol keys',
  );
});

test('does not call a hits accessor', () => {
  let calls = 0;
  const entry = {};
  Object.defineProperty(entry, 'hits', {
    enumerable: true,
    get() {
      calls += 1;
      return [{ atMs: 0, count: 1 }];
    },
  });
  assertError(
    () => decide(state({ entries: { a: entry } }), 'a', 0),
    'invalid_hits',
    'entry "a" hits must be an array',
  );
  assert.equal(calls, 0);
});

for (const value of [null, {}, 'hits', 1]) {
  test(`rejects hits ${label(value)}`, () => {
    assertError(
      () => decide(state({ entries: { a: { hits: value } } }), 'a', 0),
      'invalid_hits',
      'entry "a" hits must be an array',
    );
  });
}

test('rejects an empty hits array and a hole', () => {
  assertError(
    () => decide(state({ entries: { a: { hits: [] } } }), 'a', 0),
    'invalid_hits',
    'entry "a" hits must not be empty',
  );
  const hits = [];
  hits.length = 1;
  assertError(
    () => decide(state({ entries: { a: { hits } } }), 'a', 0),
    'invalid_hits',
    'entry "a" hits must not contain holes',
  );
});

test('does not call a hit accessor', () => {
  let calls = 0;
  const hits = [];
  Object.defineProperty(hits, '0', {
    enumerable: true,
    get() {
      calls += 1;
      return { atMs: 0, count: 1 };
    },
  });
  assertError(
    () => decide(state({ entries: { a: { hits } } }), 'a', 0),
    'invalid_hit',
    'entry "a" hit 0 must be a plain object',
  );
  assert.equal(calls, 0);
});

for (const value of [null, [], 'hit', 1]) {
  test(`rejects hit ${label(value)}`, () => {
    assertError(
      () => decide(state({ entries: { a: { hits: [value] } } }), 'a', 0),
      'invalid_hit',
      'entry "a" hit 0 must be a plain object',
    );
  });
}

test('reports an unknown hit field before an invalid atMs', () => {
  assertError(
    () =>
      decide(state({ entries: { a: { hits: [{ atMs: 'x', count: 1, extra: true }] } } }), 'a', 0),
    'invalid_hit',
    'entry "a" hit 0 has unknown field "extra"',
  );
});

test('rejects symbol keys on a hit', () => {
  const hit = { atMs: 0, count: 1 };
  hit[Symbol('x')] = 1;
  assertError(
    () => decide(state({ entries: { a: { hits: [hit] } } }), 'a', 0),
    'invalid_hit',
    'entry "a" hit 0 must not contain symbol keys',
  );
});

for (const value of [null, 1.5, Number.NaN, Infinity, '0', true, 1n, undefined]) {
  test(`rejects atMs ${label(value)}`, () => {
    assertError(
      () => decide(state({ entries: { a: { hits: [{ atMs: value, count: 1 }] } } }), 'a', 0),
      'invalid_hit',
      'entry "a" hit 0 atMs must be a safe integer',
    );
  });
}

test('a bad atMs is reported before a bad count', () => {
  assertError(
    () => decide(state({ entries: { a: { hits: [{ atMs: 1.5, count: 0 }] } } }), 'a', 0),
    'invalid_hit',
    'entry "a" hit 0 atMs must be a safe integer',
  );
});

for (const value of [0, -1, 1.5, Number.NaN, Infinity, '1', null, -0]) {
  test(`rejects count ${label(value)}`, () => {
    assertError(
      () => decide(state({ entries: { a: { hits: [{ atMs: 0, count: value }] } } }), 'a', 0),
      'invalid_hit',
      'entry "a" hit 0 count must be an integer from 1 through the limit',
    );
  });
}

test('a count above the limit is rejected before the sum of later hits', () => {
  assertError(
    () =>
      decide(
        state({
          limit: 2,
          entries: {
            a: {
              hits: [
                { atMs: 0, count: 3 },
                { atMs: 1, count: 1 },
              ],
            },
          },
        }),
        'a',
        1,
      ),
    'invalid_hit',
    'entry "a" hit 0 count must be an integer from 1 through the limit',
  );
});

test('rejects hits that are not strictly increasing', () => {
  assertError(
    () =>
      decide(
        state({
          limit: 2,
          entries: {
            a: {
              hits: [
                { atMs: 5, count: 1 },
                { atMs: 5, count: 1 },
              ],
            },
          },
        }),
        'a',
        5,
      ),
    'invalid_hit',
    'entry "a" hits must be strictly increasing by atMs',
  );
  assertError(
    () =>
      decide(
        state({
          limit: 2,
          entries: {
            a: {
              hits: [
                { atMs: 5, count: 1 },
                { atMs: 4, count: 1 },
              ],
            },
          },
        }),
        'a',
        5,
      ),
    'invalid_hit',
    'entry "a" hits must be strictly increasing by atMs',
  );
});

test('rejects a sum of counts above the limit', () => {
  assertError(
    () =>
      decide(
        state({
          limit: 2,
          entries: {
            a: {
              hits: [
                { atMs: 0, count: 1 },
                { atMs: 1, count: 2 },
              ],
            },
          },
        }),
        'a',
        1,
      ),
    'invalid_hit',
    'entry "a" hit counts exceed the limit',
  );
});

test('normalizes a negative zero atMs when the rest of the hit is valid', () => {
  const result = decide(
    state({
      limit: 2,
      entries: { a: { hits: [{ atMs: -0, count: 1 }] } },
    }),
    'a',
    0,
  );
  assert.equal(result.allowed, true);
  assert.equal(Object.is(result.state.entries.a.hits[0].atMs, 0), true);
  assert.equal(result.state.entries.a.hits[0].count, 2);
});

test('quotes keys in entry errors', () => {
  assertError(
    () => decide(state({ entries: { 'a"b': null } }), 'a', 0),
    'invalid_entry',
    'entry "a\\"b" must be a plain object',
  );
});

for (const value of ['', 1, null, undefined, 0, true, [], {}, Symbol('k')]) {
  test(`rejects key ${label(value)}`, () => {
    assertError(() => decide(state(), value, 0), 'invalid_key', KEY_MESSAGE);
    assertError(() => peek(state(), value, 0), 'invalid_key', KEY_MESSAGE);
    assertError(() => reset(state(), value), 'invalid_key', KEY_MESSAGE);
  });
}

for (const value of [1.5, Number.NaN, Infinity, -Infinity, '0', null, true, 1n, undefined]) {
  test(`rejects nowMs ${label(value)}`, () => {
    assertError(() => decide(state(), 'a', value), 'invalid_now', NOW_MESSAGE);
    assertError(() => peek(state(), 'a', value), 'invalid_now', NOW_MESSAGE);
    assertError(() => sweep(state(), value), 'invalid_now', NOW_MESSAGE);
  });
}

test('entries are validated before the requested key', () => {
  assertError(
    () => decide(state({ entries: { b: { hits: [] } } }), 'a', 0),
    'invalid_hits',
    'entry "b" hits must not be empty',
  );
});

test('a failed validation leaves the input unchanged', () => {
  const value = state({ entries: { a: { hits: [{ atMs: 0, count: 1 }] } } });
  const before = JSON.stringify(value);
  assertError(() => decide(value, '', 0), 'invalid_key', KEY_MESSAGE);
  assert.equal(JSON.stringify(value), before);
});

test('reset still validates entry shape', () => {
  assertError(
    () => reset(state({ entries: { a: { hits: [{ atMs: 0, count: 0 }] } } }), 'b'),
    'invalid_hit',
    'entry "a" hit 0 count must be an integer from 1 through the limit',
  );
});

test('sweep rejects a non-finite ready window through state validation', () => {
  assertError(
    () =>
      sweep(
        {
          limit: 1,
          windowMs: 1,
          maxKeys: null,
          entries: { a: { hits: [{ atMs: Number.MAX_SAFE_INTEGER, count: 1 }] } },
        },
        0,
      ),
    'expiry_overflow',
    'entry "a" hit 0 expires outside the safe integer range',
  );
});
