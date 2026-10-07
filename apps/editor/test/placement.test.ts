import { apply, checkProject, fromUnit, type Project } from '@space-planner/core';
import { newHome } from '@space-planner/starter';
import { describe, expect, it } from 'vitest';
import { wallPlacement } from '../src/logic/placement.js';

const m = (v: number) => fromUnit(v, 'm');
const cm = (v: number) => fromUnit(v, 'cm');

// A 4 × 3 m room. The 90 × 60 print is 4 cm deep and hangs at 130 cm, so it sits 2 cm + 1 mm off the wall.
const room = newHome('Room', 4, 3);
const art = room.catalog['home-art-90']!;
const off = cm(2) + 10;

describe('hanging wall pieces', () => {
  it('goes on the nearest wall, facing into the room, at its own height', () => {
    expect(wallPlacement(room, art, { x: m(3.2), y: m(0.3) })).toEqual({ position: { x: m(3.2), y: off }, rotation: 0, elevation: cm(130) });
    expect(wallPlacement(room, art, { x: m(3.8), y: m(1.5) })).toEqual({ position: { x: m(4) - off, y: m(1.5) }, rotation: 90_000, elevation: cm(130) });
    expect(wallPlacement(room, art, { x: m(1), y: m(2.9) })).toEqual({ position: { x: m(1), y: m(3) - off }, rotation: 180_000, elevation: cm(130) });
    expect(wallPlacement(room, art, { x: m(0.1), y: m(1.2) })).toEqual({ position: { x: off, y: m(1.2) }, rotation: 270_000, elevation: cm(130) });
  });

  it('stays within the wall: a spot in the corner slides along until the piece fits', () => {
    expect(wallPlacement(room, art, { x: m(0.1), y: m(0.05) })?.position).toEqual({ x: cm(45), y: off });
  });

  it('keeps clear of the door: the front door spans x 1.55–2.45 m, so the print slides to 1.1 m', () => {
    // From x = 2 m, both clear centres (1.1 and 2.9 m) are 0.9 m away; the nearer the wall's start wins.
    expect(wallPlacement(room, art, { x: m(2), y: m(0.3) })?.position).toEqual({ x: m(1.1), y: off });
  });

  it('hangs on a partition when that is the nearer wall, on the side of the spot', () => {
    const wall: Project = { ...room, items: { w1: { id: 'w1', definitionId: 'home-wall-200', position: { x: m(2), y: m(1.5) }, rotation: 0, locked: false } } };
    // The partition runs x 1–3 m at y = 1.5 m, 10 cm thick: its north face is at y = 1.55 m.
    const placed = wallPlacement(wall, art, { x: m(2.2), y: m(1.8) })!;
    expect(placed).toEqual({ position: { x: m(2.2), y: m(1.55) + off }, rotation: 0, elevation: cm(130) });
    const south = wallPlacement(wall, art, { x: m(2.2), y: m(1.2) })!;
    expect(south.rotation).toBe(180_000);
    expect(south.position.y).toBe(m(1.45) - off);
  });

  it('leaves floor pieces alone, and a hung piece raises no issue', () => {
    expect(wallPlacement(room, room.catalog['home-sofa-linen']!, { x: m(2), y: m(0.3) })).toBeUndefined();
    const spot = wallPlacement(room, art, { x: m(2), y: m(0.3) })!; // slid off the door
    const outcome = apply(room, { type: 'item.add', item: { id: 'a1', definitionId: art.id, position: spot.position, rotation: spot.rotation, elevation: spot.elevation, locked: false } });
    expect(outcome.ok && checkProject(outcome.project)).toEqual([]);
  });
});
