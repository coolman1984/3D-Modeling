import type { Polygon } from '../geometry/polygon.js';
import { pointSegmentDistance } from '../geometry/segment.js';
import { doorSwingPolygon } from '../geometry/shapes.js';
import type { Vec2 } from '../geometry/vec2.js';
import { FULL_TURN } from '../units/angle.js';
import { TOLERANCE, type Tick } from '../units/length.js';
import type { Id, Opening, Space, WallSegment } from './types.js';

/**
 * Geometry derived from walls and openings (decision 0028): the solid parts of each wall, the
 * swing of each door, and the rooms the walls close off. Nothing here is stored; it is rebuilt
 * from the space whenever it is needed.
 */

/** A wall's own frame: start, unit direction along it, unit normal to its left, length. */
export interface WallFrame {
  readonly origin: Vec2;
  readonly along: Vec2;
  readonly left: Vec2;
  readonly length: number;
}

export function wallFrame(wall: WallSegment): WallFrame {
  const dx = wall.b.x - wall.a.x;
  const dy = wall.b.y - wall.a.y;
  const length = Math.hypot(dx, dy);
  const along = { x: dx / length, y: dy / length };
  return { origin: wall.a, along, left: { x: -along.y, y: along.x }, length };
}

/** The point at distance `s` along the wall and `t` to its left of the centre line. */
export function wallPoint(frame: WallFrame, s: number, t = 0): Vec2 {
  return { x: frame.origin.x + frame.along.x * s + frame.left.x * t, y: frame.origin.y + frame.along.y * s + frame.left.y * t };
}

/** The band of a wall between two distances along it, full thickness, counter-clockwise. */
function band(frame: WallFrame, thickness: Tick, from: number, to: number): Polygon {
  const h = thickness / 2;
  return [wallPoint(frame, from, -h), wallPoint(frame, to, -h), wallPoint(frame, to, h), wallPoint(frame, from, h)];
}

/**
 * How far each end of a wall reaches past its end point: half the thickness of the thickest
 * other wall that the end touches (at that wall's end or along it), so corners and T-junctions
 * close without a gap. An end that touches nothing stops at its point.
 */
export function wallReach(space: Space, wall: WallSegment): { readonly start: number; readonly end: number } {
  const reach = (p: Vec2) => {
    let r = 0;
    for (const other of space.walls ?? []) {
      if (other.id === wall.id) continue;
      if (pointSegmentDistance(p, other.a, other.b) <= TOLERANCE) r = Math.max(r, other.thickness / 2);
    }
    return r;
  };
  return { start: reach(wall.a), end: reach(wall.b) };
}

export interface WallSolid {
  readonly wallId: Id;
  readonly polygon: Polygon;
}

/**
 * The solid parts of every wall on the floor, in wall order. Door openings are gaps people walk
 * through; window openings are not (the wall stands below the sill). With `doors: false` the
 * walls are whole, which is how rooms are told apart.
 */
export function wallSolids(space: Space, { doors = true }: { readonly doors?: boolean } = {}): WallSolid[] {
  const solids: WallSolid[] = [];
  for (const wall of space.walls ?? []) {
    const frame = wallFrame(wall);
    const reach = wallReach(space, wall);
    const gaps = doors
      ? (space.openings ?? [])
          .filter((o) => o.wall === wall.id && o.kind === 'door')
          .map((o) => [o.offset, o.offset + o.width] as const)
          .sort((x, y) => x[0] - y[0])
      : [];
    let from = -reach.start;
    for (const [g0, g1] of gaps) {
      if (g0 > from) solids.push({ wallId: wall.id, polygon: band(frame, wall.thickness, from, g0) });
      from = Math.max(from, g1);
    }
    const to = frame.length + reach.end;
    if (to > from) solids.push({ wallId: wall.id, polygon: band(frame, wall.thickness, from, to) });
  }
  return solids;
}

/** The rectangle an opening cuts through its wall, or undefined when its wall is missing. */
export function openingPolygon(space: Space, opening: Opening): Polygon | undefined {
  const wall = space.walls?.find((w) => w.id === opening.wall);
  if (!wall) return undefined;
  return band(wallFrame(wall), wall.thickness, opening.offset, opening.offset + opening.width);
}

/**
 * Where a swinging door's leaf hangs and turns: the hinge sits on the wall face on the side it
 * opens to, the closed leaf spans the opening, and it turns a quarter toward that side.
 * Undefined for windows, plain openings and sliding doors.
 */
export function openingSwing(space: Space, opening: Opening): { hinge: Vec2; width: Tick; angle: number; swing: 'left' | 'right' } | undefined {
  if (opening.kind !== 'door' || opening.hinge === undefined || opening.side === undefined) return undefined;
  const wall = space.walls?.find((w) => w.id === opening.wall);
  if (!wall) return undefined;
  const frame = wallFrame(wall);
  const t = (opening.side === 'left' ? 1 : -1) * (wall.thickness / 2);
  const atStart = opening.hinge === 'start';
  const hinge = wallPoint(frame, atStart ? opening.offset : opening.offset + opening.width, t);
  // Integer millidegrees: the leaf's closed direction, toward the other jamb.
  const toward = atStart ? frame.along : { x: -frame.along.x, y: -frame.along.y };
  const angle = ((Math.round((Math.atan2(toward.y, toward.x) * 180_000) / Math.PI) % FULL_TURN) + FULL_TURN) % FULL_TURN;
  // Turning the leaf counter-clockwise points it to the left of its own direction.
  const ccwSide = atStart ? 'left' : 'right';
  return { hinge, width: opening.width, angle, swing: opening.side === ccwSide ? 'left' : 'right' };
}

/** The floor a swinging door sweeps, or undefined when it does not swing. */
export function openingSwingPolygon(space: Space, opening: Opening): Polygon | undefined {
  const swing = openingSwing(space, opening);
  return swing && doorSwingPolygon(swing);
}

/** A floor region closed off by walls (and the boundary). */
export interface DetectedRoom {
  /** Floor area in square ticks (1 m² = 10⁸). */
  readonly area: number;
  /** A point well inside the room for its label: the spot farthest from its walls. */
  readonly label: Vec2;
  /** Bounding box of the room's floor. */
  readonly min: Vec2;
  readonly max: Vec2;
}

/** Rooms smaller than this (half a square metre) are slivers between walls, not rooms. */
export const MIN_ROOM_AREA = 50_000_000;
const MAX_CELLS = 4_000_000;

/**
 * The rooms the walls close off, found on a raster of 1 cm cells (coarser for very large
 * spaces). Door openings do not join rooms: a door belongs to the wall it sits in. Walls on
 * whole centimetres with even-centimetre thicknesses give exact areas; others are within a
 * cell along each wall. Deterministic: rooms come in the order of their lowest, then
 * westernmost, cell.
 */
export function detectRooms(space: Space): readonly DetectedRoom[] {
  return roomMap(space).rooms;
}

/** The rooms, and which room a point lies in (index into `rooms`, or -1 on a wall or outside). */
export interface RoomMap {
  readonly rooms: readonly DetectedRoom[];
  roomAt(p: Vec2): number;
}

/** {@link detectRooms}, with a lookup from a point to its room (to name rooms from labelled zones). */
export function roomMap(space: Space): RoomMap {
  const xs = space.boundary.map((p) => p.x);
  const ys = space.boundary.map((p) => p.y);
  let cell = 100;
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  const spanX = Math.max(...xs) - minX;
  const spanY = Math.max(...ys) - minY;
  while ((spanX / cell + 1) * (spanY / cell + 1) > MAX_CELLS) cell *= 2;
  const x0 = Math.floor(minX / cell) * cell;
  const y0 = Math.floor(minY / cell) * cell;
  const cols = Math.ceil((minX + spanX - x0) / cell);
  const rows = Math.ceil((minY + spanY - y0) / cell);
  if (cols <= 0 || rows <= 0) return { rooms: [], roomAt: () => -1 };

  // 1 = floor, 0 = outside or wall.
  const grid = new Uint8Array(cols * rows);
  paint(grid, cols, rows, x0, y0, cell, space.boundary, 1);
  for (const solid of wallSolids(space, { doors: false })) paint(grid, cols, rows, x0, y0, cell, solid.polygon, 0);

  const distance = chamfer(grid, cols, rows);
  const label = new Int32Array(cols * rows).fill(-1);
  const rooms: DetectedRoom[] = [];
  const stack: number[] = [];
  for (let start = 0; start < grid.length; start++) {
    if (grid[start] !== 1 || label[start] !== -1) continue;
    let count = 0;
    let best = start;
    let c0 = cols;
    let c1 = 0;
    let r0 = rows;
    let r1 = 0;
    label[start] = rooms.length;
    stack.push(start);
    while (stack.length > 0) {
      const i = stack.pop()!;
      count++;
      if (distance[i]! > distance[best]! || (distance[i] === distance[best] && i < best)) best = i;
      const c = i % cols;
      const r = (i - c) / cols;
      c0 = Math.min(c0, c);
      c1 = Math.max(c1, c);
      r0 = Math.min(r0, r);
      r1 = Math.max(r1, r);
      for (const j of [c > 0 ? i - 1 : -1, c < cols - 1 ? i + 1 : -1, r > 0 ? i - cols : -1, r < rows - 1 ? i + cols : -1]) {
        if (j >= 0 && grid[j] === 1 && label[j] === -1) {
          label[j] = rooms.length;
          stack.push(j);
        }
      }
    }
    const area = count * cell * cell;
    const bc = best % cols;
    const br = (best - bc) / cols;
    rooms.push({
      area,
      label: { x: x0 + (bc + 0.5) * cell, y: y0 + (br + 0.5) * cell },
      min: { x: x0 + c0 * cell, y: y0 + r0 * cell },
      max: { x: x0 + (c1 + 1) * cell, y: y0 + (r1 + 1) * cell },
    });
  }
  const kept = new Int32Array(rooms.length).fill(-1);
  const result: DetectedRoom[] = [];
  rooms.forEach((r, i) => {
    if (r.area < MIN_ROOM_AREA) return;
    kept[i] = result.length;
    result.push(r);
  });
  return {
    rooms: result,
    roomAt(p: Vec2): number {
      const c = Math.floor((p.x - x0) / cell);
      const r = Math.floor((p.y - y0) / cell);
      if (c < 0 || r < 0 || c >= cols || r >= rows) return -1;
      const l = label[r * cols + c]!;
      return l < 0 ? -1 : kept[l]!;
    },
  };
}

/** Sets every cell whose centre lies inside the polygon (even-odd scanline at cell centres). */
function paint(grid: Uint8Array, cols: number, rows: number, x0: number, y0: number, cell: number, polygon: Polygon, value: number): void {
  const n = polygon.length;
  let lo = Infinity;
  let hi = -Infinity;
  for (const p of polygon) {
    lo = Math.min(lo, p.y);
    hi = Math.max(hi, p.y);
  }
  const rStart = Math.max(0, Math.floor((lo - y0) / cell - 0.5));
  const rEnd = Math.min(rows - 1, Math.ceil((hi - y0) / cell));
  const crossings: number[] = [];
  for (let r = rStart; r <= rEnd; r++) {
    const y = y0 + (r + 0.5) * cell;
    crossings.length = 0;
    for (let k = 0; k < n; k++) {
      const a = polygon[k]!;
      const b = polygon[(k + 1) % n]!;
      if (a.y <= y === b.y <= y) continue;
      crossings.push(a.x + ((y - a.y) / (b.y - a.y)) * (b.x - a.x));
    }
    crossings.sort((p, q) => p - q);
    for (let k = 0; k + 1 < crossings.length; k += 2) {
      // Cells whose centre x lies in [left, right).
      const c0 = Math.max(0, Math.ceil((crossings[k]! - x0) / cell - 0.5));
      const c1 = Math.min(cols - 1, Math.ceil((crossings[k + 1]! - x0) / cell - 0.5) - 1);
      for (let c = c0; c <= c1; c++) grid[r * cols + c] = value;
    }
  }
}

/** Distance of each floor cell to the nearest non-floor cell, in a 3-4 chamfer metric. */
function chamfer(grid: Uint8Array, cols: number, rows: number): Uint32Array {
  const far = 0xffffffff;
  const d = new Uint32Array(grid.length);
  for (let i = 0; i < grid.length; i++) d[i] = grid[i] === 1 ? far : 0;
  const at = (c: number, r: number) => (c < 0 || r < 0 || c >= cols || r >= rows ? 0 : d[r * cols + c]!);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const i = r * cols + c;
      if (d[i] === 0) continue;
      d[i] = Math.min(d[i]!, at(c - 1, r) + 3, at(c, r - 1) + 3, at(c - 1, r - 1) + 4, at(c + 1, r - 1) + 4);
    }
  }
  for (let r = rows - 1; r >= 0; r--) {
    for (let c = cols - 1; c >= 0; c--) {
      const i = r * cols + c;
      if (d[i] === 0) continue;
      d[i] = Math.min(d[i]!, at(c + 1, r) + 3, at(c, r + 1) + 3, at(c + 1, r + 1) + 4, at(c - 1, r + 1) + 4);
    }
  }
  return d;
}
