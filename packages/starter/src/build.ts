import {
  createProject,
  createSpace,
  fromUnit,
  rectangleBoundary,
  validateProject,
  type Opening,
  type Project,
  type Tick,
  type WallSegment,
  type Zone,
} from '@space-planner/core';
import { HOME_CATALOG, HOME_INNER_WALL, HOME_OUTER_WALL } from './home.js';

/**
 * A flat from its measurements in one step (decision 0029): rooms as rectangles on their wall
 * centre lines, doors between named rooms, windows on a room's side and the entrance. Every wall
 * is derived once: an edge two rooms share is one 10 cm partition, an edge with a room on one side
 * only is a 20 cm outer wall. Agents read the client's file (text, table, PDF) and call this; the
 * person can then edit any wall on the plan.
 */

export type Side = 'south' | 'north' | 'west' | 'east';

export interface RoomRect {
  readonly name: string;
  /** A home room kind (living, bedroom…); guessed from the name when left out. */
  readonly kind?: string;
  /** South-west corner and size, metres, on the wall centre lines. */
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly depth: number;
}

export interface FlatSpec {
  readonly name: string;
  readonly rooms: readonly RoomRect[];
  /** A door in the wall two rooms share; `at` from the west or south end of the shared part, metres (default 15 cm). */
  readonly doors?: ReadonlyArray<{ readonly between: readonly [string, string]; readonly width?: number; readonly at?: number }>;
  /** The front door, in an outer wall of a room; `at` from that side's west or south end (default centred). */
  readonly entrance?: { readonly room: string; readonly side: Side; readonly width?: number; readonly at?: number };
  readonly windows?: ReadonlyArray<{ readonly room: string; readonly side: Side; readonly width?: number; readonly at?: number; readonly sill?: number; readonly height?: number }>;
  /** Ceiling height, metres (default 2.8). */
  readonly ceiling?: number;
}

/** Why a flat cannot be built, in words for the person or agent who described it. */
export class FlatError extends Error {}

const KIND_WORDS: ReadonlyArray<readonly [string, RegExp]> = [
  ['bathroom', /bath|wc|toilet|shower|حمام|تواليت/i],
  ['kitchen', /kitchen|مطبخ/i],
  ['bedroom', /bed|master|نوم/i],
  ['dining', /dining|سفرة|طعام/i],
  ['study', /study|office|مكتب/i],
  ['hall', /hall|corridor|entry|lobby|طرقة|مدخل|ممر/i],
  ['living', /living|lounge|reception|salon|family|معيشة|ريسبشن|صالة|استقبال/i],
];

/** The room kind a name suggests (bedroom, bathroom…), or `room`. */
export function roomKindOf(name: string): string {
  return KIND_WORDS.find(([, words]) => words.test(name))?.[0] ?? 'room';
}

interface Rect {
  readonly name: string;
  readonly x0: Tick;
  readonly y0: Tick;
  readonly x1: Tick;
  readonly y1: Tick;
}

const m = (v: number) => fromUnit(Math.round(v * 1000) / 1000, 'm');
/** Rooms where a door opens into rather than out of: the private side. */
const PRIVATE = new Set(['bathroom', 'bedroom', 'study']);

interface Run {
  readonly axis: 'x' | 'y';
  /** The line: y for a wall running east-west, x for one running north-south. */
  readonly at: Tick;
  readonly from: Tick;
  readonly to: Tick;
  readonly outer: boolean;
}

/** Every wall along the room edges: shared stretches are partitions, the rest outer walls. */
function wallRuns(rects: readonly Rect[]): Run[] {
  const runs: Run[] = [];
  for (const axis of ['x', 'y'] as const) {
    // axis 'x': walls running east-west, on lines y = const.
    const lines = new Map<Tick, Array<[Tick, Tick]>>();
    for (const r of rects) {
      const edges: Array<[Tick, Tick, Tick]> = axis === 'x' ? [[r.y0, r.x0, r.x1], [r.y1, r.x0, r.x1]] : [[r.x0, r.y0, r.y1], [r.x1, r.y0, r.y1]];
      for (const [at, a, b] of edges) lines.set(at, [...(lines.get(at) ?? []), [a, b]]);
    }
    for (const at of [...lines.keys()].sort((a, b) => a - b)) {
      const spans = lines.get(at)!;
      const cuts = [...new Set(spans.flat())].sort((a, b) => a - b);
      let current: { from: Tick; to: Tick; outer: boolean } | null = null;
      for (let i = 0; i + 1 < cuts.length; i++) {
        const [a, b] = [cuts[i]!, cuts[i + 1]!];
        if (!spans.some(([s, e]) => s <= a && e >= b)) {
          if (current) runs.push({ axis, at, ...current });
          current = null;
          continue;
        }
        const mid = (a + b) / 2;
        const has = (offset: number) => rects.some((r) => (axis === 'x' ? mid > r.x0 && mid < r.x1 && at + offset > r.y0 && at + offset < r.y1 : mid > r.y0 && mid < r.y1 && at + offset > r.x0 && at + offset < r.x1));
        const outer = !(has(-1) && has(1));
        if (current && current.outer === outer && current.to === a) current.to = b;
        else {
          if (current) runs.push({ axis, at, ...current });
          current = { from: a, to: b, outer };
        }
      }
      if (current) runs.push({ axis, at, ...current });
    }
  }
  return runs;
}

/** Builds the flat; throws {@link FlatError} with a plain reason when the description does not hold together. */
export function buildFlat(spec: FlatSpec): Project {
  if (!spec.rooms.length) throw new FlatError('a flat needs at least one room');
  const names = new Set<string>();
  const rects: Rect[] = spec.rooms.map((r) => {
    if (!r.name.trim()) throw new FlatError('every room needs a name');
    if (names.has(r.name)) throw new FlatError(`two rooms are called "${r.name}"`);
    names.add(r.name);
    if (![r.x, r.y, r.width, r.depth].every(Number.isFinite) || r.width < 0.5 || r.depth < 0.5 || r.width > 200 || r.depth > 200) {
      throw new FlatError(`room "${r.name}": width and depth must be 0.5 to 200 m`);
    }
    return { name: r.name, x0: m(r.x), y0: m(r.y), x1: m(r.x + r.width), y1: m(r.y + r.depth) };
  });
  for (let i = 0; i < rects.length; i++) {
    for (let j = i + 1; j < rects.length; j++) {
      const a = rects[i]!;
      const b = rects[j]!;
      if (Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0) > 0 && Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0) > 0) throw new FlatError(`rooms "${a.name}" and "${b.name}" overlap`);
    }
  }
  const byName = new Map(rects.map((r) => [r.name, r]));
  const room = (name: string) => {
    const r = byName.get(name);
    if (!r) throw new FlatError(`there is no room called "${name}"`);
    return r;
  };

  const runs = wallRuns(rects);
  const walls: WallSegment[] = runs.map((run, i) => ({
    id: `wall-${i + 1}`,
    a: run.axis === 'x' ? { x: run.from, y: run.at } : { x: run.at, y: run.from },
    b: run.axis === 'x' ? { x: run.to, y: run.at } : { x: run.at, y: run.to },
    thickness: run.outer ? HOME_OUTER_WALL : HOME_INNER_WALL,
  }));
  /** The wall on a line holding [from, to], and the offset of `from` along it. */
  const wallOn = (axis: 'x' | 'y', at: Tick, from: Tick, to: Tick, what: string) => {
    const i = runs.findIndex((r) => r.axis === axis && r.at === at && r.from <= from && r.to >= to);
    if (i < 0) throw new FlatError(`${what}: no single wall runs there`);
    return { wall: walls[i]!, run: runs[i]!, offset: from - runs[i]!.from };
  };

  const openings: Opening[] = [];
  const take = (wanted: number | undefined, fallback: number) => (wanted === undefined ? fallback : m(wanted));
  const kindOf = (name: string) => spec.rooms.find((r) => r.name === name)?.kind ?? roomKindOf(name);

  (spec.doors ?? []).forEach((d, i) => {
    const [a, b] = [room(d.between[0]), room(d.between[1])];
    const what = `door between "${a.name}" and "${b.name}"`;
    // The stretch of wall they share.
    let axis: 'x' | 'y';
    let at: Tick;
    let s0: Tick;
    let s1: Tick;
    if (a.y1 === b.y0 || a.y0 === b.y1) [axis, at, s0, s1] = ['x', a.y1 === b.y0 ? a.y1 : a.y0, Math.max(a.x0, b.x0), Math.min(a.x1, b.x1)];
    else if (a.x1 === b.x0 || a.x0 === b.x1) [axis, at, s0, s1] = ['y', a.x1 === b.x0 ? a.x1 : a.x0, Math.max(a.y0, b.y0), Math.min(a.y1, b.y1)];
    else throw new FlatError(`${what}: the rooms do not share a wall`);
    const width = take(d.width, 8_000);
    // Clear of the walls that meet at the ends of the shared stretch.
    const start = s0 + take(d.at, 1_500);
    if (s1 - s0 < width + 2 * HOME_INNER_WALL || start + width > s1 - HOME_INNER_WALL / 2 || start < s0 + HOME_INNER_WALL / 2) throw new FlatError(`${what}: the shared wall is too short for a ${width / 100} cm door there`);
    const { wall, offset } = wallOn(axis, at, start, start + width, what);
    // It opens into the private room (bedroom, bath, study), else into the second room named.
    const into = PRIVATE.has(kindOf(a.name)) && !PRIVATE.has(kindOf(b.name)) ? a : b;
    const intoHigher = axis === 'x' ? into.y0 >= at : into.x0 >= at;
    // A wall runs east or north; its left is north (east-west wall) or west (north-south wall).
    const side = axis === 'x' ? (intoHigher ? 'left' : 'right') : intoHigher ? 'right' : 'left';
    const nearStart = offset < (runs[walls.indexOf(wall)]!.to - runs[walls.indexOf(wall)]!.from) / 2;
    openings.push({ id: `door-${i + 1}`, wall: wall.id, kind: 'door', offset, width, hinge: nearStart ? 'start' : 'end', side });
  });

  const onSide = (r: Rect, side: Side, width: Tick, wanted: number | undefined, what: string) => {
    const axis: 'x' | 'y' = side === 'south' || side === 'north' ? 'x' : 'y';
    const at = side === 'south' ? r.y0 : side === 'north' ? r.y1 : side === 'west' ? r.x0 : r.x1;
    const [s0, s1] = axis === 'x' ? [r.x0, r.x1] : [r.y0, r.y1];
    const start = wanted === undefined ? Math.round((s0 + s1 - width) / 2) : s0 + m(wanted);
    if (start < s0 + HOME_OUTER_WALL / 2 || start + width > s1 - HOME_OUTER_WALL / 2) throw new FlatError(`${what}: it does not fit on the ${side} side of "${r.name}"`);
    const found = wallOn(axis, at, start, start + width, what);
    if (!found.run.outer) throw new FlatError(`${what}: the ${side} side of "${r.name}" is an inside wall`);
    // Opening inward: the room lies north of a south wall, west of an east wall…
    const side2: 'left' | 'right' = side === 'south' || side === 'east' ? 'left' : 'right';
    return { ...found, side: side2 };
  };

  if (spec.entrance) {
    const e = spec.entrance;
    const width = take(e.width, 9_000);
    const { wall, offset, side } = onSide(room(e.room), e.side, width, e.at, 'the entrance');
    openings.push({ id: 'front-door', wall: wall.id, kind: 'door', offset, width, hinge: 'start', side, meta: { role: 'entrance' } });
  }
  (spec.windows ?? []).forEach((w, i) => {
    const width = take(w.width, 12_000);
    const { wall, offset } = onSide(room(w.room), w.side, width, w.at, `window in "${w.room}"`);
    openings.push({ id: `window-${i + 1}`, wall: wall.id, kind: 'window', offset, width, ...(w.sill === undefined ? {} : { sill: m(w.sill) }), ...(w.height === undefined ? {} : { height: m(w.height) }) });
  });
  const taken = openings.map((o) => [o.wall, o.offset, o.offset + o.width] as const);
  taken.forEach(([wall, a, b], i) => {
    const clash = taken.findIndex(([w2, c, d], j) => j > i && w2 === wall && Math.min(b, d) > Math.max(a, c));
    if (clash >= 0) throw new FlatError(`${openings[i]!.id} and ${openings[clash]!.id} overlap in the same wall`);
  });

  const half = HOME_OUTER_WALL / 2;
  const minX = Math.min(...rects.map((r) => r.x0)) - half;
  const minY = Math.min(...rects.map((r) => r.y0)) - half;
  const maxX = Math.max(...rects.map((r) => r.x1)) + half;
  const maxY = Math.max(...rects.map((r) => r.y1)) + half;
  // The plan's origin is the outside south-west corner, as for every home shell.
  const shift = (p: { x: Tick; y: Tick }) => ({ x: p.x - minX, y: p.y - minY });
  const zones: Zone[] = rects.map((r, i) => ({
    id: `room-${i + 1}`,
    kind: kindOf(r.name),
    polygon: [shift({ x: r.x0, y: r.y0 }), shift({ x: r.x1, y: r.y0 }), shift({ x: r.x1, y: r.y1 }), shift({ x: r.x0, y: r.y1 })],
    meta: { label: r.name.slice(0, 60) },
  }));
  const space = createSpace(rectangleBoundary(maxX - minX, maxY - minY), {
    walls: walls.map((w) => ({ ...w, a: shift(w.a), b: shift(w.b) })),
    openings,
    zones,
    ceilingHeight: m(spec.ceiling ?? 2.8),
    meta: { pack: 'home' },
  });
  const project: Project = { ...createProject('new', spec.name, space), catalog: Object.fromEntries(HOME_CATALOG.map((d) => [d.id, d])) };
  const problems = validateProject(project);
  if (problems.length) throw new FlatError(`the flat does not hold together: ${problems.map((p) => `${p.path}: ${p.message}`).join('; ')}`);
  return project;
}
