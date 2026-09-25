import type { Vec2 } from '@space-planner/core';
import type { FloorRaster } from './raster.js';

export interface MovementProfile {
  readonly name: string;
  /** Body plus both side clearances, in integer ticks. */
  readonly effectiveWidth: number;
}

export type RouteResult =
  | { readonly reachable: true; readonly distance: number; readonly points: readonly Vec2[] }
  | { readonly reachable: false; readonly distance: null; readonly points: readonly Vec2[]; readonly reason: 'outside' | 'blocked-start' | 'blocked-destination' | 'no-path' };

function clearanceNeeded(grid: FloorRaster, mover: MovementProfile): number {
  if (!Number.isFinite(mover.effectiveWidth) || mover.effectiveWidth <= 0) throw new RangeError('effective width must be positive');
  // A centre may be half a cell closer to an obstacle's edge than to its centre.
  return mover.effectiveWidth / (2 * grid.cell) + 0.5;
}

/**
 * Eight-direction shortest paths on the sampled floor, no corner cutting. Shared by `findRoute`
 * (one destination, path reconstructed, stops as soon as it is reached) and `reachabilityFrom`
 * (every destination at once, no path, runs to exhaustion) so that many "can this start reach
 * that destination" questions cost one search instead of one search each.
 */
function dijkstra(grid: FloorRaster, start: number, free: (k: number) => boolean, finish?: number): { distances: Float64Array; previous: Int32Array | undefined } {
  const total = grid.nx * grid.ny;
  const distances = new Float64Array(total).fill(Infinity);
  const previous = finish === undefined ? undefined : new Int32Array(total).fill(-1);
  const heap: Array<{ k: number; d: number }> = [];
  const less = (a: { k: number; d: number }, b: { k: number; d: number }) => a.d < b.d || (a.d === b.d && a.k < b.k);
  const push = (entry: { k: number; d: number }) => {
    let i = heap.length;
    heap.push(entry);
    while (i > 0) {
      const parent = (i - 1) >>> 1;
      if (!less(entry, heap[parent]!)) break;
      heap[i] = heap[parent]!;
      i = parent;
    }
    heap[i] = entry;
  };
  const pop = () => {
    const first = heap[0]!;
    const last = heap.pop()!;
    if (heap.length > 0) {
      let i = 0;
      while (i * 2 + 1 < heap.length) {
        let child = i * 2 + 1;
        if (child + 1 < heap.length && less(heap[child + 1]!, heap[child]!)) child++;
        if (!less(heap[child]!, last)) break;
        heap[i] = heap[child]!;
        i = child;
      }
      heap[i] = last;
    }
    return first;
  };
  distances[start] = 0;
  push({ k: start, d: 0 });
  const steps = [[0, -1], [-1, 0], [1, 0], [0, 1], [-1, -1], [1, -1], [-1, 1], [1, 1]] as const;
  while (heap.length) {
    const { k, d } = pop();
    if (d !== distances[k]) continue;
    if (finish !== undefined && k === finish) break;
    const x = k % grid.nx;
    const y = (k - x) / grid.nx;
    for (const [dx, dy] of steps) {
      const a = x + dx;
      const b = y + dy;
      if (a < 0 || a >= grid.nx || b < 0 || b >= grid.ny) continue;
      const next = b * grid.nx + a;
      if (!free(next)) continue;
      if (dx && dy && (!free(y * grid.nx + a) || !free(b * grid.nx + x))) continue;
      const nextD = d + (dx && dy ? Math.SQRT2 : 1) * grid.cell;
      if (nextD < distances[next]! - 1e-8) {
        distances[next] = nextD;
        if (previous) previous[next] = k;
        push({ k: next, d: nextD });
      }
    }
  }
  return { distances, previous };
}

/** Deterministic shortest path on the sampled floor, using eight directions and no corner cutting. */
export function findRoute(grid: FloorRaster, from: Vec2, to: Vec2, mover: MovementProfile): RouteResult {
  const needed = clearanceNeeded(grid, mover);
  const start = grid.index(from);
  const finish = grid.index(to);
  const failure = (reason: Extract<RouteResult, { reachable: false }>['reason']): RouteResult => ({ reachable: false, distance: null, points: [], reason });
  if (start === undefined || finish === undefined) return failure('outside');
  const free = (k: number) => !grid.blocked[k] && grid.clearance[k]! >= needed;
  if (!free(start)) return failure('blocked-start');
  if (!free(finish)) return failure('blocked-destination');
  const { distances, previous } = dijkstra(grid, start, free, finish);
  if (!Number.isFinite(distances[finish])) return failure('no-path');
  const points: Vec2[] = [];
  for (let k = finish; k !== -1; k = previous![k]!) {
    const i = k % grid.nx;
    points.push(grid.point(i, (k - i) / grid.nx));
  }
  points.reverse();
  return { reachable: true, distance: distances[finish]!, points };
}

/**
 * Distances from one point to every reachable cell, for a given mover. One search answers many
 * "can this start reach that destination" questions cheaply (see `distanceAt`), instead of
 * running a fresh point-to-point search per destination.
 */
export function reachabilityFrom(grid: FloorRaster, from: Vec2, mover: MovementProfile): Float64Array | undefined {
  const needed = clearanceNeeded(grid, mover);
  const start = grid.index(from);
  if (start === undefined) return undefined;
  const free = (k: number) => !grid.blocked[k] && grid.clearance[k]! >= needed;
  if (!free(start)) return undefined;
  return dijkstra(grid, start, free).distances;
}

/** Looks up a point in a `reachabilityFrom` distance field; `undefined` when unreached or outside the grid. */
export function distanceAt(grid: FloorRaster, distances: Float64Array, point: Vec2): number | undefined {
  const k = grid.index(point);
  if (k === undefined) return undefined;
  const d = distances[k];
  return Number.isFinite(d) ? d : undefined;
}
