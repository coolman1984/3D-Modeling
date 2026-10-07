import {
  boundsOf,
  checkProject,
  itemPolygon,
  locatePoint,
  openingPolygon,
  openingSwingPolygon,
  polygonsOverlap,
  roomMap,
  wallSolids,
  type Command,
  type Id,
  type ItemDefinition,
  type ItemInstance,
  type Meta,
  type Project,
  type Tick,
  type Vec2,
} from '@space-planner/core';
import { roomKindOf } from './build.js';
import { checkHome, FABRICS, HOME_CATALOG, type Fabric } from './home.js';

/**
 * Furnishing options (decision 0029): the way an interior designer works a room. For each room
 * a few professional arrangements are tried against every wall (the bed's head on a solid wall
 * seen from the door, the sofa facing the focal wall with the coffee table 40–45 cm in front, the
 * dining table centred under its pendant, the kitchen run on the longest free wall…). Only those
 * that pass the core checks and keep doorways and windows clear survive; they are scored and the
 * best distinct ones are offered with their reasons in words. Each option also carries a finish
 * palette, so the options differ in look as well as in arrangement. Deterministic: the same flat
 * always gives the same options.
 */

import type { Side } from './build.js';

/** A part of the flat to furnish: a room, or one named area of an open-plan room. */
export interface FurnishArea {
  readonly name: string;
  readonly kind: string;
  /** Clear floor rectangle, ticks. */
  readonly x0: Tick;
  readonly y0: Tick;
  readonly x1: Tick;
  readonly y1: Tick;
  /** The detected room it lies in (index into the rooms found from the walls). */
  readonly room: number;
}

export interface Palette {
  readonly id: string;
  readonly name: string;
  readonly fabric: Fabric;
  readonly accent: Fabric;
  readonly wood: string;
  readonly sofa: string;
  readonly rug: string;
}

/** Three looks, one per option: the finishes change with the arrangement. */
export const PALETTES: readonly Palette[] = [
  { id: 'oak-linen', name: 'Warm oak and linen', fabric: 'linen', accent: 'terracotta', wood: 'oak', sofa: 'home-sofa-linen', rug: 'home-rug-cream' },
  { id: 'walnut-sage', name: 'Walnut and sage', fabric: 'sage', accent: 'ochre', wood: 'walnut', sofa: 'home-sofa-sage', rug: 'home-rug-terracotta' },
  { id: 'charcoal-white', name: 'Charcoal and white', fabric: 'charcoal', accent: 'navy', wood: 'white', sofa: 'home-sofa-charcoal', rug: 'home-rug-cream' },
];

interface Placement {
  readonly def: ItemDefinition;
  readonly position: Vec2;
  readonly rotation: number;
  readonly elevation?: Tick;
  /** A finishing touch (rug, lamp, art, plant…): left out when it does not fit, the rest stays. */
  readonly extra?: string;
}

/** One way to furnish one area. */
export interface Arrangement {
  /** Which wall or layout it is built on, so options can be told apart. */
  readonly key: string;
  readonly title: string;
  readonly reasons: readonly string[];
  readonly score: number;
  readonly items: readonly Placement[];
}

const CATALOG = new Map(HOME_CATALOG.map((d) => [d.id, d]));
const def = (id: string) => CATALOG.get(id)!;
/** Metres to ticks. */
const m = (v: number) => Math.round(v * 10_000);
const STEP = 500; // 5 cm
/** Areas whose pieces people sit at: furnished after the rest, so their walkways stay open. */
/** Kinds of room the engine knows how to furnish. */
const HAS_RECIPE = new Set(['bedroom', 'living', 'dining', 'kitchen', 'bathroom', 'study', 'hall', 'laundry']);
const SEATING = new Set(['living', 'dining', 'study']);

/** The areas to furnish: each detected room, split into its named zones when it holds several. */
export function furnishAreas(project: Project): FurnishArea[] {
  const map = roomMap(project.space);
  const areas: FurnishArea[] = [];
  map.rooms.forEach((room, index) => {
    const zones = (project.space.zones ?? []).filter((z) => {
      const b = boundsOf(z.polygon);
      return map.roomAt({ x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2 }) === index;
    });
    const label = (z: (typeof zones)[number]) => (typeof z.meta?.label === 'string' ? z.meta.label : z.kind);
    if (zones.length <= 1) {
      const name = zones[0] ? label(zones[0]) : `Room ${index + 1}`;
      const named = zones[0] && zones[0].kind !== 'room' ? zones[0].kind : roomKindOf(name);
      // A room with a name we do not know (a balcony, a store) is left alone. A room with no name at
      // all is read by its size: the largest is the living room, a small one a bath, the rest bedrooms.
      const largest = map.rooms.every((other) => other.area <= room.area);
      const kind = zones[0] ? named : largest ? 'living' : room.area < 600_000_000 ? 'bathroom' : 'bedroom';
      areas.push({ name, kind, x0: room.min.x, y0: room.min.y, x1: room.max.x, y1: room.max.y, room: index });
      return;
    }
    for (const z of zones) {
      const b = boundsOf(z.polygon);
      const name = label(z);
      areas.push({
        name,
        kind: z.kind !== 'room' ? z.kind : roomKindOf(name),
        x0: Math.max(room.min.x, Math.round(b.minX)),
        y0: Math.max(room.min.y, Math.round(b.minY)),
        x1: Math.min(room.max.x, Math.round(b.maxX)),
        y1: Math.min(room.max.y, Math.round(b.maxY)),
        room: index,
      });
    }
  });
  // A large reception with no dining room of its own: the designer gives it a dining end.
  if (!areas.some((a) => a.kind === 'dining')) {
    const i = areas.findIndex((a) => a.kind === 'living' && (a.x1 - a.x0) * (a.y1 - a.y0) >= 240_000_000 && Math.max(a.x1 - a.x0, a.y1 - a.y0) >= 60_000);
    if (i >= 0) {
      const a = areas[i]!;
      const alongX = a.x1 - a.x0 >= a.y1 - a.y0;
      const cut = alongX ? Math.round(a.x0 + (a.x1 - a.x0) * 0.58) : Math.round(a.y0 + (a.y1 - a.y0) * 0.58);
      const living = alongX ? { ...a, x1: cut } : { ...a, y1: cut };
      const dining = alongX ? { ...a, name: `${a.name} · dining`, kind: 'dining', x0: cut } : { ...a, name: `${a.name} · dining`, kind: 'dining', y0: cut };
      areas.splice(i, 1, living, dining);
    }
  }
  return areas;
}

// ─── Geometry of an area ──────────────────────────────────────────────────────────────────────

/** Rotation that puts an item's back on this wall and its front into the room. */
const ROTATION: Readonly<Record<Side, number>> = { south: 0, east: 90_000, north: 180_000, west: 270_000 };
const OPPOSITE: Readonly<Record<Side, Side>> = { south: 'north', north: 'south', west: 'east', east: 'west' };
const SIDES: readonly Side[] = ['south', 'west', 'north', 'east'];

class Area {
  readonly solids: Vec2[][];
  readonly keepOut: Vec2[][] = [];
  readonly windows: Array<{ side: Side; from: Tick; to: Tick }> = [];
  readonly doors: Array<{ side: Side; from: Tick; to: Tick }> = [];
  constructor(readonly project: Project, readonly a: FurnishArea) {
    const { space } = project;
    this.solids = wallSolids(space, { doors: false }).map((s) => [...s.polygon]);
    for (const o of space.openings ?? []) {
      const gap = openingPolygon(space, o);
      if (!gap) continue;
      const box = boundsOf(gap);
      const side = this.sideOf(box);
      if (!side) continue;
      const along = side === 'south' || side === 'north' ? [box.minX, box.maxX] : [box.minY, box.maxY];
      if (o.kind === 'window') {
        this.windows.push({ side, from: along[0]!, to: along[1]! });
        continue;
      }
      this.doors.push({ side, from: along[0]!, to: along[1]! });
      const swing = openingSwingPolygon(space, o);
      if (swing) this.keepOut.push([...swing]);
      // The way through the door: 90 cm deep into the room, a little wider than the opening.
      const d = 9_000;
      const pad = 1_000;
      const [f, t] = [along[0]! - pad, along[1]! + pad];
      this.keepOut.push(
        side === 'south' ? rect(f, this.a.y0, t, this.a.y0 + d)
          : side === 'north' ? rect(f, this.a.y1 - d, t, this.a.y1)
            : side === 'west' ? rect(this.a.x0, f, this.a.x0 + d, t)
              : rect(this.a.x1 - d, f, this.a.x1, t),
      );
    }
  }

  /** Which side of this area an opening's box lies on (within 30 cm of it, overlapping its span). */
  private sideOf(box: { minX: number; minY: number; maxX: number; maxY: number }): Side | undefined {
    const { x0, y0, x1, y1 } = this.a;
    const near = 3_000;
    const spanX = box.maxX > x0 && box.minX < x1;
    const spanY = box.maxY > y0 && box.minY < y1;
    if (spanX && Math.abs(box.maxY - y0) <= near && box.minY < y0) return 'south';
    if (spanX && Math.abs(box.minY - y1) <= near && box.maxY > y1) return 'north';
    if (spanY && Math.abs(box.maxX - x0) <= near && box.minX < x0) return 'west';
    if (spanY && Math.abs(box.minX - x1) <= near && box.maxX > x1) return 'east';
    return undefined;
  }

  length(side: Side): Tick {
    return side === 'south' || side === 'north' ? this.a.x1 - this.a.x0 : this.a.y1 - this.a.y0;
  }

  /** Start of a side's span (west end or south end). */
  start(side: Side): Tick {
    return side === 'south' || side === 'north' ? this.a.x0 : this.a.y0;
  }

  /** Room across from a side to the opposite one. */
  across(side: Side): Tick {
    return side === 'south' || side === 'north' ? this.a.y1 - this.a.y0 : this.a.x1 - this.a.x0;
  }

  /** A point on a side at `along`, `off` into the room. */
  point(side: Side, along: Tick, off: Tick): Vec2 {
    const { x0, y0, x1, y1 } = this.a;
    switch (side) {
      case 'south':
        return { x: along, y: y0 + off };
      case 'north':
        return { x: along, y: y1 - off };
      case 'west':
        return { x: x0 + off, y: along };
      case 'east':
        return { x: x1 - off, y: along };
    }
  }

  /** True where a wall stands right behind the side at `along` (not an open edge, a door or a window). */
  solidAt(side: Side, along: Tick): boolean {
    const p = this.point(side, along, -300);
    if (!this.solids.some((s) => locatePoint(s, p) !== 'outside')) return false;
    return !this.doors.some((d) => d.side === side && along >= d.from - 500 && along <= d.to + 500);
  }

  /** The longest run of solid wall on a side: [from, to] along it, or undefined. */
  solidRuns(side: Side): Array<[Tick, Tick]> {
    const runs: Array<[Tick, Tick]> = [];
    const s0 = this.start(side);
    const s1 = s0 + this.length(side);
    let from: Tick | null = null;
    for (let t = s0 + STEP / 2; t < s1; t += STEP) {
      const solid = this.solidAt(side, t);
      if (solid && from === null) from = t - STEP / 2;
      if (!solid && from !== null) {
        runs.push([from, t - STEP / 2]);
        from = null;
      }
    }
    if (from !== null) runs.push([from, s1]);
    return runs.sort((p, q) => q[1] - q[0] - (p[1] - p[0]) || p[0] - q[0]);
  }

  /** Where to centre something `width` wide against a side: the middle of the longest solid run that holds it. */
  slot(side: Side, width: Tick, prefer: 'middle' | 'start' | 'end' = 'middle'): Tick | undefined {
    const run = this.solidRuns(side).find(([a, b]) => b - a >= width);
    if (!run) return undefined;
    const [a, b] = run;
    if (prefer === 'start') return a + width / 2;
    if (prefer === 'end') return b - width / 2;
    return Math.round((a + b) / 2);
  }

  /** True when a solid wall runs behind the whole of [along − width/2, along + width/2] on a side. */
  fits(side: Side, along: Tick, width: Tick): boolean {
    const s0 = this.start(side);
    if (along - width / 2 < s0 || along + width / 2 > s0 + this.length(side)) return false;
    for (let t = along - width / 2 + STEP / 2; t < along + width / 2; t += STEP) if (!this.solidAt(side, t)) return false;
    return true;
  }

  /** Positions along a side, every 5 cm, nearest the middle first. */
  stops(side: Side): Tick[] {
    const s0 = this.start(side);
    const mid = s0 + this.length(side) / 2;
    const out: Tick[] = [];
    for (let t = s0; t <= s0 + this.length(side); t += STEP) out.push(t);
    return out.sort((a, b) => Math.abs(a - mid) - Math.abs(b - mid) || a - b);
  }

  /** Items standing against a side: back on the wall, front to the room. */
  against(d: ItemDefinition, side: Side, along: Tick, off = 0, elevation?: Tick): Placement {
    const position = this.point(side, along, off + d.size.d / 2);
    return { def: d, position: { x: Math.round(position.x), y: Math.round(position.y) }, rotation: ROTATION[side], ...(elevation ? { elevation } : {}) };
  }

  windowOn(side: Side, from: Tick, to: Tick): boolean {
    return this.windows.some((w) => w.side === side && Math.min(to, w.to) > Math.max(from, w.from));
  }

  doorOn(side: Side): boolean {
    return this.doors.some((d) => d.side === side);
  }

  centre(): Vec2 {
    return { x: Math.round((this.a.x0 + this.a.x1) / 2), y: Math.round((this.a.y0 + this.a.y1) / 2) };
  }
}

function rect(x0: number, y0: number, x1: number, y1: number): Vec2[] {
  return [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }];
}

const wallElevation = (d: ItemDefinition) => (typeof d.meta?.elevation === 'number' ? (d.meta.elevation as Tick) : undefined);

// ─── Recipes: how a designer lays out each kind of room ────────────────────────────────────────

const extra = (p: Placement, note: string): Placement => ({ ...p, extra: note });

type Draft = { key: string; title: string; reasons: string[]; bonus: number; items: Placement[] };

function bedroom(r: Area): Draft[] {
  const drafts: Draft[] = [];
  const w = r.a.x1 - r.a.x0;
  const d = r.a.y1 - r.a.y0;
  const small = Math.min(w, d);
  const bedId = small >= m(3.4) ? 'home-bed-king' : small >= m(3.0) ? 'home-bed-queen' : 'home-bed-single';
  const bed = def(bedId);
  const stand = def('home-nightstand');
  for (const side of SIDES) {
    // Room past the foot of the bed to walk and open a wardrobe.
    if (r.across(side) < bed.size.d + m(0.7)) continue;
    const needed = bed.size.w + (bedId === 'home-bed-single' ? stand.size.w + 300 : 2 * (stand.size.w + 300));
    const at = r.slot(side, needed) ?? r.slot(side, bed.size.w);
    if (at === undefined) continue;
    const items: Placement[] = [r.against(bed, side, at)];
    const reasons: string[] = [];
    let bonus = 0;
    const withStands = r.slot(side, needed) !== undefined;
    if (withStands) {
      const off = bed.size.w / 2 + stand.size.w / 2 + 300;
      items.push(r.against(stand, side, at - off));
      if (bedId !== 'home-bed-single') items.push(r.against(stand, side, at + off));
      reasons.push(bedId === 'home-bed-single' ? 'A nightstand within reach of the bed.' : 'Nightstands on both sides, so both sleepers have a lamp and a shelf.');
    }
    if (!r.doorOn(side)) {
      bonus += 10;
      reasons.push(`The bed's head rests on a solid ${side} wall, away from the door, and the bed is seen from the doorway.`);
    }
    if (r.windowOn(side, at - bed.size.w / 2, at + bed.size.w / 2)) {
      bonus -= 12;
      reasons.push('The head is under the window: no draught and morning light on the face are not guaranteed.');
    } else if (r.windows.length) {
      bonus += 4;
      reasons.push('The window stays free for light and air.');
    }
    // Rug under the lower two-thirds of the bed, wider than it.
    const rug = def('home-rug-cream');
    const toward = r.point(side, at, bed.size.d * 0.62);
    items.push(extra({ def: rug, position: { x: Math.round(toward.x), y: Math.round(toward.y) }, rotation: ROTATION[side] }, 'A rug under the lower part of the bed: warm underfoot on both sides.'));
    const art = def('home-art-90');
    items.push(extra(r.against(art, side, at, 0, wallElevation(art)), 'A print centred above the headboard.'));
    // Wardrobe on another wall: the longest solid run not behind the bed.
    const wardrobeId = small >= m(3.2) ? 'home-wardrobe-3' : 'home-wardrobe-2';
    const wardrobe = def(wardrobeId);
    for (const other of SIDES.filter((s) => s !== side)) {
      const spot = r.slot(other, wardrobe.size.w, 'end');
      if (spot === undefined || r.windowOn(other, spot - wardrobe.size.w / 2, spot + wardrobe.size.w / 2)) continue;
      drafts.push({
        key: `bed-${side}-wardrobe-${other}`,
        title: `Bed against the ${side} wall, wardrobe on the ${other} wall`,
        reasons: [...reasons, `The wardrobe stands on the ${other} wall with 90 cm free in front to open its doors.`],
        bonus,
        items: [...items, r.against(wardrobe, other, spot)],
      });
    }
    drafts.push({ key: `bed-${side}`, title: `Bed against the ${side} wall`, reasons, bonus: bonus - 8, items });
  }
  return drafts;
}

function living(r: Area, palette: Palette): Draft[] {
  const drafts: Draft[] = [];
  const tv = def('home-tv-unit');
  const coffee = def('home-coffee-oak');
  const lamp = def('home-floor-lamp');
  const side = def('home-side-table');
  const plant = def('home-plant-fig');
  for (const tvSide of SIDES) {
    const sofaSide = OPPOSITE[tvSide];
    const depth = r.across(tvSide);
    for (const sofaId of [palette.sofa, 'home-sectional', 'home-loveseat']) {
      const sofa = def(sofaId);
      const kind = sofaId === 'home-sectional' ? 'corner' : sofaId === 'home-loveseat' ? 'loveseat' : 'sofa';
      if (depth < sofa.size.d + m(0.4) + coffee.size.d + m(0.8) + tv.size.d) continue;
      // A sofa 2.4–3.2 m from the screen: against its wall in a small room, floating in a large one.
      // Eye to screen about 2.5–3.2 m for a 65″ screen: the sofa's front edge at most 2.75 m away.
      const viewing = Math.min(depth - tv.size.d - sofa.size.d, m(3.2) - sofa.size.d / 2);
      const floats = depth - tv.size.d - sofa.size.d > m(3.4);
      const sofaOff = floats ? depth - tv.size.d - viewing - sofa.size.d : 0;
      // In an open plan the sofa's back may face the next area instead of a wall.
      const openBehind = r.solidRuns(sofaSide).length === 0;
      // Screen and sofa on one axis: the first spot from the middle where both have their wall.
      const tvAt = r.stops(tvSide).find((t) => r.fits(tvSide, t, tv.size.w) && (floats || openBehind || r.fits(sofaSide, t, sofa.size.w)));
      if (tvAt === undefined) continue;
      const sofaAlong = tvAt;
      const items: Placement[] = [r.against(tv, tvSide, tvAt), r.against(sofa, sofaSide, sofaAlong, sofaOff)];
      const sofaFront = sofaOff + sofa.size.d;
      const coffeeAt = r.point(sofaSide, sofaAlong, sofaFront + m(0.42) + coffee.size.d / 2);
      items.push({ def: coffee, position: { x: Math.round(coffeeAt.x), y: Math.round(coffeeAt.y) }, rotation: ROTATION[sofaSide] });
      const rug = def(palette.rug);
      const rugAt = r.point(sofaSide, sofaAlong, sofaFront - m(0.2) + rug.size.d / 2);
      items.push(extra({ def: rug, position: { x: Math.round(rugAt.x), y: Math.round(rugAt.y) }, rotation: ROTATION[sofaSide] }, 'The rug runs under the front legs of the sofa and holds the group together.'));
      const lampAt = r.point(sofaSide, sofaAlong - sofa.size.w / 2 - m(0.35), sofaOff + m(0.3));
      items.push(extra({ def: lamp, position: { x: Math.round(lampAt.x), y: Math.round(lampAt.y) }, rotation: 0 }, 'A reading lamp at the end of the sofa.'));
      const sideAt = r.point(sofaSide, sofaAlong + sofa.size.w / 2 + m(0.3), sofaOff + m(0.3));
      items.push(extra({ def: side, position: { x: Math.round(sideAt.x), y: Math.round(sideAt.y) }, rotation: 0 }, 'A side table for a cup at the other end.'));
      const reasons = [
        `The ${kind === 'corner' ? 'corner sofa' : kind} faces the ${tvSide} wall, ${(Math.round((viewing + sofa.size.d / 2) / 1000) / 10).toFixed(1)} m from the screen: a comfortable viewing distance for a 65″ TV.`,
        'The coffee table stands 42 cm from the sofa: close enough to reach, wide enough to pass.',
      ];
      let bonus = 0;
      if (floats) {
        reasons.push('The sofa floats in the room, leaving a walkway behind it, as designers do in large living rooms.');
        bonus += 4;
      } else if (openBehind) {
        reasons.push('The back of the sofa marks where the living area ends in the open plan.');
      } else if (!r.windowOn(sofaSide, sofaAlong - sofa.size.w / 2, sofaAlong + sofa.size.w / 2)) {
        const art = def('home-art-trio');
        items.push(extra(r.against(art, sofaSide, sofaAlong, 0, wallElevation(art)), 'A set of three prints above the sofa gives the wall a centre.'));
      }
      if (r.windowOn(tvSide, tvAt - tv.size.w / 2, tvAt + tv.size.w / 2)) {
        bonus -= 15;
        reasons.push('The screen stands against the window: glare in the day.');
      } else if (r.windowOn(sofaSide, 0, Number.MAX_SAFE_INTEGER)) {
        bonus -= 4;
        reasons.push('The window behind the sofa can reflect in the screen; curtains help.');
      } else if (r.windows.length) {
        bonus += 6;
        reasons.push('Daylight comes from the side, so the screen does not reflect it.');
      }
      if (sofaId === 'home-sectional') reasons.push('A corner sofa seats five and closes the group.');
      // A full sofa where it fits; the loveseat is for small rooms.
      bonus += kind === 'sofa' ? 4 : kind === 'corner' ? 3 : 0;
      // An armchair across the corner, when the room allows it.
      const chair = def(palette.fabric === 'sage' ? 'home-armchair-terracotta' : 'home-armchair-boucle');
      const chairAt = r.point(sofaSide, sofaAlong + sofa.size.w / 2 + m(0.75), sofaFront + m(0.55));
      // Turned a quarter from the sofa, so it faces across the coffee table.
      const chairRot = (ROTATION[sofaSide] + 90_000) % 360_000;
      items.push(extra({ def: chair, position: { x: Math.round(chairAt.x), y: Math.round(chairAt.y) }, rotation: chairRot }, 'An armchair at the side turns it into a conversation group.'));
      const corner = r.point(tvSide, r.start(tvSide) + m(0.35), m(0.35));
      items.push(extra({ def: plant, position: { x: Math.round(corner.x), y: Math.round(corner.y) }, rotation: 0 }, 'A tall plant softens the corner by the screen.'));
      drafts.push({ key: `tv-${tvSide}-${kind}`, title: `${kind === 'corner' ? 'Corner sofa' : kind === 'loveseat' ? 'Loveseat' : 'Sofa'} facing the ${tvSide} wall`, reasons, bonus, items });
    }
  }
  return drafts;
}

function dining(r: Area, palette: Palette): Draft[] {
  const drafts: Draft[] = [];
  const centre = r.centre();
  // Centred when the doorways allow, otherwise moved off them in 15 cm steps.
  const shifts: Vec2[] = [{ x: 0, y: 0 }];
  for (const d of [1_500, 3_000, 4_500, 6_000]) shifts.push({ x: -d, y: 0 }, { x: d, y: 0 }, { x: 0, y: -d }, { x: 0, y: d });
  const pendant = def('home-pendant');
  const ceiling = r.project.space.ceilingHeight ?? m(2.8);
  const hang = ceiling - pendant.size.h - m(0.4);
  const sets = palette.wood === 'white' ? ['home-dining-round', 'home-dining-6', 'home-dining-4'] : ['home-dining-6', 'home-dining-4', 'home-dining-round'];
  for (const setId of sets) {
    const set = def(setId);
    for (const rotation of setId === 'home-dining-round' ? [0] : [0, 90_000]) {
      for (const [n, shift] of shifts.entries()) {
        const c = { x: centre.x + shift.x, y: centre.y + shift.y };
        const items: Placement[] = [{ def: set, position: c, rotation }, { def: pendant, position: c, rotation: 0, elevation: hang }];
        const reasons = [n === 0 ? 'The table is centred in its area under its pendant, with room all round to pull the chairs out.' : 'The table stands under its pendant, moved just enough to keep the doorway clear, with room all round for the chairs.', `${set.seats} seats.`];
        const board = def('home-sideboard');
        const boardSide = SIDES.find((s) => r.slot(s, board.size.w) !== undefined && !r.windowOn(s, 0, Number.MAX_SAFE_INTEGER));
        if (boardSide) items.push(extra(r.against(board, boardSide, r.slot(boardSide, board.size.w)!), `A sideboard on the ${boardSide} wall keeps plates and glasses at hand.`));
        drafts.push({ key: `${setId}-${rotation}-${n}`, title: `${setId === 'home-dining-round' ? 'Round table' : `Table for ${set.seats}`}${rotation ? ', set across the room' : ''}`, reasons, bonus: (set.seats ?? 0) * 2 - n, items });
      }
    }
  }
  return drafts;
}

function kitchen(r: Area): Draft[] {
  const drafts: Draft[] = [];
  const fridge = def('home-fridge');
  for (const side of SIDES) {
    for (const runId of ['home-kitchen-300', 'home-kitchen-240']) {
      const run = def(runId);
      if (r.across(side) < run.size.d + m(0.9)) continue;
      const at = r.slot(side, run.size.w + fridge.size.w + 200, 'start');
      let items: Placement[];
      let reasons: string[];
      let start: Tick;
      if (at !== undefined) {
        start = at - (run.size.w + fridge.size.w + 200) / 2;
        items = [r.against(run, side, start + run.size.w / 2), r.against(fridge, side, start + run.size.w + 200 + fridge.size.w / 2)];
        reasons = [`A ${run.size.w / 100} cm run with sink and hob on the ${side} wall, the fridge at its end: a short work triangle.`, '100 cm free in front of the counters to cook and open the oven.'];
      } else {
        // A small kitchen: the run on one wall, the fridge on the next, an L-shaped triangle.
        const runAt = r.slot(side, run.size.w, 'start');
        const fridgeSide = runAt === undefined ? undefined : SIDES.find((o) => o !== side && o !== OPPOSITE[side] && r.slot(o, fridge.size.w, 'end') !== undefined);
        if (runAt === undefined || !fridgeSide) continue;
        start = runAt - run.size.w / 2;
        items = [r.against(run, side, runAt), r.against(fridge, fridgeSide, r.slot(fridgeSide, fridge.size.w, 'end')!)];
        reasons = [`A ${run.size.w / 100} cm run on the ${side} wall and the fridge on the ${fridgeSide} wall: an L-shaped kitchen for a small room.`, '100 cm free in front of the counters.'];
      }
      let bonus = runId === 'home-kitchen-300' ? 6 : 0;
      const island = def('home-island');
      if (r.across(side) >= run.size.d + m(1.0) + island.size.d + m(1.0) && r.length(side) >= island.size.w + m(1.2)) {
        const p = r.point(side, start + run.size.w / 2, run.size.d + m(1.0) + island.size.d / 2);
        drafts.push({ key: `run-${side}-${runId}-island`, title: `Kitchen on the ${side} wall with an island`, reasons: [...reasons, 'An island with three stools: more worktop and a place to sit.'], bonus: bonus + 8, items: [...items, { def: island, position: { x: Math.round(p.x), y: Math.round(p.y) }, rotation: ROTATION[side] }] });
      }
      if (r.windowOn(side, start, start + run.size.w)) {
        bonus += 4;
        reasons.push('The sink looks out of the window.');
      }
      drafts.push({ key: `run-${side}-${runId}`, title: `Kitchen on the ${side} wall`, reasons, bonus, items });
    }
  }
  return drafts;
}

function bathroom(r: Area): Draft[] {
  const drafts: Draft[] = [];
  // A guest WC: basin and toilet only.
  const wcOnly = /\b(wc|toilet|powder)\b|تواليت/i.test(r.a.name) || (r.a.x1 - r.a.x0) * (r.a.y1 - r.a.y0) < 40_000_000;
  const basin = def('home-basin');
  const mirror = def('home-mirror');
  const toilet = def('home-toilet');
  for (const side of SIDES) {
    const basinAt = r.slot(side, basin.size.w + toilet.size.w + m(0.4), 'start');
    if (basinAt === undefined) continue;
    const start = basinAt - (basin.size.w + toilet.size.w + m(0.4)) / 2;
    const items: Placement[] = [r.against(basin, side, start + basin.size.w / 2), extra(r.against(mirror, side, start + basin.size.w / 2, 0, wallElevation(mirror)), 'A mirror over the basin.'), r.against(toilet, side, start + basin.size.w + m(0.4) + toilet.size.w / 2)];
    const reasons = ['Basin and toilet on one wall share the plumbing; 60–70 cm free in front of each.'];
    if (wcOnly) {
      drafts.push({ key: `basin-${side}`, title: `Basin and toilet on the ${side} wall`, reasons, bonus: 0, items });
      continue;
    }
    for (const wet of SIDES.filter((s) => s !== side)) {
      const tub = def('home-bathtub');
      const tubAt = r.slot(wet, tub.size.w);
      if (tubAt !== undefined) {
        drafts.push({ key: `basin-${side}-tub-${wet}`, title: `Bath on the ${wet} wall`, reasons: [...reasons, 'A full bathtub along the wall.'], bonus: 6, items: [...items, r.against(tub, wet, tubAt)] });
      }
      const shower = def('home-shower');
      const showerAt = r.slot(wet, shower.size.w, 'end');
      if (showerAt !== undefined) {
        drafts.push({ key: `basin-${side}-shower-${wet}`, title: `Shower on the ${wet} wall`, reasons: [...reasons, 'A walk-in shower in the corner leaves the floor open.'], bonus: 3, items: [...items, r.against(shower, wet, showerAt)] });
      }
    }
  }
  return drafts;
}

function study(r: Area): Draft[] {
  const drafts: Draft[] = [];
  const desk = def('home-desk');
  const chair = def('home-desk-chair');
  const shelves = def('home-bookcase');
  for (const side of SIDES) {
    const at = r.slot(side, desk.size.w);
    if (at === undefined) continue;
    const items: Placement[] = [r.against(desk, side, at)];
    const seat = r.point(side, at, desk.size.d + chair.size.d / 2 + m(0.02));
    items.push({ def: chair, position: { x: Math.round(seat.x), y: Math.round(seat.y) }, rotation: (ROTATION[side] + 180_000) % 360_000 });
    const reasons = ['A desk with room to push the chair back.'];
    let bonus = 0;
    const lit = SIDES.some((s) => s !== OPPOSITE[side] && s !== side && r.windowOn(s, 0, Number.MAX_SAFE_INTEGER));
    if (lit) {
      bonus += 6;
      reasons.push('Daylight from the side: no glare on the screen and no shadow from the hand.');
    }
    const shelfSide = SIDES.find((s) => s !== side && r.slot(s, shelves.size.w) !== undefined && !r.windowOn(s, 0, Number.MAX_SAFE_INTEGER));
    if (shelfSide) {
      items.push(extra(r.against(shelves, shelfSide, r.slot(shelfSide, shelves.size.w)!), `Bookshelves on the ${shelfSide} wall.`));
    }
    drafts.push({ key: `desk-${side}`, title: `Desk against the ${side} wall`, reasons, bonus, items });
  }
  return drafts;
}

function laundry(r: Area): Draft[] {
  const washer = def('home-washer');
  const shelf = def('home-shelf');
  const drafts: Draft[] = [];
  for (const side of SIDES) {
    const at = r.slot(side, washer.size.w + m(0.4), 'start');
    if (at === undefined) continue;
    const start = at - (washer.size.w + m(0.4)) / 2;
    const items: Placement[] = [r.against(washer, side, start + washer.size.w / 2), extra(r.against(shelf, side, start + washer.size.w / 2, 0, wallElevation(shelf)), 'A shelf above the machine for detergent and baskets.')];
    drafts.push({ key: `washer-${side}`, title: `Washing machine on the ${side} wall`, reasons: ['The machine stands against a solid wall near the water; 90 cm free in front to load it.'], bonus: 0, items });
  }
  return drafts;
}

function hall(r: Area): Draft[] {
  const art = def('home-art-60');
  const drafts: Draft[] = [];
  for (const side of SIDES) {
    const at = r.slot(side, art.size.w + m(0.4));
    if (at === undefined) continue;
    drafts.push({ key: `art-${side}`, title: `A print on the ${side} wall`, reasons: ['The hall stays clear to walk; one print marks the way in.'], bonus: 0, items: [r.against(art, side, at, 0, wallElevation(art))] });
  }
  return drafts;
}

function draftsFor(r: Area, palette: Palette): Draft[] {
  switch (r.a.kind) {
    case 'bedroom':
      return bedroom(r);
    case 'living':
      return living(r, palette);
    case 'dining':
      return dining(r, palette);
    case 'kitchen':
      return kitchen(r);
    case 'bathroom':
      return bathroom(r);
    case 'study':
      return study(r);
    case 'hall':
      return hall(r);
    case 'laundry':
      return laundry(r);
    default:
      return [];
  }
}

// ─── Finishes ──────────────────────────────────────────────────────────────────────────────────

/** The piece in this option's finishes: a variant type when its fabric or wood changes. */
const FABRIC_WORD: Readonly<Record<Fabric, string>> = { linen: 'linen', cream: 'cream', boucle: 'bouclé', charcoal: 'charcoal', sage: 'sage', terracotta: 'terracotta', navy: 'navy', ochre: 'ochre' };
const WOOD_WORD: Readonly<Record<string, string>> = { oak: 'oak', walnut: 'walnut', white: 'white', black: 'black' };
/** Finish words in a piece's name: replaced when the finish changes, never doubled. */
const FINISH_NAME = /^(oak|walnut|white|black|marble|linen|cream|bouclé|boucle|charcoal|sage|terracotta|navy|ochre)$/i;

function finished(d: ItemDefinition, palette: Palette): ItemDefinition {
  const meta: Record<string, string | number | boolean> = { ...(d.meta ?? {}) };
  const words: string[] = [];
  if (typeof meta.fabric === 'number' && ['bed', 'armchair', 'dining-set'].includes(d.category) && meta.fabric !== FABRICS[palette.fabric]) {
    meta.fabric = FABRICS[palette.fabric];
    words.push(FABRIC_WORD[palette.fabric]);
  }
  if (typeof meta.wood === 'string' && meta.wood !== 'marble' && meta.wood !== palette.wood && ['bed', 'wardrobe', 'nightstand', 'dresser', 'sideboard', 'coffee-table', 'tv-unit', 'desk', 'bookcase', 'dining-set', 'side-table'].includes(d.category)) {
    meta.wood = palette.wood;
    words.push(WOOD_WORD[palette.wood] ?? palette.wood);
  }
  if (!words.length) return d;
  // "Armchair Oslo · bouclé" in charcoal becomes "Armchair Oslo · charcoal"; "Bed · king · 180 × 200" in
  // charcoal fabric and white wood becomes "Bed · king · 180 × 200 · charcoal · white".
  const kept = d.name.split(' · ').filter((part) => !FINISH_NAME.test(part.trim()));
  return { ...d, id: `${d.id}--${palette.id}`, name: [...kept, ...words].join(' · '), meta: meta as Meta };
}

// ─── Checking and choosing ─────────────────────────────────────────────────────────────────────

/** The arrangements of one area that pass every check, best first, at most one per key. */
export function arrangementsFor(project: Project, area: FurnishArea, palette: Palette = PALETTES[0]!): Arrangement[] {
  const r = new Area(project, area);
  const base = withoutItemsIn(project, [area]);
  const results: Arrangement[] = [];
  for (const draft of draftsFor(r, palette)) {
    const evaluated = evaluate(base, r, draft, palette);
    if (evaluated) results.push(evaluated);
  }
  return results.sort((a, b) => b.score - a.score || (a.key < b.key ? -1 : 1));
}

function evaluate(base: Project, r: Area, draft: Draft, palette: Palette): Arrangement | undefined {
  const fits = (p: Placement) => {
    const d = finished(p.def, palette);
    const body = itemPolygon({ id: '', definitionId: d.id, position: p.position, rotation: p.rotation, locked: false }, d);
    const box = boundsOf(body);
    // Within the area (a rug may reach 5 cm past it), and clear of doorways on the floor.
    const slack = d.surface ? 500 : 50;
    if (box.minX < r.a.x0 - slack || box.minY < r.a.y0 - slack || box.maxX > r.a.x1 + slack || box.maxY > r.a.y1 + slack) return false;
    const onFloor = !d.surface && (p.elevation ?? 0) < m(0.9);
    return !(onFloor && r.keepOut.some((k) => polygonsOverlap(body, k)));
  };
  const core = draft.items.filter((p) => !p.extra);
  if (!core.every(fits)) return undefined;
  let extras = draft.items.filter((p) => p.extra && fits(p));
  // Check the core with the extras; drop extras that cause errors until none do. The core must be clean.
  for (let round = 0; round < 5; round++) {
    const chosen = [...core, ...extras];
    const { project, ids } = addPlacements(base, chosen, palette);
    const mine = new Set(ids);
    const issues = checkProject(project).filter((i) => i.entityIds.some((e) => mine.has(e)));
    const errors = issues.filter((i) => i.severity === 'error');
    const blamed = new Set(errors.flatMap((i) => i.entityIds.map((e) => ids.indexOf(e)).filter((k) => k >= core.length)));
    if (errors.length === 0) {
      const warnings = issues.filter((i) => i.severity === 'warning').length;
      const reasons = [...draft.reasons, ...extras.map((p) => p.extra!)];
      if (warnings) reasons.push(`${warnings} piece${warnings === 1 ? ' is' : 's are'} a little tight on free space.`);
      return { key: draft.key, title: draft.title, reasons, score: 100 + draft.bonus - warnings * 8 + chosen.length, items: chosen };
    }
    // An error the core causes on its own cannot be fixed by dropping touches.
    if (blamed.size === 0) {
      if (extras.length === 0) return undefined;
      extras = [];
      continue;
    }
    extras = extras.filter((_, k) => !blamed.has(core.length + k));
  }
  return undefined;
}

function withoutItemsIn(project: Project, areas: readonly FurnishArea[]): Project {
  const items = Object.fromEntries(
    Object.entries(project.items).filter(([, i]) => !areas.some((a) => i.position.x > a.x0 && i.position.x < a.x1 && i.position.y > a.y0 && i.position.y < a.y1)),
  );
  return { ...project, items };
}

// ─── Whole options ─────────────────────────────────────────────────────────────────────────────

export interface FurnishOption {
  readonly index: number;
  readonly title: string;
  readonly palette: Palette;
  readonly rooms: ReadonlyArray<{ readonly area: string; readonly kind: string; readonly arrangement: string; readonly reasons: readonly string[] }>;
  readonly unfurnished: readonly string[];
  readonly pieces: number;
  readonly seats: number;
  /** Errors and warnings of the furnished flat, and the home rules that do not pass. */
  readonly errors: number;
  readonly warnings: number;
  readonly failedRules: readonly string[];
  /** One step: types in this option's finishes, the old furniture of these rooms out, the new in. */
  readonly command: Command;
}

/**
 * Up to `count` ways to furnish the flat (or only the named areas): option k takes the k-th best
 * distinct arrangement of each area and palette k. Existing furniture in those areas is replaced.
 */
export function furnishOptions(project: Project, { count = 3, areas: only }: { count?: number; areas?: readonly string[] } = {}): FurnishOption[] {
  const areas = furnishAreas(project).filter((a) => !only || only.includes(a.name));
  const options: FurnishOption[] = [];
  // Layouts already offered per area ("bed-west", "tv-north"…): each option tries a new one first.
  const offered = new Map<string, Set<string>>();
  const layoutOf = (key: string) => key.split('-').slice(0, 2).join('-');
  for (let k = 0; k < count; k++) {
    const palette = PALETTES[k % PALETTES.length]!;
    let working = withoutItemsIn(project, areas);
    const rooms: Array<{ area: string; kind: string; arrangement: string; reasons: readonly string[] }> = [];
    const unfurnished: string[] = [];
    const placed: Array<{ p: Placement; d: ItemDefinition }> = [];
    const newIds: Id[] = [];
    // Fixed rooms first (kitchen, baths, bedrooms), the seating areas last: they then find the
    // places that keep a walkway to every seat. The list keeps the flat's order.
    const order = [...areas].sort((a, b) => (SEATING.has(a.kind) ? 1 : 0) - (SEATING.has(b.kind) ? 1 : 0));
    const passes = (trial: { project: Project }) => checkHome(trial.project).every((rule) => rule.status !== 'fail');
    type Step = { area: FurnishArea; before: Project; ranked: Arrangement[]; pick: Arrangement; added: { project: Project; ids: Id[] }; ok: boolean };
    const steps: Step[] = [];
    /** The preferred arrangement if it keeps the flat's rules, else the best-ranked one that does. */
    const choose = (before: Project, area: FurnishArea, ranked: Arrangement[], skip: ReadonlySet<Arrangement> = new Set()): Omit<Step, 'area' | 'before' | 'ranked'> => {
      const seen = offered.get(area.name) ?? new Set<string>();
      const preferred = ranked.find((a) => !seen.has(layoutOf(a.key))) ?? ranked.find((a) => !seen.has(a.key)) ?? ranked[0]!;
      for (const candidate of [preferred, ...ranked.filter((a) => a !== preferred)]) {
        if (skip.has(candidate)) continue;
        const trial = addPlacements(before, candidate.items, palette);
        if (passes(trial)) return { pick: candidate, added: trial, ok: true };
      }
      return { pick: preferred, added: addPlacements(before, preferred.items, palette), ok: false };
    };
    for (const area of order) {
      // Each area is chosen against the flat as furnished so far in this option.
      const ranked = arrangementsFor(working, area, palette);
      if (!ranked.length) {
        if (!HAS_RECIPE.has(area.kind)) {
          if (area.kind !== 'balcony') unfurnished.push(`${area.name}: no layout is known for this kind of room (rename it, e.g. bedroom, study or laundry, to furnish it)`);
        } else if (area.kind !== 'hall') unfurnished.push(`${area.name}: nothing fits there with the doors, windows and walkways kept clear`); // a bare corridor is fine
        continue;
      }
      let step: Step = { area, before: working, ranked, ...choose(working, area, ranked) };
      // No way to keep the rules here: the seating area placed just before may make room. Try
      // its other arrangements (a few) until both keep the walkways.
      const prev = steps.at(-1);
      if (!step.ok && prev && prev.ok && SEATING.has(prev.area.kind)) {
        const tried = new Set<Arrangement>([prev.pick]);
        for (let attempt = 0; attempt < 8; attempt++) {
          const alt = choose(prev.before, prev.area, prev.ranked, tried);
          if (!alt.ok) break;
          tried.add(alt.pick);
          const again = arrangementsFor(alt.added.project, area, palette);
          if (!again.length) continue;
          const next = choose(alt.added.project, area, again);
          if (next.ok) {
            steps[steps.length - 1] = { ...prev, ...alt };
            step = { area, before: alt.added.project, ranked: again, ...next };
            break;
          }
        }
      }
      steps.push(step);
      working = step.added.project;
    }
    for (const step of steps) {
      const seen = offered.get(step.area.name) ?? new Set<string>();
      offered.set(step.area.name, seen);
      seen.add(layoutOf(step.pick.key));
      seen.add(step.pick.key);
      rooms.push({ area: step.area.name, kind: step.area.kind, arrangement: step.pick.title, reasons: step.pick.reasons });
      newIds.push(...step.added.ids);
      for (const p of step.pick.items) placed.push({ p, d: finished(p.def, palette) });
    }
    rooms.sort((a, b) => areas.findIndex((x) => x.name === a.area) - areas.findIndex((x) => x.name === b.area));
    const issues = checkProject(working);
    const rules = checkHome(working).filter((r) => r.status === 'fail').map((r) => r.code);
    // Old furniture of these areas goes first, so new pieces may take its ids.
    const removed = Object.keys(project.items).filter((id) => !withoutItemsIn(project, areas).items[id]);
    const types = [...new Map(placed.map(({ d }) => [d.id, d])).values()].filter((d) => project.catalog[d.id] === undefined);
    const newItems = newIds.map((id) => working.items[id]!);
    const commands: Command[] = [
      ...types.map((definition): Command => ({ type: 'catalog.define', definition })),
      ...removed.map((id): Command => ({ type: 'item.remove', id })),
      ...newItems.map((item): Command => ({ type: 'item.add', item })),
      // Finish variants of an earlier option that no piece uses any more go with it, so the catalogue does not pile up.
      ...Object.keys(project.catalog)
        .filter((id) => id.includes('--') && !Object.values(working.items).some((i) => i.definitionId === id))
        .map((id): Command => ({ type: 'catalog.remove', id })),
    ];
    options.push({
      index: k,
      title: `Option ${String.fromCharCode(65 + k)} · ${palette.name}`,
      palette,
      rooms,
      unfurnished,
      pieces: newItems.length,
      seats: newItems.reduce((n, i) => n + (working.catalog[i.definitionId]?.seats ?? 0), 0),
      errors: issues.filter((i) => i.severity === 'error').length,
      warnings: issues.filter((i) => i.severity === 'warning').length,
      failedRules: rules,
      command: commands.length === 1 ? commands[0]! : { type: 'batch', commands },
    });
  }
  return options;
}

/** Adds placements with readable ids (bed-1, sofa-2…), defining finish variants as needed. */
function addPlacements(project: Project, placements: readonly Placement[], palette: Palette): { project: Project; ids: Id[] } {
  const catalog: Record<Id, ItemDefinition> = { ...project.catalog };
  const items: Record<Id, ItemInstance> = { ...project.items };
  const taken = new Set<string>([project.id, ...Object.keys(catalog), ...Object.keys(items), ...(project.space.walls ?? []).map((w) => w.id), ...(project.space.openings ?? []).map((o) => o.id), ...(project.space.zones ?? []).map((z) => z.id), ...project.space.doors.map((d) => d.id), ...project.space.obstacles.map((o) => o.id)]);
  const ids: Id[] = [];
  for (const p of placements) {
    const d = finished(p.def, palette);
    catalog[d.id] = d;
    taken.add(d.id);
    const prefix = d.category.replace(/[^a-z]/g, '').slice(0, 8) || 'item';
    let n = 1;
    while (taken.has(`${prefix}-${n}`)) n++;
    const id = `${prefix}-${n}`;
    taken.add(id);
    ids.push(id);
    items[id] = { id, definitionId: d.id, position: p.position, rotation: p.rotation, locked: false, ...(p.elevation ? { elevation: p.elevation } : {}) };
  }
  return { project: { ...project, catalog, items }, ids };
}
