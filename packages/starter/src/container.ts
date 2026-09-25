import {
  area,
  boundsOf,
  clipConvex,
  createProject,
  createSpace,
  fromUnit,
  gridIndex,
  itemPolygon,
  measureProject,
  placedSize,
  rectangleBoundary,
  type Id,
  type ItemDefinition,
  type ItemInstance,
  type Meta,
  type Polygon,
  type Project,
  type Tick,
} from '@space-planner/core';
import type { RuleResult } from './rules.js';

/**
 * Container loading pack: container types, cargo data kept in `meta`, and the loading rules.
 * The core already checks overlaps, the walls and the roof (ceiling); this pack adds what only
 * cargo has: payload, support, load on top, orientation, stacking groups, unloading order,
 * balance and planned quantities.
 *
 * Axes: the container's length runs along X from the front wall (x = 0) to the doors (x = length),
 * its width along Y, height along Z.
 */

const cm = (v: number) => fromUnit(v, 'cm');
const kg = (v: number) => Math.round(v * 1000);

export interface ContainerType {
  readonly id: string;
  readonly label: string;
  /** Inside length, width and height. */
  readonly length: Tick;
  readonly width: Tick;
  readonly height: Tick;
  readonly doorWidth: Tick;
  readonly doorHeight: Tick;
  /** Typical maximum payload in grams. */
  readonly maxPayload: number;
}

/** Typical inside sizes and payloads (common guidance: always check the actual unit). */
export const CONTAINER_TYPES: readonly ContainerType[] = [
  { id: '20gp', label: '20′ standard', length: cm(589), width: cm(235), height: cm(239), doorWidth: cm(234), doorHeight: cm(228), maxPayload: kg(28_200) },
  { id: '40gp', label: '40′ standard', length: cm(1203), width: cm(235), height: cm(239), doorWidth: cm(234), doorHeight: cm(228), maxPayload: kg(26_700) },
  { id: '40hc', label: '40′ high cube', length: cm(1203), width: cm(235), height: cm(269), doorWidth: cm(234), doorHeight: cm(258), maxPayload: kg(26_500) },
  { id: '45hc', label: '45′ high cube', length: cm(1356), width: cm(235), height: cm(269), doorWidth: cm(234), doorHeight: cm(258), maxPayload: kg(25_600) },
  { id: '20rf', label: '20′ reefer', length: cm(544), width: cm(229), height: cm(227), doorWidth: cm(229), doorHeight: cm(226), maxPayload: kg(27_400) },
  { id: '40rh', label: '40′ reefer high cube', length: cm(1158), width: cm(229), height: cm(255), doorWidth: cm(229), doorHeight: cm(250), maxPayload: kg(29_000) },
  { id: 'trailer', label: 'Semi-trailer 13.6 m', length: cm(1360), width: cm(248), height: cm(270), doorWidth: cm(248), doorHeight: cm(270), maxPayload: kg(24_000) },
];

export function containerType(id: string | null | undefined): ContainerType | undefined {
  return CONTAINER_TYPES.find((t) => t.id === id);
}

const none = { front: 0, back: 0, left: 0, right: 0 };
const cargo = (id: string, name: string, w: number, d: number, h: number, massKg: number, meta: Meta, round = false): ItemDefinition => ({
  id,
  name,
  category: 'box',
  size: { w: cm(w), d: cm(d), h: cm(h) },
  clearance: none,
  mass: kg(massKg),
  meta,
  ...(round ? { footprint: 'round' as const } : {}),
});

/** Sample cargo types a new container project starts with; people add their own. */
export const CONTAINER_CATALOG: readonly ItemDefinition[] = [
  cargo('euro-pallet', 'Euro pallet 120 × 80', 120, 80, 150, 400, { stackable: true, maxLoadOnTop: kg(800), allowTilt: false }),
  cargo('us-pallet', 'Pallet 120 × 100', 120, 100, 150, 500, { stackable: true, maxLoadOnTop: kg(1000), allowTilt: false }),
  cargo('crate', 'Wooden crate 120 × 100 × 100', 120, 100, 100, 350, { stackable: true, maxLoadOnTop: kg(700), allowTilt: false }),
  cargo('carton-large', 'Carton 60 × 40 × 40', 60, 40, 40, 12, { stackable: true, maxLoadOnTop: kg(60), allowTilt: true }),
  cargo('carton-small', 'Carton 40 × 30 × 30', 40, 30, 30, 6, { stackable: true, maxLoadOnTop: kg(40), allowTilt: true }),
  cargo('fragile-carton', 'Fragile carton 60 × 40 × 50', 60, 40, 50, 8, { stackable: false, allowTilt: false }),
  cargo('drum', 'Drum 200 L', 58, 58, 88, 220, { stackable: true, maxLoadOnTop: kg(440), allowTilt: false }, true),
  cargo('machine-crate', 'Machine crate 200 × 120 × 160', 200, 120, 160, 1500, { stackable: false, allowTilt: false }),
];

export const CONTAINER_STYLES = [{ id: 'general', label: 'General cargo' }] as const;

/** A new container project: an empty box of the chosen type with the sample cargo types. */
export function newContainer(name: string, typeId: string, custom?: { length: Tick; width: Tick; height: Tick; maxPayload?: number }): Project {
  const type = containerType(typeId);
  const length = custom?.length ?? type?.length ?? CONTAINER_TYPES[0]!.length;
  const width = custom?.width ?? type?.width ?? CONTAINER_TYPES[0]!.width;
  const height = custom?.height ?? type?.height ?? CONTAINER_TYPES[0]!.height;
  const maxPayload = custom ? custom.maxPayload : (type ?? CONTAINER_TYPES[0]!).maxPayload;
  const meta: Record<string, string | number> = { pack: 'container', containerType: custom ? 'custom' : (type ?? CONTAINER_TYPES[0]!).id, doorEnd: 'east' };
  if (maxPayload !== undefined) meta.maxPayload = maxPayload;
  if (!custom && type) {
    meta.doorWidth = type.doorWidth;
    meta.doorHeight = type.doorHeight;
  }
  const base = createProject('new', name, createSpace(rectangleBoundary(length, width), { ceilingHeight: height, meta }));
  return { ...base, catalog: Object.fromEntries(CONTAINER_CATALOG.map((d) => [d.id, d])) };
}

/** True for projects made as containers. */
export function isContainer(project: Project): boolean {
  return project.space.meta?.pack === 'container';
}

/** How a cargo type may be handled, read from its `meta`; undefined means "not stated". */
export interface CargoSpec {
  readonly allowTilt?: boolean;
  readonly stackable?: boolean;
  /** Grams that may rest on one piece. */
  readonly maxLoadOnTop?: number;
  readonly stackGroup?: string;
  /** Pieces planned for this load. */
  readonly quantity?: number;
  /** Default unloading stop for pieces of this type (1 = unloaded first). */
  readonly stop?: number;
}

const bool = (v: unknown) => (typeof v === 'boolean' ? v : undefined);
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
const str = (v: unknown) => (typeof v === 'string' && v !== '' ? v : undefined);

export function cargoOf(definition: ItemDefinition): CargoSpec {
  const m = definition.meta ?? {};
  const spec: Record<string, unknown> = {
    allowTilt: bool(m.allowTilt),
    stackable: bool(m.stackable),
    maxLoadOnTop: num(m.maxLoadOnTop),
    stackGroup: str(m.stackGroup),
    quantity: num(m.quantity),
    stop: num(m.stop),
  };
  return Object.fromEntries(Object.entries(spec).filter(([, v]) => v !== undefined)) as CargoSpec;
}

/** The unloading stop of a placed piece: its own, else its type's. */
export function stopOf(item: ItemInstance, definition: ItemDefinition): number | undefined {
  return num(item.meta?.stop) ?? cargoOf(definition).stop;
}

/** The loading step of a placed piece (1 = loaded first). */
export function stepOf(item: ItemInstance): number | undefined {
  return num(item.meta?.step);
}

/** Pieces whose supports are closer than this (5 mm) count as resting on each other. */
export const CONTACT_TOLERANCE = cm(0.5);
/** Share of a raised piece's base that must rest on pieces below. */
export const MIN_SUPPORT = 0.7;
/** Allowed centre-of-mass offset from the middle, as a share of the length and of the width. */
export const MAX_BALANCE_OFFSET = 0.1;

/** A placed piece as a box: floor outline, underside and top. */
export interface Piece {
  readonly item: ItemInstance;
  readonly definition: ItemDefinition;
  readonly body: Polygon;
  readonly bottom: Tick;
  readonly top: Tick;
  readonly area: number;
}

/**
 * Where a piece comes to rest if it is let down: on top of the highest piece below its outline
 * (at or under its current underside), or on the floor. Snaps a piece onto a stack.
 */
export function dropHeight(project: Project, id: Id): Tick {
  const item = project.items[id];
  if (!item) return 0;
  const body = itemPolygon(item, project.catalog[item.definitionId]!);
  const bottom = item.elevation ?? 0;
  let rest = 0;
  for (const other of Object.values(project.items)) {
    if (other.id === id) continue;
    const definition = project.catalog[other.definitionId]!;
    const top = (other.elevation ?? 0) + placedSize(other, definition).h;
    if (top > bottom + CONTACT_TOLERANCE || top <= rest) continue;
    if (area(clipConvex(body, itemPolygon(other, definition))) > 0) rest = top;
  }
  return rest;
}

/** Contacts between pieces: who rests on whom, and over how much area. */
export interface Stacking {
  readonly pieces: readonly Piece[];
  /** For each piece, the pieces it rests on with the contact area. */
  readonly below: ReadonlyMap<Id, ReadonlyArray<{ readonly id: Id; readonly area: number }>>;
  /** Share of each raised piece's base that is supported (1 for pieces on the floor). */
  readonly support: ReadonlyMap<Id, number>;
}

export function stackingOf(project: Project): Stacking {
  const pieces: Piece[] = Object.values(project.items)
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .map((item) => {
      const definition = project.catalog[item.definitionId]!;
      const body = itemPolygon(item, definition);
      const bottom = item.elevation ?? 0;
      return { item, definition, body, bottom, top: bottom + placedSize(item, definition).h, area: area(body) };
    });
  const near = gridIndex(pieces.map((p) => boundsOf(p.body)));
  const below = new Map<Id, Array<{ id: Id; area: number }>>();
  const support = new Map<Id, number>();
  pieces.forEach((p, i) => {
    if (p.bottom <= CONTACT_TOLERANCE) {
      support.set(p.item.id, 1);
      return;
    }
    const under: Array<{ id: Id; area: number }> = [];
    for (const j of near.query(boundsOf(p.body))) {
      if (j === i) continue;
      const q = pieces[j]!;
      if (Math.abs(q.top - p.bottom) > CONTACT_TOLERANCE) continue;
      const contact = area(clipConvex(p.body, q.body));
      if (contact > 0) under.push({ id: q.item.id, area: contact });
    }
    below.set(p.item.id, under);
    const supported = under.reduce((sum, u) => sum + u.area, 0);
    support.set(p.item.id, p.area > 0 ? Math.min(1, supported / p.area) : 0);
  });
  return { pieces, below, support };
}

/**
 * Weight resting on each piece from the pieces above it, in grams. Each raised piece passes its own
 * mass plus everything it carries to the pieces below, shared by contact area. Undefined when any
 * piece in the load has no mass.
 */
export function loadsOnTop(project: Project, stacking: Stacking = stackingOf(project)): ReadonlyMap<Id, number> | undefined {
  if (stacking.pieces.some((p) => p.definition.mass === undefined)) return undefined;
  const carried = new Map<Id, number>(stacking.pieces.map((p) => [p.item.id, 0]));
  // Highest first, so a piece hands down its load only after receiving everything above it.
  const order = [...stacking.pieces].sort((a, b) => b.bottom - a.bottom || (a.item.id < b.item.id ? -1 : 1));
  for (const p of order) {
    const under = stacking.below.get(p.item.id);
    if (!under || under.length === 0) continue;
    const total = p.definition.mass! + carried.get(p.item.id)!;
    const contact = under.reduce((sum, u) => sum + u.area, 0);
    for (const u of under) carried.set(u.id, carried.get(u.id)! + (total * u.area) / contact);
  }
  return carried;
}

const unknown = (code: RuleResult['code'], unit: RuleResult['unit'], reason: NonNullable<RuleResult['reason']>, extra: Partial<RuleResult> = {}): RuleResult => ({ code, unit, status: 'unknown', reason, entityIds: [], ...extra });

/** The loading rules, in a fixed order. */
export function checkContainer(project: Project): RuleResult[] {
  const stacking = stackingOf(project);
  const { pieces } = stacking;
  if (pieces.length === 0) {
    return [
      unknown('payload', 'grams', 'no-cargo'),
      unknown('support', 'percent', 'no-cargo'),
      unknown('load-on-top', 'grams', 'no-cargo'),
      unknown('orientation', 'items', 'no-cargo'),
      unknown('stacking-group', 'items', 'no-cargo'),
      unknown('unloading-order', 'items', 'no-cargo'),
      unknown('balance', 'percent', 'no-cargo'),
      unplannedRule(project),
    ];
  }
  return [
    payloadRule(project),
    supportRule(stacking),
    loadOnTopRule(project, stacking),
    orientationRule(pieces),
    stackingGroupRule(stacking),
    unloadingRule(project, pieces),
    balanceRule(project),
    unplannedRule(project),
  ];
}

function payloadRule(project: Project): RuleResult {
  const limit = num(project.space.meta?.maxPayload);
  const mass = measureProject(project).mass;
  if (mass === undefined) return unknown('payload', 'grams', 'no-mass', limit === undefined ? {} : { required: limit });
  if (limit === undefined) return unknown('payload', 'grams', 'no-payload', { measured: mass });
  return { code: 'payload', unit: 'grams', required: limit, measured: mass, status: mass <= limit ? 'pass' : 'fail', entityIds: [] };
}

function supportRule(stacking: Stacking): RuleResult {
  let worst = 1;
  const weak: Id[] = [];
  for (const p of stacking.pieces) {
    const s = stacking.support.get(p.item.id)!;
    worst = Math.min(worst, s);
    if (s < MIN_SUPPORT) weak.push(p.item.id);
  }
  return { code: 'support', unit: 'percent', required: MIN_SUPPORT * 100, measured: Math.floor(worst * 1000) / 10, status: weak.length === 0 ? 'pass' : 'fail', entityIds: weak };
}

function loadOnTopRule(project: Project, stacking: Stacking): RuleResult {
  const loads = loadsOnTop(project, stacking);
  if (!loads) return unknown('load-on-top', 'grams', 'no-mass');
  const over: Id[] = [];
  let missing = false;
  let worst = 0;
  for (const p of stacking.pieces) {
    const load = loads.get(p.item.id)!;
    if (load <= 0) continue;
    const spec = cargoOf(p.definition);
    const limit = spec.stackable === false ? 0 : spec.maxLoadOnTop;
    if (limit === undefined) {
      missing = true;
      continue;
    }
    if (load > limit) over.push(p.item.id);
    worst = Math.max(worst, Math.round(load));
  }
  if (over.length > 0) return { code: 'load-on-top', unit: 'grams', measured: worst, status: 'fail', entityIds: over };
  if (missing) return unknown('load-on-top', 'grams', 'no-stacking-data', { measured: worst });
  return { code: 'load-on-top', unit: 'grams', measured: worst, status: 'pass', entityIds: [] };
}

function orientationRule(pieces: readonly Piece[]): RuleResult {
  const wrong: Id[] = [];
  let unstated = false;
  for (const p of pieces) {
    if (!p.item.tilt) continue;
    const allow = cargoOf(p.definition).allowTilt;
    if (allow === false) wrong.push(p.item.id);
    else if (allow === undefined) unstated = true;
  }
  if (wrong.length > 0) return { code: 'orientation', unit: 'items', measured: wrong.length, required: 0, status: 'fail', entityIds: wrong };
  if (unstated) return unknown('orientation', 'items', 'no-orientation-data');
  return { code: 'orientation', unit: 'items', measured: 0, required: 0, status: 'pass', entityIds: [] };
}

function stackingGroupRule(stacking: Stacking): RuleResult {
  const byId = new Map(stacking.pieces.map((p) => [p.item.id, p]));
  const wrong: Id[] = [];
  for (const p of stacking.pieces) {
    const group = cargoOf(p.definition).stackGroup;
    for (const u of stacking.below.get(p.item.id) ?? []) {
      const other = cargoOf(byId.get(u.id)!.definition).stackGroup;
      if ((group !== undefined || other !== undefined) && group !== other) {
        wrong.push(p.item.id);
        break;
      }
    }
  }
  return { code: 'stacking-group', unit: 'items', measured: wrong.length, required: 0, status: wrong.length === 0 ? 'pass' : 'fail', entityIds: wrong };
}

/**
 * Last in, first out: a piece for an earlier stop must not have a piece for a later stop on top of
 * it, or between it and the doors in the same lane (overlapping across the width and in height).
 */
function unloadingRule(project: Project, pieces: readonly Piece[]): RuleResult {
  const withStop = pieces.map((p) => ({ p, stop: stopOf(p.item, p.definition), box: boundsOf(p.body) })).filter((x) => x.stop !== undefined) as Array<{ p: Piece; stop: number; box: ReturnType<typeof boundsOf> }>;
  if (withStop.length === 0) return unknown('unloading-order', 'items', 'no-stops');
  const blocked: Id[] = [];
  for (const a of withStop) {
    const isBlocked = withStop.some((b) => {
      if (b.stop <= a.stop) return false;
      const acrossOverlap = b.box.minY < a.box.maxY - CONTACT_TOLERANCE && a.box.minY < b.box.maxY - CONTACT_TOLERANCE;
      const alongOverlap = b.box.minX < a.box.maxX - CONTACT_TOLERANCE && a.box.minX < b.box.maxX - CONTACT_TOLERANCE;
      const heightOverlap = b.p.bottom < a.p.top - CONTACT_TOLERANCE && a.p.bottom < b.p.top - CONTACT_TOLERANCE;
      const onTop = alongOverlap && acrossOverlap && b.p.bottom >= a.p.top - CONTACT_TOLERANCE;
      const inFront = acrossOverlap && heightOverlap && b.box.minX >= a.box.maxX - CONTACT_TOLERANCE;
      return onTop || inFront;
    });
    if (isBlocked) blocked.push(a.p.item.id);
  }
  return { code: 'unloading-order', unit: 'items', measured: blocked.length, required: 0, status: blocked.length === 0 ? 'pass' : 'fail', entityIds: blocked };
}

/** Centre-of-mass offset from the middle, as percentages of the length (x) and width (y). */
export function balanceOf(project: Project): { along: number; across: number } | undefined {
  const centre = measureProject(project).centreOfMass;
  if (!centre) return undefined;
  const box = boundsOf(project.space.boundary);
  const length = box.maxX - box.minX;
  const width = box.maxY - box.minY;
  return {
    along: (Math.abs(centre.x - (box.minX + length / 2)) / length) * 100,
    across: (Math.abs(centre.y - (box.minY + width / 2)) / width) * 100,
  };
}

function balanceRule(project: Project): RuleResult {
  const offset = balanceOf(project);
  if (!offset) return unknown('balance', 'percent', 'no-mass', { required: MAX_BALANCE_OFFSET * 100 });
  const worst = Math.round(Math.max(offset.along, offset.across) * 10) / 10;
  return { code: 'balance', unit: 'percent', required: MAX_BALANCE_OFFSET * 100, measured: worst, status: worst <= MAX_BALANCE_OFFSET * 100 ? 'pass' : 'fail', entityIds: [] };
}

/** Planned quantity per cargo type against pieces placed. */
export function plannedCounts(project: Project): Array<{ definition: ItemDefinition; planned: number; placed: number }> {
  const placed = new Map<Id, number>();
  for (const item of Object.values(project.items)) placed.set(item.definitionId, (placed.get(item.definitionId) ?? 0) + 1);
  return Object.values(project.catalog)
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .map((definition) => ({ definition, planned: cargoOf(definition).quantity ?? 0, placed: placed.get(definition.id) ?? 0 }))
    .filter((c) => c.planned > 0);
}

function unplannedRule(project: Project): RuleResult {
  const plan = plannedCounts(project);
  if (plan.length === 0) return unknown('unpacked', 'items', 'no-quantities');
  const short = plan.filter((c) => c.placed < c.planned);
  const planned = plan.reduce((s, c) => s + c.planned, 0);
  const placed = plan.reduce((s, c) => s + Math.min(c.placed, c.planned), 0);
  return { code: 'unpacked', unit: 'items', required: planned, measured: placed, status: short.length === 0 ? 'pass' : 'fail', entityIds: short.map((c) => c.definition.id) };
}

/** The numbers a loading plan is judged by. */
export interface ContainerMetrics {
  readonly volume: number;
  readonly usedVolume: number;
  /** usedVolume / volume, 0..1. */
  readonly volumeUse: number;
  /** Floor covered by pieces standing on the floor / floor area, 0..1. */
  readonly floorUse: number;
  readonly mass?: number;
  readonly maxPayload?: number;
  /** mass / maxPayload, when both are known. */
  readonly payloadUse?: number;
  readonly balance?: { readonly along: number; readonly across: number };
  readonly pieces: number;
  readonly steps: number;
  readonly stops: readonly number[];
  /** Planned pieces not placed yet. */
  readonly unpacked: number;
}

export function containerMetrics(project: Project): ContainerMetrics {
  const box = boundsOf(project.space.boundary);
  const volume = (box.maxX - box.minX) * (box.maxY - box.minY) * (project.space.ceilingHeight ?? 0);
  const metrics = measureProject(project);
  const floorPieces = Object.values(project.items).filter((i) => !i.elevation);
  const floorOnly = measureProject({ ...project, items: Object.fromEntries(floorPieces.map((i) => [i.id, i])) });
  const maxPayload = num(project.space.meta?.maxPayload);
  const steps = Object.values(project.items).reduce((m, i) => Math.max(m, stepOf(i) ?? 0), 0);
  const stops = [...new Set(Object.values(project.items).map((i) => stopOf(i, project.catalog[i.definitionId]!)).filter((s): s is number => s !== undefined))].sort((a, b) => a - b);
  const balance = balanceOf(project);
  return {
    volume,
    usedVolume: metrics.itemVolume,
    volumeUse: volume > 0 ? metrics.itemVolume / volume : 0,
    floorUse: floorOnly.occupancy,
    ...(metrics.mass === undefined ? {} : { mass: metrics.mass }),
    ...(maxPayload === undefined ? {} : { maxPayload }),
    ...(metrics.mass !== undefined && maxPayload ? { payloadUse: metrics.mass / maxPayload } : {}),
    ...(balance ? { balance } : {}),
    pieces: metrics.itemCount,
    steps,
    stops,
    unpacked: plannedCounts(project).reduce((s, c) => s + Math.max(0, c.planned - c.placed), 0),
  };
}
