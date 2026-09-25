import { boundsOf, itemPolygon, type Polygon, type Project, type Vec2 } from '@space-planner/core';

/** A derived floor grid; cell centres are at min + (index - 0.5) * cell. */
export interface FloorRaster {
  readonly minX: number;
  readonly minY: number;
  readonly nx: number;
  readonly ny: number;
  readonly cell: number;
  readonly blocked: Uint8Array;
  readonly clearance: Float64Array;
  point(i: number, j: number): Vec2;
  index(point: Vec2): number | undefined;
}

/** Scanline fill shared by the hall's escape check and industrial movement grids. */
export function paintPolygon(polygon: readonly Vec2[], grid: Uint8Array, nx: number, ny: number, cell: number, minX: number, minY: number, value: 0 | 1): void {
  const bounds = boundsOf(polygon);
  const j0 = Math.max(0, Math.floor((bounds.minY - minY) / cell));
  const j1 = Math.min(ny - 1, Math.ceil((bounds.maxY - minY) / cell) + 1);
  const xs: number[] = [];
  for (let j = j0; j <= j1; j++) {
    const y = minY + (j - 0.5) * cell;
    xs.length = 0;
    for (let k = 0; k < polygon.length; k++) {
      const p = polygon[k]!;
      const q = polygon[(k + 1) % polygon.length]!;
      if ((p.y <= y && y < q.y) || (q.y <= y && y < p.y)) xs.push(p.x + ((y - p.y) * (q.x - p.x)) / (q.y - p.y));
    }
    xs.sort((a, b) => a - b);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const i0 = Math.max(0, Math.ceil((xs[k]! - minX) / cell + 0.5));
      const i1 = Math.min(nx - 1, Math.floor((xs[k + 1]! - minX) / cell + 0.5));
      for (let i = i0; i <= i1; i++) grid[j * nx + i] = value;
    }
  }
}

/** Exact Euclidean distance, in cells, to the nearest blocked cell centre. */
export function distanceToBlocked(blocked: Uint8Array, nx: number, ny: number): Float64Array {
  const inf = 1e20;
  const grid = new Float64Array(nx * ny);
  for (let k = 0; k < grid.length; k++) grid[k] = blocked[k] ? 0 : inf;
  const size = Math.max(nx, ny);
  const f = new Float64Array(size);
  const d = new Float64Array(size);
  const v = new Int32Array(size);
  const z = new Float64Array(size + 1);
  const pass = (n: number) => {
    let k = 0;
    v[0] = 0;
    z[0] = -inf;
    z[1] = inf;
    for (let q = 1; q < n; q++) {
      let s = (f[q]! + q * q - f[v[k]!]! - v[k]! * v[k]!) / (2 * (q - v[k]!));
      while (s <= z[k]!) {
        k--;
        s = (f[q]! + q * q - f[v[k]!]! - v[k]! * v[k]!) / (2 * (q - v[k]!));
      }
      k++;
      v[k] = q;
      z[k] = s;
      z[k + 1] = inf;
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

/** Derive a movement grid from the authoritative plan; nothing is saved on the project. */
export function floorRaster(project: Project, cell: number, extraBlocked: readonly Polygon[] = []): FloorRaster {
  if (!Number.isInteger(cell) || cell <= 0) throw new RangeError('cell must be positive integer ticks');
  const b = boundsOf(project.space.boundary);
  const nx = Math.ceil((b.maxX - b.minX) / cell) + 2;
  const ny = Math.ceil((b.maxY - b.minY) / cell) + 2;
  if (nx * ny > 2_000_000) throw new RangeError('movement grid exceeds 2 million cells');
  const blocked = new Uint8Array(nx * ny).fill(1);
  const paint = (poly: readonly Vec2[], value: 0 | 1) => paintPolygon(poly, blocked, nx, ny, cell, b.minX, b.minY, value);
  paint(project.space.boundary, 0);
  for (const obstacle of project.space.obstacles) paint(obstacle.polygon, 1);
  for (const item of Object.values(project.items)) {
    const definition = project.catalog[item.definitionId];
    if (definition && (item.elevation ?? 0) < 20_000 && definition.category !== 'floor-zone') paint(itemPolygon(item, definition), 1);
  }
  for (const polygon of extraBlocked) paint(polygon, 1);
  return {
    minX: b.minX, minY: b.minY, nx, ny, cell, blocked,
    clearance: distanceToBlocked(blocked, nx, ny),
    point: (i, j) => ({ x: b.minX + (i - 0.5) * cell, y: b.minY + (j - 0.5) * cell }),
    index(point) {
      const i = Math.floor((point.x - b.minX) / cell + 1);
      const j = Math.floor((point.y - b.minY) / cell + 1);
      return i >= 0 && j >= 0 && i < nx && j < ny ? j * nx + i : undefined;
    },
  };
}
