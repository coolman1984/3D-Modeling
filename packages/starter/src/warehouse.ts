import { area, boundsOf, containsPolygon, convexOverlap, createProject, edges, fromUnit, isConvex, itemPolygon, locatePoint, roomSpace, rotate, segmentsCrossProperly, toSquareMetres, type ItemDefinition, type ItemInstance, type Polygon, type Project, type Vec2, type Zone } from '@space-planner/core';
import { distanceAt, findRoute, floorRaster, reachabilityFrom, type FloorRaster, type MovementProfile, type RouteResult } from '@space-planner/industry';
import type { RuleResult } from './rules.js';
export type { RouteResult, MovementProfile } from '@space-planner/industry';

const m = (n: number) => fromUnit(n, 'm');
const cm = (n: number) => fromUnit(n, 'cm');
const none = { front: 0, back: 0, left: 0, right: 0 };
const region = (id: string, kind: string, x0: number, y0: number, x1: number, y1: number): Zone => ({ id, kind, polygon: [{ x: m(x0), y: m(y0) }, { x: m(x1), y: m(y0) }, { x: m(x1), y: m(y1) }, { x: m(x0), y: m(y1) }] });

/** Activity meaning stays here; the core's Zone is just named polygon geometry. */
export const WAREHOUSE_ZONE_KINDS = ['receiving', 'shipping', 'staging', 'picking', 'storage', 'pedestrian', 'forklift', 'no-go', 'charging', 'buffer', 'main-aisle', 'rack-aisle', 'cross-aisle'] as const;

export interface RackSpec {
  readonly bays: number;
  readonly bayWidth: number;
  readonly depth: number;
  readonly height: number;
  readonly levels: number;
  readonly positionsPerLevel: number;
  readonly uprightWidth: number;
  readonly maxPositions?: number;
  readonly loadCapacity?: number;
}

/** Rack dimensions and counts are stored once per type, with no saved structural pieces. */
export function rackDefinition(id: string, spec: RackSpec): ItemDefinition {
  for (const [key, n] of Object.entries(spec)) if (!Number.isSafeInteger(n) || n <= 0) throw new RangeError(`${key} must be a positive integer`);
  if (spec.bays > 100 || spec.levels > 30 || spec.positionsPerLevel > 20) throw new RangeError('rack exceeds supported planning size');
  return {
    id, name: `Rack row · ${spec.bays} bays`, category: 'rack',
    size: { w: spec.bays * spec.bayWidth + (spec.bays + 1) * spec.uprightWidth, d: spec.depth, h: spec.height },
    clearance: none,
    meta: { ...spec },
  };
}

export function rackSpecOf(def: ItemDefinition | undefined): RackSpec | undefined {
  if (def?.category !== 'rack') return undefined;
  const data = def.meta;
  const keys = ['bays', 'bayWidth', 'depth', 'height', 'levels', 'positionsPerLevel', 'uprightWidth'] as const;
  if (!data || keys.some((key) => !Number.isSafeInteger(data[key]) || Number(data[key]) <= 0)) return undefined;
  if (def.size.w !== Number(data.bays) * Number(data.bayWidth) + (Number(data.bays) + 1) * Number(data.uprightWidth) || def.size.d !== data.depth || def.size.h !== data.height) return undefined;
  return data as unknown as RackSpec;
}

const standard = rackDefinition('warehouse-rack-6', { bays: 6, bayWidth: cm(270), depth: cm(110), height: cm(650), levels: 4, positionsPerLevel: 2, uprightWidth: cm(10) });
export const WAREHOUSE_CATALOG: readonly ItemDefinition[] = [
  standard,
  { id: 'warehouse-euro-pallet', name: 'Euro pallet · 120 × 80 cm', category: 'box', size: { w: cm(120), d: cm(80), h: cm(15) }, clearance: none },
  { id: 'warehouse-industrial-pallet', name: 'Industrial pallet · 120 × 100 cm', category: 'box', size: { w: cm(120), d: cm(100), h: cm(15) }, clearance: none },
];
export const WAREHOUSE_STYLES = [{ id: 'pallet-storage', label: 'Pallet storage' }] as const;
export const DEFAULT_FORKLIFT: MovementProfile = { name: 'Planning forklift · 2.2 m travel width', effectiveWidth: cm(220) };

/** Warehouse project with a real 30 × 20 m reference layout when `reference` is true. */
export function newWarehouse(name: string, width = 30, depth = 20, height = 8, reference = false): Project {
  if (![width, depth, height].every((v) => Number.isFinite(v) && v >= 3 && v <= 500)) throw new RangeError('warehouse dimensions must be 3 to 500 m');
  const doors = width >= 12 ? [
    { id: 'receiving', wall: 'south' as const, offset: m(2), width: m(3) },
    { id: 'shipping', wall: 'south' as const, offset: m(width - 5), width: m(3) },
  ] : [{ id: 'receiving', wall: 'south' as const, offset: cm(50), width: cm(150) }];
  const space = roomSpace({ width: m(width), depth: m(depth), ceilingHeight: m(height), doors,
    columns: reference ? [{ id: 'column-1', center: { x: m(2.5), y: m(10) }, width: cm(40), depth: cm(40) }] : [],
  });
  const dockDoors = space.doors.map((door) => ({ ...door, meta: { role: door.id === 'shipping' ? 'shipping' : 'receiving', approachZone: `${door.id}-zone` } }));
  const zones = reference ? [
    region('receiving-zone', 'receiving', 1, 0.5, 5, 3),
    region('shipping-zone', 'shipping', 25, 0.5, 29, 3),
    region('staging-zone', 'staging', 6.5, 0.5, 23.5, 2.3),
    region('picking-zone', 'picking', 25, 4, 29, 14),
    region('storage-zone', 'storage', 6, 3, 24, 19),
    region('main-aisle', 'main-aisle', 3.5, 3, 6, 19),
    region('cross-aisle', 'cross-aisle', 6, 5.4, 24, 6.6),
    region('pedestrian-zone', 'pedestrian', 0.5, 3, 1.7, 18),
    region('column-restriction', 'no-go', 2, 9.5, 3, 10.5),
  ] : undefined;
  let project: Project = { ...createProject('new', name, { ...space, doors: dockDoors, ...(zones ? { zones } : {}), meta: { pack: 'warehouse' } }), catalog: Object.fromEntries(WAREHOUSE_CATALOG.map((d) => [d.id, d])) };
  if (reference) {
    if (width !== 30 || depth !== 20 || height !== 8) throw new RangeError('reference layout requires 30 × 20 × 8 m');
    const items = Object.fromEntries([4, 7.5, 11, 14.5, 18].map((y, i) => {
      const id = `R${String(i + 1).padStart(2, '0')}`;
      const item: ItemInstance = { id, definitionId: standard.id, position: { x: m(15), y: m(y) }, rotation: 0, locked: false };
      return [id, item];
    }));
    project = { ...project, items };
  }
  return project;
}

export const referenceWarehouse = (name = 'Reference warehouse 30 × 20 m') => newWarehouse(name, 30, 20, 8, true);
export const isWarehouse = (project: Project) => project.space.meta?.pack === 'warehouse';

function overlaps(a: Polygon, b: Polygon): boolean {
  if (isConvex(a) && isConvex(b)) return convexOverlap(a, b).overlaps;
  return a.some((p) => locatePoint(b, p, 0) === 'inside') || b.some((p) => locatePoint(a, p, 0) === 'inside') || edges(a).some(([p, q]) => edges(b).some(([r, s]) => segmentsCrossProperly(p, q, r, s)));
}

export interface StorageLocation { readonly id: string; readonly rackId: string; readonly bay: number; readonly level: number; readonly position: number; readonly blocked: boolean }

/** Position addresses are derived from each rack row; no thousands of entities in the save. */
export function storageLocations(project: Project): StorageLocation[] {
  const result: StorageLocation[] = [];
  for (const rack of Object.values(project.items).sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0)) {
    const spec = rackSpecOf(project.catalog[rack.definitionId]);
    if (!spec) continue;
    const code = rack.id;
    const blocked = new Set(typeof rack.meta?.blockedPositions === 'string' ? rack.meta.blockedPositions.split(',').map((s) => s.trim()) : []);
    const cap = Math.min(spec.bays * spec.levels * spec.positionsPerLevel, spec.maxPositions ?? Infinity);
    let count = 0;
    for (let b = 1; b <= spec.bays; b++) for (let l = 1; l <= spec.levels; l++) for (let p = 1; p <= spec.positionsPerLevel; p++) {
      if (count >= cap) break;
      const suffix = `B${String(b).padStart(2, '0')}-L${String(l).padStart(2, '0')}-P${String(p).padStart(2, '0')}`;
      result.push({ id: `${code}-${suffix}`, rackId: rack.id, bay: b, level: l, position: p, blocked: blocked.has(suffix) });
      count++;
    }
  }
  return result;
}

export function warehouseMetrics(project: Project) {
  const rackRows = Object.values(project.items).filter((i) => project.catalog[i.definitionId]?.category === 'rack');
  const specs = rackRows.map((r) => rackSpecOf(project.catalog[r.definitionId]));
  const capacity = specs.reduce((sum, s) => sum + (s ? Math.min(s.bays * s.levels * s.positionsPerLevel, s.maxPositions ?? Infinity) : 0), 0);
  const blocked = storageLocations(project).filter((location) => location.blocked).length;
  const floorArea = toSquareMetres(area(project.space.boundary));
  const rackArea = rackRows.reduce((sum, r) => { const s = rackSpecOf(project.catalog[r.definitionId]); return sum + (s ? toSquareMetres((s.bays * s.bayWidth + (s.bays + 1) * s.uprightWidth) * s.depth) : 0); }, 0);
  const zoneArea = (kind: string) => (project.space.zones ?? []).filter((z) => z.kind === kind).reduce((sum, z) => sum + toSquareMetres(area(z.polygon)), 0);
  return { rackRows: rackRows.length, bays: specs.reduce((n, s) => n + (s?.bays ?? 0), 0), levels: specs.reduce((n, s) => n + (s?.levels ?? 0), 0), positions: capacity, usablePositions: Math.max(0, capacity - blocked), floorArea, rackArea, floorUtilization: floorArea ? rackArea / floorArea : 0, stagingArea: zoneArea('staging'), aisleArea: zoneArea('main-aisle') + zoneArea('rack-aisle') + zoneArea('cross-aisle'), zoneCount: project.space.zones?.length ?? 0, docks: project.space.doors.length };
}

function dockApproach(dock: Project['space']['doors'][number], mover: MovementProfile) {
  const along = rotate({ x: dock.width / 2, y: 0 }, dock.angle);
  const inward = rotate({ x: mover.effectiveWidth / 2 + cm(40), y: 0 }, dock.angle + (dock.swing === 'left' ? 90_000 : -90_000));
  return { x: dock.hinge.x + along.x + inward.x, y: dock.hinge.y + along.y + inward.y };
}

/** The four points just clear of each face of a rack row, where a mover could stand to load or unload it. */
function rackAccessPoints(rack: ItemInstance, definition: ItemDefinition, mover: MovementProfile): Vec2[] {
  const box = boundsOf(itemPolygon(rack, definition));
  return [
    { x: rack.position.x, y: box.minY - mover.effectiveWidth / 2 - cm(10) },
    { x: rack.position.x, y: box.maxY + mover.effectiveWidth / 2 + cm(10) },
    { x: box.minX - mover.effectiveWidth / 2 - cm(10), y: rack.position.y },
    { x: box.maxX + mover.effectiveWidth / 2 + cm(10), y: rack.position.y },
  ];
}

/** Route from a dock opening to the centre of an accessible rack face. */
export function warehouseRoute(project: Project, dockId: string, rackId: string, mover: MovementProfile = DEFAULT_FORKLIFT, raster?: FloorRaster): RouteResult {
  const dock = project.space.doors.find((d) => d.id === dockId);
  const rack = project.items[rackId];
  const definition = rack && project.catalog[rack.definitionId];
  if (!dock || !rack || !definition || !rackSpecOf(definition)) return { reachable: false, distance: null, points: [], reason: 'outside' };
  const start = dockApproach(dock, mover);
  const restricted = (project.space.zones ?? []).filter((z) => z.kind === 'no-go' || z.kind === 'pedestrian').map((z) => z.polygon);
  const grid = raster ?? floorRaster(project, cm(20), restricted);
  const candidates = rackAccessPoints(rack, definition, mover)
    .map((target) => findRoute(grid, start, target, mover))
    .filter((route): route is Extract<RouteResult, { reachable: true }> => route.reachable);
  return candidates.sort((a, b) => a.distance - b.distance)[0] ?? { reachable: false, distance: null, points: [], reason: 'no-path' };
}

export function checkWarehouse(project: Project): RuleResult[] {
  const rows = Object.values(project.items).filter((i) => project.catalog[i.definitionId]?.category === 'rack');
  const invalid = rows.filter((i) => !rackSpecOf(project.catalog[i.definitionId]));
  const metrics = warehouseMetrics(project);
  const capacity: RuleResult = invalid.length ? { code: 'rack-capacity', unit: 'items', status: 'unknown', reason: 'rack-data', entityIds: invalid.map((i) => i.id) }
    : rows.length ? { code: 'rack-capacity', unit: 'items', status: 'pass', measured: metrics.positions, entityIds: [] }
    : { code: 'rack-capacity', unit: 'items', status: 'unknown', reason: 'no-racks', entityIds: [] };
  const aisles: Array<{ width: number; ids: string[] }> = [];
  for (let i = 0; i < rows.length; i++) for (let j = i + 1; j < rows.length; j++) {
    const a = boundsOf(itemPolygon(rows[i]!, project.catalog[rows[i]!.definitionId]!));
    const b = boundsOf(itemPolygon(rows[j]!, project.catalog[rows[j]!.definitionId]!));
    if (a.maxX <= b.minX || b.maxX <= a.minX) continue;
    const gap = Math.max(0, a.minY - b.maxY, b.minY - a.maxY);
    // Only neighbouring rows form an aisle; a far row with another rack between is not its width.
    if (gap <= cm(500)) aisles.push({ width: gap, ids: [rows[i]!.id, rows[j]!.id] });
  }
  const smallest = aisles.reduce((best, next) => next.width < best.width ? next : best, { width: Infinity, ids: [] as string[] });
  const aisle: RuleResult = aisles.length ? { code: 'aisle-width', unit: 'ticks', status: smallest.width >= DEFAULT_FORKLIFT.effectiveWidth ? 'pass' : 'fail', required: DEFAULT_FORKLIFT.effectiveWidth, measured: smallest.width, entityIds: smallest.width >= DEFAULT_FORKLIFT.effectiveWidth ? [] : smallest.ids } : { code: 'aisle-width', unit: 'ticks', status: 'unknown', reason: 'no-racks', entityIds: [] };
  const out = rows.filter((r) => !containsPolygon(project.space.boundary, itemPolygon(r, project.catalog[r.definitionId]!)));
  const protectedZones = (project.space.zones ?? []).filter((z) => z.kind === 'no-go' || z.kind === 'pedestrian');
  const restricted = rows.filter((r) => protectedZones.some((z) => overlaps(itemPolygon(r, project.catalog[r.definitionId]!), z.polygon)));
  const boundaryRule: RuleResult = rows.length ? { code: 'rack-boundary', unit: 'items', status: out.length ? 'fail' : 'pass', measured: rows.length - out.length, required: rows.length, entityIds: out.map((r) => r.id) } : { code: 'rack-boundary', unit: 'items', status: 'unknown', reason: 'no-racks', entityIds: [] };
  const restrictedRule: RuleResult = !rows.length ? { code: 'restricted-zone', unit: 'items', status: 'unknown', reason: 'no-racks', entityIds: [] }
    : !project.space.zones?.length ? { code: 'restricted-zone', unit: 'items', status: 'unknown', reason: 'no-zones', entityIds: [] }
    : { code: 'restricted-zone', unit: 'items', status: restricted.length ? 'fail' : 'pass', measured: restricted.length, required: 0, entityIds: restricted.map((r) => r.id) };
  const unknownDocks = project.space.doors.filter((d) => !d.meta?.approachZone || !(project.space.zones ?? []).some((z) => z.id === d.meta?.approachZone));
  const wrongDocks = project.space.doors.filter((d) => { const zone = project.space.zones?.find((z) => z.id === d.meta?.approachZone); return zone && locatePoint(zone.polygon, dockApproach(d, DEFAULT_FORKLIFT)) === 'outside'; });
  const dockApproachRule: RuleResult = !project.space.doors.length ? { code: 'dock-approach', unit: 'doors', status: 'unknown', reason: 'no-doors', entityIds: [] }
    : wrongDocks.length ? { code: 'dock-approach', unit: 'doors', status: 'fail', entityIds: wrongDocks.map((d) => d.id), measured: project.space.doors.length - wrongDocks.length, required: project.space.doors.length }
    : unknownDocks.length ? { code: 'dock-approach', unit: 'doors', status: 'unknown', reason: 'no-zones', entityIds: unknownDocks.map((d) => d.id) }
    : { code: 'dock-approach', unit: 'doors', status: 'pass', measured: project.space.doors.length, required: project.space.doors.length, entityIds: [] };
  if (!rows.length || !project.space.doors.length) return [capacity, aisle, boundaryRule, restrictedRule, dockApproachRule, { code: 'rack-access', unit: 'items', status: 'unknown', reason: rows.length ? 'no-doors' : 'no-racks', entityIds: [] }, { code: 'dock-access', unit: 'doors', status: 'unknown', reason: project.space.doors.length ? 'no-racks' : 'no-doors', entityIds: [] }];
  const grid = floorRaster(project, cm(20), protectedZones.map((z) => z.polygon));
  // One flood fill per dock answers every rack's reachability, instead of one search per dock/rack/face triple.
  const reachable = new Map(project.space.doors.map((d) => {
    const distances = reachabilityFrom(grid, dockApproach(d, DEFAULT_FORKLIFT), DEFAULT_FORKLIFT);
    const perRack = rows.map((r) => distances !== undefined && rackAccessPoints(r, project.catalog[r.definitionId]!, DEFAULT_FORKLIFT).some((p) => distanceAt(grid, distances, p) !== undefined));
    return [d.id, perRack];
  }));
  const inaccessible = rows.filter((_r, i) => [...reachable.values()].every((routes) => !routes[i]));
  const blockedDocks = project.space.doors.filter((d) => !reachable.get(d.id)!.some(Boolean));
  return [capacity, aisle, boundaryRule, restrictedRule, dockApproachRule,
    { code: 'rack-access', unit: 'items', measured: rows.length - inaccessible.length, required: rows.length, status: inaccessible.length ? 'fail' : 'pass', entityIds: inaccessible.map((r) => r.id) },
    { code: 'dock-access', unit: 'doors', measured: project.space.doors.length - blockedDocks.length, required: project.space.doors.length, status: blockedDocks.length ? 'fail' : 'pass', entityIds: blockedDocks.map((d) => d.id) },
  ];
}
