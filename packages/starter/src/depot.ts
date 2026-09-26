import { boundsOf, containsPolygon, createProject, fromUnit, itemPolygon, polygonsOverlap, roomSpace, rotate, type ItemDefinition, type ItemInstance, type Polygon, type Project, type Vec2, type Zone } from '@space-planner/core';
import { dubinsPath, sampleDubinsPath, vehicleCorners, type Pose } from '@space-planner/industry';
import type { RuleResult } from './rules.js';

const m = (n: number) => fromUnit(n, 'm');
const cm = (n: number) => fromUnit(n, 'cm');
const none = { front: 0, back: 0, left: 0, right: 0 };

/**
 * Activity meaning stays here; the core's Zone is just named polygon geometry. A bay is a floor
 * marking, not a 3D object — modelling it as a zone (like a warehouse aisle) rather than an item
 * means a parked vehicle sitting inside it is never flagged as an "overlap": an item and a zone
 * are different things, the way a car parked on a painted parking line is not "on top of" the
 * line in any conflicting sense.
 */
export const DEPOT_ZONE_KINDS = ['bay', 'lane-one-way', 'lane-two-way', 'no-go'] as const;

export type BayType = 'perpendicular' | 'angled' | 'parallel' | 'maintenance' | 'wash' | 'charge';
export const BAY_TYPES: readonly BayType[] = ['perpendicular', 'angled', 'parallel', 'maintenance', 'wash', 'charge'];

const BAY_SIZE: Readonly<Record<BayType, { readonly w: number; readonly d: number }>> = {
  perpendicular: { w: cm(250), d: cm(500) },
  angled: { w: cm(250), d: cm(550) },
  parallel: { w: cm(220), d: cm(600) },
  maintenance: { w: cm(350), d: cm(700) },
  wash: { w: cm(350), d: cm(800) },
  charge: { w: cm(250), d: cm(500) },
};

/** A bay's marked rectangle: `direction` (degrees) is the way a nose-in parked vehicle's front points. */
export function bayPolygon(center: Vec2, type: BayType, directionDeg: number): Polygon {
  const { w, d } = BAY_SIZE[type];
  const corners: Vec2[] = [{ x: -w / 2, y: -d / 2 }, { x: w / 2, y: -d / 2 }, { x: w / 2, y: d / 2 }, { x: -w / 2, y: d / 2 }];
  return corners.map((p) => { const r = rotate(p, directionDeg * 1000); return { x: center.x + r.x, y: center.y + r.y }; });
}

export function bayZone(id: string, center: Vec2, type: BayType, directionDeg: number): Zone {
  return { id, kind: 'bay', polygon: bayPolygon(center, type, directionDeg), meta: { bayType: type, direction: directionDeg } };
}

export function bayTypeOf(zone: Zone | undefined): BayType | undefined {
  if (zone?.kind !== 'bay') return undefined;
  const type = zone.meta?.bayType;
  return type === 'perpendicular' || type === 'angled' || type === 'parallel' || type === 'maintenance' || type === 'wash' || type === 'charge' ? type : undefined;
}

function bayCenter(zone: Zone): Vec2 {
  const b = boundsOf(zone.polygon);
  return { x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2 };
}

function bayPose(zone: Zone): Pose {
  const direction = typeof zone.meta?.direction === 'number' ? zone.meta.direction : 0;
  const front = rotate({ x: 0, y: 1 }, direction * 1000);
  const centre = bayCenter(zone);
  return { x: centre.x, y: centre.y, heading: Math.atan2(front.y, front.x) };
}

function vehicleDefinition(id: string, name: string, wCm: number, dCm: number, hCm: number, minTurningRadiusCm: number, rearOverhangCm: number): ItemDefinition {
  return { id, name, category: 'car', size: { w: cm(wCm), d: cm(dCm), h: cm(hCm) }, clearance: none, meta: { kind: 'vehicle', minTurningRadius: cm(minTurningRadiusCm), rearOverhang: cm(rearOverhangCm) } };
}

export const VEHICLE_CATALOG: readonly ItemDefinition[] = [
  vehicleDefinition('depot-sedan', 'Sedan', 180, 450, 150, 320, 90),
  vehicleDefinition('depot-van', 'Delivery van', 200, 520, 220, 420, 110),
  vehicleDefinition('depot-truck', 'Rigid truck', 250, 900, 350, 650, 150),
];

export const DEPOT_CATALOG: readonly ItemDefinition[] = VEHICLE_CATALOG;
export const DEPOT_STYLES = [{ id: 'fleet-depot', label: 'Fleet depot / garage' }] as const;

export interface VehicleProfile {
  readonly name: string;
  readonly length: number;
  readonly width: number;
  readonly rearOverhang: number;
  readonly minTurningRadius: number;
}

export function vehicleProfileOf(definition: ItemDefinition | undefined): VehicleProfile | undefined {
  if (definition?.category !== 'car' || definition.meta?.kind !== 'vehicle') return undefined;
  const radius = definition.meta?.minTurningRadius;
  const overhang = definition.meta?.rearOverhang;
  if (typeof radius !== 'number' || typeof overhang !== 'number' || radius <= 0 || overhang < 0) return undefined;
  return { name: definition.name, length: definition.size.d, width: definition.size.w, rearOverhang: overhang, minTurningRadius: radius };
}

/**
 * The reference vehicle profile the depot's rules check every bay against — a generic sedan.
 * A bay that fits it may still be too tight for a van or truck; `bay_entry_check` (agent tool)
 * checks a specific vehicle type, but the pass/fail rule uses one fixed profile so a plan has one
 * answer, the way `DEFAULT_FORKLIFT` gives the warehouse pack one answer for aisle checks.
 */
export const DEFAULT_VEHICLE: VehicleProfile = vehicleProfileOf(VEHICLE_CATALOG[0]!)!;

export const isVehicleDepot = (project: Project): boolean => project.space.meta?.pack === 'depot';

/** A new vehicle depot; `reference` places the worked example: a two-way lane and a row of bays. */
export function newVehicleDepot(name: string, width = 30, depth = 18, height = 4, reference = false): Project {
  if (![width, depth, height].every((v) => Number.isFinite(v) && v >= 3 && v <= 500)) throw new RangeError('depot floor dimensions must be 3 to 500 m');
  const gateWidth = cm(300);
  const space = roomSpace({
    width: m(width), depth: m(depth), ceilingHeight: m(height),
    doors: m(width) > gateWidth + m(0.2) ? [{ id: 'gate', wall: 'south' as const, offset: cm(200), width: gateWidth }] : [],
    columns: [],
  });
  const zones: Zone[] = reference ? [{ id: 'lane', kind: 'lane-two-way', polygon: [{ x: m(2), y: m(7) }, { x: m(28), y: m(7) }, { x: m(28), y: m(10) }, { x: m(2), y: m(10) }], meta: { direction: 0 } }] : [];
  let project: Project = { ...createProject('new', name, { ...space, ...(zones.length ? { zones } : {}), meta: { pack: 'depot' } }), catalog: Object.fromEntries(DEPOT_CATALOG.map((d) => [d.id, d])) };
  if (reference) {
    if (width !== 30 || depth !== 18) throw new RangeError('reference depot requires a 30 x 18 m floor');
    const bayXs = [4, 7.5, 11, 14.5, 18, 21.5];
    // Rotation/direction 0 faces north: a nose-in parked vehicle's front points away from the lane.
    const bays = bayXs.map((x, i) => bayZone(`BAY${String(i + 1).padStart(2, '0')}`, { x: m(x), y: m(13) }, 'perpendicular', 0));
    project = { ...project, space: { ...project.space, zones: [...zones, ...bays] } };
    project = {
      ...project,
      items: {
        V01: { id: 'V01', definitionId: 'depot-sedan', position: { x: m(4), y: m(13) }, rotation: 0, locked: false },
        V02: { id: 'V02', definitionId: 'depot-van', position: { x: m(14.5), y: m(13) }, rotation: 0, locked: false },
      },
    };
  }
  return project;
}

export const referenceVehicleDepot = (name = 'Reference depot 30 × 18 m') => newVehicleDepot(name, 30, 18, 4, true);

/** Whether a parked vehicle already occupies a bay's own footprint (its position, within a small tolerance). */
function occupantOf(project: Project, bay: Zone): ItemInstance | undefined {
  const centre = bayCenter(bay);
  return Object.values(project.items).find((item) => {
    const def = project.catalog[item.definitionId];
    return vehicleProfileOf(def) && Math.abs(item.position.x - centre.x) < cm(30) && Math.abs(item.position.y - centre.y) < cm(30);
  });
}

/**
 * The point and heading a vehicle starts from to approach `target`, on the nearest lane zone: the
 * point on the lane's centreline closest to the target, facing whichever of the lane's two stored
 * travel directions points generally toward it (so the approach is a forward drive-in, not a
 * reverse), then set back one turning radius along that direction — real drive-in parking is
 * entered by driving past the stall a little before curving in, not by starting the turn already
 * level with it; without that lead-in a tight turning radius forces a wide loop for no geometric
 * reason. `undefined` when the depot has no lane zone to approach from.
 */
function laneApproach(project: Project, target: Vec2, vehicle: VehicleProfile): Pose | undefined {
  const lanes = (project.space.zones ?? []).filter((z) => z.kind === 'lane-one-way' || z.kind === 'lane-two-way');
  if (!lanes.length) return undefined;
  let best: { point: Vec2; distance: number; direction: number } | undefined;
  for (const lane of lanes) {
    const b = boundsOf(lane.polygon);
    const direction = typeof lane.meta?.direction === 'number' ? lane.meta.direction : 0;
    const dirVec = rotate({ x: 1, y: 0 }, direction * 1000);
    const horizontal = Math.abs(dirVec.x) >= Math.abs(dirVec.y);
    const point: Vec2 = horizontal
      ? { x: Math.min(b.maxX, Math.max(b.minX, target.x)), y: (b.minY + b.maxY) / 2 }
      : { x: (b.minX + b.maxX) / 2, y: Math.min(b.maxY, Math.max(b.minY, target.y)) };
    const distance = Math.hypot(point.x - target.x, point.y - target.y);
    if (!best || distance < best.distance) best = { point, distance, direction: direction * 1000 };
  }
  if (!best) return undefined;
  const toward = { x: target.x - best.point.x, y: target.y - best.point.y };
  const forward = rotate({ x: 1, y: 0 }, best.direction);
  const facingForward = forward.x * toward.x + forward.y * toward.y >= 0;
  const heading = facingForward ? Math.atan2(forward.y, forward.x) : Math.atan2(-forward.y, -forward.x);
  const along = facingForward ? forward : { x: -forward.x, y: -forward.y };
  return { x: best.point.x - along.x * vehicle.minTurningRadius, y: best.point.y - along.y * vehicle.minTurningRadius, heading };
}

export interface BayEntryResult {
  readonly bayId: string;
  readonly clear: boolean;
  readonly reason?: 'no-bay' | 'no-lane' | 'occupied' | 'no-path' | 'blocked';
  readonly path: readonly Vec2[];
}

/** Whether `vehicle` can drive from the nearest lane into `bayId` without its swept body leaving the room or touching an obstacle, a column, another vehicle or a no-go zone — sampled every 20 cm along the Dubins path. */
export function bayEntry(project: Project, bayId: string, vehicle: VehicleProfile = DEFAULT_VEHICLE): BayEntryResult {
  const bay = (project.space.zones ?? []).find((z) => z.id === bayId && bayTypeOf(z));
  if (!bay) return { bayId, clear: false, reason: 'no-bay', path: [] };
  if (occupantOf(project, bay)) return { bayId, clear: false, reason: 'occupied', path: [] };
  const centre = bayCenter(bay);
  const start = laneApproach(project, centre, vehicle);
  if (!start) return { bayId, clear: false, reason: 'no-lane', path: [] };
  const goal = bayPose(bay);
  const path = dubinsPath(start, goal, vehicle.minTurningRadius);
  if (!path) return { bayId, clear: false, reason: 'no-path', path: [] };
  const ahead = vehicle.length - vehicle.rearOverhang;
  const halfWidth = vehicle.width / 2;
  const samples = sampleDubinsPath(start, path, cm(20));
  const columns = project.space.obstacles.map((o) => o.polygon);
  const noGo = (project.space.zones ?? []).filter((z) => z.kind === 'no-go').map((z) => z.polygon);
  const otherVehicles = Object.values(project.items)
    .filter((i) => vehicleProfileOf(project.catalog[i.definitionId]))
    .map((i) => itemPolygon(i, project.catalog[i.definitionId]!));
  const obstacles: Polygon[] = [...columns, ...noGo, ...otherVehicles];
  for (const pose of samples) {
    const corners = vehicleCorners(pose, ahead, vehicle.rearOverhang, halfWidth) as unknown as Polygon;
    if (!containsPolygon(project.space.boundary, corners) || obstacles.some((o) => polygonsOverlap(corners, o))) {
      return { bayId, clear: false, reason: 'blocked', path: samples };
    }
  }
  return { bayId, clear: true, path: samples };
}

export interface DepotMetrics {
  readonly bays: number;
  readonly bayTypes: Readonly<Record<BayType, number>>;
  readonly occupiedBays: number;
  readonly usableBays: number;
  readonly vehicles: number;
  readonly floorArea: number;
}

export function depotMetrics(project: Project): DepotMetrics {
  const bays = (project.space.zones ?? []).filter((z) => bayTypeOf(z));
  const vehicles = Object.values(project.items).filter((i) => vehicleProfileOf(project.catalog[i.definitionId]));
  const bayTypes = { perpendicular: 0, angled: 0, parallel: 0, maintenance: 0, wash: 0, charge: 0 } as Record<BayType, number>;
  for (const bay of bays) bayTypes[bayTypeOf(bay)!]++;
  const occupied = bays.filter((bay) => occupantOf(project, bay));
  const usable = bays.filter((bay) => !occupantOf(project, bay) && bayEntry(project, bay.id).clear);
  const boundary = boundsOf(project.space.boundary);
  const floorArea = ((boundary.maxX - boundary.minX) / 100_000) * ((boundary.maxY - boundary.minY) / 100_000);
  return { bays: bays.length, bayTypes, occupiedBays: occupied.length, usableBays: usable.length, vehicles: vehicles.length, floorArea };
}

export function checkVehicleDepot(project: Project): RuleResult[] {
  const bays = (project.space.zones ?? []).filter((z) => bayTypeOf(z));
  const out = bays.filter((b) => !containsPolygon(project.space.boundary, b.polygon));
  const boundaryRule: RuleResult = bays.length
    ? { code: 'bay-boundary', unit: 'items', status: out.length ? 'fail' : 'pass', measured: bays.length - out.length, required: bays.length, entityIds: out.map((b) => b.id) }
    : { code: 'bay-boundary', unit: 'items', status: 'unknown', reason: 'no-bays', entityIds: [] };
  if (!bays.length) return [boundaryRule, { code: 'bay-entry', unit: 'items', status: 'unknown', reason: 'no-bays', entityIds: [] }];
  const lanes = (project.space.zones ?? []).filter((z) => z.kind === 'lane-one-way' || z.kind === 'lane-two-way');
  if (!lanes.length) return [boundaryRule, { code: 'bay-entry', unit: 'items', status: 'unknown', reason: 'no-lanes', entityIds: [] }];
  const free = bays.filter((b) => !occupantOf(project, b));
  const blocked = free.filter((b) => !bayEntry(project, b.id).clear);
  const entryRule: RuleResult = free.length
    ? { code: 'bay-entry', unit: 'items', status: blocked.length ? 'fail' : 'pass', measured: free.length - blocked.length, required: free.length, entityIds: blocked.map((b) => b.id) }
    : { code: 'bay-entry', unit: 'items', status: 'unknown', reason: 'all-occupied', entityIds: [] };
  return [boundaryRule, entryRule];
}
