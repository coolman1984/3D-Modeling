import { boundsOf, type Aabb, type Tick, type Vec2 } from '@space-planner/core';

/**
 * A floor sampled on square cells, for questions geometry answers poorly: can a person, a
 * forklift or a trolley of a given width get from here to there, and how far is it?
 *
 * Cells are indexed k = j * nx + i. Cell (i, j) has its centre at
 * (room.minX + (i − 0.5) · cell, room.minY + (j − 0.5) · cell): one border ring of cells lies
 * outside the room so the walls are always blocked. Derived from a project; never stored.
 */
export interface FloorGrid {
  readonly room: Aabb;
  readonly cell: Tick;
  readonly nx: number;
  readonly ny: number;
  /** 1 = blocked (outside the room, under a wall, column or item), 0 = free. */
  readonly blocked: Uint8Array;
}

/**
 * A grid over the room's bounding box, everything blocked except the inside of `boundary`.
 * The cell size is at least `minCell` and grows so the grid stays under `maxCells` cells.
 */
export function floorGrid(boundary: readonly Vec2[], minCell: Tick, maxCells = 1_500_000): FloorGrid {
  const room = boundsOf(boundary);
  const spanX = room.maxX - room.minX;
  const spanY = room.maxY - room.minY;
  const cell = Math.max(minCell, Math.ceil(Math.sqrt((spanX * spanY) / maxCells)));
  const nx = Math.ceil(spanX / cell) + 2;
  const ny = Math.ceil(spanY / cell) + 2;
  const grid = { room, cell, nx, ny, blocked: new Uint8Array(nx * ny).fill(1) };
  paintPolygon(grid, boundary, 0);
  return grid;
}

/**
 * Set the cells whose centres lie inside `polygon` (even-odd rule) to `value`, by scanlines:
 * for each row of cell centres, find where the outline crosses it and fill between crossings.
 */
export function paintPolygon(grid: FloorGrid, polygon: readonly Vec2[], value: 0 | 1): void {
  const { room, cell, nx, ny, blocked } = grid;
  const b = boundsOf(polygon);
  const j0 = Math.max(0, Math.floor((b.minY - room.minY) / cell));
  const j1 = Math.min(ny - 1, Math.ceil((b.maxY - room.minY) / cell) + 1);
  const xs: number[] = [];
  for (let j = j0; j <= j1; j++) {
    const y = room.minY + (j - 0.5) * cell;
    xs.length = 0;
    for (let k = 0; k < polygon.length; k++) {
      const p = polygon[k]!;
      const q = polygon[(k + 1) % polygon.length]!;
      if ((p.y <= y && y < q.y) || (q.y <= y && y < p.y)) xs.push(p.x + ((y - p.y) * (q.x - p.x)) / (q.y - p.y));
    }
    xs.sort((u, v) => u - v);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const i0 = Math.max(0, Math.ceil((xs[k]! - room.minX) / cell + 0.5));
      const i1 = Math.min(nx - 1, Math.floor((xs[k + 1]! - room.minX) / cell + 0.5));
      for (let i = i0; i <= i1; i++) blocked[j * nx + i] = value;
    }
  }
}

/** The cell whose area contains `p`, or -1 outside the grid. */
export function cellAt(grid: FloorGrid, p: Vec2): number {
  const i = Math.floor((p.x - grid.room.minX) / grid.cell + 1);
  const j = Math.floor((p.y - grid.room.minY) / grid.cell + 1);
  return i < 0 || j < 0 || i >= grid.nx || j >= grid.ny ? -1 : j * grid.nx + i;
}

export function cellCentre(grid: FloorGrid, k: number): Vec2 {
  const i = k % grid.nx;
  const j = (k - i) / grid.nx;
  return { x: grid.room.minX + (i - 0.5) * grid.cell, y: grid.room.minY + (j - 0.5) * grid.cell };
}

/**
 * Exact Euclidean distance (in cells) from every cell centre to the nearest blocked cell centre,
 * by two passes of the 1-D lower-envelope transform (Felzenszwalb and Huttenlocher).
 */
export function distanceToBlocked(blocked: Uint8Array, nx: number, ny: number): Float64Array {
  const INF = 1e20;
  const grid = new Float64Array(nx * ny);
  for (let k = 0; k < grid.length; k++) grid[k] = blocked[k] ? 0 : INF;
  const size = Math.max(nx, ny);
  const f = new Float64Array(size);
  const d = new Float64Array(size);
  const v = new Int32Array(size);
  const z = new Float64Array(size + 1);
  const pass = (n: number) => {
    let k = 0;
    v[0] = 0;
    z[0] = -INF;
    z[1] = INF;
    for (let q = 1; q < n; q++) {
      let s = (f[q]! + q * q - (f[v[k]!]! + v[k]! * v[k]!)) / (2 * q - 2 * v[k]!);
      while (s <= z[k]!) {
        k--;
        s = (f[q]! + q * q - (f[v[k]!]! + v[k]! * v[k]!)) / (2 * q - 2 * v[k]!);
      }
      k++;
      v[k] = q;
      z[k] = s;
      z[k + 1] = INF;
    }
    k = 0;
    for (let q = 0; q < n; q++) {
      while (z[k + 1]! < q) k++;
      d[q] = (q - v[k]!) ** 2 + f[v[k]!]!;
    }
  };
  for (let i = 0; i < nx; i++) {
    for (let j = 0; j < ny; j++) f[j] = grid[j * nx + i]!;
    pass(ny);
    for (let j = 0; j < ny; j++) grid[j * nx + i] = d[j]!;
  }
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) f[i] = grid[j * nx + i]!;
    pass(nx);
    for (let i = 0; i < nx; i++) grid[j * nx + i] = Math.sqrt(d[i]!);
  }
  return grid;
}

/**
 * The half-width, in cells, a free cell must keep from blocked cell centres for something `width`
 * wide to pass through it. A blocked cell's edge can be up to half a cell nearer than its centre:
 * that half cell is added, so sampling can only err on the safe side.
 */
export function passHalfWidth(width: Tick, cell: Tick): number {
  return width / 2 / cell + 0.5;
}

/** Cells a `width`-wide mover can reach from `starts` moving between side-sharing cells. */
export function reachable(grid: FloorGrid, clearance: Float64Array, starts: readonly number[], width: Tick): Uint8Array {
  const { nx, ny } = grid;
  const half = passHalfWidth(width, grid.cell);
  const reached = new Uint8Array(nx * ny);
  const queue: number[] = [];
  for (const k of starts) {
    if (k >= 0 && !grid.blocked[k] && !reached[k]) {
      reached[k] = 1;
      queue.push(k);
    }
  }
  for (let head = 0; head < queue.length; head++) {
    const k = queue[head]!;
    const i = k % nx;
    const j = (k - i) / nx;
    for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const a = i + di;
      const b = j + dj;
      if (a < 0 || b < 0 || a >= nx || b >= ny) continue;
      const n = b * nx + a;
      if (!reached[n] && clearance[n]! >= half) {
        reached[n] = 1;
        queue.push(n);
      }
    }
  }
  return reached;
}
