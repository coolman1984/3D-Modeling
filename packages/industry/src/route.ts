import type { Tick, Vec2 } from '@space-planner/core';
import { cellCentre, passHalfWidth, type FloorGrid } from './grid.js';

/**
 * Something that moves over the floor and only needs a clear lane of its width: a person, a
 * forklift, a trolley. Road vehicles, which also need room to turn, get a kinematic model (T9).
 */
export interface MovementProfile {
  readonly id: string;
  readonly label: string;
  /** Clear width the mover needs, side clearance included. */
  readonly width: Tick;
}

/** Shortest travel distance (ticks) from the start cells to every cell, and the way back. */
export interface TravelField {
  /** Infinity where the mover cannot get. */
  readonly distance: Float64Array;
  /** The previous cell on a shortest path, -1 at a start or unreached. */
  readonly previous: Int32Array;
}

const STEPS: ReadonlyArray<readonly [number, number, number]> = [
  [1, 0, 1],
  [-1, 0, 1],
  [0, 1, 1],
  [0, -1, 1],
  [1, 1, Math.SQRT2],
  [1, -1, Math.SQRT2],
  [-1, 1, Math.SQRT2],
  [-1, -1, Math.SQRT2],
];

/**
 * Dijkstra over cells a `width`-wide mover fits through, in eight directions (a diagonal step
 * needs both side cells passable, so paths never cut a corner). Deterministic: ties are broken
 * by cell index.
 */
export function travelField(grid: FloorGrid, clearance: Float64Array, starts: readonly number[], width: Tick): TravelField {
  const { nx, ny, cell } = grid;
  const half = passHalfWidth(width, cell);
  const distance = new Float64Array(nx * ny).fill(Infinity);
  const previous = new Int32Array(nx * ny).fill(-1);
  const heap = new MinHeap();
  for (const k of starts) {
    if (k < 0 || grid.blocked[k] || distance[k] === 0) continue;
    distance[k] = 0;
    heap.push(0, k);
  }
  const passable = (a: number, b: number) => a >= 0 && b >= 0 && a < nx && b < ny && clearance[b * nx + a]! >= half;
  while (heap.size > 0) {
    const [d, k] = heap.pop();
    if (d > distance[k]!) continue;
    const i = k % nx;
    const j = (k - i) / nx;
    for (const [di, dj, cost] of STEPS) {
      const a = i + di;
      const b = j + dj;
      if (!passable(a, b)) continue;
      if (di !== 0 && dj !== 0 && !(passable(i + di, j) && passable(i, j + dj))) continue;
      const n = b * nx + a;
      const next = d + cost * cell;
      if (next < distance[n]! - 1e-9) {
        distance[n] = next;
        previous[n] = k;
        heap.push(next, n);
      }
    }
  }
  return { distance, previous };
}

/** The route from the nearest start to cell `k`, as points from start to end; empty if unreached. */
export function routeTo(grid: FloorGrid, field: TravelField, k: number): Vec2[] {
  if (!Number.isFinite(field.distance[k]!)) return [];
  const cells: number[] = [];
  for (let c = k; c >= 0; c = field.previous[c]!) cells.push(c);
  cells.reverse();
  // Keep only the corners: drop cells on a straight run.
  const points = cells.map((c) => cellCentre(grid, c));
  return points.filter((p, i) => {
    if (i === 0 || i === points.length - 1) return true;
    const a = points[i - 1]!;
    const b = points[i + 1]!;
    return (p.x - a.x) * (b.y - p.y) - (p.y - a.y) * (b.x - p.x) !== 0;
  });
}

/** Binary min-heap of (priority, cell), ties by cell index for determinism. */
class MinHeap {
  private readonly keys: number[] = [];
  private readonly cells: number[] = [];
  get size(): number {
    return this.keys.length;
  }
  push(key: number, cell: number): void {
    this.keys.push(key);
    this.cells.push(cell);
    let i = this.keys.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (!this.less(i, p)) break;
      this.swap(i, p);
      i = p;
    }
  }
  pop(): [number, number] {
    const top: [number, number] = [this.keys[0]!, this.cells[0]!];
    const lastKey = this.keys.pop()!;
    const lastCell = this.cells.pop()!;
    if (this.keys.length > 0) {
      this.keys[0] = lastKey;
      this.cells[0] = lastCell;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < this.keys.length && this.less(l, m)) m = l;
        if (r < this.keys.length && this.less(r, m)) m = r;
        if (m === i) break;
        this.swap(i, m);
        i = m;
      }
    }
    return top;
  }
  private less(a: number, b: number): boolean {
    return this.keys[a]! < this.keys[b]! || (this.keys[a] === this.keys[b] && this.cells[a]! < this.cells[b]!);
  }
  private swap(a: number, b: number): void {
    [this.keys[a], this.keys[b]] = [this.keys[b]!, this.keys[a]!];
    [this.cells[a], this.cells[b]] = [this.cells[b]!, this.cells[a]!];
  }
}
