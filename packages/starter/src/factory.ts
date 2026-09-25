import {
  area,
  clearanceRectangle,
  containsPolygon,
  createProject,
  createSpace,
  footprintOf,
  fromUnit,
  itemPolygon,
  polygonsOverlap,
  rectangleBoundary,
  rotate,
  segmentsCrossProperly,
  toSquareMetres,
  type Id,
  type ItemDefinition,
  type ItemInstance,
  type Meta,
  type Project,
  type Tick,
  type Vec2,
} from '@space-planner/core';
import { cellAt, cellCentre, distanceToBlocked, floorGrid, paintPolygon, simulateLine, travelField, type LineResult, type MovementProfile, type StationKind, type StationSpec } from '@space-planner/industry';
import type { SimulationPort } from './optimization.js';
import type { RuleResult } from './rules.js';

/**
 * Production line pack: machines, buffers, conveyors, sources and sinks placed on the floor and
 * joined by directed flows. Two questions are kept apart:
 *
 * - Does it fit and work on the floor? Maintenance access, valid flows, a handling route along
 *   every flow, crossings. Checked from geometry alone.
 * - How much does it make? Only from the cycle times people entered, by simulation; the drawing
 *   alone never gives a throughput.
 *
 * Type `meta`: station (kind), cycle (ms), capacity (parts), maintFront / maintBack / maintLeft /
 * maintRight (ticks), inSide / outSide ('front' | 'back' | 'left' | 'right'). Item `meta`:
 * next — the ids of the stations parts go to, separated by spaces.
 */

const cm = (v: number) => fromUnit(v, 'cm');
const m = (v: number) => fromUnit(v, 'm');
const sec = (v: number) => Math.round(v * 1000);

export type Side = 'front' | 'back' | 'left' | 'right';
const SIDES: readonly Side[] = ['front', 'back', 'left', 'right'];
const KINDS: readonly StationKind[] = ['source', 'machine', 'buffer', 'conveyor', 'sink'];

export interface StationData {
  readonly kind: StationKind;
  /** ms: a source's release interval, a machine's cycle, a conveyor's transit time. */
  readonly cycle?: number;
  readonly capacity?: number;
  /** Free space kept for maintenance on each side; undefined when not stated. */
  readonly maintenance?: { readonly front: Tick; readonly back: Tick; readonly left: Tick; readonly right: Tick };
  readonly inSide: Side;
  readonly outSide: Side;
}

const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
const side = (v: unknown, fallback: Side): Side => (SIDES.includes(v as Side) ? (v as Side) : fallback);

/** The station data of an item type, or undefined when it is not a station. */
export function stationOf(definition: ItemDefinition | undefined): StationData | undefined {
  const meta = definition?.meta;
  if (!meta || !KINDS.includes(meta.station as StationKind)) return undefined;
  const kind = meta.station as StationKind;
  const cycle = num(meta.cycle);
  const capacity = num(meta.capacity);
  const sides = [meta.maintFront, meta.maintBack, meta.maintLeft, meta.maintRight].map(num);
  const conveyor = kind === 'conveyor';
  return {
    kind,
    ...(cycle === undefined ? {} : { cycle }),
    ...(capacity === undefined ? {} : { capacity }),
    ...(sides.some((v) => v !== undefined) ? { maintenance: { front: sides[0] ?? 0, back: sides[1] ?? 0, left: sides[2] ?? 0, right: sides[3] ?? 0 } } : {}),
    inSide: side(meta.inSide, conveyor ? 'left' : 'back'),
    outSide: side(meta.outSide, conveyor ? 'right' : 'front'),
  };
}

/** The station ids an item sends parts to, in order. */
export function nextOf(item: ItemInstance): Id[] {
  const next = item.meta?.next;
  return typeof next === 'string' ? next.split(/\s+/).filter(Boolean) : [];
}

/** Item meta with `next` set to these ids (removed when empty). */
export function withNext(item: ItemInstance, ids: readonly Id[]): Meta | null {
  const { next: _old, ...rest } = item.meta ?? {};
  const unique = [...new Set(ids)];
  const meta: Meta = unique.length ? { ...rest, next: unique.join(' ') } : rest;
  return Object.keys(meta).length ? meta : null;
}

export function isFactory(project: Project): boolean {
  return project.space.meta?.pack === 'factory';
}

const none = { front: 0, back: 0, left: 0, right: 0 };
const station = (id: string, name: string, category: string, w: number, d: number, h: number, meta: Meta, operator = 0): ItemDefinition => ({
  id,
  name,
  category,
  size: { w: cm(w), d: cm(d), h: cm(h) },
  clearance: { ...none, front: cm(operator) },
  meta,
});

/** Sample stations a new factory starts with; cycle times are placeholders to replace with measured ones. */
export const FACTORY_CATALOG: readonly ItemDefinition[] = [
  station('goods-in', 'Goods in (every 60 s)', 'box', 200, 120, 15, { station: 'source', cycle: sec(60) }),
  station('cnc', 'CNC machining centre', 'machine', 250, 180, 220, { station: 'machine', cycle: sec(90), maintBack: cm(80), maintLeft: cm(60), maintRight: cm(60) }, 100),
  station('assembly', 'Assembly bench', 'machine', 200, 90, 90, { station: 'machine', cycle: sec(60) }, 90),
  station('inspection', 'Inspection station', 'machine', 150, 90, 100, { station: 'machine', cycle: sec(45), maintBack: cm(50) }, 90),
  station('buffer', 'Buffer rack · 20 parts', 'shelf', 200, 80, 180, { station: 'buffer', capacity: 20 }),
  station('conveyor', 'Roller conveyor 4 m', 'conveyor', 400, 60, 80, { station: 'conveyor', cycle: sec(40), capacity: 8 }),
  station('goods-out', 'Goods out', 'box', 200, 120, 15, { station: 'sink' }),
];

/** How material is moved between stations: the width a flow route needs. */
export interface HandlingProfile extends MovementProfile {}

/** Typical widths for moving material along a flow (common guidance; measure your own equipment). */
export const HANDLING_PROFILES: readonly HandlingProfile[] = [
  { id: 'cart', label: 'Hand cart', width: cm(90) },
  { id: 'pallet-truck', label: 'Pallet truck', width: cm(140) },
  { id: 'forklift', label: 'Forklift', width: cm(220) },
];
export const FACTORY_STYLES = HANDLING_PROFILES.map(({ id, label }) => ({ id, label }));

export function handlingProfile(id: string | null | undefined): HandlingProfile {
  return HANDLING_PROFILES.find((h) => h.id === id) ?? HANDLING_PROFILES[0]!;
}

/** A new factory floor: an empty hall with a door and the sample stations. */
export function newFactory(name: string, size: { width: Tick; depth: Tick; height?: Tick } = { width: m(40), depth: m(20), height: m(6) }): Project {
  const space = createSpace(rectangleBoundary(size.width, size.depth), {
    doors: [{ id: 'door-1', hinge: { x: m(1), y: 0 }, width: cm(300), angle: 0, swing: 'left' }],
    ...(size.height === undefined ? {} : { ceilingHeight: size.height }),
    meta: { pack: 'factory' },
  });
  return { ...createProject('new', name, space), catalog: Object.fromEntries(FACTORY_CATALOG.map((d) => [d.id, d])) };
}

/** A placed station with its data. */
export interface Station {
  readonly item: ItemInstance;
  readonly definition: ItemDefinition;
  readonly data: StationData;
}

export function stationsOf(project: Project): Station[] {
  const out: Station[] = [];
  for (const id of Object.keys(project.items).sort()) {
    const item = project.items[id]!;
    const definition = project.catalog[item.definitionId];
    const data = stationOf(definition);
    if (definition && data) out.push({ item, definition, data });
  }
  return out;
}

/** How far outside a station its input and output points sit, so they stand on free floor. */
export const PORT_OFFSET = cm(40);

/** Where parts leave (`out`) or enter (`in`) a station: the middle of that side, a little outside. */
export function portOf(s: Station, which: 'in' | 'out'): Vec2 {
  const f = footprintOf(s.item, s.definition);
  const hw = f.width / 2 + PORT_OFFSET;
  const hd = f.depth / 2 + PORT_OFFSET;
  const local: Record<Side, Vec2> = { front: { x: 0, y: hd }, back: { x: 0, y: -hd }, left: { x: -hw, y: 0 }, right: { x: hw, y: 0 } };
  const p = rotate(local[which === 'in' ? s.data.inSide : s.data.outSide], s.item.rotation);
  return { x: s.item.position.x + p.x, y: s.item.position.y + p.y };
}

/** One directed flow between two placed stations. */
export interface Flow {
  readonly from: Station;
  readonly to: Station;
  readonly start: Vec2;
  readonly end: Vec2;
}

export function flowsOf(project: Project, stations: readonly Station[] = stationsOf(project)): Flow[] {
  const byId = new Map(stations.map((s) => [s.item.id, s]));
  const flows: Flow[] = [];
  for (const from of stations) {
    for (const id of nextOf(from.item)) {
      const to = byId.get(id);
      if (to && to !== from) flows.push({ from, to, start: portOf(from, 'out'), end: portOf(to, 'in') });
    }
  }
  return flows;
}

/** Pairs of flows whose straight lines cross (flows that share a station do not count). */
export function crossings(flows: readonly Flow[]): Array<[Flow, Flow]> {
  const out: Array<[Flow, Flow]> = [];
  for (let i = 0; i < flows.length; i++) {
    for (let j = i + 1; j < flows.length; j++) {
      const a = flows[i]!;
      const b = flows[j]!;
      const shared = [a.from, a.to].some((s) => s === b.from || s === b.to);
      if (!shared && segmentsCrossProperly(a.start, a.end, b.start, b.end)) out.push([a, b]);
    }
  }
  return out;
}

/** The maintenance zone of a station (its footprint grown by the maintenance sides). */
export function maintenanceZone(s: Station): readonly Vec2[] | undefined {
  const mt = s.data.maintenance;
  return mt ? clearanceRectangle(footprintOf(s.item, s.definition), mt) : undefined;
}

/**
 * Travel along every flow for the handling profile, from the output point to the next input
 * point, around machines, walls and columns. Undefined for a flow that cannot be travelled.
 *
 * A port sits close to its machine, closer than half a cart, so the cart only has to get within
 * reach of it (half its width plus a cell): the route ends at the best reachable cell there, plus
 * the straight step from that cell to the port.
 */
export function flowRoutes(project: Project, flows: readonly Flow[], handling: HandlingProfile): Array<number | undefined> {
  if (flows.length === 0) return [];
  const grid = floorGrid(project.space.boundary, cm(10));
  for (const o of project.space.obstacles) paintPolygon(grid, o.polygon, 1);
  for (const item of Object.values(project.items)) {
    const d = project.catalog[item.definitionId];
    // Floor areas (goods in / out) are driven onto; everything taller blocks.
    if (d && d.size.h > cm(20)) paintPolygon(grid, itemPolygon(item, d), 1);
  }
  const clearance = distanceToBlocked(grid.blocked, grid.nx, grid.ny);
  // One field per distinct start point.
  const fields = new Map<number, Float64Array>();
  return flows.map((f) => {
    const start = cellAt(grid, f.start);
    const end = cellAt(grid, f.end);
    if (start < 0 || end < 0) return undefined;
    let field = fields.get(start);
    if (!field) {
      field = travelField(grid, clearance, [start], handling.width).distance;
      fields.set(start, field);
    }
    const reach = handling.width / 2 + grid.cell;
    const r = Math.ceil(reach / grid.cell);
    const ei = end % grid.nx;
    const ej = (end - ei) / grid.nx;
    let best = Infinity;
    for (let j = Math.max(0, ej - r); j <= Math.min(grid.ny - 1, ej + r); j++) {
      for (let i = Math.max(0, ei - r); i <= Math.min(grid.nx - 1, ei + r); i++) {
        const d = field[j * grid.nx + i]!;
        if (!Number.isFinite(d)) continue;
        const c = cellCentre(grid, j * grid.nx + i);
        const step = Math.hypot(c.x - f.end.x, c.y - f.end.y);
        if (step <= reach) best = Math.min(best, d + step);
      }
    }
    return Number.isFinite(best) ? best : undefined;
  });
}

const unknown = (code: RuleResult['code'], unit: RuleResult['unit'], reason: NonNullable<RuleResult['reason']>): RuleResult => ({ code, unit, status: 'unknown', entityIds: [], reason });

/** Check the line's use of the floor. Operation (throughput) is the simulator's, never a rule's. */
export function checkFactory(project: Project, handlingId: string): RuleResult[] {
  const handling = handlingProfile(handlingId);
  const stations = stationsOf(project);
  if (stations.length === 0) {
    return [unknown('maintenance-access', 'items', 'no-stations'), unknown('flow-links', 'items', 'no-stations'), unknown('flow-path', 'items', 'no-flows'), unknown('flow-crossings', 'items', 'no-flows')];
  }
  const flows = flowsOf(project, stations);
  return [maintenanceRule(project, stations), linksRule(stations), pathRule(project, flows, handling), crossingRule(flows)];
}

function maintenanceRule(project: Project, stations: readonly Station[]): RuleResult {
  const withZones = stations.filter((s) => s.data.maintenance);
  if (withZones.length === 0) return unknown('maintenance-access', 'items', 'no-maintenance-data');
  const blocked: Id[] = [];
  for (const s of withZones) {
    const zone = maintenanceZone(s)!;
    const clash =
      !containsPolygon(project.space.boundary, zone) ||
      project.space.obstacles.some((o) => polygonsOverlap(zone, o.polygon)) ||
      Object.values(project.items).some((i) => {
        if (i.id === s.item.id) return false;
        const d = project.catalog[i.definitionId];
        return d !== undefined && polygonsOverlap(zone, itemPolygon(i, d));
      });
    if (clash) blocked.push(s.item.id);
  }
  return { code: 'maintenance-access', unit: 'items', measured: withZones.length - blocked.length, required: withZones.length, status: blocked.length ? 'fail' : 'pass', entityIds: blocked };
}

/**
 * Every link names a station; there is a source and a sink; every station lies on a path from a
 * source to a sink (so nothing is stranded or a dead end).
 */
function linksRule(stations: readonly Station[]): RuleResult {
  const byId = new Map(stations.map((s) => [s.item.id, s]));
  const bad = new Set<Id>();
  for (const s of stations) {
    for (const id of nextOf(s.item)) {
      const to = byId.get(id);
      if (!to || to === s || to.data.kind === 'source') bad.add(s.item.id);
    }
    if (s.data.kind === 'sink' && nextOf(s.item).length) bad.add(s.item.id);
  }
  const forward = new Map<Id, Id[]>();
  const backward = new Map<Id, Id[]>();
  for (const s of stations) {
    for (const id of nextOf(s.item)) {
      if (!byId.has(id)) continue;
      forward.set(s.item.id, [...(forward.get(s.item.id) ?? []), id]);
      backward.set(id, [...(backward.get(id) ?? []), s.item.id]);
    }
  }
  const reach = (starts: Id[], edges: Map<Id, Id[]>) => {
    const seen = new Set(starts);
    const queue = [...starts];
    while (queue.length) for (const n of edges.get(queue.shift()!) ?? []) if (!seen.has(n)) (seen.add(n), queue.push(n));
    return seen;
  };
  const fromSource = reach(stations.filter((s) => s.data.kind === 'source').map((s) => s.item.id), forward);
  const toSink = reach(stations.filter((s) => s.data.kind === 'sink').map((s) => s.item.id), backward);
  for (const s of stations) if (!fromSource.has(s.item.id) || !toSink.has(s.item.id)) bad.add(s.item.id);
  const entityIds = [...bad].sort();
  return { code: 'flow-links', unit: 'items', measured: stations.length - entityIds.length, required: stations.length, status: entityIds.length ? 'fail' : 'pass', entityIds };
}

function pathRule(project: Project, flows: readonly Flow[], handling: HandlingProfile): RuleResult {
  if (flows.length === 0) return unknown('flow-path', 'items', 'no-flows');
  const routes = flowRoutes(project, flows, handling);
  const cut = new Set<Id>();
  routes.forEach((d, k) => d === undefined && cut.add(flows[k]!.from.item.id));
  const entityIds = [...cut].sort();
  return { code: 'flow-path', unit: 'items', measured: routes.filter((d) => d !== undefined).length, required: flows.length, status: entityIds.length ? 'fail' : 'pass', entityIds };
}

function crossingRule(flows: readonly Flow[]): RuleResult {
  if (flows.length === 0) return unknown('flow-crossings', 'items', 'no-flows');
  const pairs = crossings(flows);
  const ids = [...new Set(pairs.flatMap(([a, b]) => [a.from.item.id, b.from.item.id]))].sort();
  return { code: 'flow-crossings', unit: 'items', measured: pairs.length, required: 0, status: pairs.length ? 'fail' : 'pass', entityIds: ids };
}

export interface FactoryMetrics {
  readonly stations: Readonly<Record<StationKind, number>>;
  readonly flows: number;
  /** Sum of straight flow lengths (ticks). */
  readonly straightLength: number;
  /** Sum of travelled flow lengths for the handling profile (ticks); undefined when a flow cannot be travelled. */
  readonly routedLength: number | undefined;
  readonly crossings: number;
  /** Floor under stations / floor area (0..1). */
  readonly floorShare: number;
}

export function factoryMetrics(project: Project, handlingId: string): FactoryMetrics {
  const stations = stationsOf(project);
  const flows = flowsOf(project, stations);
  const counts: Record<StationKind, number> = { source: 0, machine: 0, buffer: 0, conveyor: 0, sink: 0 };
  let used = 0;
  for (const s of stations) {
    counts[s.data.kind]++;
    used += toSquareMetres(area(itemPolygon(s.item, s.definition)));
  }
  const routes = flowRoutes(project, flows, handlingProfile(handlingId));
  const floor = toSquareMetres(area(project.space.boundary)) - project.space.obstacles.reduce((t, o) => t + toSquareMetres(area(o.polygon)), 0);
  return {
    stations: counts,
    flows: flows.length,
    straightLength: flows.reduce((t, f) => t + Math.hypot(f.end.x - f.start.x, f.end.y - f.start.y), 0),
    routedLength: routes.some((d) => d === undefined) ? undefined : routes.reduce<number>((t, d) => t + d!, 0),
    crossings: crossings(flows).length,
    floorShare: floor > 0 ? used / floor : 0,
  };
}

/** The line as the simulator sees it: one station per placed station item, flows from `next`. */
export function lineOf(project: Project): StationSpec[] {
  return stationsOf(project).map((s) => ({
    id: s.item.id,
    kind: s.data.kind,
    ...(s.data.cycle === undefined ? {} : { cycle: s.data.cycle }),
    ...(s.data.capacity === undefined ? {} : { capacity: s.data.capacity }),
    next: nextOf(s.item),
  }));
}

export interface LineOptions {
  /** Hours to simulate (one shift = 8). */
  readonly hours: number;
}

/**
 * Throughput, work in progress, blocking and starvation from the stations' cycle times. Transfers
 * between stations take no time unless a conveyor is placed between them; the drawing's distances
 * are not turned into times.
 */
export const lineSimulator: SimulationPort<LineOptions, LineResult> = {
  id: 'line-des',
  run: (project, options) => simulateLine(lineOf(project), Math.round(Math.max(0, options.hours) * 3_600_000)),
};
