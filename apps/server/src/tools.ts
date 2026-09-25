import {
  checkProject,
  fromUnit,
  measureProject,
  normalizeAngle,
  readRoom,
  roomProblems,
  roomSpace,
  serializeProject,
  toSquareMetres,
  toUnit,
  validateSpace,
  type Command,
  type ColumnSpec,
  type DoorSpec,
  type Issue,
  type Project,
  type RoomSpec,
  type Wall,
} from '@space-planner/core';
import { newHall, ROUND_SHAPES, SHAPES } from '@space-planner/starter';
import type { Store } from './store.js';

/** A tool offered to agents, over MCP and to API agents alike. */
export interface ToolDef {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: Record<string, unknown>;
  run(ctx: ToolContext, input: Record<string, unknown>): string;
}

export interface ToolContext {
  readonly store: Store;
  readonly actor: string;
}

/** A tool failure the agent should read and correct. */
export class ToolError extends Error {}

export function toolSummaries(): Array<Pick<ToolDef, 'name' | 'description' | 'inputSchema'>> {
  return TOOLS.map(({ name, description, inputSchema }) => ({ name, description, inputSchema }));
}

export function runTool(ctx: ToolContext, name: string, input: unknown): { text: string; isError: boolean } {
  const tool = TOOLS.find((t) => t.name === name);
  if (!tool) return { text: `Unknown tool "${name}".`, isError: true };
  try {
    const args = typeof input === 'object' && input !== null ? (input as Record<string, unknown>) : {};
    return { text: tool.run(ctx, args), isError: false };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { text: `Error: ${message}`, isError: true };
  }
}

// ---------- input helpers ----------

function str(input: Record<string, unknown>, key: string, optional = false): string {
  const v = input[key];
  if (v === undefined && optional) return '';
  if (typeof v !== 'string' || v.trim() === '') throw new ToolError(`"${key}" must be a non-empty string`);
  return v;
}

function num(input: Record<string, unknown>, key: string): number;
function num(input: Record<string, unknown>, key: string, optional: true): number | undefined;
function num(input: Record<string, unknown>, key: string, optional = false): number | undefined {
  const v = input[key];
  if (v === undefined && optional) return undefined;
  if (typeof v !== 'number' || !Number.isFinite(v)) throw new ToolError(`"${key}" must be a number`);
  return v;
}

function list(input: Record<string, unknown>, key: string, optional = false): Array<Record<string, unknown>> {
  const v = input[key];
  if (v === undefined && optional) return [];
  if (!Array.isArray(v)) throw new ToolError(`"${key}" must be an array`);
  return v.map((x, i) => {
    if (typeof x !== 'object' || x === null) throw new ToolError(`"${key}[${i}]" must be an object`);
    return x as Record<string, unknown>;
  });
}

const metres = (v: number) => fromUnit(v, 'm');
const centimetres = (v: number) => fromUnit(v, 'cm');
const degrees = (v: number) => normalizeAngle(Math.round(v * 1000));
const fmtM = (ticks: number) => `${toUnit(ticks, 'm').toFixed(2)} m`;
const fmtCm = (ticks: number) => `${+toUnit(ticks, 'cm').toFixed(1)} cm`;

function load(ctx: ToolContext, input: Record<string, unknown>): Project {
  const id = str(input, 'project_id');
  const project = ctx.store.getProject(id);
  if (!project) throw new ToolError(`No project "${id}". Call list_projects to see the ids.`);
  return project;
}

function commit(ctx: ToolContext, project: Project, commands: Command[], summary: string): Project {
  const result = ctx.store.applyCommands(project.id, commands, { actor: ctx.actor, summary });
  if (result.ok) return result.project;
  if (result.status === 422) {
    const detail = result.rejection.problems?.map((p) => `${p.path}: ${p.message}`).join('; ');
    const at = result.rejection.at ? ` (command #${result.rejection.at.join('.')})` : '';
    throw new ToolError(`Rejected${at}: ${result.rejection.code}: ${result.rejection.message}${detail ? ` — ${detail}` : ''}`);
  }
  throw new ToolError('The project could not be changed.');
}

function takenIds(project: Project): Set<string> {
  return new Set([
    project.id,
    ...Object.keys(project.items),
    ...Object.keys(project.catalog),
    ...project.space.doors.map((d) => d.id),
    ...project.space.obstacles.map((o) => o.id),
  ]);
}

function nextId(prefix: string, taken: Set<string>): string {
  for (let n = 1; ; n++) {
    const id = `${prefix}-${n}`;
    if (!taken.has(id)) {
      taken.add(id);
      return id;
    }
  }
}

// ---------- descriptions ----------

export function describeIssue(project: Project, issue: Issue): string {
  const names = issue.entityIds.map((id) => {
    const item = project.items[id];
    return item ? `${id} (${project.catalog[item.definitionId]?.name ?? item.definitionId})` : id;
  });
  const amount = issue.amount === undefined ? '' : `, off by ${fmtCm(issue.amount)}`;
  return `[${issue.severity}] ${issue.code}: ${names.join(' vs ') || 'project'}${amount}`;
}

export function describeProject(project: Project): string {
  const lines: string[] = [];
  lines.push(`Project ${project.id} "${project.name}" — revision ${project.revision}`);
  lines.push('Coordinates: metres from the south-west corner; x grows east, y grows north. Rotation in degrees counter-clockwise; 0 means the item front faces north.');
  const room = readRoom(project.space);
  if (room) {
    lines.push(`Room: ${fmtM(room.width)} wide (x) × ${fmtM(room.depth)} deep (y), ceiling ${room.ceilingHeight === undefined ? 'unknown' : fmtM(room.ceilingHeight)}`);
    for (const d of room.doors) lines.push(`  Door ${d.id}: ${d.wall} wall, hinge ${fmtM(d.offset)} from the wall start, ${fmtCm(d.width)} wide, opens inward`);
    for (const c of room.columns) lines.push(`  Column ${c.id}: centre (${fmtM(c.center.x)}, ${fmtM(c.center.y)}), ${fmtCm(c.width)} × ${fmtCm(c.depth)}`);
  } else {
    lines.push(`Room outline (m): ${project.space.boundary.map((p) => `(${toUnit(p.x, 'm')}, ${toUnit(p.y, 'm')})`).join(' ')}`);
  }
  lines.push('Item types (id | name | category | w×d×h cm | clearance front/back/left/right cm | seats | footprint):');
  for (const d of Object.values(project.catalog)) {
    const c = d.clearance;
    lines.push(`  ${d.id} | ${d.name} | ${d.category} | ${toUnit(d.size.w, 'cm')}×${toUnit(d.size.d, 'cm')}×${toUnit(d.size.h, 'cm')} | ${[c.front, c.back, c.left, c.right].map((v) => toUnit(v, 'cm')).join('/')} | ${d.seats ?? 0} | ${d.footprint ?? 'rect'}`);
  }
  const items = Object.values(project.items);
  lines.push(`Items (${items.length}) (id | type | x m | y m | rotation° | height above floor m${items.some((i) => i.locked) ? ' | locked' : ''}):`);
  for (const i of items) {
    lines.push(`  ${i.id} | ${i.definitionId} | ${toUnit(i.position.x, 'm')} | ${toUnit(i.position.y, 'm')} | ${i.rotation / 1000} | ${toUnit(i.elevation ?? 0, 'm')}${i.locked ? ' | locked' : ''}`);
  }
  const issues = checkProject(project);
  lines.push(`Issues (${issues.length}):`);
  for (const issue of issues) lines.push(`  ${describeIssue(project, issue)}`);
  const metrics = measureProject(project);
  lines.push(`Metrics: ${metrics.seats} seats, ${metrics.itemCount} items, floor ${toSquareMetres(metrics.floorArea).toFixed(2)} m², occupied ${(metrics.occupancy * 100).toFixed(1)}%`);
  return lines.join('\n');
}

function afterChange(project: Project, what: string): string {
  const issues = checkProject(project);
  const errors = issues.filter((i) => i.severity === 'error').length;
  return `${what} Now at revision ${project.revision}. ${issues.length === 0 ? 'No issues.' : `${issues.length} issue(s), ${errors} error(s):\n${issues.slice(0, 30).map((i) => `  ${describeIssue(project, i)}`).join('\n')}`}`;
}

// ---------- tools ----------

const projectId = { type: 'string', description: 'Project id, e.g. "p-1a2b3c4d".' };
const summary = { type: 'string', description: 'One short line for the history, in the user’s language.' };
const shapeList = SHAPES.map((s) => s.key).join(', ');

export const TOOLS: readonly ToolDef[] = [
  {
    name: 'list_projects',
    description: 'List all projects with id, name, revision and item count.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    run: (ctx) => {
      const projects = ctx.store.listProjects();
      if (projects.length === 0) return 'No projects yet. Use create_project.';
      return projects.map((p) => `${p.id} | ${p.name} | revision ${p.revision} | ${p.itemCount} items | updated ${p.updatedAt}`).join('\n');
    },
  },
  {
    name: 'create_project',
    description: 'Create a new rectangular room project with the starter catalog and one door centred on the south wall. Returns the new project id.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        width_m: { type: 'number', description: 'West→east size in metres.' },
        depth_m: { type: 'number', description: 'South→north size in metres.' },
        ceiling_m: { type: 'number', description: 'Ceiling height in metres, if known.' },
      },
      required: ['name', 'width_m', 'depth_m'],
      additionalProperties: false,
    },
    run: (ctx, input) => {
      const width = num(input, 'width_m');
      const depth = num(input, 'depth_m');
      if (width < 1 || depth < 1 || width > 500 || depth > 500) throw new ToolError('room sides must be between 1 and 500 m');
      const project = ctx.store.createProject(newHall(str(input, 'name'), width, depth, num(input, 'ceiling_m', true)), ctx.actor);
      return `Created ${project.id}.\n\n${describeProject(project)}`;
    },
  },
  {
    name: 'get_project',
    description: 'Read a project: room, doors, columns, item types, every item with position, current issues and metrics. Always start here.',
    inputSchema: {
      type: 'object',
      properties: { project_id: projectId, include_json: { type: 'boolean', description: 'Also return the raw project JSON (lengths in ticks, 1 tick = 0.1 mm).' } },
      required: ['project_id'],
      additionalProperties: false,
    },
    run: (ctx, input) => {
      const project = load(ctx, input);
      return input.include_json === true ? `${describeProject(project)}\n\nJSON:\n${serializeProject(project)}` : describeProject(project);
    },
  },
  {
    name: 'set_room',
    description:
      'Set the rectangular room: size, ceiling, doors on walls and columns. Omitted doors/columns keep the current ones; pass [] to remove all. Door offset is measured along the wall from its start (south/north walls: from the west end; west/east walls: from the south end) to the hinge; doors open inward.',
    inputSchema: {
      type: 'object',
      properties: {
        project_id: projectId,
        width_m: { type: 'number' },
        depth_m: { type: 'number' },
        ceiling_m: { type: 'number' },
        doors: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              wall: { type: 'string', enum: ['south', 'north', 'west', 'east'] },
              offset_m: { type: 'number' },
              width_cm: { type: 'number' },
            },
            required: ['wall', 'offset_m', 'width_cm'],
          },
        },
        columns: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              x_m: { type: 'number' },
              y_m: { type: 'number' },
              width_cm: { type: 'number' },
              depth_cm: { type: 'number' },
            },
            required: ['x_m', 'y_m', 'width_cm'],
          },
        },
        summary,
      },
      required: ['project_id'],
      additionalProperties: false,
    },
    run: (ctx, input) => {
      const project = load(ctx, input);
      const current = readRoom(project.space);
      const width = input.width_m === undefined ? current?.width : metres(num(input, 'width_m'));
      const depth = input.depth_m === undefined ? current?.depth : metres(num(input, 'depth_m'));
      if (width === undefined || depth === undefined) throw new ToolError('this room is not a simple rectangle; give width_m and depth_m');
      const taken = new Set([...Object.keys(project.items), ...Object.keys(project.catalog), project.id]);
      const doors: DoorSpec[] =
        input.doors === undefined
          ? [...(current?.doors ?? [])]
          : list(input, 'doors').map((d) => {
              const wall = str(d, 'wall') as Wall;
              if (!['south', 'north', 'west', 'east'].includes(wall)) throw new ToolError(`unknown wall "${wall}"`);
              return { id: typeof d.id === 'string' && d.id ? d.id : nextId('door', taken), wall, offset: metres(num(d, 'offset_m')), width: centimetres(num(d, 'width_cm')) };
            });
      const columns: ColumnSpec[] =
        input.columns === undefined
          ? [...(current?.columns ?? [])]
          : list(input, 'columns').map((c) => {
              const w = centimetres(num(c, 'width_cm'));
              return {
                id: typeof c.id === 'string' && c.id ? c.id : nextId('column', taken),
                center: { x: metres(num(c, 'x_m')), y: metres(num(c, 'y_m')) },
                width: w,
                depth: c.depth_cm === undefined ? w : centimetres(num(c, 'depth_cm')),
              };
            });
      const ceiling = input.ceiling_m === undefined ? current?.ceilingHeight : metres(num(input, 'ceiling_m'));
      const spec: RoomSpec = { width, depth, doors, columns, ...(ceiling === undefined ? {} : { ceilingHeight: ceiling }) };
      const problems = roomProblems(spec);
      if (problems.length > 0) throw new ToolError(problems.join('; '));
      const space = roomSpace(spec);
      const structural = validateSpace(space);
      if (structural.length > 0) throw new ToolError(structural.map((p) => `${p.path}: ${p.message}`).join('; '));
      const updated = commit(ctx, project, [{ type: 'space.set', space }], str(input, 'summary', true) || 'تعديل القاعة');
      return afterChange(updated, 'Room updated.');
    },
  },
  {
    name: 'define_item',
    description: `Create or update an item type. Sizes in cm: width is the item's left-right size, depth its back-front size. Clearance is free space the item needs on each side to be usable (e.g. chair back 40 cm). Category picks the 3D model: ${shapeList}.`,
    inputSchema: {
      type: 'object',
      properties: {
        project_id: projectId,
        id: { type: 'string', description: 'Stable id such as "table-200".' },
        name: { type: 'string', description: 'Display name in the user’s language.' },
        category: { type: 'string', enum: SHAPES.map((s) => s.key) },
        width_cm: { type: 'number' },
        depth_cm: { type: 'number' },
        height_cm: { type: 'number' },
        clearance_cm: {
          type: 'object',
          properties: { front: { type: 'number' }, back: { type: 'number' }, left: { type: 'number' }, right: { type: 'number' } },
        },
        seats: { type: 'integer', description: 'Seats this item adds to capacity.' },
        footprint: { type: 'string', enum: ['rect', 'round'], description: 'Floor outline; "round" for round tables and pots (an ellipse inside width × depth). Defaults to round for round-table and plant.' },
        summary,
      },
      required: ['project_id', 'id', 'name', 'category', 'width_cm', 'depth_cm', 'height_cm'],
      additionalProperties: false,
    },
    run: (ctx, input) => {
      const project = load(ctx, input);
      const c = (typeof input.clearance_cm === 'object' && input.clearance_cm !== null ? input.clearance_cm : {}) as Record<string, unknown>;
      const side = (k: string) => (c[k] === undefined ? 0 : centimetres(num(c, k)));
      const seats = num(input, 'seats', true);
      const category = str(input, 'category');
      const footprint = input.footprint === 'round' || input.footprint === 'rect' ? input.footprint : ROUND_SHAPES.includes(category as never) ? 'round' : 'rect';
      const definition = {
        id: str(input, 'id'),
        name: str(input, 'name'),
        category,
        size: { w: centimetres(num(input, 'width_cm')), d: centimetres(num(input, 'depth_cm')), h: centimetres(num(input, 'height_cm')) },
        clearance: { front: side('front'), back: side('back'), left: side('left'), right: side('right') },
        ...(seats === undefined ? {} : { seats }),
        ...(footprint === 'round' ? { footprint: 'round' as const } : {}),
      };
      const existed = Boolean(project.catalog[definition.id]);
      const updated = commit(ctx, project, [{ type: 'catalog.define', definition }], str(input, 'summary', true) || `${existed ? 'تعديل' : 'إضافة'} صنف ${definition.name}`);
      return afterChange(updated, `Item type ${definition.id} ${existed ? 'updated' : 'created'}.`);
    },
  },
  {
    name: 'place_items',
    description: 'Place new items (one revision for the whole list). Positions are the item centre in metres; rotation in degrees counter-clockwise (0 = front faces north, 180 = faces south). height_m raises an item off the floor (a lamp, a wall shelf); items hung above others do not clash with them. Ids are generated when omitted.',
    inputSchema: {
      type: 'object',
      properties: {
        project_id: projectId,
        items: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              definition_id: { type: 'string' },
              x_m: { type: 'number' },
              y_m: { type: 'number' },
              rotation_deg: { type: 'number' },
              height_m: { type: 'number' },
              id: { type: 'string' },
            },
            required: ['definition_id', 'x_m', 'y_m'],
          },
        },
        summary,
      },
      required: ['project_id', 'items'],
      additionalProperties: false,
    },
    run: (ctx, input) => {
      const project = load(ctx, input);
      const taken = takenIds(project);
      const specs = list(input, 'items');
      if (specs.length === 0) throw new ToolError('items is empty');
      const commands: Command[] = specs.map((s) => {
        const definitionId = str(s, 'definition_id');
        const id = typeof s.id === 'string' && s.id ? s.id : nextId(definitionId, taken);
        const elevation = metres(num(s, 'height_m', true) ?? 0);
        return {
          type: 'item.add',
          item: {
            id,
            definitionId,
            position: { x: metres(num(s, 'x_m')), y: metres(num(s, 'y_m')) },
            rotation: degrees(num(s, 'rotation_deg', true) ?? 0),
            locked: false,
            ...(elevation === 0 ? {} : { elevation }),
          },
        };
      });
      const updated = commit(ctx, project, commands, str(input, 'summary', true) || `إضافة ${commands.length} عنصر`);
      return afterChange(updated, `Placed ${commands.length} item(s): ${commands.map((c) => (c.type === 'item.add' ? c.item.id : '')).join(', ')}.`);
    },
  },
  {
    name: 'move_items',
    description: 'Move, rotate and/or raise existing items (one revision). Give only the fields to change; height_m is the underside above the floor (0 = on the floor).',
    inputSchema: {
      type: 'object',
      properties: {
        project_id: projectId,
        moves: {
          type: 'array',
          items: {
            type: 'object',
            properties: { id: { type: 'string' }, x_m: { type: 'number' }, y_m: { type: 'number' }, rotation_deg: { type: 'number' }, height_m: { type: 'number' } },
            required: ['id'],
          },
        },
        summary,
      },
      required: ['project_id', 'moves'],
      additionalProperties: false,
    },
    run: (ctx, input) => {
      const project = load(ctx, input);
      const commands: Command[] = [];
      for (const mv of list(input, 'moves')) {
        const id = str(mv, 'id');
        const item = project.items[id];
        if (!item) throw new ToolError(`no item "${id}"`);
        if (mv.x_m !== undefined || mv.y_m !== undefined) {
          const x = mv.x_m === undefined ? item.position.x : metres(num(mv, 'x_m'));
          const y = mv.y_m === undefined ? item.position.y : metres(num(mv, 'y_m'));
          commands.push({ type: 'item.move', id, to: { x, y } });
        }
        if (mv.rotation_deg !== undefined) commands.push({ type: 'item.rotate', id, to: degrees(num(mv, 'rotation_deg')) });
        if (mv.height_m !== undefined) commands.push({ type: 'item.elevate', id, to: metres(num(mv, 'height_m')) });
      }
      if (commands.length === 0) throw new ToolError('nothing to change');
      const updated = commit(ctx, project, commands, str(input, 'summary', true) || 'تحريك عناصر');
      return afterChange(updated, `Applied ${commands.length} change(s).`);
    },
  },
  {
    name: 'remove_items',
    description: 'Remove items by id (one revision).',
    inputSchema: {
      type: 'object',
      properties: { project_id: projectId, ids: { type: 'array', items: { type: 'string' } }, summary },
      required: ['project_id', 'ids'],
      additionalProperties: false,
    },
    run: (ctx, input) => {
      const project = load(ctx, input);
      const ids = input.ids;
      if (!Array.isArray(ids) || ids.length === 0 || !ids.every((x) => typeof x === 'string')) throw new ToolError('"ids" must be a non-empty list of strings');
      const updated = commit(ctx, project, ids.map((id) => ({ type: 'item.remove', id })), str(input, 'summary', true) || `مسح ${ids.length} عنصر`);
      return afterChange(updated, `Removed ${ids.length} item(s).`);
    },
  },
  {
    name: 'apply_commands',
    description:
      'Advanced: apply raw core commands atomically (lengths in ticks: 1 tick = 0.1 mm, so metres × 10000; angles in millidegrees). Types: item.add {item}, item.move {id,to}, item.rotate {id,to}, item.elevate {id,to}, item.remove {id}, item.lock {id,locked}, catalog.define {definition}, catalog.remove {id}, space.set {space}, project.rename {name}, batch {commands}.',
    inputSchema: {
      type: 'object',
      properties: { project_id: projectId, commands: { type: 'array', items: { type: 'object' } }, summary },
      required: ['project_id', 'commands'],
      additionalProperties: false,
    },
    run: (ctx, input) => {
      const project = load(ctx, input);
      const commands = input.commands;
      if (!Array.isArray(commands) || commands.length === 0) throw new ToolError('"commands" must be a non-empty array');
      const updated = commit(ctx, project, commands as Command[], str(input, 'summary', true) || '');
      return afterChange(updated, `Applied ${commands.length} command(s).`);
    },
  },
  {
    name: 'check_project',
    description: 'List design issues (overlaps, blocked doors, items outside the room, missing clearance, too tall) with how far off each is, plus key metrics.',
    inputSchema: { type: 'object', properties: { project_id: projectId }, required: ['project_id'], additionalProperties: false },
    run: (ctx, input) => {
      const project = load(ctx, input);
      const issues = checkProject(project);
      const metrics = measureProject(project);
      const head = `Revision ${project.revision}: ${metrics.seats} seats, ${metrics.itemCount} items, occupied ${(metrics.occupancy * 100).toFixed(1)}%.`;
      return issues.length === 0 ? `${head}\nNo issues.` : `${head}\n${issues.map((i) => describeIssue(project, i)).join('\n')}`;
    },
  },
  {
    name: 'get_history',
    description: 'Recent revisions: number, who made them (human or which agent), summary and time.',
    inputSchema: {
      type: 'object',
      properties: { project_id: projectId, limit: { type: 'integer' } },
      required: ['project_id'],
      additionalProperties: false,
    },
    run: (ctx, input) => {
      const project = load(ctx, input);
      const limit = Math.min(200, Math.max(1, Math.round(num(input, 'limit', true) ?? 20)));
      return ctx.store.history(project.id, limit).map((h) => `#${h.revision} | ${h.actor} | ${h.summary} | ${h.createdAt}`).join('\n');
    },
  },
  {
    name: 'restore_revision',
    description: 'Bring back an earlier revision as a new revision (nothing is erased).',
    inputSchema: {
      type: 'object',
      properties: { project_id: projectId, revision: { type: 'integer' } },
      required: ['project_id', 'revision'],
      additionalProperties: false,
    },
    run: (ctx, input) => {
      const project = load(ctx, input);
      const result = ctx.store.restore(project.id, Math.round(num(input, 'revision')), ctx.actor);
      if (!result.ok) throw new ToolError('no such revision');
      return afterChange(result.project, `Restored revision ${String(input.revision)}.`);
    },
  },
];
