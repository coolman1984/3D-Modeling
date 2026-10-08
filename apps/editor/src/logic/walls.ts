import { boundsOf, wallFrame, wallSolids, type Command, type Id, type Opening, type Project, type Space, type Vec2, type WallSegment } from '@space-planner/core';
import { nextId } from './ids.js';
import { parseNumber } from '../ui/Fields.js';

/**
 * Editing drawn walls and their doors and windows (decision 0028). Every edit is one `space.set`
 * command, so it is one step in the history and one revision. Walls that share an end stay
 * joined: moving that end moves it for all of them. Doors and windows keep their distance from
 * the wall's start and are kept on the wall when it gets shorter.
 */

/** Usual sizes when a door or window is added (ticks). */
export const DEFAULT_DOOR = 8_000;
export const DEFAULT_WINDOW = 12_000;
export const DEFAULT_THICKNESS = 1_000;
/** Shortest wall a person can draw: 5 cm. */
export const MIN_WALL = 500;

const same = (p: Vec2, q: Vec2) => p.x === q.x && p.y === q.y;
const round = (p: Vec2): Vec2 => ({ x: Math.round(p.x), y: Math.round(p.y) });
const lengthOf = (w: WallSegment) => Math.hypot(w.b.x - w.a.x, w.b.y - w.a.y);

/** Every id in the project, so new walls and openings never clash with anything. */
export function takenIds(project: Project): Set<Id> {
  const { space } = project;
  return new Set<Id>([
    project.id,
    ...Object.keys(project.catalog),
    ...Object.keys(project.items),
    ...space.obstacles.map((o) => o.id),
    ...space.doors.map((d) => d.id),
    ...(space.zones ?? []).map((z) => z.id),
    ...(space.walls ?? []).map((w) => w.id),
    ...(space.openings ?? []).map((o) => o.id),
  ]);
}

/**
 * The space with new walls and openings, tidied: openings kept on their walls (dropped when the
 * wall is now shorter than the opening), empty lists left out, and a rectangular outline grown
 * or shrunk to the walls' outside so the floor follows them.
 */
export function withWalls(space: Space, walls: readonly WallSegment[], openings: readonly Opening[]): Space {
  const byId = new Map(walls.map((w) => [w.id, w]));
  const kept: Opening[] = [];
  for (const o of openings) {
    const wall = byId.get(o.wall);
    if (!wall) continue;
    const length = Math.floor(lengthOf(wall));
    if (o.width > length) continue;
    const offset = Math.max(0, Math.min(o.offset, length - o.width));
    kept.push(offset === o.offset ? o : { ...o, offset });
  }
  const { walls: _w, openings: _o, ...rest } = space;
  const next: Space = { ...rest, ...(walls.length ? { walls } : {}), ...(kept.length ? { openings: kept } : {}) };
  // An outline that was the walls' outside (an apartment) keeps following them.
  const before = outlineOf(space);
  const fitted = before !== undefined && before.every((p, i) => same(p, space.boundary[i]!));
  const after = fitted ? outlineOf(next) : undefined;
  return after ? { ...next, boundary: after } : next;
}

/** The axis-aligned rectangle around the walls' outer faces, counter-clockwise from the south-west. */
function outlineOf(space: Space): Vec2[] | undefined {
  if (!space.walls?.length || space.doors.length > 0) return undefined;
  const box = boundsOf(wallSolids(space, { doors: false }).flatMap((s) => s.polygon));
  const [x0, y0, x1, y1] = [Math.floor(box.minX + 0.001), Math.floor(box.minY + 0.001), Math.ceil(box.maxX - 0.001), Math.ceil(box.maxY - 0.001)];
  if (x1 - x0 < MIN_WALL || y1 - y0 < MIN_WALL) return undefined;
  return [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }];
}

const set = (space: Space): Command => ({ type: 'space.set', space });

/** Doors and windows a change would lose because their wall became shorter than they are wide. */
export function droppedOpenings(space: Space, walls: readonly WallSegment[], openings: readonly Opening[]): Opening[] {
  const byId = new Map(walls.map((w) => [w.id, w]));
  return openings.filter((o) => {
    const wall = byId.get(o.wall);
    return wall !== undefined && o.width > Math.floor(lengthOf(wall));
  });
}

const cmText = (ticks: number) => `${Math.round(ticks / 100)} cm`;

/**
 * Why a wall cannot be this long, in words for the person typing: too short to be a wall, or a
 * door or window in it would not fit. Undefined when the change is fine.
 */
export function wallLengthProblem(project: Project, wallId: Id, length: number): string | undefined {
  const { space } = project;
  const wall = space.walls?.find((w) => w.id === wallId);
  if (!wall) return 'This wall no longer exists.';
  if (!(length >= MIN_WALL)) return `A wall is at least ${cmText(MIN_WALL)} long.`;
  const f = wallFrame(wall);
  const walls = space.walls!.map((w) => (w.id === wallId ? { ...w, b: { x: w.a.x + f.along.x * length, y: w.a.y + f.along.y * length } } : w));
  const lost = droppedOpenings(space, walls, space.openings ?? []);
  if (lost.length) {
    const o = lost[0]!;
    return `The ${o.kind} in this wall is ${cmText(o.width)} wide, so the wall cannot be shorter than that. Make the ${o.kind} narrower or remove it first.`;
  }
  return undefined;
}

/** Draw a wall from `a` to `b`. Undefined when it is too short to be a wall. */
export function addWall(project: Project, a: Vec2, b: Vec2, thickness = DEFAULT_THICKNESS): { command: Command; id: Id } | undefined {
  const [p, q] = [round(a), round(b)];
  if (Math.hypot(q.x - p.x, q.y - p.y) < MIN_WALL) return undefined;
  // The same wall twice is one wall too many: drawing over an existing wall adds nothing.
  if ((project.space.walls ?? []).some((w) => (same(w.a, p) && same(w.b, q)) || (same(w.a, q) && same(w.b, p)))) return undefined;
  const id = nextId('wall', takenIds(project));
  const { space } = project;
  return { command: set(withWalls(space, [...(space.walls ?? []), { id, a: p, b: q, thickness }], space.openings ?? [])), id };
}

/**
 * Move one end of a wall. Every wall end at the same point moves with it, so corners stay
 * joined; walls whose other end lands on the same point would vanish and are left alone.
 */
export function moveWallEnd(project: Project, wallId: Id, end: 'a' | 'b', to: Vec2): Command | undefined {
  const { space } = project;
  const wall = space.walls?.find((w) => w.id === wallId);
  if (!wall) return undefined;
  const from = wall[end];
  const target = round(to);
  const walls = space.walls!.map((w) => {
    const a = same(w.a, from) ? target : w.a;
    const b = same(w.b, from) ? target : w.b;
    return same(a, b) || Math.hypot(b.x - a.x, b.y - a.y) < MIN_WALL ? w : a === w.a && b === w.b ? w : { ...w, a, b };
  });
  if (walls.find((w) => w.id === wallId)![end] !== target) return undefined; // too short
  if (droppedOpenings(space, walls, space.openings ?? []).length) return undefined; // never lose a door or window silently
  return set(withWalls(space, walls, shiftOpenings(space, walls)));
}

/**
 * Move a whole wall by `delta`; the walls joined to its ends stretch to follow.
 */
export function moveWall(project: Project, wallId: Id, delta: Vec2): Command | undefined {
  const { space } = project;
  const wall = space.walls?.find((w) => w.id === wallId);
  if (!wall) return undefined;
  const d = round(delta);
  const move = (p: Vec2): Vec2 => (same(p, wall.a) || same(p, wall.b) ? { x: p.x + d.x, y: p.y + d.y } : p);
  const walls = space.walls!.map((w) => {
    const a = move(w.a);
    const b = move(w.b);
    return a === w.a && b === w.b ? w : { ...w, a, b };
  });
  if (walls.some((w) => Math.hypot(w.b.x - w.a.x, w.b.y - w.a.y) < MIN_WALL)) return undefined;
  if (droppedOpenings(space, walls, space.openings ?? []).length) return undefined;
  return set(withWalls(space, walls, shiftOpenings(space, walls)));
}

/** When a wall's start moves along its own line, its doors and windows stay where they were in the room. */
function shiftOpenings(space: Space, walls: readonly WallSegment[]): Opening[] {
  const before = new Map((space.walls ?? []).map((w) => [w.id, w]));
  return (space.openings ?? []).map((o) => {
    const old = before.get(o.wall);
    const now = walls.find((w) => w.id === o.wall);
    if (!old || !now || same(old.a, now.a)) return o;
    // Translating both ends carries the opening with the wall; its local offset stays fixed.
    if (now.a.x - old.a.x === now.b.x - old.b.x && now.a.y - old.a.y === now.b.y - old.b.y) return o;
    const f = wallFrame(old);
    const g = wallFrame(now);
    // Same direction: keep the opening's place by its distance from the old start.
    if (Math.abs(f.along.x * g.along.x + f.along.y * g.along.y - 1) > 1e-9) return o;
    const shift = (now.a.x - old.a.x) * f.along.x + (now.a.y - old.a.y) * f.along.y;
    return { ...o, offset: Math.round(o.offset - shift) };
  });
}

/** Set a wall's length by moving its end `b` along its direction (walls joined at `b` follow). */
export function setWallLength(project: Project, wallId: Id, length: number): Command | undefined {
  const wall = project.space.walls?.find((w) => w.id === wallId);
  if (!wall || !(length >= MIN_WALL)) return undefined;
  const f = wallFrame(wall);
  return moveWallEnd(project, wallId, 'b', { x: wall.a.x + f.along.x * length, y: wall.a.y + f.along.y * length });
}

/** Change a wall's thickness or height (null clears the height: it then follows the ceiling). */
export function updateWall(project: Project, wallId: Id, patch: { thickness?: number; height?: number | null }): Command | undefined {
  const { space } = project;
  if (!space.walls?.some((w) => w.id === wallId)) return undefined;
  const walls = space.walls.map((w) => {
    if (w.id !== wallId) return w;
    const { height: _h, ...rest } = w;
    const height = patch.height === undefined ? w.height : patch.height ?? undefined;
    return { ...rest, thickness: patch.thickness ?? w.thickness, ...(height === undefined ? {} : { height }) };
  });
  return set(withWalls(space, walls, space.openings ?? []));
}

/** Remove walls, doors and windows by id; a wall takes its doors and windows with it. */
export function removeWallsAndOpenings(project: Project, ids: readonly Id[]): Command | undefined {
  const { space } = project;
  const gone = new Set(ids);
  const walls = (space.walls ?? []).filter((w) => !gone.has(w.id));
  const openings = (space.openings ?? []).filter((o) => !gone.has(o.id));
  if (walls.length === (space.walls?.length ?? 0) && openings.length === (space.openings?.length ?? 0)) return undefined;
  return set(withWalls(space, walls, openings));
}

/** Where a point falls along a wall: distance from its start, and how far off the centre line. */
export function alongWall(wall: WallSegment, p: Vec2): { along: number; off: number } {
  const f = wallFrame(wall);
  const dx = p.x - wall.a.x;
  const dy = p.y - wall.a.y;
  return { along: dx * f.along.x + dy * f.along.y, off: dx * f.left.x + dy * f.left.y };
}

/** The wall nearest a point, within `reach` of its centre line, or undefined. */
export function wallAt(project: Project, p: Vec2, reach: number): WallSegment | undefined {
  let best: { wall: WallSegment; distance: number } | undefined;
  for (const wall of project.space.walls ?? []) {
    const { along, off } = alongWall(wall, p);
    const length = lengthOf(wall);
    const outside = along < 0 ? -along : along > length ? along - length : 0;
    const distance = Math.hypot(outside, Math.max(0, Math.abs(off) - wall.thickness / 2));
    if (distance <= reach && (!best || distance < best.distance)) best = { wall, distance };
  }
  return best?.wall;
}

/**
 * Put a door or window in a wall, centred on the point clicked, kept within the wall. A door
 * hinges at the jamb nearer the wall's start and opens to the side the click was on.
 */
export function addOpening(project: Project, wallId: Id, kind: 'door' | 'window', at: Vec2, width = kind === 'door' ? DEFAULT_DOOR : DEFAULT_WINDOW): { command: Command; id: Id } | undefined {
  const { space } = project;
  const wall = space.walls?.find((w) => w.id === wallId);
  if (!wall) return undefined;
  const length = Math.floor(lengthOf(wall));
  const w = Math.min(width, length);
  if (w < MIN_WALL) return undefined;
  const { along, off } = alongWall(wall, at);
  const offset = Math.round(Math.max(0, Math.min(length - w, along - w / 2)));
  const id = nextId(kind, takenIds(project));
  const opening: Opening =
    kind === 'door'
      ? { id, wall: wallId, kind, offset, width: w, hinge: 'start', side: off >= 0 ? 'left' : 'right' }
      : { id, wall: wallId, kind, offset, width: w };
  return { command: set(withWalls(space, space.walls!, [...(space.openings ?? []), opening])), id };
}

/** Change a door or window: slide it, resize it, flip its swing, set a window's sill and height. */
export function updateOpening(project: Project, id: Id, patch: Partial<Pick<Opening, 'offset' | 'width' | 'hinge' | 'side' | 'sill' | 'height'>>): Command | undefined {
  const { space } = project;
  const opening = space.openings?.find((o) => o.id === id);
  const wall = opening && space.walls?.find((w) => w.id === opening.wall);
  if (!opening || !wall) return undefined;
  const length = Math.floor(lengthOf(wall));
  const width = Math.max(MIN_WALL, Math.min(length, Math.round(patch.width ?? opening.width)));
  const offset = Math.max(0, Math.min(length - width, Math.round(patch.offset ?? opening.offset)));
  const next: Opening = { ...opening, ...patch, width, offset };
  return set(withWalls(space, space.walls!, space.openings!.map((o) => (o.id === id ? next : o))));
}

/** What updateOpening had to change from what was asked (cut to the wall's length), in words; undefined when nothing. */
export function openingNote(project: Project, id: Id, patch: Partial<Pick<Opening, 'offset' | 'width'>>): string | undefined {
  const opening = project.space.openings?.find((o) => o.id === id);
  const wall = opening && project.space.walls?.find((w) => w.id === opening.wall);
  if (!opening || !wall) return undefined;
  const length = Math.floor(lengthOf(wall));
  if (patch.width !== undefined && Math.round(patch.width) > length) return `The wall is only ${cmText(length)} long, so the ${opening.kind} was cut to fit.`;
  if (patch.width !== undefined && Math.round(patch.width) < MIN_WALL) return `A ${opening.kind} is at least ${cmText(MIN_WALL)} wide.`;
  const width = Math.round(patch.width ?? opening.width);
  if (patch.offset !== undefined && (Math.round(patch.offset) < 0 || Math.round(patch.offset) + width > length)) return `It was moved to stay inside the wall (${cmText(length)} long).`;
  return undefined;
}

export interface Snap {
  readonly point: Vec2;
  /** What it snapped to, for the guide drawn on the plan. */
  readonly to: 'end' | 'wall' | 'square' | 'grid' | 'none';
}

/**
 * Where a drawing click lands: on a wall end within `reach`, else on a wall's centre line, else
 * square to the previous point (horizontal or vertical when within 8°), else on the grid.
 */
export function snapWallPoint(project: Project, p: Vec2, reach: number, grid: number, from?: Vec2): Snap {
  let best: { point: Vec2; distance: number } | undefined;
  for (const w of project.space.walls ?? []) {
    for (const end of [w.a, w.b]) {
      const distance = Math.hypot(end.x - p.x, end.y - p.y);
      if (distance <= reach && (!best || distance < best.distance)) best = { point: end, distance };
    }
  }
  if (best) return { point: best.point, to: 'end' };
  const onGrid = (v: number) => (grid > 1 ? Math.round(v / grid) * grid : Math.round(v));
  let point = { x: onGrid(p.x), y: onGrid(p.y) };
  let to: Snap['to'] = grid > 1 ? 'grid' : 'none';
  if (from) {
    const dx = p.x - from.x;
    const dy = p.y - from.y;
    const angle = Math.abs((Math.atan2(dy, dx) * 180) / Math.PI);
    const tilt = Math.min(angle % 90, 90 - (angle % 90));
    if (tilt <= 8) {
      point = Math.abs(dx) >= Math.abs(dy) ? { x: onGrid(p.x), y: from.y } : { x: from.x, y: onGrid(p.y) };
      to = 'square';
    }
  }
  const wall = wallAt(project, point, reach);
  if (wall) {
    const { along } = alongWall(wall, point);
    const f = wallFrame(wall);
    const t = Math.max(0, Math.min(f.length, along));
    const on = round({ x: wall.a.x + f.along.x * t, y: wall.a.y + f.along.y * t });
    // Keep a square line square: slide along it to the wall, rather than jumping off it.
    if (to !== 'square' || (from && (on.x === from.x || on.y === from.y))) return { point: on, to: 'wall' };
  }
  return { point, to };
}

/** The end of a wall drawn from `from` toward `toward`, exactly `length` long. */
export function pointAtLength(from: Vec2, toward: Vec2, length: number): Vec2 {
  const dx = toward.x - from.x;
  const dy = toward.y - from.y;
  const d = Math.hypot(dx, dy) || 1;
  return round({ x: from.x + (dx / d) * length, y: from.y + (dy / d) * length });
}

/**
 * Name a room found from the walls: its naming zones are replaced by one small `room` zone at
 * the room's label point carrying the name (an empty name removes them). The zone only names the
 * room; the area still comes from the walls.
 */
export function nameRoom(project: Project, room: { readonly label: Vec2; readonly zoneIds: readonly Id[] }, name: string): Command | undefined {
  const { space } = project;
  const text = name.trim().slice(0, 60);
  const gone = new Set(room.zoneIds);
  const zones = (space.zones ?? []).filter((z) => !gone.has(z.id));
  if (text) {
    const c = round(room.label);
    const h = 500;
    const taken = takenIds(project);
    zones.push({ id: nextId('room', taken), kind: 'room', polygon: [{ x: c.x - h, y: c.y - h }, { x: c.x + h, y: c.y - h }, { x: c.x + h, y: c.y + h }, { x: c.x - h, y: c.y + h }], meta: { label: text } });
  }
  const { zones: _z, ...rest } = space;
  return set(zones.length ? { ...rest, zones } : rest);
}

/**
 * A typed wall length. With a unit it is exact: "3.15 m", "315 cm", "3150 mm". Without one:
 * a number with a decimal point is metres ("3.15", "3,15", "٣٫١٥"); a whole number is metres when
 * a wall that long fits the place being drawn (up to 1.5 × its largest side, and never less than
 * 30 m), else centimetres. So in a 12 m flat "12" is 12 m and "35" is 35 cm, while in a 60 m
 * warehouse "35" is 35 m. The readout always shows the result; a unit settles any doubt.
 * `span` is the largest side of the place in ticks. Undefined when it is not a length.
 */
export function typedLength(text: string, span = 0): number | undefined {
  const m = /^\s*([0-9٠-٩.,٫]+)\s*(mm|cm|m|م|سم)?\s*$/i.exec(text);
  if (!m) return undefined;
  const n = parseNumber(m[1]!);
  if (!Number.isFinite(n) || n <= 0) return undefined;
  const unit = m[2]?.toLowerCase();
  const metres = unit === 'mm' ? n / 1000 : unit === 'cm' || unit === 'سم' ? n / 100 : unit === 'm' || unit === 'م' ? n : /[.,٫]/.test(m[1]!) || n <= Math.max(30, (1.5 * span) / 10_000) ? n : n / 100;
  return Math.round(metres * 10_000);
}

/** True when the typed text has no unit and no decimal point, so its unit was guessed. */
export function typedLengthGuessed(text: string): boolean {
  return /^\s*[0-9٠-٩]+\s*$/.test(text);
}
