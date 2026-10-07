import { apply, checkProject, fromUnit, type Project } from '@space-planner/core';
import { newHome } from '@space-planner/starter';
import { describe, expect, it } from 'vitest';
import { wallPlacement } from '../src/logic/placement.js';

const m = (v: number) => fromUnit(v, 'm');
const cm = (v: number) => fromUnit(v, 'cm');

// A 4 × 3 m room inside 20 cm outer walls: the inside runs x 0.2–4.2 m, y 0.2–3.2 m.
// The 90 × 60 print is 4 cm deep and hangs at 130 cm, so it sits 2 cm + 1 mm off the wall face.
const room = newHome('Room', 4, 3);
const art = room.catalog['home-art-90']!;
const I = m(0.2);
const off = cm(2) + 10;
const at = (x: number, y: number) => ({ x: I + m(x), y: I + m(y) });

describe('hanging wall pieces', () => {
  it('goes on the nearest wall, facing into the room, at its own height', () => {
    expect(wallPlacement(room, art, at(3.2, 0.3))).toEqual({ position: { x: I + m(3.2), y: I + off }, rotation: 0, elevation: cm(130) });
    expect(wallPlacement(room, art, at(3.8, 1.5))).toEqual({ position: { x: I + m(4) - off, y: I + m(1.5) }, rotation: 90_000, elevation: cm(130) });
    expect(wallPlacement(room, art, at(1, 2.9))).toEqual({ position: { x: I + m(1), y: I + m(3) - off }, rotation: 180_000, elevation: cm(130) });
    expect(wallPlacement(room, art, at(0.1, 1.2))).toEqual({ position: { x: I + off, y: I + m(1.2) }, rotation: 270_000, elevation: cm(130) });
  });

  it('stays within the wall: a spot in the corner slides along until the piece fits', () => {
    expect(wallPlacement(room, art, at(0.1, 0.05))?.position).toEqual({ x: I + cm(45), y: I + off });
  });

  it('keeps clear of the door: the front door spans 1.55–2.45 m along the inside, so the print slides to 1.1 m', () => {
    // From 2 m, both clear centres (1.1 and 2.9 m) are 0.9 m away; the nearer the wall's start wins.
    expect(wallPlacement(room, art, at(2, 0.3))?.position).toEqual({ x: I + m(1.1), y: I + off });
  });

  it('hangs on a partition when that is the nearer wall, on the side of the spot', () => {
    const partition = { id: 'w1', a: at(1, 1.5), b: at(3, 1.5), thickness: cm(10) };
    const wall: Project = { ...room, space: { ...room.space, walls: [...room.space.walls!, partition] } };
    // The partition runs 1–3 m at 1.5 m, 10 cm thick: its north face is at 1.55 m.
    const placed = wallPlacement(wall, art, at(2.2, 1.8))!;
    expect(placed).toEqual({ position: { x: I + m(2.2), y: I + m(1.55) + off }, rotation: 0, elevation: cm(130) });
    const south = wallPlacement(wall, art, at(2.2, 1.2))!;
    expect(south.rotation).toBe(180_000);
    expect(south.position.y).toBe(I + m(1.45) - off);
    // A partition placed as an item (older plans) still takes pieces.
    const old: Project = { ...room, catalog: { ...room.catalog, w: { id: 'w', name: 'Wall', category: 'wall', size: { w: m(2), d: cm(10), h: cm(270) }, clearance: { front: 0, back: 0, left: 0, right: 0 } } }, items: { w1: { id: 'w1', definitionId: 'w', position: at(2, 1.5), rotation: 0, locked: false } } };
    expect(wallPlacement(old, art, at(2.2, 1.8))?.position).toEqual({ x: I + m(2.2), y: I + m(1.55) + off });
  });

  it('leaves floor pieces alone, and a hung piece raises no issue', () => {
    expect(wallPlacement(room, room.catalog['home-sofa-linen']!, at(2, 0.3))).toBeUndefined();
    const spot = wallPlacement(room, art, at(2, 0.3))!; // slid off the door
    const outcome = apply(room, { type: 'item.add', item: { id: 'a1', definitionId: art.id, position: spot.position, rotation: spot.rotation, elevation: spot.elevation, locked: false } });
    expect(outcome.ok && checkProject(outcome.project)).toEqual([]);
  });
});
