import {
  aabbsWithin,
  boundsOf,
  containsPolygon,
  convexOverlap,
  doorPolygon,
  itemClearancePolygon,
  itemPolygon,
  polygonsOverlap,
  type ItemDefinition,
  type ItemInstance,
  type Project,
  type Vec2,
} from '@space-planner/core';
import { snapPoint } from './snap.js';

/**
 * True when an item placed here would raise no design issue of its own:
 * body and clearance inside the room, clear of obstacles, doors and other items,
 * and not inside another item's clearance.
 */
export function fitsFreely(project: Project, candidate: ItemInstance, definition: ItemDefinition): boolean {
  const body = itemPolygon(candidate, definition);
  const zone = itemClearancePolygon(candidate, definition);
  const { space } = project;
  if (!containsPolygon(space.boundary, zone)) return false;
  const zoneBox = boundsOf(zone);
  if (space.ceilingHeight !== undefined && definition.size.h > space.ceilingHeight) return false;
  for (const o of space.obstacles) {
    if (aabbsWithin(zoneBox, boundsOf(o.polygon)) && polygonsOverlap(zone, o.polygon)) return false;
  }
  for (const d of space.doors) {
    if (convexOverlap(body, doorPolygon(d)).overlaps) return false;
  }
  for (const other of Object.values(project.items)) {
    const otherDefinition = project.catalog[other.definitionId];
    if (!otherDefinition || other.id === candidate.id) continue;
    const otherZone = itemClearancePolygon(other, otherDefinition);
    if (!aabbsWithin(zoneBox, boundsOf(otherZone))) continue;
    const otherBody = itemPolygon(other, otherDefinition);
    if (convexOverlap(zone, otherBody).overlaps || convexOverlap(otherZone, body).overlaps) return false;
  }
  return true;
}

/**
 * The free spot nearest to `start`, searching rings of grid points outward.
 * Falls back to `start` when the room has no free spot within reach.
 */
export function findFreeSpot(
  project: Project,
  item: Omit<ItemInstance, 'position'>,
  definition: ItemDefinition,
  start: Vec2,
  step: number,
  maxRings = 60,
): Vec2 {
  const origin = snapPoint(start, step);
  for (let ring = 0; ring <= maxRings; ring++) {
    const candidates: Vec2[] = [];
    for (let i = -ring; i <= ring; i++) {
      for (let j = -ring; j <= ring; j++) {
        if (Math.max(Math.abs(i), Math.abs(j)) !== ring) continue;
        candidates.push({ x: origin.x + i * step, y: origin.y + j * step });
      }
    }
    candidates.sort((a, b) => dist2(a, origin) - dist2(b, origin) || a.x - b.x || a.y - b.y);
    for (const position of candidates) {
      if (fitsFreely(project, { ...item, position }, definition)) return position;
    }
  }
  return origin;
}

function dist2(a: Vec2, b: Vec2): number {
  return (a.x - b.x) ** 2 + (a.y - b.y) ** 2;
}
