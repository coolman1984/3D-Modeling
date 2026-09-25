import { describe, expect, it } from 'vitest';
import {
  apply,
  checkProject,
  deserializeProject,
  serializeProject,
  validateProject,
  type ItemDefinition,
  type Outcome,
  type Project,
} from '../src/index.js';
import { cm, furnishedHall, m, place } from './fixtures.js';

// A pendant lamp, 60 × 60 cm and 30 cm tall, hung over table t1 (top at 75 cm) in a 3 m hall.
const lamp: ItemDefinition = {
  id: 'def-lamp',
  name: 'Pendant lamp',
  category: 'light',
  size: { w: cm(60), d: cm(60), h: cm(30) },
  clearance: { front: 0, back: 0, left: 0, right: 0 },
};

function withLamp(elevation?: number): Project {
  const hall = furnishedHall();
  const item = { ...place('l1', lamp.id, m(3), m(6)), ...(elevation === undefined ? {} : { elevation }) };
  const next = { ...hall, catalog: { ...hall.catalog, [lamp.id]: lamp }, items: { ...hall.items, l1: item } };
  expect(validateProject(next)).toEqual([]);
  return next;
}

function ok(outcome: Outcome): Extract<Outcome, { ok: true }> {
  if (!outcome.ok) throw new Error(`${outcome.rejection.code}: ${outcome.rejection.message}`);
  return outcome;
}

const codes = (p: Project) => checkProject(p).map((i) => `${i.code} ${i.entityIds.join('+')}${i.amount === undefined ? '' : ` ${i.amount}`}`);

describe('items above the floor', () => {
  it('a lamp on the floor under the table overlaps it; hung above it does not', () => {
    // On the floor: the 60 cm square sits inside the 180 × 80 table. Depth is the shortest
    // overlap of the two outlines along a separating axis: along Y, the whole 60 cm of the lamp.
    expect(codes(withLamp())).toEqual([`overlap l1+t1 ${cm(60)}`]);
    expect(codes(withLamp(m(2)))).toEqual([]);
  });

  it('shares height with the table below 75 cm, and just touches at exactly 75 cm', () => {
    expect(codes(withLamp(cm(60)))).toEqual([`overlap l1+t1 ${cm(60)}`]);
    expect(codes(withLamp(cm(75)))).toEqual([]);
  });

  it("takes the table's walking space on the floor, not when hung above it", () => {
    // The table's end clearance runs from x = 3.9 m to 4.5 m; the lamp fills it exactly.
    const moved = (elevation: number) => ok(apply(withLamp(elevation || undefined), { type: 'item.move', id: 'l1', to: { x: m(4.2), y: m(6) } })).project;
    expect(codes(moved(0))).toEqual([`clearance t1+l1 ${cm(60)}`]);
    expect(codes(moved(m(2)))).toEqual([]);
  });

  it('counts the elevation in the ceiling check: 2.8 m + 30 cm is 10 cm above a 3 m ceiling', () => {
    expect(codes(withLamp(m(2.8)))).toEqual([`too-tall l1 ${cm(10)}`]);
    expect(codes(withLamp(m(2.7)))).toEqual([]);
  });

  it('raises, lowers and undoes; zero is stored as "on the floor"', () => {
    const start = withLamp();
    const raised = ok(apply(start, { type: 'item.elevate', id: 'l1', to: m(2) }));
    expect(raised.project.items.l1?.elevation).toBe(m(2));
    expect(raised.inverse).toEqual({ type: 'item.elevate', id: 'l1', to: 0 });
    const back = ok(apply(raised.project, raised.inverse));
    expect(back.project.items.l1).toEqual(start.items.l1);
    expect('elevation' in back.project.items.l1!).toBe(false);
  });

  it('rejects bad heights and locked items', () => {
    const start = withLamp();
    for (const to of [-1, 1.5, Number.NaN, 10_000_001]) {
      const outcome = apply(start, { type: 'item.elevate', id: 'l1', to });
      expect(outcome.ok ? 'ok' : outcome.rejection.code).toBe('invalid-payload');
    }
    const missing = apply(start, { type: 'item.elevate', id: 'nope', to: 1 });
    expect(missing.ok ? 'ok' : missing.rejection.code).toBe('not-found');
    const locked = ok(apply(start, { type: 'item.lock', id: 'l1', locked: true })).project;
    const refused = apply(locked, { type: 'item.elevate', id: 'l1', to: 1 });
    expect(refused.ok ? 'ok' : refused.rejection.code).toBe('locked');
  });

  it('saves and opens with the height; an explicit zero is not a valid save', () => {
    const raised = withLamp(m(2));
    const text = serializeProject(raised);
    const opened = deserializeProject(text);
    expect(opened.ok && opened.project.items.l1?.elevation).toBe(m(2));
    expect(opened.ok && serializeProject(opened.project)).toBe(text);
    const zero = { ...raised, items: { ...raised.items, l1: { ...raised.items.l1!, elevation: 0 } } };
    expect(validateProject(zero).map((p) => p.path)).toEqual(['items.l1.elevation']);
  });

  it('old saves without the field open unchanged', () => {
    const text = serializeProject(furnishedHall());
    expect(text).not.toContain('elevation');
    const opened = deserializeProject(text);
    expect(opened.ok && serializeProject(opened.project)).toBe(text);
  });
});
