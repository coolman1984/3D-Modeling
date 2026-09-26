import { measureProject, toSquareMetres, type ItemDefinition, type Project } from '@space-planner/core';
import { checkHall, HALL_STYLES, type HallStyle } from './hall.js';
import { STARTER_CATALOG } from './hallCatalog.js';
import { checkOffice, OFFICE_CATALOG, OFFICE_STYLES, type OfficeStyle } from './office.js';
import { checkContainer, CONTAINER_CATALOG, CONTAINER_STYLES, containerMetrics, isContainer } from './container.js';
import { checkWarehouse, isWarehouse, WAREHOUSE_CATALOG, WAREHOUSE_STYLES, warehouseMetrics } from './warehouse.js';
import { checkProduction, isProduction, PRODUCTION_CATALOG, PRODUCTION_STYLES, productionMetrics } from './production.js';
import { checkVehicleDepot, depotMetrics, DEPOT_CATALOG, DEPOT_STYLES, isVehicleDepot } from './depot.js';
import { checkRestaurant, isRestaurant, RESTAURANT_CATALOG, RESTAURANT_STYLES, restaurantMetrics, type RestaurantStyle } from './restaurant.js';
import { RULE_SOURCES, type RuleResult } from './rules.js';

export type PackId = 'hall' | 'office' | 'container' | 'warehouse' | 'production' | 'depot' | 'restaurant';

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
  /** The few comparable numbers that matter for this activity. */
  readonly figures: (project: Project) => Figure[];
}

export interface Figure {
  readonly id: string;
  readonly label: string;
  readonly value: number | undefined;
  readonly unit: 'count' | 'percent' | 'square-metres' | 'grams' | 'ticks';
  readonly better?: 'higher' | 'lower';
}

function seatFigures(project: Project, perSeatLabel: string): Figure[] {
  const m = measureProject(project);
  return [
    { id: 'seats', label: 'Seats', value: m.seats, unit: 'count', better: 'higher' },
    { id: 'area-per-seat', label: perSeatLabel, value: m.seats > 0 ? Math.round((toSquareMetres(m.floorArea) / m.seats) * 100) / 100 : undefined, unit: 'square-metres' },
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

function warehouseFigures(project: Project): Figure[] {
  const m = warehouseMetrics(project);
  return [
    { id: 'locations', label: 'Pallet locations', value: m.positions, unit: 'count', better: 'higher' },
    { id: 'usable-locations', label: 'Usable locations', value: m.usablePositions, unit: 'count', better: 'higher' },
    { id: 'floor-use', label: 'Rack floor use', value: m.floorUtilization, unit: 'percent' },
    { id: 'docks', label: 'Docks', value: m.docks, unit: 'count' },
  ];
}

function productionFigures(project: Project): Figure[] {
  const m = productionMetrics(project);
  return [
    { id: 'stations', label: 'Stations', value: m.stations, unit: 'count' },
    { id: 'reachable-flow', label: 'Reachable flow', value: m.totalSegments > 0 ? m.reachableSegments / m.totalSegments : undefined, unit: 'percent', better: 'higher' },
    { id: 'flow-length', label: 'Flow length', value: m.totalSegments > 0 ? m.flowLength : undefined, unit: 'ticks', better: 'lower' },
    { id: 'buffer-capacity', label: 'Buffer capacity', value: m.bufferCapacity, unit: 'count', better: 'higher' },
  ];
}

function depotFigures(project: Project): Figure[] {
  const m = depotMetrics(project);
  return [
    { id: 'bays', label: 'Parking bays', value: m.bays, unit: 'count', better: 'higher' },
    { id: 'usable-bays', label: 'Usable empty bays', value: m.usableBays, unit: 'count', better: 'higher' },
    { id: 'occupied-bays', label: 'Occupied bays', value: m.occupiedBays, unit: 'count' },
    { id: 'vehicles', label: 'Vehicles', value: m.vehicles, unit: 'count' },
  ];
}

function restaurantFigures(project: Project): Figure[] {
  const m = restaurantMetrics(project);
  return [
    { id: 'covers', label: 'Covers', value: m.covers, unit: 'count', better: 'higher' },
    { id: 'reachable-tables', label: 'Reachable tables', value: m.totalTables > 0 ? m.reachableTables / m.totalTables : undefined, unit: 'percent', better: 'higher' },
    { id: 'floor-per-cover', label: 'Floor per cover', value: m.covers > 0 ? m.floorPerCover : undefined, unit: 'square-metres' },
    { id: 'tables', label: 'Tables', value: m.tables, unit: 'count' },
  ];
}

export const PACKS: readonly Pack[] = [
  { id: 'hall', label: 'Event hall', catalog: STARTER_CATALOG, styles: HALL_STYLES, check: (p, s) => checkHall(p, s as HallStyle), figures: (p) => seatFigures(p, 'Floor per guest') },
  { id: 'office', label: 'Office', catalog: OFFICE_CATALOG, styles: OFFICE_STYLES, check: (p, s) => checkOffice(p, s as OfficeStyle), figures: (p) => seatFigures(p, 'Floor per person') },
  { id: 'container', label: 'Container loading', catalog: CONTAINER_CATALOG, styles: CONTAINER_STYLES, check: (p) => checkContainer(p), figures: containerFigures },
  { id: 'warehouse', label: 'Warehouse', catalog: WAREHOUSE_CATALOG, styles: WAREHOUSE_STYLES, check: (p) => checkWarehouse(p), figures: warehouseFigures },
  { id: 'production', label: 'Production line', catalog: PRODUCTION_CATALOG, styles: PRODUCTION_STYLES, check: (p) => checkProduction(p), figures: productionFigures },
  { id: 'depot', label: 'Vehicle depot', catalog: DEPOT_CATALOG, styles: DEPOT_STYLES, check: (p) => checkVehicleDepot(p), figures: depotFigures },
  { id: 'restaurant', label: 'Restaurant', catalog: RESTAURANT_CATALOG, styles: RESTAURANT_STYLES, check: (p, s) => checkRestaurant(p, s as RestaurantStyle), figures: restaurantFigures },
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
  if (isProduction(project)) return 'production';
  if (isVehicleDepot(project)) return 'depot';
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
