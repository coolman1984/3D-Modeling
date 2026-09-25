import { CoreError } from '../errors.js';
import { isCounterClockwise, isSimple, locatePoint } from '../geometry/polygon.js';
import type { Vec2 } from '../geometry/vec2.js';
import { FULL_TURN } from '../units/angle.js';
import { MAX_COORDINATE } from '../units/length.js';
import { SCHEMA_VERSION, type Project } from './types.js';

export type ProblemCode =
  | 'wrong-type'
  | 'missing'
  | 'unsupported-version'
  | 'invalid-number'
  | 'invalid-polygon'
  | 'not-counter-clockwise'
  | 'duplicate-id'
  | 'id-mismatch'
  | 'broken-reference'
  | 'door-off-boundary';

/** One reason a project is not structurally sound. `path` points at the offending field, e.g. `items.t1.position.x`. */
export interface Problem {
  readonly code: ProblemCode;
  readonly path: string;
  readonly message: string;
}

type Obj = Record<string, unknown>;

class Collector {
  readonly problems: Problem[] = [];
  private readonly seenIds = new Map<string, string>();

  add(code: ProblemCode, path: string, message: string): void {
    this.problems.push({ code, path, message });
  }

  object(value: unknown, path: string): Obj | undefined {
    if (typeof value === 'object' && value !== null && !Array.isArray(value)) return value as Obj;
    this.add(value === undefined ? 'missing' : 'wrong-type', path, 'expected an object');
    return undefined;
  }

  array(value: unknown, path: string): unknown[] | undefined {
    if (Array.isArray(value)) return value;
    this.add(value === undefined ? 'missing' : 'wrong-type', path, 'expected an array');
    return undefined;
  }

  string(value: unknown, path: string, { nonEmpty = false } = {}): string | undefined {
    if (typeof value !== 'string') {
      this.add(value === undefined ? 'missing' : 'wrong-type', path, 'expected a string');
      return undefined;
    }
    if (nonEmpty && value.length === 0) {
      this.add('missing', path, 'must not be empty');
      return undefined;
    }
    return value;
  }

  /** Integer within [min, max]. */
  integer(value: unknown, path: string, min: number, max: number): number | undefined {
    if (typeof value !== 'number') {
      this.add(value === undefined ? 'missing' : 'wrong-type', path, 'expected a number');
      return undefined;
    }
    if (!Number.isInteger(value) || value < min || value > max || Object.is(value, -0)) {
      this.add('invalid-number', path, `expected an integer in [${min}, ${max}], got ${value}`);
      return undefined;
    }
    return value;
  }

  coordinate(value: unknown, path: string): number | undefined {
    return this.integer(value, path, -MAX_COORDINATE, MAX_COORDINATE);
  }

  length(value: unknown, path: string, { positive = false } = {}): number | undefined {
    return this.integer(value, path, positive ? 1 : 0, 2 * MAX_COORDINATE);
  }

  angle(value: unknown, path: string): number | undefined {
    return this.integer(value, path, 0, FULL_TURN - 1);
  }

  point(value: unknown, path: string): Vec2 | undefined {
    const o = this.object(value, path);
    if (!o) return undefined;
    const x = this.coordinate(o.x, `${path}.x`);
    const y = this.coordinate(o.y, `${path}.y`);
    return x === undefined || y === undefined ? undefined : { x, y };
  }

  polygon(value: unknown, path: string): Vec2[] | undefined {
    const list = this.array(value, path);
    if (!list) return undefined;
    const points = list.map((p, i) => this.point(p, `${path}.${i}`));
    if (points.some((p) => p === undefined)) return undefined;
    const polygon = points as Vec2[];
    if (!isSimple(polygon)) {
      this.add('invalid-polygon', path, 'needs at least 3 distinct points, non-zero area and no self-intersection');
      return undefined;
    }
    if (!isCounterClockwise(polygon)) {
      this.add('not-counter-clockwise', path, 'points must run counter-clockwise');
    }
    return polygon;
  }

  id(value: unknown, path: string): string | undefined {
    const id = this.string(value, path, { nonEmpty: true });
    if (id === undefined) return undefined;
    const first = this.seenIds.get(id);
    if (first !== undefined) {
      this.add('duplicate-id', path, `id "${id}" is already used at ${first}`);
    } else {
      this.seenIds.set(id, path);
    }
    return id;
  }
}

/**
 * Check that a value is a structurally sound project: right types, valid numbers,
 * simple polygons, unique ids and intact references.
 * Design issues (overlaps, blocked doors…) are not problems here; see the checks module.
 */
export function validateProject(value: unknown): Problem[] {
  const c = new Collector();
  const project = c.object(value, 'project');
  if (!project) return c.problems;

  if (project.schemaVersion !== SCHEMA_VERSION) {
    c.add('unsupported-version', 'schemaVersion', `expected ${SCHEMA_VERSION}, got ${String(project.schemaVersion)}`);
    return c.problems;
  }
  c.id(project.id, 'id');
  c.string(project.name, 'name');
  c.integer(project.revision, 'revision', 0, Number.MAX_SAFE_INTEGER);

  validateSpace(c, project.space);
  const definitionIds = validateCatalog(c, project.catalog);
  validateItems(c, project.items, definitionIds);
  return c.problems;
}

function validateSpace(c: Collector, value: unknown): void {
  const space = c.object(value, 'space');
  if (!space) return;
  const boundary = c.polygon(space.boundary, 'space.boundary');
  if (space.ceilingHeight !== undefined) c.length(space.ceilingHeight, 'space.ceilingHeight', { positive: true });

  c.array(space.obstacles, 'space.obstacles')?.forEach((value, i) => {
    const path = `space.obstacles.${i}`;
    const obstacle = c.object(value, path);
    if (!obstacle) return;
    c.id(obstacle.id, `${path}.id`);
    if (obstacle.kind !== 'column' && obstacle.kind !== 'blocked-zone') {
      c.add('wrong-type', `${path}.kind`, 'expected "column" or "blocked-zone"');
    }
    c.polygon(obstacle.polygon, `${path}.polygon`);
  });

  c.array(space.doors, 'space.doors')?.forEach((value, i) => {
    const path = `space.doors.${i}`;
    const door = c.object(value, path);
    if (!door) return;
    c.id(door.id, `${path}.id`);
    const hinge = c.point(door.hinge, `${path}.hinge`);
    c.length(door.width, `${path}.width`, { positive: true });
    c.angle(door.angle, `${path}.angle`);
    if (door.swing !== 'left' && door.swing !== 'right') {
      c.add('wrong-type', `${path}.swing`, 'expected "left" or "right"');
    }
    if (boundary && hinge && locatePoint(boundary, hinge) !== 'boundary') {
      c.add('door-off-boundary', `${path}.hinge`, 'the hinge must lie on the space boundary');
    }
  });
}

function validateCatalog(c: Collector, value: unknown): Set<string> {
  const ids = new Set<string>();
  const catalog = c.object(value, 'catalog');
  if (!catalog) return ids;
  for (const [key, value] of Object.entries(catalog)) {
    const path = `catalog.${key}`;
    const definition = c.object(value, path);
    if (!definition) continue;
    const id = c.id(definition.id, `${path}.id`);
    if (id !== undefined && id !== key) c.add('id-mismatch', `${path}.id`, `id "${id}" differs from its key "${key}"`);
    ids.add(key);
    c.string(definition.name, `${path}.name`);
    c.string(definition.category, `${path}.category`);
    const size = c.object(definition.size, `${path}.size`);
    if (size) {
      c.length(size.w, `${path}.size.w`, { positive: true });
      c.length(size.d, `${path}.size.d`, { positive: true });
      c.length(size.h, `${path}.size.h`, { positive: true });
    }
    const clearance = c.object(definition.clearance, `${path}.clearance`);
    if (clearance) {
      for (const side of ['front', 'back', 'left', 'right'] as const) {
        c.length(clearance[side], `${path}.clearance.${side}`);
      }
    }
    if (definition.seats !== undefined) c.integer(definition.seats, `${path}.seats`, 0, 10_000);
  }
  return ids;
}

function validateItems(c: Collector, value: unknown, definitionIds: Set<string>): void {
  const items = c.object(value, 'items');
  if (!items) return;
  for (const [key, value] of Object.entries(items)) {
    const path = `items.${key}`;
    const item = c.object(value, path);
    if (!item) continue;
    const id = c.id(item.id, `${path}.id`);
    if (id !== undefined && id !== key) c.add('id-mismatch', `${path}.id`, `id "${id}" differs from its key "${key}"`);
    const definitionId = c.string(item.definitionId, `${path}.definitionId`, { nonEmpty: true });
    if (definitionId !== undefined && !definitionIds.has(definitionId)) {
      c.add('broken-reference', `${path}.definitionId`, `no catalog definition "${definitionId}"`);
    }
    c.point(item.position, `${path}.position`);
    c.angle(item.rotation, `${path}.rotation`);
    if (typeof item.locked !== 'boolean') c.add('wrong-type', `${path}.locked`, 'expected true or false');
  }
}

/** Throw a CoreError listing every problem unless the value is a sound project. */
export function assertValidProject(value: unknown): asserts value is Project {
  const problems = validateProject(value);
  if (problems.length > 0) {
    const summary = problems.map((p) => `${p.path}: ${p.message}`).join('; ');
    throw new CoreError('invalid-project', `invalid project (${problems.length} problem(s)): ${summary}`);
  }
}
