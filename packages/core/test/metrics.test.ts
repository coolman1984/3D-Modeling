import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { apply, measureProject, toSquareMetres, type Project } from '../src/index.js';
import { chair, cm, furnishedHall, m, place, referenceHall, table } from './fixtures.js';

function add(project: Project, ...items: ReturnType<typeof place>[]): Project {
  const outcome = apply(project, { type: 'batch', commands: items.map((item) => ({ type: 'item.add' as const, item })) });
  if (!outcome.ok) throw new Error(outcome.rejection.message);
  return outcome.project;
}

describe('measureProject', () => {
  it('measures an empty hall', () => {
    const metrics = measureProject(referenceHall());
    // 10 m × 8 m minus a 40 cm × 40 cm column.
    expect(toSquareMetres(metrics.floorArea)).toBeCloseTo(80 - 0.16, 10);
    expect(metrics).toMatchObject({ itemCount: 0, seats: 0, occupiedArea: 0, overlapArea: 0, occupancy: 0, bom: [] });
  });

  it('matches a hand calculation for the furnished hall', () => {
    const metrics = measureProject(furnishedHall());
    const expectedOccupied = cm(180) * cm(80) + 4 * cm(45) * cm(45); // 1.44 m² + 0.81 m²
    expect(metrics.itemCount).toBe(5);
    expect(metrics.seats).toBe(4);
    expect(metrics.occupiedArea).toBeCloseTo(expectedOccupied, 6);
    expect(toSquareMetres(metrics.occupiedArea)).toBeCloseTo(2.25, 10);
    expect(metrics.occupancy).toBeCloseTo(2.25 / 79.84, 10);
    expect(metrics.bom).toEqual([
      { definitionId: 'def-chair', name: chair.name, category: 'seat', size: chair.size, count: 4, seats: 4 },
      { definitionId: 'def-table', name: table.name, category: 'table', size: table.size, count: 1, seats: 0 },
    ]);
  });

  it('counts overlapping floor once', () => {
    const hall = add(furnishedHall(), place('t2', 'def-table', m(3.5), m(6)));
    const metrics = measureProject(hall);
    const overlap = cm(130) * cm(80);
    expect(metrics.overlapArea).toBeCloseTo(overlap, 6);
    expect(metrics.occupiedArea).toBeCloseTo(2 * cm(180) * cm(80) + 4 * cm(45) * cm(45) - overlap, 6);
  });

  it('does not change when items rotate in place by right angles', () => {
    fc.assert(
      fc.property(fc.constantFrom(0, 90_000, 180_000, 270_000), (rotation) => {
        const hall = add(furnishedHall(), place('x', 'def-table', m(7), m(4), rotation));
        const before = measureProject(furnishedHall()).occupiedArea;
        expect(measureProject(hall).occupiedArea).toBe(before + cm(180) * cm(80));
      }),
    );
  });
});
