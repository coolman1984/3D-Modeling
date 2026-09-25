import { fromUnit, type ItemDefinition } from '@space-planner/core';

const m = (v: number) => fromUnit(v, 'm');
const cm = (v: number) => fromUnit(v, 'cm');
const none = { front: 0, back: 0, left: 0, right: 0 };

/**
 * Hall catalog for new projects: the common furniture of Egyptian event halls with real sizes.
 * Clearances are the room each item needs to be used (pulling a chair out, queueing at a buffet).
 * Ids are stable: saved projects and tests refer to them.
 */
export const STARTER_CATALOG: readonly ItemDefinition[] = [
  // Tables
  { id: 'round-120', name: 'Round table 120 · 6 seats', category: 'round-table', size: { w: cm(120), d: cm(120), h: cm(75) }, clearance: none, footprint: 'round' },
  { id: 'round-150', name: 'Round table 150', category: 'round-table', size: { w: cm(150), d: cm(150), h: cm(75) }, clearance: none, footprint: 'round' },
  { id: 'round-180', name: 'Round table 180 · 10 seats', category: 'round-table', size: { w: cm(180), d: cm(180), h: cm(75) }, clearance: none, footprint: 'round' },
  { id: 'table-180', name: 'Banquet table 180 × 80', category: 'table', size: { w: cm(180), d: cm(80), h: cm(75) }, clearance: { ...none, left: cm(60), right: cm(60) } },
  { id: 'table-240', name: 'Banquet table 240 × 80', category: 'table', size: { w: cm(240), d: cm(80), h: cm(75) }, clearance: { ...none, left: cm(60), right: cm(60) } },
  { id: 'table-80', name: 'Square table 80', category: 'table', size: { w: cm(80), d: cm(80), h: cm(75) }, clearance: none },
  { id: 'table-120', name: 'Classroom table 120 × 50', category: 'table', size: { w: cm(120), d: cm(50), h: cm(75) }, clearance: none },
  { id: 'cocktail-60', name: 'Cocktail table 60', category: 'round-table', size: { w: cm(60), d: cm(60), h: cm(110) }, clearance: none, footprint: 'round' },
  // Seats
  { id: 'chair', name: 'Banquet chair', category: 'chair', size: { w: cm(45), d: cm(45), h: cm(90) }, clearance: { ...none, back: cm(40) }, seats: 1 },
  { id: 'chiavari', name: 'Chiavari chair', category: 'chair', size: { w: cm(40), d: cm(45), h: cm(92) }, clearance: { ...none, back: cm(40) }, seats: 1 },
  { id: 'armchair', name: 'Armchair', category: 'sofa', size: { w: cm(80), d: cm(80), h: cm(85) }, clearance: { ...none, front: cm(50) }, seats: 1 },
  { id: 'loveseat', name: 'Loveseat', category: 'sofa', size: { w: cm(150), d: cm(85), h: cm(85) }, clearance: { ...none, front: cm(60) }, seats: 2 },
  { id: 'sofa', name: 'Sofa · 3 seats', category: 'sofa', size: { w: cm(210), d: cm(90), h: cm(85) }, clearance: { ...none, front: cm(60) }, seats: 3 },
  // Stage and focal points
  { id: 'kosha', name: 'Bridal stage 3 × 2 m', category: 'stage', size: { w: m(3), d: m(2), h: cm(40) }, clearance: { ...none, front: m(1.5) }, seats: 2 },
  { id: 'stage', name: 'Stage 4 × 2 m', category: 'stage', size: { w: m(4), d: m(2), h: cm(60) }, clearance: { ...none, front: m(1.5) } },
  { id: 'stage-6x3', name: 'Stage 6 × 3 m', category: 'stage', size: { w: m(6), d: m(3), h: cm(60) }, clearance: { ...none, front: m(2) } },
  { id: 'dance-floor', name: 'Dance floor 5 × 5 m', category: 'dance-floor', size: { w: m(5), d: m(5), h: cm(2) }, clearance: none },
  { id: 'dj', name: 'DJ booth', category: 'counter', size: { w: cm(180), d: cm(75), h: cm(100) }, clearance: { ...none, back: cm(80) } },
  { id: 'screen', name: 'Projection screen 3 m', category: 'box', size: { w: m(3), d: cm(50), h: m(2.5) }, clearance: { ...none, front: m(2) } },
  { id: 'lectern', name: 'Lectern', category: 'desk', size: { w: cm(60), d: cm(50), h: cm(115) }, clearance: { ...none, back: cm(80) } },
  { id: 'backdrop', name: 'Photo backdrop 3 m', category: 'box', size: { w: m(3), d: cm(30), h: m(2.5) }, clearance: { ...none, front: m(2) } },
  // Service
  { id: 'buffet', name: 'Buffet 240 × 75', category: 'counter', size: { w: cm(240), d: cm(75), h: cm(90) }, clearance: { ...none, front: cm(120) } },
  { id: 'buffet-hot', name: 'Hot buffet 300 × 90', category: 'counter', size: { w: cm(300), d: cm(90), h: cm(90) }, clearance: { ...none, front: cm(150), back: cm(80) } },
  { id: 'bar', name: 'Drinks bar 200 × 60', category: 'counter', size: { w: cm(200), d: cm(60), h: cm(110) }, clearance: { ...none, front: cm(120), back: cm(80) } },
  { id: 'cake-table', name: 'Cake table', category: 'round-table', size: { w: cm(90), d: cm(90), h: cm(75) }, clearance: { front: cm(100), back: 0, left: 0, right: 0 }, footprint: 'round' },
  { id: 'reception', name: 'Reception desk', category: 'desk', size: { w: cm(150), d: cm(60), h: cm(75) }, clearance: { ...none, front: cm(100), back: cm(80) } },
  { id: 'gift-table', name: 'Gift table', category: 'table', size: { w: cm(120), d: cm(60), h: cm(75) }, clearance: { ...none, front: cm(80) } },
  { id: 'speaker', name: 'Speaker on stand', category: 'box', size: { w: cm(50), d: cm(50), h: cm(180) }, clearance: none },
  { id: 'plant', name: 'Plant', category: 'plant', size: { w: cm(50), d: cm(50), h: cm(150) }, clearance: none, footprint: 'round' },
];

