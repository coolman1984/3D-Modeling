import type { Project } from '../model/types.js';
import { validateDefinition, validateItem, validateSpace } from '../model/validate.js';
import { normalizeAngle } from '../units/angle.js';
import { MAX_COORDINATE } from '../units/length.js';
import type { Command, Rejection } from './types.js';

export type Outcome =
  | { readonly ok: true; readonly project: Project; readonly inverse: Command }
  | { readonly ok: false; readonly rejection: Rejection };

/**
 * Apply one command. Pure: the input project is never modified.
 * Accepted commands bump `revision` by one (a batch counts once) and return the
 * command that undoes them. Commands that would break data integrity are rejected;
 * design issues such as overlaps are allowed and reported by the checks module.
 */
export function apply(project: Project, command: Command): Outcome {
  const result = applyInner(project, command);
  if (!result.ok) return result;
  return { ok: true, project: { ...result.project, revision: project.revision + 1 }, inverse: result.inverse };
}

function reject(code: Rejection['code'], message: string, extra: Partial<Rejection> = {}): Outcome {
  return { ok: false, rejection: { code, message, ...extra } };
}

function isPoint(value: unknown): value is { x: number; y: number } {
  if (typeof value !== 'object' || value === null) return false;
  const { x, y } = value as { x: unknown; y: unknown };
  return [x, y].every((n) => typeof n === 'number' && Number.isInteger(n) && Math.abs(n) <= MAX_COORDINATE);
}

function isIntegerAngle(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value);
}

/** Every id in the project; ids are unique across all entity kinds. */
function idsInUse(project: Project, except: 'space' | 'none' = 'none'): Set<string> {
  const ids = new Set<string>([project.id, ...Object.keys(project.catalog), ...Object.keys(project.items)]);
  if (except !== 'space') {
    for (const o of project.space.obstacles) ids.add(o.id);
    for (const d of project.space.doors) ids.add(d.id);
  }
  return ids;
}

function applyInner(project: Project, command: Command): Outcome {
  switch (command.type) {
    case 'item.add': {
      const { item } = command;
      const problems = validateItem(item);
      if (problems.length > 0) return reject('invalid-payload', 'item is not valid', { problems });
      if (idsInUse(project).has(item.id)) return reject('duplicate-id', `id "${item.id}" is already used`);
      if (!project.catalog[item.definitionId]) {
        return reject('broken-reference', `no catalog definition "${item.definitionId}"`);
      }
      return {
        ok: true,
        project: { ...project, items: { ...project.items, [item.id]: item } },
        inverse: { type: 'item.remove', id: item.id },
      };
    }

    case 'item.move':
    case 'item.rotate':
    case 'item.elevate':
    case 'item.lock': {
      const item = project.items[command.id];
      if (!item) return reject('not-found', `no item "${command.id}"`);
      let updated;
      let inverse: Command;
      if (command.type === 'item.lock') {
        if (typeof command.locked !== 'boolean') return reject('invalid-payload', 'locked must be true or false');
        updated = { ...item, locked: command.locked };
        inverse = { type: 'item.lock', id: item.id, locked: item.locked };
      } else if (item.locked) {
        return reject('locked', `item "${item.id}" is locked`);
      } else if (command.type === 'item.move') {
        if (!isPoint(command.to)) return reject('invalid-payload', 'target must be integer ticks within 1 km');
        updated = { ...item, position: { x: command.to.x, y: command.to.y } };
        inverse = { type: 'item.move', id: item.id, to: item.position };
      } else if (command.type === 'item.elevate') {
        const to: unknown = command.to;
        if (typeof to !== 'number' || !Number.isInteger(to) || to < 0 || to > MAX_COORDINATE) {
          return reject('invalid-payload', 'elevation must be integer ticks from 0 to 1 km');
        }
        const { elevation: _old, ...rest } = item;
        updated = to === 0 ? rest : { ...rest, elevation: to };
        inverse = { type: 'item.elevate', id: item.id, to: item.elevation ?? 0 };
      } else {
        if (!isIntegerAngle(command.to)) return reject('invalid-payload', 'angle must be integer millidegrees');
        updated = { ...item, rotation: normalizeAngle(command.to) };
        inverse = { type: 'item.rotate', id: item.id, to: item.rotation };
      }
      return { ok: true, project: { ...project, items: { ...project.items, [item.id]: updated } }, inverse };
    }

    case 'item.remove': {
      const item = project.items[command.id];
      if (!item) return reject('not-found', `no item "${command.id}"`);
      if (item.locked) return reject('locked', `item "${item.id}" is locked`);
      const { [item.id]: _removed, ...items } = project.items;
      return { ok: true, project: { ...project, items }, inverse: { type: 'item.add', item } };
    }

    case 'catalog.define': {
      const { definition } = command;
      const problems = validateDefinition(definition);
      if (problems.length > 0) return reject('invalid-payload', 'definition is not valid', { problems });
      const previous = project.catalog[definition.id];
      if (!previous && idsInUse(project).has(definition.id)) {
        return reject('duplicate-id', `id "${definition.id}" is already used`);
      }
      return {
        ok: true,
        project: { ...project, catalog: { ...project.catalog, [definition.id]: definition } },
        inverse: previous
          ? { type: 'catalog.define', definition: previous }
          : { type: 'catalog.remove', id: definition.id },
      };
    }

    case 'catalog.remove': {
      const definition = project.catalog[command.id];
      if (!definition) return reject('not-found', `no catalog definition "${command.id}"`);
      const user = Object.values(project.items).find((item) => item.definitionId === command.id);
      if (user) return reject('in-use', `definition "${command.id}" is used by item "${user.id}"`);
      const { [command.id]: _removed, ...catalog } = project.catalog;
      return { ok: true, project: { ...project, catalog }, inverse: { type: 'catalog.define', definition } };
    }

    case 'space.set': {
      const problems = validateSpace(command.space);
      if (problems.length > 0) return reject('invalid-payload', 'space is not valid', { problems });
      const taken = idsInUse(project, 'space');
      const clash = [...command.space.obstacles, ...command.space.doors].find((e) => taken.has(e.id));
      if (clash) return reject('duplicate-id', `id "${clash.id}" is already used`);
      return {
        ok: true,
        project: { ...project, space: command.space },
        inverse: { type: 'space.set', space: project.space },
      };
    }

    case 'project.rename': {
      if (typeof command.name !== 'string' || command.name.trim() === '' || command.name.length > 200) {
        return reject('invalid-payload', 'name must be 1 to 200 characters');
      }
      return {
        ok: true,
        project: { ...project, name: command.name },
        inverse: { type: 'project.rename', name: project.name },
      };
    }

    case 'batch': {
      if (!Array.isArray(command.commands) || command.commands.length === 0) {
        return reject('empty-batch', 'a batch needs at least one command');
      }
      let current = project;
      const inverses: Command[] = [];
      for (const [index, inner] of command.commands.entries()) {
        const result = applyInner(current, inner);
        if (!result.ok) {
          const { rejection } = result;
          return { ok: false, rejection: { ...rejection, at: [index, ...(rejection.at ?? [])] } };
        }
        current = result.project;
        inverses.unshift(result.inverse);
      }
      return { ok: true, project: current, inverse: { type: 'batch', commands: inverses } };
    }

    default: {
      const unknown: { type?: unknown } = command;
      return reject('unknown-command', `unknown command type "${String(unknown.type)}"`);
    }
  }
}
