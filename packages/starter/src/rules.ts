import {
  boundsOf,
  fromUnit,
  itemPolygon,
  locatePoint,
  pointSegmentDistance,
  measureProject,
  rotate,
  toSquareMetres,
  type Id,
  type Project,
  type Tick,
  type Vec2,
} from '@space-planner/core';

/**
 * Rules shared by every activity pack: walkways to the doors, exits and door width, floor per
 * person. General building-planning guidance, not a civil-defence approval.
 */

const cm = (v: number) => fromUnit(v, 'cm');

/** Rule codes of every pack; each pack uses the ones that apply to it. */
export type RuleCode = 'walkway' | 'area-per-guest' | 'area-per-person' | 'workstations' | 'exits' | 'door-width';
export type RuleStatus = 'pass' | 'fail' | 'unknown';

/**
 * Where a rule's threshold comes from. Nothing ships as a verified regulation: that needs a person
 * to check it against the law of a place. Guidance is labelled as guidance.
 */
export interface RuleSource {
  readonly kind: 'engineering' | 'company-policy' | 'common-guidance' | 'verified-regulation';
  readonly title: string;
  readonly jurisdiction?: string;
  readonly version?: string;
  /** ISO date the values took effect. */
  readonly effective?: string;
  /** Stable id of the rule set, e.g. "starter.hall.v1". */
  readonly ruleSet: string;
}

const EGRESS: RuleSource = {
  kind: 'common-guidance',
  title: 'Exit count and door width per occupant as found in widely used building codes; not checked against a local code',
  ruleSet: 'starter.egress.v1',
};

/** The source of every starter rule, by rule code. */
export const RULE_SOURCES: Readonly<Record<RuleCode, RuleSource>> = {
  walkway: { kind: 'common-guidance', title: 'Clear walkway from every seat to a door, width by planning style', ruleSet: 'starter.egress.v1' },
  exits: EGRESS,
  'door-width': EGRESS,
  'area-per-guest': { kind: 'common-guidance', title: 'Event planning guidance: floor area per guest by event style', ruleSet: 'starter.hall.v1' },
  'area-per-person': { kind: 'common-guidance', title: 'Office planning guidance: floor area per person by office style', ruleSet: 'starter.office.v1' },
  workstations: { kind: 'engineering', title: 'A seat within reach in front of every desk', ruleSet: 'starter.office.v1' },
};

export interface RuleResult {
  readonly code: RuleCode;
  readonly status: RuleStatus;
  /** What was measured and what the rule asks for, in the rule's own unit (see `unit`). */
  readonly measured?: number;
  readonly required?: number;
  readonly unit: 'ticks' | 'square-metres' | 'doors' | 'seats' | 'desks';
  /** Items the rule is about: the seats with no way out, the desks with no chair. */
  readonly entityIds: readonly Id[];
  /** Why the result is "unknown", when it is. */
  readonly reason?: 'no-seats' | 'no-doors' | 'no-desks';
  /** Where the threshold comes from; filled in by `checkPack`. */
  readonly source?: RuleSource;
}

/** Guests per exit door count, as in common building codes: over 49 need two, over 500 three, over 1000 four. */
export function exitsNeeded(guests: number): number {
  if (guests > 1000) return 4;
  if (guests > 500) return 3;
  if (guests > 49) return 2;
  return 1;
}

/** Door width each guest needs to get out: 5 mm per person (0.2 inch in common codes). */
export const DOOR_WIDTH_PER_GUEST = fromUnit(5, 'mm');

/** How far from a walkway a seat's edge can be and still let its guest step into it (a pulled-out chair). */
export const SEAT_REACH = cm(50);

/** Items hung this high leave the floor free to walk under. */
export const HEAD_ROOM = cm(200);

/** Items whose type has seats, sorted by id. */
export function seatIdsOf(project: Project): Id[] {
  return Object.values(project.items)
    .filter((i) => (project.catalog[i.definitionId]?.seats ?? 0) > 0)
    .map((i) => i.id)
    .sort();
}

const NO_SEATS = { status: 'unknown' as const, reason: 'no-seats' as const, entityIds: [] };

/** Every seat reaches a door by a walkway at least `width` wide. */
export function walkwayRule(project: Project, width: Tick): RuleResult {
  const seatIds = seatIdsOf(project);
  if (seatIds.length === 0) return { code: 'walkway', unit: 'ticks', required: width, ...NO_SEATS };
  if (project.space.doors.length === 0) return { code: 'walkway', unit: 'ticks', required: width, status: 'unknown', reason: 'no-doors', entityIds: [] };
  const cutOff = seatsWithoutWayOut(project, width, seatIds);
  return { code: 'walkway', unit: 'ticks', required: width, status: cutOff.length === 0 ? 'pass' : 'fail', measured: seatIds.length - cutOff.length, entityIds: cutOff };
}

/** Floor area per person (seat), rounded to hundredths of a square metre, at least `required`. */
export function areaRule(code: 'area-per-guest' | 'area-per-person', project: Project, required: number): RuleResult {
  const metrics = measureProject(project);
  if (metrics.seats === 0) return { code, unit: 'square-metres', required, ...NO_SEATS };
  const measured = Math.round((toSquareMetres(metrics.floorArea) / metrics.seats) * 100) / 100;
  return { code, unit: 'square-metres', required, measured, status: measured >= required ? 'pass' : 'fail', entityIds: [] };
}

/** Enough doors, and enough total door width, for the number of people (seats). */
export function exitRules(project: Project): [RuleResult, RuleResult] {
  const people = measureProject(project).seats;
  const doors = project.space.doors;
  const totalWidth = doors.reduce((sum, d) => sum + d.width, 0);
  if (people === 0) {
    return [
      { code: 'exits', unit: 'doors', required: 1, measured: doors.length, ...NO_SEATS },
      { code: 'door-width', unit: 'ticks', measured: totalWidth, ...NO_SEATS },
    ];
  }
  const needed = exitsNeeded(people);
  const width = people * DOOR_WIDTH_PER_GUEST;
  return [
    { code: 'exits', unit: 'doors', required: needed, measured: doors.length, status: doors.length >= needed ? 'pass' : 'fail', entityIds: [] },
    { code: 'door-width', unit: 'ticks', required: width, measured: totalWidth, status: totalWidth >= width ? 'pass' : 'fail', entityIds: [] },
  ];
}

/**
 * Seats with no walkway of the given width to any door.
 *
 * The floor is sampled on a grid (5 cm, coarser for very large halls). Cells under walls,
 * columns, blocked zones and furniture below head room are blocked. A walkway of width W passes
 * through a free cell when the nearest blocked cell is at least W/2 away (exact Euclidean
 * distance transform). Walking starts in the doorway, spreads through such cells, and a seat
 * is reached when a walkway cell's centre lies within W/2 + SEAT_REACH of the seat's outline
 * (big seats such as a sofa or the kosha are reached from any side).
 */
export function seatsWithoutWayOut(project: Project, width: Tick, seatIds: readonly Id[]): Id[] {
  const room = boundsOf(project.space.boundary);
  const spanX = room.maxX - room.minX;
  const spanY = room.maxY - room.minY;
  const cell = Math.max(cm(5), Math.ceil(Math.sqrt((spanX * spanY) / 1_500_000)));
  const nx = Math.ceil(spanX / cell) + 2;
  const ny = Math.ceil(spanY / cell) + 2;
  const index = (i: number, j: number) => j * nx + i;

  // Rasterise by scanlines: for each row of cell centres, find where the outline crosses it and
  // mark the cells whose centres lie between crossings (even-odd rule).
  const paint = (polygon: readonly Vec2[], grid: Uint8Array, value: 0 | 1) => {
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
        for (let i = i0; i <= i1; i++) grid[j * nx + i] = value;
      }
    }
  };
  const blocked = new Uint8Array(nx * ny).fill(1);
  paint(project.space.boundary, blocked, 0);
  const fill = (polygon: readonly Vec2[]) => paint(polygon, blocked, 1);
  for (const o of project.space.obstacles) fill(o.polygon);
  for (const item of Object.values(project.items)) {
    const definition = project.catalog[item.definitionId];
    if (definition && (item.elevation ?? 0) < HEAD_ROOM) fill(itemPolygon(item, definition));
  }

  const clearance = distanceToBlocked(blocked, nx, ny); // in cells
  // A blocked cell's edge can be up to half a cell nearer than its centre: ask for that much
  // more, so sampling can only err on the safe side (a 1 m gap passes 90 cm, 85 cm does not).
  const half = width / 2 / cell + 0.5;

  // Doorways: the cells just inside each door opening, as deep as half the walkway plus a cell.
  const reached = new Uint8Array(nx * ny);
  const queue: number[] = [];
  for (const door of project.space.doors) {
    const along = rotate({ x: 1, y: 0 }, door.angle);
    const inward = rotate(along, door.swing === 'left' ? 90_000 : -90_000);
    for (let t = cell / 2; t < door.width; t += cell / 2) {
      for (let depth = cell / 2; depth <= width / 2 + cell; depth += cell / 2) {
        const p = { x: door.hinge.x + along.x * t + inward.x * depth, y: door.hinge.y + along.y * t + inward.y * depth };
        const i = Math.floor((p.x - room.minX) / cell + 1);
        const j = Math.floor((p.y - room.minY) / cell + 1);
        if (i < 0 || j < 0 || i >= nx || j >= ny) continue;
        const k = index(i, j);
        if (!blocked[k] && !reached[k]) {
          reached[k] = 1;
          queue.push(k);
        }
      }
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
      const n = index(a, b);
      if (!reached[n] && clearance[n]! >= half) {
        reached[n] = 1;
        queue.push(n);
      }
    }
  }

  const reach = width / 2 + SEAT_REACH;
  const cutOff: Id[] = [];
  for (const id of seatIds) {
    const item = project.items[id];
    const definition = item && project.catalog[item.definitionId];
    if (!item || !definition) continue;
    const body = itemPolygon(item, definition);
    const b = boundsOf(body);
    let found = false;
    const j0 = Math.max(0, Math.floor((b.minY - reach - room.minY) / cell));
    const j1 = Math.min(ny - 1, Math.ceil((b.maxY + reach - room.minY) / cell) + 1);
    const i0 = Math.max(0, Math.floor((b.minX - reach - room.minX) / cell));
    const i1 = Math.min(nx - 1, Math.ceil((b.maxX + reach - room.minX) / cell) + 1);
    for (let j = j0; j <= j1 && !found; j++) {
      for (let i = i0; i <= i1; i++) {
        if (!reached[index(i, j)]) continue;
        const p = { x: room.minX + (i - 0.5) * cell, y: room.minY + (j - 0.5) * cell };
        if (distanceToOutline(body, p) <= reach) {
          found = true;
          break;
        }
      }
    }
    if (!found) cutOff.push(id);
  }
  return cutOff;
}

/** Distance from a point to a polygon's outline (0 inside). */
export function distanceToOutline(polygon: readonly Vec2[], p: Vec2): number {
  if (locatePoint(polygon, p) !== 'outside') return 0;
  let best = Infinity;
  for (let k = 0; k < polygon.length; k++) best = Math.min(best, pointSegmentDistance(p, polygon[k]!, polygon[(k + 1) % polygon.length]!));
  return best;
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
