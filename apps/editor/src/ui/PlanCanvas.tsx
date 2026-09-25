import {
  boundsOf,
  doorPolygon,
  footprintOf,
  itemClearancePolygon,
  itemPolygon,
  rectangle,
  type Id,
  type Issue,
  type Project,
  type Vec2,
} from '@space-planner/core';
import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import type { Action } from '../logic/session.js';
import { snapPoint } from '../logic/snap.js';
import { fitViewport, panBy, pathOf, toScreen, toWorld, zoomAt, type Viewport } from '../logic/viewport.js';
import { formatLength } from '../logic/format.js';

interface Props {
  readonly project: Project;
  readonly issues: readonly Issue[];
  readonly selectedId: Id | null;
  readonly snapStep: number;
  readonly viewport: Viewport | null;
  readonly onViewport: (v: Viewport) => void;
  readonly dispatch: (action: Action) => void;
}

type Gesture =
  | { kind: 'drag'; id: Id; grab: Vec2; pointerId: number }
  | { kind: 'pan'; last: Vec2; moved: boolean; pointerId: number };

const METRE = 10_000;

export function PlanCanvas({ project, issues, selectedId, snapStep, viewport, onViewport, dispatch }: Props) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const gesture = useRef<Gesture | null>(null);
  const roomBounds = useMemo(() => boundsOf(project.space.boundary), [project.space.boundary]);

  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setSize({ width: entry.contentRect.width, height: entry.contentRect.height });
    });
    observer.observe(svg);
    return () => observer.disconnect();
  }, []);

  // Fit when there is no view yet, and again whenever the room itself changes size.
  const fittedRoom = useRef<string | null>(null);
  useEffect(() => {
    if (size.width === 0) return;
    const key = `${roomBounds.minX},${roomBounds.minY},${roomBounds.maxX},${roomBounds.maxY}`;
    if (!viewport || fittedRoom.current !== key) {
      fittedRoom.current = key;
      onViewport(fitViewport(roomBounds, size.width, size.height));
    }
  }, [viewport, size, roomBounds, onViewport]);

  useEffect(() => {
    const svg = svgRef.current;
    if (!svg || !viewport) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const rect = svg.getBoundingClientRect();
      onViewport(zoomAt(viewport, Math.exp(-event.deltaY * 0.0015), { x: event.clientX - rect.left, y: event.clientY - rect.top }));
    };
    svg.addEventListener('wheel', onWheel, { passive: false });
    return () => svg.removeEventListener('wheel', onWheel);
  }, [viewport, onViewport]);

  if (!viewport) return <svg ref={svgRef} className="plan" aria-label="المخطط" />;
  const v = viewport;

  const local = (event: ReactPointerEvent): Vec2 => {
    const rect = svgRef.current!.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  };

  const onItemDown = (event: ReactPointerEvent, id: Id) => {
    event.stopPropagation();
    const item = project.items[id];
    if (!item) return;
    dispatch({ type: 'select', id });
    if (item.locked || event.button !== 0) return;
    const world = toWorld(v, local(event));
    gesture.current = { kind: 'drag', id, grab: { x: world.x - item.position.x, y: world.y - item.position.y }, pointerId: event.pointerId };
    svgRef.current?.setPointerCapture(event.pointerId);
  };

  const onBackgroundDown = (event: ReactPointerEvent) => {
    gesture.current = { kind: 'pan', last: local(event), moved: false, pointerId: event.pointerId };
    svgRef.current?.setPointerCapture(event.pointerId);
  };

  const onMove = (event: ReactPointerEvent) => {
    const g = gesture.current;
    if (!g || g.pointerId !== event.pointerId) return;
    const point = local(event);
    if (g.kind === 'drag') {
      const world = toWorld(v, point);
      dispatch({ type: 'drag-move', id: g.id, to: snapPoint({ x: world.x - g.grab.x, y: world.y - g.grab.y }, snapStep) });
    } else {
      const dx = point.x - g.last.x;
      const dy = point.y - g.last.y;
      if (Math.abs(dx) + Math.abs(dy) > 0) {
        gesture.current = { ...g, last: point, moved: g.moved || Math.abs(dx) + Math.abs(dy) > 2 };
        onViewport(panBy(v, dx, dy));
      }
    }
  };

  const onUp = (event: ReactPointerEvent) => {
    const g = gesture.current;
    if (!g || g.pointerId !== event.pointerId) return;
    gesture.current = null;
    svgRef.current?.releasePointerCapture(event.pointerId);
    if (g.kind === 'drag') dispatch({ type: 'drag-end' });
    else if (!g.moved) dispatch({ type: 'select', id: null });
  };

  const severityOf = new Map<Id, 'error' | 'warning'>();
  for (const issue of issues) {
    const first = issue.entityIds[0];
    if (!first || issue.severity === 'info') continue;
    if (issue.severity === 'error' || !severityOf.has(first)) severityOf.set(first, issue.severity);
  }

  const gridLines: string[] = [];
  const pxPerMetre = v.scale * METRE;
  if (pxPerMetre >= 8) {
    for (let x = Math.ceil(roomBounds.minX / METRE) * METRE; x <= roomBounds.maxX; x += METRE) {
      gridLines.push(`M${toScreen(v, { x, y: roomBounds.minY }).x.toFixed(1)},${toScreen(v, { x, y: roomBounds.minY }).y.toFixed(1)}V${toScreen(v, { x, y: roomBounds.maxY }).y.toFixed(1)}`);
    }
    for (let y = Math.ceil(roomBounds.minY / METRE) * METRE; y <= roomBounds.maxY; y += METRE) {
      gridLines.push(`M${toScreen(v, { x: roomBounds.minX, y }).x.toFixed(1)},${toScreen(v, { x: roomBounds.minX, y }).y.toFixed(1)}H${toScreen(v, { x: roomBounds.maxX, y }).x.toFixed(1)}`);
    }
  }

  const items = Object.values(project.items);
  const topLeft = toScreen(v, { x: roomBounds.minX, y: roomBounds.maxY });
  const bottomRight = toScreen(v, { x: roomBounds.maxX, y: roomBounds.minY });

  return (
    <svg
      ref={svgRef}
      className="plan"
      aria-label="المخطط"
      onPointerDown={onBackgroundDown}
      onPointerMove={onMove}
      onPointerUp={onUp}
      onPointerCancel={() => {
        gesture.current = null;
        dispatch({ type: 'drag-cancel' });
      }}
    >
      <defs>
        <pattern id="hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <line x1="0" y1="0" x2="0" y2="6" className="hatch-line" />
        </pattern>
      </defs>
      <path d={pathOf(v, project.space.boundary)} className="floor" />
      <path d={gridLines.join('')} className="grid" />
      <path d={pathOf(v, project.space.boundary)} className="wall" />
      {project.space.obstacles.map((o) => (
        <path key={o.id} d={pathOf(v, o.polygon)} className="obstacle" />
      ))}
      {project.space.doors.map((d) => (
        <path key={d.id} d={pathOf(v, doorPolygon(d))} className="door" />
      ))}
      {items.map((item) => {
        const definition = project.catalog[item.definitionId];
        if (!definition) return null;
        return <path key={`z-${item.id}`} d={pathOf(v, itemClearancePolygon(item, definition))} className="clearance" />;
      })}
      {items.map((item) => {
        const definition = project.catalog[item.definitionId];
        if (!definition) return null;
        const body = itemPolygon(item, definition);
        // The front edge of the bounding rectangle shows which way the item faces, round or not.
        const outline = rectangle(footprintOf(item, definition));
        const front = [toScreen(v, outline[2]!), toScreen(v, outline[3]!)];
        const centre = toScreen(v, item.position);
        const classes = ['item', severityOf.get(item.id) ?? '', item.id === selectedId ? 'selected' : '', item.locked ? 'locked' : ''];
        // Labels are written horizontally, so they need the item's on-screen width and height.
        const upright = item.rotation % 180_000 === 0;
        const across = upright ? definition.size.w : definition.size.d;
        const tall = upright ? definition.size.d : definition.size.w;
        const straight = item.rotation % 90_000 === 0;
        const showLabel = straight && across * v.scale > 7 * definition.name.length + 8 && tall * v.scale > 14;
        return (
          <g key={item.id} data-item-id={item.id} className={classes.join(' ').trim()} onPointerDown={(e) => onItemDown(e, item.id)}>
            <path d={pathOf(v, body)} className="item-body" />
            <line x1={front[0]!.x} y1={front[0]!.y} x2={front[1]!.x} y2={front[1]!.y} className="item-front" />
            {showLabel && (
              <text x={centre.x} y={centre.y} className="item-label">
                {definition.name}
              </text>
            )}
          </g>
        );
      })}
      {issues.map((issue, i) =>
        issue.evidence && issue.severity !== 'info' ? (
          <path key={`e-${i}`} d={pathOf(v, issue.evidence)} className={`evidence ${issue.severity}`} />
        ) : null,
      )}
      <text x={(topLeft.x + bottomRight.x) / 2} y={topLeft.y - 12} className="dimension">
        {formatLength(roomBounds.maxX - roomBounds.minX)}
      </text>
      <text x={bottomRight.x + 8} y={(topLeft.y + bottomRight.y) / 2} className="dimension side">
        {formatLength(roomBounds.maxY - roomBounds.minY)}
      </text>
    </svg>
  );
}
