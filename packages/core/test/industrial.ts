import { createProject, createSpace, fromUnit, rectangleBoundary, type ItemDefinition, type ItemInstance, type Project } from '../src/index.js';

const cm = (v: number) => fromUnit(v, 'cm');

/** A pallet position: 120 × 100 cm, with 10 cm of handling space in front. */
export const pallet: ItemDefinition = {
  id: 'pallet',
  name: 'Pallet',
  category: 'box',
  size: { w: cm(120), d: cm(100), h: cm(150) },
  clearance: { front: cm(10), back: 0, left: 0, right: 0 },
};

/**
 * A warehouse floor with `count` pallets in rows of 50, 5 cm apart, and every 37th pallet nudged
 * into its neighbour so the checks have real work (overlaps and clearance hits).
 */
export function palletFloor(count: number): Project {
  const perRow = 50;
  const rows = Math.ceil(count / perRow);
  const pitchX = cm(125);
  const pitchY = cm(130);
  const width = perRow * pitchX + cm(200);
  const depth = rows * pitchY + cm(200);
  const items: Record<string, ItemInstance> = {};
  for (let i = 0; i < count; i++) {
    const id = `p-${String(i).padStart(6, '0')}`;
    const nudge = i % 37 === 0 ? cm(30) : 0;
    items[id] = {
      id,
      definitionId: pallet.id,
      position: { x: cm(100) + (i % perRow) * pitchX + cm(60) + nudge, y: cm(100) + Math.floor(i / perRow) * pitchY + cm(50) },
      rotation: 0,
      locked: false,
    };
  }
  const base = createProject('bench', 'Bench', createSpace(rectangleBoundary(width, depth), { ceilingHeight: cm(1200) }));
  return { ...base, catalog: { [pallet.id]: pallet }, items };
}
