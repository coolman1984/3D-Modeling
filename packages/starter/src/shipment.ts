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
  /**
   * The finished product this part belongs to (a TV model). Parts of one model are loaded as complete sets: a container is
   * filled with as many full sets as it takes (e.g. 2 sides + 1 top + 1 bottom per TV), so a container never holds a model's
   * top without its bottom. Parts without a model are loaded on their own, as before.
   */
  readonly model?: string;
  /** `false` = nothing may rest on it: it is loaded one layer high, on the floor. Unstated = stackable up to the limits below. */
  readonly stackable?: boolean;
  /** Grams that may rest on one piece; with the piece's mass this fixes how many may stand on each other. */
  readonly maxLoadOnTop?: number;
  /** The most pieces that may stand on each other (the one on the floor included). Wins over the default, never over the container. */
  readonly maxLayers?: number;
}

/** The smallest size the loader works with, in ticks (1 mm): anything smaller would divide a container into endlessly many pieces. */
export const MIN_PART_TICKS = 10;
const measurable = (p: Pick<ShipmentPart, 'length' | 'width' | 'height'>) => p.length >= MIN_PART_TICKS && p.width >= MIN_PART_TICKS && p.height >= MIN_PART_TICKS;

/** How many pieces of this part may stand on each other: what is stated about it (never fewer than one), else up to the roof. */
export function stackLayersOf(p: Pick<ShipmentPart, 'stackable' | 'maxLoadOnTop' | 'maxLayers' | 'mass'>): number {
  if (p.stackable === false) return 1;
  const stated: number[] = [];
  if (p.maxLayers !== undefined) stated.push(Math.floor(p.maxLayers));
  // n pieces in a column put (n - 1) pieces on the one at the foot
  if (p.maxLoadOnTop !== undefined && p.mass !== undefined && p.mass > 0) stated.push(1 + Math.floor(p.maxLoadOnTop / p.mass));
  return stated.length > 0 ? Math.max(1, Math.min(...stated)) : Infinity;
}

/**
 * How a piece stands. A piece that may be turned lies on its largest face (its smallest side up) and is stacked on others,
 * as a crew loads cushions and cartons: height is not the goal, a long piece stood on end falls over and is crushed. Only
 * when lying flat does not fit is it set on a side, and on its longest side (standing on end) only when nothing else fits.
 * A piece that must stay "this way up" keeps its listed height.
 */
function preferred(definition: ItemDefinition, fitting: readonly Orientation[]): Orientation[] {
  if (definition.meta?.allowTilt !== true) return [...fitting];
  const sides = [definition.size.w, definition.size.d, definition.size.h].sort((a, b) => a - b);
  const flat = fitting.filter((o) => o.h === sides[0]);
  if (flat.length > 0) return flat;
  const onSide = fitting.filter((o) => o.h !== sides[2]);
  return onSide.length > 0 ? onSide : [...fitting];
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
  /** Parts that exceed geometry, payload or supported planning work limits. */
  readonly tooBig: readonly string[];
  /** Models whose complete set does not fit one container of this type: left out of the plan (the explanation says why). */
  readonly unplanned?: readonly string[];
  readonly explanation: string;
}

type Orientation = ReturnType<typeof orientationsOf>[number];

/** A wall layout: pieces in the face across the container, bottom layer first. */
interface Wall {
  readonly depth: Tick;
  readonly spots: ReadonlyArray<{ readonly y: Tick; readonly z: Tick; readonly o: Orientation }>;
}

/** Columns of `a` side by side from y0, each stacked as high as the roof and the stacking limit allow. */
function columns(a: Orientation, y0: Tick, count: number, height: Tick, layers: number, limit: number): Wall['spots'] {
  const spots: Array<Wall['spots'][number]> = [];
  const levels = Math.min(Math.floor(height / a.h), layers);
  for (let c = 0; c < count && spots.length < limit; c++) for (let k = 0; k < levels && spots.length < limit; k++) spots.push({ y: y0 + c * a.w, z: k * a.h, o: a });
  return spots;
}

/** Rows of `a` across `span` from z0, `count` rows high. */
function rows(a: Orientation, z0: Tick, count: number, span: Tick, limit: number): Wall['spots'] {
  const spots: Array<Wall['spots'][number]> = [];
  const across = Math.floor(span / a.w);
  for (let r = 0; r < count && spots.length < limit; r++) for (let c = 0; c < across && spots.length < limit; c++) spots.push({ y: c * a.w, z: z0 + r * a.h, o: a });
  return spots;
}

/**
 * The best face layouts per wall depth: one orientation alone, or two that share the depth
 * (a turned on its side), split across the width or up the height. Upper rows are kept within
 * the width of the rows under them, so every piece rests fully on the one below.
 */
function wallsOf(definition: ItemDefinition, length: Tick, width: Tick, height: Tick, door: { width: Tick; height: Tick }, layers: number, weighed: boolean, limit: number): Wall[] {
  const all = preferred(definition, orientationsOf(definition).filter((o) => o.w <= door.width && o.h <= door.height && o.l <= length && o.w <= width && o.h <= height));
  const walls: Wall[] = [];
  const maxSpots = 5_000;
  limit = Math.min(limit, maxSpots + 1);
  // Bound candidate generation independently of physical size. Reject excessive work rather
  // than freezing the editor; a one-piece 1 mm request needs only one spot per candidate.
  let work = 0;
  const budget = 2_000_000;
  for (const depth of [...new Set(all.map((o) => o.l))].sort((a, b) => a - b)) {
    const same = all.filter((o) => o.l === depth);
    let best: Wall['spots'] = [];
    const keep = (spots: Wall['spots']) => {
      work += spots.length;
      if (spots.length > best.length) best = spots;
    };
    for (const a of same) {
      keep(columns(a, 0, Math.floor(width / a.w), height, layers, limit));
      for (const b of same) {
        if (b === a) continue;
        // Across: i columns of a, the rest of the width in columns of b.
        for (let i = 1; i * a.w <= width && i <= limit && work < budget; i++) keep([...columns(a, 0, i, height, layers, limit), ...columns(b, i * a.w, Math.floor((width - i * a.w) / b.w), height, layers, limit)]);
        // Up: j rows of a, then rows of b no wider than the rows below; j + the rows of b never exceed the stacking limit.
        // A piece of b may rest across two pieces of a, so one of them carries more than one piece's share: with a known weight
        // (a load limit that can be broken) this layout is not used; every column then stands on exactly one piece.
        if (weighed) continue;
        const rowsA = Math.floor(width / a.w) * a.w;
        for (let j = 1; j * a.h <= height && j <= layers && j <= limit && work < budget; j++) keep([...rows(a, 0, j, width, limit), ...rows(b, j * a.h, Math.min(Math.floor((height - j * a.h) / b.h), layers - j), rowsA, limit)]);
      }
    }
    if (work >= budget || best.length > maxSpots) return []; // computationally unsupported, never a partial candidate
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
function topOf(wall: Wall, count: number, width: Tick): Array<{ y0: Tick; y1: Tick; top: Tick; under: number }> {
  const spots = wall.spots.slice(0, count);
  const edges = [...new Set([0, width, ...spots.flatMap((s) => [s.y, s.y + s.o.w])])].filter((e) => e >= 0 && e <= width).sort((a, b) => a - b);
  const out: Array<{ y0: Tick; y1: Tick; top: Tick; under: number }> = [];
  for (let i = 0; i + 1 < edges.length; i++) {
    const y0 = edges[i]!;
    const y1 = edges[i + 1]!;
    const here = spots.filter((s) => s.y <= y0 && s.y + s.o.w >= y1);
    const top = here.reduce((m, s) => Math.max(m, s.z + s.o.h), 0);
    // `under` = pieces standing on each other below this stretch: the stacking limit counts them
    const last = out.at(-1);
    if (last && last.top === top && last.under === here.length) last.y1 = y1;
    else out.push({ y0, y1, top, under: here.length });
  }
  return out;
}

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'part';

/**
 * Work out how many containers of one type the parts need and load each one. Every container
 * is an ordinary container project (id "new"): its cargo types carry the quantity it holds, so
 * the container rules, the cargo plan and the load playback work on it unchanged.
 */
interface ShipmentInput {
  readonly name: string;
  readonly containerType: string;
  readonly parts: readonly ShipmentPart[];
  readonly shipmentId?: string;
}

const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));

/**
 * Plan a shipment. Parts that name a model are loaded as complete sets of that model: the set is the smallest whole
 * ratio of its parts' quantities (700 tops : 700 bottoms : 1 400 sides = 1 : 1 : 2), the most sets that fit one container
 * go in each container, and the last container takes what is left. A container holds the sets of one model only.
 * Parts without a model, and models with a single part, are loaded part by part as before.
 */
export function planShipment(input: ShipmentInput): ShipmentPlan {
  const modelOf = (p: ShipmentPart) => (p.model && p.quantity > 0 ? p.model : undefined);
  const groups = new Map<string, ShipmentPart[]>();
  for (const p of input.parts) {
    const m = modelOf(p);
    if (m !== undefined) groups.set(m, [...(groups.get(m) ?? []), p]);
  }
  const sets = [...groups].filter(([, parts]) => parts.length > 1);
  if (sets.length === 0) return planLoad(input);

  const shipmentId = input.shipmentId ?? slug(input.name);
  const inSets = new Set(sets.flatMap(([, parts]) => parts.map((p) => p.id)));
  const loose = input.parts.filter((p) => !inSets.has(p.id));
  type Piece = { readonly container: ShipmentContainer; readonly note: string };
  const pieces: Piece[] = [];
  const tooBig: string[] = [];
  const notes: string[] = [];
  const unplanned: string[] = [];
  for (const [model, parts] of sets) {
    const unit = parts.map((p) => Math.round(p.quantity)).reduce(gcd);
    const ratio = parts.map((p) => Math.round(p.quantity) / unit);
    const one = (count: number) => planLoad({ name: input.name, containerType: input.containerType, shipmentId, parts: parts.map((p, i) => ({ ...p, quantity: ratio[i]! * count })) });
    // the most whole sets one container takes (more sets never fit if fewer do not: loading is monotone), found by halving
    const first = one(1);
    if (first.tooBig.length > 0 || first.containers.length !== 1) {
      tooBig.push(...first.tooBig);
      notes.push(`${model}: one set does not fit a container`);
      unplanned.push(model);
      continue;
    }
    let low = 1;
    let high = unit;
    let unsupported = false;
    while (low < high) {
      const mid = Math.ceil((low + high) / 2);
      const candidate = one(mid);
      if (candidate.tooBig.length > 0) {
        tooBig.push(...candidate.tooBig);
        unsupported = true;
        break;
      }
      if (candidate.containers.length === 1) low = mid;
      else high = mid - 1;
    }
    if (unsupported) {
      notes.push(`${model}: exceeds supported planning limits`);
      unplanned.push(model);
      continue;
    }
    const perContainer = low;
    const full = Math.floor(unit / perContainer);
    const rest = unit - full * perContainer;
    for (let c = 0; c < full + (rest > 0 ? 1 : 0); c++) {
      const count = c < full ? perContainer : rest;
      pieces.push({ container: one(count).containers[0]!, note: `${model}: ${count} full sets` });
    }
    notes.push(`${model}: ${unit} sets (${parts.map((p, i) => `${ratio[i]} × ${p.name}`).join(' + ')} each), ${perContainer} per container`);
  }
  // parts that belong to no set follow, loaded as before
  if (loose.some((p) => p.quantity > 0)) {
    const rest = planLoad({ ...input, shipmentId, parts: loose });
    pieces.push(...rest.containers.map((container) => ({ container, note: '' })));
    tooBig.push(...rest.tooBig);
  }
  const containers = pieces.map(({ container }, index): ShipmentContainer => ({
    ...container,
    project: {
      ...container.project,
      name: `${input.name} · container ${index + 1} of ${pieces.length}`,
      space: { ...container.project.space, meta: { ...container.project.space.meta, shipment: shipmentId, shipmentName: input.name, shipmentIndex: index + 1, shipmentCount: pieces.length } },
    },
  }));
  const total = containers.reduce((s, c) => s + Object.values(c.pieces).reduce((a, b) => a + b, 0), 0);
  const type = containerType(input.containerType);
  const explanation = `${total} pieces need ${containers.length} × ${type?.label ?? input.containerType}; every container holds complete sets. ${notes.join('; ')}.`;
  return { containers, tooBig: [...new Set(tooBig)], unplanned, explanation };
}

/** One load plan for parts taken as they are (the loader described at the top of this file). */
function planLoad(input: ShipmentInput): ShipmentPlan {
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
    // The planned stack limit is written into the cargo data, so the container's own load-on-top rule checks the plan against it.
    meta: {
      stackable: stackLayersOf(p) > 1,
      allowTilt: p.allowTilt === true,
      ...(p.maxLoadOnTop !== undefined
        ? { maxLoadOnTop: p.maxLoadOnTop }
        : p.mass !== undefined && Number.isFinite(stackLayersOf(p)) && stackLayersOf(p) > 1 ? { maxLoadOnTop: (stackLayersOf(p) - 1) * p.mass } : {}),
    },
  }));
  const layersOf = new Map(input.parts.map((p) => [p.id, stackLayersOf(p)]));
  const weighedOf = new Map(input.parts.map((p) => [p.id, p.mass !== undefined]));
  const sizeOk = new Map(input.parts.map((p) => [p.id, measurable(p)]));
  const options = new Map(definitions.map((d) => [d.id, sizeOk.get(d.id) ? wallsOf(d, length, width, height, door, layersOf.get(d.id)!, weighedOf.get(d.id)!, Math.max(1, input.parts.reduce((n, p) => n + Math.round(p.quantity), 0))) : []]));
  // The payload caps a container as surely as its length: heavy cargo (tiles, steel, paper) fills it by weight first.
  const payload = type?.maxPayload;
  const tooBig = input.parts
    .filter((p) => p.quantity > 0 && (!sizeOk.get(p.id) || options.get(p.id)!.length === 0 || (p.mass !== undefined && payload !== undefined && p.mass > payload)))
    .map((p) => p.id);
  const rate = (w: Wall) => w.spots.length / w.depth;

  // Parts of the same size and handling (a cushion's top and bottom) share walls: a crew finishes
  // a wall with the next part instead of leaving it half empty. One stream per size, in input order.
  const streams: Array<{ key: string; ids: string[]; left: number; mass: number | undefined; layers: number }> = [];
  for (const p of input.parts) {
    if (p.quantity <= 0 || tooBig.includes(p.id)) continue;
    const layers = layersOf.get(p.id)!;
    const key = `${p.length}x${p.width}x${p.height}|${p.allowTilt === true}|${p.mass ?? '-'}|${layers}`;
    const stream = streams.find((s) => s.key === key);
    if (stream) {
      stream.ids.push(p.id);
      stream.left += Math.round(p.quantity);
    } else streams.push({ key, ids: [p.id], left: Math.round(p.quantity), mass: p.mass, layers });
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
  const turns = new Map(streams.map((s) => {
    const d = definitions.find((x) => x.id === s.ids[0])!;
    return [s, preferred(d, orientationsOf(d).filter((o) => o.w <= door.width && o.h <= door.height))];
  }));

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
          // Pieces standing on others must keep the column within both parts' stacking limits (the foot of the column is the one that breaks).
          const above = flat.under === 0 ? s.layers : Math.min(s.layers, placed.stream.layers) - flat.under;
          if (above <= 0) continue;
          // Pieces poured on top of other pieces may bridge two of them: with a known weight on either side that is not done.
          if (flat.under > 0 && (s.mass !== undefined || placed.stream.mass !== undefined)) continue;
          const fit = (o: Orientation) => Math.floor(room.l / o.l) * Math.floor(room.w / o.w) * Math.min(Math.floor(room.h / o.h), above);
          const o = turns.get(s)!.reduce<Orientation | undefined>((b, t) => (fit(t) > (b ? fit(b) : 0) ? t : b), undefined);
          if (!o) continue;
          const spots: Spot[] = [];
          for (let k = 0; (k + 1) * o.h <= room.h && k < above && spots.length < s.left; k++)
            for (let j = 0; (j + 1) * o.w <= room.w && spots.length < s.left; j++)
              for (let i = 0; (i + 1) * o.l <= room.l && spots.length < s.left; i++) spots.push({ x: placed.x + i * o.l, y: flat.y0 + j * o.w, z: flat.top + k * o.h, o });
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
  /**
   * Heavy cargo is spread, not piled: a load of one weighed part that does not need the whole container (it stopped at
   * the payload, or it is the last one) goes in as few layers as the floor allows, centred along the length, its last
   * partial row centred across the width. Piled at the front wall, 20 tile pallets put the centre of mass 27 % off the
   * middle (the balance rule allows 10 %); spread one high over 11 m they sit in the middle. Loads without weights stay
   * as they were: walls from the front wall to the doors.
   */
  function spread(load: { walls: Placed[]; used: Tick }) {
    const first = load.walls[0];
    if (!first || first.stream.mass === undefined || load.walls.some((w) => w.stream !== first.stream || w.wall !== first.wall || w.fill.length > 0)) return;
    const wall = first.wall;
    const levels = [...new Set(wall.spots.map((p) => p.z))].sort((a, b) => a - b);
    const layer = wall.spots.filter((p) => p.z === levels[0]);
    const count = load.walls.reduce((n, w) => n + w.count, 0);
    const room = Math.floor(length / wall.depth);
    const needed = Math.ceil(count / (layer.length * room));
    if (needed >= levels.length && load.walls.length >= room) return; // already as flat and as long as it can be
    const keep = new Set(levels.slice(0, Math.max(1, needed)));
    const flat: Wall = { depth: wall.depth, spots: wall.spots.filter((p) => keep.has(p.z)) };
    const walls = Math.ceil(count / flat.spots.length);
    const offset = Math.floor((length - walls * flat.depth) / 2);
    let left = count;
    load.walls = [];
    for (let i = 0; i < walls; i++) {
      const n = Math.min(flat.spots.length, left);
      let use = flat;
      if (n < flat.spots.length && n < layer.length) {
        // a last row of a few pieces stands in the middle of the width, not against one side
        const row = flat.spots.filter((p) => p.z === levels[0]).slice(0, n);
        const lo = Math.min(...row.map((p) => p.y)), hi = Math.max(...row.map((p) => p.y + p.o.w));
        const shift = Math.floor((width - (hi - lo)) / 2) - lo;
        use = { depth: flat.depth, spots: row.map((p) => ({ ...p, y: p.y + shift })) };
      }
      load.walls.push({ stream: first.stream, wall: use, count: n, x: offset + i * flat.depth, fill: [] });
      left -= n;
    }
    load.used = walls * flat.depth;
  }

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
    spread(load);
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
  // the highest column of pieces whose layer limit nobody stated: said in the plan when it is more than a few
  const unlimited = new Set(input.parts.filter((p) => !Number.isFinite(stackLayersOf(p))).map((p) => p.id));
  let stackedHigh = 0;
  for (const c of containers) {
    const levels = new Set(Object.values(c.project.items).filter((i) => unlimited.has(i.definitionId)).map((i) => i.elevation ?? 0));
    stackedHigh = Math.max(stackedHigh, levels.size);
  }
  if (stackedHigh <= 3) stackedHigh = 0;
  const explanation =
    total === 0
      ? (tooBig.length ? 'No load planned: some parts exceed the container, payload or supported planning limits.' : 'Nothing to load: give the parts a quantity.')
      : `${total} pieces need ${containers.length} × ${type?.label ?? input.containerType}` +
        (containers.length > 0 ? `; the last one is ${Math.round((containers.at(-1)!.usedLength / length) * 100)}% full along its length.` : '.') +
        (tooBig.length > 0 ? ` ${tooBig.length} part type(s) exceed the container, payload or supported planning limits.` : '') +
        (stackedHigh
          ? ` Pieces with no layer limit stated stand up to ${stackedHigh} high: state a limit (Layers) for anything fragile or heavy.`
          : '') +
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
