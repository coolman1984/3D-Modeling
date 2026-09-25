import { apply, fromUnit, type Command, type Project } from '@space-planner/core';
import { demoHall } from '@space-planner/starter';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { acceleratedStep, DEFAULT_CONTROLS, keyIntent, sanitizeControls } from '../src/logic/controls.js';
import { reduce, startSession } from '../src/logic/session.js';
import { snapAngle, snapMove } from '../src/logic/snap.js';
import {
  alignCommands,
  distributeCommands,
  duplicateCommands,
  elevateCommands,
  itemsInBox,
  moveCommands,
  rotateCommands,
  selectionBounds,
} from '../src/logic/transform.js';

const m = (v: number) => fromUnit(v, 'm');
const cm = (v: number) => fromUnit(v, 'cm');

/** The 10 × 8 m demo hall with 45 cm chairs placed at the given centres (metres). */
function hall(...chairs: Array<[string, number, number]>): Project {
  let project = demoHall();
  for (const [id, x, y] of chairs) project = run(project, { type: 'item.add', item: { id, definitionId: 'chair', position: { x: m(x), y: m(y) }, rotation: 0, locked: false } });
  return project;
}

function run(project: Project, command: Command | null): Project {
  if (!command) return project;
  const result = apply(project, command);
  if (!result.ok) throw new Error(result.rejection.message);
  return result.project;
}

const at = (p: Project, id: string) => p.items[id]!.position;

describe('moving a selection', () => {
  it('moves every selected item by the same amount, skipping locked ones, as one command', () => {
    let p = hall(['a', 2, 2], ['b', 3, 2], ['c', 4, 2]);
    p = run(p, { type: 'item.lock', id: 'c', locked: true });
    const command = moveCommands(p, ['a', 'b', 'c'], { x: cm(10), y: -cm(5) });
    expect(command?.type).toBe('batch');
    p = run(p, command);
    expect(at(p, 'a')).toEqual({ x: m(2.1), y: m(1.95) });
    expect(at(p, 'b')).toEqual({ x: m(3.1), y: m(1.95) });
    expect(at(p, 'c')).toEqual({ x: m(4), y: m(2) });
    expect(moveCommands(p, ['a'], { x: 0.4, y: -0.4 })).toBeNull(); // rounds to nothing
  });

  it('turns a group about its centre: two chairs 2 m apart, a quarter turn', () => {
    // Centre of the pair is (3, 2); a quarter turn counter-clockwise sends (2, 2) to (3, 1).
    const p = run(hall(['a', 2, 2], ['b', 4, 2]), rotateCommands(hall(['a', 2, 2], ['b', 4, 2]), ['a', 'b'], 90_000));
    expect(at(p, 'a')).toEqual({ x: m(3), y: m(1) });
    expect(at(p, 'b')).toEqual({ x: m(3), y: m(3) });
    expect(p.items.a!.rotation).toBe(90_000);
  });

  it('turns one item in place and treats a full turn as nothing', () => {
    const p = hall(['a', 2, 2]);
    expect(rotateCommands(p, ['a'], -90_000)).toEqual({ type: 'item.rotate', id: 'a', to: 270_000 });
    expect(rotateCommands(p, ['a'], 360_000)).toBeNull();
  });

  it('raises and lowers, never below the floor', () => {
    let p = hall(['a', 2, 2], ['b', 3, 2]);
    p = run(p, elevateCommands(p, ['a'], cm(30)));
    p = run(p, elevateCommands(p, ['a', 'b'], -cm(50)));
    expect(p.items.a!.elevation).toBeUndefined();
    expect(elevateCommands(p, ['a', 'b'], -cm(5))).toBeNull();
  });

  it('lines up west edges and spreads three items evenly', () => {
    let p = hall(['a', 2, 2], ['b', 4, 3]);
    p = run(p, alignCommands(p, ['a', 'b'], 'west'));
    expect(at(p, 'b')).toEqual({ x: m(2), y: m(3) });
    // Chairs at x = 1, 2, 5 (45 cm wide): the outer edges span 0.775 → 5.225 m; the 3.1 m of
    // free space splits into two 1.55 m gaps, so the middle chair's centre goes to 3 m.
    let q = hall(['a', 1, 2], ['b', 2, 2], ['c', 5, 2]);
    q = run(q, distributeCommands(q, ['c', 'a', 'b'], 'x'));
    expect([at(q, 'a').x, at(q, 'b').x, at(q, 'c').x]).toEqual([m(1), m(3), m(5)]);
    expect(distributeCommands(q, ['a', 'b'], 'x')).toBeNull();
  });

  it('duplicates with fresh ids and selects the copies', () => {
    const p = hall(['chair-1', 2, 2]);
    const copy = duplicateCommands(p, ['chair-1'], { x: cm(50), y: -cm(50) });
    expect(copy.ids).toEqual(['chair-2']);
    const q = run(p, copy.command);
    expect(at(q, 'chair-2')).toEqual({ x: m(2.5), y: m(1.5) });
  });

  it('box-selects items whose outline touches the box', () => {
    const p = hall(['a', 2, 2], ['b', 4, 2], ['c', 8, 6]);
    // The box reaches x = 3.8 m, just past b's west edge at 3.775 m.
    expect(itemsInBox(p, { minX: m(1), minY: m(1), maxX: m(3.8), maxY: m(3) })).toEqual(['a', 'b']);
    expect(itemsInBox(p, { minX: m(1), minY: m(1), maxX: m(3.7), maxY: m(3) })).toEqual(['a']);
  });

  it('property: moving by d then by -d, or turning by a then -a, gives the start back', () => {
    const coord = fc.integer({ min: -m(3), max: m(3) });
    fc.assert(
      fc.property(coord, coord, fc.integer({ min: -359_999, max: 359_999 }), (dx, dy, turn) => {
        const start = hall(['a', 2, 2], ['b', 4, 3], ['c', 6, 5]);
        const ids = ['a', 'b', 'c'];
        const moved = run(run(start, moveCommands(start, ids, { x: dx, y: dy })), null);
        const back = run(moved, moveCommands(moved, ids, { x: -dx, y: -dy }));
        expect(back.items).toEqual(start.items);
        const pivot = { x: m(4), y: m(3) };
        const turned = run(start, rotateCommands(start, ids, turn, pivot));
        const returned = run(turned, rotateCommands(turned, ids, -turn, pivot));
        for (const id of ids) {
          // Positions are rounded to whole ticks each way: at most one tick off.
          expect(Math.abs(at(returned, id).x - at(start, id).x)).toBeLessThanOrEqual(1);
          expect(Math.abs(at(returned, id).y - at(start, id).y)).toBeLessThanOrEqual(1);
          expect(returned.items[id]!.rotation).toBe(0);
        }
      }),
      { numRuns: 150 },
    );
  });
});

describe('snapping while dragging', () => {
  const options = { grid: cm(5), guides: true, threshold: cm(5) };

  it("jumps onto a neighbour's edge and centre line and reports the guides", () => {
    const p = hall(['a', 2, 2], ['b', 4, 2]);
    // Dragging a 1.53 m east brings its east edge to 3.755 m, 2 cm short of b's west edge at
    // 3.775 m: it jumps the 2 cm. The 1.3 cm drift north is pulled back onto b's lines.
    const { delta, guides } = snapMove(p, ['a'], { x: m(1.53), y: m(0.013) }, options);
    expect(delta).toEqual({ x: m(1.55), y: 0 });
    expect(guides.filter((g) => g.axis === 'x').map((g) => g.at)).toEqual([m(3.775)]);
    expect(guides.filter((g) => g.axis === 'y').map((g) => g.at)).toEqual([m(1.775), m(2), m(2.225)]);
  });

  it('picks the nearest guide when several are within reach', () => {
    // With a 30 cm reach both b's west edge (2 cm away) and b's centre (24.5 cm away) qualify.
    const p = hall(['a', 2, 2], ['b', 4, 5]);
    expect(snapMove(p, ['a'], { x: m(1.53), y: 0 }, { ...options, threshold: cm(30) }).delta.x).toBe(m(1.55));
  });

  it('falls back to the grid for the leading item, and can lock one axis', () => {
    const p = hall(['a', 2, 2], ['b', 4, 5]);
    const noGuides = { ...options, guides: false };
    expect(snapMove(p, ['a'], { x: m(1.542), y: m(0.3) }, noGuides).delta).toEqual({ x: m(1.55), y: m(0.3) });
    expect(snapMove(p, ['a'], { x: m(1.542), y: m(0.3) }, noGuides, 'x').delta).toEqual({ x: m(1.55), y: 0 });
    expect(snapMove(p, ['a'], { x: 1234, y: -77 }, { ...noGuides, grid: 1 }).delta).toEqual({ x: 1234, y: -77 });
  });

  it('snaps angles to the step', () => {
    expect(snapAngle(52_000, 15_000)).toBe(45_000);
    expect(snapAngle(-8_000, 15_000)).toBe(-15_000);
    expect(snapAngle(12_345, 1)).toBe(12_345);
  });

  it('selection bounds cover every selected outline', () => {
    expect(selectionBounds(hall(['a', 2, 2], ['b', 4, 3]), ['a', 'b'])).toEqual({ minX: m(1.775), minY: m(1.775), maxX: m(4.225), maxY: m(3.225) });
    expect(selectionBounds(hall(), [])).toBeNull();
  });
});

describe('selection', () => {
  it('replaces, adds and toggles, and drops ids that do not exist', () => {
    let s = startSession(hall(['a', 2, 2], ['b', 4, 2], ['c', 6, 2]));
    s = reduce(s, { type: 'select', ids: ['a'] });
    s = reduce(s, { type: 'select', ids: ['b'], mode: 'add' });
    expect(s.selectedIds).toEqual(['a', 'b']);
    s = reduce(s, { type: 'select', ids: ['a', 'c'], mode: 'toggle' });
    expect(s.selectedIds).toEqual(['b', 'c']);
    s = reduce(s, { type: 'select', ids: ['ghost', 'c'] });
    expect(s.selectedIds).toEqual(['c']);
  });

  it('a cancelled preview leaves no trace', () => {
    let s = startSession(hall(['a', 2, 2]));
    s = reduce(s, { type: 'preview', command: { type: 'item.move', id: 'a', to: { x: m(5), y: m(5) } } });
    s = reduce(s, { type: 'preview-cancel' });
    s = reduce(s, { type: 'preview-commit' });
    expect(s.history.undoStack).toHaveLength(0);
    expect(s.outbox).toHaveLength(0);
  });
});

describe('precision and speed settings', () => {
  it('keeps valid values and replaces broken ones with defaults', () => {
    const s = sanitizeControls({ grid: cm(2), step: -5, dragSpeed: 9, guides: false, fineDragSpeed: 'fast', extra: 1 });
    expect(s).toEqual({ ...DEFAULT_CONTROLS, grid: cm(2), guides: false });
    expect(sanitizeControls(null)).toEqual(DEFAULT_CONTROLS);
  });

  it('maps keys: arrows by step, Shift big, Alt fine; Arabic letters too', () => {
    const k = (key: string, mods: Partial<{ ctrl: boolean; shift: boolean; alt: boolean }> = {}) => keyIntent({ key, ctrl: false, shift: false, alt: false, ...mods }, DEFAULT_CONTROLS);
    expect(k('ArrowUp')).toEqual({ kind: 'nudge', dx: 0, dy: cm(1) });
    expect(k('ArrowLeft', { shift: true })).toEqual({ kind: 'nudge', dx: -cm(10), dy: 0 });
    expect(k('ArrowRight', { alt: true })).toEqual({ kind: 'nudge', dx: fromUnit(1, 'mm'), dy: 0 });
    expect(k('PageUp')).toEqual({ kind: 'raise', dz: cm(5) });
    expect(k('r')).toEqual({ kind: 'rotate', by: -90_000 });
    expect(k('ق', { shift: true })).toEqual({ kind: 'rotate', by: 90_000 });
    expect(k(']')).toEqual({ kind: 'rotate', by: -15_000 });
    expect(k('[', { alt: true })).toEqual({ kind: 'rotate', by: 1_000 });
    expect(k('z', { ctrl: true })).toEqual({ kind: 'undo' });
    expect(k('Z', { ctrl: true, shift: true })).toEqual({ kind: 'redo' });
    expect(k('d', { ctrl: true })).toEqual({ kind: 'duplicate' });
    expect(k('q')).toBeNull();
  });

  it('a held key starts steady, then speeds up, up to twenty times', () => {
    expect(acceleratedStep(10, 0, 1)).toBe(10);
    expect(acceleratedStep(10, 4, 1)).toBe(10);
    expect(acceleratedStep(10, 14, 1)).toBe(25);
    expect(acceleratedStep(10, 1000, 5)).toBe(200);
    expect(acceleratedStep(10, 100, 0)).toBe(10);
  });
});
