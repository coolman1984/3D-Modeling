import { area, boundsOf, containsPolygon, createProject, fromUnit, itemPolygon, roomSpace, rotate, toSquareMetres, type ItemDefinition, type ItemInstance, type Project, type Vec2 } from '@space-planner/core';
import { findRoute, floorRaster, type MovementProfile, type RouteResult } from '@space-planner/industry';
import { stepOf } from './container.js';
import type { RuleResult } from './rules.js';

const m = (n: number) => fromUnit(n, 'm');
const cm = (n: number) => fromUnit(n, 'cm');
const none = { front: 0, back: 0, left: 0, right: 0 };

/**
 * A station is a plain box item, like a container piece: no new 3D geometry for the MVP.
 * "Operating clearance" and "maintenance clearance" are the item's own existing front/back
 * clearance — the core already checks clearance overlaps for every item, so this needs no new
 * geometry or rule, only a domain meaning for two fields that already exist.
 */
function station(id: string, name: string, w: number, d: number, h: number, kind: StationKind, operatingCm = 0, maintenanceCm = 0, extra: Record<string, number> = {}): ItemDefinition {
  return {
    id, name, category: 'box',
    size: { w: cm(w), d: cm(d), h: cm(h) },
    clearance: { ...none, front: cm(operatingCm), back: cm(maintenanceCm) },
    meta: { kind, ...extra },
  };
}

export type StationKind = 'source' | 'machine' | 'buffer' | 'inspection' | 'sink';

export const PRODUCTION_CATALOG: readonly ItemDefinition[] = [
  station('source', 'Material source', 100, 100, 110, 'source'),
  station('machine-a', 'Machine A', 200, 150, 160, 'machine', 90, 60),
  station('buffer', 'WIP buffer', 150, 100, 90, 'buffer', 0, 0, { capacity: 20 }),
  station('machine-b', 'Machine B', 250, 180, 170, 'machine', 90, 60),
  station('inspection', 'Inspection station', 120, 100, 110, 'inspection', 70, 0),
  station('sink', 'Finished goods', 100, 100, 110, 'sink'),
];

export const PRODUCTION_STYLES = [{ id: 'discrete', label: 'Discrete manufacturing' }] as const;

/** A worker or cart carrying material between stations; later stages may add vehicle profiles. */
export const DEFAULT_MATERIAL_HANDLER: MovementProfile = { name: 'Material handler · 1.0 m travel width', effectiveWidth: cm(100) };

export const isProduction = (project: Project): boolean => project.space.meta?.pack === 'production';

export function stationKindOf(definition: ItemDefinition | undefined): StationKind | undefined {
  const kind = definition?.meta?.kind;
  return kind === 'source' || kind === 'machine' || kind === 'buffer' || kind === 'inspection' || kind === 'sink' ? kind : undefined;
}

/** A new production-line project; `reference` places the worked example from the plan. */
export function newProductionLine(name: string, width = 20, depth = 8, height = 4, reference = false): Project {
  if (![width, depth, height].every((v) => Number.isFinite(v) && v >= 3 && v <= 500)) throw new RangeError('production floor dimensions must be 3 to 500 m');
  const doorWidth = cm(90);
  const space = roomSpace({
    width: m(width), depth: m(depth), ceilingHeight: m(height),
    doors: m(width) > doorWidth + m(0.2) ? [{ id: 'door-1', wall: 'south' as const, offset: Math.round((m(width) - doorWidth) / 2), width: doorWidth }] : [],
    columns: [],
  });
  let project: Project = { ...createProject('new', name, { ...space, meta: { pack: 'production' } }), catalog: Object.fromEntries(PRODUCTION_CATALOG.map((d) => [d.id, d])) };
  if (reference) {
    if (width !== 30 || depth !== 8) throw new RangeError('reference line requires a 30 x 8 m floor');
    // Gaps generous enough for every station's operating + maintenance clearance plus the
    // material handler's own width on both sides (see flowPoints); tight spacing here is exactly
    // what produced 0 reachable segments before the reference line's gaps were widened.
    const line: Array<[string, number]> = [['source', 2], ['machine-a', 7], ['buffer', 12], ['machine-b', 17], ['inspection', 22], ['sink', 27]];
    const items = Object.fromEntries(line.map(([defId, x], i) => {
      const id = `S${String(i + 1).padStart(2, '0')}`;
      const item: ItemInstance = { id, definitionId: defId, position: { x: m(x), y: m(4) }, rotation: 270_000, locked: false, meta: { step: i + 1 } };
      return [id, item];
    }));
    project = { ...project, items };
  }
  return project;
}

export const referenceProductionLine = (name = 'Reference production line 30 × 8 m') => newProductionLine(name, 30, 8, 4, true);

/**
 * The point material enters (behind the station) and leaves (in front of it), from its own
 * rotation. Clear of the station's own body by the mover's half-width plus a fixed gap, the same
 * margin `warehouseRoute`'s rack access points use — short of that, the point sits too close to
 * the station's own footprint for the mover to occupy it at all.
 */
export function flowPoints(item: ItemInstance, definition: ItemDefinition, mover: MovementProfile = DEFAULT_MATERIAL_HANDLER): { input: Vec2; output: Vec2 } {
  const front = rotate({ x: 0, y: 1 }, item.rotation);
  const reach = definition.size.d / 2 + mover.effectiveWidth / 2 + cm(10);
  return {
    input: { x: item.position.x - front.x * (reach + definition.clearance.back), y: item.position.y - front.y * (reach + definition.clearance.back) },
    output: { x: item.position.x + front.x * (reach + definition.clearance.front), y: item.position.y + front.y * (reach + definition.clearance.front) },
  };
}

/** Stations placed in the line, ordered by `item.meta.step` (1 = first); unstepped items are not part of the flow. */
export function flowOrder(project: Project): ItemInstance[] {
  return Object.values(project.items)
    .filter((i) => project.catalog[i.definitionId] && stepOf(i) !== undefined)
    .sort((a, b) => stepOf(a)! - stepOf(b)! || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/** Route from one station's output to the next station's input. */
export function productionRoute(project: Project, fromId: string, toId: string, mover: MovementProfile = DEFAULT_MATERIAL_HANDLER, raster?: ReturnType<typeof floorRaster>): RouteResult {
  const from = project.items[fromId];
  const to = project.items[toId];
  const fromDef = from && project.catalog[from.definitionId];
  const toDef = to && project.catalog[to.definitionId];
  if (!from || !to || !fromDef || !toDef) return { reachable: false, distance: null, points: [], reason: 'outside' };
  const grid = raster ?? floorRaster(project, cm(20));
  const start = flowPoints(from, fromDef, mover).output;
  const finish = flowPoints(to, toDef, mover).input;
  return findRoute(grid, start, finish, mover);
}

/** The whole line's route, concatenated one segment after another, for display; only the reachable prefix. */
export function productionFlowPath(project: Project, mover: MovementProfile = DEFAULT_MATERIAL_HANDLER): readonly Vec2[] {
  const order = flowOrder(project);
  if (order.length < 2) return [];
  const grid = floorRaster(project, cm(20));
  const points: Vec2[] = [];
  for (let i = 0; i + 1 < order.length; i++) {
    const route = productionRoute(project, order[i]!.id, order[i + 1]!.id, mover, grid);
    if (!route.reachable) break;
    points.push(...(points.length ? route.points.slice(1) : route.points));
  }
  return points;
}

export interface ProductionMetrics {
  readonly stations: number;
  readonly machines: number;
  readonly buffers: number;
  readonly bufferCapacity: number;
  readonly flowLength: number;
  readonly reachableSegments: number;
  readonly totalSegments: number;
  readonly floorArea: number;
}

export function productionMetrics(project: Project): ProductionMetrics {
  const order = flowOrder(project);
  const kinds = order.map((i) => stationKindOf(project.catalog[i.definitionId]));
  const buffers = order.filter((i) => stationKindOf(project.catalog[i.definitionId]) === 'buffer');
  const bufferCapacity = buffers.reduce((sum, i) => { const c = project.catalog[i.definitionId]?.meta?.capacity; return sum + (typeof c === 'number' ? c : 0); }, 0);
  const floorArea = toSquareMetres(Math.abs(area(project.space.boundary)));
  let flowLength = 0;
  let reachableSegments = 0;
  const totalSegments = Math.max(0, order.length - 1);
  if (totalSegments > 0) {
    const grid = floorRaster(project, cm(20));
    for (let i = 0; i + 1 < order.length; i++) {
      const route = productionRoute(project, order[i]!.id, order[i + 1]!.id, DEFAULT_MATERIAL_HANDLER, grid);
      if (route.reachable) { flowLength += route.distance; reachableSegments++; }
    }
  }
  return {
    stations: order.length,
    machines: kinds.filter((k) => k === 'machine').length,
    buffers: buffers.length,
    bufferCapacity,
    flowLength,
    reachableSegments,
    totalSegments,
    floorArea,
  };
}

export function checkProduction(project: Project): RuleResult[] {
  const order = flowOrder(project);
  const boundaryOut = order.filter((i) => !containsPolygon(project.space.boundary, itemPolygon(i, project.catalog[i.definitionId]!)));
  const boundaryRule: RuleResult = order.length
    ? { code: 'machine-boundary', unit: 'items', status: boundaryOut.length ? 'fail' : 'pass', measured: order.length - boundaryOut.length, required: order.length, entityIds: boundaryOut.map((i) => i.id) }
    : { code: 'machine-boundary', unit: 'items', status: 'unknown', reason: 'no-stations', entityIds: [] };
  if (order.length < 2) {
    return [boundaryRule, { code: 'flow-reachability', unit: 'items', status: 'unknown', reason: order.length === 0 ? 'no-stations' : 'one-station', entityIds: [] }];
  }
  const grid = floorRaster(project, cm(20));
  const blocked: string[] = [];
  for (let i = 0; i + 1 < order.length; i++) {
    const route = productionRoute(project, order[i]!.id, order[i + 1]!.id, DEFAULT_MATERIAL_HANDLER, grid);
    if (!route.reachable) blocked.push(order[i]!.id, order[i + 1]!.id);
  }
  const segments = order.length - 1;
  const reachRule: RuleResult = { code: 'flow-reachability', unit: 'items', status: blocked.length ? 'fail' : 'pass', measured: segments - blocked.length / 2, required: segments, entityIds: [...new Set(blocked)] };
  return [boundaryRule, reachRule];
}
