import {
  createProject,
  fromUnit,
  roomSpace,
  type ItemDefinition,
  type Project,
  type RoomSpec,
} from '@space-planner/core';

const m = (v: number) => fromUnit(v, 'm');
const cm = (v: number) => fromUnit(v, 'cm');

/**
 * Item shapes the 3D view knows how to draw. An item's `category` picks its shape;
 * any other category is drawn as a plain box.
 */
export const SHAPES = [
  { key: 'table', label: 'ترابيزة' },
  { key: 'round-table', label: 'ترابيزة مدورة' },
  { key: 'chair', label: 'كرسي' },
  { key: 'sofa', label: 'كنبة' },
  { key: 'desk', label: 'مكتب' },
  { key: 'counter', label: 'بوفيه / كاونتر' },
  { key: 'stage', label: 'مسرح / منصة' },
  { key: 'shelf', label: 'رف / دولاب' },
  { key: 'plant', label: 'زرع' },
  { key: 'dance-floor', label: 'أرضية / حلبة' },
  { key: 'box', label: 'صندوق عام' },
] as const;

export type ShapeKey = (typeof SHAPES)[number]['key'];

/** Shapes whose floor outline is round rather than rectangular. */
export const ROUND_SHAPES: readonly ShapeKey[] = ['round-table', 'plant'];

export function shapeOf(category: string): ShapeKey {
  return SHAPES.some((s) => s.key === category) ? (category as ShapeKey) : 'box';
}

/** Catalog definitions the project does not have yet, for bringing the hall items into an older project. */
export function missingStarterItems(project: Project): ItemDefinition[] {
  return STARTER_CATALOG.filter((d) => !project.catalog[d.id]);
}

/** A new project for a room, furnished with the catalog of the given activity pack. */
export function roomProject(name: string, spec: RoomSpec, pack: PackId = 'hall'): Project {
  return { ...createProject('new', name, roomSpace(spec)), catalog: Object.fromEntries(packOf(pack).catalog.map((d) => [d.id, d])) };
}

/** An empty rectangular room with one door in the middle of the south wall, as a hall or an office. */
export function newRoom(name: string, widthMetres: number, depthMetres: number, ceilingMetres?: number, pack: PackId = 'hall'): Project {
  const doorWidth = cm(90);
  const width = m(widthMetres);
  return roomProject(name, {
    width,
    depth: m(depthMetres),
    ...(ceilingMetres === undefined ? {} : { ceilingHeight: m(ceilingMetres) }),
    doors: width > doorWidth + m(0.2) ? [{ id: 'door-1', wall: 'south', offset: Math.round((width - doorWidth) / 2), width: doorWidth }] : [],
    columns: [],
  }, pack);
}

/** An empty rectangular hall with one door in the middle of the south wall. */
export function newHall(name: string, widthMetres: number, depthMetres: number, ceilingMetres?: number): Project {
  return newRoom(name, widthMetres, depthMetres, ceilingMetres, 'hall');
}

/** The 10 × 8 m reference hall: door on the south wall, a column in the middle, 3 m ceiling. */
export function demoHall(): Project {
  return roomProject('قاعة تجريبية ١٠×٨ م', {
    width: m(10),
    depth: m(8),
    ceilingHeight: m(3),
    doors: [{ id: 'door-1', wall: 'south', offset: m(1), width: cm(90) }],
    columns: [{ id: 'column-1', center: { x: m(5), y: m(4) }, width: cm(40), depth: cm(40) }],
  });
}

import { packOf, type PackId } from './packs.js';
import { STARTER_CATALOG } from './hallCatalog.js';

export { STARTER_CATALOG } from './hallCatalog.js';
export * from './rules.js';
export * from './office.js';
export * from './packs.js';
export * from './hall.js';
