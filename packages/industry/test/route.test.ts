import { fromUnit, rectangleBoundary, type Vec2 } from '@space-planner/core';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { cellAt, passHalfWidth, distanceToBlocked, floorGrid, paintPolygon, reachable, routeTo, travelField } from '../src/index.js';

const m = (v: number) => fromUnit(v, 'm');
const cm = (v: number) => fromUnit(v, 'cm');
const rect = (x0: number, y0: number, x1: number, y1: number): Vec2[] => [
  { x: m(x0), y: m(y0) },
  { x: m(x1), y: m(y0) },
  { x: m(x1), y: m(y1) },
  { x: m(x0), y: m(y1) },
];

/** A room with walls (blocked rectangles) on a 10 cm grid. */
function room(w: number, d: number, walls: Vec2[][] = []) {
  const grid = floorGrid(rectangleBoundary(m(w), m(d)), cm(10));
  for (const wall of walls) paintPolygon(grid, wall, 1);
  return { grid, clearance: distanceToBlocked(grid.blocked, grid.nx, grid.ny) };
}

describe('travel on a floor grid', () => {
  it('goes straight down a 10 × 2 m corridor: 7.9 m from x = 1.05 to x = 8.95', () => {
    // A 1.2 m forklift keeps its centre ≥ 0.6 m (plus half a cell) from the walls.
    const { grid, clearance } = room(10, 2);
    const start = cellAt(grid, { x: m(1.05), y: m(1) });
    const end = cellAt(grid, { x: m(8.95), y: m(1) });
    const field = travelField(grid, clearance, [start], cm(120));
    expect(field.distance[end]).toBeCloseTo(m(7.9), 6);
    // Too close to the end wall for it: a 0.55 m gap is less than half its width.
    expect(Number.isFinite(field.distance[cellAt(grid, { x: m(9.55), y: m(1) })]!)).toBe(false);
    expect(routeTo(grid, field, end)).toHaveLength(2); // a straight line: start and end only
  });

  it('crosses an open floor diagonally: 4 m × √2', () => {
    const { grid, clearance } = room(6, 6);
    const field = travelField(grid, clearance, [cellAt(grid, { x: m(1.05), y: m(1.05) })], cm(60));
    expect(field.distance[cellAt(grid, { x: m(5.05), y: m(5.05) })]).toBeCloseTo(m(4) * Math.SQRT2, 6);
  });

  it('a 1 m gap in a wall lets a 60 cm trolley through but not a 1.2 m forklift, which cannot reach the far side', () => {
    // Wall across a 10 × 6 m room at x = 5 m, 20 cm thick, with a gap from y = 2.5 to 3.5 m.
    const { grid, clearance } = room(10, 6, [rect(4.9, 0, 5.1, 2.5), rect(4.9, 3.5, 5.1, 6)]);
    const start = cellAt(grid, { x: m(1.05), y: m(3.05) });
    const far = cellAt(grid, { x: m(9.05), y: m(3.05) });
    const trolley = travelField(grid, clearance, [start], cm(60));
    expect(trolley.distance[far]).toBeCloseTo(m(8), 6);
    expect(Number.isFinite(travelField(grid, clearance, [start], cm(120)).distance[far]!)).toBe(false);
    expect(reachable(grid, clearance, [start], cm(120))[far]).toBe(0);
    expect(reachable(grid, clearance, [start], cm(60))[far]).toBe(1);
  });

  it('goes around a wall: the detour is longer than the straight line', () => {
    const { grid, clearance } = room(10, 6, [rect(4.9, 0, 5.1, 4.5)]);
    const start = cellAt(grid, { x: m(2.05), y: m(1.05) });
    const end = cellAt(grid, { x: m(8.05), y: m(1.05) });
    const field = travelField(grid, clearance, [start], cm(80));
    const d = field.distance[end]!;
    expect(d).toBeGreaterThan(m(6));
    // Up to y ≈ 5 m and back down: roughly 2 × 4 m + 6 m, never more than 15 m.
    expect(d).toBeLessThan(m(15));
    const route = routeTo(grid, field, end);
    expect(route[0]).toEqual({ x: m(2.05), y: m(1.05) });
    expect(route.at(-1)).toEqual({ x: m(8.05), y: m(1.05) });
  });

  it('is symmetric: from A to B equals from B to A (random walls)', () => {
    const box = fc.record({ x: fc.integer({ min: 1, max: 8 }), y: fc.integer({ min: 1, max: 5 }), w: fc.integer({ min: 1, max: 3 }), h: fc.integer({ min: 1, max: 3 }) });
    fc.assert(
      fc.property(fc.array(box, { maxLength: 5 }), (boxes) => {
        const { grid, clearance } = room(10, 7, boxes.map((b) => rect(b.x, b.y, b.x + b.w * 0.5, b.y + b.h * 0.5)));
        const a = cellAt(grid, { x: m(0.35), y: m(0.35) });
        const b = cellAt(grid, { x: m(9.65), y: m(6.65) });
        // A start may step out of a tight spot but nothing steps into one: compare fitting cells only.
        const half = passHalfWidth(cm(50), grid.cell);
        fc.pre(clearance[a]! >= half && clearance[b]! >= half);
        const ab = travelField(grid, clearance, [a], cm(50)).distance[b]!;
        const ba = travelField(grid, clearance, [b], cm(50)).distance[a]!;
        if (Number.isFinite(ab)) expect(ab).toBeCloseTo(ba, 6);
        else expect(Number.isFinite(ba)).toBe(false);
      }),
      { numRuns: 60 },
    );
  });
});
