import {
  area,
  createProject,
  createSpace,
  fromUnit,
  itemPolygon,
  locatePoint,
  rectangleBoundary,
  toSquareMetres,
  type Id,
  type ItemDefinition,
  type Project,
  type Tick,
  type Vec2,
  type Zone,
} from '@space-planner/core';
import {
  bodyAt,
  distanceToBlocked,
  floorGrid,
  guideTo,
  paintPolygon,
  planManoeuvre,
  reachable,
  rearAxleRadius,
  cellAt,
  type FloorGrid,
  type Manoeuvre,
  type Pose,
  type VehicleProfile,
} from '@space-planner/industry';
import type { RuleResult } from './rules.js';

/**
 * Vehicle depot / garage pack: vehicle types with real dimensions and turning circles, bays and
 * gates as zones, and the rule that matters most: a bay counts only if its vehicle can drive in
 * from a gate and out again without its body touching a wall, a column or a parked vehicle.
 *
 * Vehicle type `meta`: vehicle: true, wheelbase, frontOverhang, rearOverhang (ticks),
 * turnCircle (kerb-to-kerb diameter, ticks), reverse (boolean). Size: w = width, d = length.
 * Bay zone `meta`: vehicle (type id), use, heading (millidegrees the vehicle faces when parked
 * nose in), entry ('forward' | 'reverse' | 'either'). Gate zone `meta`: heading (direction of
 * driving in, millidegrees).
 */

const cm = (v: number) => fromUnit(v, 'cm');
const m = (v: number) => fromUnit(v, 'm');
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
const DEG = Math.PI / 180_000;

const vehicle = (id: string, name: string, w: number, l: number, h: number, wheelbase: number, front: number, circle: number, reverse = true): ItemDefinition => ({
  id,
  name,
  category: 'vehicle',
  size: { w: cm(w), d: cm(l), h: cm(h) },
  clearance: { front: 0, back: 0, left: 0, right: 0 },
  meta: { vehicle: true, wheelbase: cm(wheelbase), frontOverhang: cm(front), rearOverhang: cm(l - wheelbase - front), turnCircle: cm(circle), reverse },
});

/** Typical dimensions and turning circles (common guidance; use the fleet's own spec sheets). */
export const DEPOT_CATALOG: readonly ItemDefinition[] = [
  vehicle('car', 'Car', 180, 470, 150, 280, 95, 1100),
  vehicle('van', 'Van 3.5 t', 205, 590, 250, 366, 95, 1340),
  vehicle('truck', 'Rigid truck 10 m', 255, 1000, 360, 550, 140, 1800),
  vehicle('bus', 'Bus 12 m', 255, 1200, 320, 600, 270, 2100),
];

export const BAY_USES = ['parking', 'maintenance', 'wash', 'charge'] as const;
export type BayUse = (typeof BAY_USES)[number];

/** Side room for doors and the space kept at the bay ends (common guidance). */
export const BAY_SIDE_MARGIN = cm(30);
export const BAY_END_MARGIN = cm(25);
/** Room kept above the tallest vehicle. */
export const HEADROOM_MARGIN = cm(20);

export const DEPOT_STYLES = [{ id: 'standard', label: 'Swept paths' }] as const;

/** The planning profile of a vehicle type, or undefined when it is not a vehicle. */
export function vehicleOf(definition: ItemDefinition | undefined): VehicleProfile | undefined {
  const meta = definition?.meta;
  if (!definition || meta?.vehicle !== true) return undefined;
  const wheelbase = num(meta.wheelbase);
  const front = num(meta.frontOverhang);
  const rear = num(meta.rearOverhang);
  const circle = num(meta.turnCircle);
  if (wheelbase === undefined || front === undefined || rear === undefined || circle === undefined) return undefined;
  const radius = rearAxleRadius(circle, wheelbase, definition.size.w);
  if (!(radius > 0)) return undefined;
  return { id: definition.id, label: definition.name, length: definition.size.d, width: definition.size.w, wheelbase, frontOverhang: front, rearOverhang: rear, minRadius: radius, reverse: meta.reverse !== false };
}

export function isDepot(project: Project): boolean {
  return project.space.meta?.pack === 'depot';
}

/** A rectangle zone of size w (across) × l (along the heading), centred at c, turned to `heading`. */
export function orientedZone(id: Id, kind: string, name: string, c: Vec2, w: number, l: number, heading: number, meta: Zone['meta'] = undefined): Zone {
  const a = heading * DEG;
  const ux = Math.cos(a);
  const uy = Math.sin(a);
  // `|| 0` turns −0 (a rounded tiny negative) into 0: the core rejects −0 as not an integer tick.
  const at = (along: number, across: number): Vec2 => ({ x: Math.round(c.x + along * ux - across * uy) || 0, y: Math.round(c.y + along * uy + across * ux) || 0 });
  const polygon = [at(-l / 2, -w / 2), at(l / 2, -w / 2), at(l / 2, w / 2), at(-l / 2, w / 2)];
  return { id, kind, name, polygon, ...(meta ? { meta } : {}) };
}

/** A new depot: an empty yard with one gate on the south wall and the sample vehicle types. */
export function newDepot(name: string, size: { width: Tick; depth: Tick; height?: Tick } = { width: m(40), depth: m(30), height: m(5) }): Project {
  const gate = orientedZone('gate-1', 'gate', 'Gate', { x: m(6), y: m(2) }, m(6), m(4), 90_000, { heading: 90_000 });
  const space = createSpace(rectangleBoundary(size.width, size.depth), {
    doors: [],
    ...(size.height === undefined ? {} : { ceilingHeight: size.height }),
    meta: { pack: 'depot' },
    zones: [gate],
  });
  return { ...createProject('new', name, space), catalog: Object.fromEntries(DEPOT_CATALOG.map((d) => [d.id, d])) };
}

export interface BayRowSpec {
  readonly vehicleId: Id;
  readonly use: BayUse;
  /** Middle of the row's first bay entrance edge. */
  readonly origin: Vec2;
  readonly count: number;
  /** 90 = square to the aisle, 60 / 45 = angled, 0 = parallel. */
  readonly angle: 90 | 60 | 45 | 0;
  readonly bayWidth: Tick;
  readonly bayLength: Tick;
  /** Which way vehicles face when parked nose in: into the row from the aisle. */
  readonly facing: 'north' | 'south';
  readonly entry: 'forward' | 'reverse' | 'either';
  readonly taken: ReadonlySet<string>;
}

/**
 * Zones for a row of bays running east along an aisle. The origin is on the aisle edge; bays open
 * towards the aisle and point `facing` (north: the row lies north of the aisle).
 */
export function bayRow(spec: BayRowSpec): Zone[] {
  const out: Zone[] = [];
  let n = 1;
  const newId = () => {
    let id: string;
    do id = `bay-${n++}`;
    while (spec.taken.has(id));
    return id;
  };
  const sign = spec.facing === 'north' ? 1 : -1;
  // Heading into the bay, in millidegrees: straight north/south, or leaning east for angled bays.
  const heading = spec.angle === 0 ? 0 : sign > 0 ? spec.angle * 1000 : 360_000 - spec.angle * 1000;
  const a = (spec.angle === 0 ? 0 : spec.angle) * (Math.PI / 180);
  // Distance along the aisle from one bay to the next.
  const pitch = spec.angle === 0 ? spec.bayLength : spec.bayWidth / Math.sin(a);
  for (let i = 0; i < spec.count; i++) {
    const entrance = { x: spec.origin.x + pitch * i + pitch / 2, y: spec.origin.y };
    const into = spec.angle === 0 ? { x: 0, y: sign } : { x: Math.cos(a), y: sign * Math.sin(a) };
    const depth = spec.angle === 0 ? spec.bayWidth : spec.bayLength;
    const centre = { x: entrance.x + (into.x * depth) / 2, y: entrance.y + (into.y * depth) / 2 };
    const id = newId();
    out.push(orientedZone(id, 'bay', `Bay ${id.slice(4)}`, centre, spec.bayWidth, spec.bayLength, heading, { vehicle: spec.vehicleId, use: spec.use, heading, entry: spec.entry }));
  }
  return out;
}

/** A bay with its vehicle and the pose(s) it is parked in. */
export interface VehicleBay {
  readonly zone: Zone;
  readonly vehicle: VehicleProfile | undefined;
  readonly use: string;
  /** Rear-axle poses of the parked vehicle: nose in, backed in, or both. */
  readonly parked: readonly Pose[];
}

function centreOf(polygon: readonly Vec2[]): Vec2 {
  const n = polygon.length;
  return { x: polygon.reduce((s, p) => s + p.x, 0) / n, y: polygon.reduce((s, p) => s + p.y, 0) / n };
}

/** The rear-axle pose that puts the vehicle's body centre at `c`, facing `heading` (radians). */
export function poseCentredAt(v: VehicleProfile, c: Vec2, heading: number): Pose {
  const back = v.length / 2 - v.rearOverhang;
  return { x: c.x - back * Math.cos(heading), y: c.y - back * Math.sin(heading), heading };
}

export function baysOfDepot(project: Project): VehicleBay[] {
  return (project.space.zones ?? [])
    .filter((z) => z.kind === 'bay')
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .map((zone) => {
      const v = vehicleOf(project.catalog[String(zone.meta?.vehicle ?? '')]);
      const heading = (num(zone.meta?.heading) ?? 90_000) * DEG;
      const entry = zone.meta?.entry === 'reverse' || zone.meta?.entry === 'either' ? zone.meta.entry : 'forward';
      const c = centreOf(zone.polygon);
      const parked = !v ? [] : entry === 'forward' ? [poseCentredAt(v, c, heading)] : entry === 'reverse' ? [poseCentredAt(v, c, heading + Math.PI)] : [poseCentredAt(v, c, heading), poseCentredAt(v, c, heading + Math.PI)];
      return { zone, vehicle: v, use: String(zone.meta?.use ?? 'parking'), parked };
    });
}

/** Gate poses for a vehicle: body centred in the gate, facing in (to enter) or out (to leave). */
export function gatesOf(project: Project): Array<{ zone: Zone; centre: Vec2; heading: number }> {
  return (project.space.zones ?? [])
    .filter((z) => z.kind === 'gate')
    .sort((a, b) => (a.id < b.id ? -1 : 1))
    .map((zone) => ({ zone, centre: centreOf(zone.polygon), heading: (num(zone.meta?.heading) ?? 90_000) * DEG }));
}

/**
 * Where a vehicle stands at a gate: facing in (or out, to leave), its body just inside the yard —
 * the rear (or nose) 30 cm in from the gate's outer edge when the vehicle is longer than the gate.
 */
export function gatePose(v: VehicleProfile, gate: { zone: Zone; centre: Vec2; heading: number }, leaving: boolean): Pose {
  const ux = Math.cos(gate.heading);
  const uy = Math.sin(gate.heading);
  const along = gate.zone.polygon.map((p) => (p.x - gate.centre.x) * ux + (p.y - gate.centre.y) * uy);
  const depth = Math.max(...along) - Math.min(...along);
  const shift = Math.max(0, v.length / 2 - depth / 2 + cm(30));
  const c = { x: gate.centre.x + ux * shift, y: gate.centre.y + uy * shift };
  return poseCentredAt(v, c, leaving ? gate.heading + Math.PI : gate.heading);
}

/**
 * The obstacles a moving vehicle meets: walls, columns, no-go zones and every item except those
 * standing in `freeBay` (the bay being checked is empty while its own vehicle comes and goes).
 */
export function yardFor(project: Project, freeBay?: Zone, cell: Tick = cm(5)): { grid: FloorGrid; clearance: Float64Array } {
  const grid = floorGrid(project.space.boundary, cell);
  for (const o of project.space.obstacles) paintPolygon(grid, o.polygon, 1);
  for (const z of project.space.zones ?? []) if (z.kind === 'no-go') paintPolygon(grid, z.polygon, 1);
  for (const item of Object.values(project.items)) {
    const d = project.catalog[item.definitionId];
    if (!d) continue;
    if (freeBay && locatePoint(freeBay.polygon, item.position) !== 'outside') continue;
    paintPolygon(grid, itemPolygon(item, d), 1);
  }
  return { grid, clearance: distanceToBlocked(grid.blocked, grid.nx, grid.ny) };
}

export type Access = { readonly status: 'pass'; readonly enter: Manoeuvre; readonly leave: Manoeuvre } | { readonly status: 'fail' | 'unknown'; readonly why: string };

/** Search effort per manoeuvre: beyond it the answer is "unknown", never "no". */
export const ACCESS_BUDGET = 25_000;

/**
 * Answers already worked out, keyed by everything they depend on (walls, columns, zones, items,
 * vehicle types, the bay): the same yard asked twice — by the rules, the facts and a variant
 * comparison — is searched once. A pure function's memo: same input, same answer.
 */
const accessMemo = new Map<string, Access>();
const MEMO_SIZE = 512;

/**
 * Can the bay's vehicle drive in from a gate and back out to a gate? Each direction is searched
 * from every gate until one works; "no" only when every search proved there is no way.
 */
export function bayAccess(project: Project, bay: VehicleBay): Access {
  // Every item type counts: a resized barrier changes what a vehicle meets as much as a new wall.
  const key = JSON.stringify([project.space.boundary, project.space.obstacles, project.space.zones, project.items, project.catalog, bay.zone.id, bay.parked]);
  const known = accessMemo.get(key);
  if (known) return known;
  const answer = searchAccess(project, bay);
  if (accessMemo.size >= MEMO_SIZE) accessMemo.delete(accessMemo.keys().next().value!);
  accessMemo.set(key, answer);
  return answer;
}

function searchAccess(project: Project, bay: VehicleBay): Access {
  const v = bay.vehicle;
  if (!v) return { status: 'unknown', why: 'no-vehicle-data' };
  const gates = gatesOf(project);
  if (gates.length === 0) return { status: 'unknown', why: 'no-gates' };
  const { grid, clearance } = yardFor(project, bay.zone);
  const coarse = yardFor(project, bay.zone, cm(25));
  let unknown = false;
  // A necessary condition, cheap on the coarse grid: something a little narrower than the vehicle
  // must be able to get from one rear-axle position to the other. When it cannot, that is proof.
  const narrower = Math.max(coarse.grid.cell, v.width - 2 * coarse.grid.cell);
  const connected = (a: Pose, b: Pose) => {
    const to = cellAt(coarse.grid, b);
    return to >= 0 && reachable(coarse.grid, coarse.clearance, [cellAt(coarse.grid, a)], narrower)[to] === 1;
  };
  const attempt = (from: Pose, to: Pose, guide: (p: Pose) => number): Manoeuvre | undefined => {
    if (!connected(from, to)) return undefined;
    const r = planManoeuvre(v, grid, clearance, from, to, { budget: ACCESS_BUDGET, guide });
    if (r.ok) return r.manoeuvre;
    if (r.reason === 'budget') unknown = true;
    return undefined;
  };
  for (const parked of bay.parked) {
    const guideIn = guideTo(coarse.grid, coarse.clearance, parked, v.width);
    let enter: Manoeuvre | undefined;
    for (const g of gates) {
      enter = attempt(gatePose(v, g, false), parked, guideIn);
      if (enter) break;
    }
    if (!enter) continue;
    for (const g of gates) {
      const out = gatePose(v, g, true);
      const leave = attempt(parked, out, guideTo(coarse.grid, coarse.clearance, out, v.width));
      if (leave) return { status: 'pass', enter, leave };
    }
  }
  return unknown ? { status: 'unknown', why: 'search-budget' } : { status: 'fail', why: 'no-way' };
}

const unknownRule = (code: RuleResult['code'], unit: RuleResult['unit'], reason: NonNullable<RuleResult['reason']>, extra: Partial<RuleResult> = {}): RuleResult => ({ code, unit, status: 'unknown', entityIds: [], reason, ...extra });

export function checkDepot(project: Project): RuleResult[] {
  const bays = baysOfDepot(project);
  const gates = gatesOf(project).length;
  const gatesRule: RuleResult = { code: 'gates', unit: 'items', measured: gates, required: 1, status: gates >= 1 ? 'pass' : 'fail', entityIds: [] };
  if (bays.length === 0) return [unknownRule('bay-access', 'items', 'no-bays'), unknownRule('bay-size', 'items', 'no-bays'), unknownRule('vehicle-headroom', 'ticks', 'no-bays'), gatesRule];
  return [accessRule(project, bays), sizeRule(bays), headroomRule(project, bays), gatesRule];
}

function accessRule(project: Project, bays: readonly VehicleBay[]): RuleResult {
  if (gatesOf(project).length === 0) return unknownRule('bay-access', 'items', 'no-gates', { required: bays.length });
  const failed: Id[] = [];
  const open: Id[] = [];
  let ok = 0;
  for (const bay of bays) {
    const a = bayAccess(project, bay);
    if (a.status === 'pass') ok++;
    else if (a.status === 'fail') failed.push(bay.zone.id);
    else open.push(bay.zone.id);
  }
  if (failed.length) return { code: 'bay-access', unit: 'items', measured: ok, required: bays.length, status: 'fail', entityIds: failed };
  if (open.length) return { code: 'bay-access', unit: 'items', measured: ok, required: bays.length, status: 'unknown', entityIds: open, reason: 'search-budget' };
  return { code: 'bay-access', unit: 'items', measured: ok, required: bays.length, status: 'pass', entityIds: [] };
}

/** Width across and length along the bay's heading. */
function baySize(zone: Zone): { w: number; l: number } {
  const [a, b, c] = zone.polygon;
  const e1 = Math.hypot(b!.x - a!.x, b!.y - a!.y);
  const e2 = Math.hypot(c!.x - b!.x, c!.y - b!.y);
  return { w: Math.min(e1, e2), l: Math.max(e1, e2) };
}

function sizeRule(bays: readonly VehicleBay[]): RuleResult {
  const small: Id[] = [];
  let checked = 0;
  for (const bay of bays) {
    if (!bay.vehicle || bay.zone.polygon.length !== 4) continue;
    checked++;
    const { w, l } = baySize(bay.zone);
    if (w + 1 < bay.vehicle.width + 2 * BAY_SIDE_MARGIN || l + 1 < bay.vehicle.length + BAY_END_MARGIN) small.push(bay.zone.id);
  }
  if (checked === 0) return unknownRule('bay-size', 'items', 'no-vehicle-data');
  return { code: 'bay-size', unit: 'items', measured: checked - small.length, required: checked, status: small.length ? 'fail' : 'pass', entityIds: small };
}

function headroomRule(project: Project, bays: readonly VehicleBay[]): RuleResult {
  const heights = bays.map((b) => project.catalog[String(b.zone.meta?.vehicle ?? '')]?.size.h).filter((h): h is number => h !== undefined);
  if (heights.length === 0) return unknownRule('vehicle-headroom', 'ticks', 'no-vehicle-data');
  const ceiling = project.space.ceilingHeight;
  const tallest = Math.max(...heights);
  if (ceiling === undefined) return unknownRule('vehicle-headroom', 'ticks', 'no-ceiling', { required: tallest + HEADROOM_MARGIN });
  const low = bays.filter((b) => (project.catalog[String(b.zone.meta?.vehicle ?? '')]?.size.h ?? 0) + HEADROOM_MARGIN > ceiling).map((b) => b.zone.id);
  return { code: 'vehicle-headroom', unit: 'ticks', measured: ceiling, required: tallest + HEADROOM_MARGIN, status: low.length ? 'fail' : 'pass', entityIds: low };
}

export interface DepotMetrics {
  readonly bays: number;
  readonly byUse: Readonly<Record<string, number>>;
  readonly accessible: number;
  readonly unknown: number;
  readonly gates: number;
  /** Average driven distance into the reachable bays (ticks). */
  readonly entryAverage: number | undefined;
  /** Bays reached only with changes of gear. */
  readonly withReversing: number;
  readonly yardArea: number;
}

export function depotMetrics(project: Project): DepotMetrics {
  const bays = baysOfDepot(project);
  const byUse: Record<string, number> = {};
  let accessible = 0;
  let unknown = 0;
  let total = 0;
  let withReversing = 0;
  for (const bay of bays) {
    byUse[bay.use] = (byUse[bay.use] ?? 0) + 1;
    const a = bayAccess(project, bay);
    if (a.status === 'pass') {
      accessible++;
      total += a.enter.length;
      if (a.enter.gearChanges > 0 || a.leave.gearChanges > 0) withReversing++;
    } else if (a.status === 'unknown') unknown++;
  }
  return {
    bays: bays.length,
    byUse,
    accessible,
    unknown,
    gates: gatesOf(project).length,
    entryAverage: accessible ? total / accessible : undefined,
    withReversing,
    yardArea: toSquareMetres(area(project.space.boundary)),
  };
}

/** The body outline every metre along a manoeuvre (for drawing the swept path). */
export function sweptOutlines(v: VehicleProfile, manoeuvre: Manoeuvre, every: Tick = m(1)): Vec2[][] {
  const out: Vec2[][] = [];
  let since = Infinity;
  let last: Pose | undefined;
  for (const p of manoeuvre.poses) {
    if (last) since += Math.hypot(p.x - last.x, p.y - last.y);
    if (since >= every) {
      out.push(bodyAt(v, p));
      since = 0;
    }
    last = p;
  }
  const end = manoeuvre.poses.at(-1);
  if (end) out.push(bodyAt(v, end));
  return out;
}
