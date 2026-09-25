import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { dubinsPath, sampleDubinsPath, vehicleCorners, type Pose } from '../src/dubins.js';

const HALF_PI = Math.PI / 2;

/** Forward-simulate a path from `start`: the strongest check for a curve algorithm — does the path the formulas describe actually arrive at the goal pose. */
function endOf(start: Pose, path: ReturnType<typeof dubinsPath>): Pose {
  const poses = sampleDubinsPath(start, path!, 1e9);
  return poses[poses.length - 1]!;
}

const closeTo = (a: number, b: number, eps: number) => expect(Math.abs(a - b)).toBeLessThan(eps);
const headingClose = (a: number, b: number, eps: number) => {
  const diff = Math.atan2(Math.sin(a - b), Math.cos(a - b));
  expect(Math.abs(diff)).toBeLessThan(eps);
};

describe('Dubins path', () => {
  it('is a single straight segment when the goal is dead ahead with matching heading (hand-computed: length = distance)', () => {
    const start: Pose = { x: 0, y: 0, heading: 0 };
    const goal: Pose = { x: 500, y: 0, heading: 0 };
    const path = dubinsPath(start, goal, 100)!;
    closeTo(path.length, 500, 1e-6);
    expect(path.segments.some((s) => s.kind === 'S' && Math.abs(s.length - 500) < 1e-6)).toBe(true);
  });

  it('is a pure quarter-circle turn from (0,0,0°) to (r,r,90°) at radius r (hand-computed: arc length = (π/2)·r)', () => {
    const r = 100;
    const start: Pose = { x: 0, y: 0, heading: 0 };
    const goal: Pose = { x: r, y: r, heading: HALF_PI };
    const path = dubinsPath(start, goal, r)!;
    closeTo(path.length, HALF_PI * r, 1e-6);
    const end = endOf(start, path);
    closeTo(end.x, goal.x, 1e-6);
    closeTo(end.y, goal.y, 1e-6);
    headingClose(end.heading, goal.heading, 1e-6);
  });

  it('never returns a path shorter than the straight-line distance (a Dubins path can only be as long or longer)', () => {
    fc.assert(
      fc.property(
        fc.double({ min: -1000, max: 1000, noNaN: true }),
        fc.double({ min: -1000, max: 1000, noNaN: true }),
        fc.double({ min: -Math.PI, max: Math.PI, noNaN: true }),
        fc.double({ min: -1000, max: 1000, noNaN: true }),
        fc.double({ min: -1000, max: 1000, noNaN: true }),
        fc.double({ min: -Math.PI, max: Math.PI, noNaN: true }),
        fc.double({ min: 5, max: 500, noNaN: true }),
        (x1, y1, h1, x2, y2, h2, radius) => {
          const start: Pose = { x: x1, y: y1, heading: h1 };
          const goal: Pose = { x: x2, y: y2, heading: h2 };
          const path = dubinsPath(start, goal, radius);
          if (!path) return;
          const straight = Math.hypot(x2 - x1, y2 - y1);
          expect(path.length).toBeGreaterThanOrEqual(straight - 1e-6);
        },
      ),
    );
  });

  it('always arrives at the requested goal pose (forward-simulated end matches goal within tolerance)', () => {
    fc.assert(
      fc.property(
        fc.double({ min: -1000, max: 1000, noNaN: true }),
        fc.double({ min: -1000, max: 1000, noNaN: true }),
        fc.double({ min: -Math.PI, max: Math.PI, noNaN: true }),
        fc.double({ min: -1000, max: 1000, noNaN: true }),
        fc.double({ min: -1000, max: 1000, noNaN: true }),
        fc.double({ min: -Math.PI, max: Math.PI, noNaN: true }),
        fc.double({ min: 5, max: 500, noNaN: true }),
        (x1, y1, h1, x2, y2, h2, radius) => {
          const start: Pose = { x: x1, y: y1, heading: h1 };
          const goal: Pose = { x: x2, y: y2, heading: h2 };
          const path = dubinsPath(start, goal, radius);
          if (!path) return;
          const end = endOf(start, path);
          closeTo(end.x, goal.x, 1e-4);
          closeTo(end.y, goal.y, 1e-4);
          headingClose(end.heading, goal.heading, 1e-4);
        },
      ),
    );
  });

  it('samples densely enough that consecutive poses never jump farther than the step', () => {
    const start: Pose = { x: 0, y: 0, heading: 0.3 };
    const goal: Pose = { x: 800, y: 600, heading: 2.1 };
    const path = dubinsPath(start, goal, 200)!;
    const poses = sampleDubinsPath(start, path, 50);
    for (let i = 1; i < poses.length; i++) {
      const step = Math.hypot(poses[i]!.x - poses[i - 1]!.x, poses[i]!.y - poses[i - 1]!.y);
      expect(step).toBeLessThanOrEqual(50 + 1e-6);
    }
  });
});

describe('vehicleCorners', () => {
  it('places the four corners of a 400×200 body at rest, hand-computed', () => {
    const pose: Pose = { x: 0, y: 0, heading: 0 };
    const [frontLeft, frontRight, rearRight, rearLeft] = vehicleCorners(pose, 300, 100, 100);
    expect(frontLeft).toEqual({ x: 300, y: 100 });
    expect(frontRight).toEqual({ x: 300, y: -100 });
    expect(rearRight).toEqual({ x: -100, y: -100 });
    expect(rearLeft).toEqual({ x: -100, y: 100 });
  });

  it('rotates with heading (hand-computed: 90° turn swaps forward and left axes)', () => {
    const pose: Pose = { x: 0, y: 0, heading: HALF_PI };
    const [frontLeft] = vehicleCorners(pose, 300, 100, 100);
    closeTo(frontLeft!.x, -100, 1e-9);
    closeTo(frontLeft!.y, 300, 1e-9);
  });
});
