import { aabbsWithin, type Aabb } from './aabb.js';

/**
 * Finds the boxes near a query box without looking at every box. Derived from the project and
 * rebuilt when needed; never stored. Results are candidates: exact geometry still decides.
 */
export interface SpatialIndex {
  /** Indices of boxes within `margin` of `box` (touching counts), in ascending order. */
  query(box: Aabb, margin?: number): number[];
}

/** Boxes spanning more cells than this are kept in a short list checked on every query. */
const MAX_CELLS_PER_BOX = 64;
/** Cell coordinates are offset so negative cells get non-negative keys (world range is ±1 km). */
const OFFSET = 2 ** 24;

/**
 * A uniform grid over bounding boxes. The cell size defaults to the median box size, so most
 * boxes touch one to four cells and a query looks at a handful of neighbours. Deterministic:
 * the same boxes always give the same answers in the same order.
 */
export function gridIndex(boxes: readonly Aabb[], cellSize?: number): SpatialIndex {
  const size = Math.max(1, cellSize ?? medianSize(boxes));
  const cells = new Map<number, number[]>();
  const large: number[] = [];
  const cellOf = (v: number) => Math.floor(v / size);
  const key = (cx: number, cy: number) => (cx + OFFSET) * 2 ** 26 + (cy + OFFSET);

  boxes.forEach((b, i) => {
    const x0 = cellOf(b.minX);
    const x1 = cellOf(b.maxX);
    const y0 = cellOf(b.minY);
    const y1 = cellOf(b.maxY);
    if ((x1 - x0 + 1) * (y1 - y0 + 1) > MAX_CELLS_PER_BOX) {
      large.push(i);
      return;
    }
    for (let cx = x0; cx <= x1; cx++) {
      for (let cy = y0; cy <= y1; cy++) {
        const k = key(cx, cy);
        const list = cells.get(k);
        if (list) list.push(i);
        else cells.set(k, [i]);
      }
    }
  });

  const seen = new Uint32Array(boxes.length);
  let stamp = 0;
  return {
    query(box, margin = 0) {
      stamp++;
      const found: number[] = [];
      const take = (i: number) => {
        if (seen[i] === stamp) return;
        seen[i] = stamp;
        if (aabbsWithin(box, boxes[i]!, margin)) found.push(i);
      };
      const x0 = cellOf(box.minX - margin);
      const x1 = cellOf(box.maxX + margin);
      const y0 = cellOf(box.minY - margin);
      const y1 = cellOf(box.maxY + margin);
      if ((x1 - x0 + 1) * (y1 - y0 + 1) > cells.size) {
        // A query wider than the occupied grid: a straight scan is cheaper.
        for (let i = 0; i < boxes.length; i++) take(i);
      } else {
        for (let cx = x0; cx <= x1; cx++) {
          for (let cy = y0; cy <= y1; cy++) {
            const list = cells.get(key(cx, cy));
            if (list) for (const i of list) take(i);
          }
        }
        for (const i of large) take(i);
      }
      return found.sort((a, b) => a - b);
    },
  };
}

function medianSize(boxes: readonly Aabb[]): number {
  if (boxes.length === 0) return 1;
  const sizes = boxes.map((b) => Math.max(b.maxX - b.minX, b.maxY - b.minY)).sort((a, b) => a - b);
  return sizes[Math.floor(sizes.length / 2)]!;
}
