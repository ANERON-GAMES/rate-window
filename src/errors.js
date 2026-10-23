export class RateWindowError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'RateWindowError';
    this.code = code;
  }
}

export function fail(code, message) {
  throw new RateWindowError(code, message);
}
