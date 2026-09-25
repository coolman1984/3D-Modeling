import type { Tick, Vec2 } from '@space-planner/core';

/**
 * Vehicle kinematics for swept-path checks: a car-like vehicle that moves along arcs no tighter
 * than its minimum radius, forward and (when allowed) in reverse.
 *
 * A pose is the middle of the rear axle and the heading in radians (0 = east, counter-clockwise),
 * floats in ticks: derived geometry, never stored.
 */
export interface Pose {
  readonly x: number;
  readonly y: number;
  readonly heading: number;
}

export interface VehicleProfile {
  readonly id: string;
  readonly label: string;
  /** Overall length and width (mirrors included in the width when they matter). */
  readonly length: Tick;
  readonly width: Tick;
  readonly wheelbase: Tick;
  /** Body ahead of the front axle and behind the rear axle; length = rear + wheelbase + front. */
  readonly frontOverhang: Tick;
  readonly rearOverhang: Tick;
  /** Tightest radius the middle of the rear axle can follow. */
  readonly minRadius: Tick;
  readonly reverse: boolean;
}

/**
 * The planning radius (middle of the rear axle) from the kerb-to-kerb turning circle that spec
 * sheets give: the outer front wheel runs on a circle of half that diameter, so
 * R = √((D/2)² − wheelbase²) − width/2.
 */
export function rearAxleRadius(turningCircle: number, wheelbase: number, width: number): number {
  const outer = turningCircle / 2;
  return Math.sqrt(Math.max(0, outer * outer - wheelbase * wheelbase)) - width / 2;
}

/** The body's four corners at a pose (counter-clockwise from rear right). */
export function bodyAt(v: VehicleProfile, p: Pose): Vec2[] {
  const c = Math.cos(p.heading);
  const s = Math.sin(p.heading);
  const back = -v.rearOverhang;
  const front = v.wheelbase + v.frontOverhang;
  const half = v.width / 2;
  const at = (along: number, left: number): Vec2 => ({ x: p.x + along * c - left * s, y: p.y + along * s + left * c });
  return [at(back, -half), at(front, -half), at(front, half), at(back, half)];
}

const TAU = Math.PI * 2;
export const mod2pi = (a: number) => ((a % TAU) + TAU) % TAU;

/** One piece of a path: turn left, go straight, turn right; `length` in ticks along the rear axle. */
export interface Segment {
  readonly kind: 'L' | 'S' | 'R';
  readonly length: number;
  /** +1 forward, −1 reverse. */
  readonly gear: 1 | -1;
}

/**
 * The shortest forward path from `a` to `b` for a minimum radius `r` (Dubins 1957): the best of
 * the six words LSL, RSR, LSR, RSL, RLR, LRL, by the closed forms in Shkel & Lumelsky (2001).
 */
export function dubins(a: Pose, b: Pose, r: number): Segment[] | undefined {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const d = Math.hypot(dx, dy) / r;
  const theta = mod2pi(Math.atan2(dy, dx));
  const al = mod2pi(a.heading - theta);
  const be = mod2pi(b.heading - theta);
  const sa = Math.sin(al);
  const sb = Math.sin(be);
  const ca = Math.cos(al);
  const cb = Math.cos(be);
  const cab = Math.cos(al - be);
  const words: Array<[Segment['kind'], Segment['kind'], Segment['kind'], number, number, number] | undefined> = [];
  {
    const p2 = 2 + d * d - 2 * cab + 2 * d * (sa - sb);
    if (p2 >= 0) {
      const t1 = Math.atan2(cb - ca, d + sa - sb);
      words.push(['L', 'S', 'L', mod2pi(-al + t1), Math.sqrt(p2), mod2pi(be - t1)]);
    }
  }
  {
    const p2 = 2 + d * d - 2 * cab + 2 * d * (sb - sa);
    if (p2 >= 0) {
      const t1 = Math.atan2(ca - cb, d - sa + sb);
      words.push(['R', 'S', 'R', mod2pi(al - t1), Math.sqrt(p2), mod2pi(-be + t1)]);
    }
  }
  {
    const p2 = -2 + d * d + 2 * cab + 2 * d * (sa + sb);
    if (p2 >= 0) {
      const p = Math.sqrt(p2);
      const t2 = Math.atan2(-ca - cb, d + sa + sb) - Math.atan2(-2, p);
      words.push(['L', 'S', 'R', mod2pi(-al + t2), p, mod2pi(-be + t2)]);
    }
  }
  {
    const p2 = d * d - 2 + 2 * cab - 2 * d * (sa + sb);
    if (p2 >= 0) {
      const p = Math.sqrt(p2);
      const t2 = Math.atan2(ca + cb, d - sa - sb) - Math.atan2(2, p);
      words.push(['R', 'S', 'L', mod2pi(al - t2), p, mod2pi(be - t2)]);
    }
  }
  {
    const tmp = (6 - d * d + 2 * cab + 2 * d * (sa - sb)) / 8;
    if (Math.abs(tmp) <= 1) {
      const p = mod2pi(TAU - Math.acos(tmp));
      const t = mod2pi(al - Math.atan2(ca - cb, d - sa + sb) + p / 2);
      words.push(['R', 'L', 'R', t, p, mod2pi(al - be - t + p)]);
    }
  }
  {
    const tmp = (6 - d * d + 2 * cab + 2 * d * (sb - sa)) / 8;
    if (Math.abs(tmp) <= 1) {
      const p = mod2pi(TAU - Math.acos(tmp));
      const t = mod2pi(-al - Math.atan2(ca - cb, d + sa - sb) + p / 2);
      words.push(['L', 'R', 'L', t, p, mod2pi(be - al - t + p)]);
    }
  }
  let best: Segment[] | undefined;
  let bestLength = Infinity;
  for (const w of words) {
    if (!w) continue;
    const total = w[3] + w[4] + w[5];
    if (total < bestLength - 1e-12) {
      bestLength = total;
      best = [
        { kind: w[0], length: w[3] * r, gear: 1 },
        { kind: w[1], length: w[4] * r, gear: 1 },
        { kind: w[2], length: w[5] * r, gear: 1 },
      ];
    }
  }
  return best?.filter((s) => s.length > 1e-9);
}

/**
 * The same kind of path driven entirely in reverse: plan forward with both headings turned round,
 * then drive it backwards (the body keeps facing the other way).
 */
export function dubinsReverse(a: Pose, b: Pose, r: number): Segment[] | undefined {
  const turned = (p: Pose): Pose => ({ ...p, heading: mod2pi(p.heading + Math.PI) });
  const path = dubins(turned(a), turned(b), r);
  // Driving a left turn backwards with the body turned round is a right turn of the body.
  return path?.map((s) => ({ kind: s.kind === 'L' ? 'R' : s.kind === 'R' ? 'L' : 'S', length: s.length, gear: -1 }));
}

/** Move a pose along one arc or straight piece (curvature ±1/r, or 0), in the segment's gear. */
export function advance(p: Pose, kind: Segment['kind'], length: number, gear: 1 | -1, r: number): Pose {
  const ds = length * gear;
  if (kind === 'S') return { x: p.x + ds * Math.cos(p.heading), y: p.y + ds * Math.sin(p.heading), heading: p.heading };
  const turn = (kind === 'L' ? 1 : -1) * (ds / r);
  const h = p.heading + turn;
  const sign = kind === 'L' ? 1 : -1;
  return {
    x: p.x + sign * r * (Math.sin(h) - Math.sin(p.heading)),
    y: p.y - sign * r * (Math.cos(h) - Math.cos(p.heading)),
    heading: mod2pi(h),
  };
}

/** Poses every `step` ticks along a path (the start and the exact end included). */
export function samplePath(start: Pose, path: readonly Segment[], r: number, step: number): Array<Pose & { gear: 1 | -1 }> {
  const out: Array<Pose & { gear: 1 | -1 }> = [{ ...start, gear: path[0]?.gear ?? 1 }];
  let p = start;
  for (const seg of path) {
    const n = Math.max(1, Math.ceil(seg.length / step));
    for (let k = 1; k <= n; k++) out.push({ ...advance(p, seg.kind, (seg.length * k) / n, seg.gear, r), gear: seg.gear });
    p = advance(p, seg.kind, seg.length, seg.gear, r);
  }
  return out;
}

export const pathLength = (path: readonly Segment[]) => path.reduce((t, s) => t + s.length, 0);
