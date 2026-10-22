export function sumCounts(hits) {
  let total = 0;
  for (const hit of hits) {
    total += hit.count;
  }
  return total;
}

export function pruneHits(hits, nowMs, windowMs) {
  let index = 0;
  while (index < hits.length && hits[index].atMs + windowMs <= nowMs) {
    index += 1;
  }
  if (index === 0) {
    return hits;
  }
  return hits.slice(index);
}

export function withHit(hits, nowMs) {
  const atMs = Object.is(nowMs, -0) ? 0 : nowMs;
  const next = hits.slice();
  const lastIndex = next.length - 1;
  if (lastIndex >= 0 && next[lastIndex].atMs === atMs) {
    next[lastIndex] = Object.freeze({
      atMs,
      count: next[lastIndex].count + 1,
    });
    return next;
  }
  next.push(Object.freeze({ atMs, count: 1 }));
  return next;
}

export function latestAtMs(hits) {
  if (hits.length === 0) {
    return null;
  }
  return hits[hits.length - 1].atMs;
}

export function retryAfterMs(hits, nowMs, windowMs, remaining) {
  if (remaining > 0) {
    return 0;
  }
  return hits[0].atMs + windowMs - nowMs;
}
