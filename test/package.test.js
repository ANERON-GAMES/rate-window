import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import test from 'node:test';
import { DECISION_ALLOW, DECISION_DENY, RateWindowError } from '../src/index.js';
import * as api from '../src/index.js';

const root = new URL('..', import.meta.url);

test('public exports stay limited to the documented surface', () => {
  assert.deepEqual(Object.keys(api).sort(), [
    'DECISION_ALLOW',
    'DECISION_DENY',
    'DEFAULTS',
    'DEFAULT_LIMIT',
    'DEFAULT_MAX_KEYS',
    'DEFAULT_WINDOW_MS',
    'MAX_LIMIT',
    'MAX_WINDOW_MS',
    'RateWindowError',
    'createWindow',
    'decide',
    'peek',
    'reset',
    'sweep',
  ]);
  assert.equal(DECISION_ALLOW, 'allow');
  assert.equal(DECISION_DENY, 'deny');
});

test('RateWindowError stores a code and a message', () => {
  const error = new RateWindowError('invalid_key', 'key must be a non-empty string');
  assert.equal(error instanceof Error, true);
  assert.equal(error.name, 'RateWindowError');
  assert.equal(error.code, 'invalid_key');
  assert.equal(error.message, 'key must be a non-empty string');
});

test('package metadata names the module and the author', () => {
  const pkg = JSON.parse(readFileSync(new URL('package.json', root), 'utf8'));
  assert.equal(pkg.name, '@aneron/rate-window');
  assert.equal(pkg.license, 'MIT');
  assert.equal(pkg.author, 'Vadim Gubin');
  assert.equal(pkg.type, 'module');
  assert.equal(pkg.engines.node, '>=20');
  const license = readFileSync(new URL('LICENSE', root), 'utf8');
  assert.equal(license.includes('Copyright (c) 2026 Vadim Gubin'), true);
  const readme = readFileSync(new URL('README.md', root), 'utf8');
  for (const heading of [
    '## Purpose',
    '## Install',
    '## Usage',
    '## API',
    '## Design',
    '## License',
  ]) {
    assert.equal(readme.includes(heading), true, heading);
  }
  assert.equal(readme.includes('remaining: 2'), true);
  assert.equal(readme.includes('retryAfterMs: 600'), true);
  assert.equal(readme.includes('retryAfterMs: 400'), true);
  assert.equal(readme.includes('retryAfterMs: 200'), true);
});

test('source files do not contain comments, clocks, timers, or network addresses', () => {
  const files = readdirSync(new URL('src/', root));
  assert.equal(files.length > 0, true);
  for (const file of files) {
    const source = readFileSync(new URL(`src/${file}`, root), 'utf8');
    assert.equal(source.includes('/*'), false, file);
    assert.equal(source.includes('//'), false, file);
    for (const token of [
      'Date',
      'setTimeout',
      'setInterval',
      'Math.random',
      'process',
      'fetch(',
      'globalThis',
      'queueMicrotask',
      'setImmediate',
    ]) {
      assert.equal(source.includes(token), false, `${file} ${token}`);
    }
  }
  const readme = readFileSync(new URL('README.md', root), 'utf8');
  const license = readFileSync(new URL('LICENSE', root), 'utf8');
  for (const text of [readme, license]) {
    assert.equal(text.includes('http://'), false);
    assert.equal(text.includes('https://'), false);
  }
});
