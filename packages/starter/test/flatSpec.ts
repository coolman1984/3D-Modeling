import type { FlatSpec } from '../src/index.js';

// A two-bedroom on wall centre lines, 12 × 9 m: living across the south, a hall between the two
// bedrooms, the bath north of the hall.
export const SPEC: FlatSpec = {
  name: 'Client flat',
  rooms: [
    { name: 'Living', x: 0, y: 0, width: 12, depth: 5 },
    { name: 'Main bedroom', x: 0, y: 5, width: 4.65, depth: 4 },
    { name: 'Hall', x: 4.65, y: 5, width: 2.7, depth: 1 },
    { name: 'Bath', x: 4.65, y: 6, width: 2.7, depth: 3 },
    { name: 'Bedroom 2', x: 7.35, y: 5, width: 4.65, depth: 4 },
  ],
  doors: [
    { between: ['Living', 'Hall'], width: 1.2, at: 0.75 },
    { between: ['Hall', 'Main bedroom'], width: 0.8, at: 0.1 },
    { between: ['Hall', 'Bath'], at: 0.95 },
    { between: ['Hall', 'Bedroom 2'], width: 0.8, at: 0.1 },
  ],
  entrance: { room: 'Living', side: 'south' },
  windows: [
    { room: 'Main bedroom', side: 'north' },
    { room: 'Bedroom 2', side: 'north', width: 1.5 },
    { room: 'Living', side: 'west', width: 2 },
  ],
};
