import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { apply, deserializeProject, serializeProject, validateProject, type Command, type Outcome, type Project } from '../src/index.js';
import { chair, place, referenceHall } from './fixtures.js';

/**
 * Names every plain object already answers to. An id that happens to be one of them must be
 * treated like any other id: found only when the project really holds it (bugs.md finding 1).
 */
const RESERVED = ['constructor', 'toString', 'valueOf', 'hasOwnProperty', 'isPrototypeOf', '__proto__', 'propertyIsEnumerable', 'toLocaleString'];

const code = (outcome: Outcome) => (outcome.ok ? 'ok' : outcome.rejection.code);

/** An accepted command must leave a project that validates and survives a save and reopen. */
function reopens(project: Project): void {
  expect(validateProject(project)).toEqual([]);
  expect(() => deserializeProject(serializeProject(project))).not.toThrow();
}

describe('ids that are also built-in object names', () => {
  it.each(RESERVED)('placing an item of the missing type "%s" is a broken reference', (name) => {
    const outcome = apply(referenceHall(), { type: 'item.add', item: place('x1', name, 20_000, 20_000) });
    expect(code(outcome)).toBe('broken-reference');
  });

  it.each(RESERVED)('commands on a missing item "%s" are not found', (name) => {
    const hall = referenceHall();
    const commands: Command[] = [
      { type: 'item.move', id: name, to: { x: 10_000, y: 10_000 } },
      { type: 'item.rotate', id: name, to: 90_000 },
      { type: 'item.elevate', id: name, to: 1_000 },
      { type: 'item.lock', id: name, locked: true },
      { type: 'item.tilt', id: name, to: 'x' },
      { type: 'item.meta', id: name, meta: { note: 'x' } },
      { type: 'item.remove', id: name },
      { type: 'catalog.remove', id: name },
    ];
    for (const command of commands) expect(code(apply(hall, command)), command.type).toBe('not-found');
  });

  it.each(RESERVED)('a real type and item named "%s" work like any other and reopen', (name) => {
    let project = referenceHall();
    const define = apply(project, { type: 'catalog.define', definition: { ...chair, id: name } });
    expect(code(define)).toBe('ok');
    if (!define.ok) return;
    // A new definition: undo removes it (not "redefine the built-in").
    expect(define.inverse).toEqual({ type: 'catalog.remove', id: name });
    project = define.project;
    reopens(project);

    const add = apply(project, { type: 'item.add', item: place(`${name}-1`, name, 20_000, 20_000) });
    expect(code(add)).toBe('ok');
    if (!add.ok) return;
    reopens(add.project);
    expect(code(apply(add.project, { type: 'catalog.remove', id: name }))).toBe('in-use');
  });

  it('property: whatever id a command names, an accepted result reopens', () => {
    const id = fc.oneof(fc.constantFrom(...RESERVED), fc.string({ minLength: 1, maxLength: 12 }));
    fc.assert(
      fc.property(id, id, (itemId, definitionId) => {
        const hall = referenceHall();
        for (const command of [
          { type: 'item.add', item: place(itemId, definitionId, 20_000, 20_000) },
          { type: 'item.move', id: itemId, to: { x: 1, y: 1 } },
          { type: 'catalog.define', definition: { ...chair, id: definitionId } },
        ] as Command[]) {
          const outcome = apply(hall, command);
          if (outcome.ok) reopens(outcome.project);
        }
      }),
      { numRuns: 300 },
    );
  });
});
