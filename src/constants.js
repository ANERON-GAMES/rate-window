export const DEFAULT_LIMIT = 10;
export const DEFAULT_WINDOW_MS = 1000;
export const DEFAULT_MAX_KEYS = null;
export const MAX_LIMIT = 10000;
export const MAX_WINDOW_MS = Number.MAX_SAFE_INTEGER;
export const DECISION_ALLOW = 'allow';
export const DECISION_DENY = 'deny';

export const DEFAULTS = Object.freeze({
  limit: DEFAULT_LIMIT,
  windowMs: DEFAULT_WINDOW_MS,
  maxKeys: DEFAULT_MAX_KEYS,
});
