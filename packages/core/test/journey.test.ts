import { describe, expect, it } from 'vitest';
import {
  checkProject,
  createProject,
  createSpace,
  deserializeProject,
  execute,
  fromUnit,
  hasErrors,
  measureProject,
  rectangleBoundary,
  serializeProject,
  startHistory,
  toSquareMetres,
  undo,
  type Command,
  type History,
} from '../src/index.js';
import { chair, cm, m, place, table } from './fixtures.js';

function run(history: History, command: Command): History {
  const step = execute(history, command);
  if (!step.ok) throw new Error(step.outcome?.rejection.message);
  return step.history;
}

/** The core's definition of done: a complete user journey using only the public API. */
describe('end-to-end journey', () => {
  it('plans a hall, finds a mistake, fixes it, undoes, saves and reopens identically', () => {
    // 1. An empty 12 m × 9 m hall with a door and a 3 m ceiling.
    const hall = createProject(
      'wedding-hall',
      'Wedding hall',
      createSpace(rectangleBoundary(fromUnit(12, 'm'), fromUnit(9, 'm')), {
        doors: [{ id: 'main-door', hinge: { x: m(5), y: 0 }, width: cm(100), angle: 0, swing: 'left' }],
        ceilingHeight: m(3),
      }),
    );
    let h = startHistory(hall);

    // 2. Stock the catalog and place two tables with chairs in one step.
    h = run(h, { type: 'catalog.define', definition: table });
    h = run(h, { type: 'catalog.define', definition: chair });
    const setTable = (n: number, x: number, y: number): Command => ({
      type: 'batch',
      commands: [
        { type: 'item.add', item: place(`t${n}`, table.id, x, y) },
        { type: 'item.add', item: place(`t${n}-a`, chair.id, x - cm(50), y + cm(70), 180_000) },
        { type: 'item.add', item: place(`t${n}-b`, chair.id, x + cm(50), y + cm(70), 180_000) },
        { type: 'item.add', item: place(`t${n}-c`, chair.id, x - cm(50), y - cm(70)) },
        { type: 'item.add', item: place(`t${n}-d`, chair.id, x + cm(50), y - cm(70)) },
      ],
    });
    h = run(h, setTable(1, m(3), m(6)));
    h = run(h, setTable(2, m(8), m(6)));
    expect(checkProject(h.project)).toEqual([]);

    // 3. A careless move puts a chair in the door's path, its back to the wall: the core reports both.
    h = run(h, { type: 'item.move', id: 't1-c', to: { x: m(5.4), y: m(0.4) } });
    const issues = checkProject(h.project);
    expect(issues.map((i) => `${i.code}:${i.entityIds.join('+')}`)).toEqual([
      'door-blocked:t1-c+main-door',
      'clearance:t1-c',
    ]);
    expect(hasErrors(issues)).toBe(true);

    // 4. Undo fixes it.
    const step = undo(h);
    expect(step.ok).toBe(true);
    h = step.history;
    expect(checkProject(h.project)).toEqual([]);

    // 5. The numbers a customer asks for.
    const metrics = measureProject(h.project);
    expect(metrics.seats).toBe(8);
    expect(metrics.bom.map((line) => `${line.count} × ${line.name}`)).toEqual([
      `8 × ${chair.name}`,
      `2 × ${table.name}`,
    ]);
    expect(toSquareMetres(metrics.floorArea)).toBe(108);

    // 6. Save, reopen, and get exactly the same plan, issues and numbers.
    const text = serializeProject(h.project);
    const reopened = deserializeProject(text);
    expect(reopened.ok).toBe(true);
    if (!reopened.ok) return;
    expect(reopened.project).toEqual(h.project);
    expect(checkProject(reopened.project)).toEqual(checkProject(h.project));
    expect(measureProject(reopened.project)).toEqual(metrics);
    expect(serializeProject(reopened.project)).toBe(text);
  });
});
