import { CoreError } from '../errors.js';
import { roundHalfAwayFromZero } from './rounding.js';

/** Stored length: an integer count of 0.1 mm. */
export type Tick = number;

export const TICKS_PER_MM = 10;

/** Largest absolute coordinate the core accepts: 1 km. */
export const MAX_COORDINATE: Tick = 10_000_000;

/** Geometric comparison tolerance: 0.2 mm. Storage precision is not field precision. */
export const TOLERANCE: Tick = 2;

export type LengthUnit = 'mm' | 'cm' | 'm' | 'in' | 'ft';

/** Every supported unit is an exact whole number of ticks, so conversions stay exact. */
export const TICKS_PER_UNIT: Readonly<Record<LengthUnit, number>> = {
  mm: 10,
  cm: 100,
  m: 10_000,
  in: 254,
  ft: 3_048,
};

export function isTick(value: unknown): value is Tick {
  return typeof value === 'number' && Number.isSafeInteger(value) && !Object.is(value, -0);
}

/** Throws unless `value` is an integer tick within the world range. */
export function assertCoordinate(value: number, what = 'coordinate'): Tick {
  if (!Number.isFinite(value)) {
    throw new CoreError('not-a-number', `${what} must be a finite number, got ${value}`);
  }
  if (!Number.isInteger(value)) {
    throw new CoreError('not-an-integer', `${what} must be an integer tick, got ${value}`);
  }
  if (Math.abs(value) > MAX_COORDINATE) {
    throw new CoreError('out-of-range', `${what} ${value} exceeds ±${MAX_COORDINATE} ticks`);
  }
  return value === 0 ? 0 : value;
}

/** Throws unless `value` is a non-negative integer tick within the world range. */
export function assertLength(value: number, what = 'length'): Tick {
  const tick = assertCoordinate(value, what);
  if (tick < 0) {
    throw new CoreError('out-of-range', `${what} must not be negative, got ${value}`);
  }
  return tick;
}

/** Convert a user value to ticks, snapping to the nearest 0.1 mm. */
export function fromUnit(value: number, unit: LengthUnit): Tick {
  if (!Number.isFinite(value)) {
    throw new CoreError('not-a-number', `length must be a finite number, got ${value}`);
  }
  return assertCoordinate(roundHalfAwayFromZero(value * TICKS_PER_UNIT[unit]), `${value} ${unit}`);
}

/** Convert ticks to a display value. The result may be fractional; format it at the UI edge. */
export function toUnit(ticks: Tick, unit: LengthUnit): number {
  return ticks / TICKS_PER_UNIT[unit];
}

export function fromMillimetres(mm: number): Tick {
  return fromUnit(mm, 'mm');
}

export function toMillimetres(ticks: Tick): number {
  return toUnit(ticks, 'mm');
}
