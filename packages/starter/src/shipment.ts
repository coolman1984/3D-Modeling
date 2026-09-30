import type { ItemDefinition, ItemInstance, Project, Tick } from '@space-planner/core';
import { containerType, newContainer } from './container.js';
import { orientationsOf } from './packer.js';

/**
 * Shipments: how many containers a production run needs, and each container loaded.
 *
 * Thousands of identical parts are loaded the way a crew stuffs a container: in walls. A wall is
 * one slice across the container, one piece deep, filled from the floor up; walls follow each other
 * from the front wall to the doors. Each part type uses the wall that holds the most pieces per
 * metre of length (two orientations may share a wall when the part may lie on its side), a
 * shorter wall fills the gap at the end of a container, and the last few pieces go in the
 * shallowest wall that holds them. One loading step is one layer of one wall, so playback shows
 * the crew's order. Deterministic; the extreme-point packer stays for mixed cargo.
 */

/** One part of a shipment, as a production plan lists it. */
export interface ShipmentPart {
  /** Stable id for the cargo type in every container of the shipment. */
  readonly id: string;
  readonly name: string;
  /** Size as listed (L × W × H); the loader may turn it, and lay it down when allowed. */
  readonly length: Tick;
  readonly width: Tick;
  readonly height: Tick;
  readonly quantity: number;
  /** Grams per piece; unknown when not given. */
  readonly mass?: number;
  /** May it lie on its side? Unstated is treated as "no". */
  readonly allowTilt?: boolean;
}

export interface ShipmentContainer {
  readonly project: Project;
  /** Pieces per part id in this container. */
  readonly pieces: Readonly<Record<string, number>>;
  /** Length used from the front wall, in ticks. */
  readonly usedLength: Tick;
}

export interface ShipmentPlan {
  readonly containers: readonly ShipmentContainer[];
  /** Parts that fit no container in any allowed orientation. */
  readonly tooBig: readonly string[];
  readonly explanation: string;
}

type Orientation = ReturnType<typeof orientationsOf>[number];

/** A wall layout: pieces in the face across the container, bottom layer first. */
interface Wall {
  readonly depth: Tick;
  readonly spots: ReadonlyArray<{ readonly y: Tick; readonly z: Tick; readonly o: Orientation }>;
}

/** Columns of `a` side by side from y0, each stacked floor to roof. */
function columns(a: Orientation, y0: Tick, count: number, height: Tick): Wall['spots'] {
  const spots: Array<Wall['spots'][number]> = [];
  const levels = Math.floor(height / a.h);
  for (let c = 0; c < count; c++) for (let k = 0; k < levels; k++) spots.push({ y: y0 + c * a.w, z: k * a.h, o: a });
  return spots;
}

/** Rows of `a` across `span` from z0, `count` rows high. */
function rows(a: Orientation, z0: Tick, count: number, span: Tick): Wall['spots'] {
  const spots: Array<Wall['spots'][number]> = [];
  const across = Math.floor(span / a.w);
  for (let r = 0; r < count; r++) for (let c = 0; c < across; c++) spots.push({ y: c * a.w, z: z0 + r * a.h, o: a });
  return spots;
}

/**
 * The best face layouts per wall depth: one orientation alone, or two that share the depth
 * (a turned on its side), split across the width or up the height. Upper rows are kept within
 * the width of the rows under them, so every piece rests fully on the one below.
 */
function wallsOf(definition: ItemDefinition, length: Tick, width: Tick, height: Tick, door: { width: Tick; height: Tick }): Wall[] {
  const all = orientationsOf(definition).filter((o) => o.w <= door.width && o.h <= door.height && o.l <= length && o.w <= width && o.h <= height);
  const walls: Wall[] = [];
  for (const depth of [...new Set(all.map((o) => o.l))].sort((a, b) => a - b)) {
    const same = all.filter((o) => o.l === depth);
    let best: Wall['spots'] = [];
    const keep = (spots: Wall['spots']) => {
      if (spots.length > best.length) best = spots;
    };
    for (const a of same) {
      keep(columns(a, 0, Math.floor(width / a.w), height));
      for (const b of same) {
        if (b === a) continue;
        // Across: i columns of a, the rest of the width in columns of b.
        for (let i = 1; i * a.w <= width; i++) keep([...columns(a, 0, i, height), ...columns(b, i * a.w, Math.floor((width - i * a.w) / b.w), height)]);
        // Up: j rows of a, then rows of b no wider than the rows below.
        const rowsA = Math.floor(width / a.w) * a.w;
        for (let j = 1; j * a.h <= height; j++) keep([...rows(a, 0, j, width), ...rows(b, j * a.h, Math.floor((height - j * a.h) / b.h), rowsA)]);
      }
    }
    if (best.length > 0) {
      const spots = [...best].sort((p, q) => p.z - q.z || p.y - q.y);
      walls.push({ depth, spots });
    }
  }
  return walls;
}

/**
 * The top of a (partly) filled wall across the container's width: flat stretches with the height of
 * the pieces under them (0 where nothing stands). Each piece spans the wall's whole depth.
 */
function topOf(wall: Wall, count: number, width: Tick): Array<{ y0: Tick; y1: Tick; top: Tick }> {
  const spots = wall.spots.slice(0, count);
  const edges = [...new Set([0, width, ...spots.flatMap((s) => [s.y, s.y + s.o.w])])].filter((e) => e >= 0 && e <= width).sort((a, b) => a - b);
  const out: Array<{ y0: Tick; y1: Tick; top: Tick }> = [];
  for (let i = 0; i + 1 < edges.length; i++) {
    const y0 = edges[i]!;
    const y1 = edges[i + 1]!;
    const top = spots.reduce((m, s) => (s.y <= y0 && s.y + s.o.w >= y1 ? Math.max(m, s.z + s.o.h) : m), 0);
    const last = out.at(-1);
    if (last && last.top === top) last.y1 = y1;
    else out.push({ y0, y1, top });
  }
  return out;
}

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'part';

/**
 * Work out how many containers of one type the parts need and load each one. Every container
 * is an ordinary container project (id "new"): its cargo types carry the quantity it holds, so
 * the container rules, the cargo plan and the load playback work on it unchanged.
 */
export function planShipment(input: { readonly name: string; readonly containerType: string; readonly parts: readonly ShipmentPart[]; readonly shipmentId?: string }): ShipmentPlan {
  const type = containerType(input.containerType);
  const length = type?.length ?? 0;
  const width = type?.width ?? 0;
  const height = type?.height ?? 0;
  const door = { width: type?.doorWidth ?? width, height: type?.doorHeight ?? height };

  const definitions = input.parts.map((p): ItemDefinition => ({
    id: p.id,
    name: p.name,
    category: 'box',
    size: { w: p.length, d: p.width, h: p.height },
    clearance: { front: 0, back: 0, left: 0, right: 0 },
    ...(p.mass === undefined ? {} : { mass: p.mass }),
    meta: { stackable: true, allowTilt: p.allowTilt === true },
  }));
  const options = new Map(definitions.map((d) => [d.id, wallsOf(d, length, width, height, door)]));
  // The payload caps a container as surely as its length: heavy cargo (tiles, steel, paper) fills it by weight first.
  const payload = type?.maxPayload;
  const tooBig = input.parts
    .filter((p) => p.quantity > 0 && (options.get(p.id)!.length === 0 || (p.mass !== undefined && payload !== undefined && p.mass > payload)))
    .map((p) => p.id);
  const rate = (w: Wall) => w.spots.length / w.depth;

  // Parts of the same size and handling (a cushion's top and bottom) share walls: a crew finishes
  // a wall with the next part instead of leaving it half empty. One stream per size, in input order.
  const streams: Array<{ key: string; ids: string[]; left: number; mass: number | undefined }> = [];
  for (const p of input.parts) {
    if (p.quantity <= 0 || tooBig.includes(p.id)) continue;
    const key = `${p.length}x${p.width}x${p.height}|${p.allowTilt === true}|${p.mass ?? '-'}`;
    const stream = streams.find((s) => s.key === key);
    if (stream) {
      stream.ids.push(p.id);
      stream.left += Math.round(p.quantity);
    } else streams.push({ key, ids: [p.id], left: Math.round(p.quantity), mass: p.mass });
  }
  /** How many more pieces of this stream the load's payload takes (no limit when the weight is unknown). */
  const byWeight = (s: (typeof streams)[number], load: { mass: number }): number =>
    s.mass === undefined || s.mass <= 0 || payload === undefined ? Infinity : Math.floor((payload - load.mass) / s.mass);
  const wallsFor = (s: (typeof streams)[number]) => options.get(s.ids[0]!)!;
  // Streams with the deepest best wall go first; the shallow ones fill the gaps at the end.
  const bestDepth = (s: (typeof streams)[number]) => wallsFor(s).reduce((b, w) => (rate(w) > rate(b) ? w : b)).depth;
  const order = [...streams].sort((a, b) => bestDepth(b) - bestDepth(a) || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));

  /** The wall to use next for this stream with `room` length left, or undefined when none fits. */
  const pick = (s: (typeof streams)[number], room: Tick): Wall | undefined => {
    const fits = wallsFor(s).filter((w) => w.depth <= room);
    if (fits.length === 0) return undefined;
    const holdsAll = fits.filter((w) => w.spots.length >= s.left);
    if (holdsAll.length > 0) return holdsAll.reduce((b, w) => (w.depth < b.depth ? w : b));
    return fits.reduce((b, w) => (rate(w) > rate(b) || (rate(w) === rate(b) && w.depth < b.depth) ? w : b));
  };

  // Every way a stream's piece may stand that goes through the doors, for filling gaps.
  const turns = new Map(streams.map((s) => [s, orientationsOf(definitions.find((d) => d.id === s.ids[0])!).filter((o) => o.w <= door.width && o.h <= door.height)]));

  type Spot = { readonly x: Tick; readonly y: Tick; readonly z: Tick; readonly o: Orientation };
  type Placed = { stream: (typeof streams)[number]; wall: Wall; count: number; x: Tick; fill: Array<{ stream: (typeof streams)[number]; spot: Spot }> };
  const loads: Array<{ walls: Placed[]; used: Tick; mass: number; full: boolean }> = [];

  /**
   * Fill the room left above the walls of a finished container with pieces still waiting: above a
   * half-full last wall, or above walls that stop short of the roof. A wall's top is flat along its
   * depth, so each flat stretch across the width is an empty box standing on pieces (or the floor);
   * pieces go in it in columns, bottom layer first, so each rests fully on the one below.
   */
  const fillGaps = (load: { walls: Placed[]; mass: number; full: boolean }) => {
    for (const placed of load.walls) {
      for (const flat of topOf(placed.wall, placed.count, width)) {
        const room = { l: placed.wall.depth, w: flat.y1 - flat.y0, h: height - flat.top };
        for (const s of order) {
          if (s.left <= 0) continue;
          const fit = (o: Orientation) => Math.floor(room.l / o.l) * Math.floor(room.w / o.w) * Math.floor(room.h / o.h);
          const o = turns.get(s)!.reduce<Orientation | undefined>((b, t) => (fit(t) > (b ? fit(b) : 0) ? t : b), undefined);
          if (!o) continue;
          const spots: Spot[] = [];
          for (let k = 0; (k + 1) * o.h <= room.h; k++)
            for (let j = 0; (j + 1) * o.w <= room.w; j++)
              for (let i = 0; (i + 1) * o.l <= room.l; i++) spots.push({ x: placed.x + i * o.l, y: flat.y0 + j * o.w, z: flat.top + k * o.h, o });
          const room2 = byWeight(s, load);
          const n = Math.min(spots.length, s.left, room2);
          if (room2 < Math.min(spots.length, s.left)) load.full = true;
          if (n <= 0) continue;
          for (const spot of spots.slice(0, n)) placed.fill.push({ stream: s, spot });
          s.left -= n;
          if (s.mass !== undefined) load.mass += n * s.mass;
          break;
        }
      }
    }
  };
  while (order.some((s) => s.left > 0)) {
    const load = { walls: [] as Placed[], used: 0, mass: 0, full: false };
    for (;;) {
      let placed = false;
      for (const s of order) {
        if (s.left <= 0) continue;
        const wall = pick(s, length - load.used);
        if (!wall) continue;
        const room = byWeight(s, load);
        if (room < Math.min(wall.spots.length, s.left)) load.full = true;
        const count = Math.min(wall.spots.length, s.left, room);
        if (count <= 0) continue;
        load.walls.push({ stream: s, wall, count, x: load.used, fill: [] });
        load.used += wall.depth;
        s.left -= count;
        if (s.mass !== undefined) load.mass += count * s.mass;
        placed = true;
        break;
      }
      if (!placed) break;
    }
    if (load.walls.length === 0) break; // nothing fits an empty container (cannot happen once too-big parts are out)
    if (order.some((s) => s.left > 0)) fillGaps(load);
    loads.push(load);
  }

  // Which part each loaded piece is: a stream hands out its parts in input order.
  const quantity = new Map(input.parts.map((p) => [p.id, Math.round(p.quantity)]));
  const handedOut = new Map<string, number>();
  const nextPart = (s: (typeof streams)[number]): string => {
    const id = s.ids.find((i) => (handedOut.get(i) ?? 0) < quantity.get(i)!)!;
    handedOut.set(id, (handedOut.get(id) ?? 0) + 1);
    return id;
  };

  const shipmentId = input.shipmentId ?? slug(input.name);
  const containers = loads.map((load, index): ShipmentContainer => {
    const pieces: Record<string, number> = {};
    const items: Record<string, ItemInstance> = {};
    let step = 0;
    const put = (stream: (typeof streams)[number], s: Spot, step: number) => {
      const id = nextPart(stream);
      pieces[id] = (pieces[id] ?? 0) + 1;
      const itemId = `${id}-${pieces[id]}`;
      items[itemId] = {
        id: itemId,
        definitionId: id,
        position: { x: Math.round(s.x + s.o.l / 2), y: Math.round(s.y + s.o.w / 2) },
        rotation: s.o.rotation,
        locked: false,
        ...(s.z > 0 ? { elevation: s.z } : {}),
        ...(s.o.tilt ? { tilt: s.o.tilt } : {}),
        meta: { step },
      };
    };
    for (const { stream, wall, count, x, fill } of load.walls) {
      let lastZ = -1;
      for (const s of wall.spots.slice(0, count)) {
        if (s.z !== lastZ) {
          step++;
          lastZ = s.z;
        }
        put(stream, { ...s, x }, step);
      }
      // Pieces on top of this wall go in before the next wall closes it off, layer by layer.
      lastZ = -1;
      for (const { stream: s, spot } of [...fill].sort((a, b) => a.spot.z - b.spot.z)) {
        if (spot.z !== lastZ) {
          step++;
          lastZ = spot.z;
        }
        put(s, spot, step);
      }
    }
    const base = newContainer(`${input.name} · container ${index + 1} of ${loads.length}`, input.containerType);
    const catalog = Object.fromEntries(
      definitions.filter((d) => pieces[d.id]).map((d) => [d.id, { ...d, meta: { ...d.meta, quantity: pieces[d.id]! } }]),
    );
    const project: Project = {
      ...base,
      space: { ...base.space, meta: { ...base.space.meta, shipment: shipmentId, shipmentName: input.name, shipmentIndex: index + 1, shipmentCount: loads.length } },
      catalog,
      items,
    };
    return { project, pieces, usedLength: load.used };
  });

  const total = [...handedOut.values()].reduce((s, n) => s + n, 0);
  const explanation =
    total === 0
      ? 'Nothing to load: give the parts a quantity.'
      : `${total} pieces need ${containers.length} × ${type?.label ?? input.containerType}` +
        (containers.length > 0 ? `; the last one is ${Math.round((containers.at(-1)!.usedLength / length) * 100)}% full along its length.` : '.') +
        (tooBig.length > 0 ? ` ${tooBig.length} part type(s) are too big for this container.` : '') +
        (loads.some((l) => l.full) && payload !== undefined
          ? ` Weight is the limit: ${loads.filter((l) => l.full).length} container(s) reach the ${Math.round(payload / 100_000) / 10} t payload before they are full.`
          : '');
  return { containers, tooBig, explanation };
}

/** The shipment a container project belongs to, from its space data. */
export function shipmentOf(project: Project): { readonly id: string; readonly name: string; readonly index: number; readonly count: number } | undefined {
  const m = project.space.meta ?? {};
  if (typeof m.shipment !== 'string') return undefined;
  return {
    id: m.shipment,
    name: typeof m.shipmentName === 'string' ? m.shipmentName : m.shipment,
    index: typeof m.shipmentIndex === 'number' ? m.shipmentIndex : 1,
    count: typeof m.shipmentCount === 'number' ? m.shipmentCount : 1,
  };
}
