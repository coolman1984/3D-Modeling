import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { apply, checkProject, deserializeProject, serializeProject, validateSpace, type Space, type Vec2, type Zone } from '../src/index.js';
import { cm, m, referenceHall } from './fixtures.js';

const square = (x: number, y: number, size: number): Vec2[] => [
  { x, y },
  { x: x + size, y },
  { x: x + size, y: y + size },
  { x, y: y + size },
];
const dock: Zone = { id: 'dock-1', kind: 'dock', name: 'Dock 1', polygon: square(m(1), m(1), m(2)) };

describe('zones', () => {
  it('are set with the space, validated, undone, and change no design check', () => {
    const p = referenceHall();
    const set = apply(p, { type: 'space.set', space: { ...p.space, zones: [dock] } });
    expect(set.ok).toBe(true);
    if (!set.ok) return;
    expect(set.project.space.zones).toEqual([dock]);
    // A zone blocks nothing by itself: the reference hall still has no issues.
    expect(checkProject(set.project)).toEqual(checkProject(p));
    const back = apply(set.project, set.inverse);
    expect(back.ok && 'zones' in back.project.space).toBe(false);
  });

  it('reject broken data: empty list, clockwise, blank kind, long name, duplicate ids, taken ids', () => {
    const base = referenceHall().space;
    const bad = (zones: unknown): string[] => validateSpace({ ...base, zones } as unknown as Space).map((x) => x.code);
    expect(bad([])).toContain('missing');
    expect(bad([{ ...dock, polygon: [...dock.polygon].reverse() }])).toContain('not-counter-clockwise');
    expect(bad([{ ...dock, kind: '' }])).toContain('missing');
    expect(bad([{ ...dock, name: 'x'.repeat(201) }])).toContain('wrong-type');
    expect(bad([dock, { ...dock, kind: 'staging' }])).toContain('duplicate-id');
    expect(bad([{ ...dock, colour: 'red' }])).toContain('unknown-field');
    expect(bad([{ ...dock, meta: {} }])).toContain('invalid-meta');
    expect(bad([{ ...dock, id: 'door-1' }])).toContain('duplicate-id'); // a door of the same space
    const p = referenceHall();
    const clash = apply(p, { type: 'space.set', space: { ...p.space, zones: [{ ...dock, id: p.id }] } });
    expect(!clash.ok && clash.rejection.code).toBe('duplicate-id');
    // …and later commands cannot reuse a zone's id either.
    const zoned = apply(p, { type: 'space.set', space: { ...p.space, zones: [dock] } });
    if (!zoned.ok) throw new Error('zone not set');
    const def = apply(zoned.project, { type: 'catalog.define', definition: { id: 'dock-1', name: 'Pallet', category: 'pallet', size: { w: cm(120), d: cm(80), h: cm(15) }, clearance: { front: 0, back: 0, left: 0, right: 0 } } });
    expect(!def.ok && def.rejection.code).toBe('duplicate-id');
  });

  it('round-trip through a save, whatever their kinds and names', () => {
    const zone = fc.record({
      kind: fc.string({ minLength: 1, maxLength: 64 }),
      name: fc.option(fc.string({ maxLength: 200 }), { nil: undefined }),
      x: fc.integer({ min: 0, max: 800 }),
      y: fc.integer({ min: 0, max: 600 }),
      size: fc.integer({ min: 1, max: 200 }),
    });
    fc.assert(
      fc.property(fc.array(zone, { minLength: 1, maxLength: 6 }), (specs) => {
        const p = referenceHall();
        const zones: Zone[] = specs.map((s, i) => ({ id: `zone-${i}`, kind: s.kind, ...(s.name === undefined ? {} : { name: s.name }), polygon: square(cm(s.x), cm(s.y), cm(s.size)) }));
        const set = apply(p, { type: 'space.set', space: { ...p.space, zones } });
        expect(set.ok).toBe(true);
        if (!set.ok) return;
        const text = serializeProject(set.project);
        expect(deserializeProject(text)).toEqual({ ok: true, project: set.project });
      }),
      { numRuns: 80 },
    );
  });
});
