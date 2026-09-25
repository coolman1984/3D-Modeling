import { apply, checkProject, deserializeProject, fromUnit, serializeProject, type Command, type Project } from '@space-planner/core';
import { readFileSync } from 'node:fs';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  aislesInFront,
  baysOf,
  checkPack,
  checkWarehouse,
  detectPack,
  newWarehouse,
  rackRows,
  rectZone,
  routeToBay,
  topBeam,
  rackOf,
  warehouseMetrics,
  WAREHOUSE_CATALOG,
  packOf,
} from '../src/index.js';

const m = (v: number) => fromUnit(v, 'm');
const cm = (v: number) => fromUnit(v, 'cm');

function run(project: Project, commands: readonly Command[]): Project {
  const r = apply(project, { type: 'batch', commands });
  if (!r.ok) throw new Error(JSON.stringify(r.rejection));
  return r.project;
}

function taken(p: Project): Set<string> {
  return new Set([p.id, ...Object.keys(p.catalog), ...Object.keys(p.items), ...(p.space.zones ?? []).map((z) => z.id), ...p.space.doors.map((d) => d.id), ...p.space.obstacles.map((o) => o.id)]);
}

/**
 * 30 × 20 m, 8 m to the ceiling; docks at x 2–6 and 7–11 m on the south wall (4 m deep), staging
 * behind them. Three rows of four 2.8 × 1.1 m bays from (5, 10) m:
 *   row 0 faces south, y 10.0–11.1   (front at 10.0, the south wall 10 m away)
 *   row 1 faces north, y 11.3–12.4   (20 cm flue behind; front at 12.4)
 *   row 2 faces south, y 15.4–16.5   (3.0 m aisle between the fronts of rows 1 and 2)
 */
function threeRows(definitionId = 'rack-bay'): Project {
  const p = newWarehouse('W', { width: m(30), depth: m(20), height: m(8) });
  const def = p.catalog[definitionId]!;
  return run(p, rackRows(def, { definitionId, origin: { x: m(5), y: m(10) }, bays: 4, rows: 3, aisle: m(3), flue: cm(20), firstFacing: 'south', taken: taken(p) }));
}

describe('warehouse pack', () => {
  it('starts with docks, staging and rack types, and is detected as a warehouse', () => {
    const p = newWarehouse('W', { width: m(30), depth: m(20), height: m(8) });
    expect(detectPack(p)).toBe('warehouse');
    expect(p.space.zones!.map((z) => `${z.kind}:${z.id}`)).toEqual(['dock:dock-1', 'dock:dock-2', 'staging:staging-1']);
    const bay = rackOf(p.catalog['rack-bay'])!;
    expect(bay).toEqual({ levels: 5, positions: 3, levelHeight: cm(150), positionLoad: 1_000_000 });
    expect(topBeam(bay)).toBe(cm(600));
    expect(p.catalog['rack-bay']!.size.h).toBe(cm(750));
    expect(checkProject(p)).toEqual([]);
    // The truck is project data: a reach truck unless changed.
    expect(p.space.meta).toEqual({ pack: 'warehouse', truck: 'reach' });
    const counter = run(p, [{ type: 'space.set', space: { ...p.space, meta: { pack: 'warehouse', truck: 'counterbalance' } } }]);
    expect(checkWarehouse(counter)[0]!.required).toBe(m(3.5));
  });

  it('lays rows back to back across a flue and face to face across an aisle', () => {
    const p = threeRows();
    const at = (id: string) => [p.items[id]!.position.x, p.items[id]!.position.y, p.items[id]!.rotation];
    expect(at('rack-bay-1')).toEqual([m(6.4), m(10.55), 180_000]);
    expect(at('rack-bay-4')).toEqual([m(14.8), m(10.55), 180_000]);
    expect(at('rack-bay-5')).toEqual([m(6.4), m(11.85), 0]);
    expect(at('rack-bay-9')).toEqual([m(6.4), m(15.95), 180_000]);
    expect(Object.keys(p.items)).toHaveLength(12);
    // Bays side by side touch but never overlap.
    expect(checkProject(p)).toEqual([]);
  });

  it('measures the aisle in front of each face: 10 m to the wall for row 0, 3 m between rows 1 and 2', () => {
    const p = threeRows();
    const gaps = aislesInFront(p, baysOf(p));
    expect(gaps.get('rack-bay-1')).toBe(m(10));
    expect(gaps.get('rack-bay-5')).toBe(m(3));
    expect(gaps.get('rack-bay-9')).toBe(m(3));
  });

  it('checks the rules against the truck: reach truck passes, counterbalance needs 3.5 m', () => {
    const p = threeRows();
    const reach = checkWarehouse(p, 'reach');
    expect(reach.map((r) => `${r.code}:${r.status}:${r.measured}/${r.required}`)).toEqual([
      `aisle-width:pass:${m(3)}/${m(2.9)}`,
      `lift-height:pass:${m(6)}/${m(10.5)}`,
      `ceiling-clearance:pass:${m(0.5)}/${cm(45)}`,
      'rack-access:pass:12/12',
      'docks:pass:2/1',
    ]);
    const counter = checkWarehouse(p, 'counterbalance');
    expect(counter[0]).toMatchObject({ code: 'aisle-width', status: 'fail', measured: m(3), required: m(3.5) });
    expect(counter[0]!.entityIds).toEqual(['rack-bay-10', 'rack-bay-11', 'rack-bay-12', 'rack-bay-5', 'rack-bay-6', 'rack-bay-7', 'rack-bay-8', 'rack-bay-9']);
    // 6.0 m top beam: exactly the counterbalance truck's lift.
    expect(counter[1]).toMatchObject({ status: 'pass', measured: m(6), required: m(6) });
    // Every rule names its source; none is presented as a verified regulation.
    for (const r of checkPack(p, 'warehouse')) expect(r.source?.kind).not.toBe('verified-regulation');
  });

  it('flags taller racks: lift height and ceiling clearance', () => {
    const p = threeRows('rack-bay-high'); // 7 levels × 1.5 m = 10.5 m; top beam 9.0 m
    const r = checkWarehouse(p, 'counterbalance');
    expect(r[1]).toMatchObject({ code: 'lift-height', status: 'fail', measured: m(9), required: m(6) });
    expect(r[1]!.entityIds).toHaveLength(12);
    expect(r[2]).toMatchObject({ code: 'ceiling-clearance', status: 'fail', measured: m(-2.5) });
  });

  it('closing both ends of the aisle cuts rows 1 and 2 off from the docks', () => {
    const p = threeRows();
    const zones = [...p.space.zones!, rectZone('ng-w', 'no-go', 'West', 0, m(12.4), m(5), m(3)), rectZone('ng-e', 'no-go', 'East', m(16.2), m(12.4), m(13.8), m(3))];
    const closed = run(p, [{ type: 'space.set', space: { ...p.space, zones } }]);
    const access = checkWarehouse(closed, 'reach')[3]!;
    expect(access).toMatchObject({ code: 'rack-access', status: 'fail', measured: 4, required: 12 });
    expect(access.entityIds).toHaveLength(8);
    expect(routeToBay(closed, 'rack-bay-5', 'reach')).toEqual([]);
    expect(routeToBay(closed, 'rack-bay-1', 'reach').length).toBeGreaterThan(1);
  });

  it('reports unknown, never pass, without racks or without a ceiling height', () => {
    const empty = newWarehouse('W', { width: m(30), depth: m(20) });
    expect(checkWarehouse(empty, 'reach').map((r) => `${r.code}:${r.status}`)).toEqual([
      'aisle-width:unknown',
      'lift-height:unknown',
      'ceiling-clearance:unknown',
      'rack-access:unknown',
      'docks:pass',
    ]);
    const def = empty.catalog['rack-bay']!;
    const one = run(empty, rackRows(def, { definitionId: 'rack-bay', origin: { x: m(5), y: m(10) }, bays: 1, rows: 1, aisle: m(3), flue: cm(20), firstFacing: 'south', taken: taken(empty) }));
    expect(checkWarehouse(one, 'reach')[2]).toMatchObject({ status: 'unknown', reason: 'no-ceiling' });
  });

  it('measures capacity, floor and cube use, zone areas and travel by hand', () => {
    const p = threeRows();
    const w = warehouseMetrics(p, 'reach');
    expect(w.bays).toBe(12);
    expect(w.locations).toBe(180); // 12 bays × 5 levels × 3 pallets
    expect(w.rackCapacity).toBe(180_000_000); // 180 t
    expect(w.floorArea).toBeCloseTo(600, 9);
    expect(w.storageFloorShare).toBeCloseTo((12 * 2.8 * 1.1) / 600, 9); // 6.16 %
    expect(w.cubeShare).toBeCloseTo((12 * 2.8 * 1.1 * 7.5) / (600 * 8), 9); // 5.775 %
    expect(w.zoneArea).toEqual({ dock: 32, staging: 36 });
    expect(w.docks).toBe(2);
  });

  it('drives 5.3 m straight from the dock to a bay right in front of it', () => {
    // 20 × 20 m, one dock at x 8–12, y 0–4; one bay facing south with its front at y = 10 m.
    // The reach truck (1.3 m) stands 0.65 m + one 10 cm cell in front: y = 9.25 m, x = 10.05 m
    // (the cell centre). Nearest dock cell centre: (10.05, 3.95). Straight up: 5.3 m.
    const base = newWarehouse('W', { width: m(20), depth: m(20), height: m(8) });
    const p = run(base, [
      { type: 'space.set', space: { ...base.space, zones: [rectZone('d', 'dock', 'Dock', m(8), 0, m(4), m(4))] } },
      { type: 'item.add', item: { id: 'bay', definitionId: 'rack-bay', position: { x: m(10), y: m(10.55) }, rotation: 180_000, locked: false } },
    ]);
    const w = warehouseMetrics(p, 'reach');
    expect(w.travelAverage).toBeCloseTo(m(5.3), 6);
    expect(w.travelMax).toBeCloseTo(m(5.3), 6);
    expect(routeToBay(p, 'bay', 'reach')).toEqual([
      { x: m(10.05), y: m(3.95) },
      { x: m(10.05), y: m(9.25) },
    ]);
  });

  it('something against the face leaves no aisle; a column 1 m out leaves 1 m', () => {
    const base = newWarehouse('W', { width: m(20), depth: m(20), height: m(8) });
    // Bay facing north, face at y = 10 m, x 8.6–11.4 m.
    const bay = { id: 'bay', definitionId: 'rack-bay', position: { x: m(10), y: m(9.45) }, rotation: 0, locked: false };
    // A floor pallet (1.2 × 1.0 m) whose south half pokes into the bay: y 9.9–10.9 m.
    const pushed = run(base, [
      { type: 'item.add', item: bay },
      { type: 'item.add', item: { id: 'pallet', definitionId: 'floor-pallet', position: { x: m(10), y: m(10.4) }, rotation: 0, locked: false } },
    ]);
    expect(aislesInFront(pushed, baysOf(pushed)).get('bay')).toBe(0);
    const column = { id: 'col', kind: 'column' as const, polygon: [{ x: m(9), y: m(11) }, { x: m(9.4), y: m(11) }, { x: m(9.4), y: m(11.4) }, { x: m(9), y: m(11.4) }] };
    const blocked = run(base, [{ type: 'item.add', item: bay }, { type: 'space.set', space: { ...base.space, obstacles: [column] } }]);
    expect(aislesInFront(blocked, baysOf(blocked)).get('bay')).toBe(m(1));
    expect(checkWarehouse(blocked, 'vna')[0]).toMatchObject({ status: 'fail', measured: m(1), entityIds: ['bay'] });
  });

  it('a bay turned to face west measures its aisle to the west wall', () => {
    const base = newWarehouse('W', { width: m(20), depth: m(20), height: m(8) });
    // Rotated 90° counter-clockwise, the front (+y) points west. Centre x = 4 m, depth 1.1 m: face at 3.45 m.
    const p = run(base, [{ type: 'item.add', item: { id: 'bay', definitionId: 'rack-bay', position: { x: m(4), y: m(10) }, rotation: 90_000, locked: false } }]);
    expect(aislesInFront(p, baysOf(p)).get('bay')).toBe(m(3.45));
  });

  it('any rows the generator lays out have no core issues and the aisle it was given', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 6 }),
        fc.integer({ min: 3, max: 5 }),
        fc.integer({ min: 180, max: 400 }),
        fc.integer({ min: 10, max: 40 }),
        fc.constantFrom('north' as const, 'south' as const),
        fc.constantFrom(...WAREHOUSE_CATALOG.filter((d) => d.category === 'rack').map((d) => d.id)),
        (bays, rows, aisleCm, flueCm, firstFacing, definitionId) => {
          const base = newWarehouse('W', { width: m(60), depth: m(40), height: m(12) });
          const p = run(base, rackRows(base.catalog[definitionId]!, { definitionId, origin: { x: m(10), y: m(12) }, bays, rows, aisle: cm(aisleCm), flue: cm(flueCm), firstFacing, taken: taken(base) }));
          expect(checkProject(p)).toEqual([]);
          const aisle = checkWarehouse(p, 'vna')[0]!;
          expect(aisle.measured).toBe(cm(aisleCm));
        },
      ),
      { numRuns: 40 },
    );
  });

  it('a warehouse saved at T7 opens byte for byte and checks the same', () => {
    const text = readFileSync(new URL('./saves/v1-warehouse-2026-09.json', import.meta.url), 'utf8');
    const opened = deserializeProject(text);
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;
    expect(serializeProject(opened.project)).toBe(text);
    expect(detectPack(opened.project)).toBe('warehouse');
    expect(checkWarehouse(opened.project).map((r) => `${r.code}:${r.status}`)).toEqual(['aisle-width:pass', 'lift-height:pass', 'ceiling-clearance:pass', 'rack-access:pass', 'docks:pass']);
    expect(warehouseMetrics(opened.project).locations).toBe(180);
  });

  it('gives the figures variants are compared on', () => {
    const figures = packOf('warehouse').figures(threeRows());
    expect(figures.map((f) => [f.id, f.value, f.better])).toEqual([
      ['locations', 180, 'higher'],
      ['rack-capacity', 180_000_000, 'higher'],
      ['floor-use', expect.closeTo((12 * 2.8 * 1.1) / 600, 9), undefined],
      ['travel', expect.any(Number), 'lower'],
    ]);
    const empty = packOf('warehouse').figures(newWarehouse('W', { width: m(30), depth: m(20) }));
    expect(empty.find((f) => f.id === 'travel')!.value).toBeUndefined();
  });
});
