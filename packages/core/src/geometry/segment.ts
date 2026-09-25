import { cross, dot, distance, sub, type Vec2 } from './vec2.js';

/** Sign of the turn a→b→c: 1 counter-clockwise, -1 clockwise, 0 collinear. */
export function orientation(a: Vec2, b: Vec2, c: Vec2): -1 | 0 | 1 {
  const value = cross(sub(b, a), sub(c, a));
  return value > 0 ? 1 : value < 0 ? -1 : 0;
}

export function pointSegmentDistance(p: Vec2, a: Vec2, b: Vec2): number {
  const ab = sub(b, a);
  const lengthSquared = dot(ab, ab);
  if (lengthSquared === 0) return distance(p, a);
  const t = Math.max(0, Math.min(1, dot(sub(p, a), ab) / lengthSquared));
  return distance(p, { x: a.x + ab.x * t, y: a.y + ab.y * t });
}

/** True when the segments cross at a single interior point of both (touching endpoints does not count). */
export function segmentsCrossProperly(a: Vec2, b: Vec2, c: Vec2, d: Vec2): boolean {
  const o1 = orientation(a, b, c);
  const o2 = orientation(a, b, d);
  const o3 = orientation(c, d, a);
  const o4 = orientation(c, d, b);
  return o1 !== 0 && o2 !== 0 && o3 !== 0 && o4 !== 0 && o1 !== o2 && o3 !== o4;
}

function onSegment(p: Vec2, a: Vec2, b: Vec2): boolean {
  return (
    orientation(a, b, p) === 0 &&
    Math.min(a.x, b.x) <= p.x &&
    p.x <= Math.max(a.x, b.x) &&
    Math.min(a.y, b.y) <= p.y &&
    p.y <= Math.max(a.y, b.y)
  );
}

/** True when the closed segments share any point, including touching and collinear overlap. */
export function segmentsIntersect(a: Vec2, b: Vec2, c: Vec2, d: Vec2): boolean {
  if (segmentsCrossProperly(a, b, c, d)) return true;
  return onSegment(c, a, b) || onSegment(d, a, b) || onSegment(a, c, d) || onSegment(b, c, d);
}

export function segmentSegmentDistance(a: Vec2, b: Vec2, c: Vec2, d: Vec2): number {
  if (segmentsIntersect(a, b, c, d)) return 0;
  return Math.min(
    pointSegmentDistance(a, c, d),
    pointSegmentDistance(b, c, d),
    pointSegmentDistance(c, a, b),
    pointSegmentDistance(d, a, b),
  );
}
