import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { apply, diffCommands, serializeProject, type Command, type Project } from '../src/index.js';
import { chair, cm, furnishedHall, m, place, referenceHall, table } from './fixtures.js';

/** `from` after the diff, with `to`'s content and `from`'s identity. */
function adopt(from: Project, to: Project): Project {
  const commands = diffCommands(from, to);
  if (commands.length === 0) return from;
  const r = apply(from, { type: 'batch', commands });
  if (!r.ok) throw new Error(JSON.stringify(r.rejection));
  return r.project;
}
const content = (p: Project) => serializeProject({ ...p, id: 'x', name: 'x', revision: 0 });

describe('diffCommands', () => {
  it('is empty between equal projects', () => {
    expect(diffCommands(furnishedHall(), furnishedHall())).toEqual([]);
  });

  it('by hand: move one chair, lock the table, add a column', () => {
    const from = furnishedHall();
    const col = { id: 'col-2', kind: 'column' as const, polygon: [{ x: m(8), y: m(1) }, { x: m(8.4), y: m(1) }, { x: m(8.4), y: m(1.4) }, { x: m(8), y: m(1.4) }] };
    const moved = apply(from, { type: 'batch', commands: [
      { type: 'item.move', id: 'c1', to: { x: m(2), y: m(2) } },
      { type: 'item.lock', id: 't1', locked: true },
      { type: 'space.set', space: { ...from.space, obstacles: [...from.space.obstacles, col] } },
    ] });
    if (!moved.ok) throw new Error('setup');
    const to = moved.project;
    expect(diffCommands(from, to).map((c) => c.type + ('id' in c ? `:${c.id}` : ''))).toEqual(['item.remove:c1', 'item.remove:t1', 'space.set', 'item.add', 'item.add']);
    expect(content(adopt(from, to))).toBe(content(to));
    // Back the other way: the locked table is unlocked before it is removed.
    expect(diffCommands(to, from).slice(0, 3).map((c) => c.type)).toEqual(['item.remove', 'item.lock', 'item.remove']);
    expect(content(adopt(to, from))).toBe(content(from));
  });

  it('turns any variant back into its base and forward again (random edits)', () => {
    const edit = fc.oneof(
      fc.record({ kind: fc.constant('move' as const), k: fc.nat(10), x: fc.integer({ min: 50, max: 950 }), y: fc.integer({ min: 50, max: 750 }) }),
      fc.record({ kind: fc.constant('remove' as const), k: fc.nat(10) }),
      fc.record({ kind: fc.constant('add' as const), x: fc.integer({ min: 50, max: 950 }), y: fc.integer({ min: 50, max: 750 }) }),
      fc.record({ kind: fc.constant('lock' as const), k: fc.nat(10) }),
      fc.record({ kind: fc.constant('resize' as const), w: fc.integer({ min: 30, max: 200 }) }),
    );
    fc.assert(
      fc.property(fc.array(edit, { maxLength: 12 }), (edits) => {
        const base = furnishedHall();
        let p = base;
        let n = 0;
        for (const e of edits) {
          const ids = Object.keys(p.items).sort();
          let c: Command | null = null;
          if (e.kind === 'move' && ids.length) c = { type: 'item.move', id: ids[e.k % ids.length]!, to: { x: cm(e.x), y: cm(e.y) } };
          if (e.kind === 'remove' && ids.length) c = { type: 'item.remove', id: ids[e.k % ids.length]! };
          if (e.kind === 'lock' && ids.length) c = { type: 'item.lock', id: ids[e.k % ids.length]!, locked: true };
          if (e.kind === 'add') c = { type: 'item.add', item: place(`extra-${n++}`, 'def-chair', cm(e.x), cm(e.y)) };
          if (e.kind === 'resize') c = { type: 'catalog.define', definition: { ...table, size: { ...table.size, w: cm(e.w) } } };
          if (!c) continue;
          const r = apply(p, c);
          if (r.ok) p = r.project;
        }
        expect(content(adopt(base, p))).toBe(content(p));
        expect(content(adopt(p, base))).toBe(content(base));
      }),
      { numRuns: 120 },
    );
  });

  it('works across projects with different catalogs (empty hall ← furnished hall)', () => {
    const empty = referenceHall();
    const full = furnishedHall();
    expect(content(adopt(empty, full))).toBe(content(full));
    expect(content(adopt(full, empty))).toBe(content(empty));
    expect(Object.keys(full.catalog).sort()).toEqual([chair.id, table.id].sort());
  });
});
