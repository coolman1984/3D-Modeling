import {
  area,
  boundsOf,
  createProject,
  createSpace,
  fromUnit,
  gridIndex,
  itemPolygon,
  locatePoint,
  rectangleBoundary,
  rotate,
  toSquareMetres,
  type Command,
  type Id,
  type ItemDefinition,
  type ItemInstance,
  type Project,
  type Tick,
  type Vec2,
  type Zone,
} from '@space-planner/core';
import { cellAt, cellCentre, distanceToBlocked, floorGrid, paintPolygon, passHalfWidth, reachable, routeTo, travelField, type FloorGrid, type MovementProfile } from '@space-planner/industry';
import type { RuleResult } from './rules.js';

/**
 * Warehouse pack: pallet racks, lift trucks, docks and the rules that decide whether a rack
 * layout works. The core already checks overlaps, walls and the ceiling; this pack adds aisle
 * widths, lift heights, sprinkler clearance and whether a truck can drive from a dock to every
 * rack face.
 *
 * One rack bay is one item (a row is repeated bays), so rows can be shortened, split or moved
 * with the ordinary commands. A bay's front, where pallets go in, is its local +y side.
 */

const cm = (v: number) => fromUnit(v, 'cm');
const m = (v: number) => fromUnit(v, 'm');
const kg = (v: number) => Math.round(v * 1000);

/** What a rack bay holds, read from its type's `meta`. */
export interface RackSpec {
  /** Load levels, the floor level included. */
  readonly levels: number;
  /** Pallet positions on each level of one bay. */
  readonly positions: number;
  /** Height of one level: pallet, load and beam. Level k (0 = floor) starts at k × levelHeight. */
  readonly levelHeight: Tick;
  /** Grams one pallet position may carry; missing means not stated. */
  readonly positionLoad?: number;
}

/**
 * A lift truck. `aisle` is the working aisle it needs to turn and put a pallet away (face to
 * face); `width` is the lane it needs to drive; `maxLift` the highest beam it reaches.
 */
export interface TruckProfile extends MovementProfile {
  readonly aisle: Tick;
  readonly maxLift: Tick;
}

/**
 * Typical figures from manufacturers' brochures for a 1.2 m euro pallet: common guidance only.
 * The truck actually bought decides; its rated working aisle belongs in the plan.
 */
export const TRUCK_PROFILES: readonly TruckProfile[] = [
  { id: 'counterbalance', label: 'Counterbalance forklift', width: cm(130), aisle: cm(350), maxLift: cm(600) },
  { id: 'reach', label: 'Reach truck', width: cm(130), aisle: cm(290), maxLift: cm(1050) },
  { id: 'vna', label: 'Very narrow aisle truck', width: cm(170), aisle: cm(180), maxLift: cm(1400) },
];

/**
 * The truck is project data (`space.meta.truck`), not a per-browser style: people and agents
 * must check against the same truck, and changing it is a revision like any other.
 */
export const WAREHOUSE_STYLES = [{ id: 'standard', label: 'Project truck' }] as const;

/** The default truck of a new warehouse. */
export const DEFAULT_TRUCK = 'reach';

export function truckProfile(id: string | null | undefined): TruckProfile {
  return TRUCK_PROFILES.find((t) => t.id === id) ?? TRUCK_PROFILES.find((t) => t.id === DEFAULT_TRUCK)!;
}

/** The project's truck; `override` (a truck id) is for comparing trucks without changing the project. */
export function truckOf(project: Project, override?: string): TruckProfile {
  const stored = project.space.meta?.truck;
  return truckProfile(override ?? (typeof stored === 'string' ? stored : undefined));
}

/** Space kept free between the top of the highest load and the ceiling (sprinkler deflectors). */
export const CEILING_CLEARANCE = cm(45);

/** Zone kinds this pack gives a meaning to. Trucks never drive through a no-go zone. */
export const ZONE_KINDS = ['dock', 'staging', 'picking', 'no-go'] as const;
export type WarehouseZoneKind = (typeof ZONE_KINDS)[number];

const none = { front: 0, back: 0, left: 0, right: 0 };
const rack = (id: string, name: string, w: number, d: number, spec: RackSpec): ItemDefinition => ({
  id,
  name,
  category: 'rack',
  size: { w: cm(w), d: cm(d), h: spec.levels * spec.levelHeight },
  clearance: none,
  meta: { rack: 'pallet', levels: spec.levels, positions: spec.positions, levelHeight: spec.levelHeight, ...(spec.positionLoad === undefined ? {} : { positionLoad: spec.positionLoad }) },
});

/** Sample rack and pallet types a new warehouse starts with. */
export const WAREHOUSE_CATALOG: readonly ItemDefinition[] = [
  rack('rack-bay', 'Pallet rack bay 2.7 m · 5 levels', 280, 110, { levels: 5, positions: 3, levelHeight: cm(150), positionLoad: kg(1000) }),
  rack('rack-bay-high', 'Pallet rack bay 2.7 m · 7 levels', 280, 110, { levels: 7, positions: 3, levelHeight: cm(150), positionLoad: kg(1000) }),
  rack('rack-bay-wide', 'Pallet rack bay 3.6 m · 4 levels', 370, 110, { levels: 4, positions: 4, levelHeight: cm(160), positionLoad: kg(800) }),
  { id: 'floor-pallet', name: 'Floor pallet 120 × 100', category: 'box', size: { w: cm(120), d: cm(100), h: cm(150) }, clearance: none, mass: kg(800), meta: { pallet: true } },
];

const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);

/** The rack data of an item type, or undefined when it is not a rack. */
export function rackOf(definition: ItemDefinition | undefined): RackSpec | undefined {
  const meta = definition?.meta;
  if (!meta || meta.rack !== 'pallet') return undefined;
  const levels = num(meta.levels);
  const positions = num(meta.positions);
  const levelHeight = num(meta.levelHeight);
  if (!levels || !positions || !levelHeight || levels < 1 || positions < 1 || levelHeight <= 0) return undefined;
  const positionLoad = num(meta.positionLoad);
  return { levels, positions, levelHeight, ...(positionLoad === undefined ? {} : { positionLoad }) };
}

/** Height of the highest beam a truck must reach (the floor level needs no lift). */
export function topBeam(spec: RackSpec): Tick {
  return (spec.levels - 1) * spec.levelHeight;
}

/** True for projects made as warehouses. */
export function isWarehouse(project: Project): boolean {
  return project.space.meta?.pack === 'warehouse';
}

/** A rectangle zone, counter-clockwise. */
export function rectZone(id: Id, kind: string, name: string, x: Tick, y: Tick, w: Tick, d: Tick): Zone {
  return {
    id,
    kind,
    name,
    polygon: [
      { x, y },
      { x: x + w, y },
      { x: x + w, y: y + d },
      { x, y: y + d },
    ],
  };
}

/**
 * A new warehouse: an empty hall of the given size with a staff door, two docks on the south
 * wall and a staging area behind them, and the sample rack types.
 */
export function newWarehouse(name: string, size: { width: Tick; depth: Tick; height?: Tick } = { width: m(48), depth: m(30), height: m(10) }): Project {
  const { width, depth } = size;
  const dockW = Math.min(m(4), Math.floor(width / 4));
  const dockD = Math.min(m(4), Math.floor(depth / 5));
  const zones: Zone[] = [
    rectZone('dock-1', 'dock', 'Dock 1', m(2), 0, dockW, dockD),
    rectZone('dock-2', 'dock', 'Dock 2', m(2) + dockW + m(1), 0, dockW, dockD),
    rectZone('staging-1', 'staging', 'Staging', m(2), dockD, 2 * dockW + m(1), Math.min(m(5), Math.floor(depth / 5))),
  ];
  const space = createSpace(rectangleBoundary(width, depth), {
    doors: [{ id: 'door-1', hinge: { x: 0, y: m(2) }, width: cm(100), angle: 90_000, swing: 'right' }],
    ...(size.height === undefined ? {} : { ceilingHeight: size.height }),
    meta: { pack: 'warehouse', truck: DEFAULT_TRUCK },
    zones,
  });
  const base = createProject('new', name, space);
  return { ...base, catalog: Object.fromEntries(WAREHOUSE_CATALOG.map((d) => [d.id, d])) };
}

export interface RackRowsSpec {
  readonly definitionId: Id;
  /** South-west corner of the first row's first bay. */
  readonly origin: Vec2;
  /** Bays in each row, side by side along X. */
  readonly bays: number;
  readonly rows: number;
  /** Clear aisle between facing rows. */
  readonly aisle: Tick;
  /** Gap between back-to-back rows. */
  readonly flue: Tick;
  /** Which way the first row's pallets go in; the rest alternate in back-to-back pairs. */
  readonly firstFacing: 'north' | 'south';
  /** Ids already in use (catalog, items, space), so the new ones never clash. */
  readonly taken: ReadonlySet<string>;
}

/**
 * Commands that add rows of rack bays running east. Rows alternate so that each aisle has
 * rack faces on both sides and backs meet at a flue: south-facing, north-facing (back to back),
 * aisle, south-facing, north-facing… Returns item.add commands only; the caller batches them.
 */
export function rackRows(definition: ItemDefinition, spec: RackRowsSpec): Command[] {
  const { w, d } = definition.size;
  const commands: Command[] = [];
  let next = 1;
  const newId = () => {
    let id: string;
    do id = `${definition.id}-${next++}`;
    while (spec.taken.has(id));
    return id;
  };
  let y = spec.origin.y;
  for (let r = 0; r < spec.rows; r++) {
    const facesSouth = (r + (spec.firstFacing === 'south' ? 0 : 1)) % 2 === 0;
    for (let b = 0; b < spec.bays; b++) {
      const item: ItemInstance = {
        id: newId(),
        definitionId: definition.id,
        position: { x: spec.origin.x + b * w + Math.round(w / 2), y: y + Math.round(d / 2) },
        rotation: facesSouth ? 180_000 : 0,
        locked: false,
      };
      commands.push({ type: 'item.add', item });
    }
    // Facing south then north: backs meet. Facing north then south: fronts meet across an aisle.
    y += d + (facesSouth ? spec.flue : spec.aisle);
  }
  return commands;
}

/** A rack bay with its data, footprint and the middle of its front face. */
export interface Bay {
  readonly item: ItemInstance;
  readonly definition: ItemDefinition;
  readonly spec: RackSpec;
}

export function baysOf(project: Project): Bay[] {
  const bays: Bay[] = [];
  for (const id of Object.keys(project.items).sort()) {
    const item = project.items[id]!;
    const definition = project.catalog[item.definitionId];
    const spec = rackOf(definition);
    if (definition && spec) bays.push({ item, definition, spec });
  }
  return bays;
}

/**
 * The free distance in front of each bay's face to the nearest wall, column or item, exact to the
 * tick below. Items are looked up within `near` first; when none is that close, out to the wall.
 */
export function aislesInFront(project: Project, bays: readonly Bay[], near: Tick = fromUnit(5, 'm')): Map<Id, Tick> {
  const shapes: (readonly Vec2[])[] = [];
  const owners: (Id | undefined)[] = [];
  for (const item of Object.values(project.items)) {
    const definition = project.catalog[item.definitionId];
    if (!definition) continue;
    shapes.push(itemPolygon(item, definition));
    owners.push(item.id);
  }
  for (const o of project.space.obstacles) {
    shapes.push(o.polygon);
    owners.push(undefined);
  }
  const index = gridIndex(shapes.map((s) => boundsOf(s)));
  const walls = project.space.boundary;
  const result = new Map<Id, Tick>();
  for (const bay of bays) {
    const { item } = bay;
    const w = bay.definition.size.w;
    const half = bay.definition.size.d / 2;
    // In the bay's own frame the face is y = half and the aisle the strip |x| < w/2 in front of it.
    const local = (p: Vec2): Vec2 => rotate({ x: p.x - item.position.x, y: p.y - item.position.y }, -item.rotation);
    const x0 = -w / 2 + 1;
    const x1 = w / 2 - 1;
    let gap = Infinity;
    const edge = (a: Vec2, b: Vec2) => {
      // Clip the edge to the strip's x range, then take its nearest point in front of the face.
      let [p, q] = a.x <= b.x ? [a, b] : [b, a];
      if (q.x < x0 || p.x > x1) return;
      const at = (x: number) => (q.x === p.x ? p.y : p.y + ((x - p.x) * (q.y - p.y)) / (q.x - p.x));
      const ya = p.x < x0 ? at(x0) : p.y;
      const yb = q.x > x1 ? at(x1) : q.y;
      const lo = Math.min(ya, yb);
      const hi = Math.max(ya, yb);
      if (hi < half) return; // behind the face
      gap = Math.min(gap, lo <= half ? 0 : lo - half);
    };
    const room = walls.map(local);
    for (let e = 0; e < room.length; e++) edge(room[e]!, room[(e + 1) % room.length]!);
    const b = boundsOf(itemPolygon(item, bay.definition));
    // Anything nearer than `r` in front of the face has its box within `r` of the bay's box.
    const scan = (r: number, skip: ReadonlySet<number>) => {
      const seen = new Set<number>();
      for (const k of index.query({ minX: b.minX - r, minY: b.minY - r, maxX: b.maxX + r, maxY: b.maxY + r })) {
        seen.add(k);
        if (owners[k] === item.id || skip.has(k)) continue;
        const shape = shapes[k]!.map(local);
        for (let e = 0; e < shape.length; e++) edge(shape[e]!, shape[(e + 1) % shape.length]!);
      }
      return seen;
    };
    // Outside the room no wall stands in front: the core reports it out of bounds; no usable aisle here.
    if (!Number.isFinite(gap)) {
      result.set(item.id, 0);
      continue;
    }
    const first = scan(Math.min(near, gap), new Set());
    if (gap > near) scan(gap, first);
    result.set(item.id, Math.max(0, Math.floor(gap)));
  }
  return result;
}

/**
 * The floor as a truck sees it: walls, columns, every item and no-go zones are blocked. Starts
 * are the free cells of the dock zones, or just inside the doors when there is no dock.
 */
export interface TruckFloor {
  readonly grid: FloorGrid;
  readonly clearance: Float64Array;
  readonly starts: number[];
  /** Where a truck stands to serve each bay: in the aisle, half a truck in front of the face. */
  readonly serviceCell: ReadonlyMap<Id, number>;
}

export function truckFloor(project: Project, bays: readonly Bay[], truck: TruckProfile): TruckFloor {
  const grid = floorGrid(project.space.boundary, cm(10));
  for (const o of project.space.obstacles) paintPolygon(grid, o.polygon, 1);
  for (const item of Object.values(project.items)) {
    const definition = project.catalog[item.definitionId];
    if (definition) paintPolygon(grid, itemPolygon(item, definition), 1);
  }
  const zones = project.space.zones ?? [];
  for (const z of zones) if (z.kind === 'no-go') paintPolygon(grid, z.polygon, 1);
  const clearance = distanceToBlocked(grid.blocked, grid.nx, grid.ny);
  const starts: number[] = [];
  const docks = zones.filter((z) => z.kind === 'dock');
  for (const z of docks) {
    const b = boundsOf(z.polygon);
    for (let y = b.minY + grid.cell / 2; y < b.maxY; y += grid.cell) {
      for (let x = b.minX + grid.cell / 2; x < b.maxX; x += grid.cell) {
        const k = cellAt(grid, { x, y });
        if (k >= 0 && !grid.blocked[k] && locatePoint(z.polygon, cellCentre(grid, k)) === 'inside') starts.push(k);
      }
    }
  }
  if (docks.length === 0) {
    for (const door of project.space.doors) {
      const along = rotate({ x: 1, y: 0 }, door.angle);
      const inward = rotate(along, door.swing === 'left' ? 90_000 : -90_000);
      for (let t = grid.cell / 2; t < door.width; t += grid.cell / 2) {
        starts.push(cellAt(grid, { x: door.hinge.x + along.x * t + inward.x * grid.cell, y: door.hinge.y + along.y * t + inward.y * grid.cell }));
      }
    }
  }
  const serviceCell = new Map<Id, number>();
  for (const bay of bays) {
    const out = rotate({ x: 0, y: bay.definition.size.d / 2 + truck.width / 2 + grid.cell }, bay.item.rotation);
    serviceCell.set(bay.item.id, cellAt(grid, { x: bay.item.position.x + out.x, y: bay.item.position.y + out.y }));
  }
  return { grid, clearance, starts, serviceCell };
}

/** Bays a truck of the profile cannot reach from a dock, sorted by id. */
export function unreachableBays(floor: TruckFloor, bays: readonly Bay[], truck: TruckProfile): Id[] {
  const reached = reachable(floor.grid, floor.clearance, floor.starts, truck.width);
  return bays.filter((b) => {
    const k = floor.serviceCell.get(b.item.id)!;
    return k < 0 || !reached[k] || floor.clearance[k]! < passHalfWidth(truck.width, floor.grid.cell);
  }).map((b) => b.item.id);
}

/** Driving distance (ticks) from the nearest dock to each reachable bay's service point. */
export function travelToBays(floor: TruckFloor, bays: readonly Bay[], truck: TruckProfile): Map<Id, number> {
  const field = travelField(floor.grid, floor.clearance, floor.starts, truck.width);
  const out = new Map<Id, number>();
  for (const b of bays) {
    const k = floor.serviceCell.get(b.item.id)!;
    const d = k >= 0 ? field.distance[k]! : Infinity;
    if (Number.isFinite(d)) out.set(b.item.id, d);
  }
  return out;
}

/** The driving route from the nearest dock to one bay, as corner points; empty if it cannot be reached. */
export function routeToBay(project: Project, bayId: Id, truckId?: string): Vec2[] {
  const truck = truckOf(project, truckId);
  const bays = baysOf(project);
  const floor = truckFloor(project, bays, truck);
  const k = floor.serviceCell.get(bayId);
  if (k === undefined || k < 0) return [];
  return routeTo(floor.grid, travelField(floor.grid, floor.clearance, floor.starts, truck.width), k);
}

const unknown = (code: RuleResult['code'], unit: RuleResult['unit'], reason: NonNullable<RuleResult['reason']>, extra: Partial<RuleResult> = {}): RuleResult => ({
  code,
  unit,
  status: 'unknown',
  entityIds: [],
  reason,
  ...extra,
});

/** Check a warehouse against the chosen truck's needs. Deterministic; results always in the same order. */
export function checkWarehouse(project: Project, truckId?: string): RuleResult[] {
  const truck = truckOf(project, truckId);
  const bays = baysOf(project);
  const docks = (project.space.zones ?? []).filter((z) => z.kind === 'dock').length;
  const docksRule: RuleResult = { code: 'docks', unit: 'items', measured: docks, required: 1, status: docks >= 1 ? 'pass' : 'fail', entityIds: [] };
  if (bays.length === 0) {
    return [
      unknown('aisle-width', 'ticks', 'no-racks', { required: truck.aisle }),
      unknown('lift-height', 'ticks', 'no-racks', { required: truck.maxLift }),
      unknown('ceiling-clearance', 'ticks', 'no-racks', { required: CEILING_CLEARANCE }),
      unknown('rack-access', 'items', 'no-racks'),
      docksRule,
    ];
  }
  return [aisleRule(project, bays, truck), liftRule(bays, truck), ceilingRule(project, bays), accessRule(project, bays, truck), docksRule];
}

function aisleRule(project: Project, bays: readonly Bay[], truck: TruckProfile): RuleResult {
  const gaps = aislesInFront(project, bays);
  let narrowest = Infinity;
  const narrow: Id[] = [];
  for (const b of bays) {
    const g = gaps.get(b.item.id)!;
    narrowest = Math.min(narrowest, g);
    if (g < truck.aisle) narrow.push(b.item.id);
  }
  return { code: 'aisle-width', unit: 'ticks', measured: narrowest, required: truck.aisle, status: narrow.length === 0 ? 'pass' : 'fail', entityIds: narrow };
}

function liftRule(bays: readonly Bay[], truck: TruckProfile): RuleResult {
  let highest = 0;
  const high: Id[] = [];
  for (const b of bays) {
    const top = topBeam(b.spec);
    highest = Math.max(highest, top);
    if (top > truck.maxLift) high.push(b.item.id);
  }
  return { code: 'lift-height', unit: 'ticks', measured: highest, required: truck.maxLift, status: high.length === 0 ? 'pass' : 'fail', entityIds: high };
}

function ceilingRule(project: Project, bays: readonly Bay[]): RuleResult {
  const ceiling = project.space.ceilingHeight;
  if (ceiling === undefined) return unknown('ceiling-clearance', 'ticks', 'no-ceiling', { required: CEILING_CLEARANCE });
  let least = Infinity;
  const tight: Id[] = [];
  for (const b of bays) {
    const free = ceiling - ((b.item.elevation ?? 0) + b.definition.size.h);
    least = Math.min(least, free);
    if (free < CEILING_CLEARANCE) tight.push(b.item.id);
  }
  return { code: 'ceiling-clearance', unit: 'ticks', measured: least, required: CEILING_CLEARANCE, status: tight.length === 0 ? 'pass' : 'fail', entityIds: tight };
}

function accessRule(project: Project, bays: readonly Bay[], truck: TruckProfile): RuleResult {
  const floor = truckFloor(project, bays, truck);
  if (floor.starts.length === 0) return unknown('rack-access', 'items', 'no-docks', { required: bays.length });
  const cut = unreachableBays(floor, bays, truck);
  return { code: 'rack-access', unit: 'items', measured: bays.length - cut.length, required: bays.length, status: cut.length === 0 ? 'pass' : 'fail', entityIds: cut };
}

export interface WarehouseMetrics {
  readonly bays: number;
  /** Pallet positions in racks plus pallets stored on the floor. */
  readonly locations: number;
  readonly rackLocations: number;
  readonly floorPallets: number;
  /** Grams the racks may carry; undefined when a rack type does not state its position load. */
  readonly rackCapacity: number | undefined;
  readonly floorArea: number;
  /** Floor under racks and floor pallets, as a share of the floor (0..1). */
  readonly storageFloorShare: number;
  /** Rack and floor-pallet volume as a share of the floor times the clear height; undefined without a ceiling. */
  readonly cubeShare: number | undefined;
  readonly zoneArea: Readonly<Record<string, number>>;
  readonly docks: number;
  /** Driving distance from a dock to rack faces, in ticks; undefined when no bay is reachable. */
  readonly travelAverage: number | undefined;
  readonly travelMax: number | undefined;
}

export function warehouseMetrics(project: Project, truckId?: string): WarehouseMetrics {
  const truck = truckOf(project, truckId);
  const bays = baysOf(project);
  let rackLocations = 0;
  let rackCapacity: number | undefined = 0;
  let storageArea = 0;
  let storageVolume = 0;
  for (const b of bays) {
    const n = b.spec.levels * b.spec.positions;
    rackLocations += n;
    rackCapacity = rackCapacity === undefined || b.spec.positionLoad === undefined ? undefined : rackCapacity + n * b.spec.positionLoad;
    const { w, d, h } = b.definition.size;
    storageArea += toSquareMetres(w * d);
    storageVolume += toSquareMetres(w * d) * (h / 10_000);
  }
  let floorPallets = 0;
  for (const item of Object.values(project.items)) {
    const def = project.catalog[item.definitionId];
    if (def?.meta?.pallet === true) {
      floorPallets++;
      storageArea += toSquareMetres(def.size.w * def.size.d);
      storageVolume += toSquareMetres(def.size.w * def.size.d) * (def.size.h / 10_000);
    }
  }
  const floorArea = Math.max(0, toSquareMetres(area(project.space.boundary)) - project.space.obstacles.reduce((s, o) => s + toSquareMetres(area(o.polygon)), 0));
  const ceiling = project.space.ceilingHeight;
  const zoneArea: Record<string, number> = {};
  for (const z of project.space.zones ?? []) zoneArea[z.kind] = (zoneArea[z.kind] ?? 0) + toSquareMetres(area(z.polygon));
  let travelAverage: number | undefined;
  let travelMax: number | undefined;
  if (bays.length > 0) {
    const floor = truckFloor(project, bays, truck);
    const travel = [...travelToBays(floor, bays, truck).values()];
    if (travel.length > 0) {
      travelAverage = travel.reduce((s, d) => s + d, 0) / travel.length;
      travelMax = Math.max(...travel);
    }
  }
  return {
    bays: bays.length,
    locations: rackLocations + floorPallets,
    rackLocations,
    floorPallets,
    rackCapacity,
    floorArea,
    storageFloorShare: floorArea > 0 ? storageArea / floorArea : 0,
    cubeShare: ceiling === undefined || floorArea === 0 ? undefined : storageVolume / (floorArea * (ceiling / 10_000)),
    zoneArea,
    docks: (project.space.zones ?? []).filter((z) => z.kind === 'dock').length,
    travelAverage,
    travelMax,
  };
}
