import { apply, createProject, fromUnit, roomSpace, validateProject, type Command, type ItemDefinition, type Project } from '@space-planner/core';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { checkHall, distanceToBlocked, exitsNeeded, seatsWithoutWayOut, STARTER_CATALOG } from '../src/index.js';

const m = (v: number) => fromUnit(v, 'm');
const cm = (v: number) => fromUnit(v, 'cm');
const none = { front: 0, back: 0, left: 0, right: 0 };

const block = (id: string, w: number, d = cm(40), h = m(1)): ItemDefinition => ({ id, name: id, category: 'box', size: { w, d, h }, clearance: none });
const chair = STARTER_CATALOG.find((d) => d.id === 'chair')!;

/** A 10 × 8 m hall with one 90 cm door on the south wall at x = 1 m, and the given types. */
function hall(definitions: ItemDefinition[], doors = 1): Project {
  const space = roomSpace({
    width: m(10),
    depth: m(8),
    ceilingHeight: m(3),
    doors: doors === 0 ? [] : [{ id: 'door-1', wall: 'south', offset: m(1), width: cm(90) }, ...(doors > 1 ? [{ id: 'door-2', wall: 'north' as const, offset: m(8), width: cm(90) }] : [])],
    columns: [],
  });
  return { ...createProject('h', 'hall', space), catalog: Object.fromEntries([chair, ...definitions].map((d) => [d.id, d])) };
}

function place(project: Project, id: string, definitionId: string, x: number, y: number, elevation = 0): Project {
  const command: Command = { type: 'item.add', item: { id, definitionId, position: { x, y }, rotation: 0, locked: false, ...(elevation ? { elevation } : {}) } };
  const result = apply(project, command);
  if (!result.ok) throw new Error(result.rejection.message);
  return result.project;
}

/**
 * A wall of furniture across the hall at y = 4 m with a gap of `gap` starting at x = 4.5 m,
 * and a chair behind it at (5, 6) m. The door is on the other side, so the gap is the only way.
 */
function splitHall(gap: number): Project {
  const left = block('left', m(4.5));
  const right = block('right', m(10) - m(4.5) - gap);
  let p = hall([left, right]);
  p = place(p, 'left-1', 'left', m(4.5) / 2, m(4));
  p = place(p, 'right-1', 'right', m(4.5) + gap + right.size.w / 2, m(4));
  return place(p, 'chair-1', 'chair', m(5), m(6));
}

describe('walkway from every seat to a door', () => {
  it('an open hall: the chair walks straight out', () => {
    expect(checkHall(place(hall([]), 'chair-1', 'chair', m(5), m(4)))[0]).toMatchObject({ code: 'walkway', status: 'pass', entityIds: [] });
  });

  it('a 1 m gap lets a 90 cm walkway through; an 85 cm gap does not', () => {
    // Sampling is 5 cm and errs on the safe side (by at most half a cell), so the gap must
    // be at least 90 + 5 = 95 cm wide to be sure; 1 m is, 85 cm is not.
    expect(seatsWithoutWayOut(splitHall(m(1)), cm(90), ['chair-1'])).toEqual([]);
    expect(seatsWithoutWayOut(splitHall(cm(85)), cm(90), ['chair-1'])).toEqual(['chair-1']);
    // Theatre style asks for 1 m: the 1 m gap is too tight for it once sampling is allowed for.
    expect(checkHall(splitHall(m(1)), 'theatre')[0]).toMatchObject({ status: 'fail', entityIds: ['chair-1'], required: m(1), measured: 0 });
  });

  it('a big seat (the 3 × 2 m kosha) is reached from its edge, not its centre', () => {
    const kosha = STARTER_CATALOG.find((d) => d.id === 'kosha')!;
    const p = place({ ...hall([]), catalog: { chair, kosha } }, 'kosha-1', 'kosha', m(5), m(4));
    expect(checkHall(p)[0]).toMatchObject({ status: 'pass', entityIds: [] });
  });

  it('a chair boxed in by furniture is named', () => {
    const wall = block('wall', m(2), cm(20));
    let p = hall([wall]);
    // A 2 × 2 m pen of four 2 m walls around (7, 5): the chair inside has no way out.
    p = place(p, 'n', 'wall', m(7), m(6));
    p = place(p, 's', 'wall', m(7), m(4));
    p = place(p, 'c-in', 'chair', m(7), m(5));
    p = place(p, 'c-out', 'chair', m(3), m(5));
    const turned = (id: string, x: number): Command => ({ type: 'item.add', item: { id, definitionId: 'wall', position: { x, y: m(5) }, rotation: 90_000, locked: false } });
    for (const [id, x] of [['w', m(6)], ['e', m(8)]] as const) {
      const r = apply(p, turned(id, x));
      if (!r.ok) throw new Error(r.rejection.message);
      p = r.project;
    }
    expect(checkHall(p)[0]).toMatchObject({ status: 'fail', entityIds: ['c-in'], measured: 1 });
  });

  it('furniture hung above head room does not block; lower furniture does', () => {
    const lamp = block('lamp', m(10), m(1), cm(30));
    const open = place(place(hall([lamp]), 'chair-1', 'chair', m(5), m(6)), 'lamp-1', 'lamp', m(5), m(4), m(2.2));
    expect(checkHall(open)[0]!.status).toBe('pass');
    const low = place(place(hall([lamp]), 'chair-1', 'chair', m(5), m(6)), 'lamp-1', 'lamp', m(5), m(4), m(1));
    expect(checkHall(low)[0]!.status).toBe('fail');
  });

  it('is "unknown", never "pass", without seats or without doors', () => {
    expect(checkHall(hall([]))[0]).toMatchObject({ status: 'unknown', reason: 'no-seats' });
    expect(checkHall(place(hall([], 0), 'chair-1', 'chair', m(5), m(4)))[0]).toMatchObject({ status: 'unknown', reason: 'no-doors' });
  });
});

describe('guest numbers', () => {
  // One "bench" type that seats 70, so the numbers are easy to follow.
  const bench: ItemDefinition = { ...block('bench', m(1)), seats: 70 };

  it('floor per guest: 80 m² for 70 guests is 1.14 m², short of banquet 1.2, fine for theatre 0.7', () => {
    const p = place(hall([bench]), 'bench-1', 'bench', m(5), m(4));
    expect(checkHall(p, 'banquet')[1]).toMatchObject({ code: 'area-per-guest', status: 'fail', measured: 1.14, required: 1.2 });
    expect(checkHall(p, 'theatre')[1]).toMatchObject({ status: 'pass', required: 0.7 });
  });

  it('exits: 70 guests need two doors; door width: 70 × 5 mm = 35 cm of door', () => {
    const one = place(hall([bench]), 'bench-1', 'bench', m(5), m(4));
    expect(checkHall(one)[2]).toMatchObject({ code: 'exits', status: 'fail', measured: 1, required: 2 });
    expect(checkHall(one)[3]).toMatchObject({ code: 'door-width', status: 'pass', measured: cm(90), required: cm(35) });
    const two = place(hall([bench], 2), 'bench-1', 'bench', m(5), m(4));
    expect(checkHall(two)[2]).toMatchObject({ status: 'pass', measured: 2 });
  });

  it('door width fails for 200 guests behind one 90 cm door (needs 1 m)', () => {
    const big: ItemDefinition = { ...bench, id: 'big', seats: 200 };
    expect(checkHall(place(hall([big]), 'big-1', 'big', m(5), m(4)))[3]).toMatchObject({ status: 'fail', measured: cm(90), required: m(1) });
  });

  it('exit counts follow the code thresholds', () => {
    expect([1, 49, 50, 500, 501, 1000, 1001].map(exitsNeeded)).toEqual([1, 1, 2, 2, 3, 3, 4]);
  });
});

describe('distance transform', () => {
  it('property: matches the brute-force nearest blocked cell on random grids', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 12 }), fc.integer({ min: 1, max: 12 }), fc.array(fc.boolean(), { minLength: 144, maxLength: 144 }), (nx, ny, bits) => {
        const blocked = new Uint8Array(nx * ny);
        for (let k = 0; k < nx * ny; k++) blocked[k] = bits[k] ? 1 : 0;
        if (!blocked.some((b) => b === 1)) blocked[0] = 1;
        const d = distanceToBlocked(blocked, nx, ny);
        for (let k = 0; k < nx * ny; k++) {
          let best = Infinity;
          for (let q = 0; q < nx * ny; q++) if (blocked[q]) best = Math.min(best, Math.hypot((k % nx) - (q % nx), Math.floor(k / nx) - Math.floor(q / nx)));
          expect(d[k]).toBeCloseTo(best, 9);
        }
      }),
      { numRuns: 150 },
    );
  });
});

describe('hall catalog', () => {
  it('has 20 to 30 valid items with unique ids, and keeps the ids saved projects use', () => {
    expect(STARTER_CATALOG.length).toBeGreaterThanOrEqual(20);
    expect(STARTER_CATALOG.length).toBeLessThanOrEqual(30);
    const ids = STARTER_CATALOG.map((d) => d.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const old of ['table-180', 'table-80', 'round-150', 'chair', 'buffet', 'stage', 'sofa', 'plant']) expect(ids).toContain(old);
    const p = { ...createProject('c', 'c', roomSpace({ width: m(5), depth: m(5), doors: [], columns: [] })), catalog: Object.fromEntries(STARTER_CATALOG.map((d) => [d.id, d])) };
    expect(validateProject(p)).toEqual([]);
  });
});
