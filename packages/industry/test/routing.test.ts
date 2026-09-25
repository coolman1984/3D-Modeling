import { describe, expect, it } from 'vitest';
import { createProject, createSpace, rectangleBoundary, type Project } from '@space-planner/core';
import { distanceAt, findRoute, floorRaster, reachabilityFrom } from '../src/index.js';

const rect = (x0: number, y0: number, x1: number, y1: number) => [
  { x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 },
];
const space = (w: number, h: number, obstacles: ReturnType<typeof rect>[] = []): Project => createProject('test', 'routing reference', createSpace(rectangleBoundary(w, h), {
  obstacles: obstacles.map((polygon, i) => ({ id: `block-${i}`, kind: 'column' as const, polygon })),
}));
const mover = { name: 'reference mover', effectiveWidth: 100 };

describe('sampled shortest route', () => {
  it('measures a straight 2 m corridor by hand', () => {
    const route = findRoute(floorRaster(space(3000, 1000), 1000), { x: 500, y: 500 }, { x: 2500, y: 500 }, mover);
    expect(route).toMatchObject({ reachable: true, distance: 2000 });
    expect(route.points).toEqual([{ x: 500, y: 500 }, { x: 1500, y: 500 }, { x: 2500, y: 500 }]);
  });

  it('goes round a 2 m deep wall without cutting its corner', () => {
    const grid = floorRaster(space(3000, 5000, [rect(1000, 0, 2000, 2000)]), 1000);
    const route = findRoute(grid, { x: 500, y: 500 }, { x: 2500, y: 500 }, mover);
    expect(route.reachable).toBe(true);
    // The tempting diagonal clips the wall cell, so the legal six-step detour is 6 m.
    if (route.reachable) expect(route.distance).toBe(6000);
  });

  it('rejects a diagonal between two blocked adjacent cells', () => {
    const grid = floorRaster(space(2000, 2000, [rect(1000, 0, 2000, 1000), rect(0, 1000, 1000, 2000)]), 1000);
    expect(findRoute(grid, { x: 500, y: 500 }, { x: 1500, y: 1500 }, mover)).toMatchObject({ reachable: false, reason: 'no-path' });
  });

  it('refuses a mover wider than the remaining clear floor and is repeatable', () => {
    const grid = floorRaster(space(4000, 1000), 1000);
    const from = { x: 500, y: 500 };
    const to = { x: 3500, y: 500 };
    const narrow = findRoute(grid, from, to, mover);
    expect(findRoute(grid, from, to, mover)).toEqual(narrow);
    expect(findRoute(grid, from, to, { name: 'wide', effectiveWidth: 1200 })).toMatchObject({ reachable: false, reason: 'blocked-start' });
  });
});

describe('reachability flood (many destinations from one search)', () => {
  it('measures a straight 2 m corridor by hand, agreeing with findRoute', () => {
    const grid = floorRaster(space(3000, 1000), 1000);
    const from = { x: 500, y: 500 };
    const to = { x: 2500, y: 500 };
    const distances = reachabilityFrom(grid, from, mover);
    expect(distances).toBeDefined();
    expect(distanceAt(grid, distances!, to)).toBe(2000);
    expect(distanceAt(grid, distances!, to)).toBe((findRoute(grid, from, to, mover) as { distance: number }).distance);
  });

  it('goes round a 2 m deep wall, matching findRoute\'s six-step detour', () => {
    const grid = floorRaster(space(3000, 5000, [rect(1000, 0, 2000, 2000)]), 1000);
    const from = { x: 500, y: 500 };
    const to = { x: 2500, y: 500 };
    const distances = reachabilityFrom(grid, from, mover)!;
    expect(distanceAt(grid, distances, to)).toBe(6000);
  });

  it('reports a cell across an impassable gap as unreached, not zero or infinite', () => {
    const grid = floorRaster(space(2000, 2000, [rect(1000, 0, 2000, 1000), rect(0, 1000, 1000, 2000)]), 1000);
    const distances = reachabilityFrom(grid, { x: 500, y: 500 }, mover)!;
    expect(distanceAt(grid, distances, { x: 1500, y: 1500 })).toBeUndefined();
  });

  it('returns undefined from a blocked or out-of-range start, and undefined for an out-of-range query point', () => {
    const grid = floorRaster(space(4000, 1000), 1000);
    expect(reachabilityFrom(grid, { x: 500, y: 500 }, { name: 'wide', effectiveWidth: 1200 })).toBeUndefined();
    const distances = reachabilityFrom(grid, { x: 500, y: 500 }, mover)!;
    expect(distanceAt(grid, distances, { x: 500, y: 500 })).toBe(0);
    expect(distanceAt(grid, distances, { x: -9000, y: -9000 })).toBeUndefined();
  });

  it('agrees with findRoute at every reachable cell of a room with an obstacle (property check by exhaustion)', () => {
    const grid = floorRaster(space(4000, 3000, [rect(1500, 500, 2500, 1500)]), 500);
    const from = { x: 250, y: 250 };
    const distances = reachabilityFrom(grid, from, mover)!;
    for (let j = 0; j < grid.ny; j++) {
      for (let i = 0; i < grid.nx; i++) {
        const to = grid.point(i, j);
        const direct = findRoute(grid, from, to, mover);
        const flood = distanceAt(grid, distances, to);
        if (direct.reachable) expect(flood).toBe(direct.distance);
        else expect(flood).toBeUndefined();
      }
    }
  });
});
