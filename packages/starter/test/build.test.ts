import { checkProject, detectRooms, toSquareMetres } from '@space-planner/core';
import { describe, expect, it } from 'vitest';
import { buildFlat, FlatError, roomKindOf, type FlatSpec } from '../src/index.js';
import { SPEC } from './flatSpec.js';


const areas = (spec: FlatSpec) => detectRooms(buildFlat(spec).space).map((r) => Math.round(toSquareMetres(r.area) * 100) / 100);

describe('a flat from its measurements', () => {
  it('derives each wall once: shared edges are partitions, the rest outer walls', () => {
    const flat = buildFlat(SPEC);
    const walls = flat.space.walls!;
    const thick = walls.filter((w) => w.thickness === 2_000).length;
    const thin = walls.filter((w) => w.thickness === 1_000).length;
    expect(thick + thin).toBe(walls.length);
    expect(thin).toBeGreaterThanOrEqual(4);
    // Outside 12.20 × 9.20 m; the plan starts at the outside south-west corner.
    expect(flat.space.boundary).toEqual([{ x: 0, y: 0 }, { x: 122_000, y: 0 }, { x: 122_000, y: 92_000 }, { x: 0, y: 92_000 }]);
    expect(checkProject(flat).filter((i) => i.severity === 'error')).toEqual([]);
  });

  it('gives the rooms their areas inside the walls (hand-computed)', () => {
    // Living 11.80 × 4.85 (0.10 outer, 0.05 partition) = 57.23; bedrooms 4.50 × 3.85 = 17.33;
    // hall 2.60 × 0.90 = 2.34; bath 2.60 × 2.85 = 7.41.
    expect(areas(SPEC)).toEqual([57.23, 17.33, 2.34, 17.33, 7.41]);
  });

  it('puts doors in the shared walls, opening into the private room; the entrance and windows in outer walls', () => {
    const flat = buildFlat(SPEC);
    const o = (id: string) => flat.space.openings!.find((x) => x.id === id)!;
    expect(o('door-1')).toMatchObject({ kind: 'door', width: 12_000 });
    // Hall → bath: the wall runs east along y = 6 m; the bath is north, its left.
    expect(o('door-3')).toMatchObject({ side: 'left', width: 8_000 });
    expect(o('front-door')).toMatchObject({ kind: 'door', width: 9_000, side: 'left', meta: { role: 'entrance' } });
    expect(flat.space.openings!.filter((x) => x.kind === 'window')).toHaveLength(3);
    expect(flat.space.zones!.map((z) => [z.meta?.label, z.kind])).toEqual([['Living', 'living'], ['Main bedroom', 'bedroom'], ['Hall', 'hall'], ['Bath', 'bathroom'], ['Bedroom 2', 'bedroom']]);
  });

  it('says plainly what does not hold together', () => {
    const bad = (patch: Partial<FlatSpec>) => () => buildFlat({ ...SPEC, ...patch });
    expect(bad({ rooms: [...SPEC.rooms, { name: 'Store', x: 1, y: 1, width: 2, depth: 2 }] })).toThrow(/overlap/);
    expect(bad({ doors: [{ between: ['Living', 'Bath'] }] })).toThrow(/do not share a wall/);
    expect(bad({ doors: [{ between: ['Living', 'Garage'] }] })).toThrow(/no room called "Garage"/);
    expect(bad({ windows: [{ room: 'Bath', side: 'south' }] })).toThrow(/inside wall/);
    expect(bad({ windows: [{ room: 'Living', side: 'south', width: 13 }] })).toThrow(FlatError);
  });

  it('refuses a side that is not a side, a measuring slip between rooms, a corner-only door, an impossible ceiling', () => {
    const one = (patch: Partial<FlatSpec>) => () => buildFlat({ name: 'x', rooms: [{ name: 'Living', x: 0, y: 0, width: 5, depth: 4 }], ...patch });
    expect(one({ entrance: { room: 'Living', side: 'up' as 'south' } })).toThrow(/must be south, north, west or east/);
    expect(one({ windows: [{ room: 'Living', side: 'top' as 'south' }] })).toThrow(/must be south/);
    expect(one({ ceiling: 0 })).toThrow(/between 1.8 and 10 m/);
    const two = (b: { x: number; y: number }, doors?: FlatSpec['doors']) => () => buildFlat({ name: 'x', rooms: [{ name: 'A', x: 0, y: 0, width: 3, depth: 3 }, { name: 'B', ...b, width: 3, depth: 3 }], ...(doors ? { doors } : {}) });
    expect(two({ x: 3.01, y: 0 })).toThrow(/1 cm apart: make them touch/);
    expect(two({ x: 3.4, y: 0 })).not.toThrow(); // 40 cm: two outer walls side by side
    expect(two({ x: 3, y: 3 }, [{ between: ['A', 'B'] }])).toThrow(/only touch at a corner/);
  });

  it('puts a window where it is free when no position is given, and names what clashes by room', () => {
    const base: FlatSpec = { name: 'x', rooms: [{ name: 'Living', x: 0, y: 0, width: 5, depth: 4 }], entrance: { room: 'Living', side: 'south', at: 1.8 } };
    // The default window is 1.2 m, centred at 2.5 m: it would clash with the entrance (1.8–2.7 m), so it slides along.
    const flat = buildFlat({ ...base, windows: [{ room: 'Living', side: 'south' }] });
    const door = flat.space.openings!.find((o) => o.id === 'front-door')!;
    const window = flat.space.openings!.find((o) => o.id === 'window-1')!;
    expect(door.wall).toBe(window.wall);
    expect(window.offset >= door.offset + door.width || window.offset + window.width <= door.offset).toBe(true);
    // Told exactly where: the clash is named by rooms, not ids.
    expect(() => buildFlat({ ...base, windows: [{ room: 'Living', side: 'south', at: 2 }] })).toThrow(/the entrance and the window in "Living" overlap/);
  });

  it('reads room kinds from English and Arabic names', () => {
    expect(['Master bedroom', 'غرفة نوم', 'WC', 'حمام', 'Reception', 'صالة', 'المطبخ', 'Store'].map(roomKindOf)).toEqual(['bedroom', 'bedroom', 'bathroom', 'bathroom', 'living', 'living', 'kitchen', 'room']);
  });

  it('an L-shaped flat counts only its rooms', () => {
    const L = buildFlat({ name: 'L', rooms: [{ name: 'Living', x: 0, y: 0, width: 6, depth: 4 }, { name: 'Bedroom', x: 0, y: 4, width: 3.5, depth: 3.5 }] });
    // Living x 0.10–5.90: 3.85 deep under the partition (to x 3.45, where the outer wall starts) and
    // 3.80 under the 20 cm outer wall beyond: 3.35 × 3.85 + 2.45 × 3.80 = 22.21. Bedroom 3.30 × 3.35
    // = 11.06. The corner beside the bedroom is outside the flat.
    expect(detectRooms(L.space).map((r) => Math.round(toSquareMetres(r.area) * 100) / 100)).toEqual([22.21, 11.06]);
  });
});
