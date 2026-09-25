import { TOLERANCE } from '../units/length.js';
import { edges, isConvex, locatePoint, signedArea, type Polygon } from './polygon.js';
import { convexOverlap } from './sat.js';
import { segmentsCrossProperly } from './segment.js';
import { cross, sub, type Vec2 } from './vec2.js';

/**
 * Intersection of two convex counter-clockwise polygons (Sutherland–Hodgman).
 * Returns an empty array when they do not overlap.
 */
export function clipConvex(subject: Polygon, clip: Polygon): Vec2[] {
  let output: Vec2[] = [...subject];
  for (const [a, b] of edges(clip)) {
    if (output.length === 0) break;
    const input = output;
    output = [];
    const inside = (p: Vec2) => cross(sub(b, a), sub(p, a)) >= 0;
    for (const [p, q] of edges(input)) {
      const pIn = inside(p);
      const qIn = inside(q);
      if (pIn) output.push(p);
      if (pIn !== qIn) output.push(lineIntersection(p, q, a, b));
    }
  }
  return output.length >= 3 && Math.abs(signedArea(output)) > 0 ? output : [];
}

function lineIntersection(p: Vec2, q: Vec2, a: Vec2, b: Vec2): Vec2 {
  const r = sub(q, p);
  const s = sub(b, a);
  const t = cross(sub(a, p), s) / cross(r, s);
  return { x: p.x + r.x * t, y: p.y + r.y * t };
}

/**
 * True when two simple polygons interpenetrate by more than the tolerance.
 * Convex pairs use the separating-axis test; otherwise edges crossing or a
 * vertex lying clearly inside the other shape counts as overlap.
 */
export function polygonsOverlap(a: Polygon, b: Polygon, tolerance: number = TOLERANCE): boolean {
  if (isConvex(a) && isConvex(b)) return convexOverlap(a, b, tolerance).overlaps;
  if (a.some((p) => locatePoint(b, p, tolerance) === 'inside')) return true;
  if (b.some((p) => locatePoint(a, p, tolerance) === 'inside')) return true;
  for (const [p, q] of edges(a)) {
    for (const [r, s] of edges(b)) if (segmentsCrossProperly(p, q, r, s)) return true;
  }
  return false;
}
