import { fromUnit, rectangleBoundary, type Vec2 } from '@space-planner/core';
import { describe, expect, it } from 'vitest';
import { bodyFree, distanceToBlocked, floorGrid, paintPolygon, planManoeuvre, rearAxleRadius, type VehicleProfile } from '../src/index.js';

const m = (v: number) => fromUnit(v, 'm');
const rect = (x0: number, y0: number, x1: number, y1: number): Vec2[] => [
  { x: m(x0), y: m(y0) },
  { x: m(x1), y: m(y0) },
  { x: m(x1), y: m(y1) },
  { x: m(x0), y: m(y1) },
];
function floor(w: number, d: number, blocks: Vec2[][] = []) {
  const grid = floorGrid(rectangleBoundary(m(w), m(d)), fromUnit(10, 'cm'));
  for (const b of blocks) paintPolygon(grid, b, 1);
  return { grid, clearance: distanceToBlocked(grid.blocked, grid.nx, grid.ny) };
}
const vehicle = (id: string, length: number, width: number, wheelbase: number, front: number, circle: number, reverse = true): VehicleProfile => ({
  id,
  label: id,
  length: m(length),
  width: m(width),
  wheelbase: m(wheelbase),
  frontOverhang: m(front),
  rearOverhang: m(length - wheelbase - front),
  minRadius: rearAxleRadius(m(circle), m(wheelbase), m(width)),
  reverse,
});
const car = vehicle('car', 4.7, 1.8, 2.8, 0.95, 11);
const bus = vehicle('bus', 12, 2.55, 6.0, 2.6, 21);

describe('vehicle manoeuvres', () => {
  it('the body check keeps a small, known margin: a 1.8 m car fits a 2.0 m lane but not a 1.9 m one', () => {
    // Side discs of radius 0.9 + 0.03 = 0.93 m; on a 5 cm grid a disc needs 0.93/0.05 + 0.5 + 0.707
    // = 19.8 cells to the nearest blocked cell centre. The car's axis at y = 10 m is read at the
    // cell centre 10.025 m: a 2.0 m lane leaves 20 cells, a 1.9 m lane 19.
    const lane = (width: number) => {
      const grid = floorGrid(rectangleBoundary(m(20), m(20)), fromUnit(5, 'cm'));
      paintPolygon(grid, rect(0, 10 + width / 2, 20, 20), 1);
      paintPolygon(grid, rect(0, 0, 20, 10 - width / 2), 1);
      return bodyFree(car, { x: m(8), y: m(10), heading: 0 }, grid, distanceToBlocked(grid.blocked, grid.nx, grid.ny));
    };
    expect(lane(2.0)).toBe(true);
    expect(lane(1.9)).toBe(false);
  });

  it('drives 20 m straight ahead on an open floor: exactly 20 m, forward only', () => {
    const { grid, clearance } = floor(40, 30);
    const r = planManoeuvre(car, grid, clearance, { x: m(5), y: m(10), heading: 0 }, { x: m(25), y: m(10), heading: 0 });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.manoeuvre.length).toBeCloseTo(m(20), 3);
    expect(r.manoeuvre.gearChanges).toBe(0);
    expect(r.manoeuvre.poses.every((p) => bodyFree(car, p, grid, clearance))).toBe(true);
  });

  it('a 3 m gate lets a car through but not a 12 m bus; a body that does not fit at the start is refused', () => {
    // Wall across at x = 20 m with a gap from y = 13.5 to 16.5 m.
    const { grid, clearance } = floor(40, 30, [rect(19.8, 0, 20.2, 13.5), rect(19.8, 16.5, 20.2, 30)]);
    const through = planManoeuvre(car, grid, clearance, { x: m(5), y: m(15), heading: 0 }, { x: m(35), y: m(15), heading: 0 });
    expect(through.ok).toBe(true);
    const tooWide = planManoeuvre(bus, grid, clearance, { x: m(5), y: m(15), heading: 0 }, { x: m(32), y: m(15), heading: 0 }, { budget: 8_000 });
    expect(tooWide.ok).toBe(false);
    expect(planManoeuvre(car, grid, clearance, { x: m(20), y: m(5), heading: 0 }, { x: m(35), y: m(15), heading: 0 })).toEqual({ ok: false, reason: 'blocked-start' });
  });

  it('out of a 3 m dead-end corridor: only by reversing, with at least one change of gear', () => {
    // Corridor from x = 10 m to the east wall, y 8.5–11.5 m; open yard west of it.
    const { grid, clearance } = floor(30, 20, [rect(10, 0, 30, 8.5), rect(10, 11.5, 30, 20)]);
    const start = { x: m(24), y: m(10), heading: 0 }; // nose to the dead end
    const goal = { x: m(6), y: m(10), heading: Math.PI }; // out in the yard, facing west (nose 2.25 m off the wall)
    const forwardOnly = planManoeuvre({ ...car, reverse: false }, grid, clearance, start, goal, { budget: 20_000 });
    expect(forwardOnly.ok).toBe(false);
    const withReverse = planManoeuvre(car, grid, clearance, start, goal);
    expect(withReverse.ok).toBe(true);
    if (!withReverse.ok) return;
    expect(withReverse.manoeuvre.poses.some((p) => p.gear === -1)).toBe(true);
    expect(withReverse.manoeuvre.poses.every((p) => bodyFree(car, p, grid, clearance))).toBe(true);
    // It starts by backing out of the corridor: the first move is in reverse.
    expect(withReverse.manoeuvre.poses[1]!.gear).toBe(-1);
    // Same input, same answer.
    expect(planManoeuvre(car, grid, clearance, start, goal)).toEqual(withReverse);
  });

  it('the ends are not overstated: nose to a wall 15 cm away fits, touching it does not', () => {
    // Car facing east with its front bumper 15 cm (then 0 cm) short of a wall at x = 10 m.
    const grid = floorGrid(rectangleBoundary(m(20), m(10)), fromUnit(5, 'cm'));
    paintPolygon(grid, rect(10, 0, 20, 10), 1);
    const clearance = distanceToBlocked(grid.blocked, grid.nx, grid.ny);
    const front = car.wheelbase + car.frontOverhang;
    expect(bodyFree(car, { x: m(10 - 0.15) - front, y: m(5), heading: 0 }, grid, clearance)).toBe(true);
    expect(bodyFree(car, { x: m(10) - front, y: m(5), heading: 0 }, grid, clearance)).toBe(false);
  });
});
