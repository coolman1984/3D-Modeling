import { toCounterClockwise } from '../geometry/polygon.js';
import type { Vec2 } from '../geometry/vec2.js';
import type { Tick } from '../units/length.js';
import { SCHEMA_VERSION, type Id, type ItemClearance, type Project, type Space } from './types.js';

export const NO_CLEARANCE: ItemClearance = { front: 0, back: 0, left: 0, right: 0 };

/** Axis-aligned rectangle with its lower-left corner at the origin, counter-clockwise. */
export function rectangleBoundary(width: Tick, depth: Tick): Vec2[] {
  return [
    { x: 0, y: 0 },
    { x: width, y: 0 },
    { x: width, y: depth },
    { x: 0, y: depth },
  ];
}

export function createSpace(boundary: readonly Vec2[], extra: Partial<Omit<Space, 'boundary'>> = {}): Space {
  return {
    boundary: toCounterClockwise(boundary),
    obstacles: (extra.obstacles ?? []).map((o) => ({ ...o, polygon: toCounterClockwise(o.polygon) })),
    doors: extra.doors ?? [],
    ...(extra.ceilingHeight === undefined ? {} : { ceilingHeight: extra.ceilingHeight }),
    ...(extra.meta === undefined ? {} : { meta: extra.meta }),
  };
}

/** An empty project at revision 0. The result is not validated; run `validateProject` on untrusted input. */
export function createProject(id: Id, name: string, space: Space): Project {
  return { schemaVersion: SCHEMA_VERSION, id, name, revision: 0, space, catalog: {}, items: {} };
}
