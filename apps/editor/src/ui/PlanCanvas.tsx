import {
  add,
  boundsOf,
  doorPolygon,
  footprintOf,
  itemClearancePolygon,
  itemPolygon,
  rectangle,
  rotate,
  type Aabb,
  type Id,
  type Issue,
  type Project,
  type Vec2,
} from '@space-planner/core';
import { useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react';
import { CornersOut, Minus, Plus } from '@phosphor-icons/react';
import type { ControlSettings } from '../logic/controls.js';
import { formatCentimetres, formatCount, formatDegrees, formatLength, formatMetres } from '../logic/format.js';
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
  /** A saved revision shown for reference: pan and zoom only. */
  readonly readOnly?: boolean;
  /** An item type dropped from the library at a point on the plan. */
  readonly onDropType?: (definitionId: string, at: Vec2) => void;
  /** Re-fit the whole room. */
  readonly onFit?: () => void;
  /** Zoom relative to the fitted room (1 = fitted) and the drawing scale (100 for 1:100). */
  readonly onZoom?: (zoom: number, scaleRatio: number) => void;
  /** A wall that is really a pair of doors along its whole width (a container's east end). */
  readonly openEnd?: 'east' | undefined;
  /** Fill colours per item (a container coloured by stop, weight or step). */
  readonly itemFills?: ReadonlyMap<Id, string> | undefined;
  /** Labels that replace the type name (loading step numbers). */
  readonly itemLabels?: ReadonlyMap<Id, string> | undefined;
  /** A driving route to draw over the plan (a truck from the dock to a rack bay). */
  readonly route?: readonly Vec2[] | undefined;
  /** Directed flows to draw as arrows (production lines); crossing flows are marked. */
  readonly arrows?: ReadonlyArray<{ readonly from: Vec2; readonly to: Vec2; readonly crossing: boolean; readonly key: string }> | undefined;
  /** Extra dashed outlines under the items (maintenance space). */
  readonly outlines?: ReadonlyArray<{ readonly key: string; readonly polygon: readonly Vec2[] }> | undefined;
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
const FIT_TOP = 96; // room for the pane title and the ruler
const FIT_BOTTOM = 60; // room for the scale bar and the zoom tools
const FIT_SIDE = 56;

/** Fit the room below the pane title and above the scale bar. */
export function fitRoom(bounds: Aabb, width: number, height: number): Viewport {
  const v = fitViewport(bounds, width, Math.max(1, height - FIT_TOP - FIT_BOTTOM + 2 * FIT_SIDE), FIT_SIDE);
  return { ...v, offsetY: v.offsetY + FIT_TOP - FIT_SIDE };
}
const DRAG_THRESHOLD = 3; // pixels before a press becomes a drag, so clicks never nudge items
const HANDLE_GAP = 26; // pixels between the selection box and the rotation handle

/**
 * The plan seen from above, with the mouse control of a drawing app:
 * click / Shift-click / box select, drag with grid and smart guides (Shift locks the axis,
 * Alt is slow and precise, Ctrl ignores snapping), a rotation handle, and pan and zoom.
 */
export function PlanCanvas({ project, saved, issues, selectedIds, controls, viewport, onViewport, dispatch, readOnly = false, onDropType, onFit, onZoom, openEnd, itemFills, itemLabels, route, arrows, outlines }: Props) {
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
  // A view that was fitted automatically and not panned or zoomed since follows the pane's size
  // (switching to the split view, collapsing a side panel).
  const fittedRoom = useRef<string | null>(null);
  const autoFit = useRef<{ view: Viewport; width: number; height: number } | null>(null);
  useEffect(() => {
    if (size.width === 0) return;
    const key = `${roomBounds.minX},${roomBounds.minY},${roomBounds.maxX},${roomBounds.maxY}`;
    const resized = autoFit.current !== null && autoFit.current.view === viewport && (autoFit.current.width !== size.width || autoFit.current.height !== size.height);
    if (!viewport || fittedRoom.current !== key || resized) {
      fittedRoom.current = key;
      const next = fitRoom(roomBounds, size.width, size.height);
      autoFit.current = { view: next, width: size.width, height: size.height };
      onViewport(next);
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

  const fitScale = size.width > 0 ? fitRoom(roomBounds, size.width, size.height).scale : 0;
  const zoom = viewport && fitScale > 0 ? viewport.scale / fitScale : 1;
  // At 96 px per inch one pixel is 0.2646 mm = 2.646 ticks; 1:N means N real units per drawn unit.
  const scaleRatio = viewport ? 1 / (viewport.scale * 2.6458) : 0;
  useEffect(() => {
    if (viewport) onZoom?.(zoom, scaleRatio);
  }, [zoom, scaleRatio, viewport, onZoom]);

  if (!viewport) return <svg ref={svgRef} className="plan" aria-label="Plan" />;
  const v = viewport;

  const local = (event: ReactPointerEvent): Vec2 => {
    const rect = svgRef.current!.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  };
  const capture = (event: ReactPointerEvent) => svgRef.current?.setPointerCapture(event.pointerId);
  const wantsPan = (event: ReactPointerEvent) => event.button === 1 || event.button === 2 || spaceHeld.current;

  const onItemDown = (event: ReactPointerEvent, id: Id) => {
    if (wantsPan(event) || readOnly) return; // let the background start a pan
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
    } else if (readOnly && event.button === 0) {
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
      setOverlay({ guides: snapped.guides, readout: { at: point, text: `${formatLength(snapped.delta.x)}, ${formatLength(snapped.delta.y)}` } });
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
      setOverlay({ readout: { at: point, text: `${formatDegrees(delta)} → ${formatDegrees(((lead.rotation + delta) % 360_000 + 360_000) % 360_000)}` } });
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

  const pxPerMetre = v.scale * METRE;
  const lines = (step: number) => {
    const out: string[] = [];
    for (let x = Math.ceil(roomBounds.minX / step) * step; x <= roomBounds.maxX; x += step) {
      const a = toScreen(v, { x, y: roomBounds.minY });
      const b = toScreen(v, { x, y: roomBounds.maxY });
      out.push(`M${a.x.toFixed(1)},${a.y.toFixed(1)}V${b.y.toFixed(1)}`);
    }
    for (let y = Math.ceil(roomBounds.minY / step) * step; y <= roomBounds.maxY; y += step) {
      const a = toScreen(v, { x: roomBounds.minX, y });
      const b = toScreen(v, { x: roomBounds.maxX, y });
      out.push(`M${a.x.toFixed(1)},${a.y.toFixed(1)}H${b.x.toFixed(1)}`);
    }
    return out.join('');
  };
  // Metre lines when they are at least 8 px apart; 10 cm lines once they are 8 px apart too.
  const majorGrid = pxPerMetre >= 8 ? lines(METRE) : '';
  const minorGrid = pxPerMetre >= 80 ? lines(METRE / 10) : pxPerMetre >= 30 ? lines(METRE / 2) : '';
  // Walls are drawn about 20 cm thick outside the floor, never thinner than 3 px.
  const wall = Math.min(16, Math.max(3, 2_000 * v.scale));
  // Ruler labels every 1, 2, 5, 10… metres, whichever keeps them 44 px apart.
  const rulerStep = [1, 2, 5, 10, 20, 50, 100].find((m) => m * pxPerMetre >= 44) ?? 100;
  const rulerX: number[] = [];
  const rulerY: number[] = [];
  for (let m = 0; m * METRE <= roomBounds.maxX - roomBounds.minX + 1; m += rulerStep) rulerX.push(m);
  for (let m = 0; m * METRE <= roomBounds.maxY - roomBounds.minY + 1; m += rulerStep) rulerY.push(m);
  // Scale bar: the round length closest to 90 px.
  const barMetres = [0.5, 1, 2, 5, 10, 20, 50].reduce((best, m) => (Math.abs(m * pxPerMetre - 90) < Math.abs(best * pxPerMetre - 90) ? m : best), 1);

  // Floor items first, then raised ones on top, so a lamp over a table can still be picked.
  const items = Object.values(project.items).sort((a, b) => (a.elevation ?? 0) - (b.elevation ?? 0));
  const selected = new Set(selectedIds);
  const box = selectionBounds(project, selectedIds);
  const canTurn = !readOnly && movable(project, selectedIds).length > 0;
  const boxTop = box ? toScreen(v, { x: box.minX, y: box.maxY }) : null;
  const boxBottom = box ? toScreen(v, { x: box.maxX, y: box.minY }) : null;
  const pivot = box ? (selectedIds.length === 1 && project.items[selectedIds[0]!] ? project.items[selectedIds[0]!]!.position : boxCentre(box)) : null;
  const single = selectedIds.length === 1 ? project.items[selectedIds[0]!] : undefined;
  const singleDef = single ? project.catalog[single.definitionId] : undefined;
  const chip = !box
    ? ''
    : singleDef
      ? `${formatCentimetres(singleDef.size.w)} × ${formatCentimetres(singleDef.size.d)} cm`
      : `${formatCount(selectedIds.length)} selected · ${formatMetres(box.maxX - box.minX)} × ${formatMetres(box.maxY - box.minY)} m`;

  return (
    <>
      <svg
        ref={svgRef}
        className={`plan${readOnly ? ' preview' : ''}`}
        aria-label="Plan"
        data-selected={selectedIds.join(' ')}
        onPointerDown={onBackgroundDown}
        onPointerMove={onMove}
        onPointerUp={(e) => finish(e)}
        onPointerCancel={(e) => finish(e, true)}
        onContextMenu={(e) => e.preventDefault()}
        onDragOver={(e) => {
          if (readOnly || !onDropType || !e.dataTransfer.types.includes('application/x-atrium-type')) return;
          e.preventDefault();
          e.dataTransfer.dropEffect = 'copy';
        }}
        onDrop={(e) => {
          const id = e.dataTransfer.getData('application/x-atrium-type');
          if (readOnly || !onDropType || !id) return;
          e.preventDefault();
          const rect = svgRef.current!.getBoundingClientRect();
          onDropType(id, toWorld(v, { x: e.clientX - rect.left, y: e.clientY - rect.top }));
        }}
      >
        <defs>
          <pattern id="hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <line x1="0" y1="0" x2="0" y2="6" className="hatch-line" />
          </pattern>
          <pattern id="clear-hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <line x1="0" y1="0" x2="0" y2="6" className="clear-hatch-line" />
          </pattern>
        </defs>
        <path d={pathOf(v, project.space.boundary)} className="wall" style={{ strokeWidth: wall * 2 }} />
        <path d={pathOf(v, project.space.boundary)} className="floor" />
        {openEnd === 'east' &&
          (() => {
            const a = toScreen(v, { x: roomBounds.maxX, y: roomBounds.minY });
            const b = toScreen(v, { x: roomBounds.maxX, y: roomBounds.maxY });
            return (
              <g className="open-end" pointerEvents="none">
                <line x1={a.x + wall} y1={a.y} x2={b.x + wall} y2={b.y} style={{ stroke: 'var(--paper)', strokeWidth: wall * 2 + 2 }} />
                <line x1={a.x + wall / 2} y1={a.y} x2={b.x + wall / 2} y2={b.y} className="door-arc" />
                <text x={a.x + wall + 8} y={(a.y + b.y) / 2} className="ruler" dominantBaseline="middle" transform={`rotate(90 ${a.x + wall + 8} ${(a.y + b.y) / 2})`} textAnchor="middle">
                  DOORS
                </text>
              </g>
            );
          })()}
        {(project.space.zones ?? []).map((z) => {
          const b = boundsOf(z.polygon);
          const corner = toScreen(v, { x: b.minX, y: b.maxY });
          return (
            <g key={z.id} className={`zone zone-${z.kind}`} data-zone={z.id} pointerEvents="none">
              <path d={pathOf(v, z.polygon)} />
              <text x={corner.x + 6} y={corner.y + 14} className="zone-label">
                {z.name ?? z.kind}
              </text>
            </g>
          );
        })}
        <path d={minorGrid} className="grid-minor" />
        <path d={majorGrid} className="grid" />
        {rulerX.map((m) => {
          const at = toScreen(v, { x: roomBounds.minX + m * METRE, y: roomBounds.maxY });
          return (
            <g key={`rx-${m}`}>
              <line x1={at.x} y1={at.y - wall - 3} x2={at.x} y2={at.y - wall - 8} className="ruler-tick" />
              <text x={at.x} y={at.y - wall - 12} className="ruler" textAnchor="middle">
                {m}
              </text>
            </g>
          );
        })}
        {rulerY.map((m) => {
          const at = toScreen(v, { x: roomBounds.minX, y: roomBounds.minY + m * METRE });
          return (
            <text key={`ry-${m}`} x={at.x - wall - 8} y={at.y} className="ruler" textAnchor="end" dominantBaseline="middle">
              {m}
            </text>
          );
        })}
        {project.space.obstacles.map((o) => (
          <path key={o.id} d={pathOf(v, o.polygon)} className={`obstacle ${o.kind === 'column' ? 'column' : 'blocked-zone'}`} data-obstacle={o.id}>
            <title>{`${o.kind === 'column' ? 'Column' : 'Blocked zone'} ${o.id}`}</title>
          </path>
        ))}
        {project.space.doors.map((d) => {
          const closed = add(d.hinge, rotate({ x: d.width, y: 0 }, d.angle));
          const open = add(d.hinge, rotate({ x: d.width, y: 0 }, d.angle + (d.swing === 'left' ? 90_000 : -90_000)));
          const h = toScreen(v, d.hinge);
          const c = toScreen(v, closed);
          const o = toScreen(v, open);
          const r = d.width * v.scale;
          // Screen y points down, so a counter-clockwise swing on the plan is clockwise on screen.
          const sweep = d.swing === 'left' ? 0 : 1;
          return (
            <g key={d.id} data-door={d.id}>
              <path d={pathOf(v, doorPolygon(d))} className="door door-zone" />
              <line x1={h.x} y1={h.y} x2={c.x} y2={c.y} className="door-gap" style={{ strokeWidth: wall * 2 + 2 }} />
              <path d={`M${c.x.toFixed(1)},${c.y.toFixed(1)}A${r.toFixed(1)},${r.toFixed(1)} 0 0 ${sweep} ${o.x.toFixed(1)},${o.y.toFixed(1)}`} className="door-arc" />
              <line x1={h.x} y1={h.y} x2={o.x} y2={o.y} className="door-leaf" />
              <title>{`Door ${d.id}`}</title>
            </g>
          );
        })}
        {outlines?.map((o) => <path key={`m-${o.key}`} d={pathOf(v, o.polygon)} className="maintenance" data-maintenance={o.key} />)}
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
          const classes = ['item', `shape-${definition.category}`, severityOf.get(item.id) ?? '', selected.has(item.id) ? 'selected' : '', item.locked ? 'locked' : '', item.elevation ? 'raised' : ''];
          // Labels are written horizontally, so they need the item's on-screen width and height.
          const upright = item.rotation % 180_000 === 0;
          const across = upright ? definition.size.w : definition.size.d;
          const tall = upright ? definition.size.d : definition.size.w;
          const straight = item.rotation % 90_000 === 0;
          const label = itemLabels?.get(item.id) ?? definition.name;
          const showLabel = (straight || itemLabels !== undefined) && across * v.scale > 6.2 * label.length + 10 && tall * v.scale > 16;
          const fill = itemFills?.get(item.id);
          return (
            <g key={item.id} data-item-id={item.id} className={classes.join(' ').replace(/\s+/g, ' ').trim()} onPointerDown={(e) => onItemDown(e, item.id)} style={fill ? ({ '--fill': fill } as CSSProperties) : undefined}>
              <path d={pathOf(v, body)} className="item-body" />
              <line x1={front[0]!.x} y1={front[0]!.y} x2={front[1]!.x} y2={front[1]!.y} className="item-front" />
              {showLabel && (
                <text x={centre.x} y={centre.y} className="item-label">
                  {label}
                </text>
              )}
            </g>
          );
        })}
        {arrows && arrows.length > 0 && (
          <g className="flows" pointerEvents="none">
            <defs>
              <marker id="flow-head" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                <path d="M0,0 L10,5 L0,10 z" className="flow-head" />
              </marker>
            </defs>
            {arrows.map((a) => {
              const p = toScreen(v, a.from);
              const q = toScreen(v, a.to);
              return <line key={a.key} x1={p.x} y1={p.y} x2={q.x} y2={q.y} className={`flow${a.crossing ? ' crossing' : ''}`} markerEnd="url(#flow-head)" data-flow={a.key} />;
            })}
          </g>
        )}
        {route && route.length > 1 && (
          <g className="route" data-testid="route" pointerEvents="none">
            <polyline points={route.map((p) => toScreen(v, p)).map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ')} />
            {[route[0]!, route.at(-1)!].map((p, i) => {
              const q = toScreen(v, p);
              return <circle key={i} cx={q.x} cy={q.y} r={i === 0 ? 4 : 5} className={i === 0 ? 'route-start' : 'route-end'} />;
            })}
          </g>
        )}
        {issues.map((issue, i) =>
          issue.evidence && issue.severity !== 'info' ? <path key={`e-${i}`} d={pathOf(v, issue.evidence)} className={`evidence ${issue.severity}`} /> : null,
        )}
        {items.map((item) => {
          const sev = severityOf.get(item.id);
          const definition = project.catalog[item.definitionId];
          if (!sev || !definition) return null;
          const corners = itemPolygon(item, definition).map((p) => toScreen(v, p));
          const x = Math.max(...corners.map((p) => p.x));
          const y = Math.min(...corners.map((p) => p.y));
          return (
            <g key={`b-${item.id}`} className={`badge-dot ${sev}`} transform={`translate(${x.toFixed(1)},${y.toFixed(1)})`} pointerEvents="none">
              <circle r={6.5} />
              <text>{sev === 'error' ? '×' : '!'}</text>
            </g>
          );
        })}
        {boxTop && boxBottom && pivot && (
          <g className="selection-box">
            {(() => {
              const x = boxTop.x - 5;
              const y = boxTop.y - 5;
              const w = boxBottom.x - boxTop.x + 10;
              const h = boxBottom.y - boxTop.y + 10;
              const handles = [
                [x, y], [x + w / 2, y], [x + w, y],
                [x, y + h / 2], [x + w, y + h / 2],
                [x, y + h], [x + w / 2, y + h], [x + w, y + h],
              ];
              const chipWidth = chip.length * 6 + 14;
              return (
                <>
                  <rect x={x} y={y} width={w} height={h} className={`selection-frame${selectedIds.length > 1 ? ' many' : ''}`} />
                  {handles.map(([hx, hy], i) => (
                    <rect key={i} x={hx! - 3.5} y={hy! - 3.5} width={7} height={7} className="selection-handle" />
                  ))}
                  <g className="size-chip" transform={`translate(${(x + w / 2).toFixed(1)},${(y + h + 16).toFixed(1)})`} pointerEvents="none">
                    <rect x={-chipWidth / 2} y={-9} width={chipWidth} height={18} rx={3} />
                    <text data-testid="size-chip">{chip}</text>
                  </g>
                </>
              );
            })()}
            {canTurn && (
              <>
                <line x1={(boxTop.x + boxBottom.x) / 2} y1={boxTop.y - 5} x2={(boxTop.x + boxBottom.x) / 2} y2={boxTop.y - HANDLE_GAP} className="rotate-stem" />
                <circle cx={(boxTop.x + boxBottom.x) / 2} cy={boxTop.y - HANDLE_GAP} r={6} className="rotate-handle" data-testid="rotate-handle" onPointerDown={(e) => onHandleDown(e, pivot)}>
                  <title>Drag to rotate (Shift: free, Alt: slow)</title>
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
        {overlay.readout && (
          <g className="readout" transform={`translate(${overlay.readout.at.x + 14},${overlay.readout.at.y + 22})`}>
            <rect x={-6} y={-13} width={overlay.readout.text.length * 6.2 + 12} height={19} rx={3} />
            <text data-testid="readout">{overlay.readout.text}</text>
          </g>
        )}
      </svg>
      <div className="plan-legend" aria-hidden="true">
        <span className="bar" style={{ width: barMetres * pxPerMetre }} />
        {barMetres} m<span style={{ marginLeft: 14 }}>N ↑</span>
      </div>
      <div className="floating-tools" role="toolbar" aria-label="Zoom">
        <button type="button" title="Zoom out" aria-label="Zoom out" onClick={() => onViewport(zoomAt(v, 1 / 1.25, { x: size.width / 2, y: size.height / 2 }))}>
          <Minus size={15} />
        </button>
        <span className="zoom-label" data-testid="zoom-label">
          {Math.round(zoom * 100)}%
        </span>
        <button type="button" title="Zoom in" aria-label="Zoom in" onClick={() => onViewport(zoomAt(v, 1.25, { x: size.width / 2, y: size.height / 2 }))}>
          <Plus size={15} />
        </button>
        <span className="sep" />
        <button type="button" title="Fit room · F" aria-label="Fit room" onClick={() => (onFit ? onFit() : onViewport(fitRoom(roomBounds, size.width, size.height)))}>
          <CornersOut size={15} />
        </button>
      </div>
    </>
  );
}
