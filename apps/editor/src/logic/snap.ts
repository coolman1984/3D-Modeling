import { boundsOf, MAX_COORDINATE, roundHalfAwayFromZero, type Aabb, type Id, type Project, type Vec2 } from '@space-planner/core';
import { movable, selectionBounds } from './transform.js';

/** Round a world point to the nearest multiple of `step` ticks (1 when snapping is off). */
export function snapPoint(p: Vec2, step: number): Vec2 {
  const s = Math.max(1, Math.round(step));
  const snap = (value: number) =>
    Math.max(-MAX_COORDINATE, Math.min(MAX_COORDINATE, roundHalfAwayFromZero(value / s) * s));
  return { x: snap(p.x), y: snap(p.y) };
}

/** Round an angle (millidegrees) to the nearest multiple of `step`. */
export function snapAngle(angle: number, step: number): number {
  const s = Math.max(1, Math.round(step));
  return roundHalfAwayFromZero(angle / s) * s;
}

/** A guide line to draw while dragging: a vertical line at x = `at` (axis 'x') or horizontal at y = `at`. */
export interface Guide {
  readonly axis: 'x' | 'y';
  readonly at: number;
  readonly from: number;
  readonly to: number;
}

export interface SnapOptions {
  /** Grid step in ticks; 1 turns grid snapping off. */
  readonly grid: number;
  /** Line up with the edges and centres of other items and walls. */
  readonly guides: boolean;
  /** How close (in ticks) an edge must come before it jumps to a guide. */
  readonly threshold: number;
}

interface Line {
  readonly at: number;
  readonly from: number;
  readonly to: number;
}

/**
 * Where a dragged selection should land, like the smart guides of drawing apps:
 * an edge or centre of the selection that comes within `threshold` of an edge or centre of
 * another item, a column or a wall jumps onto it and a guide line is shown; otherwise the
 * leading item's centre snaps to the grid. `lock` keeps the move on one axis.
 */
export function snapMove(
  project: Project,
  ids: readonly Id[],
  raw: Vec2,
  options: SnapOptions,
  lock: 'x' | 'y' | null = null,
): { readonly delta: Vec2; readonly guides: readonly Guide[] } {
  const wanted = { x: lock === 'y' ? 0 : raw.x, y: lock === 'x' ? 0 : raw.y };
  const base = selectionBounds(project, ids);
  const lead = movable(project, ids)[0];
  if (!base || !lead) return { delta: { x: Math.round(wanted.x), y: Math.round(wanted.y) }, guides: [] };

  const others = new Set(ids);
  const boxes: Aabb[] = [boundsOf(project.space.boundary), ...project.space.obstacles.map((o) => boundsOf(o.polygon))];
  for (const item of Object.values(project.items)) {
    if (others.has(item.id)) continue;
    const box = selectionBounds(project, [item.id]);
    if (box) boxes.push(box);
  }
  const xs: Line[] = boxes.flatMap((b) => [b.minX, (b.minX + b.maxX) / 2, b.maxX].map((at) => ({ at, from: b.minY, to: b.maxY })));
  const ys: Line[] = boxes.flatMap((b) => [b.minY, (b.minY + b.maxY) / 2, b.maxY].map((at) => ({ at, from: b.minX, to: b.maxX })));

  const axis = (a: 'x' | 'y') => {
    const d = wanted[a];
    if (lock !== null && lock !== a) return { d: 0, guides: [] as Guide[] };
    const [lo, hi] = a === 'x' ? [base.minX, base.maxX] : [base.minY, base.maxY];
    const anchors = [lo + d, (lo + hi) / 2 + d, hi + d];
    if (options.guides) {
      let best: { shift: number; distance: number } | null = null;
      for (const line of a === 'x' ? xs : ys) {
        for (const anchor of anchors) {
          const distance = Math.abs(line.at - anchor);
          if (distance <= options.threshold && (!best || distance < best.distance)) best = { shift: line.at - anchor, distance };
        }
      }
      if (best) {
        const snapped = roundHalfAwayFromZero(d + best.shift);
        const moved = [lo + snapped, (lo + hi) / 2 + snapped, hi + snapped];
        const [pLo, pHi] = a === 'x' ? [base.minY + wanted.y, base.maxY + wanted.y] : [base.minX + wanted.x, base.maxX + wanted.x];
        const guides = (a === 'x' ? xs : ys)
          .filter((line) => moved.some((m) => Math.abs(m - line.at) <= 1))
          .map((line) => ({ axis: a, at: line.at, from: Math.min(line.from, pLo), to: Math.max(line.to, pHi) }));
        return { d: snapped, guides };
      }
    }
    const start = lead.position[a];
    return { d: snapPoint({ x: start + d, y: 0 }, options.grid).x - start, guides: [] as Guide[] };
  };

  const x = axis('x');
  const y = axis('y');
  return { delta: { x: x.d, y: y.d }, guides: [...dedupe(x.guides), ...dedupe(y.guides)] };
}

function dedupe(guides: readonly Guide[]): Guide[] {
  const byLine = new Map<number, Guide>();
  for (const g of guides) {
    const seen = byLine.get(g.at);
    byLine.set(g.at, seen ? { ...g, from: Math.min(seen.from, g.from), to: Math.max(seen.to, g.to) } : g);
  }
  return [...byLine.values()].sort((a, b) => a.at - b.at);
}
