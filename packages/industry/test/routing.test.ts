import { describe, expect, it } from 'vitest';
import { createProject, createSpace, rectangleBoundary, type Project } from '@space-planner/core';
import { findRoute, floorRaster } from '../src/index.js';

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
