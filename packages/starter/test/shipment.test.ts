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
    expect(plan.explanation).toBe('100 pieces need 2 × 20′ standard; the last one is 17% full along its length. Pieces with no layer limit stated stand up to 4 high: state a limit (Layers) for anything fragile or heavy.');
  });

  it('TV55B cushions 1335 × 110 × 400 mm lie flat and are stacked: 1 080 per 40′ high cube (hand-computed)', () => {
    // A cushion that may be turned lies on its largest face (1335 × 400), 110 mm up: it is never stood on its long side.
    // Walls 1 335 mm deep: 5 across (2 000 of 2 350 mm) × 24 layers (2 640 of 2 690 mm) = 120;
    // 9 walls = 12 015 of 12 030 mm → 1 080. So 3 500 pieces need 1 080 × 3 + 260.
    const plan = planShipment({ name: 'TV55B', containerType: '40hc', parts: [part('qn', 1335, 110, 400, 3500)] });
    expect(plan.containers.map((c) => c.pieces.qn)).toEqual([1080, 1080, 1080, 260]);
    expect(plan.containers[0]!.usedLength).toBe(mm(12_015));
    const items = Object.values(plan.containers[0]!.project.items);
    // every piece lies flat: its height in the container is its smallest side
    for (const i of items) expect(placedSize(i, plan.containers[0]!.project.catalog.qn!).h).toBe(mm(110));
    // 24 layers per wall, one loading step each: 9 × 24.
    expect(Math.max(...items.map((i) => stepOf(i)!))).toBe(216);
    // The last 260: two walls of 120, then the 20 left in the shallowest wall that holds them (400 mm deep, 1 across × 24).
    expect(plan.containers[3]!.usedLength).toBe(mm(2 * 1335 + 400));
    plan.containers.forEach((c) => expectSound(c.project));
  }, 60_000); // thousands of pieces, each checked: slow when the whole repository is tested in parallel

  it('a long piece stands on end only when it must: one that may not be turned keeps its listed height', () => {
    // Not allowed to turn ("this way up"): the cushion keeps the 400 mm it was listed with, standing on its 1335 × 110 edge.
    const upright = planShipment({ name: 'Up', containerType: '40hc', parts: [part('qn', 1335, 110, 400, 100, false)] }).containers[0]!.project;
    for (const i of Object.values(upright.items)) expect(placedSize(i, upright.catalog.qn!).h).toBe(mm(400));
    // Turnable, but lying flat does not fit the 2 340 mm doors: a 2 400 × 300 × 100 mm board goes in on a side (300 mm up), never on end.
    const board = planShipment({ name: 'Board', containerType: '40hc', parts: [part('b', 2400, 300, 100, 10)] }).containers[0]!.project;
    for (const i of Object.values(board.items)) expect(placedSize(i, board.catalog.b!).h).not.toBe(mm(2400));
  });

  it('parts of the same size share walls: a cushion top and bottom fill containers as one run', () => {
    // 1 750 tops + 1 750 bottoms = 3 500 at 1 080 per container; tops first, in the order given.
    const plan = planShipment({ name: 'QN', containerType: '40hc', parts: [part('top', 1335, 110, 400, 1750), part('bot', 1335, 110, 400, 1750)] });
    expect(plan.containers.map((c) => c.pieces)).toEqual([{ top: 1080 }, { top: 670, bot: 410 }, { bot: 1080 }, { bot: 260 }]);
    // The wall where the tops run out is finished with bottoms: 670 = 5 walls of 120 + 70, then 50 bottoms.
    const mixed = plan.containers[1]!.project;
    expect(mixed.catalog.top!.meta?.quantity).toBe(670);
    expect(mixed.catalog.bot!.meta?.quantity).toBe(410);
    expectSound(mixed);
  }, 60_000); // thousands of pieces, each checked: slow when the whole repository is tested in parallel

  it('the 05/Oct cushion plan needs four 40′ high cubes, every cushion lying flat', () => {
    const plan = planShipment({
      name: 'Cushions 05/Oct',
      containerType: '40hc',
      parts: [part('tv55b', 1335, 110, 400, 3500), part('tv32c', 788, 102, 185, 1600)],
    });
    expect(plan.containers.length).toBe(4);
    const total = (id: string) => plan.containers.reduce((s, c) => s + (c.pieces[id] ?? 0), 0);
    expect([total('tv55b'), total('tv32c')]).toEqual([3500, 1600]);
    plan.containers.forEach((c, i) => {
      expectSound(c.project);
      for (const item of Object.values(c.project.items)) {
        const d = c.project.catalog[item.definitionId]!;
        expect(placedSize(item, d).h).toBe(Math.min(d.size.w, d.size.d, d.size.h));
      }
      expect(shipmentOf(c.project)).toEqual({ id: 'cushions-05-oct', name: 'Cushions 05/Oct', index: i + 1, count: 4 });
      expect(c.project.name).toBe(`Cushions 05/Oct · container ${i + 1} of 4`);
    });
  }, 60_000); // thousands of pieces, each checked: slow when the whole repository is tested in parallel

  it('fills the room above a half-full wall before starting another container (hand-computed)', () => {
    // 20′ (589 × 235 × 239 cm). A: 12 upright 100 × 50 × 50 cm boxes = one 100 cm wall, 4 across ×
    // 3 high, top at 150 cm over 200 cm of the width. Then 30 cm cubes: 16 walls of 7 × 7 = 784.
    // Gaps: above A 3 × 6 × 2 = 36 cubes (100 × 200 × 89 cm), beside A 3 × 1 × 7 = 21 (100 × 35 × 239 cm).
    const parts = (cubes: number) => [part('a', 1000, 500, 500, 12, false), part('cube', 300, 300, 300, cubes)];
    const one = planShipment({ name: 'Gaps', containerType: '20gp', parts: parts(841) });
    expect(one.containers.map((c) => c.pieces)).toEqual([{ a: 12, cube: 841 }]);
    expectSound(one.containers[0]!.project);
    // The cubes on top of A go in right after A, before the next wall closes it off.
    const items = Object.values(one.containers[0]!.project.items);
    const onA = items.filter((i) => i.definitionId === 'cube' && i.position.x < mm(1000));
    expect(onA).toHaveLength(57);
    const firstWallStep = Math.min(...items.filter((i) => i.definitionId === 'cube' && i.position.x > mm(1000)).map((i) => stepOf(i)!));
    expect(Math.max(...onA.map((i) => stepOf(i)!))).toBeLessThan(firstWallStep);
    expect(planShipment({ name: 'Gaps', containerType: '20gp', parts: parts(842) }).containers.map((c) => c.pieces)).toEqual([{ a: 12, cube: 841 }, { cube: 1 }]);
  });

  it('a stated layer limit holds above a wall too: boxes three high take nothing on top (hand-computed)', () => {
    // A: 12 boxes, at most 3 high = 4 across × 3, the limit. Nothing goes on top of them; the cubes (also at most 3 high) fill
    // the floor beside A (3 × 1 × 3 = 9) and 16 walls of 7 × 3 = 21.
    const limited = (p: ShipmentPart): ShipmentPart => ({ ...p, maxLayers: 3 });
    const plan = planShipment({ name: 'Limit', containerType: '20gp', parts: [limited(part('a', 1000, 500, 500, 12, false)), limited(part('cube', 300, 300, 300, 400))] });
    const first = plan.containers[0]!.project;
    const aTop = Math.max(...Object.values(first.items).filter((i) => i.definitionId === 'a').map((i) => (i.elevation ?? 0) + mm(500)));
    expect(aTop).toBe(mm(1500));
    const onA = Object.values(first.items).filter((i) => i.definitionId === 'cube' && (i.elevation ?? 0) >= mm(1500) && i.position.x < mm(1000));
    expect(onA).toEqual([]);
    expect(first.catalog.cube!.meta?.quantity).toBe(345);
    plan.containers.forEach((c) => expectSound(c.project));
  });

  it('heavy cargo fills a container by weight: 23 tile pallets need two 40′ high cubes, not one (hand-computed)', () => {
    // A pallet of porcelain tiles: 1 100 × 1 100 × 1 000 mm, 40 cartons × 32 kg + a 25 kg pallet = 1 305 kg.
    // By space a 40′ high cube takes 40: 2 across (2 200 of 2 350 mm) × 2 high (2 000 of 2 690 mm) × 10 walls (11 000 of 12 030 mm).
    // By weight it takes floor(26 500 / 1 305) = 20. So 23 pallets need 20 + 3, and the first is at 26 100 kg of 26 500.
    const pallet = (quantity: number, massKg?: number): ShipmentPart => ({ ...part('pallet', 1100, 1100, 1000, quantity, false), ...(massKg === undefined ? {} : { mass: massKg * 1000 }) });
    expect(planShipment({ name: 'Tiles', containerType: '40hc', parts: [pallet(23)] }).containers.map((c) => c.pieces.pallet)).toEqual([23]);
    const plan = planShipment({ name: 'Tiles', containerType: '40hc', parts: [pallet(23, 1305)] });
    expect(plan.containers.map((c) => c.pieces.pallet)).toEqual([20, 3]);
    plan.containers.forEach((c) => expectSound(c.project));
    const first = plan.containers[0]!.project;
    const mass = Object.values(first.items).reduce((m, i) => m + first.catalog[i.definitionId]!.mass!, 0);
    expect(mass).toBe(26_100_000);
    expect(new Map(checkContainer(first).map((r) => [r.code, r.status])).get('payload')).toBe('pass');
    // Spread, not piled: 20 pallets one high over 10 walls (11 000 mm), centred: 515 mm free at each end
    // ((12 030 − 11 000) / 2). The last 3 go one high in 2 walls (2 200 mm), the single one in the middle of the width.
    expect(Object.values(first.items).every((i) => !i.elevation)).toBe(true);
    expect(plan.containers[0]!.usedLength).toBe(mm(11_000));
    expect(Math.min(...Object.values(first.items).map((i) => i.position.x))).toBe(mm(515 + 550));
    for (const c of plan.containers) expect(new Map(checkContainer(c.project).map((r) => [r.code, r.status])).get('balance')).toBe('pass');
    expect(plan.explanation).toBe('23 pieces need 2 × 40′ high cube; the last one is 18% full along its length. Weight is the limit: 1 container(s) reach the 26.5 t payload before they are full.');
    // A 20′ standard is full by space first (2 × 2 × 5 walls = 20 of floor(28 200 / 1 305) = 21): the same 20 + 3, no weight note.
    const twenty = planShipment({ name: 'Tiles', containerType: '20gp', parts: [pallet(23, 1305)] });
    expect(twenty.containers.map((c) => c.pieces.pallet)).toEqual([20, 3]);
    expect(twenty.explanation).not.toContain('Weight');
  });

  it('height is not the goal: what a piece may carry decides how high it is stacked (hand-computed)', () => {
    // 20′ (589 × 235 × 239 cm); cartons 100 × 50 × 50 cm upright, 10 kg each; a wall is 50 cm deep and 2 across.
    const carton = (extra: Partial<ShipmentPart>): ShipmentPart => ({ ...part('c', 1000, 500, 500, 1000, false), mass: 10_000, ...extra });
    const perContainer = (extra: Partial<ShipmentPart>) => planShipment({ name: 'Stack', containerType: '20gp', parts: [carton(extra)] }).containers[0]!.pieces.c!;
    const highest = (extra: Partial<ShipmentPart>) => {
      const p = planShipment({ name: 'Stack', containerType: '20gp', parts: [carton(extra)] }).containers[0]!.project;
      return Math.max(...Object.values(p.items).map((i) => ((i.elevation ?? 0) + mm(500)) / mm(500)));
    };
    // Not stackable: one layer on the floor, 2 across × 11 walls = 22.
    expect(perContainer({ stackable: false })).toBe(22);
    expect(highest({ stackable: false })).toBe(1);
    // A carton takes 30 kg on top: itself plus 3 more = 4 high (200 of 239 cm): 2 × 4 × 11 = 88, as before the limit existed.
    expect(perContainer({ maxLoadOnTop: 30_000 })).toBe(88);
    // 20 kg on top: 3 high → 66. 10 kg on top: 2 high → 44. Less than one carton's weight: 1 high.
    expect(perContainer({ maxLoadOnTop: 20_000 })).toBe(66);
    expect(perContainer({ maxLoadOnTop: 10_000 })).toBe(44);
    expect(perContainer({ maxLoadOnTop: 9_000 })).toBe(22);
    // A stated layer count wins over the default (here 3); the roof still caps it (4 fit).
    expect(perContainer({ maxLayers: 2 })).toBe(44);
    expect(perContainer({ maxLayers: 9 })).toBe(88);
    // The stricter of two statements stands.
    expect(perContainer({ maxLayers: 4, maxLoadOnTop: 10_000 })).toBe(44);
    expect(highest({ maxLayers: 2 })).toBe(2);
    // The planned limit is written into the cargo data, so the container's own load-on-top rule agrees with the plan.
    const loaded = planShipment({ name: 'Stack', containerType: '20gp', parts: [carton({ maxLoadOnTop: 20_000 })] }).containers[0]!.project;
    expect(loaded.catalog.c!.meta).toMatchObject({ stackable: true, maxLoadOnTop: 20_000 });
    expect(new Map(checkContainer(loaded).map((r) => [r.code, r.status])).get('load-on-top')).toBe('pass');
    expect(planShipment({ name: 'Stack', containerType: '20gp', parts: [carton({ stackable: false })] }).containers[0]!.project.catalog.c!.meta).toMatchObject({ stackable: false });
  });

  it('a model is loaded as complete sets: every container holds whole TVs, never a top without its bottom (hand-computed)', () => {
    // 20′ takes 88 upright 100 × 50 × 50 cm boxes (see above). A set is 2 sides + 1 top = 3 boxes: 29 sets = 87 boxes fit, 30 = 90 do not.
    // 400 sides + 200 tops = 200 sets (ratio 2 : 1): 6 containers of 29 sets, the last of the 200 sets takes 200 − 174 = 26.
    const model = (m: string, side: number, top: number): ShipmentPart[] => [{ ...part(`${m}-side`, 1000, 500, 500, side, false), model: m }, { ...part(`${m}-top`, 1000, 500, 500, top, false), model: m }];
    const plan = planShipment({ name: 'Sets', containerType: '20gp', parts: model('tv', 400, 200) });
    expect(plan.containers.map((c) => [c.pieces['tv-side'], c.pieces['tv-top']])).toEqual([[58, 29], [58, 29], [58, 29], [58, 29], [58, 29], [58, 29], [52, 26]]);
    plan.containers.forEach((c, i) => {
      expectSound(c.project);
      expect(c.pieces['tv-side']).toBe(2 * c.pieces['tv-top']!); // whole sets only
      expect(shipmentOf(c.project)).toEqual({ id: 'sets', name: 'Sets', index: i + 1, count: 7 });
      expect(c.project.name).toBe(`Sets · container ${i + 1} of 7`);
    });
    expect(plan.explanation).toContain('every container holds complete sets');
    expect(plan.explanation).toContain('200 sets (2 × tv-side + 1 × tv-top each), 29 per container');
    // Two models never share a container: a model's last container is not topped up with the other model's parts.
    const two = planShipment({ name: 'Two', containerType: '20gp', parts: [...model('a', 40, 20), ...model('b', 30, 15)] });
    expect(two.containers.map((c) => Object.keys(c.pieces).map((id) => id.split('-')[0]).filter((v, k, all) => all.indexOf(v) === k))).toEqual([['a'], ['b']]);
    expect(two.containers.map((c) => c.pieces)).toEqual([{ 'a-side': 40, 'a-top': 20 }, { 'b-side': 30, 'b-top': 15 }]);
    // A part without a model is loaded on its own, after the sets.
    const mixed = planShipment({ name: 'Mixed', containerType: '20gp', parts: [...model('a', 40, 20), part('loose', 1000, 500, 500, 10, false)] });
    expect(mixed.containers.map((c) => c.pieces)).toEqual([{ 'a-side': 40, 'a-top': 20 }, { loose: 10 }]);
    // A model with one part is just that part; a set that does not fit is named, not loaded.
    expect(planShipment({ name: 'One', containerType: '20gp', parts: [{ ...part('x', 1000, 500, 500, 10, false), model: 'm' }] }).containers.map((c) => c.pieces)).toEqual([{ x: 10 }]);
    const big = planShipment({ name: 'Big', containerType: '20gp', parts: [{ ...part('beam', 7000, 100, 100, 5), model: 'm' }, { ...part('plate', 500, 500, 500, 5), model: 'm' }] });
    expect(big.tooBig).toEqual(['beam']);
  });

  it('a piece heavier than the payload is named, not loaded', () => {
    const plan = planShipment({ name: 'Press', containerType: '20gp', parts: [{ ...part('press', 2000, 2000, 2000, 1, false), mass: 30_000_000 }] });
    expect(plan.tooBig).toEqual(['press']);
    expect(plan.containers).toEqual([]);
  });

  it('parts too big for the container are named, not loaded', () => {
    const plan = planShipment({ name: 'Big', containerType: '20gp', parts: [part('beam', 7000, 100, 100, 5), part('box', 500, 500, 500, 1)] });
    expect(plan.tooBig).toEqual(['beam']);
    expect(plan.containers.map((c) => c.pieces)).toEqual([{ box: 1 }]);
  });

  it('a part smaller than a millimetre is named, not loaded (it would divide the container endlessly)', () => {
    const plan = planShipment({ name: 'Tiny', containerType: '40hc', parts: [{ ...part('tiny', 1, 1, 1, 1), length: 0, width: 0, height: 0 }, part('box', 500, 500, 500, 2)] });
    expect(plan.tooBig).toEqual(['tiny']);
    expect(plan.containers.map((c) => c.pieces)).toEqual([{ box: 2 }]);
  });

  it('unstated handling follows the owner roof decision; explicit limits reduce it (hand-computed)', () => {
    // 20 ft: 11 walls of 500 mm, two across, four roof-bounded layers = 88; 100 pieces need 88 + 12.
    const cargo = part('box', 1000, 500, 500, 100, false);
    const plan = planShipment({ name: 'Default', containerType: '20gp', parts: [cargo] });
    expect(plan.containers.map((c) => c.pieces.box)).toEqual([88, 12]);
    plan.containers.forEach((c) => expectSound(c.project));
    // Three layers explicitly requested: 11 × 2 × 3 = 66.
    expect(planShipment({ name: 'Explicit', containerType: '20gp', parts: [{ ...cargo, maxLayers: 3 }] }).containers.map((c) => c.pieces.box)).toEqual([66, 34]);
  });

  it('one 1 mm cube generates a bounded face and loads once', () => {
    const plan = planShipment({ name: 'Tiny supported', containerType: '40hc', parts: [part('tiny', 1, 1, 1, 1)] });
    expect(plan.containers.map((c) => c.pieces)).toEqual([{ tiny: 1 }]);
    expectSound(plan.containers[0]!.project);
  });

  it('dense millimetre cargo exceeding the supported face budget is reported instead of blocking', () => {
    const plan = planShipment({ name: 'Dense', containerType: '40hc', parts: [part('tiny', 1, 1, 1, 200_000)] });
    expect(plan.containers).toEqual([]);
    expect(plan.tooBig).toEqual(['tiny']);
    expect(plan.explanation).toContain('supported planning limits');
  });

  it('unsupported dense complete sets are refused rather than reported as needing extra containers', () => {
    const plan = planShipment({ name: 'Dense sets', containerType: '40hc', parts: [{ ...part('a', 1, 1, 1, 50_000), model: 'M' }, { ...part('b', 1, 1, 1, 50_000), model: 'M' }] });
    expect(plan.containers).toEqual([]);
    expect(plan.unplanned).toEqual(['M']);
    expect(plan.explanation).toContain('supported planning limits');
  });

  it('a model whose complete set does not fit is listed as left out, with the reason', () => {
    const plan = planShipment({ name: 'Set', containerType: '20gp', parts: [{ ...part('a', 4000, 2200, 2200, 1), model: 'M' }, { ...part('b', 4000, 2200, 2200, 1), model: 'M' }] });
    expect(plan.containers).toEqual([]);
    expect(plan.unplanned).toEqual(['M']);
    expect(plan.explanation).toContain('one set does not fit');
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
      layers: fc.option(fc.integer({ min: 1, max: 5 }), { nil: undefined }),
      kg: fc.option(fc.integer({ min: 1, max: 60 }), { nil: undefined }),
    });
    fc.assert(
      fc.property(fc.array(arbPart, { minLength: 1, maxLength: 3 }), fc.constantFrom('20gp', '40gp', '40hc', 'trailer'), (specs, type) => {
        const parts = specs.map((s, i): ShipmentPart => ({ ...part(`p${i}`, s.l, s.w, s.h, s.q, s.tilt), ...(s.layers === undefined ? {} : { maxLayers: s.layers }), ...(s.kg === undefined ? {} : { mass: s.kg * 1000 }) }));
        const plan = planShipment({ name: 'Random', containerType: type, parts });
        for (const p of parts) {
          const loaded = plan.containers.reduce((s, c) => s + (c.pieces[p.id] ?? 0), 0);
          expect(loaded).toBe(plan.tooBig.includes(p.id) ? 0 : p.quantity);
        }
        for (const c of plan.containers) {
          expectSound(c.project);
          // nothing carries more than its type's planned limit (parts that state a mass are checked by the container's own rule)
          expect(new Map(checkContainer(c.project).map((r) => [r.code, r.status])).get('load-on-top')).not.toBe('fail');
          for (const item of Object.values(c.project.items)) if (item.tilt) expect(c.project.catalog[item.definitionId]!.meta?.allowTilt).toBe(true);
        }
        expect(JSON.stringify(planShipment({ name: 'Random', containerType: type, parts }))).toBe(JSON.stringify(plan));
      }),
      { numRuns: 60 },
    );
  }, 60_000); // geometry and property checks run concurrently with the other packs
});
