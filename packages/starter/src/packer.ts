import { apply, area, boundsOf, clipConvex, itemPolygon, type Command, type Polygon, type Id, type ItemDefinition, type Project, type Tick, type Tilt } from '@space-planner/core';
import { cargoOf, CONTACT_TOLERANCE, containerMetrics, MIN_SUPPORT, stackingOf, stepOf } from './container.js';
import type { Candidate, OptimizationPort } from './optimization.js';

/**
 * Deterministic container packing by extreme points (after Crainic, Perboli and Tadei 2008):
 * pieces are placed one by one at the first corner point, in (depth from the front wall, height,
 * side) order, where some allowed orientation fits inside the container and the door opening,
 * clashes with nothing, and rests at least 70% of its base on pieces that may carry it.
 * It proposes; it never guarantees the best load. Pieces already placed stay where they are.
 */

export type PackStrategy = 'largest-first' | 'heaviest-first' | 'footprint-first';

export interface PackGoal {
  readonly strategy?: PackStrategy;
}

interface Box {
  readonly x0: Tick;
  readonly y0: Tick;
  readonly z0: Tick;
  readonly x1: Tick;
  readonly y1: Tick;
  readonly z1: Tick;
  readonly definition: ItemDefinition;
  /** Its floor outline as the checks see it (round pieces are polygons). */
  readonly outline: Polygon;
  /** Grams resting on it, including everything above. */
  load: number;
  /** What it rests on, with the share of its weight each one carries. */
  on: Array<{ readonly box: Box; readonly share: number }>;
}

/** Grams each box below would carry if `grams` more rested on `supporters`, passed down every stack. */
function addedLoads(supporters: ReadonlyArray<{ box: Box; share: number }>, grams: number, into = new Map<Box, number>()): Map<Box, number> {
  for (const { box, share } of supporters) {
    const part = grams * share;
    into.set(box, (into.get(box) ?? 0) + part);
    addedLoads(box.on, part, into);
  }
  return into;
}

interface Orientation {
  /** Room the piece takes along the length (x) and across (y): the outline the checks use. */
  readonly l: Tick;
  readonly w: Tick;
  readonly h: Tick;
  readonly rotation: 0 | 90_000;
  readonly tilt?: Tilt;
}

const STRATEGY_LABEL: Readonly<Record<PackStrategy, string>> = {
  'largest-first': 'Largest first',
  'heaviest-first': 'Heaviest first',
  'footprint-first': 'Widest base first',
};

/** Every distinct way a piece of this type may stand: turned or not, and on its side when allowed. */
export function orientationsOf(definition: ItemDefinition): Orientation[] {
  const { w, d, h } = definition.size;
  const upright: Array<[Tick, Tick, Tick, Tilt | undefined]> = [[w, d, h, undefined]];
  if (cargoOf(definition).allowTilt === true) upright.push([h, d, w, 'x'], [w, h, d, 'y']);
  const seen = new Set<string>();
  const out: Orientation[] = [];
  for (const [, , ph, tilt] of upright) {
    for (const rotation of [0, 90_000] as const) {
      // Measure the outline the core checks with (round pieces use a slightly larger polygon).
      const probe = boundsOf(itemPolygon({ id: 'probe', definitionId: definition.id, position: { x: 0, y: 0 }, rotation, locked: false, ...(tilt ? { tilt } : {}) }, definition));
      const o = { l: Math.ceil(probe.maxX - probe.minX), w: Math.ceil(probe.maxY - probe.minY), h: ph };

      const key = `${o.l}x${o.w}x${o.h}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ ...o, rotation, ...(tilt ? { tilt } : {}) });
    }
  }
  return out;
}

/** The piece's floor outline with the corner of its bounding box at (x, y). */
function outlineAt(definition: ItemDefinition, o: Orientation, x: Tick, y: Tick): Polygon {
  const centre = { x: Math.round(x + o.l / 2), y: Math.round(y + o.w / 2) };
  return itemPolygon({ id: 'probe', definitionId: definition.id, position: centre, rotation: o.rotation, locked: false, ...(o.tilt ? { tilt: o.tilt } : {}) }, definition);
}

const overlaps = (a0: number, a1: number, b0: number, b1: number) => a0 < b1 - CONTACT_TOLERANCE && b0 < a1 - CONTACT_TOLERANCE;

/** Pieces planned but not placed yet, one entry per piece, in the strategy's order. */
function piecesToPlace(project: Project, strategy: PackStrategy): ItemDefinition[] {
  const placed = new Map<Id, number>();
  for (const item of Object.values(project.items)) placed.set(item.definitionId, (placed.get(item.definitionId) ?? 0) + 1);
  const pieces: ItemDefinition[] = [];
  for (const definition of Object.values(project.catalog)) {
    const missing = (cargoOf(definition).quantity ?? 0) - (placed.get(definition.id) ?? 0);
    for (let i = 0; i < missing; i++) pieces.push(definition);
  }
  const volume = (d: ItemDefinition) => d.size.w * d.size.d * d.size.h;
  const base = (d: ItemDefinition) => d.size.w * d.size.d;
  const key = (d: ItemDefinition): number[] => {
    // Later stops go in first, deepest; then the strategy decides.
    const stop = -(cargoOf(d).stop ?? 0);
    if (strategy === 'heaviest-first') return [stop, -(d.mass ?? 0), -volume(d)];
    if (strategy === 'footprint-first') return [stop, -base(d), -d.size.h, -volume(d)];
    return [stop, -volume(d), -(d.mass ?? 0)];
  };
  return pieces.sort((a, b) => {
    const ka = key(a);
    const kb = key(b);
    for (let i = 0; i < ka.length; i++) if (ka[i] !== kb[i]) return ka[i]! - kb[i]!;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}

/** Pack the planned pieces with one strategy. */
export function packContainer(project: Project, goal: PackGoal = {}): Candidate {
  const strategy = goal.strategy ?? 'largest-first';
  const room = boundsOf(project.space.boundary);
  const height = project.space.ceilingHeight ?? 0;
  const doorWidth = typeof project.space.meta?.doorWidth === 'number' ? project.space.meta.doorWidth : Infinity;
  const doorHeight = typeof project.space.meta?.doorHeight === 'number' ? project.space.meta.doorHeight : Infinity;

  const stacking = stackingOf(project);
  const boxes: Box[] = stacking.pieces.map((p) => {
    const b = boundsOf(p.body);
    return { x0: b.minX, y0: b.minY, z0: p.bottom, x1: b.maxX, y1: b.maxY, z1: p.top, definition: p.definition, outline: p.body, load: 0, on: [] };
  });
  const points: Array<{ x: Tick; y: Tick; z: Tick }> = [{ x: room.minX, y: room.minY, z: 0 }];
  for (const b of boxes) points.push({ x: b.x1, y: b.y0, z: b.z0 }, { x: b.x0, y: b.y1, z: b.z0 }, { x: b.x0, y: b.y0, z: b.z1 });

  const taken = new Set<string>([project.id, ...Object.keys(project.items), ...Object.keys(project.catalog)]);
  const nextId = (base: string) => {
    for (let n = 1; ; n++) {
      const id = `${base}-${n}`;
      if (!taken.has(id)) {
        taken.add(id);
        return id;
      }
    }
  };
  let step = Object.values(project.items).reduce((m, i) => Math.max(m, stepOf(i) ?? 0), 0);

  const commands: Command[] = [];
  const leftOver: string[] = [];
  for (const definition of piecesToPlace(project, strategy)) {
    const spec = cargoOf(definition);
    const mass = definition.mass ?? 0;
    const orientations = orientationsOf(definition).filter((o) => o.w <= doorWidth && o.h <= doorHeight); // it goes in through the doors
    points.sort((a, b) => a.x - b.x || a.z - b.z || a.y - b.y);
    let chosen: { at: { x: Tick; y: Tick; z: Tick }; o: Orientation; supporters: Array<{ box: Box; share: number }> } | undefined;
    for (const at of points) {
      for (const o of orientations) {
        const x1 = at.x + o.l;
        const y1 = at.y + o.w;
        const z1 = at.z + o.h;
        if (x1 > room.maxX || y1 > room.maxY || z1 > height) continue;
        if (boxes.some((b) => overlaps(at.x, x1, b.x0, b.x1) && overlaps(at.y, y1, b.y0, b.y1) && overlaps(at.z, z1, b.z0, b.z1))) continue;
        // A piece that already overhangs this spot would come to rest on the new one: only if it may carry it.
        const under = boxes.some((b) => {
          if (Math.abs(b.z0 - z1) > CONTACT_TOLERANCE) return false;
          if (!(overlaps(at.x, x1, b.x0, b.x1) && overlaps(at.y, y1, b.y0, b.y1))) return false;
          if (area(clipConvex(outlineAt(definition, o, at.x, at.y), b.outline)) <= 0) return false;
          const group = cargoOf(b.definition).stackGroup;
          return spec.stackable === false || ((group ?? spec.stackGroup) !== undefined && group !== spec.stackGroup);
        });
        if (under) continue;
        const supporters: Array<{ box: Box; share: number }> = [];
        if (at.z > CONTACT_TOLERANCE) {
          let supported = 0;
          for (const b of boxes) {
            if (Math.abs(b.z1 - at.z) > CONTACT_TOLERANCE) continue;
            const dx = Math.min(x1, b.x1) - Math.max(at.x, b.x0);
            const dy = Math.min(y1, b.y1) - Math.max(at.y, b.y0);
            if (dx <= 0 || dy <= 0) continue;
            // Contact measured on real outlines, as the support rule does (a drum's top is round).
            const footprint = outlineAt(definition, o, at.x, at.y);
            const contact = area(clipConvex(footprint, b.outline));
            if (contact <= 0) continue;
            supported += contact;
            supporters.push({ box: b, share: contact });
          }
          if (supported < MIN_SUPPORT * area(outlineAt(definition, o, at.x, at.y))) continue;
          const allowed = supporters.every(({ box }) => {
            const below = cargoOf(box.definition);
            if (below.stackable === false) return false;
            return !((below.stackGroup ?? spec.stackGroup) !== undefined && below.stackGroup !== spec.stackGroup);
          });
          if (!allowed) continue;
          for (const s of supporters) s.share /= supported;
          // The new weight travels down every stack: no piece below may end up over its limit.
          const extra = addedLoads(supporters, mass);
          const overloaded = [...extra].some(([box, grams]) => {
            const limit = cargoOf(box.definition).maxLoadOnTop;
            return limit !== undefined && box.load + grams > limit;
          });
          if (overloaded) continue;
        }
        if (!chosen || x1 < chosen.at.x + chosen.o.l || (x1 === chosen.at.x + chosen.o.l && z1 < chosen.at.z + chosen.o.h)) chosen = { at, o, supporters };
      }
      if (chosen) break; // first corner (deepest, lowest) where anything fits
    }
    if (!chosen) {
      leftOver.push(definition.id);
      continue;
    }
    const { at, o, supporters } = chosen;
    const box: Box = { x0: at.x, y0: at.y, z0: at.z, x1: at.x + o.l, y1: at.y + o.w, z1: at.z + o.h, definition, outline: outlineAt(definition, o, at.x, at.y), load: 0, on: supporters };
    for (const [below, grams] of addedLoads(supporters, mass)) below.load += grams;
    boxes.push(box);
    points.push({ x: box.x1, y: box.y0, z: box.z0 }, { x: box.x0, y: box.y1, z: box.z0 }, { x: box.x0, y: box.y0, z: box.z1 });
    for (let i = points.length - 1; i >= 0; i--) {
      const p = points[i]!;
      if (p.x >= box.x0 && p.x < box.x1 && p.y >= box.y0 && p.y < box.y1 && p.z >= box.z0 && p.z < box.z1) points.splice(i, 1);
    }
    step++;
    commands.push({
      type: 'item.add',
      item: {
        id: nextId(definition.id),
        definitionId: definition.id,
        position: { x: Math.round((box.x0 + box.x1) / 2), y: Math.round((box.y0 + box.y1) / 2) },
        rotation: o.rotation,
        locked: false,
        ...(box.z0 > 0 ? { elevation: box.z0 } : {}),
        ...(o.tilt ? { tilt: o.tilt } : {}),
        meta: { step },
      },
    });
  }

  let after = project;
  if (commands.length > 0) {
    const result = apply(project, { type: 'batch', commands });
    if (result.ok) after = result.project;
  }
  const m = containerMetrics(after);
  const metrics: Record<string, number> = { placed: commands.length, leftOver: leftOver.length, volumeUse: m.volumeUse, floorUse: m.floorUse };
  if (m.mass !== undefined) metrics.mass = m.mass;
  if (m.payloadUse !== undefined) metrics.payloadUse = m.payloadUse;
  if (m.balance) {
    metrics.balanceAlong = m.balance.along;
    metrics.balanceAcross = m.balance.across;
  }
  const percent = (v: number) => `${Math.round(v * 1000) / 10}%`;
  const explanation =
    commands.length === 0 && leftOver.length === 0
      ? 'Nothing to place: set a quantity on the cargo types to plan a load.'
      : `${STRATEGY_LABEL[strategy]}: placed ${commands.length} of ${commands.length + leftOver.length} pieces, ${percent(m.volumeUse)} of the volume` +
        (m.payloadUse !== undefined ? `, ${percent(m.payloadUse)} of the payload` : '') +
        (leftOver.length > 0 ? `; ${leftOver.length} did not fit.` : '.');
  return { label: STRATEGY_LABEL[strategy], commands, metrics, explanation, leftOver };
}

/** The three built-in strategies as candidates, best first: most pieces placed, then fullest. */
export const extremePointPacker: OptimizationPort<PackGoal> = {
  id: 'starter.extreme-points',
  propose(project) {
    const candidates = (['largest-first', 'heaviest-first', 'footprint-first'] as const).map((strategy) => packContainer(project, { strategy }));
    const unique = candidates.filter((c, i) => candidates.findIndex((d) => JSON.stringify(d.commands) === JSON.stringify(c.commands)) === i);
    return unique.sort((a, b) => (b.metrics.placed ?? 0) - (a.metrics.placed ?? 0) || (b.metrics.volumeUse ?? 0) - (a.metrics.volumeUse ?? 0));
  },
};
