import { TOLERANCE } from '../units/length.js';
import { pointSegmentDistance, segmentSegmentDistance, segmentsCrossProperly, segmentsIntersect } from './segment.js';
import { cross, dot, sub, type Vec2 } from './vec2.js';

/** A closed polygon; the last vertex connects back to the first. */
export type Polygon = readonly Vec2[];

export function edges(polygon: Polygon): Array<readonly [Vec2, Vec2]> {
  return polygon.map((p, i) => [p, polygon[(i + 1) % polygon.length]!] as const);
}

/** Positive for counter-clockwise polygons (shoelace formula). */
export function signedArea(polygon: Polygon): number {
  let twice = 0;
  for (const [a, b] of edges(polygon)) twice += a.x * b.y - b.x * a.y;
  return twice / 2;
}

export function area(polygon: Polygon): number {
  return Math.abs(signedArea(polygon));
}

export function isCounterClockwise(polygon: Polygon): boolean {
  return signedArea(polygon) > 0;
}

export function toCounterClockwise(polygon: Polygon): Polygon {
  return isCounterClockwise(polygon) ? polygon : [...polygon].reverse();
}

/** At least 3 vertices, non-zero area, no zero-length edges, no edges touching except neighbours at their shared vertex. */
export function isSimple(polygon: Polygon): boolean {
  const n = polygon.length;
  if (n < 3 || signedArea(polygon) === 0) return false;
  const es = edges(polygon);
  for (const [a, b] of es) if (a.x === b.x && a.y === b.y) return false;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const [a, b] = es[i]!;
      const [c, d] = es[j]!;
      const adjacent = j === i + 1 || (i === 0 && j === n - 1);
      if (adjacent) {
        // Neighbours share one vertex; they must not fold back along each other.
        const [shared, p, q] = j === i + 1 ? [b, a, d] : [a, b, c];
        const u = sub(p, shared);
        const v = sub(q, shared);
        if (cross(u, v) === 0 && dot(u, v) > 0) return false;
      } else if (segmentsIntersect(a, b, c, d)) {
        return false;
      }
    }
  }
  return true;
}

export function isConvex(polygon: Polygon): boolean {
  let sign = 0;
  const n = polygon.length;
  for (let i = 0; i < n; i++) {
    const a = polygon[i]!;
    const b = polygon[(i + 1) % n]!;
    const c = polygon[(i + 2) % n]!;
    const turn = cross(sub(b, a), sub(c, b));
    if (turn !== 0) {
      if (sign !== 0 && Math.sign(turn) !== sign) return false;
      sign = Math.sign(turn);
    }
  }
  return sign !== 0;
}

export type PointLocation = 'inside' | 'boundary' | 'outside';

/** Locate a point; anything within `tolerance` of an edge is on the boundary. */
export function locatePoint(polygon: Polygon, p: Vec2, tolerance: number = TOLERANCE): PointLocation {
  let inside = false;
  for (const [a, b] of edges(polygon)) {
    if (pointSegmentDistance(p, a, b) <= tolerance) return 'boundary';
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside ? 'inside' : 'outside';
}

/**
 * True when `inner` lies within `outer` (touching the boundary allowed).
 * Works for concave `outer`: besides vertex tests it rejects edge crossings and
 * `outer` corners poking into `inner`.
 */
export function containsPolygon(outer: Polygon, inner: Polygon, tolerance: number = TOLERANCE): boolean {
  if (inner.some((p) => locatePoint(outer, p, tolerance) === 'outside')) return false;
  if (outer.some((p) => locatePoint(inner, p, tolerance) === 'inside')) return false;
  for (const [a, b] of edges(inner)) {
    for (const [c, d] of edges(outer)) {
      if (segmentsCrossProperly(a, b, c, d) && nearestEndpointGap(a, b, c, d) > tolerance) return false;
    }
  }
  return true;
}

/** How far the crossing point is from the nearest endpoint; tiny crossings near corners are treated as touching. */
function nearestEndpointGap(a: Vec2, b: Vec2, c: Vec2, d: Vec2): number {
  return Math.min(
    pointSegmentDistance(a, c, d),
    pointSegmentDistance(b, c, d),
    pointSegmentDistance(c, a, b),
    pointSegmentDistance(d, a, b),
  );
}

/** Shortest distance between polygon boundaries, 0 when they touch or overlap. */
export function polygonDistance(a: Polygon, b: Polygon): number {
  if (locatePoint(a, b[0]!, 0) !== 'outside' || locatePoint(b, a[0]!, 0) !== 'outside') return 0;
  let best = Infinity;
  for (const [p, q] of edges(a)) {
    for (const [r, s] of edges(b)) {
      best = Math.min(best, segmentSegmentDistance(p, q, r, s));
      if (best === 0) return 0;
    }
  }
  return best;
}
