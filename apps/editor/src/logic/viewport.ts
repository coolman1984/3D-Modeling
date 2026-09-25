import type { Aabb, Vec2 } from '@space-planner/core';

/**
 * Maps world ticks (X east, Y north) to screen pixels (x right, y down).
 * screen.x = world.x * scale + offsetX; screen.y = -world.y * scale + offsetY.
 */
export interface Viewport {
  readonly scale: number;
  readonly offsetX: number;
  readonly offsetY: number;
}

export const MIN_SCALE = 0.0005; // 5 px per metre
export const MAX_SCALE = 0.5; // 5 px per millimetre

export function toScreen(v: Viewport, p: Vec2): Vec2 {
  return { x: p.x * v.scale + v.offsetX, y: -p.y * v.scale + v.offsetY };
}

export function toWorld(v: Viewport, p: Vec2): Vec2 {
  return { x: (p.x - v.offsetX) / v.scale, y: -(p.y - v.offsetY) / v.scale };
}

/** Fit a world box into a screen of the given size, centred, with a margin in pixels. */
export function fitViewport(bounds: Aabb, width: number, height: number, margin = 40): Viewport {
  const w = Math.max(1, bounds.maxX - bounds.minX);
  const h = Math.max(1, bounds.maxY - bounds.minY);
  const scale = clampScale(Math.min((width - 2 * margin) / w, (height - 2 * margin) / h));
  const cx = (bounds.minX + bounds.maxX) / 2;
  const cy = (bounds.minY + bounds.maxY) / 2;
  return { scale, offsetX: width / 2 - cx * scale, offsetY: height / 2 + cy * scale };
}

/** Zoom by `factor` keeping the world point under `anchor` (screen pixels) fixed. */
export function zoomAt(v: Viewport, factor: number, anchor: Vec2): Viewport {
  const scale = clampScale(v.scale * factor);
  const world = toWorld(v, anchor);
  return { scale, offsetX: anchor.x - world.x * scale, offsetY: anchor.y + world.y * scale };
}

export function panBy(v: Viewport, dx: number, dy: number): Viewport {
  return { ...v, offsetX: v.offsetX + dx, offsetY: v.offsetY + dy };
}

function clampScale(scale: number): number {
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, Number.isFinite(scale) && scale > 0 ? scale : MIN_SCALE));
}

/** SVG path data for a closed polygon in screen space. */
export function pathOf(v: Viewport, polygon: readonly Vec2[]): string {
  return (
    polygon
      .map((p, i) => {
        const s = toScreen(v, p);
        return `${i === 0 ? 'M' : 'L'}${s.x.toFixed(1)},${s.y.toFixed(1)}`;
      })
      .join('') + 'Z'
  );
}
