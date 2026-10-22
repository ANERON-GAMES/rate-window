import {
  DEFAULT_LIMIT,
  DEFAULT_MAX_KEYS,
  DEFAULT_WINDOW_MS,
  MAX_LIMIT,
  MAX_WINDOW_MS,
} from './constants.js';
import { fail } from './errors.js';
import {
  assignData,
  firstUnknown,
  isEnumerableData,
  isPlainObject,
  ownData,
  quote,
  sameKeys,
} from './plain.js';

const OPTION_KEYS = new Set(['limit', 'windowMs', 'maxKeys']);
const STATE_KEYS = ['limit', 'windowMs', 'maxKeys', 'entries'];
const STATE_KEY_SET = new Set(STATE_KEYS);
const ENTRY_KEYS = new Set(['hits']);
const HIT_KEYS = new Set(['atMs', 'count']);

const LIMIT_MESSAGE = `limit must be an integer from 1 through ${MAX_LIMIT}`;
const STATE_LIMIT_MESSAGE = `state.limit must be an integer from 1 through ${MAX_LIMIT}`;
const WINDOW_MESSAGE = `windowMs must be an integer from 1 through ${MAX_WINDOW_MS}`;
const STATE_WINDOW_MESSAGE = `state.windowMs must be an integer from 1 through ${MAX_WINDOW_MS}`;
const MAX_KEYS_MESSAGE = `maxKeys must be null or an integer from 1 through ${MAX_WINDOW_MS}`;
const STATE_MAX_KEYS_MESSAGE = `state.maxKeys must be null or an integer from 1 through ${MAX_WINDOW_MS}`;

function isLimit(value) {
  return Number.isSafeInteger(value) && value >= 1 && value <= MAX_LIMIT;
}

function isWindow(value) {
  return Number.isSafeInteger(value) && value >= 1 && value <= MAX_WINDOW_MS;
}

function isMaxKeys(value) {
  if (value === null) {
    return true;
  }
  return Number.isSafeInteger(value) && value >= 1 && value <= MAX_WINDOW_MS;
}

function readOptional(object, key, fallback, validate, code, message) {
  if (!Object.hasOwn(object, key)) {
    return fallback;
  }
  const data = ownData(object, key);
  if (!data.ok) {
    fail(code, message);
  }
  if (data.value === undefined) {
    return fallback;
  }
  if (!validate(data.value)) {
    fail(code, message);
  }
  return data.value;
}

export function readOptions(options) {
  if (options === undefined) {
    return {
      limit: DEFAULT_LIMIT,
      windowMs: DEFAULT_WINDOW_MS,
      maxKeys: DEFAULT_MAX_KEYS,
    };
  }
  if (!isPlainObject(options)) {
    fail('invalid_options', 'options must be a plain object');
  }
  const unknown = firstUnknown(options, OPTION_KEYS);
  if (unknown.name !== undefined) {
    fail('unknown_option', `unknown option ${quote(unknown.name)}`);
  }
  if (unknown.hasSymbol) {
    fail('unknown_option', 'options must not contain symbol keys');
  }
  return {
    limit: readOptional(options, 'limit', DEFAULT_LIMIT, isLimit, 'invalid_limit', LIMIT_MESSAGE),
    windowMs: readOptional(
      options,
      'windowMs',
      DEFAULT_WINDOW_MS,
      isWindow,
      'invalid_window',
      WINDOW_MESSAGE,
    ),
    maxKeys: readOptional(
      options,
      'maxKeys',
      DEFAULT_MAX_KEYS,
      isMaxKeys,
      'invalid_max_keys',
      MAX_KEYS_MESSAGE,
    ),
  };
}

function readRequired(object, key, validate, code, message) {
  const data = ownData(object, key);
  if (!data.ok || !validate(data.value)) {
    fail(code, message);
  }
  return data.value;
}

function isCanonicalHit(hit, atMs, count) {
  if (!isPlainObject(hit) || !Object.isFrozen(hit)) {
    return false;
  }
  if (!sameKeys(Reflect.ownKeys(hit), ['atMs', 'count'])) {
    return false;
  }
  if (!isEnumerableData(hit, 'atMs') || !isEnumerableData(hit, 'count')) {
    return false;
  }
  return hit.atMs === atMs && hit.count === count && !Object.is(hit.atMs, -0);
}

function readHit(value, key, index, limit, windowMs, checkExpiry) {
  if (!isPlainObject(value)) {
    fail('invalid_hit', `entry ${quote(key)} hit ${index} must be a plain object`);
  }
  const unknown = firstUnknown(value, HIT_KEYS);
  if (unknown.name !== undefined) {
    fail(
      'invalid_hit',
      `entry ${quote(key)} hit ${index} has unknown field ${quote(unknown.name)}`,
    );
  }
  if (unknown.hasSymbol) {
    fail('invalid_hit', `entry ${quote(key)} hit ${index} must not contain symbol keys`);
  }
  const atData = ownData(value, 'atMs');
  if (!atData.ok || !Number.isSafeInteger(atData.value)) {
    fail('invalid_hit', `entry ${quote(key)} hit ${index} atMs must be a safe integer`);
  }
  const atMs = Object.is(atData.value, -0) ? 0 : atData.value;
  const countData = ownData(value, 'count');
  if (
    !countData.ok ||
    !Number.isSafeInteger(countData.value) ||
    countData.value < 1 ||
    countData.value > limit
  ) {
    fail(
      'invalid_hit',
      `entry ${quote(key)} hit ${index} count must be an integer from 1 through the limit`,
    );
  }
  const count = countData.value;
  if (checkExpiry && !Number.isSafeInteger(atMs + windowMs)) {
    fail(
      'expiry_overflow',
      `entry ${quote(key)} hit ${index} expires outside the safe integer range`,
    );
  }
  if (isCanonicalHit(value, atMs, count)) {
    return value;
  }
  return Object.freeze({ atMs, count });
}

function isIndexString(key, length) {
  if (typeof key !== 'string' || key.length === 0) {
    return false;
  }
  let value = 0;
  for (let index = 0; index < key.length; index += 1) {
    const code = key.charCodeAt(index);
    if (code < 48 || code > 57) {
      return false;
    }
    if (index === 0 && code === 48 && key.length !== 1) {
      return false;
    }
    value = value * 10 + (code - 48);
    if (!Number.isSafeInteger(value)) {
      return false;
    }
  }
  return value < length;
}

function hasExtraArrayKey(hits) {
  for (const key of Reflect.ownKeys(hits)) {
    if (key === 'length') {
      continue;
    }
    if (!isIndexString(key, hits.length)) {
      return true;
    }
  }
  return false;
}

function readHits(hits, key, limit, windowMs, checkExpiry) {
  if (!Array.isArray(hits)) {
    fail('invalid_hits', `entry ${quote(key)} hits must be an array`);
  }
  if (hits.length === 0) {
    fail('invalid_hits', `entry ${quote(key)} hits must not be empty`);
  }
  const built = [];
  let reuse =
    Object.isFrozen(hits) &&
    Object.getPrototypeOf(hits) === Array.prototype &&
    !hasExtraArrayKey(hits);
  let total = 0;
  let previous = null;
  for (let index = 0; index < hits.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(hits, index);
    if (descriptor === undefined) {
      fail('invalid_hits', `entry ${quote(key)} hits must not contain holes`);
    }
    if (!Object.hasOwn(descriptor, 'value')) {
      fail('invalid_hit', `entry ${quote(key)} hit ${index} must be a plain object`);
    }
    const hit = readHit(descriptor.value, key, index, limit, windowMs, checkExpiry);
    if (previous !== null && hit.atMs <= previous) {
      fail('invalid_hit', `entry ${quote(key)} hits must be strictly increasing by atMs`);
    }
    previous = hit.atMs;
    total += hit.count;
    if (total > limit) {
      fail('invalid_hit', `entry ${quote(key)} hit counts exceed the limit`);
    }
    if (hit !== descriptor.value) {
      reuse = false;
    }
    built.push(hit);
  }
  if (reuse) {
    return hits;
  }
  return Object.freeze(built);
}

function isCanonicalEntry(entry, hits) {
  if (!isPlainObject(entry) || !Object.isFrozen(entry)) {
    return false;
  }
  if (!sameKeys(Reflect.ownKeys(entry), ['hits'])) {
    return false;
  }
  if (!isEnumerableData(entry, 'hits')) {
    return false;
  }
  return entry.hits === hits;
}

function readEntry(value, key, limit, windowMs, checkExpiry) {
  if (!isPlainObject(value)) {
    fail('invalid_entry', `entry ${quote(key)} must be a plain object`);
  }
  const unknown = firstUnknown(value, ENTRY_KEYS);
  if (unknown.name !== undefined) {
    fail('invalid_entry', `entry ${quote(key)} has unknown field ${quote(unknown.name)}`);
  }
  if (unknown.hasSymbol) {
    fail('invalid_entry', `entry ${quote(key)} must not contain symbol keys`);
  }
  const hitsData = ownData(value, 'hits');
  if (!hitsData.ok) {
    fail('invalid_hits', `entry ${quote(key)} hits must be an array`);
  }
  const hits = readHits(hitsData.value, key, limit, windowMs, checkExpiry);
  if (isCanonicalEntry(value, hits)) {
    return value;
  }
  return Object.freeze({ hits });
}

function rejectEntryKeys(entries) {
  const hidden = [];
  let hasSymbol = false;
  let hasEmpty = false;
  for (const key of Reflect.ownKeys(entries)) {
    if (typeof key === 'symbol') {
      hasSymbol = true;
      continue;
    }
    if (key.length === 0) {
      hasEmpty = true;
      continue;
    }
    const descriptor = Object.getOwnPropertyDescriptor(entries, key);
    if (descriptor === undefined || descriptor.enumerable !== true) {
      hidden.push(key);
    }
  }
  if (hasEmpty) {
    fail('invalid_entries', 'state.entries must not contain an empty key');
  }
  hidden.sort();
  if (hidden.length > 0) {
    fail('invalid_entries', `state.entries key ${quote(hidden[0])} must be enumerable`);
  }
  if (hasSymbol) {
    fail('invalid_entries', 'state.entries must not contain symbol keys');
  }
}

function readEntries(entries, limit, windowMs, checkExpiry) {
  if (!isPlainObject(entries)) {
    fail('invalid_entries', 'state.entries must be a plain object');
  }
  rejectEntryKeys(entries);
  const built = Object.create(null);
  let identical = Object.isFrozen(entries) && Object.getPrototypeOf(entries) === null;
  for (const key of Object.keys(entries)) {
    const data = ownData(entries, key);
    if (!data.ok) {
      fail('invalid_entry', `entry ${quote(key)} must be a plain object`);
    }
    const entry = readEntry(data.value, key, limit, windowMs, checkExpiry);
    assignData(built, key, entry);
    if (entry !== data.value) {
      identical = false;
    }
  }
  if (identical) {
    return entries;
  }
  return built;
}

function stateReusable(state, entries) {
  if (!Object.isFrozen(state) || !isPlainObject(state)) {
    return false;
  }
  if (!sameKeys(Reflect.ownKeys(state), STATE_KEYS)) {
    return false;
  }
  for (const key of STATE_KEYS) {
    if (!isEnumerableData(state, key)) {
      return false;
    }
  }
  return state.entries === entries && Object.getPrototypeOf(entries) === null;
}

export function readState(state, checkExpiry) {
  if (!isPlainObject(state)) {
    fail('invalid_state', 'state must be a plain object');
  }
  const unknown = firstUnknown(state, STATE_KEY_SET);
  if (unknown.name !== undefined) {
    fail('invalid_state', `unknown state field ${quote(unknown.name)}`);
  }
  if (unknown.hasSymbol) {
    fail('invalid_state', 'state must not contain symbol keys');
  }
  const limit = readRequired(state, 'limit', isLimit, 'invalid_limit', STATE_LIMIT_MESSAGE);
  const windowMs = readRequired(
    state,
    'windowMs',
    isWindow,
    'invalid_window',
    STATE_WINDOW_MESSAGE,
  );
  const maxKeys = readRequired(
    state,
    'maxKeys',
    isMaxKeys,
    'invalid_max_keys',
    STATE_MAX_KEYS_MESSAGE,
  );
  const entriesData = ownData(state, 'entries');
  if (!entriesData.ok) {
    fail('invalid_entries', 'state.entries must be a plain object');
  }
  const entries = readEntries(entriesData.value, limit, windowMs, checkExpiry);
  return {
    limit,
    windowMs,
    maxKeys,
    entries,
    reusable: stateReusable(state, entries),
  };
}

export function readKey(key) {
  if (typeof key !== 'string' || key.length === 0) {
    fail('invalid_key', 'key must be a non-empty string');
  }
  return key;
}

export function readNow(nowMs) {
  if (!Number.isSafeInteger(nowMs)) {
    fail('invalid_now', 'nowMs must be a safe integer');
  }
  return Object.is(nowMs, -0) ? 0 : nowMs;
}
