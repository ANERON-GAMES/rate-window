# @aneron/rate-window

## Purpose

`@aneron/rate-window` decides whether one more event for a key is inside a sliding time window. Each call returns an allow or a deny, how many further allows remain, and the retry-after delay in milliseconds.

The caller passes `nowMs`. The package does not read a clock, start a timer, draw random numbers, or perform I/O. It keeps no mutable module state. The map you pass in is the whole memory of the limiter, and the map you get back is the next one.

A hit recorded at `atMs` stays inside the window while `nowMs` is still before `atMs + windowMs`. The instant `atMs + windowMs` is already outside. When the number of hits inside the window is below `limit`, the call allows and records one hit at `nowMs`. When the number is `limit`, the call denies and records nothing.

There are no runtime dependencies.

## Install

The package name is `@aneron/rate-window`. It is an ES module and requires Node.js 20 or newer.

```sh
npm install @aneron/rate-window
```

```js
import { createWindow, decide } from '@aneron/rate-window';
```

## Usage

```js
import { createWindow, decide, peek, reset, sweep } from '@aneron/rate-window';

const limits = createWindow({ limit: 3, windowMs: 1000 });

const first = decide(limits, 'upload', 5000);
const second = decide(first.state, 'upload', 5200);
const third = decide(second.state, 'upload', 5400);
const blocked = decide(third.state, 'upload', 5600);
const viewed = peek(blocked.state, 'upload', 5600);
const later = decide(blocked.state, 'upload', 6000);
```

`first` allows. Two further allows remain, so the retry-after is zero:

```js
{ allowed: true, decision: 'allow', remaining: 2, retryAfterMs: 0, active: 1, limit: 3 }
```

`second.remaining` is `1`. `third` takes the last slot. The oldest hit was recorded at `5000`, so it expires at `6000`:

```js
{ allowed: true, decision: 'allow', remaining: 0, retryAfterMs: 600, active: 3, limit: 3 }
```

`blocked` is a deny. Nothing is recorded. `viewed` is the same decision and does not change the map:

```js
{ allowed: false, decision: 'deny', remaining: 0, retryAfterMs: 400, active: 3, limit: 3 }
```

At `6000` the hit from `5000` has expired. `later` allows, and the new oldest hit expires 200 ms later:

```js
{ allowed: true, decision: 'allow', remaining: 0, retryAfterMs: 200, active: 3, limit: 3 }
```

`reset(later.state, 'upload')` drops that key. The next `decide` starts from an empty window. `sweep(later.state, 7000)` drops hits that have expired by `7000`.

Two calls that share an input state are forks. Each result carries its own next state. Keeping one does not change the other.

## API

### Constants

| Export              | Value              |
| ------------------- | ------------------ |
| `DEFAULT_LIMIT`     | `10`               |
| `DEFAULT_WINDOW_MS` | `1000`             |
| `DEFAULT_MAX_KEYS`  | `null`             |
| `MAX_LIMIT`         | `10000`            |
| `MAX_WINDOW_MS`     | `9007199254740991` |
| `DECISION_ALLOW`    | `'allow'`          |
| `DECISION_DENY`     | `'deny'`           |

`DEFAULTS` is frozen:

```js
{ limit: 10, windowMs: 1000, maxKeys: null }
```

`MAX_WINDOW_MS` is `Number.MAX_SAFE_INTEGER`. `maxKeys` uses the same upper bound. `null` means the map does not cap the number of keys.

### `RateWindowError`

```js
new RateWindowError(code, message);
```

Thrown when input is invalid, when `nowMs` moves backward for a key, or when recording a hit would make its expiry leave the safe integer range. It extends `Error`. `name` is `'RateWindowError'`. `code` is a stable string. `message` is a stable description.

### `createWindow(options)`

Returns a new window.

`options` may be omitted. A non-plain object throws. `null`, an array, a date, and a class instance are rejected. A frozen plain object and an object with a null prototype are accepted. Unknown keys are rejected, including symbol keys and non-enumerable keys. Only own properties are read. An accessor is not called.

An omitted key, or a key whose value is `undefined`, uses the default. `null` is a real `maxKeys` value and means unlimited. `null` is not accepted for `limit` or `windowMs`.

| Option     | Default | Accepted values                                         |
| ---------- | ------- | ------------------------------------------------------- |
| `limit`    | `10`    | Integer from `1` through `MAX_LIMIT`.                   |
| `windowMs` | `1000`  | Integer from `1` through `MAX_WINDOW_MS`.               |
| `maxKeys`  | `null`  | `null`, or an integer from `1` through `MAX_WINDOW_MS`. |

The return value is frozen:

```js
{ limit: 10, windowMs: 1000, maxKeys: null, entries: {} }
```

`entries` is a frozen object with a null prototype.

### `decide(state, key, nowMs)`

Decides one hit for `key` at `nowMs`.

| Argument | Required | Meaning                                                          |
| -------- | -------- | ---------------------------------------------------------------- |
| `state`  | yes      | A map from `createWindow`, or the same shape.                    |
| `key`    | yes      | Non-empty string. It is not trimmed and it is not case-folded.   |
| `nowMs`  | yes      | Current time in milliseconds on a timeline chosen by the caller. |

Checks run in this order. The first failure throws, and the input state is left as it was.

1. Validate `state`.
2. Validate `key`.
3. Validate `nowMs`. `-0` is read as `0`.
4. If this key has a stored hit later than `nowMs`, throw `clock_regression`.
5. Count hits inside the window. If the count is `limit`, deny.
6. If `nowMs + windowMs` is not a safe integer, throw `expiry_overflow`.
7. Record one hit and allow.

On allow and on deny the result is a new plain object:

```js
{
  state,
  allowed,
  decision,
  remaining,
  retryAfterMs,
  active,
  limit,
  evictedKeys,
}
```

| Field          | Type                  | Meaning                                                                                  |
| -------------- | --------------------- | ---------------------------------------------------------------------------------------- |
| `state`        | object                | Frozen map after the call. The same reference when a canonical state did not change.     |
| `allowed`      | boolean               | `true` when this call recorded a hit.                                                    |
| `decision`     | `'allow'` or `'deny'` | `DECISION_ALLOW` or `DECISION_DENY`. It agrees with `allowed`.                           |
| `remaining`    | integer               | Further allows available at this `nowMs` after this call. `0` on a deny.                 |
| `retryAfterMs` | integer               | `0` when `remaining > 0`. Otherwise the wait until the oldest hit in the window expires. |
| `active`       | integer               | Hits inside the window after this call. An allow counts the hit just recorded.           |
| `limit`        | integer               | The map limit.                                                                           |
| `evictedKeys`  | array of strings      | Other keys removed to make room for a new key. Empty on a deny and on an update.         |

`retryAfterMs` on a full window is an integer from `1` through `windowMs`. A delay of `0` means another allow can be recorded at the same `nowMs`. It is not a deny.

Hits at the same `nowMs` share one run, `{ atMs, count }`. The run expires once, and the whole count leaves the window together. Runs are strictly increasing by `atMs`.

`evictedKeys` is in removal order. The key being decided is never listed there.

A deny on a canonical state whose hits are already trimmed is the same state reference. A deny or an allow on a plain object, including one from `JSON.parse`, returns a new frozen state. An allow always returns a new state object. Entry objects that were not rewritten keep their identity.

### `peek(state, key, nowMs)`

Reports the decision `decide` would return, and does not record a hit, evict a key, or trim stored hits.

The arguments and the failure order match `decide`. The result has `allowed`, `decision`, `remaining`, `retryAfterMs`, `active`, and `limit`. It has no `state` and no `evictedKeys`.

### `reset(state, key)`

Drops one key. There is no clock argument, and a backward timestamp does not apply.

| Argument | Required | Meaning                  |
| -------- | -------- | ------------------------ |
| `state`  | yes      | Map to copy.             |
| `key`    | yes      | Non-empty key to delete. |

The return value is `{ state, removed }`. `removed` is `true` when the key was present. A missing key on a canonical state returns that same state and `removed: false`. Other entries keep their identity.

`reset` does not require a hit expiry to be a safe integer, so it can delete a key that `decide` rejects for `expiry_overflow`. The rest of the state is still validated. On failure the input is unchanged.

### `sweep(state, nowMs)`

Drops every hit with `atMs + windowMs <= nowMs`. A key with no hits left is removed. A key that still has a later hit keeps that suffix.

| Argument | Required | Meaning                                        |
| -------- | -------- | ---------------------------------------------- |
| `state`  | yes      | Map to copy.                                   |
| `nowMs`  | yes      | Caller clock, with the same rules as `decide`. |

The return value is `{ state, removed, keys }`. `removed` is how many keys were dropped. `keys` is those names sorted by `<` on strings, which compares UTF-16 code units. `"10"` sorts before `"2"`. When nothing changes and the state is already canonical, `state` is the same reference and `keys` is empty.

`sweep` does not evict for `maxKeys`. It does not throw `clock_regression`. A `nowMs` earlier than a stored hit drops nothing that is still inside that hit's window.

### State

```js
{
  limit: 3,
  windowMs: 1000,
  maxKeys: null,
  entries: {
    upload: {
      hits: [{ atMs: 5200, count: 1 }],
    },
  },
}
```

| Field      | Accepted values                                                   |
| ---------- | ----------------------------------------------------------------- |
| `limit`    | Integer from `1` through `MAX_LIMIT`. Required.                   |
| `windowMs` | Integer from `1` through `MAX_WINDOW_MS`. Required.               |
| `maxKeys`  | `null`, or an integer from `1` through `MAX_WINDOW_MS`. Required. |
| `entries`  | Plain object. Required. An empty object means no stored keys.     |

Each entry is a plain object whose only field is `hits`. `hits` is a non-empty array of `{ atMs, count }`. `atMs` is a safe integer. `count` is an integer from `1` through `limit`. `atMs` is strictly increasing. The sum of `count` is at most `limit`. For `decide`, `peek`, and `sweep`, `atMs + windowMs` must be a safe integer.

Unknown fields are rejected. Symbol keys are rejected. Non-enumerable entry keys are rejected. An accessor is not called. Only own data properties are read. Inherited properties are not a plain object when the prototype is something other than `Object.prototype` or `null`.

Negative zero is accepted for `atMs` and `nowMs` and stored as `0`. A count of negative zero is rejected.

The object is JSON-serializable. `JSON.stringify` keeps the numbers and the keys. The next call freezes the parsed object again and restores the null prototype on `entries`. A key named `__proto__` or `constructor` is stored as data.

Keys are opaque strings. `"Upload"` and `"upload"` are different keys. A surrounding space is part of the key. The empty string is not a key.

`maxKeys` counts stored keys, including a key whose hits have all expired, until `sweep` or a later `decide` drops it. A hand-built state may contain more keys than `maxKeys`. The cap is applied when a new key is inserted. Updating a key that still has a hit inside the window does not evict.

### Eviction

Eviction runs only when `decide` inserts a key and `maxKeys` is not `null` and the stored count is already at least `maxKeys`. A key is an insert when it was absent, or when every one of its hits has expired at `nowMs`. That expired key is removed first. If a free slot remains, no other key is evicted, and `evictedKeys` is empty.

Otherwise keys are removed until one slot is free, in this order:

1. Keys with no hits inside the window, earliest stored `atMs` first.
2. Keys that still have hits inside the window, earliest latest-hit first.
3. Equal timestamps break the tie by the key string, ascending under `<`.

### Errors

Validation reports the first problem in the order above. Option fields are checked in the order `limit`, `windowMs`, `maxKeys`. State fields use that same order after unknown keys. Unknown keys are reported before field values. When several unknown keys are present, the lexicographically first string key is the one named in the message. Entry keys are checked in ordinary object key order: integer-like keys first, numerically, then other strings in insertion order.

| `code`             | `message`                                                                     |
| ------------------ | ----------------------------------------------------------------------------- |
| `invalid_options`  | `options must be a plain object`                                              |
| `unknown_option`   | `unknown option "<name>"`                                                     |
| `unknown_option`   | `options must not contain symbol keys`                                        |
| `invalid_limit`    | `limit must be an integer from 1 through 10000`                               |
| `invalid_limit`    | `state.limit must be an integer from 1 through 10000`                         |
| `invalid_window`   | `windowMs must be an integer from 1 through 9007199254740991`                 |
| `invalid_window`   | `state.windowMs must be an integer from 1 through 9007199254740991`           |
| `invalid_max_keys` | `maxKeys must be null or an integer from 1 through 9007199254740991`          |
| `invalid_max_keys` | `state.maxKeys must be null or an integer from 1 through 9007199254740991`    |
| `invalid_state`    | `state must be a plain object`                                                |
| `invalid_state`    | `unknown state field "<name>"`                                                |
| `invalid_state`    | `state must not contain symbol keys`                                          |
| `invalid_entries`  | `state.entries must be a plain object`                                        |
| `invalid_entries`  | `state.entries must not contain an empty key`                                 |
| `invalid_entries`  | `state.entries key "<name>" must be enumerable`                               |
| `invalid_entries`  | `state.entries must not contain symbol keys`                                  |
| `invalid_entry`    | `entry "<key>" must be a plain object`                                        |
| `invalid_entry`    | `entry "<key>" has unknown field "<name>"`                                    |
| `invalid_entry`    | `entry "<key>" must not contain symbol keys`                                  |
| `invalid_hits`     | `entry "<key>" hits must be an array`                                         |
| `invalid_hits`     | `entry "<key>" hits must not be empty`                                        |
| `invalid_hits`     | `entry "<key>" hits must not contain holes`                                   |
| `invalid_hit`      | `entry "<key>" hit <index> must be a plain object`                            |
| `invalid_hit`      | `entry "<key>" hit <index> has unknown field "<name>"`                        |
| `invalid_hit`      | `entry "<key>" hit <index> must not contain symbol keys`                      |
| `invalid_hit`      | `entry "<key>" hit <index> atMs must be a safe integer`                       |
| `invalid_hit`      | `entry "<key>" hit <index> count must be an integer from 1 through the limit` |
| `invalid_hit`      | `entry "<key>" hits must be strictly increasing by atMs`                      |
| `invalid_hit`      | `entry "<key>" hit counts exceed the limit`                                   |
| `invalid_key`      | `key must be a non-empty string`                                              |
| `invalid_now`      | `nowMs must be a safe integer`                                                |
| `clock_regression` | `nowMs is earlier than the latest hit for "<key>"`                            |
| `expiry_overflow`  | `entry "<key>" hit <index> expires outside the safe integer range`            |
| `expiry_overflow`  | `recording a hit at this nowMs expires outside the safe integer range`        |

`<key>` and `<name>` are JSON string text, so a quote inside a key stays escaped.

## Design

The window is an exact log of allowed hits, not a fixed bucket and not an estimate. A deny does not consume a slot. Replaying the same state and the same `nowMs` returns the same decision.

Time is an integer millisecond timeline owned by the caller. Any origin is fine, including a negative origin. `nowMs` for one key must be greater than or equal to that key's latest stored hit. A smaller `nowMs` throws `clock_regression` and does not write. That rule keeps every window from holding more than `limit` hits: a backward clock that ignored later hits could admit a second batch, and those two batches would overlap once time caught up. `reset` is how a caller drops a key and starts again. Another key has its own latest hit.

Because the total stored count is at most `limit`, and `limit` is at most `10000`, one key cannot grow an unbounded log. Same-timestamp hits collapse into a single run so a burst at one instant stores one object. That run expires together, which is the same schedule as one timestamp per hit.

`retryAfterMs` is the wait until the oldest run in the current window reaches `atMs + windowMs`. After that instant a following `decide` can allow, provided nothing else fills the window. The value is exact integer arithmetic on safe integers. A planned expiry equal to `nowMs` is already outside the window, so the boundary allows.

`maxKeys` bounds the map when new keys arrive. The victim is the key whose next useful history is oldest: an already-expired key before a live one, and among live keys the one whose latest hit is earliest. The tie break is the key text, so two equal timestamps always drop the same key. `"10"` sorts before `"2"`. Eviction does not run on a deny, and it does not run when the key being updated still has a hit inside the window.

Returned maps are frozen. `entries` has a null prototype, and values are copied from own data properties, so a key cannot change `Object.prototype`. Inputs are not mutated. A caller can keep a state, serialize it, and pass it back later. Forks are ordinary: call `decide` twice on the same state and keep the result you want.

The package does not schedule work, sleep, log, read the environment, or touch the network or the filesystem. `Date.now` and `Math.random` are never called. Node.js 20 or newer is required. The test, lint, and format scripts are `npm test`, `npm run lint`, and `npm run format:check`, and they run on Node.js 20 and Node.js 22.

## License

MIT License

Copyright (c) 2026 Vadim Gubin

The complete terms are in the LICENSE file.
