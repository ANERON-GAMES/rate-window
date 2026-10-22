export function isPlainObject(value) {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

export function ownData(object, key) {
  const descriptor = Object.getOwnPropertyDescriptor(object, key);
  if (descriptor === undefined || !Object.hasOwn(descriptor, 'value')) {
    return { ok: false };
  }
  return { ok: true, value: descriptor.value };
}

export function isEnumerableData(object, key) {
  const descriptor = Object.getOwnPropertyDescriptor(object, key);
  return (
    descriptor !== undefined && descriptor.enumerable === true && Object.hasOwn(descriptor, 'value')
  );
}

export function assignData(target, key, value) {
  Object.defineProperty(target, key, {
    value,
    writable: true,
    enumerable: true,
    configurable: true,
  });
}

export function firstUnknown(object, allowed) {
  const names = [];
  let hasSymbol = false;
  for (const key of Reflect.ownKeys(object)) {
    if (typeof key === 'symbol') {
      hasSymbol = true;
      continue;
    }
    if (!allowed.has(key)) {
      names.push(key);
    }
  }
  names.sort();
  return { name: names[0], hasSymbol };
}

export function sameKeys(keys, expected) {
  if (keys.length !== expected.length) {
    return false;
  }
  const seen = new Set(keys);
  if (seen.size !== expected.length) {
    return false;
  }
  for (const key of expected) {
    if (!seen.has(key)) {
      return false;
    }
  }
  return true;
}

export function quote(value) {
  return JSON.stringify(value);
}

export function compareKeys(left, right) {
  if (left < right) {
    return -1;
  }
  if (left > right) {
    return 1;
  }
  return 0;
}
