import { area, boundsOf, createProject, fromUnit, itemPolygon, roomSpace, rotate, toSquareMetres, type Door, type ItemDefinition, type ItemInstance, type Project, type Tick, type Vec2 } from '@space-planner/core';
import { distanceAt, findRoute, floorRaster, reachabilityFrom, type MovementProfile, type RouteResult } from '@space-planner/industry';
import { areaRule, exitRules, walkwayRule, type RuleResult } from './rules.js';

const m = (n: number) => fromUnit(n, 'm');
const cm = (n: number) => fromUnit(n, 'cm');

/** Activity meaning stays here; the core's Zone is just named polygon geometry. */
export const RESTAURANT_ZONE_KINDS = ['dining', 'bar', 'terrace', 'private'] as const;

export type TableFamily = '2-top' | '4-top' | '6-top' | 'round-4' | 'round-6' | 'booth-4' | 'banquette-8' | 'communal-10';

function tableDefinition(id: string, name: string, family: TableFamily, wCm: number, dCm: number, seats: number, round = false): ItemDefinition {
  return {
    id, name, category: round ? 'round-table' : 'table',
    size: { w: cm(wCm), d: cm(dCm), h: cm(75) },
    // A diner's chair, pulled back, needs room on every open side; a table has no single "front" the way a machine does.
    clearance: { front: cm(45), back: cm(45), left: cm(45), right: cm(45) },
    seats, meta: { kind: 'table', family },
    ...(round ? { footprint: 'round' as const } : {}),
  };
}

export const TABLE_CATALOG: readonly ItemDefinition[] = [
  tableDefinition('table-2top', '2-top table', '2-top', 60, 60, 2),
  tableDefinition('table-4top', '4-top table', '4-top', 80, 80, 4),
  tableDefinition('table-6top', '6-top table', '6-top', 180, 80, 6),
  tableDefinition('table-round-4', 'Round table for 4', 'round-4', 90, 90, 4, true),
  tableDefinition('table-round-6', 'Round table for 6', 'round-6', 130, 130, 6, true),
  tableDefinition('table-booth-4', 'Booth for 4', 'booth-4', 120, 90, 4),
  tableDefinition('table-banquette-8', 'Banquette for 8', 'banquette-8', 240, 90, 8),
  tableDefinition('table-communal-10', 'Communal table for 10', 'communal-10', 300, 90, 10),
];

export const RESTAURANT_CATALOG: readonly ItemDefinition[] = TABLE_CATALOG;

export type RestaurantStyle = 'full-service' | 'quick-service' | 'fine-dining';

export interface RestaurantStyleSpec {
  readonly id: RestaurantStyle;
  readonly label: string;
  /** Floor area each cover needs, in square metres. */
  readonly areaPerCover: number;
  readonly walkway: Tick;
}

export const RESTAURANT_STYLES: readonly RestaurantStyleSpec[] = [
  { id: 'full-service', label: 'Full-service dining', areaPerCover: 1.4, walkway: cm(90) },
  { id: 'quick-service', label: 'Quick-service / casual', areaPerCover: 1.0, walkway: cm(90) },
  { id: 'fine-dining', label: 'Fine dining', areaPerCover: 1.8, walkway: cm(100) },
];

export function restaurantStyle(id: string | null | undefined): RestaurantStyleSpec {
  return RESTAURANT_STYLES.find((s) => s.id === id) ?? RESTAURANT_STYLES[0]!;
}

export const isRestaurant = (project: Project): boolean => project.space.meta?.pack === 'restaurant';

export function tableFamilyOf(definition: ItemDefinition | undefined): TableFamily | undefined {
  if (definition?.meta?.kind !== 'table') return undefined;
  const family = definition.meta?.family;
  return TABLE_CATALOG.some((d) => d.meta?.family === family) ? (family as TableFamily) : undefined;
}

/** A worker carrying plates and trays between the kitchen pass and the tables. */
export const DEFAULT_SERVER: MovementProfile = { name: 'Waitstaff · 0.7 m travel width', effectiveWidth: cm(70) };

/** A new restaurant; `reference` places the worked example: a kitchen pass, an entrance, and a dining room of mixed table families. */
export function newRestaurant(name: string, width = 20, depth = 14, height = 3.2, reference = false): Project {
  if (![width, depth, height].every((v) => Number.isFinite(v) && v >= 3 && v <= 500)) throw new RangeError('restaurant floor dimensions must be 3 to 500 m');
  const doorSpecs = m(width) > cm(100) + m(0.4)
    ? [{ id: 'entrance', wall: 'south' as const, offset: m(width / 2 - 0.5), width: cm(100) }, { id: 'pass', wall: 'north' as const, offset: m(width - 2.7), width: cm(120) }]
    : [];
  const space = roomSpace({ width: m(width), depth: m(depth), ceilingHeight: m(height), doors: doorSpecs, columns: [] });
  const doors = space.doors.map((door) => ({ ...door, meta: { role: door.id === 'pass' ? 'pass' : 'entrance' } }));
  const zones = reference ? [{ id: 'dining-room', kind: 'dining', polygon: [{ x: m(1), y: m(1) }, { x: m(width - 1), y: m(1) }, { x: m(width - 1), y: m(depth - 2.5) }, { x: m(1), y: m(depth - 2.5) }] }] : undefined;
  let project: Project = {
    ...createProject('new', name, { ...space, doors, ...(zones ? { zones } : {}), meta: { pack: 'restaurant' } }),
    catalog: Object.fromEntries(RESTAURANT_CATALOG.map((d) => [d.id, d])),
  };
  if (reference) {
    if (width !== 20 || depth !== 14) throw new RangeError('reference restaurant requires a 20 x 14 m floor');
    const layout: Array<[string, number, number]> = [
      ['table-4top', 3, 3], ['table-4top', 7, 3], ['table-4top', 11, 3], ['table-4top', 15, 3],
      ['table-round-6', 3, 7], ['table-round-6', 8, 7],
      ['table-booth-4', 17, 6], ['table-booth-4', 17, 9],
      ['table-banquette-8', 5, 10.5],
    ];
    const items = Object.fromEntries(layout.map(([defId, x, y], i) => {
      const id = `T${String(i + 1).padStart(2, '0')}`;
      const item: ItemInstance = { id, definitionId: defId, position: { x: m(x), y: m(y) }, rotation: 0, locked: false };
      return [id, item];
    }));
    project = { ...project, items };
  }
  return project;
}

export const referenceRestaurant = (name = 'Reference restaurant 20 × 14 m') => newRestaurant(name, 20, 14, 3.2, true);

function passDoors(project: Project): Door[] {
  return project.space.doors.filter((d) => d.meta?.role === 'pass');
}

function doorApproach(door: Door, mover: MovementProfile): Vec2 {
  const along = rotate({ x: door.width / 2, y: 0 }, door.angle);
  const inward = rotate({ x: mover.effectiveWidth / 2 + cm(40), y: 0 }, door.angle + (door.swing === 'left' ? 90_000 : -90_000));
  return { x: door.hinge.x + along.x + inward.x, y: door.hinge.y + along.y + inward.y };
}

/** The four points just clear of each face of a table, where a server could stand to reach it. */
function tableAccessPoints(table: ItemInstance, definition: ItemDefinition, mover: MovementProfile): Vec2[] {
  const box = boundsOf(itemPolygon(table, definition));
  return [
    { x: table.position.x, y: box.minY - mover.effectiveWidth / 2 - cm(10) },
    { x: table.position.x, y: box.maxY + mover.effectiveWidth / 2 + cm(10) },
    { x: box.minX - mover.effectiveWidth / 2 - cm(10), y: table.position.y },
    { x: box.maxX + mover.effectiveWidth / 2 + cm(10), y: table.position.y },
  ];
}

/** Route from the kitchen pass to the nearest accessible face of a table. */
export function serviceRoute(project: Project, doorId: string, tableId: string, mover: MovementProfile = DEFAULT_SERVER): RouteResult {
  const door = project.space.doors.find((d) => d.id === doorId);
  const table = project.items[tableId];
  const definition = table && project.catalog[table.definitionId];
  if (!door || !table || !definition || !tableFamilyOf(definition)) return { reachable: false, distance: null, points: [], reason: 'outside' };
  const start = doorApproach(door, mover);
  const grid = floorRaster(project, cm(20));
  const candidates = tableAccessPoints(table, definition, mover)
    .map((target) => findRoute(grid, start, target, mover))
    .filter((route): route is Extract<RouteResult, { reachable: true }> => route.reachable);
  return candidates.sort((a, b) => a.distance - b.distance)[0] ?? { reachable: false, distance: null, points: [], reason: 'no-path' };
}

export interface RestaurantMetrics {
  readonly covers: number;
  readonly tables: number;
  readonly tablesByFamily: Readonly<Record<TableFamily, number>>;
  readonly floorArea: number;
  readonly floorPerCover: number;
  readonly zoneArea: Readonly<Record<(typeof RESTAURANT_ZONE_KINDS)[number], number>>;
  readonly reachableTables: number;
  readonly totalTables: number;
}

export function restaurantMetrics(project: Project): RestaurantMetrics {
  const tables = Object.values(project.items).filter((i) => tableFamilyOf(project.catalog[i.definitionId]));
  const covers = tables.reduce((sum, t) => sum + (project.catalog[t.definitionId]?.seats ?? 0), 0);
  const tablesByFamily = { '2-top': 0, '4-top': 0, '6-top': 0, 'round-4': 0, 'round-6': 0, 'booth-4': 0, 'banquette-8': 0, 'communal-10': 0 } as Record<TableFamily, number>;
  for (const t of tables) tablesByFamily[tableFamilyOf(project.catalog[t.definitionId])!]++;
  const floorArea = toSquareMetres(area(project.space.boundary));
  const zoneArea = (kind: string) => (project.space.zones ?? []).filter((z) => z.kind === kind).reduce((sum, z) => sum + toSquareMetres(area(z.polygon)), 0);
  const passes = passDoors(project);
  let reachableTables = 0;
  if (passes.length && tables.length) {
    const grid = floorRaster(project, cm(20));
    const reachable = new Set<string>();
    for (const door of passes) {
      const distances = reachabilityFrom(grid, doorApproach(door, DEFAULT_SERVER), DEFAULT_SERVER);
      if (!distances) continue;
      for (const t of tables) {
        if (reachable.has(t.id)) continue;
        if (tableAccessPoints(t, project.catalog[t.definitionId]!, DEFAULT_SERVER).some((p) => distanceAt(grid, distances, p) !== undefined)) reachable.add(t.id);
      }
    }
    reachableTables = reachable.size;
  }
  return {
    covers, tables: tables.length, tablesByFamily, floorArea,
    floorPerCover: covers ? Math.round((floorArea / covers) * 100) / 100 : 0,
    zoneArea: { dining: zoneArea('dining'), bar: zoneArea('bar'), terrace: zoneArea('terrace'), private: zoneArea('private') },
    reachableTables, totalTables: tables.length,
  };
}

export function checkRestaurant(project: Project, styleId: RestaurantStyle = 'full-service'): RuleResult[] {
  const style = restaurantStyle(styleId);
  const tables = Object.values(project.items).filter((i) => tableFamilyOf(project.catalog[i.definitionId]));
  const base = [walkwayRule(project, style.walkway), areaRule('area-per-cover', project, style.areaPerCover), ...exitRules(project)];
  if (!tables.length) return [...base, { code: 'table-reachability', unit: 'items', status: 'unknown', reason: 'no-tables', entityIds: [] }];
  const passes = passDoors(project);
  if (!passes.length) return [...base, { code: 'table-reachability', unit: 'items', status: 'unknown', reason: 'no-pass', entityIds: [] }];
  const grid = floorRaster(project, cm(20));
  // One flood fill per pass door answers every table's reachability, instead of one search per pass/table/face triple.
  const reachablePerDoor = passes.map((door) => {
    const distances = reachabilityFrom(grid, doorApproach(door, DEFAULT_SERVER), DEFAULT_SERVER);
    return tables.map((t) => distances !== undefined && tableAccessPoints(t, project.catalog[t.definitionId]!, DEFAULT_SERVER).some((p) => distanceAt(grid, distances, p) !== undefined));
  });
  const blocked = tables.filter((_t, i) => reachablePerDoor.every((routes) => !routes[i]));
  return [...base, { code: 'table-reachability', unit: 'items', status: blocked.length ? 'fail' : 'pass', measured: tables.length - blocked.length, required: tables.length, entityIds: blocked.map((t) => t.id) }];
}
