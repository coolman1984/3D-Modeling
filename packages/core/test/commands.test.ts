import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  apply,
  canRedo,
  canUndo,
  execute,
  redo,
  startHistory,
  undo,
  validateProject,
  type Command,
  type History,
  type Outcome,
  type Project,
} from '../src/index.js';
import { chair, cm, furnishedHall, m, place, referenceHall, table } from './fixtures.js';

function ok(outcome: Outcome): Extract<Outcome, { ok: true }> {
  if (!outcome.ok) throw new Error(`expected success, got ${outcome.rejection.code}: ${outcome.rejection.message}`);
  return outcome;
}

function rejected(outcome: Outcome): string {
  if (outcome.ok) throw new Error('expected rejection');
  return outcome.rejection.code;
}

/** Content without the revision counter, which always moves forward. */
function content(project: Project): Omit<Project, 'revision'> {
  const { revision: _revision, ...rest } = project;
  return rest;
}

describe('item commands', () => {
  it('adds an item and undoes it', () => {
    const hall = furnishedHall();
    const added = ok(apply(hall, { type: 'item.add', item: place('c5', 'def-chair', m(8), m(2)) }));
    expect(added.project.items.c5?.position).toEqual({ x: m(8), y: m(2) });
    expect(added.project.revision).toBe(hall.revision + 1);
    expect(added.inverse).toEqual({ type: 'item.remove', id: 'c5' });
    expect(content(ok(apply(added.project, added.inverse)).project)).toEqual(content(hall));
  });

  it('never modifies the input project', () => {
    const hall = furnishedHall();
    const before = structuredClone(hall);
    apply(hall, { type: 'item.move', id: 't1', to: { x: 0, y: 0 } });
    apply(hall, { type: 'item.remove', id: 'c1' });
    expect(hall).toEqual(before);
  });

  it('moves, rotates and records the way back', () => {
    const hall = furnishedHall();
    const moved = ok(apply(hall, { type: 'item.move', id: 't1', to: { x: m(5), y: m(2) } }));
    expect(moved.inverse).toEqual({ type: 'item.move', id: 't1', to: { x: m(3), y: m(6) } });
    const turned = ok(apply(moved.project, { type: 'item.rotate', id: 't1', to: -90_000 }));
    expect(turned.project.items.t1?.rotation).toBe(270_000);
    expect(turned.inverse).toEqual({ type: 'item.rotate', id: 't1', to: 0 });
  });

  it('protects locked items but lets them be unlocked', () => {
    const locked = ok(apply(furnishedHall(), { type: 'item.lock', id: 't1', locked: true })).project;
    expect(rejected(apply(locked, { type: 'item.move', id: 't1', to: { x: 0, y: 0 } }))).toBe('locked');
    expect(rejected(apply(locked, { type: 'item.rotate', id: 't1', to: 0 }))).toBe('locked');
    expect(rejected(apply(locked, { type: 'item.remove', id: 't1' }))).toBe('locked');
    const unlocked = ok(apply(locked, { type: 'item.lock', id: 't1', locked: false })).project;
    expect(apply(unlocked, { type: 'item.remove', id: 't1' }).ok).toBe(true);
  });

  it('rejects broken data with a reason', () => {
    const hall = furnishedHall();
    expect(rejected(apply(hall, { type: 'item.add', item: place('c1', 'def-chair', 0, 0) }))).toBe('duplicate-id');
    expect(rejected(apply(hall, { type: 'item.add', item: place('door-1', 'def-chair', 0, 0) }))).toBe('duplicate-id');
    expect(rejected(apply(hall, { type: 'item.add', item: place('x', 'def-sofa', 0, 0) }))).toBe('broken-reference');
    expect(rejected(apply(hall, { type: 'item.add', item: place('x', 'def-chair', 0.5, 0) }))).toBe('invalid-payload');
    expect(rejected(apply(hall, { type: 'item.move', id: 'ghost', to: { x: 0, y: 0 } }))).toBe('not-found');
    expect(rejected(apply(hall, { type: 'item.move', id: 't1', to: { x: Number.NaN, y: 0 } }))).toBe('invalid-payload');
    expect(rejected(apply(hall, { type: 'item.move', id: 't1', to: { x: 10_000_001, y: 0 } }))).toBe('invalid-payload');
    expect(rejected(apply(hall, { type: 'item.rotate', id: 't1', to: 0.5 }))).toBe('invalid-payload');
    expect(rejected(apply(hall, { type: 'nope' } as unknown as Command))).toBe('unknown-command');
  });

  it('allows overlaps: they are design issues, not data errors', () => {
    const hall = furnishedHall();
    expect(apply(hall, { type: 'item.move', id: 'c1', to: { x: m(3), y: m(6) } }).ok).toBe(true);
  });
});

describe('catalog commands', () => {
  it('defines, redefines and removes definitions', () => {
    const hall = referenceHall();
    const defined = ok(apply(hall, { type: 'catalog.define', definition: chair }));
    expect(defined.inverse).toEqual({ type: 'catalog.remove', id: 'def-chair' });
    const wider = { ...chair, size: { ...chair.size, w: cm(50) } };
    const redefined = ok(apply(defined.project, { type: 'catalog.define', definition: wider }));
    expect(redefined.inverse).toEqual({ type: 'catalog.define', definition: chair });
    expect(ok(apply(redefined.project, { type: 'catalog.remove', id: 'def-chair' })).project.catalog).toEqual({});
  });

  it('refuses to remove a definition that items still use', () => {
    expect(rejected(apply(furnishedHall(), { type: 'catalog.remove', id: 'def-table' }))).toBe('in-use');
  });

  it('refuses invalid definitions and id clashes', () => {
    const hall = furnishedHall();
    const bad = { ...table, id: 'def-bad', size: { w: 0, d: 1, h: 1 } };
    const outcome = apply(hall, { type: 'catalog.define', definition: bad });
    expect(rejected(outcome)).toBe('invalid-payload');
    expect(!outcome.ok && outcome.rejection.problems?.[0]?.path).toBe('definition.size.w');
    expect(rejected(apply(hall, { type: 'catalog.define', definition: { ...table, id: 't1' } }))).toBe('duplicate-id');
  });
});

describe('space commands', () => {
  it('replaces the space and can put it back', () => {
    const hall = furnishedHall();
    const taller = { ...hall.space, ceilingHeight: m(4) };
    const changed = ok(apply(hall, { type: 'space.set', space: taller }));
    expect(changed.project.space.ceilingHeight).toBe(m(4));
    expect(content(ok(apply(changed.project, changed.inverse)).project)).toEqual(content(hall));
  });

  it('refuses a space that would leave a door off the wall', () => {
    const hall = referenceHall();
    const shrunk = {
      ...hall.space,
      boundary: [
        { x: 0, y: m(1) },
        { x: m(10), y: m(1) },
        { x: m(10), y: m(8) },
        { x: 0, y: m(8) },
      ],
    };
    const outcome = apply(hall, { type: 'space.set', space: shrunk });
    expect(rejected(outcome)).toBe('invalid-payload');
    expect(!outcome.ok && outcome.rejection.problems?.[0]?.code).toBe('door-off-boundary');
  });

  it('refuses a door id already used by an item', () => {
    const hall = furnishedHall();
    const doors = [{ ...hall.space.doors[0]!, id: 't1' }];
    expect(rejected(apply(hall, { type: 'space.set', space: { ...hall.space, doors } }))).toBe('duplicate-id');
  });
});

describe('batches', () => {
  it('applies all commands as one revision with one inverse', () => {
    const hall = furnishedHall();
    const outcome = ok(
      apply(hall, {
        type: 'batch',
        commands: [
          { type: 'item.move', id: 't1', to: { x: m(5), y: m(5) } },
          { type: 'item.remove', id: 'c1' },
          { type: 'item.add', item: place('c9', 'def-chair', m(8), m(1)) },
        ],
      }),
    );
    expect(outcome.project.revision).toBe(hall.revision + 1);
    expect(content(ok(apply(outcome.project, outcome.inverse)).project)).toEqual(content(hall));
  });

  it('is all-or-nothing and says which command failed', () => {
    const outcome = apply(furnishedHall(), {
      type: 'batch',
      commands: [
        { type: 'item.move', id: 't1', to: { x: m(5), y: m(5) } },
        { type: 'batch', commands: [{ type: 'item.remove', id: 'c1' }, { type: 'item.remove', id: 'ghost' }] },
      ],
    });
    expect(outcome.ok).toBe(false);
    expect(!outcome.ok && outcome.rejection.at).toEqual([1, 1]);
  });

  it('rejects an empty batch', () => {
    expect(rejected(apply(furnishedHall(), { type: 'batch', commands: [] }))).toBe('empty-batch');
  });
});

describe('history', () => {
  it('undoes and redoes step by step', () => {
    let h = startHistory(furnishedHall());
    const original = h.project;
    h = expectStep(execute(h, { type: 'item.move', id: 't1', to: { x: m(5), y: m(5) } }));
    const moved = h.project;
    h = expectStep(execute(h, { type: 'item.remove', id: 'c1' }));
    h = expectStep(undo(h));
    expect(content(h.project)).toEqual(content(moved));
    h = expectStep(undo(h));
    expect(content(h.project)).toEqual(content(original));
    expect(canUndo(h)).toBe(false);
    expect(undo(h).ok).toBe(false);
    h = expectStep(redo(h));
    h = expectStep(redo(h));
    expect(h.project.items.c1).toBeUndefined();
    expect(canRedo(h)).toBe(false);
    expect(h.project.revision).toBe(original.revision + 6);
  });

  it('a new command clears redo', () => {
    let h = startHistory(furnishedHall());
    h = expectStep(execute(h, { type: 'item.remove', id: 'c1' }));
    h = expectStep(undo(h));
    h = expectStep(execute(h, { type: 'item.remove', id: 'c2' }));
    expect(canRedo(h)).toBe(false);
  });

  it('a rejected command leaves history unchanged', () => {
    const h = startHistory(furnishedHall());
    const step = execute(h, { type: 'item.remove', id: 'ghost' });
    expect(step.ok).toBe(false);
    expect(step.history).toBe(h);
  });

  it('keeps at most `limit` undo steps', () => {
    let h = startHistory(furnishedHall(), 2);
    for (const id of ['c1', 'c2', 'c3']) h = expectStep(execute(h, { type: 'item.remove', id }));
    expect(h.undoStack).toHaveLength(2);
  });
});

function expectStep(step: ReturnType<typeof execute>): History {
  if (!step.ok) throw new Error(`step failed: ${step.outcome?.rejection.message ?? 'nothing to undo/redo'}`);
  return step.history;
}

describe('property: any command sequence can be fully undone and redone', () => {
  const ids = ['t1', 'c1', 'c2', 'c3', 'c4', 'n1', 'n2', 'n3'];
  const id = fc.constantFrom(...ids);
  const coord = fc.integer({ min: 0, max: m(10) });
  const command: fc.Arbitrary<Command> = fc.oneof(
    fc.record({ type: fc.constant('item.move' as const), id, to: fc.record({ x: coord, y: coord }) }),
    fc.record({ type: fc.constant('item.rotate' as const), id, to: fc.integer({ min: -720_000, max: 720_000 }) }),
    fc.record({ type: fc.constant('item.remove' as const), id }),
    fc.record({ type: fc.constant('item.lock' as const), id, locked: fc.boolean() }),
    fc
      .record({ id, def: fc.constantFrom('def-chair', 'def-table'), x: coord, y: coord })
      .map(({ id, def, x, y }) => ({ type: 'item.add' as const, item: place(id, def, x, y) })),
    fc
      .record({ w: fc.integer({ min: 1, max: m(3) }), front: fc.nat(m(1)) })
      .map(({ w, front }) => ({
        type: 'catalog.define' as const,
        definition: { ...chair, size: { ...chair.size, w }, clearance: { ...chair.clearance, front } },
      })),
    fc.record({ h: fc.integer({ min: m(2), max: m(6) }) }).map(({ h }) => ({
      type: 'space.set' as const,
      space: { ...furnishedHall().space, ceilingHeight: h },
    })),
  );
  const commands = fc.array(fc.oneof({ weight: 5, arbitrary: command }, { weight: 1, arbitrary: fc.array(command, { minLength: 1, maxLength: 4 }).map((cs) => ({ type: 'batch' as const, commands: cs })) }), { minLength: 1, maxLength: 100 });

  it('undo all returns the original; redo all returns the final state; every state stays valid', () => {
    fc.assert(
      fc.property(commands, (sequence) => {
        let h = startHistory(furnishedHall(), 1000);
        const original = h.project;
        for (const c of sequence) {
          const step = execute(h, c);
          h = step.history;
          expect(validateProject(h.project)).toEqual([]);
        }
        const final = h.project;
        const accepted = h.undoStack.length;
        for (let i = 0; i < accepted; i++) h = expectStep(undo(h));
        expect(content(h.project)).toEqual(content(original));
        for (let i = 0; i < accepted; i++) h = expectStep(redo(h));
        expect(content(h.project)).toEqual(content(final));
      }),
      { numRuns: 200 },
    );
  });
});
