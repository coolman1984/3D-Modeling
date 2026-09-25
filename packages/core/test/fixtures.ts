import {
  createProject,
  createSpace,
  fromUnit,
  rectangleBoundary,
  type ItemDefinition,
  type ItemInstance,
  type Project,
} from '../src/index.js';

export const m = (value: number): number => fromUnit(value, 'm');
export const cm = (value: number): number => fromUnit(value, 'cm');

export const table: ItemDefinition = {
  id: 'def-table',
  name: 'Banquet table 180 × 80',
  category: 'table',
  size: { w: cm(180), d: cm(80), h: cm(75) },
  // Walking space at both ends; the long sides are where chairs go.
  clearance: { front: 0, back: 0, left: cm(60), right: cm(60) },
};

export const chair: ItemDefinition = {
  id: 'def-chair',
  name: 'Chair',
  category: 'seat',
  size: { w: cm(45), d: cm(45), h: cm(90) },
  clearance: { front: 0, back: cm(40), left: 0, right: 0 },
  seats: 1,
};

export function place(id: string, definitionId: string, x: number, y: number, rotation = 0): ItemInstance {
  return { id, definitionId, position: { x, y }, rotation, locked: false };
}

/**
 * Reference hall: 10 m × 8 m, one 90 cm door on the south wall at x = 1 m
 * opening inward (leaf closed pointing east, swinging north), one 40 × 40 cm column
 * centred at (5 m, 4 m), ceiling 3 m. Empty catalog and no items.
 */
export function referenceHall(): Project {
  return createProject(
    'hall-1',
    'Reference hall',
    createSpace(rectangleBoundary(m(10), m(8)), {
      doors: [{ id: 'door-1', hinge: { x: m(1), y: 0 }, width: cm(90), angle: 0, swing: 'left' }],
      obstacles: [
        {
          id: 'col-1',
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
    }),
  );
}

/** Reference hall with a table and four chairs around it. Designed to have no design issues. */
export function furnishedHall(): Project {
  const hall = referenceHall();
  return {
    ...hall,
    catalog: { [table.id]: table, [chair.id]: chair },
    items: Object.fromEntries(
      [
        place('t1', 'def-table', m(3), m(6)),
        place('c1', 'def-chair', m(2.5), m(6.7), 180_000),
        place('c2', 'def-chair', m(3.5), m(6.7), 180_000),
        place('c3', 'def-chair', m(2.5), m(5.3)),
        place('c4', 'def-chair', m(3.5), m(5.3)),
      ].map((item) => [item.id, item]),
    ),
  };
}
