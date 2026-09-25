import { CoreError } from '../errors.js';
import { roundHalfAwayFromZero } from './rounding.js';

/** Stored angle: integer millidegrees, counter-clockwise about +Z. */
export type MilliDeg = number;

export const FULL_TURN: MilliDeg = 360_000;
export const HALF_TURN: MilliDeg = 180_000;
export const QUARTER_TURN: MilliDeg = 90_000;

/** Map any integer angle into [0, FULL_TURN). */
export function normalizeAngle(angle: MilliDeg): MilliDeg {
  if (!Number.isFinite(angle)) {
    throw new CoreError('not-a-number', `angle must be a finite number, got ${angle}`);
  }
  if (!Number.isInteger(angle)) {
    throw new CoreError('not-an-integer', `angle must be integer millidegrees, got ${angle}`);
  }
  const wrapped = ((angle % FULL_TURN) + FULL_TURN) % FULL_TURN;
  return wrapped === 0 ? 0 : wrapped;
}

export function fromDegrees(degrees: number): MilliDeg {
  if (!Number.isFinite(degrees)) {
    throw new CoreError('not-a-number', `angle must be a finite number, got ${degrees}`);
  }
  return normalizeAngle(roundHalfAwayFromZero(degrees * 1000));
}

export function toDegrees(angle: MilliDeg): number {
  return angle / 1000;
}

export function toRadians(angle: MilliDeg): number {
  return (angle / 1000) * (Math.PI / 180);
}

/**
 * Exact cosine and sine for multiples of 90°, so axis-aligned rotations
 * never introduce floating-point drift. Other angles use Math.cos/sin.
 */
export function cosSin(angle: MilliDeg): readonly [cos: number, sin: number] {
  switch (normalizeAngle(angle)) {
    case 0:
      return [1, 0];
    case QUARTER_TURN:
      return [0, 1];
    case HALF_TURN:
      return [-1, 0];
    case 3 * QUARTER_TURN:
      return [0, -1];
    default: {
      const radians = toRadians(angle);
      return [Math.cos(radians), Math.sin(radians)];
    }
  }
}
