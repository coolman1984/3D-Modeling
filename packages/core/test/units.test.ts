import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  CoreError,
  FULL_TURN,
  MAX_COORDINATE,
  TICKS_PER_UNIT,
  assertCoordinate,
  assertLength,
  cosSin,
  fromDegrees,
  fromMillimetres,
  fromUnit,
  isTick,
  normalizeAngle,
  roundHalfAwayFromZero,
  toDegrees,
  toMillimetres,
  toSquareMetres,
  toUnit,
  type LengthUnit,
} from '../src/index.js';

const units = Object.keys(TICKS_PER_UNIT) as LengthUnit[];
const anyTick = fc.integer({ min: -MAX_COORDINATE, max: MAX_COORDINATE });
const anyUnit = fc.constantFrom(...units);

function codeOf(fn: () => unknown): string | undefined {
  try {
    fn();
  } catch (error) {
    return error instanceof CoreError ? error.code : 'not-a-core-error';
  }
  return undefined;
}

describe('rounding', () => {
  it('rounds half away from zero symmetrically', () => {
    expect(roundHalfAwayFromZero(2.5)).toBe(3);
    expect(roundHalfAwayFromZero(-2.5)).toBe(-3);
    expect(roundHalfAwayFromZero(2.4)).toBe(2);
    expect(roundHalfAwayFromZero(-2.4)).toBe(-2);
  });

  it('never returns negative zero', () => {
    expect(Object.is(roundHalfAwayFromZero(-0.3), 0)).toBe(true);
    expect(Object.is(roundHalfAwayFromZero(-0), 0)).toBe(true);
  });
});

describe('length conversions', () => {
  it('uses exact tick counts per unit', () => {
    expect(fromUnit(1, 'mm')).toBe(10);
    expect(fromUnit(1, 'cm')).toBe(100);
    expect(fromUnit(1, 'm')).toBe(10_000);
    expect(fromUnit(1, 'in')).toBe(254);
    expect(fromUnit(1, 'ft')).toBe(3_048);
  });

  it('snaps to the nearest 0.1 mm', () => {
    expect(fromMillimetres(12.34)).toBe(123);
    expect(fromMillimetres(12.35)).toBe(124);
    expect(fromMillimetres(-12.35)).toBe(-124);
    expect(fromUnit(1.15, 'cm')).toBe(115);
  });

  it('round-trips every tick through every unit without loss', () => {
    fc.assert(
      fc.property(anyTick, anyUnit, (tick, unit) => {
        expect(fromUnit(toUnit(tick, unit), unit)).toBe(tick);
      }),
    );
  });

  it('keeps ticks exact when converting to millimetres', () => {
    expect(toMillimetres(123)).toBe(12.3);
    expect(toUnit(30_480, 'ft')).toBe(10);
  });

  it('rejects non-finite input', () => {
    expect(codeOf(() => fromUnit(Number.NaN, 'm'))).toBe('not-a-number');
    expect(codeOf(() => fromUnit(Number.POSITIVE_INFINITY, 'm'))).toBe('not-a-number');
  });

  it('rejects values beyond 1 km', () => {
    expect(fromUnit(1000, 'm')).toBe(MAX_COORDINATE);
    expect(codeOf(() => fromUnit(1000.001, 'm'))).toBe('out-of-range');
    expect(codeOf(() => fromUnit(-1000.001, 'm'))).toBe('out-of-range');
  });
});

describe('tick validation', () => {
  it('recognises integer ticks only', () => {
    expect(isTick(5)).toBe(true);
    expect(isTick(-5)).toBe(true);
    expect(isTick(0.5)).toBe(false);
    expect(isTick(-0)).toBe(false);
    expect(isTick(Number.NaN)).toBe(false);
    expect(isTick('5')).toBe(false);
  });

  it('assertCoordinate accepts in-range integers and normalises -0', () => {
    expect(assertCoordinate(42)).toBe(42);
    expect(Object.is(assertCoordinate(-0), 0)).toBe(true);
  });

  it('assertCoordinate reports why a value is invalid', () => {
    expect(codeOf(() => assertCoordinate(Number.NaN))).toBe('not-a-number');
    expect(codeOf(() => assertCoordinate(1.5))).toBe('not-an-integer');
    expect(codeOf(() => assertCoordinate(MAX_COORDINATE + 1))).toBe('out-of-range');
  });

  it('assertLength rejects negative lengths', () => {
    expect(assertLength(0)).toBe(0);
    expect(codeOf(() => assertLength(-1))).toBe('out-of-range');
  });
});

describe('angles', () => {
  it('normalises into [0, 360°)', () => {
    expect(normalizeAngle(0)).toBe(0);
    expect(normalizeAngle(FULL_TURN)).toBe(0);
    expect(normalizeAngle(-90_000)).toBe(270_000);
    expect(normalizeAngle(450_000)).toBe(90_000);
    expect(Object.is(normalizeAngle(-FULL_TURN), 0)).toBe(true);
  });

  it('normalisation is idempotent and stays in range', () => {
    fc.assert(
      fc.property(fc.integer({ min: -1e9, max: 1e9 }), (angle) => {
        const n = normalizeAngle(angle);
        expect(n).toBeGreaterThanOrEqual(0);
        expect(n).toBeLessThan(FULL_TURN);
        expect(normalizeAngle(n)).toBe(n);
        expect(normalizeAngle(angle + FULL_TURN)).toBe(n);
      }),
    );
  });

  it('converts degrees to millidegrees', () => {
    expect(fromDegrees(90)).toBe(90_000);
    expect(fromDegrees(-45)).toBe(315_000);
    expect(fromDegrees(12.3456)).toBe(12_346);
    expect(toDegrees(12_346)).toBe(12.346);
  });

  it('rejects invalid angles', () => {
    expect(codeOf(() => normalizeAngle(1.5))).toBe('not-an-integer');
    expect(codeOf(() => fromDegrees(Number.NaN))).toBe('not-a-number');
  });

  it('gives exact cos/sin for right angles', () => {
    expect(cosSin(0)).toEqual([1, 0]);
    expect(cosSin(90_000)).toEqual([0, 1]);
    expect(cosSin(180_000)).toEqual([-1, 0]);
    expect(cosSin(-90_000)).toEqual([0, -1]);
  });

  it('gives unit-length cos/sin for any angle', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: FULL_TURN - 1 }), (angle) => {
        const [c, s] = cosSin(angle);
        expect(c * c + s * s).toBeCloseTo(1, 12);
      }),
    );
  });
});

describe('area', () => {
  it('converts square ticks to square metres', () => {
    expect(toSquareMetres(10_000 * 10_000)).toBe(1);
    expect(toSquareMetres(100_000 * 80_000)).toBe(80);
  });
});
