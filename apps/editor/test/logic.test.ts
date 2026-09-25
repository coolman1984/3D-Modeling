import { checkProject, fromUnit, measureProject, validateProject } from '@space-planner/core';
import { describe, expect, it } from 'vitest';
import { demoHall, newHall } from '@space-planner/starter';
import { formatLength } from '../src/logic/format.js';
import { nextId } from '../src/logic/ids.js';
import { describeIssue } from '../src/logic/messages.js';
import { reduce, startSession, visibleProject } from '../src/logic/session.js';
import { snapPoint } from '../src/logic/snap.js';
import { fitViewport, toScreen, toWorld, zoomAt } from '../src/logic/viewport.js';

const m = (v: number) => fromUnit(v, 'm');
const cm = (v: number) => fromUnit(v, 'cm');

describe('viewport', () => {
  const room = { minX: 0, minY: 0, maxX: m(10), maxY: m(8) };

  it('fits the room, centred, with north up', () => {
    const v = fitViewport(room, 1000, 800, 50);
    expect(v.scale).toBeCloseTo(700 / m(8)); // height limits: (800 - 100) / 8 m
    const southWest = toScreen(v, { x: 0, y: 0 });
    const northEast = toScreen(v, { x: m(10), y: m(8) });
    expect(southWest.y).toBeGreaterThan(northEast.y); // north is up on screen
    expect((southWest.x + northEast.x) / 2).toBeCloseTo(500);
    expect((southWest.y + northEast.y) / 2).toBeCloseTo(400);
  });

  it('converts screen to world and back', () => {
    const v = fitViewport(room, 1000, 800);
    const p = { x: 12_345, y: 67_890 };
    const back = toWorld(v, toScreen(v, p));
    expect(back.x).toBeCloseTo(p.x, 6);
    expect(back.y).toBeCloseTo(p.y, 6);
  });

  it('zooms around the cursor', () => {
    const v = fitViewport(room, 1000, 800);
    const anchor = { x: 300, y: 200 };
    const before = toWorld(v, anchor);
    const after = toWorld(zoomAt(v, 2, anchor), anchor);
    expect(after.x).toBeCloseTo(before.x, 6);
    expect(after.y).toBeCloseTo(before.y, 6);
  });
});

describe('helpers', () => {
  it('snaps to the grid', () => {
    expect(snapPoint({ x: 12_345, y: -12_345 }, cm(5))).toEqual({ x: 12_500, y: -12_500 });
    expect(snapPoint({ x: 12_345.4, y: 7 }, 1)).toEqual({ x: 12_345, y: 7 });
  });

  it('creates readable unique ids', () => {
    expect(nextId('chair', new Set())).toBe('chair-1');
    expect(nextId('chair', new Set(['chair-1', 'chair-2', 'chair-4']))).toBe('chair-3');
  });

  it('formats lengths in Arabic', () => {
    expect(formatLength(cm(45))).toBe('٤٥ سم');
    expect(formatLength(m(1.8))).toBe('١٫٨ م');
  });
});

describe('demo data', () => {
  it('is valid and clean', () => {
    for (const project of [demoHall(), newHall('a', 12, 9, 3), newHall('b', 6, 4)]) {
      expect(validateProject(project)).toEqual([]);
      expect(checkProject(project)).toEqual([]);
    }
    expect(measureProject(demoHall()).floorArea).toBe(m(10) * m(8) - m(0.4) * m(0.4));
  });
});

describe('session', () => {
  const addChair = (id: string, x: number, y: number) =>
    ({
      type: 'command',
      command: { type: 'item.add', item: { id, definitionId: 'chair', position: { x, y }, rotation: 0, locked: false } },
      select: [id],
    }) as const;

  it('adds and selects through commands, and undoes', () => {
    let s = startSession(demoHall());
    s = reduce(s, addChair('chair-1', m(7), m(6)));
    expect(s.selectedIds).toEqual(['chair-1']);
    s = reduce(s, { type: 'undo' });
    expect(s.history.project.items['chair-1']).toBeUndefined();
    expect(s.selectedIds).toEqual([]);
    s = reduce(s, { type: 'redo' });
    expect(s.history.project.items['chair-1']).toBeDefined();
  });

  it('previews a drag without touching history, then commits one move', () => {
    let s = reduce(startSession(demoHall()), addChair('chair-1', m(7), m(6)));
    const revision = s.history.project.revision;
    s = reduce(s, { type: 'preview', command: { type: 'item.move', id: 'chair-1', to: { x: m(1.3), y: m(0.4) } } });
    s = reduce(s, { type: 'preview', command: { type: 'item.move', id: 'chair-1', to: { x: m(1.4), y: m(0.4) } } });
    expect(s.history.project.revision).toBe(revision);
    expect(visibleProject(s).items['chair-1']?.position).toEqual({ x: m(1.4), y: m(0.4) });
    expect(checkProject(visibleProject(s)).map((i) => i.code)).toContain('door-blocked');
    s = reduce(s, { type: 'preview-commit' });
    expect(s.history.project.revision).toBe(revision + 1);
    expect(s.history.undoStack).toHaveLength(2);
    s = reduce(s, { type: 'undo' });
    expect(s.history.project.items['chair-1']?.position).toEqual({ x: m(7), y: m(6) });
  });

  it('a drag that ends where it started records nothing', () => {
    let s = reduce(startSession(demoHall()), addChair('chair-1', m(7), m(6)));
    s = reduce(s, { type: 'preview', command: { type: 'item.move', id: 'chair-1', to: { x: m(7), y: m(6) } } });
    s = reduce(s, { type: 'preview-commit' });
    expect(s.history.undoStack).toHaveLength(1);
  });

  it('keeps the refusal reason when a command is rejected', () => {
    let s = reduce(startSession(demoHall()), addChair('chair-1', m(7), m(6)));
    s = reduce(s, { type: 'command', command: { type: 'item.lock', id: 'chair-1', locked: true } });
    s = reduce(s, { type: 'command', command: { type: 'item.remove', id: 'chair-1' } });
    expect(s.rejection?.code).toBe('locked');
    expect(s.history.project.items['chair-1']).toBeDefined();
  });

  it('describes issues in plain Arabic with amounts', () => {
    let s = reduce(startSession(demoHall()), addChair('chair-1', m(5), m(3.7)));
    const project = s.history.project;
    const [issue] = checkProject(project);
    expect(describeIssue(project, issue!)).toBe('كرسي (chair-1) فوق العمود (column-1) بمقدار ١٢٫٥ سم.');
    s = reduce(s, { type: 'select', ids: ['ghost'] });
    expect(s.selectedIds).toEqual([]);
  });
});

describe('placing new items', () => {
  it('finds the nearest spot that raises no issue, avoiding the column', async () => {
    const { findFreeSpot, fitsFreely } = await import('../src/logic/placement.js');
    let project = demoHall();
    const chair = project.catalog.chair!;
    const centre = { x: m(5), y: m(4) };
    expect(fitsFreely(project, { id: 'x', definitionId: 'chair', position: centre, rotation: 0, locked: false }, chair)).toBe(false);
    for (let n = 1; n <= 30; n++) {
      const item = { id: `chair-${n}`, definitionId: 'chair', rotation: 0, locked: false };
      const position = findFreeSpot(project, item, chair, centre, cm(25));
      project = { ...project, items: { ...project.items, [item.id]: { ...item, position } } };
    }
    expect(checkProject(project)).toEqual([]);
  });
});

describe('saving to the server', () => {
  it('queues every applied change, undo included, in order, and clears what the server saved', () => {
    let s = startSession(demoHall());
    s = reduce(s, { type: 'command', command: { type: 'item.add', item: { id: 'chair-1', definitionId: 'chair', position: { x: m(7), y: m(6) }, rotation: 0, locked: false } } });
    s = reduce(s, { type: 'command', command: { type: 'item.move', id: 'chair-1', to: { x: m(8), y: m(6) } } });
    s = reduce(s, { type: 'undo' });
    expect(s.outbox.map((e) => [e.revision, e.command.type])).toEqual([
      [1, 'item.add'],
      [2, 'item.move'],
      [3, 'item.move'],
    ]);
    expect(s.outbox[2]?.command).toEqual({ type: 'item.move', id: 'chair-1', to: { x: m(7), y: m(6) } });
    s = reduce(s, { type: 'saved', revision: 2 });
    expect(s.outbox.map((e) => e.revision)).toEqual([3]);
  });

  it('does not queue refused commands, and a load from the server starts fresh', () => {
    let s = startSession(demoHall());
    s = reduce(s, { type: 'command', command: { type: 'item.remove', id: 'ghost' } });
    expect(s.outbox).toEqual([]);
    s = reduce(s, { type: 'load', project: { ...demoHall(), revision: 9 } });
    expect(s.history.project.revision).toBe(9);
    expect(s.history.undoStack).toEqual([]);
  });
});
