import { apply, checkProject, fromUnit, validateProject, type Command, type Project } from '@space-planner/core';
import { describe, expect, it } from 'vitest';
import { checkRestaurant, detectPack, newRestaurant, packOf, restaurantLayouts, restaurantMetrics, serviceDistances } from '../src/index.js';

const m = (v: number) => fromUnit(v, 'm');

function run(project: Project, commands: readonly Command[]): Project {
  const r = apply(project, { type: 'batch', commands });
  if (!r.ok) throw new Error(JSON.stringify(r.rejection));
  return r.project;
}
const table = (id: string, x: number, y: number, family = 'table-4'): Command => ({ type: 'item.add', item: { id, definitionId: family, position: { x: m(x), y: m(y) }, rotation: 0, locked: false } });

/** 20 × 14 m, 3.2 m high. Entrance door x 9.1–10.9 m on the south wall; pass centred at (10, 13.7) facing south; dining zone x 1–19, y 1–11 (180 m²). */
const room = () => newRestaurant('R');

describe('restaurant pack', () => {
  it('starts with an entrance, a locked pass and a dining zone; nothing to judge yet', () => {
    const p = room();
    expect(detectPack(p)).toBe('restaurant');
    expect(validateProject({ ...p, id: 'p-1' })).toEqual([]);
    expect(p.items['pass-1']).toMatchObject({ locked: true, rotation: 180_000 });
    // No guests yet: every rule is unknown, never a pass.
    expect(checkRestaurant(p, 'casual').map((r) => `${r.code}:${r.status}`)).toEqual(['walkway:unknown', 'service-route:unknown', 'floor-per-cover:unknown', 'exits:unknown', 'door-width:unknown']);
  });

  it('measures the walk from the pass by hand: 2.2 m to a 4-top straight in front of it', () => {
    // Pass front at y = 13.4 m; servers start within 0.45 + 0.05 m of it (cell centres to 12.925 m).
    // Table body y 8.2–9.8 m; a server reaches it from 0.45 + 0.5 = 0.95 m away (cell centre 10.725 m).
    const p = run(room(), [table('t1', 10, 9)]);
    expect(serviceDistances(p, 'casual').get('t1')! / 10_000).toBeCloseTo(2.2, 1);
    expect(checkRestaurant(p, 'casual')[1]).toMatchObject({ code: 'service-route', status: 'pass', measured: 1 });
  });

  it('a table boxed in by bar counters cannot be served; guests there have no way out either', () => {
    // t2 at (4, 6): counters along its four sides, touching nothing else.
    const bar = (id: string, x: number, y: number, rotation: number): Command => ({ type: 'item.add', item: { id, definitionId: 'bar-counter', position: { x: m(x), y: m(y) }, rotation, locked: false } });
    const p = run(room(), [table('t1', 10, 9), table('t2', 4, 6), bar('b-s', 4, 4.2, 0), bar('b-n', 4, 7.8, 0), bar('b-w', 1.95, 6, 90_000), bar('b-e', 6.05, 6, 90_000)]);
    const rules = checkRestaurant(p, 'casual');
    expect(rules[1]).toMatchObject({ code: 'service-route', status: 'fail', entityIds: ['t2'] });
    expect(rules[0]).toMatchObject({ code: 'walkway', status: 'fail', entityIds: ['t2'] });
    expect(restaurantMetrics(p, 'casual')).toMatchObject({ covers: 8, tables: 2, unreachable: 1, coversByZone: { dining: 8 } });
  });

  it('proposes three layouts of 4-tops by hand: 23, 20 and 12 tables', () => {
    // 4-top with its chair clearance: 1.2 × 2.2 m. Most covers, 0.9 m aisles: pitch 2.1 × 3.1 m;
    // 8 columns fit x 1–19, 3 rows fit y 1–11; the door swing (radius 1.8 m from x = 9.1) takes one
    // table in the first row: 23. Balanced, 1.215 m aisles: 7 × 3 less one = 20. Spacious, 1.62 m:
    // 6 × 2 = 12, clear of the door.
    const p = room();
    const [most, balanced, spacious] = restaurantLayouts.propose(p, {});
    expect([most!.metrics.tables, balanced!.metrics.tables, spacious!.metrics.tables]).toEqual([23, 20, 12]);
    expect([most!.metrics.covers, balanced!.metrics.covers, spacious!.metrics.covers]).toEqual([92, 80, 48]);
    // Proposals change nothing; applied, they give a plan with no issues that every server reaches.
    expect(Object.keys(p.items)).toEqual(['pass-1']);
    const applied = run(p, most!.commands);
    expect(checkProject(applied)).toEqual([]);
    // 92 covers need two exits (over 49 people); the room has one entrance: the rule says so.
    expect(checkRestaurant(applied, 'casual').map((r) => `${r.code}:${r.status}`)).toEqual(['walkway:pass', 'service-route:pass', 'floor-per-cover:pass', 'exits:fail', 'door-width:pass']);
    expect(checkRestaurant(applied, 'casual')[3]).toMatchObject({ measured: 1, required: 2 });
    // 180 m² / 92 covers = 1.96 m² per cover.
    expect(restaurantMetrics(applied, 'casual').floorPerCover).toBeCloseTo(180 / 92, 9);
    // Same project, same proposals.
    expect(restaurantLayouts.propose(p, {})).toEqual([most, balanced, spacious]);
  });

  it('counts floor per cover on the dining zones: a 12 m² zone for 92 covers fails', () => {
    const p = room();
    const full = run(p, restaurantLayouts.propose(p, {})[0]!.commands);
    const tiny = run(full, [{ type: 'space.set', space: { ...full.space, zones: [{ id: 'dining-1', kind: 'dining', name: 'Dining room', polygon: [{ x: m(1), y: m(1) }, { x: m(5), y: m(1) }, { x: m(5), y: m(4) }, { x: m(1), y: m(4) }] }] } }]);
    expect(checkRestaurant(tiny, 'casual')[2]).toMatchObject({ code: 'floor-per-cover', status: 'fail', measured: 0.13, required: 1.3 });
    expect(packOf('restaurant').figures(full)[0]).toMatchObject({ id: 'covers', value: 92 });
  });
});
