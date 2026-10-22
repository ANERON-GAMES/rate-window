import { DECISION_ALLOW, DECISION_DENY } from './constants.js';
import { fail } from './errors.js';
import { latestAtMs, pruneHits, retryAfterMs, sumCounts, withHit } from './hits.js';
import { assignData, compareKeys, quote } from './plain.js';
import { readKey, readNow, readOptions, readState } from './validate.js';

const EMPTY_HITS = Object.freeze([]);

export function createWindow(options) {
  const resolved = readOptions(options);
  return freezeState(resolved, Object.create(null));
}

export function decide(state, key, nowMs) {
  const current = readState(state, true);
  const name = readKey(key);
  const now = readNow(nowMs);
  const had = Object.hasOwn(current.entries, name);
  const hits = had ? current.entries[name].hits : EMPTY_HITS;
  assertClock(hits, now, name);
  const active = pruneHits(hits, now, current.windowMs);
  const outcome = assess(active, current.limit, current.windowMs, now);
  if (!outcome.allowed) {
    return {
      state: commitDeny(state, current, name, active, hits),
      allowed: false,
      decision: DECISION_DENY,
      remaining: outcome.remaining,
      retryAfterMs: outcome.retryAfterMs,
      active: outcome.active,
      limit: current.limit,
      evictedKeys: [],
    };
  }
  const written = commitAllow(current, name, outcome.hits, active.length === 0, now);
  return {
    state: written.state,
    allowed: true,
    decision: DECISION_ALLOW,
    remaining: outcome.remaining,
    retryAfterMs: outcome.retryAfterMs,
    active: outcome.active,
    limit: current.limit,
    evictedKeys: written.evictedKeys,
  };
}

export function peek(state, key, nowMs) {
  const current = readState(state, true);
  const name = readKey(key);
  const now = readNow(nowMs);
  const hits = Object.hasOwn(current.entries, name) ? current.entries[name].hits : EMPTY_HITS;
  assertClock(hits, now, name);
  const active = pruneHits(hits, now, current.windowMs);
  const outcome = assess(active, current.limit, current.windowMs, now);
  return {
    allowed: outcome.allowed,
    decision: outcome.allowed ? DECISION_ALLOW : DECISION_DENY,
    remaining: outcome.remaining,
    retryAfterMs: outcome.retryAfterMs,
    active: outcome.active,
    limit: current.limit,
  };
}

export function reset(state, key) {
  const current = readState(state, false);
  const name = readKey(key);
  if (!Object.hasOwn(current.entries, name)) {
    return { state: publish(state, current), removed: false };
  }
  const entries = copyEntries(current.entries);
  delete entries[name];
  return { state: freezeState(current, entries), removed: true };
}

export function sweep(state, nowMs) {
  const current = readState(state, true);
  const now = readNow(nowMs);
  const removed = [];
  const entries = Object.create(null);
  let changed = false;
  for (const key of Object.keys(current.entries)) {
    const hits = current.entries[key].hits;
    const active = pruneHits(hits, now, current.windowMs);
    if (active.length === 0) {
      removed.push(key);
      changed = true;
      continue;
    }
    if (active !== hits) {
      assignData(entries, key, freezeEntry(active));
      changed = true;
      continue;
    }
    assignData(entries, key, current.entries[key]);
  }
  removed.sort(compareKeys);
  if (!changed) {
    return { state: publish(state, current), removed: 0, keys: removed };
  }
  return { state: freezeState(current, entries), removed: removed.length, keys: removed };
}

function assess(active, limit, windowMs, nowMs) {
  const count = sumCounts(active);
  if (count >= limit) {
    return {
      allowed: false,
      remaining: 0,
      retryAfterMs: retryAfterMs(active, nowMs, windowMs, 0),
      active: count,
      hits: null,
    };
  }
  if (!Number.isSafeInteger(nowMs + windowMs)) {
    fail('expiry_overflow', 'recording a hit at this nowMs expires outside the safe integer range');
  }
  const hits = withHit(active, nowMs);
  const remaining = limit - (count + 1);
  return {
    allowed: true,
    remaining,
    retryAfterMs: retryAfterMs(hits, nowMs, windowMs, remaining),
    active: count + 1,
    hits,
  };
}

function assertClock(hits, nowMs, key) {
  const latest = latestAtMs(hits);
  if (latest !== null && latest > nowMs) {
    fail('clock_regression', `nowMs is earlier than the latest hit for ${quote(key)}`);
  }
}

function commitDeny(original, current, name, active, hits) {
  if (active === hits) {
    return publish(original, current);
  }
  const entries = copyEntries(current.entries);
  if (active.length === 0) {
    delete entries[name];
  } else {
    assignData(entries, name, freezeEntry(active));
  }
  return freezeState(current, entries);
}

function commitAllow(current, name, hits, inserting, nowMs) {
  const entries = copyEntries(current.entries);
  if (inserting && Object.hasOwn(entries, name)) {
    delete entries[name];
  }
  const evictedKeys = inserting
    ? ensureRoom(entries, current.maxKeys, nowMs, current.windowMs)
    : [];
  assignData(entries, name, freezeEntry(hits));
  return { state: freezeState(current, entries), evictedKeys };
}

function ensureRoom(entries, maxKeys, nowMs, windowMs) {
  if (maxKeys === null || Object.keys(entries).length < maxKeys) {
    return [];
  }
  const victims = rankVictims(entries, nowMs, windowMs);
  const evictedKeys = [];
  for (const victim of victims) {
    if (Object.keys(entries).length < maxKeys) {
      break;
    }
    delete entries[victim];
    evictedKeys.push(victim);
  }
  return evictedKeys;
}

function rankVictims(entries, nowMs, windowMs) {
  const ranked = [];
  for (const key of Object.keys(entries)) {
    const hits = entries[key].hits;
    const active = pruneHits(hits, nowMs, windowMs);
    if (active.length === 0) {
      ranked.push({ key, tier: 0, atMs: hits[0].atMs });
    } else {
      ranked.push({ key, tier: 1, atMs: active[active.length - 1].atMs });
    }
  }
  ranked.sort(compareVictims);
  return ranked.map((item) => item.key);
}

function compareVictims(left, right) {
  if (left.tier !== right.tier) {
    return left.tier < right.tier ? -1 : 1;
  }
  if (left.atMs !== right.atMs) {
    return left.atMs < right.atMs ? -1 : 1;
  }
  return compareKeys(left.key, right.key);
}

function publish(original, current) {
  if (current.reusable) {
    return original;
  }
  return freezeState(current, current.entries);
}

function freezeEntry(hits) {
  return Object.freeze({
    hits: Object.isFrozen(hits) ? hits : Object.freeze(hits),
  });
}

function freezeState(meta, entries) {
  return Object.freeze({
    limit: meta.limit,
    windowMs: meta.windowMs,
    maxKeys: meta.maxKeys,
    entries: Object.freeze(entries),
  });
}

function copyEntries(entries) {
  const copy = Object.create(null);
  for (const key of Object.keys(entries)) {
    assignData(copy, key, entries[key]);
  }
  return copy;
}
