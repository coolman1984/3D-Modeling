import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  area,
  measureProject,
  checkProject,
  clipConvex,
  hasErrors,
  polygonsOverlap,
  validateProject,
  vec,
  type Issue,
  type ItemDefinition,
  type ItemInstance,
  type Project,
} from '../src/index.js';
import { cm, furnishedHall, m, place, referenceHall, table } from './fixtures.js';

const cabinet: ItemDefinition = {
  id: 'def-cabinet',
  name: 'Tall cabinet',
  category: 'storage',
  size: { w: m(1), d: cm(50), h: m(3.2) },
  clearance: { front: 0, back: 0, left: 0, right: 0 },
};

function withItems(project: Project, ...items: ItemInstance[]): Project {
  const next = {
    ...project,
    catalog: { ...project.catalog, [cabinet.id]: cabinet },
    items: { ...project.items, ...Object.fromEntries(items.map((i) => [i.id, i])) },
  };
  expect(validateProject(next)).toEqual([]);
  return next;
}

function summary(issues: Issue[]): string[] {
  return issues.map((i) => `${i.code} ${i.entityIds.join('+')}${i.amount === undefined ? '' : ` ${i.amount}`}`);
}

describe('geometry helpers for checks', () => {
  it('clips two convex shapes to their overlap', () => {
    const a = [vec(0, 0), vec(100, 0), vec(100, 100), vec(0, 100)];
    const b = [vec(50, 50), vec(150, 50), vec(150, 150), vec(50, 150)];
    expect(area(clipConvex(a, b))).toBe(2500);
    expect(clipConvex(a, [vec(200, 0), vec(300, 0), vec(300, 100)])).toEqual([]);
  });

  it('detects overlap with concave shapes', () => {
    const l = [vec(0, 0), vec(100, 0), vec(100, 40), vec(40, 40), vec(40, 100), vec(0, 100)];
    expect(polygonsOverlap(l, [vec(60, 60), vec(90, 60), vec(90, 90), vec(60, 90)])).toBe(false); // in the notch
    expect(polygonsOverlap(l, [vec(20, 20), vec(60, 20), vec(60, 60), vec(20, 60)])).toBe(true);
    expect(polygonsOverlap(l, [vec(100, 0), vec(150, 0), vec(150, 40), vec(100, 40)])).toBe(false); // touching
  });
});

describe('checkProject on the reference hall', () => {
  it('finds nothing in a well-furnished hall', () => {
    expect(checkProject(referenceHall())).toEqual([]);
    expect(checkProject(furnishedHall())).toEqual([]);
  });

  it('reports overlapping tables with the depth to separate them', () => {
    const issues = checkProject(withItems(furnishedHall(), place('t2', 'def-table', m(3.5), m(6))));
    expect(summary(issues)).toEqual([`overlap t1+t2 ${cm(80)}`]);
    expect(area(issues[0]!.evidence!)).toBeCloseTo(cm(130) * cm(80));
  });

  it('reports a chair in the door swing', () => {
    const issues = checkProject(withItems(furnishedHall(), place('c9', 'def-chair', m(1.3), m(0.4), 180_000)));
    expect(issues.map((i) => i.code)).toEqual(['door-blocked']);
    expect(issues[0]!.entityIds).toEqual(['c9', 'door-1']);
    expect(issues[0]!.amount).toBeGreaterThan(0);
  });

  it('does not report a chair just outside the door swing', () => {
    // Nearest corner (1.9 m, 0.9 m) is 1.27 m from the hinge, beyond the 90 cm leaf.
    expect(checkProject(withItems(furnishedHall(), place('c9', 'def-chair', m(2.125), m(1.125), 180_000)))).toEqual([]);
  });

  it('reports a chair on the column with the exact depth', () => {
    const issues = checkProject(withItems(furnishedHall(), place('c9', 'def-chair', m(5), m(3.7))));
    expect(summary(issues)).toEqual([`on-obstacle c9+col-1 ${cm(12.5)}`]);
  });

  it('reports an item through the wall', () => {
    const issues = checkProject(withItems(furnishedHall(), place('c9', 'def-chair', m(9.9), m(4), 90_000)));
    expect(summary(issues)).toEqual(['out-of-bounds c9']);
    expect(hasErrors(issues)).toBe(true);
  });

  it('warns when a chair cannot be pulled back because of the wall', () => {
    const issues = checkProject(withItems(furnishedHall(), place('c9', 'def-chair', m(5), m(7.7), 180_000)));
    expect(summary(issues)).toEqual(['clearance c9']);
    expect(issues[0]!.severity).toBe('warning');
    expect(hasErrors(issues)).toBe(false);
  });

  it('warns with the missing distance when a table blocks a chair', () => {
    const issues = checkProject(
      withItems(furnishedHall(), place('t3', 'def-table', m(6.5), m(1.2)), place('c9', 'def-chair', m(6.5), m(2))),
    );
    expect(summary(issues)).toEqual([`clearance c9+t3 ${cm(22.5)}`]);
  });

  it('reports an item taller than the ceiling', () => {
    const issues = checkProject(withItems(furnishedHall(), place('k1', 'def-cabinet', m(8), m(4))));
    expect(summary(issues)).toEqual([`too-tall k1 ${cm(20)}`]);
  });

  it('says heights are unknown when the ceiling is missing', () => {
    const hall = furnishedHall();
    const { ceilingHeight: _c, ...space } = hall.space;
    const issues = checkProject(withItems({ ...hall, space }, place('k1', 'def-cabinet', m(8), m(4))));
    expect(summary(issues)).toEqual(['height-unknown ']);
    expect(issues[0]!.severity).toBe('info');
  });

  it('lists several issues in a stable order', () => {
    const issues = checkProject(
      withItems(
        furnishedHall(),
        place('t2', 'def-table', m(3.5), m(6)),
        place('c9', 'def-chair', m(5), m(3.7)),
        place('k1', 'def-cabinet', m(9.9), m(4)),
      ),
    );
    expect(issues.map((i) => i.code)).toEqual(['out-of-bounds', 'overlap', 'on-obstacle', 'too-tall']);
  });
});

describe('checkProject properties', () => {
  const coord = fc.integer({ min: 0, max: m(10) });
  const item = fc.record({
    def: fc.constantFrom('def-chair', 'def-table'),
    x: coord,
    y: coord,
    r: fc.integer({ min: 0, max: 359_999 }),
  });

  it('does not depend on the order items were added', () => {
    fc.assert(
      fc.property(fc.array(item, { maxLength: 12 }), (specs) => {
        const items = specs.map((s, i) => place(`n${i}`, s.def, s.x, s.y, s.r));
        const forward = checkProject(withItems(furnishedHall(), ...items));
        const backward = checkProject(withItems(furnishedHall(), ...[...items].reverse()));
        expect(backward).toEqual(forward);
      }),
      { numRuns: 50 },
    );
  });

  it('never reports overlap between two tables placed side by side with a gap', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 5000 }), (gap) => {
        const second = place('t2', table.id, m(3) + cm(180) + gap, m(6));
        const codes = checkProject(withItems(furnishedHall(), second)).map((i) => i.code);
        expect(codes).not.toContain('overlap');
      }),
    );
  });
});

describe('round items', () => {
  const round: ItemDefinition = {
    id: 'def-round',
    name: 'Round table 150',
    category: 'round-table',
    size: { w: cm(150), d: cm(150), h: cm(75) },
    clearance: { front: 0, back: 0, left: 0, right: 0 },
    footprint: 'round',
  };

  function hallWith(...items: ItemInstance[]): Project {
    const hall = furnishedHall();
    return { ...hall, catalog: { ...hall.catalog, [round.id]: round }, items: Object.fromEntries(items.map((i) => [i.id, i])) };
  }

  it('lets eight chairs sit around a round table without false alarms', () => {
    const items = [place('r1', round.id, m(5), m(6))];
    for (let k = 0; k < 8; k++) {
      const a = (k * Math.PI) / 4;
      items.push(place(`c${k}`, 'def-chair', Math.round(m(5) + m(1.05) * Math.cos(a)), Math.round(m(6) + m(1.05) * Math.sin(a)), Math.round(((a * 180) / Math.PI + 90) * 1000) % 360_000));
    }
    const project = hallWith(...items);
    expect(validateProject(project)).toEqual([]);
    expect(checkProject(project)).toEqual([]);
  });

  it('still catches a chair that really touches the round edge', () => {
    // Chair centre 0.9 m from the table centre on the diagonal: its corner reaches inside the 0.75 m radius.
    const d = Math.round(m(0.9) / Math.SQRT2);
    const issues = checkProject(hallWith(place('r1', round.id, m(5), m(6)), place('c1', 'def-chair', m(5) + d, m(6) + d, 135_000)));
    expect(issues.map((i) => i.code)).toContain('overlap');
  });

  it('measures a round footprint close to the true circle and never smaller', () => {
    const area = measureProject(hallWith(place('r1', round.id, m(5), m(6)))).occupiedArea;
    const circle = Math.PI * cm(75) * cm(75);
    expect(area).toBeGreaterThanOrEqual(circle);
    expect(area).toBeLessThan(circle * 1.01);
  });

  it('rejects an unknown footprint', () => {
    const bad = { ...hallWith(), catalog: { [round.id]: { ...round, footprint: 'hexagon' } } };
    expect(validateProject(bad).map((p) => p.path)).toEqual([`catalog.${round.id}.footprint`]);
  });
});
