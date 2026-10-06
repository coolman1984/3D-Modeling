import { apply, fromUnit, type ItemDefinition, type Project } from '@space-planner/core';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { LEVEL_PENALTY, locationsOf, moveStockCommands, newWarehouse, optimizeSlotting, rackDefinition, rackSpecOf, rackStock, slotPlacement, slotTravel, stockCommands, stockMetrics, stockOf, type Slot } from '../src/index.js';

const cm = (v: number) => fromUnit(v, 'cm');
const m = (v: number) => fromUnit(v, 'm');

const material = (id: string, moves: number): ItemDefinition => ({
  id, name: `Material ${id}`, category: 'box', size: { w: cm(120), d: cm(80), h: cm(150) },
  clearance: { front: 0, back: 0, left: 0, right: 0 }, mass: 300_000,
  meta: { sku: id, movesPerWeek: moves, unitsPerPallet: 10 },
});

/** 20 × 12 m warehouse, shipping dock at x 15–18 m on the south wall, one rack row of 4 bays × 2 levels × 2 positions centred at (10 m, 6 m). */
function fixture(): Project {
  const base = newWarehouse('Stock fixture', 20, 12, 6);
  const rack = rackDefinition('rack-4', { bays: 4, bayWidth: cm(270), depth: cm(110), height: cm(400), levels: 2, positionsPerLevel: 2, uprightWidth: cm(10) });
  return {
    ...base,
    catalog: { ...base.catalog, [rack.id]: rack, FAST: material('FAST', 40), SLOW: material('SLOW', 2) },
    items: { R01: { id: 'R01', definitionId: rack.id, position: { x: m(10), y: m(6) }, rotation: 0, locked: false, meta: { blockedPositions: 'B04-L02-P02' } } },
  };
}

function run(project: Project, changes: ReadonlyArray<Slot & { material: string | null }>): Project {
  const result = stockCommands(project, changes);
  if (!result.ok) throw new Error(result.problem);
  const applied = apply(project, { type: 'batch', commands: result.commands });
  if (!applied.ok) throw new Error(applied.rejection.message);
  return applied.project;
}

describe('stock encoding', () => {
  it('stores a bay as levels joined by | and positions by , keeping the rack\'s other data', () => {
    const p = run(fixture(), [{ rackId: 'R01', bay: 1, level: 1, position: 2, material: 'FAST' }, { rackId: 'R01', bay: 1, level: 2, position: 1, material: 'SLOW' }]);
    expect(p.items.R01!.meta).toEqual({ blockedPositions: 'B04-L02-P02', s01: ',FAST|SLOW,' });
    expect([...stockOf(p).entries()]).toEqual([['R01-B01-L01-P02', 'FAST'], ['R01-B01-L02-P01', 'SLOW']]);
    expect(rackStock(p, 'R01')![0]).toEqual([['', 'FAST'], ['SLOW', '']]);
  });

  it('emptying the last location of a bay removes its entry', () => {
    let p = run(fixture(), [{ rackId: 'R01', bay: 2, level: 1, position: 1, material: 'FAST' }]);
    p = run(p, [{ rackId: 'R01', bay: 2, level: 1, position: 1, material: null }]);
    expect(p.items.R01!.meta).toEqual({ blockedPositions: 'B04-L02-P02' });
  });

  it('refuses unknown materials, locations outside the rack and non-racks', () => {
    const p = fixture();
    expect(stockCommands(p, [{ rackId: 'R01', bay: 1, level: 1, position: 1, material: 'NOPE' }])).toMatchObject({ ok: false, problem: 'unknown-material' });
    expect(stockCommands(p, [{ rackId: 'R01', bay: 5, level: 1, position: 1, material: 'FAST' }])).toMatchObject({ ok: false, problem: 'outside-rack' });
    expect(stockCommands(p, [{ rackId: 'X', bay: 1, level: 1, position: 1, material: 'FAST' }])).toMatchObject({ ok: false, problem: 'not-a-rack' });
  });

  it('moving onto an occupied location swaps the two pallets', () => {
    let p = run(fixture(), [{ rackId: 'R01', bay: 1, level: 1, position: 1, material: 'FAST' }, { rackId: 'R01', bay: 3, level: 2, position: 2, material: 'SLOW' }]);
    const moved = moveStockCommands(p, { rackId: 'R01', bay: 1, level: 1, position: 1 }, { rackId: 'R01', bay: 3, level: 2, position: 2 });
    if (!moved.ok) throw new Error(moved.problem);
    const r = apply(p, { type: 'batch', commands: moved.commands });
    if (!r.ok) throw new Error(r.rejection.message);
    p = r.project;
    expect(locationsOf(p, 'FAST')).toEqual(['R01-B03-L02-P02']);
    expect(locationsOf(p, 'SLOW')).toEqual(['R01-B01-L01-P01']);
  });

  it('counts pallets, units and occupancy', () => {
    const p = run(fixture(), [{ rackId: 'R01', bay: 1, level: 1, position: 1, material: 'FAST' }, { rackId: 'R01', bay: 1, level: 1, position: 2, material: 'FAST' }, { rackId: 'R01', bay: 2, level: 1, position: 1, material: 'SLOW' }]);
    const s = stockMetrics(p);
    expect(s.positions).toBe(16);
    expect(s.occupied).toBe(3);
    expect(s.units).toBe(30);
    expect(s.mass).toBe(900_000);
    expect(s.byMaterial.map((r) => [r.material.id, r.pallets])).toEqual([['FAST', 2], ['SLOW', 1]]);
  });
});

describe('location geometry and travel', () => {
  it('places a pallet at its bay share, hand-computed', () => {
    const p = fixture();
    const spec = rackSpecOf(p.catalog['rack-4'])!;
    // Rack 4 × 270 + 5 × 10 = 1,130 cm wide, centred at x = 1,000 cm; bay 1 starts at 1,000 − 565 + 10 = 445 cm.
    // Position 1 of 2 is centred 67.5 cm into the bay: x = 512.5 cm. Level 2 stands at 400 / 2 = 200 cm.
    expect(slotPlacement(p.items.R01!, spec, { bay: 1, level: 2, position: 1 })).toEqual({ center: { x: cm(512.5), y: m(6) }, elevation: cm(200), width: cm(135), depth: cm(110), height: cm(200) });
  });

  it('each level up costs exactly 1.5 m more; the bay nearest the shipping dock is the closest', () => {
    const travel = slotTravel(fixture());
    expect(travel.size).toBe(16);
    expect(travel.get('R01-B02-L02-P01')! - travel.get('R01-B02-L01-P01')!).toBe(LEVEL_PENALTY);
    expect(travel.get('R01-B04-L01-P01')!).toBeLessThan(travel.get('R01-B01-L01-P01')!);
  });
});

describe('slotting optimiser', () => {
  it('moves the busy material next to the dock and reports the saving', () => {
    const p = run(fixture(), [
      { rackId: 'R01', bay: 1, level: 2, position: 1, material: 'FAST' },
      { rackId: 'R01', bay: 4, level: 1, position: 1, material: 'SLOW' },
    ]);
    const c = optimizeSlotting(p);
    const r = apply(p, { type: 'batch', commands: c.commands });
    if (!r.ok) throw new Error(r.rejection.message);
    const travel = slotTravel(p);
    const best = [...travel.entries()].sort((a, b) => a[1] - b[1] || (a[0] < b[0] ? -1 : 1));
    expect(locationsOf(r.project, 'FAST')).toEqual([best[0]![0]]);
    expect(c.metrics.travelAfter).toBeLessThan(c.metrics.travelBefore!);
    expect(c.metrics.saving).toBeGreaterThan(0);
  });

  it('never puts a pallet in a blocked location and keeps every pallet (property)', () => {
    const base = fixture();
    const slots: Slot[] = [];
    for (let bay = 1; bay <= 4; bay++) for (let level = 1; level <= 2; level++) for (let position = 1; position <= 2; position++) slots.push({ rackId: 'R01', bay, level, position });
    fc.assert(fc.property(fc.array(fc.constantFrom('FAST', 'SLOW', ''), { minLength: 16, maxLength: 16 }), (fill) => {
      const changes = slots.map((s, k) => ({ ...s, material: fill[k] || null })).filter((c) => !(c.bay === 4 && c.level === 2 && c.position === 2));
      const p = run(base, changes);
      const c = optimizeSlotting(p);
      const r = apply(p, { type: 'batch', commands: c.commands });
      if (c.commands.length && !r.ok) return false;
      const after = r.ok ? r.project : p;
      const count = (x: Project) => [...stockOf(x).values()].sort().join();
      return count(after) === count(p) && !stockOf(after).has('R01-B04-L02-P02') && JSON.stringify(optimizeSlotting(p)) === JSON.stringify(c);
    }), { numRuns: 60 });
  });
});
