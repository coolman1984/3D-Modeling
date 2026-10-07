import { apply, detectRooms, fromUnit, roomMap, validateProject, type Command, type Project } from '@space-planner/core';
import { newHome } from '@space-planner/starter';
import { describe, expect, it } from 'vitest';
import { addOpening, addWall, nameRoom, openingNote, typedLengthGuessed, wallLengthProblem, moveWall, moveWallEnd, pointAtLength, removeWallsAndOpenings, setWallLength, snapWallPoint, typedLength, updateOpening, updateWall } from '../src/logic/walls.js';

const m = (v: number) => fromUnit(v, 'm');
const cm = (v: number) => fromUnit(v, 'cm');
const p = (x: number, y: number) => ({ x: m(x), y: m(y) });

// A 4 × 3 m flat inside 20 cm outer walls: outside 4.40 × 3.40 m, inside x 0.2–4.2, y 0.2–3.2,
// outer centre lines at 0.1 / 4.3 (x) and 0.1 / 3.3 (y).
const flat = newHome('Flat', 4, 3);

function run(project: Project, command: Command | undefined): Project {
  expect(command).toBeDefined();
  const done = apply(project, command!);
  if (!done.ok) throw new Error(JSON.stringify(done.rejection));
  expect(validateProject(done.project)).toEqual([]);
  return done.project;
}
const area = (project: Project) => detectRooms(project.space).map((r) => Math.round(r.area / 1e6) / 100);

describe('drawing walls', () => {
  it('a partition from wall to wall splits the flat into two rooms', () => {
    expect(area(flat)).toEqual([12]);
    const drawn = addWall(flat, p(2.3, 0.1), p(2.3, 3.3))!;
    const two = run(flat, drawn.command);
    expect(drawn.id).toBe('wall-1');
    // 10 cm partition at x = 2.3: west 2.05 × 3 = 6.15 m², east 1.85 × 3 = 5.55 m².
    expect(area(two)).toEqual([6.15, 5.55]);
    expect(two.space.boundary).toEqual(flat.space.boundary); // inside the outer walls: the outline stays
  });

  it('refuses a wall shorter than 5 cm', () => {
    expect(addWall(flat, p(1, 1), p(1.03, 1))).toBeUndefined();
  });

  it('typed lengths: the end lands exactly that far along the pointer direction', () => {
    const end = pointAtLength(p(1, 1), p(1.2, 1.01), m(3.15));
    expect(Math.abs(Math.hypot(end.x - m(1), end.y - m(1)) - m(3.15))).toBeLessThan(1);
    expect(pointAtLength(p(1, 1), p(1, 3), m(2.5))).toEqual(p(1, 3.5));
  });
});

describe('walls never lose a door or window silently', () => {
  const two = run(flat, addWall(flat, p(2.3, 0.1), p(2.3, 3.3))!.command);
  const withDoor = run(two, addOpening(two, 'wall-1', 'door', p(2.25, 1.0))!.command);

  it('a wall cannot be made shorter than the door in it: no command, and a reason in words', () => {
    expect(setWallLength(withDoor, 'wall-1', cm(50))).toBeUndefined();
    expect(wallLengthProblem(withDoor, 'wall-1', cm(50))).toMatch(/door in this wall is 80 cm wide/);
    expect(wallLengthProblem(withDoor, 'wall-1', cm(2))).toMatch(/at least 5 cm/);
    expect(wallLengthProblem(withDoor, 'wall-1', cm(120))).toBeUndefined();
    expect(setWallLength(withDoor, 'wall-1', cm(120))).toBeDefined();
    // Dragging an end so far that the door would be lost is refused too.
    expect(moveWallEnd(withDoor, 'wall-1', 'b', p(2.3, 0.4))).toBeUndefined();
  });

  it('drawing over an existing wall adds nothing', () => {
    expect(addWall(two, p(2.3, 0.1), p(2.3, 3.3))).toBeUndefined();
    expect(addWall(two, p(2.3, 3.3), p(2.3, 0.1))).toBeUndefined();
  });

  it('says what was adjusted when an opening is cut to its wall', () => {
    expect(openingNote(withDoor, 'door-1', { width: cm(900) })).toMatch(/only 320 cm long.*cut to fit/);
    expect(openingNote(withDoor, 'door-1', { width: cm(90) })).toBeUndefined();
    expect(openingNote(withDoor, 'door-1', { offset: cm(900) })).toMatch(/stay inside the wall/);
  });
});

describe('typed lengths with units', () => {
  it('a unit settles any doubt: 35 m, 35 cm, 3500 mm, and Arabic units', () => {
    expect([typedLength('35 m'), typedLength('35m'), typedLength('35cm'), typedLength('3500 mm'), typedLength('٣٥ م'), typedLength('٣٥ سم')]).toEqual([m(35), m(35), cm(35), m(3.5), m(35), cm(35)]);
    expect([typedLength('35'), typedLength('12'), typedLength('315'), typedLength('3.15')]).toEqual([cm(35), m(12), m(3.15), m(3.15)]);
    // The place decides a bare whole number: in a 13 m flat 35 is centimetres, in a 60 m warehouse metres.
    expect([typedLength('35', m(13)), typedLength('12', m(13)), typedLength('35', m(60)), typedLength('90', m(60)), typedLength('95', m(60))]).toEqual([cm(35), m(12), m(35), m(90), cm(95)]);
    expect([typedLength('3 x'), typedLength('m'), typedLength('-2')]).toEqual([undefined, undefined, undefined]);
    expect([typedLengthGuessed('35'), typedLengthGuessed('35 m'), typedLengthGuessed('3.5')]).toEqual([true, false, false]);
  });
});

describe('typed lengths', () => {
  it('reads metres with a point or comma, centimetres as a whole number above 30, and Arabic digits', () => {
    expect([typedLength('4.75'), typedLength('4,75'), typedLength('410'), typedLength('3'), typedLength('٤٫٥')]).toEqual([m(4.75), m(4.75), m(4.1), m(3), m(4.5)]);
    expect([typedLength(''), typedLength('0'), typedLength('abc')]).toEqual([undefined, undefined, undefined]);
  });
});

describe('snapping while drawing', () => {
  const reach = cm(15);
  it('lands on a wall end within reach, before anything else', () => {
    expect(snapWallPoint(flat, p(0.15, 0.2), reach, cm(5))).toEqual({ point: p(0.1, 0.1), to: 'end' });
  });
  it('keeps square to the previous point within 8°, and slides onto a wall along that line', () => {
    expect(snapWallPoint(flat, p(2.0, 1.53), reach, cm(5), p(1, 1.5))).toEqual({ point: p(2, 1.5), to: 'square' });
    // Near the east wall's centre line (x = 4.3) on the square line: lands on the wall at y = 1.5.
    expect(snapWallPoint(flat, p(4.25, 1.52), reach, cm(5), p(1, 1.5))).toEqual({ point: p(4.3, 1.5), to: 'wall' });
  });
  it('otherwise uses the grid', () => {
    expect(snapWallPoint(flat, p(1.23, 2.07), reach, cm(5))).toEqual({ point: p(1.25, 2.05), to: 'grid' });
  });
});

describe('editing walls', () => {
  const two = run(flat, addWall(flat, p(2.3, 0.1), p(2.3, 3.3))!.command);

  it('moving a corner moves every wall that ends there', () => {
    // Pull the north-east corner (4.3, 3.3) to (5.3, 4.3): the east and north walls both follow.
    const moved = run(two, moveWallEnd(two, 'wall-east', 'b', p(5.3, 4.3)));
    expect(moved.space.walls!.find((w) => w.id === 'wall-east')!.b).toEqual(p(5.3, 4.3));
    expect(moved.space.walls!.find((w) => w.id === 'wall-north')!.a).toEqual(p(5.3, 4.3));
  });

  it('moving an outer wall stretches the walls joined to it, and the outline follows the outside', () => {
    const wider = run(two, moveWall(two, 'wall-east', p(1, 0)));
    expect(wider.space.walls!.find((w) => w.id === 'wall-south')!.b).toEqual(p(5.3, 0.1));
    expect(wider.space.walls!.find((w) => w.id === 'wall-north')!.a).toEqual(p(5.3, 3.3));
    expect(wider.space.boundary).toEqual([p(0, 0), p(5.4, 0), p(5.4, 3.4), p(0, 3.4)]);
    expect(area(wider)).toEqual([6.15, 8.55]);
  });

  it('typing a length moves the wall end; a whole wall moves with its joined ends', () => {
    const longer = run(two, setWallLength(two, 'wall-south', m(5.2)));
    expect(longer.space.walls!.find((w) => w.id === 'wall-south')!.b).toEqual(p(5.3, 0.1));
    expect(longer.space.walls!.find((w) => w.id === 'wall-east')!.a).toEqual(p(5.3, 0.1));
    // Slide the partition 40 cm east: it ends on the outer walls' centre lines, which do not move.
    const slid = run(two, moveWall(two, 'wall-1', p(0.4, 0)));
    expect(slid.space.walls!.find((w) => w.id === 'wall-1')).toMatchObject({ a: p(2.7, 0.1), b: p(2.7, 3.3) });
    expect(area(slid)).toEqual([7.35, 4.35]);
  });

  it('thickness and height are set and cleared', () => {
    const thick = run(two, updateWall(two, 'wall-1', { thickness: cm(20), height: cm(240) }));
    expect(thick.space.walls!.find((w) => w.id === 'wall-1')).toMatchObject({ thickness: cm(20), height: cm(240) });
    const back = run(thick, updateWall(thick, 'wall-1', { height: null }));
    expect('height' in back.space.walls!.find((w) => w.id === 'wall-1')!).toBe(false);
  });
});

describe('naming rooms', () => {
  it('a name sits in the room it names; naming again replaces it; an empty name removes it', () => {
    const two = run(flat, addWall(flat, p(2.3, 0.1), p(2.3, 3.3))!.command);
    const [west] = roomMap(two.space).rooms;
    const named = run(two, nameRoom(two, { label: west!.label, zoneIds: [] }, '  Bedroom '));
    const zone = named.space.zones!.find((z) => z.kind === 'room')!;
    expect(zone.meta).toEqual({ label: 'Bedroom' });
    expect(roomMap(named.space).roomAt(zone.polygon[0]!)).toBe(0);
    const renamed = run(named, nameRoom(named, { label: west!.label, zoneIds: [zone.id] }, 'Study'));
    expect(renamed.space.zones!.map((z) => z.meta?.label)).toEqual(['Study']);
    const cleared = run(renamed, nameRoom(renamed, { label: west!.label, zoneIds: renamed.space.zones!.map((z) => z.id) }, ''));
    expect(cleared.space.zones).toBeUndefined();
  });
});

describe('doors and windows', () => {
  const two = run(flat, addWall(flat, p(2.3, 0.1), p(2.3, 3.3))!.command);

  it('a door goes where it is clicked, within the wall, opening to the side clicked', () => {
    // Clicked at y = 1.0 just west of the partition: an 80 cm door from 0.6 to 1.4 m (offsets from y = 0.1).
    const added = addOpening(two, 'wall-1', 'door', p(2.25, 1.0))!;
    const withDoor = run(two, added.command);
    const door = withDoor.space.openings!.find((o) => o.id === added.id)!;
    expect(door).toMatchObject({ kind: 'door', offset: m(0.5), width: cm(80), hinge: 'start', side: 'left' });
    // The wall runs north, so its left is west: the side the click was on.
    expect(area(withDoor)).toEqual([6.15, 5.55]); // a door does not join rooms
    // Clicked at the very end: kept within the wall.
    const atEnd = addOpening(two, 'wall-1', 'window', p(2.3, 3.29))!;
    expect(run(two, atEnd.command).space.openings!.find((o) => o.id === atEnd.id)).toMatchObject({ offset: m(3.2) - cm(120), width: cm(120) });
  });

  it('slides, resizes and flips; never off its wall', () => {
    const added = addOpening(two, 'wall-1', 'door', p(2.25, 1.0))!;
    const withDoor = run(two, added.command);
    const slid = run(withDoor, updateOpening(withDoor, added.id, { offset: m(9) }));
    expect(slid.space.openings!.find((o) => o.id === added.id)!.offset).toBe(m(3.2) - cm(80));
    const flipped = run(slid, updateOpening(slid, added.id, { hinge: 'end', side: 'right', width: cm(90) }));
    expect(flipped.space.openings!.find((o) => o.id === added.id)).toMatchObject({ hinge: 'end', side: 'right', width: cm(90), offset: m(3.2) - cm(90) });
  });

  it('a wall shortened past its door keeps the door on it; removing the wall removes the door', () => {
    const added = addOpening(two, 'wall-1', 'door', p(2.25, 2.8))!;
    const withDoor = run(two, added.command);
    const short = run(withDoor, setWallLength(withDoor, 'wall-1', m(2)));
    const door = short.space.openings!.find((o) => o.id === added.id)!;
    expect(door.offset + door.width).toBeLessThanOrEqual(m(2));
    const gone = run(short, removeWallsAndOpenings(short, ['wall-1']));
    expect(gone.space.openings!.map((o) => o.id)).toEqual(['front-door']);
    expect(gone.space.walls!.some((w) => w.id === 'wall-1')).toBe(false);
  });

  it('every edit is one step that undo reverses exactly', () => {
    const added = addOpening(two, 'wall-1', 'window', p(2.35, 2))!;
    const done = apply(two, added.command);
    expect(done.ok).toBe(true);
    if (!done.ok) return;
    const undone = apply(done.project, done.inverse);
    expect(undone.ok && undone.project.space).toEqual(two.space);
  });
});
