/** Machine-readable reason codes for every error the core can raise. */
export type CoreErrorCode = 'not-a-number' | 'not-an-integer' | 'out-of-range';

/** The only error type thrown by the core. `code` is stable; `message` is for developers. */
export class CoreError extends Error {
  readonly code: CoreErrorCode;

  constructor(code: CoreErrorCode, message: string) {
    super(message);
    this.name = 'CoreError';
    this.code = code;
  }
}
