import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  apply,
  checkProject,
  createProject,
  createSpace,
  deserializeProject,
  measureProject,
  placedSize,
  rectangleBoundary,
  serializeProject,
  toCubicMetres,
  validateProject,
  type ItemDefinition,
  type ItemInstance,
  type Project,
} from '../src/index.js';
import { cm, m } from './fixtures.js';

/** A carton 120 × 80 × 50 cm, 25 kg. */
const carton: ItemDefinition = {
  id: 'carton',
  name: 'Carton',
  category: 'box',
  size: { w: cm(120), d: cm(80), h: cm(50) },
  clearance: { front: 0, back: 0, left: 0, right: 0 },
  mass: 25_000,
  meta: { stackable: true, maxLoadOnTop: 100_000 },
};
const crate: ItemDefinition = { ...carton, id: 'crate', name: 'Crate', mass: 75_000, meta: { fragile: true } };
const mystery: ItemDefinition = { id: 'mystery', name: 'Unweighed', category: 'box', size: { w: cm(50), d: cm(50), h: cm(50) }, clearance: { front: 0, back: 0, left: 0, right: 0 } };

const put = (id: string, definitionId: string, x: number, y: number, extra: Partial<ItemInstance> = {}): ItemInstance => ({ id, definitionId, position: { x, y }, rotation: 0, locked: false, ...extra });

/** A 20-foot container inside: 5.90 × 2.35 m, 2.39 m high. */
function box20(items: ItemInstance[]): Project {
  const base = createProject('c20', 'Container', createSpace(rectangleBoundary(cm(590), cm(235)), { ceilingHeight: cm(239) }));
  return { ...base, catalog: { carton, crate, mystery }, items: Object.fromEntries(items.map((i) => [i.id, i])) };
}

describe('lying items (tilt)', () => {
  it('swaps height with the axis that points up', () => {
    expect(placedSize(put('a', 'carton', 0, 0), carton)).toEqual({ w: cm(120), d: cm(80), h: cm(50) });
    expect(placedSize(put('a', 'carton', 0, 0, { tilt: 'x' }), carton)).toEqual({ w: cm(50), d: cm(80), h: cm(120) });
    expect(placedSize(put('a', 'carton', 0, 0, { tilt: 'y' }), carton)).toEqual({ w: cm(120), d: cm(50), h: cm(80) });
  });

  it('checks the height as placed: stood on end at 1.30 m up, the carton pokes 11 cm through a 2.39 m roof', () => {
    // Underside 130 cm + 120 cm standing height = 250 cm; roof 239 cm → 11 cm too tall.
    const p = box20([put('a', 'carton', cm(100), cm(100), { tilt: 'x', elevation: cm(130) })]);
    expect(checkProject(p)).toEqual([{ code: 'too-tall', severity: 'error', entityIds: ['a'], amount: cm(11) }]);
    const flat = box20([put('a', 'carton', cm(100), cm(100), { elevation: cm(130) })]);
    expect(checkProject(flat)).toEqual([]);
  });

  it('boxes stacked exactly on top of each other do not overlap; a box sunk 1 cm into another does', () => {
    const stack = box20([put('a', 'carton', cm(100), cm(100)), put('b', 'carton', cm(100), cm(100), { elevation: cm(50) })]);
    expect(checkProject(stack)).toEqual([]);
    const sunk = box20([put('a', 'carton', cm(100), cm(100)), put('b', 'carton', cm(100), cm(100), { elevation: cm(49) })]);
    expect(checkProject(sunk).map((i) => i.code)).toEqual(['overlap']);
  });

  it('item.tilt lays an item down, its inverse stands it up again, and a locked item refuses', () => {
    const p = box20([put('a', 'carton', cm(100), cm(100))]);
    const laid = apply(p, { type: 'item.tilt', id: 'a', to: 'y' });
    expect(laid.ok && laid.project.items.a!.tilt).toBe('y');
    if (!laid.ok) return;
    const back = apply(laid.project, laid.inverse);
    expect(back.ok && back.project.items.a).toEqual(p.items.a);
    expect(apply(p, { type: 'item.tilt', id: 'a', to: 'z' as never }).ok).toBe(false);
    const locked = box20([put('a', 'carton', 0, 0, { locked: true })]);
    expect(apply(locked, { type: 'item.tilt', id: 'a', to: 'x' })).toMatchObject({ ok: false, rejection: { code: 'locked' } });
  });
});

describe('pack data (meta)', () => {
  it('item.meta replaces the map, even on a locked item, and undoes exactly', () => {
    const p = box20([put('a', 'carton', 0, 0, { locked: true, meta: { stop: 'Alex' } })]);
    const set = apply(p, { type: 'item.meta', id: 'a', meta: { stop: 'Cairo', step: 3 } });
    expect(set.ok && set.project.items.a!.meta).toEqual({ stop: 'Cairo', step: 3 });
    if (!set.ok) return;
    const undone = apply(set.project, set.inverse);
    expect(undone.ok && undone.project.items.a).toEqual(p.items.a);
    const cleared = apply(p, { type: 'item.meta', id: 'a', meta: null });
    expect(cleared.ok && 'meta' in cleared.project.items.a!).toBe(false);
  });

  it('refuses meta that is empty, too big, nested or not a finite number', () => {
    const p = box20([put('a', 'carton', 0, 0)]);
    const bad: unknown[] = [{}, { x: [1] }, { x: { y: 1 } }, { x: Number.NaN }, { ['k'.repeat(65)]: 1 }, { x: 's'.repeat(201) }, Object.fromEntries(Array.from({ length: 33 }, (_, i) => [`k${i}`, i]))];
    for (const meta of bad) expect(apply(p, { type: 'item.meta', id: 'a', meta: meta as never }).ok).toBe(false);
    expect(validateProject({ ...p, catalog: { ...p.catalog, carton: { ...carton, mass: 1.5 } } }).map((x) => x.path)).toEqual(['catalog.carton.mass']);
  });
});

describe('mass and centre of mass', () => {
  it('adds up mass and finds the centre of mass by hand', () => {
    // Carton 25 kg on the floor at x = 1 m (centre height 25 cm); crate 75 kg at x = 5 m raised 50 cm (centre 75 cm).
    // x = (25·1 + 75·5) / 100 = 4 m; z = (25·25 + 75·75) / 100 = 62.5 cm → 6250 ticks; y = 1 m for both.
    const p = box20([put('a', 'carton', m(1), m(1)), put('b', 'crate', m(5), m(1), { elevation: cm(50) })]);
    const metrics = measureProject(p);
    expect(metrics.mass).toBe(100_000);
    expect(metrics.centreOfMass).toEqual({ x: m(4), y: m(1), z: 6250 });
    // Two 1.2 × 0.8 × 0.5 m boxes = 0.96 m³.
    expect(toCubicMetres(metrics.itemVolume)).toBeCloseTo(0.96, 9);
    expect(metrics.massUnknown).toBe(0);
  });

  it('reports mass as unknown, not zero, when one type has no mass', () => {
    const metrics = measureProject(box20([put('a', 'carton', m(1), m(1)), put('c', 'mystery', m(3), m(1))]));
    expect(metrics.mass).toBeUndefined();
    expect(metrics.centreOfMass).toBeUndefined();
    expect(metrics.massUnknown).toBe(1);
  });
});

describe('saves', () => {
  it('round-trips the new fields byte for byte', () => {
    fc.assert(
      fc.property(
        fc.dictionary(fc.string({ minLength: 1, maxLength: 10 }).filter((k) => k !== '__proto__'), fc.oneof(fc.string({ maxLength: 20 }), fc.integer(), fc.boolean()), { minKeys: 1, maxKeys: 5 }),
        fc.constantFrom<'x' | 'y' | undefined>('x', 'y', undefined),
        (meta, tilt) => {
          const p = box20([put('a', 'carton', m(1), m(1), { meta, ...(tilt ? { tilt } : {}) })]);
          const text = serializeProject(p);
          const opened = deserializeProject(text);
          expect(opened.ok).toBe(true);
          if (opened.ok) expect(serializeProject(opened.project)).toBe(text);
        },
      ),
    );
  });
});
