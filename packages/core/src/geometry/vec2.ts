import { cosSin, type MilliDeg } from '../units/angle.js';

/**
 * A point or vector in the plan (X east, Y north).
 * Stored model points are integer ticks; derived points (rotated corners, arcs) may be fractional.
 */
export interface Vec2 {
  readonly x: number;
  readonly y: number;
}

export function vec(x: number, y: number): Vec2 {
  return { x, y };
}

export function add(a: Vec2, b: Vec2): Vec2 {
  return { x: a.x + b.x, y: a.y + b.y };
}

export function sub(a: Vec2, b: Vec2): Vec2 {
  return { x: a.x - b.x, y: a.y - b.y };
}

export function scale(a: Vec2, k: number): Vec2 {
  return { x: a.x * k, y: a.y * k };
}

export function dot(a: Vec2, b: Vec2): number {
  return a.x * b.x + a.y * b.y;
}

/** Z component of the 3D cross product; > 0 when b is counter-clockwise from a. */
export function cross(a: Vec2, b: Vec2): number {
  return a.x * b.y - a.y * b.x;
}

export function length(a: Vec2): number {
  return Math.hypot(a.x, a.y);
}

export function distance(a: Vec2, b: Vec2): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** Rotate `p` counter-clockwise by `angle` about `origin` (default: the world origin). */
export function rotate(p: Vec2, angle: MilliDeg, origin: Vec2 = { x: 0, y: 0 }): Vec2 {
  const [c, s] = cosSin(angle);
  const dx = p.x - origin.x;
  const dy = p.y - origin.y;
  return { x: origin.x + dx * c - dy * s, y: origin.y + dx * s + dy * c };
}
