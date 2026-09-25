import {
  area,
  boundsOf,
  containsPolygon,
  createProject,
  createSpace,
  doorPolygon,
  fromUnit,
  itemClearancePolygon,
  itemPolygon,
  locatePoint,
  measureProject,
  polygonsOverlap,
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
import { cellAt, type FloorGrid } from '@space-planner/industry';
import type { Candidate, OptimizationPort } from './optimization.js';
import { exitRules, routesToItems, walkwayRule, type RuleResult } from './rules.js';

/**
 * Restaurant pack: table families with their chairs, dining / bar / terrace / private zones, the
 * kitchen pass, and the rules that decide whether a floor works for guests and for service:
 * a way out for every guest, a service route from the pass to every table, floor per cover, exits.
 *
 * A table family is one item: the table with its chairs drawn in, `seats` = covers. The pass is an
 * item whose type `meta.pass` is true; servers start from its front.
 */

const cm = (v: number) => fromUnit(v, 'cm');
const m = (v: number) => fromUnit(v, 'm');

const table = (id: string, name: string, w: number, d: number, seats: number, extra: Partial<ItemDefinition> = {}): ItemDefinition => ({
  id,
  name,
  category: 'table-set',
  size: { w: cm(w), d: cm(d), h: cm(75) },
  // Room to pull a chair out on the sides with chairs.
  clearance: { front: cm(30), back: cm(30), left: 0, right: 0 },
  seats,
  ...extra,
});

/** Typical table families with their chairs (sizes include the chairs pushed in). */
export const RESTAURANT_CATALOG: readonly ItemDefinition[] = [
  table('table-2', '2-top 70 × 70', 70, 150, 2),
  table('table-4', '4-top 120 × 80', 120, 160, 4),
  table('table-6', '6-top 180 × 80', 180, 160, 6),
  table('round-6', 'Round table Ø 150 for 6', 230, 230, 6, { footprint: 'round', clearance: { front: cm(30), back: cm(30), left: cm(30), right: cm(30) } }),
  table('booth-4', 'Booth for 4', 150, 180, 4, { clearance: { front: cm(30), back: 0, left: 0, right: 0 } }),
  table('banquette-6', 'Banquette with 3 tables', 360, 120, 6, { clearance: { front: cm(30), back: 0, left: 0, right: 0 } }),
  table('communal-10', 'Communal table for 10', 300, 170, 10),
  { id: 'pass', name: 'Kitchen pass', category: 'counter', size: { w: cm(300), d: cm(60), h: cm(110) }, clearance: { front: cm(90), back: 0, left: 0, right: 0 }, meta: { pass: true } },
  { id: 'bar-counter', name: 'Bar counter 4 m', category: 'counter', size: { w: cm(400), d: cm(70), h: cm(110) }, clearance: { front: cm(60), back: cm(90), left: 0, right: 0 } },
  { id: 'host-stand', name: 'Host stand', category: 'counter', size: { w: cm(80), d: cm(50), h: cm(110) }, clearance: { front: cm(60), back: 0, left: 0, right: 0 } },
];

export interface ServiceStyle {
  readonly id: 'casual' | 'fine' | 'quick';
  readonly label: string;
  /** Guest floor per cover, square metres. */
  readonly floorPerCover: number;
  /** Clear width of service aisles. */
  readonly serviceAisle: Tick;
}

/** Common restaurant planning guidance; a local code or the operator's standard may differ. */
export const SERVICE_STYLES: readonly ServiceStyle[] = [
  { id: 'casual', label: 'Casual dining', floorPerCover: 1.3, serviceAisle: cm(90) },
  { id: 'fine', label: 'Fine dining', floorPerCover: 1.8, serviceAisle: cm(120) },
  { id: 'quick', label: 'Quick service', floorPerCover: 1.0, serviceAisle: cm(90) },
];
export const RESTAURANT_STYLES = SERVICE_STYLES.map(({ id, label }) => ({ id, label }));

export function serviceStyle(id: string | null | undefined): ServiceStyle {
  return SERVICE_STYLES.find((s) => s.id === id) ?? SERVICE_STYLES[0]!;
}

/** Zone kinds this pack gives a meaning to: where guests sit. */
export const DINING_ZONES = ['dining', 'bar', 'terrace', 'private'] as const;

/** Clear width of the way out for guests (the hall's walkway rule). */
export const GUEST_WALKWAY = cm(90);

export function isRestaurant(project: Project): boolean {
  return project.space.meta?.pack === 'restaurant';
}

/** A new restaurant: a room with an entrance, the kitchen pass on the north wall, a dining zone. */
export function newRestaurant(name: string, size: { width: Tick; depth: Tick; height?: Tick } = { width: m(20), depth: m(14), height: m(3.2) }): Project {
  const { width, depth } = size;
  const zones: Zone[] = [{ id: 'dining-1', kind: 'dining', name: 'Dining room', polygon: [{ x: m(1), y: m(1) }, { x: width - m(1), y: m(1) }, { x: width - m(1), y: depth - m(3) }, { x: m(1), y: depth - m(3) }] }];
  const space = createSpace(rectangleBoundary(width, depth), {
    doors: [{ id: 'door-1', hinge: { x: Math.round(width / 2) - cm(90), y: 0 }, width: cm(180), angle: 0, swing: 'left' }],
    ...(size.height === undefined ? {} : { ceilingHeight: size.height }),
    meta: { pack: 'restaurant' },
    zones,
  });
  const base = createProject('new', name, space);
  const pass: ItemInstance = { id: 'pass-1', definitionId: 'pass', position: { x: Math.round(width / 2), y: depth - cm(30) }, rotation: 180_000, locked: true };
  return { ...base, catalog: Object.fromEntries(RESTAURANT_CATALOG.map((d) => [d.id, d])), items: { [pass.id]: pass } };
}

/** Tables: items whose type has seats. */
export function tablesOf(project: Project): ItemInstance[] {
  return Object.keys(project.items)
    .sort()
    .map((id) => project.items[id]!)
    .filter((i) => (project.catalog[i.definitionId]?.seats ?? 0) > 0);
}

export function passesOf(project: Project): ItemInstance[] {
  return Object.keys(project.items)
    .sort()
    .map((id) => project.items[id]!)
    .filter((i) => project.catalog[i.definitionId]?.meta?.pass === true);
}

/** The cells in front of each pass, as deep as half the aisle plus a cell: where servers pick up. */
export function passStarts(project: Project, grid: FloorGrid, width: Tick): number[] {
  const starts: number[] = [];
  for (const pass of passesOf(project)) {
    const d = project.catalog[pass.definitionId]!;
    const along = rotate({ x: 1, y: 0 }, pass.rotation);
    const out = rotate({ x: 0, y: 1 }, pass.rotation);
    const front = { x: pass.position.x + (out.x * d.size.d) / 2, y: pass.position.y + (out.y * d.size.d) / 2 };
    for (let t = -d.size.w / 2 + grid.cell / 2; t < d.size.w / 2; t += grid.cell / 2) {
      for (let depth = grid.cell / 2; depth <= width / 2 + grid.cell; depth += grid.cell / 2) {
        starts.push(cellAt(grid, { x: front.x + along.x * t + out.x * depth, y: front.y + along.y * t + out.y * depth }));
      }
    }
  }
  return starts;
}

/** Service distance from the pass to each table (ticks); undefined where a server cannot get. */
export function serviceDistances(project: Project, styleId: string): Map<Id, number | undefined> {
  const style = serviceStyle(styleId);
  return routesToItems(project, style.serviceAisle, tablesOf(project).map((t) => t.id), (grid) => passStarts(project, grid, style.serviceAisle), true);
}

/** The floor guests use: the dining-type zones when there are any, else the whole room. */
export function guestFloor(project: Project): number {
  const zones = (project.space.zones ?? []).filter((z) => (DINING_ZONES as readonly string[]).includes(z.kind));
  if (zones.length) return zones.reduce((t, z) => t + toSquareMetres(area(z.polygon)), 0);
  return toSquareMetres(measureProject(project).floorArea);
}

/** Restaurant rules for the service style. Deterministic; always in the same order. */
export function checkRestaurant(project: Project, styleId: string): RuleResult[] {
  const style = serviceStyle(styleId);
  const tables = tablesOf(project);
  const covers = tables.reduce((t, i) => t + (project.catalog[i.definitionId]?.seats ?? 0), 0);
  const service: RuleResult =
    tables.length === 0
      ? { code: 'service-route', unit: 'ticks', required: style.serviceAisle, status: 'unknown', reason: 'no-seats', entityIds: [] }
      : passesOf(project).length === 0
        ? { code: 'service-route', unit: 'ticks', required: style.serviceAisle, status: 'unknown', reason: 'no-pass', entityIds: [] }
        : (() => {
            const d = serviceDistances(project, style.id);
            const cut = tables.filter((t) => d.get(t.id) === undefined).map((t) => t.id);
            return { code: 'service-route', unit: 'ticks', required: style.serviceAisle, measured: tables.length - cut.length, status: cut.length ? 'fail' : 'pass', entityIds: cut } as RuleResult;
          })();
  const floor = guestFloor(project);
  const perCover: RuleResult =
    covers === 0
      ? { code: 'floor-per-cover', unit: 'square-metres', required: style.floorPerCover, status: 'unknown', reason: 'no-seats', entityIds: [] }
      : { code: 'floor-per-cover', unit: 'square-metres', required: style.floorPerCover, measured: Math.round((floor / covers) * 100) / 100, status: floor / covers >= style.floorPerCover ? 'pass' : 'fail', entityIds: [] };
  return [walkwayRule(project, GUEST_WALKWAY), service, perCover, ...exitRules(project)];
}

export interface RestaurantMetrics {
  readonly covers: number;
  readonly tables: number;
  readonly byFamily: Readonly<Record<string, number>>;
  /** Covers seated inside each dining-type zone (by zone kind). */
  readonly coversByZone: Readonly<Record<string, number>>;
  readonly guestFloor: number;
  readonly floorPerCover: number | undefined;
  readonly serviceAverage: number | undefined;
  readonly serviceMax: number | undefined;
  readonly unreachable: number;
}

export function restaurantMetrics(project: Project, styleId: string): RestaurantMetrics {
  const tables = tablesOf(project);
  const byFamily: Record<string, number> = {};
  const coversByZone: Record<string, number> = {};
  let covers = 0;
  const zones = (project.space.zones ?? []).filter((z) => (DINING_ZONES as readonly string[]).includes(z.kind));
  for (const t of tables) {
    const seats = project.catalog[t.definitionId]!.seats ?? 0;
    covers += seats;
    byFamily[t.definitionId] = (byFamily[t.definitionId] ?? 0) + 1;
    const zone = zones.find((z) => locatePoint(z.polygon, t.position) !== 'outside');
    if (zone) coversByZone[zone.kind] = (coversByZone[zone.kind] ?? 0) + seats;
  }
  const floor = guestFloor(project);
  const d = passesOf(project).length && tables.length ? serviceDistances(project, styleId) : new Map<Id, number | undefined>();
  const reached = [...d.values()].filter((v): v is number => v !== undefined);
  return {
    covers,
    tables: tables.length,
    byFamily,
    coversByZone,
    guestFloor: floor,
    floorPerCover: covers ? floor / covers : undefined,
    serviceAverage: reached.length ? reached.reduce((a, b) => a + b, 0) / reached.length : undefined,
    serviceMax: reached.length ? Math.max(...reached) : undefined,
    unreachable: tables.length - reached.length,
  };
}

export interface LayoutGoal {
  /** The zone to fill (default: the first dining zone, else the room). */
  readonly zoneId?: Id;
  /** The table family to use (default: 4-tops). */
  readonly familyId?: Id;
  /** Service style for aisles and checks. */
  readonly style?: string;
}

/** Aisle between tables for each candidate, as a multiple of the style's service aisle. */
const PROFILES = [
  { label: 'Most covers', factor: 1 },
  { label: 'Balanced', factor: 1.35 },
  { label: 'Spacious', factor: 1.8 },
] as const;

/**
 * Candidate layouts: tables of one family in rows across a zone, with the service aisle (and
 * more, for the roomier candidates) between them and each table's own clearance. Spots that clash
 * with walls, columns, doors, other items or earlier tables are skipped, and so are tables no
 * server could reach from the pass. Deterministic; proposes commands, never changes the project.
 */
export const restaurantLayouts: OptimizationPort<LayoutGoal> = {
  id: 'restaurant-grid',
  propose(project, goal) {
    const style = serviceStyle(goal.style);
    const familyId = goal.familyId ?? 'table-4';
    const family = project.catalog[familyId];
    if (!family || !(family.seats ?? 0)) return [];
    const zone = (project.space.zones ?? []).find((z) => (goal.zoneId ? z.id === goal.zoneId : (DINING_ZONES as readonly string[]).includes(z.kind)));
    const region = zone?.polygon ?? project.space.boundary;
    const b = boundsOf(region);
    const taken = new Set([project.id, ...Object.keys(project.items), ...Object.keys(project.catalog), ...project.space.doors.map((x) => x.id), ...project.space.obstacles.map((o) => o.id), ...(project.space.zones ?? []).map((z) => z.id)]);
    const out: Candidate[] = [];
    for (const profile of PROFILES) {
      const aisle = Math.round(style.serviceAisle * profile.factor);
      const pitchX = family.size.w + family.clearance.left + family.clearance.right + aisle;
      const pitchY = family.size.d + family.clearance.front + family.clearance.back + aisle;
      let trial = project;
      const added: ItemInstance[] = [];
      let n = 1;
      const nextId = () => {
        let id: string;
        do id = `${familyId}-${n++}`;
        while (taken.has(id) || trial.items[id]);
        return id;
      };
      // Centres a pitch apart from half a pitch in: half an aisle is left along the region's edges.
      for (let y = b.minY + pitchY / 2; y <= b.maxY; y += pitchY) {
        for (let x = b.minX + pitchX / 2; x <= b.maxX; x += pitchX) {
          const item: ItemInstance = { id: nextId(), definitionId: familyId, position: { x: Math.round(x), y: Math.round(y) }, rotation: 0, locked: false };
          if (!fits(trial, item, family, region)) continue;
          trial = { ...trial, items: { ...trial.items, [item.id]: item } };
          added.push(item);
        }
      }
      // Drop tables no server can reach; removing them only frees floor, so the rest stay reachable.
      if (passesOf(trial).length) {
        const d = serviceDistances(trial, style.id);
        const cut = new Set(added.filter((i) => d.get(i.id) === undefined).map((i) => i.id));
        for (const id of cut) {
          const { [id]: _gone, ...items } = trial.items;
          trial = { ...trial, items };
        }
      }
      const kept = added.filter((i) => trial.items[i.id]);
      const covers = kept.length * (family.seats ?? 0);
      const total = restaurantMetrics(trial, style.id);
      const commands: Command[] = kept.map((item) => ({ type: 'item.add', item }));
      out.push({
        label: profile.label,
        commands,
        metrics: { tables: kept.length, covers, totalCovers: total.covers, aisle, floorPerCover: total.floorPerCover ?? 0, serviceMax: total.serviceMax ?? 0 },
        explanation: `${kept.length} ${family.name} (${covers} covers) with ${Math.round(aisle / 100)} cm aisles; ${total.covers} covers in all, ${total.floorPerCover === undefined ? '—' : total.floorPerCover.toFixed(2)} m² per cover.`,
        leftOver: [],
      });
    }
    return out;
  },
};

/** The table and its clearance fit the region and clash with nothing already there. */
function fits(project: Project, item: ItemInstance, family: ItemDefinition, region: readonly Vec2[]): boolean {
  const zoneBody = itemClearancePolygon(item, family);
  if (!containsPolygon(region, zoneBody) || !containsPolygon(project.space.boundary, zoneBody)) return false;
  if (project.space.obstacles.some((o) => polygonsOverlap(zoneBody, o.polygon))) return false;
  if (project.space.doors.some((door) => polygonsOverlap(zoneBody, doorPolygon(door)))) return false;
  for (const other of Object.values(project.items)) {
    const d = project.catalog[other.definitionId];
    if (d && (polygonsOverlap(zoneBody, itemPolygon(other, d)) || polygonsOverlap(itemPolygon(item, family), itemClearancePolygon(other, d)))) return false;
  }
  return true;
}
