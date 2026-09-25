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
import type { ControlSettings } from '../logic/controls.js';
import { formatDegrees, formatLength } from '../logic/format.js';
import type { Action } from '../logic/session.js';
import { snapAngle, snapMove, type Guide } from '../logic/snap.js';
import { boxCentre, itemsInBox, movable, moveCommands, rotateCommands, selectionBounds } from '../logic/transform.js';
import { fitViewport, panBy, pathOf, toScreen, toWorld, zoomAt, type Viewport } from '../logic/viewport.js';

interface Props {
  /** What to draw: the saved project with any change in progress on top. */
  readonly project: Project;
  /** The saved project: gestures are measured from here, so a preview never drifts. */
  readonly saved: Project;
  readonly issues: readonly Issue[];
  readonly selectedIds: readonly Id[];
  readonly controls: ControlSettings;
  readonly viewport: Viewport | null;
  readonly onViewport: (v: Viewport) => void;
  readonly dispatch: (action: Action) => void;
}

type Gesture =
  | { kind: 'press'; id: Id; start: Vec2; pointerId: number; toggled: boolean }
  | { kind: 'move'; ids: readonly Id[]; last: Vec2; raw: Vec2; pointerId: number }
  | { kind: 'rotate'; ids: readonly Id[]; pivot: Vec2; lastAngle: number; raw: number; pointerId: number }
  | { kind: 'marquee'; start: Vec2; pointerId: number; additive: boolean }
  | { kind: 'pan'; last: Vec2; moved: boolean; pointerId: number };

/** What the canvas shows while a gesture runs: guide lines, the selection box, and a readout. */
interface Overlay {
  readonly guides?: readonly Guide[];
  readonly marquee?: { readonly a: Vec2; readonly b: Vec2 };
  readonly readout?: { readonly at: Vec2; readonly text: string };
}

const METRE = 10_000;
const DRAG_THRESHOLD = 3; // pixels before a press becomes a drag, so clicks never nudge items
const HANDLE_GAP = 26; // pixels between the selection box and the rotation handle

/**
 * The plan seen from above, with the mouse control of a drawing app:
 * click / Shift-click / box select, drag with grid and smart guides (Shift locks the axis,
 * Alt is slow and precise, Ctrl ignores snapping), a rotation handle, and pan and zoom.
 */
export function PlanCanvas({ project, saved, issues, selectedIds, controls, viewport, onViewport, dispatch }: Props) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const gesture = useRef<Gesture | null>(null);
  const [overlay, setOverlay] = useState<Overlay>({});
  const spaceHeld = useRef(false);
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

  // Space held turns a left-button drag into panning, as in drawing apps.
  useEffect(() => {
    // Only when nothing else wants the key: Space still presses a focused button or types in a field.
    const free = (e: KeyboardEvent) => e.target === document.body || (e.target instanceof Node && svgRef.current?.contains(e.target) === true);
    const down = (e: KeyboardEvent) => {
      if (e.code === 'Space' && free(e)) {
        spaceHeld.current = true;
        e.preventDefault();
      }
    };
    const up = (e: KeyboardEvent) => {
      if (e.code === 'Space') spaceHeld.current = false;
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
    };
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
      // Pinch on a touchpad arrives as Ctrl+wheel with small steps; both zoom around the cursor.
      const speed = event.ctrlKey ? 0.01 : 0.0015;
      onViewport(zoomAt(viewport, Math.exp(-event.deltaY * speed), { x: event.clientX - rect.left, y: event.clientY - rect.top }));
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
  const capture = (event: ReactPointerEvent) => svgRef.current?.setPointerCapture(event.pointerId);
  const wantsPan = (event: ReactPointerEvent) => event.button === 1 || event.button === 2 || spaceHeld.current;

  const onItemDown = (event: ReactPointerEvent, id: Id) => {
    if (wantsPan(event)) return; // let the background start a pan
    event.stopPropagation();
    if (event.button !== 0) return;
    const additive = event.shiftKey || event.ctrlKey || event.metaKey;
    const already = selectedIds.includes(id);
    if (additive) dispatch({ type: 'select', ids: [id], mode: 'toggle' });
    else if (!already) dispatch({ type: 'select', ids: [id] });
    gesture.current = { kind: 'press', id, start: local(event), pointerId: event.pointerId, toggled: additive };
    capture(event);
  };

  const onHandleDown = (event: ReactPointerEvent, pivot: Vec2) => {
    event.stopPropagation();
    if (event.button !== 0) return;
    const ids = movable(saved, selectedIds).map((i) => i.id);
    if (ids.length === 0) return;
    const w = toWorld(v, local(event));
    gesture.current = { kind: 'rotate', ids, pivot, lastAngle: Math.atan2(w.y - pivot.y, w.x - pivot.x), raw: 0, pointerId: event.pointerId };
    capture(event);
  };

  const onBackgroundDown = (event: ReactPointerEvent) => {
    if (wantsPan(event)) {
      gesture.current = { kind: 'pan', last: local(event), moved: false, pointerId: event.pointerId };
    } else if (event.button === 0) {
      gesture.current = { kind: 'marquee', start: local(event), pointerId: event.pointerId, additive: event.shiftKey || event.ctrlKey || event.metaKey };
    } else return;
    capture(event);
  };

  const startMove = (g: Extract<Gesture, { kind: 'press' }>): Gesture | null => {
    // Shift-clicking an item off the selection must not drag the rest.
    const picked = g.toggled && !selectedIds.includes(g.id) ? [] : selectedIds.includes(g.id) ? selectedIds : [g.id];
    const ids = movable(saved, picked).map((i) => i.id);
    if (ids.length === 0) return null;
    // Measured from the press point, so the distance covered before the threshold is kept.
    return { kind: 'move', ids, last: g.start, raw: { x: 0, y: 0 }, pointerId: g.pointerId };
  };

  const onMove = (event: ReactPointerEvent) => {
    let g = gesture.current;
    if (!g || g.pointerId !== event.pointerId) return;
    const point = local(event);
    if (g.kind === 'press') {
      if (Math.hypot(point.x - g.start.x, point.y - g.start.y) < DRAG_THRESHOLD) return;
      const next = startMove(g);
      gesture.current = next;
      if (!next) return;
      g = next;
    }
    if (g.kind === 'move') {
      const speed = event.altKey ? controls.fineDragSpeed : controls.dragSpeed;
      const raw = { x: g.raw.x + ((point.x - g.last.x) / v.scale) * speed, y: g.raw.y - ((point.y - g.last.y) / v.scale) * speed };
      gesture.current = { ...g, last: point, raw };
      const lock = event.shiftKey ? (Math.abs(raw.x) >= Math.abs(raw.y) ? 'x' : 'y') : null;
      const free = event.ctrlKey || event.metaKey || event.altKey;
      const snapped = snapMove(saved, g.ids, raw, { grid: free ? 1 : controls.grid, guides: controls.guides && !free, threshold: controls.guideDistance / v.scale }, lock);
      dispatch({ type: 'preview', command: moveCommands(saved, g.ids, snapped.delta) });
      setOverlay({ guides: snapped.guides, readout: { at: point, text: `${formatLength(snapped.delta.x)} ، ${formatLength(snapped.delta.y)}` } });
    } else if (g.kind === 'rotate') {
      const w = toWorld(v, point);
      const angle = Math.atan2(w.y - g.pivot.y, w.x - g.pivot.x);
      let turn = angle - g.lastAngle;
      if (turn > Math.PI) turn -= 2 * Math.PI;
      if (turn < -Math.PI) turn += 2 * Math.PI;
      const raw = g.raw + ((turn * 180) / Math.PI) * 1000 * (event.altKey ? controls.fineDragSpeed : 1);
      gesture.current = { ...g, lastAngle: angle, raw };
      // Snap the leading item's final angle (not the turn), so it lands on 0°, 15°, 30°…
      const lead = saved.items[g.ids[0]!]!;
      const delta = event.shiftKey || event.altKey ? Math.round(raw) : snapAngle(lead.rotation + raw, controls.angleStep) - lead.rotation;
      dispatch({ type: 'preview', command: rotateCommands(saved, g.ids, delta, g.ids.length > 1 ? g.pivot : undefined) });
      setOverlay({ readout: { at: point, text: `${formatDegrees(delta)} ← ${formatDegrees(((lead.rotation + delta) % 360_000 + 360_000) % 360_000)}` } });
    } else if (g.kind === 'marquee') {
      setOverlay({ marquee: { a: g.start, b: point } });
    } else if (g.kind === 'pan') {
      const dx = point.x - g.last.x;
      const dy = point.y - g.last.y;
      if (Math.abs(dx) + Math.abs(dy) > 0) {
        gesture.current = { ...g, last: point, moved: g.moved || Math.abs(dx) + Math.abs(dy) > 2 };
        onViewport(panBy(v, dx, dy));
      }
    }
  };

  const finish = (event: ReactPointerEvent, cancelled = false) => {
    const g = gesture.current;
    if (!g || g.pointerId !== event.pointerId) return;
    gesture.current = null;
    svgRef.current?.releasePointerCapture(event.pointerId);
    setOverlay({});
    if (g.kind === 'move' || g.kind === 'rotate') {
      dispatch({ type: cancelled ? 'preview-cancel' : 'preview-commit' });
    } else if (g.kind === 'press') {
      // A plain click inside a group picks just that item.
      if (!g.toggled && selectedIds.length > 1) dispatch({ type: 'select', ids: [g.id] });
    } else if (g.kind === 'marquee' && !cancelled) {
      const end = local(event);
      const a = toWorld(v, g.start);
      const b = toWorld(v, end);
      if (Math.hypot(end.x - g.start.x, end.y - g.start.y) < DRAG_THRESHOLD) {
        if (!g.additive) dispatch({ type: 'select', ids: [] });
      } else {
        const ids = itemsInBox(project, { minX: Math.min(a.x, b.x), minY: Math.min(a.y, b.y), maxX: Math.max(a.x, b.x), maxY: Math.max(a.y, b.y) });
        dispatch({ type: 'select', ids, mode: g.additive ? 'add' : 'replace' });
      }
    }
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

  // Floor items first, then raised ones on top, so a lamp over a table can still be picked.
  const items = Object.values(project.items).sort((a, b) => (a.elevation ?? 0) - (b.elevation ?? 0));
  const topLeft = toScreen(v, { x: roomBounds.minX, y: roomBounds.maxY });
  const bottomRight = toScreen(v, { x: roomBounds.maxX, y: roomBounds.minY });
  const selected = new Set(selectedIds);
  const box = selectionBounds(project, selectedIds);
  const canTurn = movable(project, selectedIds).length > 0;
  const boxTop = box ? toScreen(v, { x: box.minX, y: box.maxY }) : null;
  const boxBottom = box ? toScreen(v, { x: box.maxX, y: box.minY }) : null;
  const pivot = box ? (selectedIds.length === 1 && project.items[selectedIds[0]!] ? project.items[selectedIds[0]!]!.position : boxCentre(box)) : null;

  return (
    <svg
      ref={svgRef}
      className="plan"
      aria-label="المخطط"
      data-selected={selectedIds.join(' ')}
      onPointerDown={onBackgroundDown}
      onPointerMove={onMove}
      onPointerUp={(e) => finish(e)}
      onPointerCancel={(e) => finish(e, true)}
      onContextMenu={(e) => e.preventDefault()}
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
        const classes = ['item', severityOf.get(item.id) ?? '', selected.has(item.id) ? 'selected' : '', item.locked ? 'locked' : '', item.elevation ? 'raised' : ''];
        // Labels are written horizontally, so they need the item's on-screen width and height.
        const upright = item.rotation % 180_000 === 0;
        const across = upright ? definition.size.w : definition.size.d;
        const tall = upright ? definition.size.d : definition.size.w;
        const straight = item.rotation % 90_000 === 0;
        const showLabel = straight && across * v.scale > 7 * definition.name.length + 8 && tall * v.scale > 14;
        return (
          <g key={item.id} data-item-id={item.id} className={classes.join(' ').replace(/\s+/g, ' ').trim()} onPointerDown={(e) => onItemDown(e, item.id)}>
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
      {boxTop && boxBottom && pivot && (
        <g className="selection-box">
          <rect x={boxTop.x - 4} y={boxTop.y - 4} width={boxBottom.x - boxTop.x + 8} height={boxBottom.y - boxTop.y + 8} className="selection-frame" />
          {canTurn && (
            <>
              <line x1={(boxTop.x + boxBottom.x) / 2} y1={boxTop.y - 4} x2={(boxTop.x + boxBottom.x) / 2} y2={boxTop.y - HANDLE_GAP} className="rotate-stem" />
              <circle
                cx={(boxTop.x + boxBottom.x) / 2}
                cy={boxTop.y - HANDLE_GAP}
                r={7}
                className="rotate-handle"
                data-testid="rotate-handle"
                onPointerDown={(e) => onHandleDown(e, pivot)}
              >
                <title>اسحب للّف (Shift: من غير تقريب، Alt: ببطء)</title>
              </circle>
            </>
          )}
        </g>
      )}
      {overlay.guides?.map((g, i) => {
        const a = toScreen(v, g.axis === 'x' ? { x: g.at, y: g.from } : { x: g.from, y: g.at });
        const b = toScreen(v, g.axis === 'x' ? { x: g.at, y: g.to } : { x: g.to, y: g.at });
        return <line key={`g-${i}`} x1={a.x} y1={a.y} x2={b.x} y2={b.y} className="guide" />;
      })}
      {overlay.marquee && (
        <rect
          className="marquee"
          data-testid="marquee"
          x={Math.min(overlay.marquee.a.x, overlay.marquee.b.x)}
          y={Math.min(overlay.marquee.a.y, overlay.marquee.b.y)}
          width={Math.abs(overlay.marquee.a.x - overlay.marquee.b.x)}
          height={Math.abs(overlay.marquee.a.y - overlay.marquee.b.y)}
        />
      )}
      <text x={(topLeft.x + bottomRight.x) / 2} y={topLeft.y - 12} className="dimension">
        {formatLength(roomBounds.maxX - roomBounds.minX)}
      </text>
      <text x={bottomRight.x + 8} y={(topLeft.y + bottomRight.y) / 2} className="dimension side">
        {formatLength(roomBounds.maxY - roomBounds.minY)}
      </text>
      {overlay.readout && (
        <g className="readout" transform={`translate(${overlay.readout.at.x + 14},${overlay.readout.at.y + 22})`}>
          <rect x={-4} y={-13} width={overlay.readout.text.length * 6.4 + 8} height={19} />
          <text data-testid="readout">{overlay.readout.text}</text>
        </g>
      )}
    </svg>
  );
}
