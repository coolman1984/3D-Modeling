import type { Project } from '../model/types.js';
import type { Command } from './types.js';

/**
 * Commands that turn `from` into `to` (space, catalog and items; the id, name and revision of
 * `from` stay). Used to adopt a variant into its base as one ordinary revision, so the change is
 * validated, undoable and in the history like any other.
 *
 * Order: unlock and remove items that go or change, set the space, remove unused types, define new
 * or changed types, add new or changed items. Ids are visited in ascending order (deterministic).
 * Changed items are removed and added again rather than patched field by field: simple and exact.
 */
export function diffCommands(from: Project, to: Project): Command[] {
  const canonical = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(canonical);
    if (value && typeof value === 'object') {
      return Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([key, entry]) => [key, canonical(entry)]));
    }
    return value;
  };
  const same = (a: unknown, b: unknown) => JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
  const sorted = (o: object) => Object.keys(o).sort();
  const commands: Command[] = [];

  const leaving = sorted(from.items).filter((id) => !to.items[id] || !same(from.items[id], to.items[id]));
  for (const id of leaving) {
    if (from.items[id]!.locked) commands.push({ type: 'item.lock', id, locked: false });
    commands.push({ type: 'item.remove', id });
  }
  if (!same(from.space, to.space)) commands.push({ type: 'space.set', space: to.space });
  for (const id of sorted(from.catalog)) if (!to.catalog[id]) commands.push({ type: 'catalog.remove', id });
  for (const id of sorted(to.catalog)) {
    if (!from.catalog[id] || !same(from.catalog[id], to.catalog[id])) commands.push({ type: 'catalog.define', definition: to.catalog[id]! });
  }
  const entering = sorted(to.items).filter((id) => !from.items[id] || !same(from.items[id], to.items[id]));
  for (const id of entering) commands.push({ type: 'item.add', item: to.items[id]! });
  return commands;
}
