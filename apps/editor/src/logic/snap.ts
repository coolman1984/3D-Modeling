import { MAX_COORDINATE, roundHalfAwayFromZero, type Vec2 } from '@space-planner/core';

/** Round a world point to the nearest multiple of `step` ticks (1 when snapping is off). */
export function snapPoint(p: Vec2, step: number): Vec2 {
  const s = Math.max(1, Math.round(step));
  const snap = (value: number) =>
    Math.max(-MAX_COORDINATE, Math.min(MAX_COORDINATE, roundHalfAwayFromZero(value / s) * s));
  return { x: snap(p.x), y: snap(p.y) };
}
