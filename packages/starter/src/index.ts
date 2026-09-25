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
const none = { front: 0, back: 0, left: 0, right: 0 };

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
  { key: 'box', label: 'صندوق عام' },
] as const;

export type ShapeKey = (typeof SHAPES)[number]['key'];

/** Shapes whose floor outline is round rather than rectangular. */
export const ROUND_SHAPES: readonly ShapeKey[] = ['round-table', 'plant'];

export function shapeOf(category: string): ShapeKey {
  return SHAPES.some((s) => s.key === category) ? (category as ShapeKey) : 'box';
}

/** Starter catalog for new projects. Companies and activity packs will bring their own. */
export const STARTER_CATALOG: readonly ItemDefinition[] = [
  {
    id: 'table-180',
    name: 'ترابيزة ١٨٠×٨٠',
    category: 'table',
    size: { w: cm(180), d: cm(80), h: cm(75) },
    clearance: { ...none, left: cm(60), right: cm(60) },
  },
  {
    id: 'table-80',
    name: 'ترابيزة مربعة ٨٠',
    category: 'table',
    size: { w: cm(80), d: cm(80), h: cm(75) },
    clearance: none,
  },
  {
    id: 'round-150',
    name: 'ترابيزة مدورة ١٥٠',
    category: 'round-table',
    size: { w: cm(150), d: cm(150), h: cm(75) },
    clearance: none,
    footprint: 'round',
  },
  {
    id: 'chair',
    name: 'كرسي',
    category: 'chair',
    size: { w: cm(45), d: cm(45), h: cm(90) },
    clearance: { ...none, back: cm(40) },
    seats: 1,
  },
  {
    id: 'buffet',
    name: 'بوفيه ٢٤٠×٧٥',
    category: 'counter',
    size: { w: cm(240), d: cm(75), h: cm(90) },
    clearance: { ...none, front: cm(120) },
  },
  {
    id: 'stage',
    name: 'مسرح ٤×٢ م',
    category: 'stage',
    size: { w: m(4), d: m(2), h: cm(60) },
    clearance: { ...none, front: m(1.5) },
  },
  {
    id: 'sofa',
    name: 'كنبة ٣ أفراد',
    category: 'sofa',
    size: { w: cm(210), d: cm(90), h: cm(85) },
    clearance: { ...none, front: cm(60) },
    seats: 3,
  },
  {
    id: 'plant',
    name: 'زرع',
    category: 'plant',
    size: { w: cm(50), d: cm(50), h: cm(150) },
    clearance: none,
    footprint: 'round',
  },
];

function withStarterCatalog(project: Project): Project {
  return { ...project, catalog: Object.fromEntries(STARTER_CATALOG.map((d) => [d.id, d])) };
}

export function roomProject(name: string, spec: RoomSpec): Project {
  return withStarterCatalog(createProject('new', name, roomSpace(spec)));
}

/** An empty rectangular hall with one door in the middle of the south wall. */
export function newHall(name: string, widthMetres: number, depthMetres: number, ceilingMetres?: number): Project {
  const doorWidth = cm(90);
  const width = m(widthMetres);
  return roomProject(name, {
    width,
    depth: m(depthMetres),
    ...(ceilingMetres === undefined ? {} : { ceilingHeight: m(ceilingMetres) }),
    doors: width > doorWidth + m(0.2) ? [{ id: 'door-1', wall: 'south', offset: Math.round((width - doorWidth) / 2), width: doorWidth }] : [],
    columns: [],
  });
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
