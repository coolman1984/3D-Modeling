import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { aabbsWithin, checkProject, gridIndex, type Aabb, type ItemInstance, type Project } from '../src/index.js';
import { chair, cm, m, referenceHall, table } from './fixtures.js';
import { palletFloor } from './industrial.js';

const box = fc
  .record({ x: fc.integer({ min: -50_000, max: 50_000 }), y: fc.integer({ min: -50_000, max: 50_000 }), w: fc.integer({ min: 0, max: 30_000 }), h: fc.integer({ min: 0, max: 30_000 }) })
  .map(({ x, y, w, h }): Aabb => ({ minX: x, minY: y, maxX: x + w, maxY: y + h }));

describe('grid spatial index', () => {
  it('returns exactly the boxes a full scan finds, in ascending order', () => {
    fc.assert(
      fc.property(fc.array(box, { maxLength: 60 }), box, fc.integer({ min: 0, max: 5_000 }), fc.option(fc.integer({ min: 1, max: 40_000 }), { nil: undefined }), (boxes, q, margin, cell) => {
        const expected = boxes.map((b, i) => (aabbsWithin(q, b, margin) ? i : -1)).filter((i) => i >= 0);
        expect(gridIndex(boxes, cell).query(q, margin)).toEqual(expected);
      }),
    );
  });

  it('keeps very large boxes findable from anywhere they cover', () => {
    const boxes: Aabb[] = [
      { minX: 0, minY: 0, maxX: 10, maxY: 10 },
      { minX: -1_000_000, minY: -1_000_000, maxX: 1_000_000, maxY: 1_000_000 },
    ];
    expect(gridIndex(boxes).query({ minX: 500_000, minY: 500_000, maxX: 500_001, maxY: 500_001 })).toEqual([1]);
  });
});

describe('checks with the spatial index', () => {
  const room = referenceHall();
  const item = fc
    .record({
      def: fc.constantFrom(table.id, chair.id),
      x: fc.integer({ min: 0, max: m(10) }),
      y: fc.integer({ min: 0, max: m(8) }),
      rotation: fc.integer({ min: 0, max: 359 }).map((d) => d * 1000),
      elevation: fc.option(fc.integer({ min: 1, max: cm(120) }), { nil: undefined }),
    });
  it('finds exactly the issues the all-pairs check finds', () => {
    fc.assert(
      fc.property(fc.array(item, { maxLength: 40 }), (specs) => {
        const items: Record<string, ItemInstance> = {};
        specs.forEach((s, i) => {
          const id = `i-${String(i).padStart(3, '0')}`;
          items[id] = { id, definitionId: s.def, position: { x: s.x, y: s.y }, rotation: s.rotation, locked: false, ...(s.elevation ? { elevation: s.elevation } : {}) };
        });
        const project: Project = { ...room, catalog: { [table.id]: table, [chair.id]: chair }, items };
        expect(checkProject(project)).toEqual(checkProject(project, { spatialIndex: false }));
      }),
      { numRuns: 150 },
    );
  });

  it('agrees on a 2 000-pallet warehouse with nudged pallets', () => {
    const project = palletFloor(2_000);
    const fast = checkProject(project);
    expect(fast).toEqual(checkProject(project, { spatialIndex: false }));
    // Pallets 0, 37, 74 … 1998 (55 of them) are nudged 30 cm east into a 5 cm gap: 25 cm of overlap
    // with the east neighbour, except pallet 999, the last of its row of 50, which has none → 54.
    const overlaps = fast.filter((i) => i.code === 'overlap');
    expect(overlaps).toHaveLength(54);
    expect(overlaps.every((i) => i.amount === cm(25))).toBe(true);
  });
});
