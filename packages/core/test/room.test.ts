import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { apply, readRoom, roomProblems, roomSpace, validateSpace, type RoomSpec } from '../src/index.js';
import { cm, m, referenceHall } from './fixtures.js';

const spec: RoomSpec = {
  width: m(12),
  depth: m(9),
  ceilingHeight: m(3),
  doors: [
    { id: 'd-s', wall: 'south', offset: m(1), width: cm(90) },
    { id: 'd-n', wall: 'north', offset: m(5), width: cm(160) },
    { id: 'd-w', wall: 'west', offset: m(2), width: cm(90) },
    { id: 'd-e', wall: 'east', offset: m(7), width: cm(90) },
  ],
  columns: [{ id: 'c-1', center: { x: m(6), y: m(4.5) }, width: cm(40), depth: cm(60) }],
};

describe('room spec', () => {
  it('builds a valid space whose doors open into the room', () => {
    const space = roomSpace(spec);
    expect(validateSpace(space)).toEqual([]);
    expect(roomProblems(spec)).toEqual([]);
    // North door hinge at (5 m, 9 m); its leaf opens clockwise from east, i.e. southward.
    expect(space.doors[1]).toMatchObject({ hinge: { x: m(5), y: m(9) }, angle: 0, swing: 'right' });
  });

  it('round-trips through the space', () => {
    expect(readRoom(roomSpace(spec))).toEqual(spec);
    expect(readRoom(referenceHall().space)).toMatchObject({ width: m(10), depth: m(8), doors: [{ wall: 'south', offset: m(1) }] });
  });

  it('round-trips any sensible rectangle', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: m(2), max: m(60) }),
        fc.integer({ min: m(2), max: m(60) }),
        fc.constantFrom('south', 'north', 'west', 'east' as const),
        fc.double({ min: 0, max: 1, noNaN: true }),
        (width, depth, wall, t) => {
          const length = wall === 'south' || wall === 'north' ? width : depth;
          const offset = Math.round(t * (length - cm(90)));
          const s: RoomSpec = { width, depth, doors: [{ id: 'd', wall, offset, width: cm(90) }], columns: [] };
          expect(roomProblems(s)).toEqual([]);
          expect(validateSpace(roomSpace(s))).toEqual([]);
          expect(readRoom(roomSpace(s))).toEqual(s);
        },
      ),
    );
  });

  it('explains doors and columns that do not fit', () => {
    const bad: RoomSpec = {
      width: m(5),
      depth: m(4),
      doors: [{ id: 'd', wall: 'east', offset: m(3.5), width: cm(90) }],
      columns: [{ id: 'c', center: { x: m(6), y: m(1) }, width: cm(30), depth: cm(30) }],
    };
    expect(roomProblems(bad)).toEqual(['door d: does not fit on the east wall', 'column c: centre is outside the room']);
  });

  it('returns null for rooms that are not simple rectangles', () => {
    const l = { ...roomSpace(spec), boundary: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 5 }, { x: 5, y: 5 }, { x: 5, y: 10 }, { x: 0, y: 10 }] };
    expect(readRoom(l)).toBeNull();
  });
});

describe('project.rename', () => {
  it('renames and undoes', () => {
    const hall = referenceHall();
    const outcome = apply(hall, { type: 'project.rename', name: 'قاعة الأفراح' });
    expect(outcome.ok && outcome.project.name).toBe('قاعة الأفراح');
    expect(outcome.ok && outcome.inverse).toEqual({ type: 'project.rename', name: hall.name });
    expect(apply(hall, { type: 'project.rename', name: '  ' }).ok).toBe(false);
  });
});
