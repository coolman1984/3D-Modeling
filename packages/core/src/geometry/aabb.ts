import type { Vec2 } from './vec2.js';

/** Axis-aligned bounding box, used to discard far-apart pairs cheaply. */
export interface Aabb {
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
}

export function boundsOf(points: readonly Vec2[]): Aabb {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of points) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }
  return { minX, minY, maxX, maxY };
}

/** True when the boxes are closer than `margin` (touching counts when margin > 0). */
export function aabbsWithin(a: Aabb, b: Aabb, margin = 0): boolean {
  return (
    a.minX - margin <= b.maxX && b.minX - margin <= a.maxX && a.minY - margin <= b.maxY && b.minY - margin <= a.maxY
  );
}
