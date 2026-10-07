import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  apply,
  area,
  checkProject,
  createProject,
  createSpace,
  deserializeProject,
  detectRooms,
  openingSwing,
  openingSwingPolygon,
  measureProject,
  rectangleBoundary,
  roomMap,
  serializeProject,
  validateProject,
  validateSpace,
  wallSolids,
  type ItemDefinition,
  type Opening,
  type Project,
  type Space,
  type WallSegment,
} from '../src/index.js';
import { cm, place } from './fixtures.js';

/**
 * Reference flat, 6 × 4 m outside: outer walls 20 cm thick on centre lines 10 cm in from the
 * boundary, and a 10 cm partition at x = 3 m with a 90 cm door 1 m from its south end, hinged at
 * that end and opening west. Hand-computed: the west room is 2.75 × 3.60 m = 9.90 m² (x 0.20 to
 * 2.95, y 0.20 to 3.80); the east room the same; the door sweeps x 2.05–2.95, y 1.10–2.00.
 */
const p = (x: number, y: number) => ({ x: cm(x), y: cm(y) });
const outer = (id: string, a: [number, number], b: [number, number]): WallSegment => ({ id, a: p(...a), b: p(...b), thickness: cm(20) });
const OUTER: WallSegment[] = [outer('w-s', [10, 10], [590, 10]), outer('w-e', [590, 10], [590, 390]), outer('w-n', [590, 390], [10, 390]), outer('w-w', [10, 390], [10, 10])];
const PARTITION: WallSegment = { id: 'w-mid', a: p(300, 10), b: p(300, 390), thickness: cm(10) };
const DOOR: Opening = { id: 'd-mid', wall: 'w-mid', kind: 'door', offset: cm(100), width: cm(90), hinge: 'start', side: 'left' };
const { hinge: _hinge, side: _side, ...PLAIN_DOOR } = DOOR;
const WINDOW: Opening = { id: 'win-s', wall: 'w-s', kind: 'window', offset: cm(100), width: cm(120), sill: cm(90), height: cm(130) };

function flat(extra: Partial<Space> = {}): Space {
  return createSpace(rectangleBoundary(cm(600), cm(400)), { walls: [...OUTER, PARTITION], openings: [DOOR, WINDOW], ceilingHeight: cm(270), ...extra });
}

const box = (id: string, w: number, d: number): ItemDefinition => ({ id, name: id, category: 'box', size: { w: cm(w), d: cm(d), h: cm(50) }, clearance: { front: 0, back: 0, left: 0, right: 0 } });

function project(space: Space, items: Array<[string, string, number, number]> = []): Project {
  const base = createProject('flat', 'Flat', space);
  const catalog = { small: box('small', 40, 40), tiny: box('tiny', 5, 5) };
  return { ...base, catalog, items: Object.fromEntries(items.map(([id, def, x, y]) => [id, place(id, def, cm(x), cm(y))])) };
}

const m2 = (ticks2: number) => ticks2 / 1e8;
const rounded = (polygon: readonly { x: number; y: number }[]) => polygon.map((q) => ({ x: Math.round(q.x), y: Math.round(q.y) }));

describe('walls and openings: structure', () => {
  it('the reference flat is valid and saves and opens unchanged', () => {
    const flatProject = project(flat());
    expect(validateProject(flatProject)).toEqual([]);
    const text = serializeProject(flatProject);
    const opened = deserializeProject(text);
    expect(opened.ok).toBe(true);
    if (opened.ok) expect(serializeProject(opened.project)).toBe(text);
  });

  it('a space without walls keeps its old form (no empty lists stored)', () => {
    const space = createSpace(rectangleBoundary(cm(600), cm(400)), { walls: [], openings: [] });
    expect('walls' in space).toBe(false);
    expect('openings' in space).toBe(false);
  });

  it('refuses broken data: a point wall, an opening past its wall, a missing wall, a window that swings', () => {
    const codes = (space: Space) => validateSpace(space).map((q) => `${q.code} ${q.path}`);
    expect(codes(flat({ walls: [...OUTER, { ...PARTITION, b: PARTITION.a }] }))).toContain('invalid-wall space.walls.4');
    // The partition is 3.80 m long: 3.00 + 0.90 runs past it, 2.90 + 0.90 just fits.
    expect(codes(flat({ openings: [{ ...DOOR, offset: cm(300) }] }))).toEqual(['opening-off-wall space.openings.0']);
    expect(codes(flat({ openings: [{ ...DOOR, offset: cm(290) }] }))).toEqual([]);
    expect(codes(flat({ openings: [{ ...DOOR, wall: 'nowhere' }] }))).toEqual(['broken-reference space.openings.0.wall']);
    expect(codes(flat({ openings: [{ ...WINDOW, hinge: 'start', side: 'left' }] }))).toContain('wrong-type space.openings.0.hinge');
    expect(codes(flat({ openings: [{ ...PLAIN_DOOR, hinge: 'start' }] }))).toContain('missing space.openings.0.side');
    expect(codes(flat({ openings: [{ ...DOOR, sill: cm(10) }] }))).toContain('wrong-type space.openings.0.sill');
  });

  it('wall and opening ids are unique across the project', () => {
    const clash = project(flat({ openings: [{ ...DOOR, id: 'w-s' }] }));
    expect(validateProject(clash).map((q) => q.code)).toContain('duplicate-id');
    const withItem = project(flat(), [['w-mid', 'small', 100, 100]]);
    expect(validateProject(withItem).map((q) => q.code)).toContain('duplicate-id');
  });

  it('space.set accepts walls, refuses a wall id an item already has, and undoes', () => {
    const before = project(createSpace(rectangleBoundary(cm(600), cm(400))), [['a1', 'small', 100, 100]]);
    const done = apply(before, { type: 'space.set', space: flat() });
    expect(done.ok).toBe(true);
    if (!done.ok) return;
    expect(done.project.space.walls).toHaveLength(5);
    const undone = apply(done.project, done.inverse);
    expect(undone.ok && undone.project.space).toEqual(before.space);
    const clash = apply(before, { type: 'space.set', space: flat({ walls: [...OUTER, { ...PARTITION, id: 'a1' }], openings: [WINDOW] }) });
    expect(clash.ok).toBe(false);
  });
});

describe('walls and openings: geometry', () => {
  it('corners close: each end reaches half the thickness of the wall it meets', () => {
    const solids = wallSolids(flat());
    // South wall: 5.80 m centre line + 10 cm at each corner = the full 6 m, 20 cm thick.
    expect(rounded(solids.find((s) => s.wallId === 'w-s')!.polygon)).toEqual([p(0, 0), p(600, 0), p(600, 20), p(0, 20)]);
    // The partition meets the outer walls along them: it reaches 10 cm into each, and the door cuts it in two.
    const mid = solids.filter((s) => s.wallId === 'w-mid').map((s) => rounded(s.polygon));
    expect(mid).toEqual([
      [p(305, 0), p(305, 110), p(295, 110), p(295, 0)],
      [p(305, 200), p(305, 400), p(295, 400), p(295, 200)],
    ]);
    // A window is no gap on the floor.
    expect(solids.filter((s) => s.wallId === 'w-s')).toHaveLength(1);
  });

  it('the door hinges on the west face at its south jamb and sweeps a quarter circle into the west room', () => {
    const space = flat();
    const swing = openingSwing(space, DOOR)!;
    expect(swing).toEqual({ hinge: p(295, 110), width: cm(90), angle: 90_000, swing: 'left' });
    const polygon = openingSwingPolygon(space, DOOR)!;
    const xs = polygon.map((q) => q.x);
    const ys = polygon.map((q) => q.y);
    expect(Math.round(Math.min(...xs))).toBe(cm(205));
    expect(Math.round(Math.max(...xs))).toBe(cm(295));
    expect(Math.round(Math.min(...ys))).toBe(cm(110));
    expect(Math.round(Math.max(...ys))).toBeGreaterThanOrEqual(cm(200));
    // Hinged at the north jamb and opening east instead: it sweeps the east room.
    const other = openingSwingPolygon(space, { ...DOOR, hinge: 'end', side: 'right' })!;
    expect(Math.round(Math.min(...other.map((q) => q.x)))).toBe(cm(305));
    expect(Math.round(Math.max(...other.map((q) => q.x)))).toBe(cm(395));
    expect(openingSwing(space, WINDOW)).toBeUndefined();
    expect(openingSwing(space, PLAIN_DOOR)).toBeUndefined();
  });

  it('rooms come from the walls: two rooms of 9.90 m², the door does not join them', () => {
    const rooms = detectRooms(flat());
    expect(rooms.map((r) => m2(r.area))).toEqual([9.9, 9.9]);
    expect(rooms[0]!.min).toEqual(p(20, 20));
    expect(rooms[0]!.max).toEqual(p(295, 380));
    // The label sits well inside each room.
    expect(rooms[0]!.label.x).toBeGreaterThan(cm(100));
    expect(rooms[0]!.label.x).toBeLessThan(cm(220));
    expect(rooms[1]!.label.x).toBeGreaterThan(cm(380));
    const map = roomMap(flat());
    expect([map.roomAt(p(100, 100)), map.roomAt(p(500, 100)), map.roomAt(p(300, 100)), map.roomAt(p(-5, 100))]).toEqual([0, 1, -1, -1]);
    // Without the partition: one room of 5.60 × 3.60 m = 20.16 m².
    const open = detectRooms(flat({ walls: OUTER, openings: [WINDOW] }));
    expect(open.map((r) => m2(r.area))).toEqual([20.16]);
  });

  it('the floor area of a walled space is its rooms: 2 × 9.90 m²', () => {
    expect(m2(measureProject(project(flat())).floorArea)).toBeCloseTo(19.8, 6);
  });

  it('room areas plus wall areas fill the boundary when walls run on whole centimetres', () => {
    fc.assert(
      fc.property(fc.integer({ min: 40, max: 560 }), fc.integer({ min: 2, max: 30 }), (x, half) => {
        const partition: WallSegment = { id: 'w-mid', a: p(x, 10), b: p(x, 390), thickness: cm(half * 2) };
        if (x - half < 40 || x + half > 560) return; // keep each side a room, not a sliver under half a square metre
        const space = flat({ walls: [...OUTER, partition], openings: [] });
        const rooms = detectRooms(space);
        expect(rooms).toHaveLength(2);
        const wallArea = (380 - 20) * (2 * half) + 600 * 400 - 560 * 360; // partition between the outer faces + the outer ring
        expect(Math.round(m2(rooms[0]!.area + rooms[1]!.area) * 1e4)).toBe(600 * 400 - wallArea);
      }),
      { numRuns: 40 },
    );
  });
});

describe('walls and openings: checks', () => {
  const codes = (pr: Project) => checkProject(pr).map((i) => `${i.code} ${i.entityIds.join('+')}`);

  it('an item in the swing of a door blocks it; an item in a wall stands on it; the doorway itself is free', () => {
    const pr = project(flat(), [
      ['in-swing', 'small', 270, 150],
      ['in-wall', 'small', 300, 300],
      ['in-doorway', 'tiny', 300, 150],
      ['free', 'small', 150, 300],
    ]);
    expect(codes(pr)).toEqual(['on-obstacle in-wall+w-mid', 'door-blocked in-swing+d-mid']);
    const blocked = checkProject(pr).find((i) => i.code === 'door-blocked')!;
    // The chair's east edge is at 2.90 m, 5 cm short of the hinge face: it sits inside the sweep.
    expect(blocked.amount).toBeGreaterThan(0);
  });

  it('an item across a door gap stands on the wall once, not once per piece', () => {
    const wide: ItemDefinition = { ...box('wide', 20, 200), id: 'wide' };
    const base = project(flat());
    const pr = { ...base, catalog: { ...base.catalog, wide }, items: { long: place('long', 'wide', cm(300), cm(160)) } };
    expect(codes(pr)).toEqual(['on-obstacle long+w-mid', 'door-blocked long+d-mid']);
  });

  it('the spatial grid gives the same issues as comparing every pair', () => {
    const pr = project(flat(), [
      ['a', 'small', 270, 150],
      ['b', 'small', 300, 300],
      ['c', 'small', 30, 30],
      ['d', 'small', 450, 200],
    ]);
    expect(checkProject(pr)).toEqual(checkProject(pr, { spatialIndex: false }));
  });

  it('wall pieces leave the door gap exactly as wide as the opening', () => {
    const pieces = wallSolids(flat()).filter((s) => s.wallId === 'w-mid');
    const total = pieces.reduce((sum, s) => sum + area(s.polygon), 0);
    // 4.00 m reach-to-reach minus the 0.90 m door, 10 cm thick.
    expect(Math.round(total)).toBe(cm(310) * cm(10));
  });
});
