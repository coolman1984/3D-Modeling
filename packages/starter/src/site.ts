import { area, boundsOf, containsPolygon, fromUnit, itemPolygon, polygonsOverlap, toSquareMetres, type ItemDefinition, type Project } from '@space-planner/core';
import { bayTypeOf, checkVehicleDepot, VEHICLE_CATALOG } from './depot.js';
import type { RuleResult } from './rules.js';

/**
 * Site pack: a whole campus seen from above — buildings, gates, roads, staff parking, green areas.
 * A building is one item with its outer size; what happens inside it is its own project (a
 * production hall, an office floor), so the site plan answers "does it fit on the plot and can
 * vehicles park and get in", not "is the inside laid out well".
 */

const m = (v: number) => fromUnit(v, 'm');
const cm = (v: number) => fromUnit(v, 'cm');
const none = { front: 0, back: 0, left: 0, right: 0 };

/** Zone kinds the site pack draws and measures; parking bays and lanes follow the depot pack. */
export const SITE_ZONE_KINDS = ['road', 'footpath', 'green', 'plaza', 'yard', 'lane-two-way', 'lane-one-way', 'bay', 'no-go'] as const;

export type BuildingUse = 'production' | 'warehouse' | 'office' | 'training' | 'canteen' | 'utility' | 'security' | 'mosque';

/**
 * A building on the site plan. `storeys` and `facade` only change how it is drawn; `sign` is the
 * lettering on its front; `use` groups it in the site metrics.
 */
export function buildingDefinition(id: string, name: string, wM: number, dM: number, hM: number, use: BuildingUse, extra: { storeys?: number; facade?: 'cladding' | 'glass' | 'concrete' | 'stone'; sign?: string; color?: number } = {}): ItemDefinition {
  return {
    id,
    name,
    category: 'building',
    size: { w: m(wM), d: m(dM), h: m(hM) },
    clearance: none,
    meta: { kind: 'building', use, storeys: extra.storeys ?? 1, facade: extra.facade ?? 'cladding', ...(extra.sign ? { sign: extra.sign } : {}), ...(extra.color !== undefined ? { color: extra.color } : {}) },
  };
}

function vehicle(id: string, name: string, wCm: number, dCm: number, hCm: number, minTurningRadiusCm: number, rearOverhangCm: number, body: string, color: number): ItemDefinition {
  return { id, name, category: body, size: { w: cm(wCm), d: cm(dCm), h: cm(hCm) }, clearance: none, meta: { kind: 'vehicle', minTurningRadius: cm(minTurningRadiusCm), rearOverhang: cm(rearOverhangCm), color } };
}

export const SITE_CATALOG: readonly ItemDefinition[] = [
  // Vehicles: a staff coach's 12 m body and ~11 m kerb-to-kerb turning are typical published values, rounded.
  vehicle('site-coach', 'Staff coach 12 m', 255, 1200, 340, 1100, 300, 'bus', 0xf2f0ea),
  vehicle('site-minibus', 'Staff minibus 7 m', 210, 700, 280, 700, 180, 'bus', 0xe9eef2),
  vehicle('site-car', 'Staff car', 180, 450, 150, 520, 90, 'car', 0x8d97a3),
  ...VEHICLE_CATALOG.filter((d) => d.id === 'depot-truck'),
  // Landscape and street furniture.
  { id: 'site-tree', name: 'Shade tree · ficus 6 m', category: 'tree', size: { w: m(6), d: m(6), h: m(7) }, clearance: none, footprint: 'round', meta: { kind: 'tree', species: 'ficus' } },
  { id: 'site-palm', name: 'Date palm', category: 'tree', size: { w: m(4), d: m(4), h: m(9) }, clearance: none, footprint: 'round', meta: { kind: 'tree', species: 'palm' } },
  { id: 'site-lamp', name: 'Street light 9 m', category: 'lamp', size: { w: cm(40), d: cm(40), h: m(9) }, clearance: none, footprint: 'round' },
  // A shade roof is placed raised (about 2.6 m) so cars park under it; the 3D view draws its posts.
  { id: 'site-shade', name: 'Parking shade roof 12.5 × 5 m', category: 'canopy', size: { w: cm(1250), d: m(5), h: cm(25) }, clearance: none },
  { id: 'site-flag', name: 'Flag poles', category: 'flag', size: { w: m(6), d: cm(60), h: m(12) }, clearance: none },
  { id: 'site-barrier', name: 'Gate barrier arm', category: 'barrier', size: { w: m(5), d: cm(40), h: cm(110) }, clearance: none },
  buildingDefinition('site-guard-booth', 'Guard booth', 3, 3, 3, 'security', { facade: 'concrete' }),
];

export const SITE_STYLES = [{ id: 'industrial-campus', label: 'Industrial campus' }] as const;

export const isSite = (project: Project): boolean => project.space.meta?.pack === 'site';

export const isBuilding = (definition: ItemDefinition | undefined): boolean => definition?.category === 'building';

export interface SiteMetrics {
  readonly siteArea: number;
  readonly builtArea: number;
  /** Building footprints over the site area, percent (one decimal). */
  readonly coverage: number;
  readonly buildings: number;
  readonly greenArea: number;
  readonly carBays: number;
  readonly busBays: number;
  readonly cars: number;
  readonly buses: number;
  readonly trees: number;
}

/** Areas in square metres, counts as numbers; nothing here is a rule, only what the plan holds. */
export function siteMetrics(project: Project): SiteMetrics {
  const items = Object.values(project.items);
  const def = (id: string) => project.catalog[id];
  const buildings = items.filter((i) => isBuilding(def(i.definitionId)));
  const builtArea = buildings.reduce((sum, i) => sum + toSquareMetres(Math.abs(area(itemPolygon(i, def(i.definitionId)!)))), 0);
  const siteArea = toSquareMetres(Math.abs(area(project.space.boundary)));
  const zones = project.space.zones ?? [];
  const greenArea = zones.filter((z) => z.kind === 'green').reduce((sum, z) => sum + toSquareMetres(Math.abs(area(z.polygon))), 0);
  const bays = zones.filter((z) => bayTypeOf(z));
  const busBays = bays.filter((z) => bayTypeOf(z) === 'bus').length;
  return {
    siteArea: Math.round(siteArea),
    builtArea: Math.round(builtArea),
    coverage: siteArea > 0 ? Math.round((builtArea / siteArea) * 1000) / 10 : 0,
    buildings: buildings.length,
    greenArea: Math.round(greenArea),
    carBays: bays.length - busBays,
    busBays,
    cars: items.filter((i) => def(i.definitionId)?.category === 'car').length,
    buses: items.filter((i) => def(i.definitionId)?.category === 'bus').length,
    trees: items.filter((i) => def(i.definitionId)?.category === 'tree').length,
  };
}

/**
 * Buildings stand inside the plot and off the roads. Roads are zones; a building footprint that
 * crosses one blocks traffic the plan relies on. Bays and lanes follow the depot pack's rules.
 */
export function checkSite(project: Project): RuleResult[] {
  const buildings = Object.values(project.items)
    .filter((i) => isBuilding(project.catalog[i.definitionId]))
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  let buildingRule: RuleResult;
  if (buildings.length === 0) buildingRule = { code: 'building-boundary', unit: 'items', status: 'unknown', reason: 'no-buildings', entityIds: [] };
  else {
    const roads = (project.space.zones ?? []).filter((z) => z.kind === 'road' || z.kind.startsWith('lane'));
    const bad = buildings.filter((b) => {
      const body = itemPolygon(b, project.catalog[b.definitionId]!);
      if (!containsPolygon(project.space.boundary, body)) return true;
      const box = boundsOf(body);
      return roads.some((r) => {
        const rb = boundsOf(r.polygon);
        return rb.minX < box.maxX && box.minX < rb.maxX && rb.minY < box.maxY && box.minY < rb.maxY && polygonsOverlap(body, r.polygon);
      });
    });
    buildingRule = { code: 'building-boundary', unit: 'items', status: bad.length ? 'fail' : 'pass', measured: buildings.length - bad.length, required: buildings.length, entityIds: bad.map((b) => b.id) };
  }
  return [buildingRule, ...checkVehicleDepot(project)];
}
