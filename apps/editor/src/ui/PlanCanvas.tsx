import { homeFill, homeSymbol } from './PlanSymbols.js';
import { PlanWalls, RoomAreas } from './PlanWalls.js';
import {
  add,
  area,
  boundsOf,
  doorPolygon,
  footprintOf,
  itemClearancePolygon,
  itemPolygon,
  rectangle,
  rotate,
  toSquareMetres,
  type Aabb,
  type Id,
  type Issue,
  type Project,
  type Vec2,
} from '@space-planner/core';
import { useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react';
import { CornersOut, Cursor, Door, FrameCorners, Minus, Plus, Wall as WallIcon } from '@phosphor-icons/react';
import type { ControlSettings } from '../logic/controls.js';
import { formatCentimetres, formatCount, formatDegrees, formatLength, formatMetres, formatSquareMetres } from '../logic/format.js';
import type { Action } from '../logic/session.js';
import { snapAngle, snapMove, type Guide } from '../logic/snap.js';
import { boxCentre, itemsInBox, movable, moveCommands, rotateCommands, selectionBounds } from '../logic/transform.js';
import { fitViewport, panBy, pathOf, toScreen, toWorld, zoomAt, type Viewport } from '../logic/viewport.js';
import { zoneStyle } from '../logic/zoneStyle.js';
import { addOpening, addWall, alongWall, MIN_WALL, moveWall, moveWallEnd, pointAtLength, snapWallPoint, typedLength, typedLengthGuessed, updateOpening, wallAt, type Snap } from '../logic/walls.js';

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
  /** Temporary movement route drawn over the plan; never saved. */
  readonly route?: readonly Vec2[] | undefined;
  /** What a click on the plan does: pick and move (default), draw walls, or put a door or window in a wall. */
  readonly tool?: PlanTool;
  readonly onTool?: (tool: PlanTool) => void;
}

export type PlanTool = 'select' | 'wall' | 'door' | 'window';


type Gesture =
  | { kind: 'press'; id: Id; start: Vec2; pointerId: number; toggled: boolean }
  | { kind: 'move'; ids: readonly Id[]; last: Vec2; raw: Vec2; pointerId: number }
  | { kind: 'rotate'; ids: readonly Id[]; pivot: Vec2; lastAngle: number; raw: number; pointerId: number }
  | { kind: 'marquee'; start: Vec2; pointerId: number; additive: boolean }
  | { kind: 'pan'; last: Vec2; moved: boolean; pointerId: number }
  | { kind: 'wall'; id: Id; start: Vec2; pointerId: number; moved: boolean; toggled: boolean }
  | { kind: 'wall-end'; id: Id; end: 'a' | 'b'; pointerId: number }
  | { kind: 'opening'; id: Id; grab: number; start: Vec2; pointerId: number; moved: boolean };

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
export function PlanCanvas({ project, saved, issues, selectedIds, controls, viewport, onViewport, dispatch, readOnly = false, onDropType, onFit, onZoom, openEnd, itemFills, itemLabels, route, tool = 'select', onTool }: Props) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const gesture = useRef<Gesture | null>(null);
  const [overlay, setOverlay] = useState<Overlay>({});
  const spaceHeld = useRef(false);
  const roomBounds = useMemo(() => boundsOf(project.space.boundary), [project.space.boundary]);
  // Drawing walls: the chain's last point and first point, the snapped cursor, and a typed length.
  const [chain, setChain] = useState<{ from: Vec2; start: Vec2 } | null>(null);
  const [cursor, setCursor] = useState<(Snap & { screen: Vec2 }) | null>(null);
  const [typed, setTyped] = useState('');

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

  // Leaving a tool drops whatever it was drawing.
  useEffect(() => {
    if (tool === 'select') {
      setChain(null);
      setCursor(null);
      setTyped('');
    }
    // The ghost of what the tool would draw goes with it.
    return () => dispatch({ type: 'preview', command: null });
  }, [tool, dispatch]);

  // While drawing: type a length and press Enter; Backspace corrects it; Esc ends the chain, a
  // second Esc puts the tool down. W and D pick the wall and door tools from the plan.
  useEffect(() => {
    if (readOnly) return;
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT' || target.isContentEditable)) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (tool === 'select') {
        const k = e.key.toLowerCase();
        if ((k === 'w' || k === 'ص') && onTool) onTool('wall');
        else if ((k === 'd' || k === 'ي') && onTool && (project.space.walls?.length ?? 0) > 0) onTool('door');
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        dispatch({ type: 'preview', command: null });
        if (chain) {
          setChain(null);
          setTyped('');
        } else onTool?.('select');
        return;
      }
      if (tool !== 'wall' || !chain) return;
      if (/^[0-9٠-٩.,٫mcمس]$/i.test(e.key)) {
        e.preventDefault();
        setTyped((t) => (t + e.key).slice(0, 10));
      } else if (e.key === 'Backspace') {
        e.preventDefault();
        setTyped((t) => t.slice(0, -1));
      } else if (e.key === 'Enter') {
        e.preventDefault();
        const length = typedLength(typed);
        if (length === undefined) {
          // Enter with nothing typed ends the chain, like a double-click.
          if (!typed) {
            dispatch({ type: 'preview', command: null });
            setChain(null);
          }
          return;
        }
        const toward = cursor && (cursor.point.x !== chain.from.x || cursor.point.y !== chain.from.y) ? cursor.point : { x: chain.from.x + 1, y: chain.from.y };
        placeWallEnd(pointAtLength(chain.from, toward, length));
        setTyped('');
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  if (!viewport) return <svg ref={svgRef} className="plan" aria-label="Plan" />;
  const walled = (project.space.walls?.length ?? 0) > 0;
  const v = viewport;
  const reach = 14 / v.scale; // 14 px, in ticks
  const gridStep = controls.grid > 1 ? controls.grid : 1;

  /** Draw the wall from the chain's last point to `end`, then go on from there (or close the loop). */
  function placeWallEnd(end: Vec2) {
    if (!chain) return;
    dispatch({ type: 'preview', command: null });
    const added = addWall(saved, chain.from, end);
    if (!added) return;
    dispatch({ type: 'command', command: added.command });
    const closed = end.x === chain.start.x && end.y === chain.start.y;
    setChain(closed ? null : { from: end, start: chain.start });
  }

  const local = (event: ReactPointerEvent): Vec2 => {
    const rect = svgRef.current!.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  };
  const capture = (event: ReactPointerEvent) => svgRef.current?.setPointerCapture(event.pointerId);
  const wantsPan = (event: ReactPointerEvent) => event.button === 1 || event.button === 2 || spaceHeld.current;

  const onItemDown = (event: ReactPointerEvent, id: Id) => {
    if (wantsPan(event) || readOnly || tool !== 'select') return; // let the background start a pan or the tool act
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

  const onWallDown = (event: ReactPointerEvent, id: Id) => {
    if (wantsPan(event) || readOnly || tool !== 'select' || event.button !== 0) return;
    event.stopPropagation();
    const additive = event.shiftKey || event.ctrlKey || event.metaKey;
    if (additive) dispatch({ type: 'select', ids: [id], mode: 'toggle' });
    else if (!selectedIds.includes(id)) dispatch({ type: 'select', ids: [id] });
    gesture.current = { kind: 'wall', id, start: toWorld(v, local(event)), pointerId: event.pointerId, moved: false, toggled: additive };
    capture(event);
  };

  const onWallEndDown = (event: ReactPointerEvent, id: Id, end: 'a' | 'b') => {
    if (event.button !== 0 || readOnly) return;
    event.stopPropagation();
    gesture.current = { kind: 'wall-end', id, end, pointerId: event.pointerId };
    capture(event);
  };

  const onOpeningDown = (event: ReactPointerEvent, id: Id) => {
    if (wantsPan(event) || readOnly || tool !== 'select' || event.button !== 0) return;
    event.stopPropagation();
    dispatch({ type: 'select', ids: [id] });
    const opening = saved.space.openings?.find((o) => o.id === id);
    const wall = opening && saved.space.walls?.find((w) => w.id === opening.wall);
    if (!opening || !wall) return;
    const world = toWorld(v, local(event));
    gesture.current = { kind: 'opening', id, grab: alongWall(wall, world).along - opening.offset, start: local(event), pointerId: event.pointerId, moved: false };
    capture(event);
  };

  /** A click with a drawing tool: a wall point, or a door or window in the wall under the pointer. */
  const onToolDown = (event: ReactPointerEvent) => {
    const world = toWorld(v, local(event));
    if (tool === 'wall') {
      const snap = snapWallPoint(saved, world, reach, event.ctrlKey || event.metaKey ? 1 : gridStep, chain?.from);
      if (!chain) setChain({ from: snap.point, start: snap.point });
      else if (Math.hypot(snap.point.x - chain.from.x, snap.point.y - chain.from.y) >= MIN_WALL) placeWallEnd(snap.point);
      setTyped('');
      return;
    }
    const wall = wallAt(saved, world, reach);
    if (!wall) return;
    dispatch({ type: 'preview', command: null });
    const added = addOpening(saved, wall.id, tool === 'door' ? 'door' : 'window', world);
    if (added) {
      dispatch({ type: 'command', command: added.command, select: [added.id] });
      onTool?.('select');
    }
  };

  /** What the drawing tool would do here, shown before the click. */
  const onToolHover = (event: ReactPointerEvent) => {
    const screen = local(event);
    const world = toWorld(v, screen);
    if (tool === 'wall') {
      const snap = snapWallPoint(saved, world, reach, event.ctrlKey || event.metaKey ? 1 : gridStep, chain?.from);
      setCursor({ ...snap, screen });
      const added = chain ? addWall(saved, chain.from, typedLength(typed) !== undefined ? pointAtLength(chain.from, snap.point, typedLength(typed)!) : snap.point) : undefined;
      dispatch({ type: 'preview', command: added?.command ?? null });
      return;
    }
    const wall = wallAt(saved, world, reach);
    const added = wall && addOpening(saved, wall.id, tool === 'door' ? 'door' : 'window', world);
    dispatch({ type: 'preview', command: added?.command ?? null });
    setCursor(null);
  };

  const onBackgroundDown = (event: ReactPointerEvent) => {
    if (tool !== 'select' && !readOnly && event.button === 0 && !spaceHeld.current) {
      onToolDown(event);
      return;
    }
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
    if (!g && tool !== 'select' && !readOnly) {
      onToolHover(event);
      return;
    }
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
    } else if (g.kind === 'wall') {
      const world = toWorld(v, point);
      const startScreen = toScreen(v, g.start);
      if (!g.moved && Math.hypot(point.x - startScreen.x, point.y - startScreen.y) < DRAG_THRESHOLD) return;
      gesture.current = { ...g, moved: true };
      const raw = { x: world.x - g.start.x, y: world.y - g.start.y };
      const lock = event.shiftKey ? (Math.abs(raw.x) >= Math.abs(raw.y) ? 'y' : 'x') : null;
      const step = event.ctrlKey || event.metaKey ? 1 : gridStep;
      const delta = { x: lock === 'x' ? 0 : Math.round(raw.x / step) * step, y: lock === 'y' ? 0 : Math.round(raw.y / step) * step };
      dispatch({ type: 'preview', command: moveWall(saved, g.id, delta) ?? null });
      setOverlay({ readout: { at: point, text: `${formatLength(delta.x)}, ${formatLength(delta.y)}` } });
    } else if (g.kind === 'wall-end') {
      const wall = saved.space.walls?.find((w) => w.id === g.id);
      if (!wall) return;
      const other = g.end === 'a' ? wall.b : wall.a;
      const snap = snapWallPoint(saved, toWorld(v, point), reach, event.ctrlKey || event.metaKey ? 1 : gridStep, other);
      dispatch({ type: 'preview', command: moveWallEnd(saved, g.id, g.end, snap.point) ?? null });
      setOverlay({ readout: { at: point, text: `${formatMetres(Math.round(Math.hypot(snap.point.x - other.x, snap.point.y - other.y)))} m` } });
    } else if (g.kind === 'opening') {
      if (!g.moved && Math.hypot(point.x - g.start.x, point.y - g.start.y) < DRAG_THRESHOLD) return;
      gesture.current = { ...g, moved: true };
      const opening = saved.space.openings?.find((o) => o.id === g.id);
      const wall = opening && saved.space.walls?.find((w) => w.id === opening.wall);
      if (!opening || !wall) return;
      const step = event.ctrlKey || event.metaKey ? 1 : gridStep;
      const offset = Math.round((alongWall(wall, toWorld(v, point)).along - g.grab) / step) * step;
      const command = updateOpening(saved, g.id, { offset });
      dispatch({ type: 'preview', command: command ?? null });
      const shown = command && command.type === 'space.set' ? command.space.openings?.find((o) => o.id === g.id)?.offset : undefined;
      setOverlay({ readout: { at: point, text: `${formatMetres(shown ?? opening.offset)} m from the start` } });
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
    if (g.kind === 'move' || g.kind === 'rotate' || g.kind === 'wall-end' || (g.kind === 'wall' && g.moved) || (g.kind === 'opening' && g.moved)) {
      dispatch({ type: cancelled ? 'preview-cancel' : 'preview-commit' });
    } else if (g.kind === 'wall') {
      if (!g.toggled && selectedIds.length > 1) dispatch({ type: 'select', ids: [g.id] });
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
  // Drawn bottom up: floor coverings (rugs) first, then what stands on the floor, then what hangs higher.
  const layer = (item: (typeof project.items)[string]) => (project.catalog[item.definitionId]?.surface ? -1 : (item.elevation ?? 0));
  const items = Object.values(project.items).sort((a, b) => layer(a) - layer(b));
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
        className={`plan${readOnly ? ' preview' : ''}${tool !== 'select' ? ` tool-${tool}` : ''}`}
        onDoubleClick={() => {
          if (tool === 'wall' && chain) {
            dispatch({ type: 'preview', command: null });
            setChain(null);
            setTyped('');
          }
        }}
        onPointerLeave={() => {
          if (tool === 'select' || gesture.current) return;
          setCursor(null);
          dispatch({ type: 'preview', command: null });
        }}
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
        {!walled && <path d={pathOf(v, project.space.boundary)} className="wall" style={{ strokeWidth: wall * 2 }} />}
        <path d={pathOf(v, project.space.boundary)} className={`floor${walled ? ' walled' : ''}`} />
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
        <path d={minorGrid} className="grid-minor" />
        <path d={majorGrid} className="grid" />
        {(project.space.zones ?? []).map((zone) => {
          const b = boundsOf(zone.polygon);
          const p = toScreen(v, { x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2 });
          const style = zoneStyle(zone.kind);
          if (style.room) return null; // rooms are named after the furniture, on top (below)
          return <g key={zone.id} data-zone={zone.id} pointerEvents="none" className="warehouse-zone">
            <path d={pathOf(v, zone.polygon)} fill={style.fill} fillOpacity={style.opacity} stroke={style.stroke} strokeWidth={1} strokeDasharray={style.dash} />
            {style.label && Math.min(b.maxX - b.minX, b.maxY - b.minY) * v.scale > 14 && <text x={p.x} y={p.y} textAnchor="middle" dominantBaseline="middle" fill="var(--ink-2)" fontSize={`calc(10px * var(--ts, 1))`}>{zone.kind.replace(/-/g, ' ')}</text>}
          </g>;
        })}
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
        <PlanWalls v={v} project={project} selected={selected} onWallDown={onWallDown} onOpeningDown={onOpeningDown} />
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
          const symbol = homeSymbol(definition);
          const fill = itemFills?.get(item.id) ?? (symbol ? homeFill(definition) : undefined);
          return (
            <g key={item.id} data-item-id={item.id} className={classes.join(' ').replace(/\s+/g, ' ').trim()} onPointerDown={(e) => onItemDown(e, item.id)} style={fill ? ({ '--fill': fill } as CSSProperties) : undefined}>
              <path d={pathOf(v, body)} className="item-body" />
              {symbol ? (
                // The symbol is drawn in the item's frame: front up at rotation 0, turned like the item.
                <g transform={`translate(${centre.x.toFixed(1)},${centre.y.toFixed(1)}) rotate(${(-item.rotation / 1000).toFixed(2)}) scale(${v.scale})`} className="item-symbol" pointerEvents="none">
                  {symbol}
                </g>
              ) : (
                <line x1={front[0]!.x} y1={front[0]!.y} x2={front[1]!.x} y2={front[1]!.y} className="item-front" />
              )}
              {showLabel && !symbol && (
                <text x={centre.x} y={centre.y} className="item-label">
                  {label}
                </text>
              )}
            </g>
          );
        })}
        {walled && <RoomAreas v={v} project={project} />}
        {(project.space.zones ?? []).map((zone) => {
          if (walled || !zoneStyle(zone.kind).room) return null;
          // A room: its name and floor area in the top-left corner, on a paper halo over any furniture.
          const b = boundsOf(zone.polygon);
          const corner = toScreen(v, { x: b.minX, y: b.maxY });
          const name = typeof zone.meta?.label === 'string' ? zone.meta.label : zone.kind;
          const fits = (b.maxX - b.minX) * v.scale > 70 && (b.maxY - b.minY) * v.scale > 30;
          return fits ? (
            <text key={zone.id} data-zone={zone.id} x={corner.x + 8} y={corner.y + 16} className="room-label" pointerEvents="none">
              {`${name.toUpperCase()} · ${formatSquareMetres(toSquareMetres(area(zone.polygon)))}`}
            </text>
          ) : null;
        })}
        {route && route.length > 0 && (
          <g data-testid="warehouse-route" pointerEvents="none">
            <polyline points={route.map((p) => { const s = toScreen(v, p); return `${s.x},${s.y}`; }).join(' ')} fill="none" stroke="var(--accent)" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" />
            {[route[0]!, route[route.length - 1]!].map((p, i) => { const s = toScreen(v, p); return <circle key={i} cx={s.x} cy={s.y} r={5} fill={i ? 'var(--accent)' : 'white'} stroke="var(--accent)" strokeWidth={2} />; })}
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
        {tool === 'select' && !readOnly && selectedIds.length === 1 && (() => {
          const wall = project.space.walls?.find((w) => w.id === selectedIds[0]);
          if (!wall) return null;
          // Both ends of the chosen wall can be dragged; its length reads along it.
          const a = toScreen(v, wall.a);
          const b = toScreen(v, wall.b);
          const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
          const angle = (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI;
          const upright = angle > 90 || angle < -90 ? angle + 180 : angle;
          const text = `${formatMetres(Math.round(Math.hypot(wall.b.x - wall.a.x, wall.b.y - wall.a.y)))} m`;
          return (
            <g className="wall-handles">
              <g transform={`translate(${mid.x.toFixed(1)},${mid.y.toFixed(1)}) rotate(${upright.toFixed(2)})`} pointerEvents="none">
                <text className="wall-length" y={-(wall.thickness * v.scale) / 2 - 6} textAnchor="middle" data-testid="wall-length">
                  {text}
                </text>
              </g>
              {(['a', 'b'] as const).map((end) => {
                const at = end === 'a' ? a : b;
                return <circle key={end} cx={at.x} cy={at.y} r={6} className="wall-end" data-wall-end={end} onPointerDown={(e) => onWallEndDown(e, wall.id, end)} />;
              })}
            </g>
          );
        })()}
        {tool === 'wall' && cursor && (() => {
          const at = toScreen(v, cursor.point);
          const from = chain ? toScreen(v, chain.from) : null;
          const length = chain ? typedLength(typed) ?? Math.round(Math.hypot(cursor.point.x - chain.from.x, cursor.point.y - chain.from.y)) : undefined;
          const label = length === undefined ? '' : typed ? `${typed}▌ → ${formatMetres(length)} m${typedLengthGuessed(typed) ? ' · add m or cm to be sure' : ''}` : `${formatMetres(length)} m`;
          return (
            <g className="draw-cursor" pointerEvents="none">
              {from && <line x1={from.x} y1={from.y} x2={at.x} y2={at.y} className="draw-line" />}
              <circle cx={at.x} cy={at.y} r={cursor.to === 'end' ? 7 : 4.5} className={`draw-snap ${cursor.to}`} />
              {label && (
                <g className="readout" transform={`translate(${at.x + 14},${at.y + 22})`}>
                  <rect x={-6} y={-13} width={label.length * 6.4 + 12} height={19} rx={3} />
                  <text data-testid="draw-length">{label}</text>
                </g>
              )}
            </g>
          );
        })()}
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
      {!readOnly && onTool && (
        <div className="draw-tools" role="toolbar" aria-label="Draw">
          {([
            ['select', 'Select and move · Esc', <Cursor key="i" size={16} />],
            ['wall', 'Draw walls · W', <WallIcon key="i" size={16} />],
            ['door', 'Put a door in a wall · D', <Door key="i" size={16} />],
            ['window', 'Put a window in a wall', <FrameCorners key="i" size={16} />],
          ] as const).map(([id, label, icon]) => (
            <button key={id} type="button" title={label} aria-label={label} aria-pressed={tool === id} data-tool={id} disabled={id !== 'select' && id !== 'wall' && !walled} onClick={() => onTool(id)}>
              {icon}
            </button>
          ))}
        </div>
      )}
      {tool !== 'select' && (
            <span className="draw-hint" role="status">
              {tool === 'wall'
                ? chain
                  ? 'Click the next corner, or type a length (3.15 m or 315 cm) and press Enter · double-click or Esc to stop'
                  : 'Click where the wall starts · it snaps to wall ends and stays square'
                : `Click a wall to put a ${tool} in it · Esc to cancel`}
            </span>
      )}
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
