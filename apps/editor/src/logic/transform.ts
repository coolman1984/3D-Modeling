import {
  boundsOf,
  itemPolygon,
  MAX_COORDINATE,
  normalizeAngle,
  rotate,
  roundHalfAwayFromZero,
  type Aabb,
  type Command,
  type Id,
  type ItemInstance,
  type Project,
  type Vec2,
} from '@space-planner/core';
import { nextId } from './ids.js';

/**
 * Pure helpers that turn "move / rotate / raise / copy / align these items" into core commands.
 * Locked items are left where they are; the result is one command (a batch for several items),
 * or null when nothing would change, so one gesture is always one history step.
 */

export function toBatch(commands: readonly Command[]): Command | null {
  if (commands.length === 0) return null;
  return commands.length === 1 ? commands[0]! : { type: 'batch', commands };
}

/** Selected items that exist and can be changed, in selection order. */
export function movable(project: Project, ids: readonly Id[]): ItemInstance[] {
  return ids.map((id) => project.items[id]).filter((item): item is ItemInstance => item !== undefined && !item.locked);
}

/** Bounding box of the selected items' outlines, or null for an empty selection. */
export function selectionBounds(project: Project, ids: readonly Id[]): Aabb | null {
  const points: Vec2[] = [];
  for (const id of ids) {
    const item = project.items[id];
    const definition = item && project.catalog[item.definitionId];
    if (item && definition) points.push(...itemPolygon(item, definition));
  }
  return points.length > 0 ? boundsOf(points) : null;
}

export function boxCentre(box: Aabb): Vec2 {
  return { x: (box.minX + box.maxX) / 2, y: (box.minY + box.maxY) / 2 };
}

const clamp = (v: number) => Math.max(-MAX_COORDINATE, Math.min(MAX_COORDINATE, roundHalfAwayFromZero(v)));

export function moveCommands(project: Project, ids: readonly Id[], delta: Vec2): Command | null {
  const dx = roundHalfAwayFromZero(delta.x);
  const dy = roundHalfAwayFromZero(delta.y);
  if (dx === 0 && dy === 0) return null;
  return toBatch(movable(project, ids).map((item) => ({ type: 'item.move', id: item.id, to: { x: clamp(item.position.x + dx), y: clamp(item.position.y + dy) } })));
}

/**
 * Turn the items by `delta` millidegrees about `pivot`, like turning a group in a drawing app:
 * each item keeps its place in the group. One item turned about its own centre stays put.
 */
export function rotateCommands(project: Project, ids: readonly Id[], delta: number, pivot?: Vec2): Command | null {
  const turn = roundHalfAwayFromZero(delta);
  if (turn % 360_000 === 0) return null;
  const items = movable(project, ids);
  const centre = pivot ?? (items.length === 1 ? items[0]!.position : undefined) ?? boxCentre(selectionBounds(project, items.map((i) => i.id)) ?? { minX: 0, minY: 0, maxX: 0, maxY: 0 });
  const commands: Command[] = [];
  for (const item of items) {
    const to = rotate(item.position, turn, centre);
    const position = { x: clamp(to.x), y: clamp(to.y) };
    if (position.x !== item.position.x || position.y !== item.position.y) commands.push({ type: 'item.move', id: item.id, to: position });
    commands.push({ type: 'item.rotate', id: item.id, to: normalizeAngle(item.rotation + turn) });
  }
  return toBatch(commands);
}

/** Set every item to one angle (keeps their places). */
export function setRotationCommands(project: Project, ids: readonly Id[], to: number): Command | null {
  const angle = normalizeAngle(roundHalfAwayFromZero(to));
  return toBatch(movable(project, ids).filter((i) => i.rotation !== angle).map((i) => ({ type: 'item.rotate', id: i.id, to: angle })));
}

/** Raise or lower by `delta`; nothing goes below the floor. */
export function elevateCommands(project: Project, ids: readonly Id[], delta: number): Command | null {
  const d = roundHalfAwayFromZero(delta);
  return toBatch(
    movable(project, ids)
      .map((item) => ({ item, to: Math.min(MAX_COORDINATE, Math.max(0, (item.elevation ?? 0) + d)) }))
      .filter(({ item, to }) => to !== (item.elevation ?? 0))
      .map(({ item, to }) => ({ type: 'item.elevate', id: item.id, to })),
  );
}

export function setElevationCommands(project: Project, ids: readonly Id[], to: number): Command | null {
  const height = Math.min(MAX_COORDINATE, Math.max(0, roundHalfAwayFromZero(to)));
  return toBatch(movable(project, ids).filter((i) => (i.elevation ?? 0) !== height).map((i) => ({ type: 'item.elevate', id: i.id, to: height })));
}

/** Put a set of item copies into the project at an offset, with fresh readable ids. */
export function pasteCommands(project: Project, items: readonly ItemInstance[], offset: Vec2): { command: Command | null; ids: Id[] } {
  const taken = takenIds(project);
  const ids: Id[] = [];
  const commands: Command[] = [];
  for (const source of items) {
    if (!project.catalog[source.definitionId]) continue;
    const id = nextId(source.definitionId, taken);
    taken.add(id);
    ids.push(id);
    const { elevation, ...rest } = source;
    commands.push({
      type: 'item.add',
      item: { ...rest, id, locked: false, position: { x: clamp(source.position.x + offset.x), y: clamp(source.position.y + offset.y) }, ...(elevation ? { elevation } : {}) },
    });
  }
  return { command: toBatch(commands), ids };
}

export function duplicateCommands(project: Project, ids: readonly Id[], offset: Vec2): { command: Command | null; ids: Id[] } {
  const items = ids.map((id) => project.items[id]).filter((i): i is ItemInstance => i !== undefined);
  return pasteCommands(project, items, offset);
}

export function removeCommands(project: Project, ids: readonly Id[]): Command | null {
  return toBatch(movable(project, ids).map((i) => ({ type: 'item.remove', id: i.id })));
}

export function lockCommands(project: Project, ids: readonly Id[], locked: boolean): Command | null {
  return toBatch(
    ids
      .map((id) => project.items[id])
      .filter((i): i is ItemInstance => i !== undefined && i.locked !== locked)
      .map((i) => ({ type: 'item.lock', id: i.id, locked })),
  );
}

export type AlignEdge = 'west' | 'east' | 'centre-x' | 'south' | 'north' | 'centre-y';

/** Line up the items' outlines on one edge or centre line of the whole selection. */
export function alignCommands(project: Project, ids: readonly Id[], edge: AlignEdge): Command | null {
  const all = selectionBounds(project, ids);
  if (!all) return null;
  const target = { west: all.minX, east: all.maxX, 'centre-x': (all.minX + all.maxX) / 2, south: all.minY, north: all.maxY, 'centre-y': (all.minY + all.maxY) / 2 }[edge];
  const commands: Command[] = [];
  for (const item of movable(project, ids)) {
    const box = selectionBounds(project, [item.id])!;
    const current = { west: box.minX, east: box.maxX, 'centre-x': (box.minX + box.maxX) / 2, south: box.minY, north: box.maxY, 'centre-y': (box.minY + box.maxY) / 2 }[edge];
    const shift = roundHalfAwayFromZero(target - current);
    if (shift === 0) continue;
    const horizontal = edge === 'west' || edge === 'east' || edge === 'centre-x';
    commands.push({ type: 'item.move', id: item.id, to: horizontal ? { x: item.position.x + shift, y: item.position.y } : { x: item.position.x, y: item.position.y + shift } });
  }
  return toBatch(commands);
}

/**
 * Spread three or more items so the gaps between them are equal along one axis;
 * the first and last (by position) stay where they are.
 */
export function distributeCommands(project: Project, ids: readonly Id[], axis: 'x' | 'y'): Command | null {
  const boxes = ids
    .map((id) => ({ item: project.items[id], box: selectionBounds(project, [id]) }))
    .filter((e): e is { item: ItemInstance; box: Aabb } => e.item !== undefined && e.box !== null);
  if (boxes.length < 3) return null;
  const lo = (b: Aabb) => (axis === 'x' ? b.minX : b.minY);
  const hi = (b: Aabb) => (axis === 'x' ? b.maxX : b.maxY);
  boxes.sort((a, b) => lo(a.box) - lo(b.box) || (a.item.id < b.item.id ? -1 : 1));
  const span = hi(boxes.at(-1)!.box) - lo(boxes[0]!.box);
  const filled = boxes.reduce((sum, e) => sum + hi(e.box) - lo(e.box), 0);
  const gap = (span - filled) / (boxes.length - 1);
  const commands: Command[] = [];
  let cursor = lo(boxes[0]!.box);
  for (const { item, box } of boxes) {
    const shift = roundHalfAwayFromZero(cursor - lo(box));
    cursor += hi(box) - lo(box) + gap;
    if (shift === 0 || item.locked) continue;
    commands.push({ type: 'item.move', id: item.id, to: axis === 'x' ? { x: item.position.x + shift, y: item.position.y } : { x: item.position.x, y: item.position.y + shift } });
  }
  return toBatch(commands);
}

/** Items whose outline touches the box: what a drag-box selects. */
export function itemsInBox(project: Project, box: Aabb): Id[] {
  return Object.values(project.items)
    .filter((item) => {
      const b = selectionBounds(project, [item.id]);
      return b !== null && b.minX <= box.maxX && b.maxX >= box.minX && b.minY <= box.maxY && b.maxY >= box.minY;
    })
    .map((i) => i.id)
    .sort();
}

export function takenIds(project: Project): Set<string> {
  return new Set([
    project.id,
    ...Object.keys(project.items),
    ...Object.keys(project.catalog),
    ...project.space.doors.map((d) => d.id),
    ...project.space.obstacles.map((o) => o.id),
    ...(project.space.zones ?? []).map((z) => z.id),
  ]);
}
