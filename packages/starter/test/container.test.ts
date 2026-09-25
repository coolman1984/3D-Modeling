import { apply, checkProject, fromUnit, type Command, type ItemInstance, type Project } from '@space-planner/core';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { checkContainer, checkPack, containerMetrics, detectPack, dropHeight as dropHeightOf, extremePointPacker, newContainer, packContainer, type RuleResult } from '../src/index.js';

const cm = (v: number) => fromUnit(v, 'cm');
const kg = (v: number) => v * 1000;

function put(p: Project, id: string, definitionId: string, xCm: number, yCm: number, extra: Partial<ItemInstance> = {}): Project {
  const command: Command = { type: 'item.add', item: { id, definitionId, position: { x: cm(xCm), y: cm(yCm) }, rotation: 0, locked: false, ...extra } };
  const r = apply(p, command);
  if (!r.ok) throw new Error(r.rejection.message);
  return r.project;
}

function withQuantity(p: Project, id: string, quantity: number, extra: Record<string, string | number | boolean> = {}): Project {
  const definition = p.catalog[id]!;
  const r = apply(p, { type: 'catalog.define', definition: { ...definition, meta: { ...definition.meta, quantity, ...extra } } });
  if (!r.ok) throw new Error(r.rejection.message);
  return r.project;
}

function must(r: ReturnType<typeof apply>): Project {
  if (!r.ok) throw new Error(r.rejection.message);
  return r.project;
}

const rule = (p: Project, code: RuleResult['code']) => checkContainer(p).find((r) => r.code === code)!;

describe('container projects', () => {
  it('a 20-foot container is a 5.89 × 2.35 m box, 2.39 m high, with its payload and doors', () => {
    const p = newContainer('Order 1', '20gp');
    expect(p.space.boundary[2]).toEqual({ x: cm(589), y: cm(235) });
    expect(p.space.ceilingHeight).toBe(cm(239));
    expect(p.space.meta).toEqual({ pack: 'container', containerType: '20gp', doorEnd: 'east', maxPayload: kg(28_200), doorWidth: cm(234), doorHeight: cm(228) });
    expect(detectPack(p)).toBe('container');
    expect(checkContainer(p).map((r) => `${r.code} ${r.status}`)).toEqual([
      'payload unknown', 'support unknown', 'load-on-top unknown', 'orientation unknown', 'stacking-group unknown', 'unloading-order unknown', 'balance unknown', 'unpacked unknown',
    ]);
    expect(checkPack(p, 'container')[0]!.source?.ruleSet).toBe('starter.container.v1');
  });
});

describe('loading rules', () => {
  it('payload: two 15 t machines exceed the 28.2 t limit', () => {
    let p = newContainer('Heavy', '20gp');
    p = must(apply(p, { type: 'catalog.define', definition: { ...p.catalog['machine-crate']!, mass: kg(15_000) } }));
    p = put(p, 'm1', 'machine-crate', 100, 60);
    expect(rule(p, 'payload')).toMatchObject({ status: 'pass', measured: kg(15_000), required: kg(28_200) });
    p = put(p, 'm2', 'machine-crate', 300, 60);
    expect(rule(p, 'payload')).toMatchObject({ status: 'fail', measured: kg(30_000) });
  });

  it('support: a pallet shifted 40 cm on the one below rests on 80 × 80 of 120 × 80 cm = 66.6% (fails); 30 cm → 75% (passes)', () => {
    let p = newContainer('Support', '40hc');
    p = put(p, 'a', 'euro-pallet', 60, 40);
    const shifted = put(p, 'b', 'euro-pallet', 100, 40, { elevation: cm(150) });
    expect(rule(shifted, 'support')).toMatchObject({ status: 'fail', measured: 66.6, required: 70, entityIds: ['b'] });
    expect(rule(put(p, 'b', 'euro-pallet', 90, 40, { elevation: cm(150) }), 'support')).toMatchObject({ status: 'pass', measured: 75 });
  });

  it('load on top: a small carton carries 40 kg; six cartons of 6 kg above it pass (36 kg), seven fail (42 kg)', () => {
    const column = (n: number) => {
      let p = newContainer('Column', '40hc');
      for (let i = 0; i < n; i++) p = put(p, `c${i}`, 'carton-small', 20, 15, i > 0 ? { elevation: cm(30 * i) } : {});
      return p;
    };
    expect(rule(column(7), 'load-on-top')).toMatchObject({ status: 'pass', measured: kg(36) });
    expect(rule(column(8), 'load-on-top')).toMatchObject({ status: 'fail', measured: kg(42), entityIds: ['c0'] });
  });

  it('load on top: nothing may rest on a fragile carton', () => {
    let p = newContainer('Fragile', '20gp');
    p = put(p, 'f', 'fragile-carton', 30, 20);
    p = put(p, 's', 'carton-small', 30, 20, { elevation: cm(50) });
    expect(rule(p, 'load-on-top')).toMatchObject({ status: 'fail', entityIds: ['f'] });
  });

  it('orientation: a pallet may not lie on its side; a carton may', () => {
    let p = newContainer('Tilt', '20gp');
    p = put(p, 'c', 'carton-large', 30, 20, { tilt: 'x' });
    expect(rule(p, 'orientation').status).toBe('pass');
    p = put(p, 'e', 'euro-pallet', 300, 100, { tilt: 'y' });
    expect(rule(p, 'orientation')).toMatchObject({ status: 'fail', entityIds: ['e'] });
  });

  it('unloading order: a pallet for stop 1 behind a pallet for stop 2 in the same lane is blocked', () => {
    let p = newContainer('Stops', '20gp');
    p = put(p, 'deep', 'euro-pallet', 60, 40, { meta: { stop: 1 } });
    p = put(p, 'door', 'euro-pallet', 180, 40, { meta: { stop: 2 } });
    expect(rule(p, 'unloading-order')).toMatchObject({ status: 'fail', entityIds: ['deep'] });
    const fixed = must(apply(must(apply(p, { type: 'item.meta', id: 'deep', meta: { stop: 2 } })), { type: 'item.meta', id: 'door', meta: { stop: 1 } }));
    expect(rule(fixed, 'unloading-order').status).toBe('pass');
    // A pallet in the other lane (y 120–200 cm) does not block.
    let side = newContainer('Lanes', '20gp');
    side = put(side, 'deep', 'euro-pallet', 60, 40, { meta: { stop: 1 } });
    side = put(side, 'door', 'euro-pallet', 180, 160, { meta: { stop: 2 } });
    expect(rule(side, 'unloading-order').status).toBe('pass');
  });

  it('balance: one crate at the front wall puts the centre of mass 39.8% off the middle; two at both ends balance', () => {
    // 20′: length 589 cm, middle at 294.5 cm. Crate centre at 60 cm → (294.5 − 60) / 589 = 39.8%.
    let p = newContainer('Balance', '20gp');
    p = put(p, 'a', 'crate', 60, 117.5);
    expect(rule(p, 'balance')).toMatchObject({ status: 'fail', measured: 39.8, required: 10 });
    p = put(p, 'b', 'crate', 529, 117.5);
    expect(rule(p, 'balance')).toMatchObject({ status: 'pass', measured: 0 });
  });

  it('unpacked: 2 of 3 planned pallets placed', () => {
    let p = withQuantity(newContainer('Plan', '20gp'), 'euro-pallet', 3);
    p = put(p, 'a', 'euro-pallet', 60, 40);
    p = put(p, 'b', 'euro-pallet', 180, 40);
    expect(rule(p, 'unpacked')).toMatchObject({ status: 'fail', measured: 2, required: 3, entityIds: ['euro-pallet'] });
    expect(containerMetrics(p).unpacked).toBe(1);
  });

  it('metrics: two euro pallets use 2 × 1.44 m³ of a 33.08 m³ container and 800 kg of 28.2 t', () => {
    let p = newContainer('Metrics', '20gp');
    p = put(p, 'a', 'euro-pallet', 60, 40);
    p = put(p, 'b', 'euro-pallet', 529, 195);
    const m = containerMetrics(p);
    // 5.89 × 2.35 × 2.39 = 33.081185 m³; each pallet 1.2 × 0.8 × 1.5 = 1.44 m³.
    expect(m.volumeUse).toBeCloseTo(2.88 / 33.081185, 9);
    expect(m.mass).toBe(kg(800));
    expect(m.payloadUse).toBeCloseTo(800 / 28_200, 9);
    // Floor: 2 × 0.96 m² of 5.89 × 2.35 = 13.8415 m².
    expect(m.floorUse).toBeCloseTo(1.92 / 13.8415, 9);
  });
});

describe('extreme-point packer', () => {
  const clean = (p: Project) => {
    expect(checkProject(p).filter((i) => i.severity === 'error')).toEqual([]);
    for (const code of ['support', 'load-on-top', 'orientation', 'stacking-group'] as const) expect(`${code} ${rule(p, code).status} ${rule(p, code).entityIds.join(',')}`).not.toMatch(/ fail/);
  };

  it('puts ten euro pallets on the floor of a 20-foot container, deepest first, with load steps', () => {
    const p = withQuantity(newContainer('Pallets', '20gp'), 'euro-pallet', 10);
    const candidate = packContainer(p, { strategy: 'largest-first' });
    expect(candidate.commands).toHaveLength(10);
    expect(candidate.leftOver).toEqual([]);
    const r = apply(p, { type: 'batch', commands: candidate.commands });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    clean(r.project);
    expect(rule(r.project, 'unpacked').status).toBe('pass');
    // 1.5 m pallets cannot stack under a 2.39 m roof: all on the floor.
    expect(Object.values(r.project.items).every((i) => !i.elevation)).toBe(true);
    expect(Object.values(r.project.items).map((i) => i.meta?.step).sort((a, b) => Number(a) - Number(b))).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(packContainer(p, { strategy: 'largest-first' })).toEqual(candidate); // deterministic
  });

  it('stacks cartons and reports what does not fit', () => {
    const p = withQuantity(withQuantity(newContainer('Cartons', '20gp'), 'carton-large', 400), 'machine-crate', 5);
    const [best] = extremePointPacker.propose(p, {});
    expect(best).toBeDefined();
    const r = apply(p, { type: 'batch', commands: best!.commands });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    clean(r.project);
    expect(Object.values(r.project.items).some((i) => (i.elevation ?? 0) > 0)).toBe(true);
    expect(best!.metrics.placed! + best!.metrics.leftOver!).toBe(405);
    expect(best!.explanation).toMatch(/placed \d+ of 405 pieces/);
  });

  it('never proposes a load with clashes, floating pieces or overloads (random cargo)', () => {
    const types = ['euro-pallet', 'crate', 'carton-large', 'carton-small', 'fragile-carton', 'drum'];
    fc.assert(
      fc.property(fc.array(fc.integer({ min: 0, max: 12 }), { minLength: types.length, maxLength: types.length }), fc.constantFrom('largest-first', 'heaviest-first', 'footprint-first' as const), (counts, strategy) => {
        let p = newContainer('Random', '20gp');
        types.forEach((t, i) => (p = withQuantity(p, t, counts[i]!)));
        const candidate = packContainer(p, { strategy: strategy as 'largest-first' });
        const r = apply(p, { type: 'batch', commands: candidate.commands.length > 0 ? candidate.commands : [{ type: 'project.rename', name: 'x' }] });
        expect(r.ok).toBe(true);
        if (r.ok) clean(r.project);
      }),
      { numRuns: 25 },
    );
  });
});

describe('settling a piece', () => {
  it('drops onto the highest piece under it, or to the floor', () => {
    let p = newContainer('Drop', '40hc');
    p = put(p, 'a', 'euro-pallet', 60, 40); // top at 150 cm
    p = put(p, 'b', 'carton-large', 60, 40, { elevation: cm(220) });
    expect(dropHeightOf(p, 'b')).toBe(cm(150));
    p = put(p, 'c', 'carton-large', 400, 100, { elevation: cm(100) });
    expect(dropHeightOf(p, 'c')).toBe(0);
  });
});
