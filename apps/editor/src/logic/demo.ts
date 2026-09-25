import {
  createProject,
  createSpace,
  fromUnit,
  rectangleBoundary,
  type ItemDefinition,
  type Project,
} from '@space-planner/core';

const m = (v: number) => fromUnit(v, 'm');
const cm = (v: number) => fromUnit(v, 'cm');
const none = { front: 0, back: 0, left: 0, right: 0 };

/** Starter catalog for the demo. Real catalogs will come from activity packs and companies. */
export const DEMO_CATALOG: readonly ItemDefinition[] = [
  {
    id: 'table-180',
    name: 'ترابيزة ١٨٠×٨٠',
    category: 'ترابيزات',
    size: { w: cm(180), d: cm(80), h: cm(75) },
    clearance: { ...none, left: cm(60), right: cm(60) },
  },
  {
    id: 'table-80',
    name: 'ترابيزة مربعة ٨٠',
    category: 'ترابيزات',
    size: { w: cm(80), d: cm(80), h: cm(75) },
    clearance: none,
  },
  {
    id: 'chair',
    name: 'كرسي',
    category: 'كراسي',
    size: { w: cm(45), d: cm(45), h: cm(90) },
    clearance: { ...none, back: cm(40) },
    seats: 1,
  },
  {
    id: 'buffet',
    name: 'بوفيه ٢٤٠×٧٥',
    category: 'خدمة',
    size: { w: cm(240), d: cm(75), h: cm(90) },
    clearance: { ...none, front: cm(120) },
  },
  {
    id: 'stage',
    name: 'مسرح ٤×٢ م',
    category: 'مسرح',
    size: { w: m(4), d: m(2), h: cm(60) },
    clearance: { ...none, front: m(1.5) },
  },
];

/** An empty rectangular hall with the demo catalog. */
export function newHall(widthMetres: number, depthMetres: number, ceilingMetres?: number): Project {
  const space = createSpace(rectangleBoundary(m(widthMetres), m(depthMetres)), {
    ...(ceilingMetres === undefined ? {} : { ceilingHeight: m(ceilingMetres) }),
  });
  return withDemoCatalog(createProject('hall', 'قاعة جديدة', space));
}

/** The 10 × 8 m reference hall: door on the south wall, a column in the middle, 3 m ceiling. */
export function demoHall(): Project {
  const space = createSpace(rectangleBoundary(m(10), m(8)), {
    doors: [{ id: 'door-1', hinge: { x: m(1), y: 0 }, width: cm(90), angle: 0, swing: 'left' }],
    obstacles: [
      {
        id: 'column-1',
        kind: 'column',
        polygon: [
          { x: m(4.8), y: m(3.8) },
          { x: m(5.2), y: m(3.8) },
          { x: m(5.2), y: m(4.2) },
          { x: m(4.8), y: m(4.2) },
        ],
      },
    ],
    ceilingHeight: m(3),
  });
  return withDemoCatalog(createProject('hall', 'قاعة تجريبية ١٠×٨ م', space));
}

function withDemoCatalog(project: Project): Project {
  return { ...project, catalog: Object.fromEntries(DEMO_CATALOG.map((d) => [d.id, d])) };
}
