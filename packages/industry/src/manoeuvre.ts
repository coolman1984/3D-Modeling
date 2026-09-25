import { cellAt, type FloorGrid } from './grid.js';
import { travelField } from './route.js';
import { advance, dubins, dubinsReverse, mod2pi, pathLength, samplePath, type Pose, type Segment, type VehicleProfile } from './vehicle.js';

/**
 * Can a vehicle get from one pose to another without its body touching anything? A hybrid-A*
 * search (Dolgov et al. 2008) over short arcs at the vehicle's turning radius, forward and — when
 * the vehicle may reverse — backward, with an exact Dubins shot to the goal tried along the way.
 * Deterministic: fixed primitives, ties broken by insertion order.
 */

export interface Manoeuvre {
  /** Rear-axle poses about every quarter metre, with the gear used to reach each. */
  readonly poses: ReadonlyArray<Pose & { readonly gear: 1 | -1 }>;
  /** Distance driven (ticks). */
  readonly length: number;
  /** Changes between forward and reverse. */
  readonly gearChanges: number;
}

export type ManoeuvreResult =
  | { readonly ok: true; readonly manoeuvre: Manoeuvre }
  /**
   * blocked-start / blocked-goal: the body does not fit there; no-way: nothing can connect them
   * (proved); budget: the search gave up before finding a way (unknown, not proof of absence).
   */
  | { readonly ok: false; readonly reason: 'blocked-start' | 'blocked-goal' | 'no-way' | 'budget' };

export interface ManoeuvreOptions {
  /** Most states to expand before giving up (default 60 000). */
  readonly budget?: number;
  /** Search cell (default 0.5 m) and heading bins (default 72, 5°). */
  readonly resolution?: number;
  readonly headings?: number;
  /**
   * A lower-bound guess of the distance left from a pose to the goal. Defaults to an
   * obstacle-aware field on `grid`; callers checking many goals pass a coarser one (`guideTo`).
   */
  readonly guide?: (p: Pose) => number;
}

/**
 * An obstacle-aware distance guide to `goal` for something `width` wide, on its own (usually
 * coarser) grid; falls back to the straight line where the field has no value.
 */
export function guideTo(grid: FloorGrid, clearance: Float64Array, goal: Pose, width: number): (p: Pose) => number {
  const field = travelField(grid, clearance, [cellAt(grid, goal)], Math.max(grid.cell, width - 2 * grid.cell)).distance;
  return (p) => {
    const k = cellAt(grid, p);
    const d = k >= 0 ? field[k]! : Infinity;
    return Math.max(Math.hypot(goal.x - p.x, goal.y - p.y), Number.isFinite(d) ? d * 0.9 : 0);
  };
}

const QUARTER_METRE = 2_500;

/** How much wider than half the body the side discs are: the sides are overstated by this. */
const SIDE_SLACK = 300;

/**
 * The body as discs along its axis plus points on its two ends. The discs (radius half the width
 * plus 3 cm, a short step apart) sit inside the body's length, so the sides are overstated by a
 * few centimetres and the ends not at all; the ends and corners are checked as points.
 */
export function bodyDiscs(v: VehicleProfile): { offsets: number[]; radius: number; ends: Array<readonly [number, number]> } {
  const radius = v.width / 2 + SIDE_SLACK;
  const from = -v.rearOverhang + v.width / 2;
  const to = v.wheelbase + v.frontOverhang - v.width / 2;
  // Neighbouring discs of radius r a step s apart cover the side while √(r² − (s/2)²) ≥ width/2.
  const maxStep = 2 * Math.sqrt(radius * radius - (v.width / 2) ** 2);
  const k = Math.max(1, Math.ceil((to - from) / maxStep) + 1);
  const offsets = k === 1 ? [(from + to) / 2] : Array.from({ length: k }, (_, i) => from + ((to - from) * i) / (k - 1));
  const ends: Array<readonly [number, number]> = [];
  const across = Math.max(1, Math.ceil(v.width / 2_000));
  for (const along of [-v.rearOverhang, v.wheelbase + v.frontOverhang]) {
    for (let i = 0; i <= across; i++) ends.push([along, -v.width / 2 + (v.width * i) / across]);
  }
  return { offsets, radius, ends };
}

/**
 * Is the body clear of everything blocked? A disc's centre must be further from every blocked
 * cell centre than its radius plus the sampling slack (a cell edge can be half a cell nearer than
 * its centre, and a point up to half a diagonal from the centre of the cell it is read at); an end
 * point needs just the slack.
 */
export function bodyFree(v: VehicleProfile, p: Pose, grid: FloorGrid, clearance: Float64Array, shape = bodyDiscs(v)): boolean {
  const slack = 0.5 + Math.SQRT1_2;
  const need = shape.radius / grid.cell + slack;
  const c = Math.cos(p.heading);
  const s = Math.sin(p.heading);
  for (const o of shape.offsets) {
    const k = cellAt(grid, { x: p.x + o * c, y: p.y + o * s });
    if (k < 0 || clearance[k]! < need) return false;
  }
  for (const [along, across] of shape.ends) {
    const k = cellAt(grid, { x: p.x + along * c - across * s, y: p.y + along * s + across * c });
    if (k < 0 || clearance[k]! < slack) return false;
  }
  return true;
}

interface Node {
  readonly pose: Pose;
  readonly g: number;
  readonly parent: number;
  readonly gear: 1 | -1;
  /** The piece driven from the parent (absent at the start). */
  readonly piece?: Segment & { readonly radius: number };
}

export function planManoeuvre(v: VehicleProfile, grid: FloorGrid, clearance: Float64Array, start: Pose, goal: Pose, options: ManoeuvreOptions = {}): ManoeuvreResult {
  const discs = bodyDiscs(v);
  const free = (p: Pose) => bodyFree(v, p, grid, clearance, discs);
  if (!free(start)) return { ok: false, reason: 'blocked-start' };
  if (!free(goal)) return { ok: false, reason: 'blocked-goal' };

  // Guide: the obstacle-aware distance to the goal for a mover a little narrower than the vehicle
  // (a lower bound in practice; where it has no value, the straight-line distance).
  const h = options.guide ?? guideTo(grid, clearance, goal, v.width);

  const res = options.resolution ?? 5_000;
  const bins = options.headings ?? 72;
  const budget = options.budget ?? 60_000;
  const r = v.minRadius;
  const step = Math.max(res * 1.5, QUARTER_METRE * 2);
  const nx = Math.ceil((grid.room.maxX - grid.room.minX) / res) + 2;
  const ny = Math.ceil((grid.room.maxY - grid.room.minY) / res) + 2;
  const keyOf = (p: Pose, gear: 1 | -1) => {
    const i = Math.floor((p.x - grid.room.minX) / res) + 1;
    const j = Math.floor((p.y - grid.room.minY) / res) + 1;
    if (i < 0 || j < 0 || i >= nx || j >= ny) return -1;
    const b = Math.round((mod2pi(p.heading) / (Math.PI * 2)) * bins) % bins;
    return ((j * nx + i) * bins + b) * 2 + (gear === 1 ? 0 : 1);
  };
  const best = new Float32Array(nx * ny * bins * 2).fill(Infinity);
  const closed = new Uint8Array(nx * ny * bins * 2);

  const nodes: Node[] = [{ pose: start, g: 0, parent: -1, gear: 1 }];
  const heap = new Heap();
  heap.push(h(start), 0);
  const gears: Array<1 | -1> = v.reverse ? [1, -1] : [1];
  // Full lock left, straight, full lock right: the shortest manoeuvres use only these (Reeds & Shepp).
  const steers = [1, 0, -1];

  /** Every sample along a path is free (the start pose is already known to be). */
  const clear = (from: Pose, path: readonly Segment[], radius: number) => samplePath(from, path, radius, QUARTER_METRE).every((p, i) => i === 0 || free(p));

  const shot = (n: Node): { path: Segment[]; radius: number } | undefined => {
    const tries = [dubins(n.pose, goal, r), v.reverse ? dubinsReverse(n.pose, goal, r) : undefined];
    for (const path of tries) if (path && clear(n.pose, path, r)) return { path, radius: r };
    return undefined;
  };

  let expanded = 0;
  while (heap.size > 0) {
    const index = heap.pop();
    const n = nodes[index]!;
    const key = keyOf(n.pose, n.gear);
    if (key < 0 || closed[key]) continue;
    closed[key] = 1;
    if (++expanded > budget) return { ok: false, reason: 'budget' };
    // Try to finish exactly when the goal is near enough for a shot to be worth it.
    const near = Math.hypot(goal.x - n.pose.x, goal.y - n.pose.y) < 24 * res;
    if ((near && expanded % 4 === 1) || expanded % 32 === 1) {
      const finish = shot(n);
      if (finish) return { ok: true, manoeuvre: build(nodes, index, finish.path, finish.radius) };
    }
    for (const gear of gears) {
      for (const steer of steers) {
        const kind: Segment['kind'] = steer > 0 ? 'L' : steer < 0 ? 'R' : 'S';
        const radius = steer === 0 ? r : r / Math.abs(steer);
        const piece: Segment & { radius: number } = { kind, length: step, gear, radius };
        if (!clear(n.pose, [piece], radius)) continue;
        const pose = advance(n.pose, kind, step, gear, radius);
        const k = keyOf(pose, gear);
        if (k < 0 || closed[k]) continue;
        const g = n.g + step * (gear === -1 ? 1.5 : 1) + (n.parent >= 0 && gear !== n.gear ? 4 * 10_000 : 0) + (steer !== 0 ? 0.05 * step : 0);
        if (g >= best[k]!) continue;
        best[k] = g;
        nodes.push({ pose, g, parent: index, gear, piece });
        heap.push(g + h(pose), nodes.length - 1);
      }
    }
  }
  return { ok: false, reason: 'no-way' };
}

/** Poses from the start to node `index`, then along the final shot. */
function build(nodes: readonly Node[], index: number, finish: readonly Segment[], radius: number): Manoeuvre {
  const chain: Node[] = [];
  for (let i = index; i >= 0; i = nodes[i]!.parent) chain.push(nodes[i]!);
  chain.reverse();
  const poses: Array<Pose & { gear: 1 | -1 }> = [{ ...chain[0]!.pose, gear: chain[1]?.gear ?? finish[0]?.gear ?? 1 }];
  let length = 0;
  for (let i = 1; i < chain.length; i++) {
    const piece = chain[i]!.piece!;
    poses.push(...samplePath(chain[i - 1]!.pose, [piece], piece.radius, QUARTER_METRE).slice(1));
    length += piece.length;
  }
  if (finish.length) {
    poses.push(...samplePath(chain.at(-1)!.pose, finish, radius, QUARTER_METRE).slice(1));
    length += pathLength(finish);
  }
  let gearChanges = 0;
  for (let i = 2; i < poses.length; i++) if (poses[i]!.gear !== poses[i - 1]!.gear) gearChanges++;
  return { poses, length, gearChanges };
}

/** Min-heap of node indices by priority, ties by insertion order. */
class Heap {
  private readonly keys: number[] = [];
  private readonly values: number[] = [];
  private readonly order: number[] = [];
  private sequence = 0;
  get size(): number {
    return this.keys.length;
  }
  push(key: number, value: number): void {
    this.keys.push(key);
    this.values.push(value);
    this.order.push(this.sequence++);
    let i = this.keys.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (!this.less(i, p)) break;
      this.swap(i, p);
      i = p;
    }
  }
  pop(): number {
    const top = this.values[0]!;
    const lk = this.keys.pop()!;
    const lv = this.values.pop()!;
    const lo = this.order.pop()!;
    if (this.keys.length > 0) {
      this.keys[0] = lk;
      this.values[0] = lv;
      this.order[0] = lo;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const rr = l + 1;
        let m = i;
        if (l < this.keys.length && this.less(l, m)) m = l;
        if (rr < this.keys.length && this.less(rr, m)) m = rr;
        if (m === i) break;
        this.swap(i, m);
        i = m;
      }
    }
    return top;
  }
  private less(a: number, b: number): boolean {
    return this.keys[a]! < this.keys[b]! || (this.keys[a] === this.keys[b] && this.order[a]! < this.order[b]!);
  }
  private swap(a: number, b: number): void {
    [this.keys[a], this.keys[b]] = [this.keys[b]!, this.keys[a]!];
    [this.values[a], this.values[b]] = [this.values[b]!, this.values[a]!];
    [this.order[a], this.order[b]] = [this.order[b]!, this.order[a]!];
  }
}
