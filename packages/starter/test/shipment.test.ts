import { checkProject, fromUnit, placedSize, type Project } from '@space-planner/core';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { checkContainer, planShipment, shipmentOf, stepOf, type ShipmentPart } from '../src/index.js';

const mm = (v: number) => fromUnit(v / 10, 'cm');
const part = (id: string, l: number, w: number, h: number, quantity: number, allowTilt = true): ShipmentPart => ({ id, name: id, length: mm(l), width: mm(w), height: mm(h), quantity, allowTilt });

/** Everything a loaded container must satisfy: inside, no clashes, supported, upright when told, all planned pieces placed. */
function expectSound(p: Project): void {
  const errors = checkProject(p).filter((i) => i.severity === 'error');
  expect(errors.map((e) => e.code)).toEqual([]);
  const rules = new Map(checkContainer(p).map((r) => [r.code, r.status]));
  expect(rules.get('support')).toBe('pass');
  expect(rules.get('unpacked')).toBe('pass');
  expect(rules.get('orientation')).not.toBe('fail');
  for (const item of Object.values(p.items)) {
    const top = (item.elevation ?? 0) + placedSize(item, p.catalog[item.definitionId]!).h;
    expect(top).toBeLessThanOrEqual(p.space.ceilingHeight!);
  }
}

describe('shipments', () => {
  it('upright 100 × 50 × 50 cm boxes: 88 per 20′ container, so 100 need two (hand-computed)', () => {
    // 4 high (200 of 239 cm); a 50 cm wall holds 2 across × 4 = 8; 11 walls = 550 of 589 cm → 88.
    const plan = planShipment({ name: 'Boxes', containerType: '20gp', parts: [part('box', 1000, 500, 500, 100, false)] });
    expect(plan.containers.map((c) => c.pieces.box)).toEqual([88, 12]);
    expect(plan.containers[0]!.usedLength).toBe(mm(5500));
    // The last 12 go in the shallowest wall that holds them all: 100 cm deep, 4 across × 3 high = 3 steps.
    const last = plan.containers[1]!;
    expect(last.usedLength).toBe(mm(1000));
    expect(Math.max(...Object.values(last.project.items).map((i) => stepOf(i)!))).toBe(3);
    expect(Object.values(last.project.items).every((i) => !i.tilt)).toBe(true);
    plan.containers.forEach((c) => expectSound(c.project));
    expect(plan.explanation).toBe('100 pieces need 2 × 20′ standard; the last one is 17% full along its length.');
  });

  it('55QN80H cushions 1335 × 110 × 400 mm: 1 260 per 40′ high cube (hand-computed)', () => {
    // Walls 400 mm deep: 21 across (2 310 of 2 350 mm) × 2 standing on end (2 670 of 2 690 mm) = 42;
    // 30 walls = 12 000 of 12 030 mm → 1 260. So 3 500 pieces need 1 260 + 1 260 + 980.
    const plan = planShipment({ name: '55QN80H', containerType: '40hc', parts: [part('qn', 1335, 110, 400, 3500)] });
    expect(plan.containers.map((c) => c.pieces.qn)).toEqual([1260, 1260, 980]);
    expect(plan.containers[0]!.usedLength).toBe(mm(12_000));
    // Two layers per wall, one loading step each.
    expect(Math.max(...Object.values(plan.containers[0]!.project.items).map((i) => stepOf(i)!))).toBe(60);
    plan.containers.forEach((c) => expectSound(c.project));
  });

  it('parts of the same size share walls: a cushion top and bottom fill containers as one run', () => {
    // 1 750 tops + 1 750 bottoms = 3 500 at 1 260 per container; tops first, in the order given.
    const plan = planShipment({ name: 'QN', containerType: '40hc', parts: [part('top', 1335, 110, 400, 1750), part('bot', 1335, 110, 400, 1750)] });
    expect(plan.containers.map((c) => c.pieces)).toEqual([{ top: 1260 }, { top: 490, bot: 770 }, { bot: 980 }]);
    // The wall where the tops run out is finished with bottoms: 490 = 11 walls of 42 + 28, then 14 bottoms.
    const mixed = plan.containers[1]!.project;
    expect(mixed.catalog.top!.meta?.quantity).toBe(490);
    expect(mixed.catalog.bot!.meta?.quantity).toBe(770);
    expectSound(mixed);
  });

  it('the 05/Oct cushion plan needs four 40′ high cubes, the fourth barely used', () => {
    const plan = planShipment({
      name: 'Cushions 05/Oct',
      containerType: '40hc',
      parts: [part('55qn80h', 1335, 110, 400, 3500), part('32f6000', 788, 102, 185, 1600)],
    });
    expect(plan.containers.length).toBe(4);
    const total = (id: string) => plan.containers.reduce((s, c) => s + (c.pieces[id] ?? 0), 0);
    expect([total('55qn80h'), total('32f6000')]).toEqual([3500, 1600]);
    expect(plan.containers[3]!.usedLength / mm(12_030)).toBeLessThan(0.15);
    plan.containers.forEach((c, i) => {
      expectSound(c.project);
      expect(shipmentOf(c.project)).toEqual({ id: 'cushions-05-oct', name: 'Cushions 05/Oct', index: i + 1, count: 4 });
      expect(c.project.name).toBe(`Cushions 05/Oct · container ${i + 1} of 4`);
    });
  });

  it('parts too big for the container are named, not loaded', () => {
    const plan = planShipment({ name: 'Big', containerType: '20gp', parts: [part('beam', 7000, 100, 100, 5), part('box', 500, 500, 500, 1)] });
    expect(plan.tooBig).toEqual(['beam']);
    expect(plan.containers.map((c) => c.pieces)).toEqual([{ box: 1 }]);
  });

  it('no quantities, no containers', () => {
    const plan = planShipment({ name: 'None', containerType: '40hc', parts: [part('a', 500, 500, 500, 0)] });
    expect(plan.containers).toEqual([]);
    expect(plan.explanation).toBe('Nothing to load: give the parts a quantity.');
  });

  it('property: every piece is loaded once, each container is sound, and the same input gives the same plan', () => {
    const arbPart = fc.record({
      l: fc.integer({ min: 100, max: 2400 }),
      w: fc.integer({ min: 100, max: 1500 }),
      h: fc.integer({ min: 100, max: 1500 }),
      q: fc.integer({ min: 0, max: 250 }),
      tilt: fc.boolean(),
    });
    fc.assert(
      fc.property(fc.array(arbPart, { minLength: 1, maxLength: 3 }), fc.constantFrom('20gp', '40gp', '40hc', 'trailer'), (specs, type) => {
        const parts = specs.map((s, i) => part(`p${i}`, s.l, s.w, s.h, s.q, s.tilt));
        const plan = planShipment({ name: 'Random', containerType: type, parts });
        for (const p of parts) {
          const loaded = plan.containers.reduce((s, c) => s + (c.pieces[p.id] ?? 0), 0);
          expect(loaded).toBe(plan.tooBig.includes(p.id) ? 0 : p.quantity);
        }
        for (const c of plan.containers) {
          expectSound(c.project);
          for (const item of Object.values(c.project.items)) if (item.tilt) expect(c.project.catalog[item.definitionId]!.meta?.allowTilt).toBe(true);
        }
        expect(JSON.stringify(planShipment({ name: 'Random', containerType: type, parts }))).toBe(JSON.stringify(plan));
      }),
      { numRuns: 60 },
    );
  });
});
