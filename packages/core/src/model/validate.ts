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
  | 'door-off-boundary'
  | 'unknown-field';

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

  /** An object; when `fields` is given, any other key is reported so stray data never slips into a save file. */
  object(value: unknown, path: string, fields?: readonly string[]): Obj | undefined {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      this.add(value === undefined ? 'missing' : 'wrong-type', path, 'expected an object');
      return undefined;
    }
    if (fields) {
      for (const key of Object.keys(value)) {
        if (!fields.includes(key)) this.add('unknown-field', `${path}.${key}`, 'field is not part of the schema');
      }
    }
    return value as Obj;
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
    const o = this.object(value, path, POINT_FIELDS);
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

const PROJECT_FIELDS = ['schemaVersion', 'id', 'name', 'revision', 'space', 'catalog', 'items'] as const;
const SPACE_FIELDS = ['boundary', 'obstacles', 'doors', 'ceilingHeight'] as const;
const OBSTACLE_FIELDS = ['id', 'kind', 'polygon'] as const;
const DOOR_FIELDS = ['id', 'hinge', 'width', 'angle', 'swing'] as const;
const DEFINITION_FIELDS = ['id', 'name', 'category', 'size', 'clearance', 'seats'] as const;
const ITEM_FIELDS = ['id', 'definitionId', 'position', 'rotation', 'locked'] as const;
const POINT_FIELDS = ['x', 'y'] as const;

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
  c.object(value, 'project', PROJECT_FIELDS);
  c.id(project.id, 'id');
  c.string(project.name, 'name');
  c.integer(project.revision, 'revision', 0, Number.MAX_SAFE_INTEGER);

  checkSpace(c, project.space, 'space');
  const definitionIds = new Set<string>();
  const catalog = c.object(project.catalog, 'catalog');
  for (const [key, definition] of Object.entries(catalog ?? {})) {
    checkDefinition(c, definition, `catalog.${key}`, key);
    definitionIds.add(key);
  }
  const items = c.object(project.items, 'items');
  for (const [key, item] of Object.entries(items ?? {})) {
    checkItem(c, item, `items.${key}`, key, definitionIds);
  }
  return c.problems;
}

/** Structural problems of a space on its own (ids unique within the space). */
export function validateSpace(value: unknown): Problem[] {
  const c = new Collector();
  checkSpace(c, value, 'space');
  return c.problems;
}

/** Structural problems of one catalog definition on its own. */
export function validateDefinition(value: unknown): Problem[] {
  const c = new Collector();
  checkDefinition(c, value, 'definition');
  return c.problems;
}

/** Structural problems of one placed item on its own; the catalog reference is not checked. */
export function validateItem(value: unknown): Problem[] {
  const c = new Collector();
  checkItem(c, value, 'item');
  return c.problems;
}

function checkSpace(c: Collector, value: unknown, path: string): void {
  const space = c.object(value, path, SPACE_FIELDS);
  if (!space) return;
  const boundary = c.polygon(space.boundary, `${path}.boundary`);
  if (space.ceilingHeight !== undefined) c.length(space.ceilingHeight, `${path}.ceilingHeight`, { positive: true });

  c.array(space.obstacles, `${path}.obstacles`)?.forEach((value, i) => {
    const at = `${path}.obstacles.${i}`;
    const obstacle = c.object(value, at, OBSTACLE_FIELDS);
    if (!obstacle) return;
    c.id(obstacle.id, `${at}.id`);
    if (obstacle.kind !== 'column' && obstacle.kind !== 'blocked-zone') {
      c.add('wrong-type', `${at}.kind`, 'expected "column" or "blocked-zone"');
    }
    c.polygon(obstacle.polygon, `${at}.polygon`);
  });

  c.array(space.doors, `${path}.doors`)?.forEach((value, i) => {
    const at = `${path}.doors.${i}`;
    const door = c.object(value, at, DOOR_FIELDS);
    if (!door) return;
    c.id(door.id, `${at}.id`);
    const hinge = c.point(door.hinge, `${at}.hinge`);
    c.length(door.width, `${at}.width`, { positive: true });
    c.angle(door.angle, `${at}.angle`);
    if (door.swing !== 'left' && door.swing !== 'right') {
      c.add('wrong-type', `${at}.swing`, 'expected "left" or "right"');
    }
    if (boundary && hinge && locatePoint(boundary, hinge) !== 'boundary') {
      c.add('door-off-boundary', `${at}.hinge`, 'the hinge must lie on the space boundary');
    }
  });
}

function checkDefinition(c: Collector, value: unknown, path: string, key?: string): void {
  const definition = c.object(value, path, DEFINITION_FIELDS);
  if (!definition) return;
  const id = c.id(definition.id, `${path}.id`);
  if (key !== undefined && id !== undefined && id !== key) {
    c.add('id-mismatch', `${path}.id`, `id "${id}" differs from its key "${key}"`);
  }
  c.string(definition.name, `${path}.name`);
  c.string(definition.category, `${path}.category`);
  const size = c.object(definition.size, `${path}.size`, ['w', 'd', 'h']);
  if (size) {
    c.length(size.w, `${path}.size.w`, { positive: true });
    c.length(size.d, `${path}.size.d`, { positive: true });
    c.length(size.h, `${path}.size.h`, { positive: true });
  }
  const sides = ['front', 'back', 'left', 'right'] as const;
  const clearance = c.object(definition.clearance, `${path}.clearance`, sides);
  if (clearance) {
    for (const side of sides) c.length(clearance[side], `${path}.clearance.${side}`);
  }
  if (definition.seats !== undefined) c.integer(definition.seats, `${path}.seats`, 0, 10_000);
}

function checkItem(c: Collector, value: unknown, path: string, key?: string, definitionIds?: Set<string>): void {
  const item = c.object(value, path, ITEM_FIELDS);
  if (!item) return;
  const id = c.id(item.id, `${path}.id`);
  if (key !== undefined && id !== undefined && id !== key) {
    c.add('id-mismatch', `${path}.id`, `id "${id}" differs from its key "${key}"`);
  }
  const definitionId = c.string(item.definitionId, `${path}.definitionId`, { nonEmpty: true });
  if (definitionIds && definitionId !== undefined && !definitionIds.has(definitionId)) {
    c.add('broken-reference', `${path}.definitionId`, `no catalog definition "${definitionId}"`);
  }
  c.point(item.position, `${path}.position`);
  c.angle(item.rotation, `${path}.rotation`);
  if (typeof item.locked !== 'boolean') c.add('wrong-type', `${path}.locked`, 'expected true or false');
}

/** Throw a CoreError listing every problem unless the value is a sound project. */
export function assertValidProject(value: unknown): asserts value is Project {
  const problems = validateProject(value);
  if (problems.length > 0) {
    const summary = problems.map((p) => `${p.path}: ${p.message}`).join('; ');
    throw new CoreError('invalid-project', `invalid project (${problems.length} problem(s)): ${summary}`);
  }
}
