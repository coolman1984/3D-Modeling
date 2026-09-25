import { TOLERANCE } from '../units/length.js';
import { edges, type Polygon } from './polygon.js';
import { dot, length, type Vec2 } from './vec2.js';

export interface ConvexOverlap {
  /** True when the polygons interpenetrate by more than the tolerance. Touching is not overlapping. */
  readonly overlaps: boolean;
  /** Smallest push (in ticks) that would separate them; 0 when they are apart or only touching. */
  readonly depth: number;
}

function project(polygon: Polygon, axis: Vec2): [number, number] {
  let min = Infinity;
  let max = -Infinity;
  for (const p of polygon) {
    const value = dot(p, axis);
    min = Math.min(min, value);
    max = Math.max(max, value);
  }
  return [min, max];
}

/** Separating-axis test for two convex polygons. */
export function convexOverlap(a: Polygon, b: Polygon, tolerance: number = TOLERANCE): ConvexOverlap {
  let depth = Infinity;
  for (const polygon of [a, b]) {
    for (const [p, q] of edges(polygon)) {
      const edgeLength = length({ x: q.x - p.x, y: q.y - p.y });
      if (edgeLength === 0) continue;
      const axis = { x: -(q.y - p.y) / edgeLength, y: (q.x - p.x) / edgeLength };
      const [minA, maxA] = project(a, axis);
      const [minB, maxB] = project(b, axis);
      const overlap = Math.min(maxA, maxB) - Math.max(minA, minB);
      if (overlap <= tolerance) return { overlaps: false, depth: 0 };
      depth = Math.min(depth, overlap);
    }
  }
  return { overlaps: true, depth };
}
