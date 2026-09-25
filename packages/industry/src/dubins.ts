import type { Vec2 } from '@space-planner/core';

/** A 2D pose: position plus heading in radians, standard math convention (0 = +x, counter-clockwise positive). */
export interface Pose {
  readonly x: number;
  readonly y: number;
  readonly heading: number;
}

export type TurnDirection = 'L' | 'R';

export type DubinsSegment =
  | { readonly kind: TurnDirection; readonly radius: number; readonly angle: number }
  | { readonly kind: 'S'; readonly length: number };

export type DubinsWord = 'LSL' | 'RSR' | 'LSR' | 'RSL';

export interface DubinsPath {
  readonly type: DubinsWord;
  readonly segments: readonly [DubinsSegment, DubinsSegment, DubinsSegment];
  /** Total path length, real units (same units as the poses and radius). */
  readonly length: number;
}

const TWO_PI = 2 * Math.PI;
const mod2pi = (a: number): number => a - TWO_PI * Math.floor(a / TWO_PI);

/** End pose after turning `angle` radians (>= 0) at `radius` from `from`, CCW ('L') or CW ('R'). */
function turnEnd(from: Pose, dir: TurnDirection, radius: number, angle: number): Pose {
  const { x, y, heading: th } = from;
  if (dir === 'L') {
    return { x: x + radius * (Math.sin(th + angle) - Math.sin(th)), y: y + radius * (Math.cos(th) - Math.cos(th + angle)), heading: th + angle };
  }
  return { x: x + radius * (Math.sin(th) - Math.sin(th - angle)), y: y + radius * (Math.cos(th - angle) - Math.cos(th)), heading: th - angle };
}

function straightEnd(from: Pose, length: number): Pose {
  return { x: from.x + length * Math.cos(from.heading), y: from.y + length * Math.sin(from.heading), heading: from.heading };
}

/** End pose of one path segment. */
function segmentEnd(from: Pose, segment: DubinsSegment): Pose {
  return segment.kind === 'S' ? straightEnd(from, segment.length) : turnEnd(from, segment.kind, segment.radius, segment.angle);
}

function segmentLength(segment: DubinsSegment): number {
  return segment.kind === 'S' ? segment.length : segment.radius * segment.angle;
}

interface Candidate {
  readonly type: DubinsWord;
  readonly t: number;
  readonly p: number;
  readonly q: number;
}

/**
 * The four CSC (curve-straight-curve) Dubins primitives, in the normalised frame (radius 1,
 * start at the origin facing the line to the goal). LSL and RSR are always feasible; LSR and RSL
 * only when the goal is far enough apart for the two turn circles to admit a common tangent.
 * Formulas: Shkel & Lumelsky, "Classification of the Dubins set" (2001) — the standard closed
 * forms also given in LaValle, *Planning Algorithms* §15.3.1. The rarer CCC (turn-straight-turn
 * with no straight, e.g. RLR) family is not computed: CSC always has a feasible member, so depot
 * planning never fails for lack of a path, only occasionally finds a longer one than optimal.
 */
function primitives(alpha: number, beta: number, d: number): Candidate[] {
  const sa = Math.sin(alpha);
  const sb = Math.sin(beta);
  const ca = Math.cos(alpha);
  const cb = Math.cos(beta);
  const cab = Math.cos(alpha - beta);
  const out: Candidate[] = [];

  // A tiny negative p² right at the boundary between feasible and infeasible is float noise, not
  // real infeasibility (the symmetric case where the two turn circles are exactly tangent lands
  // exactly here); clamp it to zero rather than dropping an otherwise-valid, often-optimal candidate.
  const EPS = 1e-9;
  {
    const pSq = 2 + d * d - 2 * cab + 2 * d * (sa - sb);
    if (pSq >= -EPS) {
      const tmp = Math.atan2(cb - ca, d + sa - sb);
      const t = mod2pi(-alpha + tmp);
      const p = Math.sqrt(Math.max(0, pSq));
      const q = mod2pi(beta - tmp);
      out.push({ type: 'LSL', t, p, q });
    }
  }
  {
    const pSq = 2 + d * d - 2 * cab + 2 * d * (sb - sa);
    if (pSq >= -EPS) {
      const tmp = Math.atan2(ca - cb, d - sa + sb);
      const t = mod2pi(alpha - tmp);
      const p = Math.sqrt(Math.max(0, pSq));
      const q = mod2pi(-beta + tmp);
      out.push({ type: 'RSR', t, p, q });
    }
  }
  {
    const pSq = -2 + d * d + 2 * cab + 2 * d * (sa + sb);
    if (pSq >= -EPS) {
      const p = Math.sqrt(Math.max(0, pSq));
      const tmp = Math.atan2(-ca - cb, d + sa + sb) - Math.atan2(-2, p);
      const t = mod2pi(-alpha + tmp);
      const q = mod2pi(-mod2pi(beta) + tmp);
      out.push({ type: 'LSR', t, p, q });
    }
  }
  {
    const pSq = d * d - 2 + 2 * cab - 2 * d * (sa + sb);
    if (pSq >= -EPS) {
      const p = Math.sqrt(Math.max(0, pSq));
      const tmp = Math.atan2(ca + cb, d - sa - sb) - Math.atan2(2, p);
      const t = mod2pi(alpha - tmp);
      const q = mod2pi(beta - tmp);
      out.push({ type: 'RSL', t, p, q });
    }
  }
  return out;
}

/**
 * The shortest Dubins path (CSC family) from `start` to `goal` at a fixed minimum turning
 * radius: the shortest forward-only route a vehicle with that turning radius can drive between
 * two poses. `undefined` only for a non-positive radius.
 */
export function dubinsPath(start: Pose, goal: Pose, radius: number): DubinsPath | undefined {
  if (!Number.isFinite(radius) || radius <= 0) return undefined;
  const dx = goal.x - start.x;
  const dy = goal.y - start.y;
  const dist = Math.hypot(dx, dy);
  const d = dist / radius;
  const theta = dist < 1e-12 ? 0 : Math.atan2(dy, dx);
  const alpha = mod2pi(start.heading - theta);
  const beta = mod2pi(goal.heading - theta);
  const candidates = primitives(alpha, beta, d);
  if (candidates.length === 0) return undefined;
  let best = candidates[0]!;
  for (const c of candidates) if (c.t + c.p + c.q < best.t + best.p + best.q) best = c;
  const dirs: Record<DubinsWord, readonly [TurnDirection, TurnDirection]> = { LSL: ['L', 'L'], RSR: ['R', 'R'], LSR: ['L', 'R'], RSL: ['R', 'L'] };
  const [first, last] = dirs[best.type];
  const segments: [DubinsSegment, DubinsSegment, DubinsSegment] = [
    { kind: first, radius, angle: best.t },
    { kind: 'S', length: best.p * radius },
    { kind: last, radius, angle: best.q },
  ];
  return { type: best.type, segments, length: segments.reduce((sum, s) => sum + segmentLength(s), 0) };
}

/**
 * Poses sampled along a Dubins path at roughly `step` arc-length apart (always including both
 * endpoints), for a swept-body check: dense enough that the vehicle rectangle at consecutive
 * samples overlaps, so nothing between samples can poke through a gap unnoticed.
 */
export function sampleDubinsPath(start: Pose, path: DubinsPath, step: number): Pose[] {
  if (!Number.isFinite(step) || step <= 0) throw new RangeError('sample step must be positive');
  const poses: Pose[] = [start];
  let pose = start;
  for (const segment of path.segments) {
    const len = segmentLength(segment);
    if (len < 1e-12) continue;
    const steps = Math.max(1, Math.ceil(len / step));
    for (let k = 1; k <= steps; k++) {
      const s = (len * k) / steps;
      poses.push(segment.kind === 'S' ? straightEnd(pose, s) : turnEnd(pose, segment.kind, segment.radius, s / segment.radius));
    }
    pose = segmentEnd(pose, segment);
  }
  return poses;
}

/** The vehicle's four floor corners at `pose`, given its rectangle relative to the reference point (rear axle centre). */
export function vehicleCorners(pose: Pose, ahead: number, behind: number, halfWidth: number): readonly [Vec2, Vec2, Vec2, Vec2] {
  const cos = Math.cos(pose.heading);
  const sin = Math.sin(pose.heading);
  const corner = (forward: number, side: number): Vec2 => ({ x: pose.x + forward * cos - side * sin, y: pose.y + forward * sin + side * cos });
  return [corner(ahead, halfWidth), corner(ahead, -halfWidth), corner(-behind, -halfWidth), corner(-behind, halfWidth)];
}
