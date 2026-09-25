import { aabbsWithin, boundsOf, type Aabb } from '../geometry/aabb.js';
import { clipConvex, polygonsOverlap } from '../geometry/clip.js';
import { containsPolygon, isConvex, type Polygon } from '../geometry/polygon.js';
import { convexOverlap } from '../geometry/sat.js';
import type { Vec2 } from '../geometry/vec2.js';
import { doorPolygon, itemClearancePolygon, itemPolygon } from '../model/derive.js';
import type { Id, ItemDefinition, ItemInstance, Project } from '../model/types.js';
import type { Tick } from '../units/length.js';

export type IssueCode =
  | 'out-of-bounds'
  | 'overlap'
  | 'on-obstacle'
  | 'door-blocked'
  | 'clearance'
  | 'too-tall'
  | 'height-unknown';

export type Severity = 'error' | 'warning' | 'info';

/**
 * A design issue found in a structurally valid project.
 * Issues never block editing; they tell the user what to look at and by how much.
 */
export interface Issue {
  readonly code: IssueCode;
  readonly severity: Severity;
  /** The item first, then whatever it conflicts with. */
  readonly entityIds: readonly Id[];
  /**
   * How far off it is, in ticks, rounded up:
   * overlap/on-obstacle/door-blocked/clearance → penetration depth (how far to move apart);
   * too-tall → excess height. Absent when it cannot be expressed as one number.
   */
  readonly amount?: Tick;
  /** Region to highlight in the plan. */
  readonly evidence?: readonly Vec2[];
}

const SEVERITY: Readonly<Record<IssueCode, Severity>> = {
  'out-of-bounds': 'error',
  overlap: 'error',
  'on-obstacle': 'error',
  'door-blocked': 'error',
  'too-tall': 'error',
  clearance: 'warning',
  'height-unknown': 'info',
};

const CODE_ORDER: readonly IssueCode[] = [
  'out-of-bounds',
  'overlap',
  'on-obstacle',
  'door-blocked',
  'too-tall',
  'clearance',
  'height-unknown',
];

interface Placed {
  readonly item: ItemInstance;
  readonly definition: ItemDefinition;
  readonly body: Polygon;
  readonly bodyBox: Aabb;
  readonly zone: Polygon;
  readonly zoneBox: Aabb;
  /** Underside and top above the floor. */
  readonly bottom: Tick;
  readonly top: Tick;
}

interface Shape {
  readonly id: Id;
  readonly polygon: Polygon;
  readonly box: Aabb;
}

function issue(code: IssueCode, entityIds: Id[], amount?: number, evidence?: readonly Vec2[]): Issue {
  return {
    code,
    severity: SEVERITY[code],
    entityIds,
    ...(amount === undefined ? {} : { amount: Math.ceil(amount) }),
    ...(evidence === undefined || evidence.length === 0 ? {} : { evidence }),
  };
}

/** Where two convex shapes overlap and how deep, or undefined when they do not. */
function convexConflict(a: Polygon, b: Polygon): { depth: number; region: Vec2[] } | undefined {
  if (!isConvex(b)) return undefined; // concave obstacles: the caller falls back to highlighting the item
  const { overlaps, depth } = convexOverlap(a, b);
  return overlaps ? { depth, region: clipConvex(a, b) } : undefined;
}

/**
 * Find every design issue in a structurally valid project (see `validateProject`).
 * Deterministic: same project, same issues in the same order.
 */
export function checkProject(project: Project): Issue[] {
  const { space } = project;
  const issues: Issue[] = [];

  const placed: Placed[] = Object.values(project.items)
    .sort((a, b) => compareIds([a.id], [b.id]))
    .map((item) => {
      const definition = project.catalog[item.definitionId]!;
      const body = itemPolygon(item, definition);
      const zone = itemClearancePolygon(item, definition);
      const bottom = item.elevation ?? 0;
      const top = bottom + definition.size.h;
      return { item, definition, body, bodyBox: boundsOf(body), zone, zoneBox: boundsOf(zone), bottom, top };
    });
  const obstacles: Shape[] = space.obstacles.map((o) => ({ id: o.id, polygon: o.polygon, box: boundsOf(o.polygon) }));
  const doors: Shape[] = space.doors.map((d) => {
    const polygon = doorPolygon(d);
    return { id: d.id, polygon, box: boundsOf(polygon) };
  });

  for (const p of placed) {
    const id = p.item.id;

    if (!containsPolygon(space.boundary, p.body)) issues.push(issue('out-of-bounds', [id], undefined, p.body));

    for (const o of obstacles) {
      if (!aabbsWithin(p.bodyBox, o.box) || !polygonsOverlap(p.body, o.polygon)) continue;
      const conflict = convexConflict(p.body, o.polygon);
      issues.push(issue('on-obstacle', [id, o.id], conflict?.depth, conflict?.region ?? p.body));
    }

    for (const d of doors) {
      if (!aabbsWithin(p.bodyBox, d.box)) continue;
      const conflict = convexConflict(p.body, d.polygon);
      if (conflict) issues.push(issue('door-blocked', [id, d.id], conflict.depth, conflict.region));
    }

    if (space.ceilingHeight !== undefined && p.top > space.ceilingHeight) {
      issues.push(issue('too-tall', [id], p.top - space.ceilingHeight));
    }

    // Clearance: the zone must stay inside the room and free of other items and obstacles.
    // Two clearance zones meeting is fine (a shared aisle); activity packs may say otherwise.
    const hasClearance = Object.values(p.definition.clearance).some((side) => side > 0);
    if (hasClearance) {
      if (!containsPolygon(space.boundary, p.zone) && containsPolygon(space.boundary, p.body)) {
        issues.push(issue('clearance', [id], undefined, p.zone)); // against a wall: only the item is named
      }
      for (const other of placed) {
        if (other === p || !stacked(p, other) || !aabbsWithin(p.zoneBox, other.bodyBox)) continue;
        if (convexOverlap(p.body, other.body).overlaps) continue; // already reported as overlap
        const conflict = convexConflict(p.zone, other.body);
        if (conflict) issues.push(issue('clearance', [id, other.item.id], conflict.depth, conflict.region));
      }
      for (const o of obstacles) {
        if (!aabbsWithin(p.zoneBox, o.box) || polygonsOverlap(p.body, o.polygon)) continue;
        if (!polygonsOverlap(p.zone, o.polygon)) continue;
        const conflict = convexConflict(p.zone, o.polygon);
        issues.push(issue('clearance', [id, o.id], conflict?.depth, conflict?.region ?? p.zone));
      }
    }
  }

  for (let i = 0; i < placed.length; i++) {
    for (let j = i + 1; j < placed.length; j++) {
      const a = placed[i]!;
      const b = placed[j]!;
      if (!stacked(a, b) || !aabbsWithin(a.bodyBox, b.bodyBox)) continue;
      const conflict = convexConflict(a.body, b.body);
      if (conflict) issues.push(issue('overlap', [a.item.id, b.item.id], conflict.depth, conflict.region));
    }
  }

  if (space.ceilingHeight === undefined && placed.length > 0) issues.push(issue('height-unknown', []));

  return issues.sort(
    (a, b) =>
      CODE_ORDER.indexOf(a.code) - CODE_ORDER.indexOf(b.code) ||
      compareIds(a.entityIds, b.entityIds),
  );
}

/**
 * True when two items share some height, so they can collide. An item hung above another
 * (a lamp over a table, a shelf over a desk) does not clash with it or take its clearance.
 * Doors, columns and blocked zones are still checked at any height: the core does not know
 * how tall a door opening is, so it stays on the safe side.
 */
function stacked(a: Placed, b: Placed): boolean {
  return a.bottom < b.top && b.bottom < a.top;
}

/** Plain code-unit comparison: identical on every machine, unlike locale-aware sorting. */
function compareIds(a: readonly Id[], b: readonly Id[]): number {
  const x = a.join('\u0000');
  const y = b.join('\u0000');
  return x < y ? -1 : x > y ? 1 : 0;
}

/** True when nothing of severity "error" remains. */
export function hasErrors(issues: readonly Issue[]): boolean {
  return issues.some((i) => i.severity === 'error');
}
