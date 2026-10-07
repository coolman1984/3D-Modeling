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

/** A wall face an item can hang on: from `a` to `b`, with `normal` (unit) pointing into the room. */
interface WallFace {
  readonly a: Vec2;
  readonly b: Vec2;
  readonly normal: Vec2;
}

/** The room's walls and both long faces of every partition (an item of category "wall"). */
function wallFaces(project: Project): WallFace[] {
  const faces: WallFace[] = [];
  const outline = project.space.boundary;
  // Inside is to the left of each edge of a counter-clockwise outline.
  const ccw = outline.reduce((sum, p, i) => sum + (p.x * outline[(i + 1) % outline.length]!.y - outline[(i + 1) % outline.length]!.x * p.y), 0) > 0;
  outline.forEach((a, i) => {
    const b = outline[(i + 1) % outline.length]!;
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    if (len === 0) return;
    const left = { x: -(b.y - a.y) / len, y: (b.x - a.x) / len };
    faces.push({ a, b, normal: ccw ? left : { x: -left.x, y: -left.y } });
  });
  for (const item of Object.values(project.items)) {
    const definition = project.catalog[item.definitionId];
    if (definition?.category !== 'wall') continue;
    const body = itemPolygon(item, definition);
    body.forEach((a, i) => {
      const b = body[(i + 1) % body.length]!;
      const len = Math.hypot(b.x - a.x, b.y - a.y);
      if (len < definition.size.w * 0.9) return; // only the long faces
      const mid = { x: (a.x + b.x) / 2 - item.position.x, y: (a.y + b.y) / 2 - item.position.y };
      const m = Math.hypot(mid.x, mid.y) || 1;
      faces.push({ a, b, normal: { x: mid.x / m, y: mid.y / m } });
    });
  }
  return faces;
}

/**
 * Where a wall-mounted piece (meta `mount: 'wall'`: art, a mirror, a TV) goes when placed near
 * `spot`: back against the nearest wall face, front to the room, centred on the point of the wall
 * nearest the spot but kept within the wall's length and clear of doors, at the height its type
 * states. Undefined for other pieces, or when no wall has room.
 */
export function wallPlacement(project: Project, definition: ItemDefinition, spot: Vec2): { position: Vec2; rotation: number; elevation: number } | undefined {
  if (definition.meta?.mount !== 'wall') return undefined;
  let best: { position: Vec2; rotation: number; distance: number } | undefined;
  for (const face of wallFaces(project)) {
    const dx = face.b.x - face.a.x;
    const dy = face.b.y - face.a.y;
    const len = Math.hypot(dx, dy);
    if (len < definition.size.w) continue;
    const ux = dx / len;
    const uy = dy / len;
    const half = definition.size.w / 2;
    const wanted = Math.max(half, Math.min(len - half, (spot.x - face.a.x) * ux + (spot.y - face.a.y) * uy));
    // Rotation turns the item's front (local +y) onto the inward normal.
    const degrees = Math.round((Math.atan2(-face.normal.x, face.normal.y) * 180) / Math.PI);
    const rotation = (((degrees % 360) + 360) % 360) * 1000;
    const off = definition.size.d / 2 + 10; // 1 mm proud of the wall
    // The nearest spot along the wall that keeps clear of door openings, in 5 cm steps.
    const step = 500;
    const stops: number[] = [];
    for (let t = half; t <= len - half; t += step) stops.push(t);
    stops.push(wanted);
    stops.sort((p, q) => Math.abs(p - wanted) - Math.abs(q - wanted) || p - q);
    for (const along of stops) {
      const onWall = { x: face.a.x + ux * along, y: face.a.y + uy * along };
      const distance = Math.hypot(spot.x - onWall.x, spot.y - onWall.y);
      if (best && distance >= best.distance) break; // farther along only gets farther
      const position = { x: Math.round(onWall.x + face.normal.x * off), y: Math.round(onWall.y + face.normal.y * off) };
      const body = itemPolygon({ id: '', definitionId: definition.id, position, rotation, locked: false }, definition);
      if (project.space.doors.some((door) => convexOverlap(body, doorPolygon(door)).overlaps)) continue;
      best = { position, rotation, distance };
      break;
    }
  }
  if (!best) return undefined;
  const elevation = typeof definition.meta.elevation === 'number' ? definition.meta.elevation : 0;
  return { position: best.position, rotation: best.rotation, elevation };
}
