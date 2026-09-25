import { locatePoint } from '../geometry/polygon.js';
import type { Vec2 } from '../geometry/vec2.js';
import type { Tick } from '../units/length.js';
import { createSpace, rectangleBoundary } from './create.js';
import type { Door, Id, Obstacle, Space } from './types.js';

/**
 * A rectangular room described the way people talk about it:
 * width (west→east) × depth (south→north), doors on named walls, rectangular columns.
 * Converts to and from the general `Space`, so people and agents can edit rooms simply.
 */
export type Wall = 'south' | 'north' | 'west' | 'east';

export interface DoorSpec {
  readonly id: Id;
  readonly wall: Wall;
  /** Distance along the wall from its start (south/north: from the west end; west/east: from the south end) to the hinge. */
  readonly offset: Tick;
  readonly width: Tick;
}

export interface ColumnSpec {
  readonly id: Id;
  readonly center: Vec2;
  readonly width: Tick;
  readonly depth: Tick;
}

export interface RoomSpec {
  readonly width: Tick;
  readonly depth: Tick;
  readonly ceilingHeight?: Tick;
  readonly doors: readonly DoorSpec[];
  readonly columns: readonly ColumnSpec[];
}

/**
 * Every door hangs on its wall, leaf lying along the wall toward increasing offset,
 * and opens into the room.
 */
const DOOR_LAYOUT: Readonly<Record<Wall, { angle: number; swing: 'left' | 'right' }>> = {
  south: { angle: 0, swing: 'left' },
  north: { angle: 0, swing: 'right' },
  west: { angle: 90_000, swing: 'right' },
  east: { angle: 90_000, swing: 'left' },
};

function hingeOf(spec: RoomSpec, door: DoorSpec): Vec2 {
  switch (door.wall) {
    case 'south':
      return { x: door.offset, y: 0 };
    case 'north':
      return { x: door.offset, y: spec.depth };
    case 'west':
      return { x: 0, y: door.offset };
    case 'east':
      return { x: spec.width, y: door.offset };
  }
}

export function wallLength(spec: Pick<RoomSpec, 'width' | 'depth'>, wall: Wall): Tick {
  return wall === 'south' || wall === 'north' ? spec.width : spec.depth;
}

/** Build the space. The result still needs `validateSpace`; this only translates. */
export function roomSpace(spec: RoomSpec): Space {
  const doors: Door[] = spec.doors.map((d) => ({
    id: d.id,
    hinge: hingeOf(spec, d),
    width: d.width,
    angle: DOOR_LAYOUT[d.wall].angle,
    swing: DOOR_LAYOUT[d.wall].swing,
  }));
  const obstacles: Obstacle[] = spec.columns.map((c) => {
    const hw = Math.round(c.width / 2);
    const hd = Math.round(c.depth / 2);
    return {
      id: c.id,
      kind: 'column',
      polygon: [
        { x: c.center.x - hw, y: c.center.y - hd },
        { x: c.center.x - hw + c.width, y: c.center.y - hd },
        { x: c.center.x - hw + c.width, y: c.center.y - hd + c.depth },
        { x: c.center.x - hw, y: c.center.y - hd + c.depth },
      ],
    };
  });
  return createSpace(rectangleBoundary(spec.width, spec.depth), {
    doors,
    obstacles,
    ...(spec.ceilingHeight === undefined ? {} : { ceilingHeight: spec.ceilingHeight }),
  });
}

/** Problems a person can fix, in plain terms (door beyond its wall, column outside the room). */
export function roomProblems(spec: RoomSpec): string[] {
  const problems: string[] = [];
  if (spec.width <= 0 || spec.depth <= 0) problems.push('room width and depth must be positive');
  for (const d of spec.doors) {
    if (d.width <= 0) problems.push(`door ${d.id}: width must be positive`);
    if (d.offset < 0 || d.offset + d.width > wallLength(spec, d.wall)) {
      problems.push(`door ${d.id}: does not fit on the ${d.wall} wall`);
    }
  }
  const boundary = rectangleBoundary(spec.width, spec.depth);
  for (const c of spec.columns) {
    if (c.width <= 0 || c.depth <= 0) problems.push(`column ${c.id}: size must be positive`);
    if (locatePoint(boundary, c.center) === 'outside') problems.push(`column ${c.id}: centre is outside the room`);
  }
  return problems;
}

/**
 * Read a space back as a room spec, or null when it is not a rectangle at the origin
 * with doors and columns in the conventional layout (then only the general editor applies).
 */
export function readRoom(space: Space): RoomSpec | null {
  const b = space.boundary;
  if (b.length !== 4) return null;
  const width = b[1]!.x;
  const depth = b[2]!.y;
  const expected = rectangleBoundary(width, depth);
  if (width <= 0 || depth <= 0 || b.some((p, i) => p.x !== expected[i]!.x || p.y !== expected[i]!.y)) return null;

  const doors: DoorSpec[] = [];
  for (const d of space.doors) {
    // A hinge in a corner touches two walls; the leaf direction and swing decide which.
    const touching: Wall[] = [];
    if (d.hinge.y === 0) touching.push('south');
    if (d.hinge.y === depth) touching.push('north');
    if (d.hinge.x === 0) touching.push('west');
    if (d.hinge.x === width) touching.push('east');
    const wall = touching.find((w) => DOOR_LAYOUT[w].angle === d.angle && DOOR_LAYOUT[w].swing === d.swing);
    if (!wall) return null;
    const offset = wall === 'south' || wall === 'north' ? d.hinge.x : d.hinge.y;
    doors.push({ id: d.id, wall, offset, width: d.width });
  }

  const columns: ColumnSpec[] = [];
  for (const o of space.obstacles) {
    const p = o.polygon;
    if (o.kind !== 'column' || p.length !== 4) return null;
    const [a, c] = [p[0]!, p[2]!];
    const isAxisBox = p[1]!.x === c.x && p[1]!.y === a.y && p[3]!.x === a.x && p[3]!.y === c.y;
    if (!isAxisBox) return null;
    const w = c.x - a.x;
    const dd = c.y - a.y;
    columns.push({ id: o.id, center: { x: a.x + Math.round(w / 2), y: a.y + Math.round(dd / 2) }, width: w, depth: dd });
  }

  return {
    width,
    depth,
    ...(space.ceilingHeight === undefined ? {} : { ceilingHeight: space.ceilingHeight }),
    doors,
    columns,
  };
}
