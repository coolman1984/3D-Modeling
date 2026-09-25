import { measureProject, toSquareMetres, type ItemDefinition, type Project } from '@space-planner/core';
import { checkHall, HALL_STYLES, type HallStyle } from './hall.js';
import { STARTER_CATALOG } from './hallCatalog.js';
import { checkOffice, OFFICE_CATALOG, OFFICE_STYLES, type OfficeStyle } from './office.js';
import { checkContainer, CONTAINER_CATALOG, CONTAINER_STYLES, containerMetrics, isContainer } from './container.js';
import { checkRestaurant, isRestaurant, RESTAURANT_CATALOG, RESTAURANT_STYLES, restaurantMetrics } from './restaurant.js';
import { checkDepot, depotMetrics, DEPOT_CATALOG, DEPOT_STYLES, isDepot } from './depot.js';
import { checkFactory, factoryMetrics, FACTORY_CATALOG, FACTORY_STYLES, isFactory, lineSimulator } from './factory.js';
import { checkWarehouse, isWarehouse, WAREHOUSE_CATALOG, WAREHOUSE_STYLES, warehouseMetrics } from './warehouse.js';
import { RULE_SOURCES, type RuleResult } from './rules.js';

export type PackId = 'hall' | 'office' | 'container' | 'warehouse' | 'factory' | 'depot' | 'restaurant';

/**
 * An activity pack: what a kind of space is furnished with and which rules it is checked
 * against. Adding a pack means adding an entry here, never changing the core.
 */
export interface Pack {
  readonly id: PackId;
  readonly label: string;
  readonly catalog: readonly ItemDefinition[];
  readonly styles: readonly { readonly id: string; readonly label: string }[];
  readonly check: (project: Project, style: string) => RuleResult[];
  /** The few numbers that decide between alternatives of this kind of space (variant comparison). */
  readonly figures: (project: Project) => Figure[];
}

/** One number for comparing variants; undefined when it cannot be measured. */
export interface Figure {
  readonly id: string;
  readonly label: string;
  readonly value: number | undefined;
  readonly unit: 'count' | 'percent' | 'square-metres' | 'grams' | 'ticks';
  /** Which way is better, when there is a better way. */
  readonly better?: 'higher' | 'lower';
}

function seatFigures(project: Project, perSeat: string): Figure[] {
  const m = measureProject(project);
  return [
    { id: 'seats', label: 'Seats', value: m.seats, unit: 'count', better: 'higher' },
    { id: 'area-per-seat', label: perSeat, value: m.seats > 0 ? Math.round((toSquareMetres(m.floorArea) / m.seats) * 100) / 100 : undefined, unit: 'square-metres' },
    { id: 'items', label: 'Items', value: m.itemCount, unit: 'count' },
  ];
}

function containerFigures(project: Project): Figure[] {
  const m = containerMetrics(project);
  return [
    { id: 'pieces', label: 'Pieces loaded', value: m.pieces, unit: 'count', better: 'higher' },
    { id: 'unpacked', label: 'Not placed', value: m.unpacked, unit: 'count', better: 'lower' },
    { id: 'volume-use', label: 'Volume used', value: m.volumeUse, unit: 'percent', better: 'higher' },
    { id: 'payload-use', label: 'Payload used', value: m.payloadUse, unit: 'percent' },
    { id: 'off-centre', label: 'Off centre', value: m.balance ? Math.max(m.balance.along, m.balance.across) / 100 : undefined, unit: 'percent', better: 'lower' },
  ];
}

function restaurantFigures(project: Project): Figure[] {
  const r = restaurantMetrics(project, 'casual');
  return [
    { id: 'covers', label: 'Covers', value: r.covers, unit: 'count', better: 'higher' },
    { id: 'floor-per-cover', label: 'Floor per cover', value: r.floorPerCover === undefined ? undefined : Math.round(r.floorPerCover * 100) / 100, unit: 'square-metres' },
    { id: 'service-max', label: 'Longest walk from the pass', value: r.serviceMax, unit: 'ticks', better: 'lower' },
    { id: 'unreachable', label: 'Tables a server cannot reach', value: r.unreachable, unit: 'count', better: 'lower' },
  ];
}

function depotFigures(project: Project): Figure[] {
  const d = depotMetrics(project);
  return [
    { id: 'accessible', label: 'Bays a vehicle can use', value: d.accessible, unit: 'count', better: 'higher' },
    { id: 'bays', label: 'Bays drawn', value: d.bays, unit: 'count' },
    { id: 'entry', label: 'Drive into a bay (average)', value: d.entryAverage, unit: 'ticks', better: 'lower' },
    { id: 'reversing', label: 'Bays needing a reverse', value: d.withReversing, unit: 'count', better: 'lower' },
  ];
}

/** Floor figures, then one shift's output when every cycle time is known (never guessed). */
function factoryFigures(project: Project): Figure[] {
  const f = factoryMetrics(project, 'cart');
  const shift = lineSimulator.run(project, { hours: 8 });
  return [
    { id: 'per-hour', label: 'Parts per hour (simulated)', value: shift.ok ? Math.round(shift.perHour * 10) / 10 : undefined, unit: 'count', better: 'higher' },
    { id: 'wip', label: 'Work in progress (average)', value: shift.ok ? Math.round(shift.wipAverage * 10) / 10 : undefined, unit: 'count', better: 'lower' },
    { id: 'flow-length', label: 'Flow length (straight)', value: f.straightLength, unit: 'ticks', better: 'lower' },
    { id: 'crossings', label: 'Flow crossings', value: f.crossings, unit: 'count', better: 'lower' },
  ];
}

function warehouseFigures(project: Project): Figure[] {
  const w = warehouseMetrics(project);
  return [
    { id: 'locations', label: 'Pallet locations', value: w.locations, unit: 'count', better: 'higher' },
    { id: 'rack-capacity', label: 'Rack capacity', value: w.rackCapacity, unit: 'grams', better: 'higher' },
    { id: 'floor-use', label: 'Floor used', value: w.storageFloorShare, unit: 'percent' },
    { id: 'travel', label: 'Dock to rack (average)', value: w.travelAverage, unit: 'ticks', better: 'lower' },
  ];
}

export const PACKS: readonly Pack[] = [
  { id: 'hall', label: 'Event hall', catalog: STARTER_CATALOG, styles: HALL_STYLES, check: (p, s) => checkHall(p, s as HallStyle), figures: (p) => seatFigures(p, 'Floor per guest') },
  { id: 'office', label: 'Office', catalog: OFFICE_CATALOG, styles: OFFICE_STYLES, check: (p, s) => checkOffice(p, s as OfficeStyle), figures: (p) => seatFigures(p, 'Floor per person') },
  { id: 'container', label: 'Container loading', catalog: CONTAINER_CATALOG, styles: CONTAINER_STYLES, check: (p) => checkContainer(p), figures: containerFigures },
  { id: 'warehouse', label: 'Warehouse', catalog: WAREHOUSE_CATALOG, styles: WAREHOUSE_STYLES, check: (p) => checkWarehouse(p), figures: warehouseFigures },
  { id: 'factory', label: 'Production line', catalog: FACTORY_CATALOG, styles: FACTORY_STYLES, check: (p, s) => checkFactory(p, s), figures: factoryFigures },
  { id: 'depot', label: 'Vehicle depot', catalog: DEPOT_CATALOG, styles: DEPOT_STYLES, check: (p) => checkDepot(p), figures: depotFigures },
  { id: 'restaurant', label: 'Restaurant', catalog: RESTAURANT_CATALOG, styles: RESTAURANT_STYLES, check: (p, s) => checkRestaurant(p, s), figures: restaurantFigures },
];

export function packOf(id: string | null | undefined): Pack {
  return PACKS.find((p) => p.id === id) ?? PACKS[0]!;
}

/**
 * Which pack a project belongs to, read from its catalog: the pack with the most of its item
 * types in the project. Ties go to the first pack (the hall).
 */
export function detectPack(project: Project): PackId {
  if (isContainer(project)) return 'container';
  if (isWarehouse(project)) return 'warehouse';
  if (isFactory(project)) return 'factory';
  if (isDepot(project)) return 'depot';
  if (isRestaurant(project)) return 'restaurant';
  const present = (pack: Pack) => pack.catalog.filter((d) => project.catalog[d.id] !== undefined).length;
  let best = PACKS[0]!;
  for (const pack of PACKS) if (present(pack) > present(best)) best = pack;
  return best.id;
}

/** The pack's item types the project does not have yet. */
export function missingPackItems(project: Project, packId: PackId): ItemDefinition[] {
  return packOf(packId).catalog.filter((d) => !project.catalog[d.id]);
}

/** Rules of the pack for the style (the pack's first style when the style is not one of its own). */
export function checkPack(project: Project, packId: PackId, style?: string | null): RuleResult[] {
  const pack = packOf(packId);
  const known = pack.styles.some((s) => s.id === style);
  return pack.check(project, known ? style! : pack.styles[0]!.id).map((r) => ({ ...r, source: RULE_SOURCES[r.code] }));
}
