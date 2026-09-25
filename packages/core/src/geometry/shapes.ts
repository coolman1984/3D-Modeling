import { QUARTER_TURN, type MilliDeg } from '../units/angle.js';
import type { Tick } from '../units/length.js';
import type { Polygon } from './polygon.js';
import { add, rotate, type Vec2 } from './vec2.js';

/**
 * Local frame of an item: +X is its right, +Y is its front.
 * `width` runs along local X, `depth` along local Y.
 */
export interface Footprint {
  readonly center: Vec2;
  readonly width: Tick;
  readonly depth: Tick;
  readonly rotation: MilliDeg;
}

export interface Clearance {
  readonly front: Tick;
  readonly back: Tick;
  readonly left: Tick;
  readonly right: Tick;
}

/** Corners of a rotated rectangle, counter-clockwise, starting back-left. */
export function rectangle({ center, width, depth, rotation }: Footprint): Polygon {
  const hw = width / 2;
  const hd = depth / 2;
  return [
    { x: -hw, y: -hd },
    { x: hw, y: -hd },
    { x: hw, y: hd },
    { x: -hw, y: hd },
  ].map((corner) => add(center, rotate(corner, rotation)));
}

const ELLIPSE_SEGMENTS = 32;

/**
 * An ellipse inscribed in the footprint, as a convex polygon that fully contains the true
 * curve (vertices sit on a slightly larger ellipse), so a clash is never missed.
 */
export function ellipse({ center, width, depth, rotation }: Footprint): Polygon {
  const grow = 1 / Math.cos(Math.PI / ELLIPSE_SEGMENTS);
  const points: Vec2[] = [];
  for (let i = 0; i < ELLIPSE_SEGMENTS; i++) {
    const t = (2 * Math.PI * i) / ELLIPSE_SEGMENTS;
    points.push(add(center, rotate({ x: (width / 2) * grow * Math.cos(t), y: (depth / 2) * grow * Math.sin(t) }, rotation)));
  }
  return points;
}

/** The footprint grown by its clearance on each side; the clearance turns with the item. */
export function clearanceRectangle(footprint: Footprint, clearance: Clearance): Polygon {
  return rectangle(grownFootprint(footprint, clearance));
}

/** Round items keep a round clearance zone: the ellipse grown by the clearance on each side. */
export function clearanceEllipse(footprint: Footprint, clearance: Clearance): Polygon {
  return ellipse(grownFootprint(footprint, clearance));
}

function grownFootprint(footprint: Footprint, clearance: Clearance): Footprint {
  const offset = rotate(
    { x: (clearance.right - clearance.left) / 2, y: (clearance.front - clearance.back) / 2 },
    footprint.rotation,
  );
  return {
    center: add(footprint.center, offset),
    width: footprint.width + clearance.left + clearance.right,
    depth: footprint.depth + clearance.front + clearance.back,
    rotation: footprint.rotation,
  };
}

export interface DoorSwing {
  readonly hinge: Vec2;
  readonly width: Tick;
  /** Direction from the hinge along the closed leaf. */
  readonly angle: MilliDeg;
  /** 'left' opens counter-clockwise from the closed leaf, 'right' clockwise. */
  readonly swing: 'left' | 'right';
}

const ARC_SEGMENTS = 8;

/**
 * The quarter-circle swept by the door leaf, as a convex polygon that fully
 * contains the true arc, so a blocked door is never reported as clear.
 * Between the two leaf positions the outline follows tangents to the arc:
 * tangents at k·step and (k+1)·step meet at angle (k+½)·step, radius r / cos(step/2).
 */
export function doorSwingPolygon({ hinge, width, angle, swing }: DoorSwing): Polygon {
  const step = QUARTER_TURN / ARC_SEGMENTS;
  const radius = width / Math.cos(((step / 1000) * Math.PI) / 360);
  const direction = swing === 'left' ? 1 : -1;
  const arc: Vec2[] = [add(hinge, rotate({ x: width, y: 0 }, angle))];
  for (let i = 0; i < ARC_SEGMENTS; i++) {
    arc.push(add(hinge, rotate({ x: radius, y: 0 }, angle + direction * (i * step + step / 2))));
  }
  arc.push(add(hinge, rotate({ x: width, y: 0 }, angle + direction * QUARTER_TURN)));
  const polygon = [hinge, ...arc];
  return swing === 'left' ? polygon : polygon.reverse();
}
