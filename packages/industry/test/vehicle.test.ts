import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { bodyAt, dubins, dubinsReverse, mod2pi, pathLength, rearAxleRadius, samplePath, type Pose, type VehicleProfile } from '../src/index.js';

const m = (v: number) => v * 10_000;
const R = m(5);
const angleGap = (a: number, b: number) => Math.min(mod2pi(a - b), mod2pi(b - a));

describe('vehicle kinematics', () => {
  it('turning circle from a spec sheet to the rear-axle radius: 11 m, 2.8 m wheelbase, 1.8 m wide → 3.83 m', () => {
    // √(5.5² − 2.8²) − 0.9 = √(30.25 − 7.84) − 0.9 = √22.41 − 0.9 = 4.7339 − 0.9
    expect(rearAxleRadius(m(11), m(2.8), m(1.8)) / 10_000).toBeCloseTo(3.8339, 4);
  });

  it('body corners at a pose: a 4.7 m car facing north with its rear axle at the origin', () => {
    const car: VehicleProfile = { id: 'car', label: 'Car', length: m(4.7), width: m(1.8), wheelbase: m(2.8), frontOverhang: m(0.95), rearOverhang: m(0.95), minRadius: m(4), reverse: true };
    const corners = bodyAt(car, { x: 0, y: 0, heading: Math.PI / 2 });
    const r = (v: number) => Math.round(v);
    expect(corners.map((p) => [r(p.x), r(p.y)])).toEqual([
      [m(0.9), m(-0.95)],
      [m(0.9), m(3.75)],
      [m(-0.9), m(3.75)],
      [m(-0.9), m(-0.95)],
    ]);
  });

  it('by hand: straight ahead is a straight line; a U-turn to the left is half a circle', () => {
    const straight = dubins({ x: 0, y: 0, heading: 0 }, { x: m(10), y: 0, heading: 0 }, R)!;
    expect(straight.map((s) => s.kind)).toEqual(['S']);
    expect(pathLength(straight)).toBeCloseTo(m(10), 6);
    const uturn = dubins({ x: 0, y: 0, heading: 0 }, { x: 0, y: 2 * R, heading: Math.PI }, R)!;
    expect(uturn.map((s) => s.kind)).toEqual(['L']);
    expect(pathLength(uturn)).toBeCloseTo(Math.PI * R, 6);
    // Backing straight 6 m: one reverse straight.
    const back = dubinsReverse({ x: 0, y: 0, heading: 0 }, { x: m(-6), y: 0, heading: 0 }, R)!;
    expect(back).toEqual([{ kind: 'S', length: expect.closeTo(m(6), 6), gear: -1 }]);
  });

  const pose = fc.record({ x: fc.integer({ min: -300_000, max: 300_000 }), y: fc.integer({ min: -300_000, max: 300_000 }), heading: fc.double({ min: 0, max: Math.PI * 2, noNaN: true }) });

  it('driving the path, forward or in reverse, ends exactly at the goal pose; never shorter than the straight line', () => {
    fc.assert(
      fc.property(pose, pose, fc.integer({ min: 20_000, max: 120_000 }), fc.boolean(), (a: Pose, b: Pose, r, reverse) => {
        const path = (reverse ? dubinsReverse : dubins)(a, b, r);
        expect(path).toBeDefined();
        const samples = samplePath(a, path!, r, 2_500);
        const end = samples.at(-1)!;
        expect(Math.hypot(end.x - b.x, end.y - b.y)).toBeLessThan(1e-3 * r);
        expect(angleGap(end.heading, b.heading)).toBeLessThan(1e-6);
        expect(pathLength(path!)).toBeGreaterThanOrEqual(Math.hypot(b.x - a.x, b.y - a.y) - 1e-6);
        expect(samples.every((p) => p.gear === (reverse ? -1 : 1))).toBe(true);
        // Consecutive samples are never further apart than the step.
        for (let i = 1; i < samples.length; i++) expect(Math.hypot(samples[i]!.x - samples[i - 1]!.x, samples[i]!.y - samples[i - 1]!.y)).toBeLessThanOrEqual(2_500 + 1e-6);
      }),
      { numRuns: 300 },
    );
  });

  it('by hand: east at the origin to north at (10, 10) m with r = 5 m is left 45°, 5√2 m straight, left 45°', () => {
    // Straight 5 m, a quarter circle, straight 5 m would be 17.85 m. Shorter: the left circles are
    // centred at (0, 5) and (5, 10); the straight joins them along 45°, |c2 − c1| = 5√2 ≈ 7.07 m,
    // and each arc turns 45° (π/4 × 5 m ≈ 3.93 m): 14.925 m in all.
    const path = dubins({ x: 0, y: 0, heading: 0 }, { x: m(10), y: m(10), heading: Math.PI / 2 }, R)!;
    expect(path.map((s) => s.kind)).toEqual(['L', 'S', 'L']);
    expect(pathLength(path) / 10_000).toBeCloseTo((5 * Math.PI) / 2 + 5 * Math.SQRT2, 6);
  });
});
