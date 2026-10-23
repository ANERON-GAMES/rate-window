import assert from 'node:assert/strict';
import { RateWindowError } from '../src/index.js';

export function assertError(fn, code, message) {
  assert.throws(fn, (error) => {
    assert.equal(error instanceof RateWindowError, true);
    assert.equal(error instanceof Error, true);
    assert.equal(error.name, 'RateWindowError');
    assert.equal(error.code, code);
    assert.equal(error.message, message);
    return true;
  });
}

export function assertDecision(result, expected) {
  assert.deepEqual(
    {
      allowed: result.allowed,
      decision: result.decision,
      remaining: result.remaining,
      retryAfterMs: result.retryAfterMs,
      active: result.active,
      limit: result.limit,
      evictedKeys: result.evictedKeys,
    },
    expected,
  );
  assert.equal(result.decision, result.allowed ? 'allow' : 'deny');
  assert.equal(Object.is(result.remaining, -0), false);
  assert.equal(Object.is(result.retryAfterMs, -0), false);
  assert.equal(Object.is(result.active, -0), false);
}

export function assertPeek(result, expected) {
  assert.deepEqual(result, expected);
  assert.equal(result.decision, result.allowed ? 'allow' : 'deny');
  assert.equal(Object.hasOwn(result, 'state'), false);
  assert.equal(Object.hasOwn(result, 'evictedKeys'), false);
}

export function assertFrozenWindow(state) {
  assert.equal(Object.isFrozen(state), true);
  assert.equal(Object.isFrozen(state.entries), true);
  assert.equal(Object.getPrototypeOf(state.entries), null);
  assert.deepEqual(Object.keys(state).sort(), ['entries', 'limit', 'maxKeys', 'windowMs']);
  for (const key of Object.keys(state.entries)) {
    const entry = state.entries[key];
    assert.equal(Object.isFrozen(entry), true);
    assert.equal(Object.isFrozen(entry.hits), true);
    assert.deepEqual(Object.keys(entry), ['hits']);
    for (const hit of entry.hits) {
      assert.equal(Object.isFrozen(hit), true);
      assert.deepEqual(Object.keys(hit).sort(), ['atMs', 'count']);
      assert.equal(Object.is(hit.atMs, -0), false);
      assert.equal(Object.is(hit.count, -0), false);
    }
  }
}

export function label(value) {
  if (typeof value === 'bigint') {
    return `${value}n`;
  }
  if (typeof value === 'string') {
    return JSON.stringify(value);
  }
  if (value === null) {
    return 'null';
  }
  if (typeof value === 'number' && Number.isNaN(value)) {
    return 'NaN';
  }
  if (typeof value === 'function') {
    return 'function';
  }
  if (Array.isArray(value)) {
    return `array(${value.length})`;
  }
  if (value instanceof Date) {
    return 'Date';
  }
  if (value instanceof Map) {
    return 'Map';
  }
  if (typeof value === 'symbol') {
    return 'symbol';
  }
  return String(value);
}
