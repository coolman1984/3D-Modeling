import { describe, expect, it } from 'vitest';
import {
  CoreError,
  area,
  assertValidProject,
  createSpace,
  itemClearancePolygon,
  itemPolygon,
  boundsOf,
  isCounterClockwise,
  validateProject,
  type Problem,
  type Project,
} from '../src/index.js';
import { chair, cm, furnishedHall, m, referenceHall, table } from './fixtures.js';

/** Deep-clone and edit a project as plain JSON, like a corrupted file would be. */
function corrupt(project: Project, edit: (raw: any) => void): unknown {
  const raw = structuredClone(project) as any;
  edit(raw);
  return raw;
}

function codes(problems: Problem[]): string[] {
  return problems.map((p) => `${p.code} @ ${p.path}`);
}

describe('factories', () => {
  it('builds a valid reference hall', () => {
    expect(validateProject(referenceHall())).toEqual([]);
    expect(validateProject(furnishedHall())).toEqual([]);
  });

  it('normalises clockwise input to counter-clockwise', () => {
    const space = createSpace([
      { x: 0, y: 0 },
      { x: 0, y: 100 },
      { x: 100, y: 100 },
      { x: 100, y: 0 },
    ]);
    expect(isCounterClockwise(space.boundary)).toBe(true);
  });
});

describe('derived shapes', () => {
  it('turns an item into its footprint and clearance zone', () => {
    const item = furnishedHall().items.t1!;
    expect(area(itemPolygon(item, table))).toBe(cm(180) * cm(80));
    expect(boundsOf(itemClearancePolygon(item, table))).toEqual({
      minX: m(2.1),
      minY: m(5),
      maxX: m(3.9),
      maxY: m(7),
    });
  });

  it('turns the clearance with a rotated chair', () => {
    const facingSouth = furnishedHall().items.c1!;
    // Back clearance of a chair facing south (180°) lies to the north.
    expect(boundsOf(itemClearancePolygon(facingSouth, chair)).maxY).toBeCloseTo(m(6.7) + cm(22.5) + cm(40));
  });
});

describe('validation', () => {
  it('rejects things that are not projects', () => {
    expect(codes(validateProject(null))).toEqual(['wrong-type @ project']);
    expect(codes(validateProject(undefined))).toEqual(['missing @ project']);
    expect(codes(validateProject([]))).toEqual(['wrong-type @ project']);
  });

  it('rejects an unknown schema version before anything else', () => {
    const raw = corrupt(referenceHall(), (p) => {
      p.schemaVersion = 2;
      p.name = 7;
    });
    expect(codes(validateProject(raw))).toEqual(['unsupported-version @ schemaVersion']);
  });

  it('rejects bad numbers with the exact path', () => {
    const raw = corrupt(furnishedHall(), (p) => {
      p.items.t1.position.x = 12.5;
      p.items.c1.rotation = 360_000;
      p.catalog['def-chair'].size.w = -10;
      p.space.ceilingHeight = 0;
      p.revision = -1;
    });
    expect(codes(validateProject(raw))).toEqual([
      'invalid-number @ revision',
      'invalid-number @ space.ceilingHeight',
      'invalid-number @ catalog.def-chair.size.w',
      'invalid-number @ items.t1.position.x',
      'invalid-number @ items.c1.rotation',
    ]);
  });

  it('rejects NaN, infinity and coordinates beyond 1 km', () => {
    const raw = corrupt(furnishedHall(), (p) => {
      p.items.t1.position.x = Number.NaN;
      p.items.c1.position.y = Number.POSITIVE_INFINITY;
      p.items.c2.position.x = m(1000) + 1;
    });
    expect(codes(validateProject(raw))).toEqual([
      'invalid-number @ items.t1.position.x',
      'invalid-number @ items.c1.position.y',
      'invalid-number @ items.c2.position.x',
    ]);
  });

  it('rejects broken polygons', () => {
    const bowTie = corrupt(referenceHall(), (p) => {
      p.space.boundary = [
        { x: 0, y: 0 },
        { x: 100, y: 100 },
        { x: 100, y: 0 },
        { x: 0, y: 100 },
      ];
      p.space.doors = [];
    });
    expect(codes(validateProject(bowTie))).toEqual(['invalid-polygon @ space.boundary']);

    const clockwise = corrupt(referenceHall(), (p) => p.space.obstacles[0].polygon.reverse());
    expect(codes(validateProject(clockwise))).toEqual(['not-counter-clockwise @ space.obstacles.0.polygon']);
  });

  it('rejects duplicate ids anywhere in the project', () => {
    const raw = corrupt(furnishedHall(), (p) => {
      p.space.obstacles[0].id = 'door-1';
      p.items.c1.id = 'c2';
    });
    expect(codes(validateProject(raw))).toEqual([
      'duplicate-id @ space.doors.0.id',
      'id-mismatch @ items.c1.id',
      'duplicate-id @ items.c2.id',
    ]);
  });

  it('rejects items that point at missing catalog entries', () => {
    const raw = corrupt(furnishedHall(), (p) => delete p.catalog['def-chair']);
    expect(codes(validateProject(raw))).toEqual([
      'broken-reference @ items.c1.definitionId',
      'broken-reference @ items.c2.definitionId',
      'broken-reference @ items.c3.definitionId',
      'broken-reference @ items.c4.definitionId',
    ]);
  });

  it('rejects a door that is not on a wall', () => {
    const raw = corrupt(referenceHall(), (p) => (p.space.doors[0].hinge = { x: m(1), y: m(1) }));
    expect(codes(validateProject(raw))).toEqual(['door-off-boundary @ space.doors.0.hinge']);
  });

  it('rejects wrong enum values and missing fields', () => {
    const raw = corrupt(furnishedHall(), (p) => {
      p.space.doors[0].swing = 'inward';
      p.space.obstacles[0].kind = 'pillar';
      delete p.items.t1.locked;
      delete p.catalog['def-table'].clearance;
    });
    expect(codes(validateProject(raw))).toEqual([
      'wrong-type @ space.obstacles.0.kind',
      'wrong-type @ space.doors.0.swing',
      'missing @ catalog.def-table.clearance',
      'wrong-type @ items.t1.locked',
    ]);
  });

  it('assertValidProject throws a CoreError with every problem listed', () => {
    const raw = corrupt(furnishedHall(), (p) => {
      p.items.t1.position.x = 0.5;
      p.items.c1.definitionId = 'nope';
    });
    expect(() => assertValidProject(raw)).toThrow(CoreError);
    expect(() => assertValidProject(raw)).toThrow(/2 problem\(s\).*items\.t1\.position\.x.*items\.c1\.definitionId/);
    expect(() => assertValidProject(furnishedHall())).not.toThrow();
  });
});
