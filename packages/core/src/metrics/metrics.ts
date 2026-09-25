import { aabbsWithin, boundsOf } from '../geometry/aabb.js';
import { clipConvex } from '../geometry/clip.js';
import { area } from '../geometry/polygon.js';
import { itemPolygon } from '../model/derive.js';
import type { Id, Project, Size3 } from '../model/types.js';
import type { SquareTicks } from '../units/area.js';

/** One line of the bill of materials: how many of each catalog item are placed. */
export interface BomLine {
  readonly definitionId: Id;
  readonly name: string;
  readonly category: string;
  readonly size: Size3;
  readonly count: number;
  readonly seats: number;
}

export interface Metrics {
  readonly itemCount: number;
  readonly seats: number;
  /** Area inside the boundary, minus columns and blocked zones (assumed to lie inside the boundary). */
  readonly floorArea: SquareTicks;
  /** Floor covered by item footprints; where items overlap the shared area is counted once. */
  readonly occupiedArea: SquareTicks;
  /**
   * Footprint area counted twice because items overlap in plan. Zero in any design without
   * overlap errors, unless items are hung above one another (see `ItemInstance.elevation`).
   */
  readonly overlapArea: SquareTicks;
  /** occupiedArea / floorArea, between 0 and 1 (0 for an empty floor). */
  readonly occupancy: number;
  readonly bom: readonly BomLine[];
}

/**
 * Headline numbers for a structurally valid project.
 * Overlaps are removed pairwise, which is exact unless three or more items share
 * the same spot — a design that `checkProject` already reports as an error.
 */
export function measureProject(project: Project): Metrics {
  const items = Object.values(project.items);
  const counts = new Map<Id, number>();
  for (const item of items) counts.set(item.definitionId, (counts.get(item.definitionId) ?? 0) + 1);

  const bom: BomLine[] = [...counts]
    .map(([definitionId, count]) => {
      const d = project.catalog[definitionId]!;
      return { definitionId, name: d.name, category: d.category, size: d.size, count, seats: (d.seats ?? 0) * count };
    })
    .sort((a, b) => cmp(a.category, b.category) || cmp(a.name, b.name) || cmp(a.definitionId, b.definitionId));

  const bodies = items.map((item) => {
    const polygon = itemPolygon(item, project.catalog[item.definitionId]!);
    return { polygon, box: boundsOf(polygon) };
  });
  const footprintSum = bodies.reduce((sum, b) => sum + area(b.polygon), 0);
  let overlapArea = 0;
  for (let i = 0; i < bodies.length; i++) {
    for (let j = i + 1; j < bodies.length; j++) {
      const a = bodies[i]!;
      const b = bodies[j]!;
      if (aabbsWithin(a.box, b.box)) overlapArea += area(clipConvex(a.polygon, b.polygon));
    }
  }

  const { boundary, obstacles } = project.space;
  const floorArea = Math.max(0, area(boundary) - obstacles.reduce((sum, o) => sum + area(o.polygon), 0));
  const occupiedArea = footprintSum - overlapArea;

  return {
    itemCount: items.length,
    seats: bom.reduce((sum, line) => sum + line.seats, 0),
    floorArea,
    occupiedArea,
    overlapArea,
    occupancy: floorArea > 0 ? Math.min(1, occupiedArea / floorArea) : 0,
    bom,
  };
}

function cmp(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
