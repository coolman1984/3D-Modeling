import { add, doorSwingPolygon, openingPolygon, openingSwing, roomMap, rotate, toSquareMetres, wallFrame, wallPoint, wallSolids, type Id, type Opening, type Project, type Space, type Vec2 } from '@space-planner/core';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { formatSquareMetres } from '../logic/format.js';
import { pathOf, toScreen, type Viewport } from '../logic/viewport.js';
import { zoneStyle } from '../logic/zoneStyle.js';

/**
 * Drawn walls on the plan (decision 0028): solid walls with joined corners, door swings, windows
 * as glass lines in the wall, and the floor area of every room the walls close off. Shared by the
 * editor's plan and the printed plan, so both read the same.
 */

/** A room found from the walls, named after the labelled room zone it holds (if any). */
export interface NamedRoom {
  readonly area: number;
  readonly label: Vec2;
  readonly name: string | undefined;
  /** Width and depth of the room's bounding box, ticks: labels that would not fit inside are left out. */
  readonly span: { readonly w: number; readonly d: number };
  /** The room zones that name it. */
  readonly zoneIds: readonly Id[];
}

const cache = new WeakMap<Space, NamedRoom[]>();

/** The rooms of a space with walls, named from its room zones; derived, cached per space value. */
export function namedRooms(space: Space): NamedRoom[] {
  const hit = cache.get(space);
  if (hit) return hit;
  let rooms: NamedRoom[] = [];
  if (space.walls?.length) {
    const map = roomMap(space);
    const names = map.rooms.map(() => [] as string[]);
    const zoneIds = map.rooms.map(() => [] as Id[]);
    for (const zone of space.zones ?? []) {
      if (!zoneStyle(zone.kind).room) continue;
      // A zone names the room its centre falls in; an open plan gathers several names.
      const xs = zone.polygon.map((p) => p.x);
      const ys = zone.polygon.map((p) => p.y);
      const centre = { x: (Math.min(...xs) + Math.max(...xs)) / 2, y: (Math.min(...ys) + Math.max(...ys)) / 2 };
      const i = map.roomAt(centre);
      const name = typeof zone.meta?.label === 'string' ? zone.meta.label : zone.kind;
      if (i < 0) continue;
      zoneIds[i]!.push(zone.id);
      if (!names[i]!.includes(name)) names[i]!.push(name);
    }
    rooms = map.rooms.map((r, i) => ({ area: r.area, label: r.label, span: { w: r.max.x - r.min.x, d: r.max.y - r.min.y }, name: names[i]!.length ? names[i]!.join(' · ') : undefined, zoneIds: zoneIds[i]! }));
  }
  cache.set(space, rooms);
  return rooms;
}

const pt = (p: Vec2) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`;

export function PlanWalls({ v, project, selected, onWallDown, onOpeningDown }: {
  v: Viewport;
  project: Project;
  selected?: ReadonlySet<Id>;
  onWallDown?: (e: ReactPointerEvent, id: Id) => void;
  onOpeningDown?: (e: ReactPointerEvent, id: Id) => void;
}) {
  const { space } = project;
  if (!space.walls?.length) return null;
  const solids = wallSolids(space);
  const byWall = new Map<Id, string[]>();
  for (const s of solids) byWall.set(s.wallId, [...(byWall.get(s.wallId) ?? []), pathOf(v, s.polygon)]);
  return (
    <g className="walls">
      {space.walls.map((w) => (
        <path
          key={w.id}
          data-wall={w.id}
          d={(byWall.get(w.id) ?? []).join('')}
          className={`wall-solid${selected?.has(w.id) ? ' selected' : ''}`}
          onPointerDown={onWallDown && ((e) => onWallDown(e, w.id))}
        />
      ))}
      {(space.openings ?? []).map((o) => (
        <OpeningMark key={o.id} v={v} space={space} opening={o} selected={selected?.has(o.id) ?? false} onDown={onOpeningDown} />
      ))}
    </g>
  );
}

function OpeningMark({ v, space, opening, selected, onDown }: { v: Viewport; space: Space; opening: Opening; selected: boolean; onDown: ((e: ReactPointerEvent, id: Id) => void) | undefined }) {
  const wall = space.walls?.find((w) => w.id === opening.wall);
  const gap = openingPolygon(space, opening);
  if (!wall || !gap) return null;
  const frame = wallFrame(wall);
  const cls = `opening ${opening.kind}${selected ? ' selected' : ''}`;
  const down = onDown && ((e: ReactPointerEvent) => onDown(e, opening.id));
  if (opening.kind === 'window') {
    // Glass: two thin lines along the wall, set in a light frame.
    const t = wall.thickness / 6;
    const lines = [-t, t].map((off) => [toScreen(v, wallPoint(frame, opening.offset, off)), toScreen(v, wallPoint(frame, opening.offset + opening.width, off))] as const);
    return (
      <g className={cls} data-opening={opening.id} onPointerDown={down}>
        <path d={pathOf(v, gap)} className="opening-frame" />
        {lines.map(([a, b], i) => (
          <line key={i} x1={a.x} y1={a.y} x2={b.x} y2={b.y} className="window-glass" />
        ))}
        <title>{`Window ${opening.id}`}</title>
      </g>
    );
  }
  const swing = openingSwing(space, opening);
  // The doorway: the floor shows through; a hairline marks each face of the wall.
  const faces = [-1, 1].map((side) => [toScreen(v, wallPoint(frame, opening.offset, (side * wall.thickness) / 2)), toScreen(v, wallPoint(frame, opening.offset + opening.width, (side * wall.thickness) / 2))] as const);
  return (
    <g className={cls} data-opening={opening.id} onPointerDown={down}>
      <path d={pathOf(v, gap)} className="opening-gap" />
      {swing && <path d={pathOf(v, doorSwingPolygon(swing))} className="opening-hit" />}
      {!swing && faces.map(([a, b], i) => <line key={i} x1={a.x} y1={a.y} x2={b.x} y2={b.y} className="door-arc" />)}
      {swing &&
        (() => {
          const h = toScreen(v, swing.hinge);
          const c = toScreen(v, add(swing.hinge, rotate({ x: swing.width, y: 0 }, swing.angle)));
          const o = toScreen(v, add(swing.hinge, rotate({ x: swing.width, y: 0 }, swing.angle + (swing.swing === 'left' ? 90_000 : -90_000))));
          const r = swing.width * v.scale;
          // Screen y points down, so a counter-clockwise swing on the plan is clockwise on screen.
          return (
            <>
              <path d={`M${pt(c)}A${r.toFixed(1)},${r.toFixed(1)} 0 0 ${swing.swing === 'left' ? 0 : 1} ${pt(o)}`} className="door-arc" />
              <line x1={h.x} y1={h.y} x2={o.x} y2={o.y} className="door-leaf" />
            </>
          );
        })()}
      <title>{`Door ${opening.id}`}</title>
    </g>
  );
}

/** Each room's name and floor area from the walls, centred where there is most room. */
export function RoomAreas({ v, project, testId = true }: { v: Viewport; project: Project; testId?: boolean }) {
  const rooms = namedRooms(project.space);
  return (
    <g className="room-areas" pointerEvents="none">
      {rooms.map((r, i) => {
        const at = toScreen(v, r.label);
        const area = formatSquareMetres(toSquareMetres(r.area));
        const width = r.span.w * v.scale;
        // Only what fits inside the room: the name first goes, then the area, so a small room never prints across its walls.
        const name = r.name && width >= r.name.length * 7.5 + 10 ? r.name : undefined;
        if (width < area.length * 6.8 + 6 || r.span.d * v.scale < 22) return null;
        return (
          <text key={i} x={at.x} y={at.y} className="room-area" textAnchor="middle" {...(testId ? { 'data-room': i } : {})}>
            {name && <tspan x={at.x} dy="-0.35em" className="room-area-name">{name.toUpperCase()}</tspan>}
            <tspan x={at.x} dy={name ? '1.3em' : '0.35em'}>{area}</tspan>
          </text>
        );
      })}
    </g>
  );
}
