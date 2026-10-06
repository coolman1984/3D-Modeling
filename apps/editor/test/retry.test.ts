import { describe, expect, it } from 'vitest';
import { retryDelay } from '../src/logic/retry.js';

describe('save retry delay', () => {
  it('doubles from 2 s and stops growing at 30 s', () => {
    expect([0, 1, 2, 3, 4, 5, 20].map(retryDelay)).toEqual([2_000, 4_000, 8_000, 16_000, 30_000, 30_000, 30_000]);
  });

  it('treats odd input as the first attempt', () => {
    expect(retryDelay(-3)).toBe(2_000);
    expect(retryDelay(Number.NaN)).toBe(2_000);
    expect(retryDelay(1.9)).toBe(4_000);
  });
});
