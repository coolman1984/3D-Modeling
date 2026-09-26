import {
  apply,
  boundsOf,
  checkProject,
  fromUnit,
  measureProject,
  serializeProject,
  type Command,
  type Id,
  type ItemDefinition,
  type ItemInstance,
  type Issue,
  type Project,
  type Vec2,
} from '@space-planner/core';
import { bayEntry, checkPack, productionFlowPath, serviceRoute, warehouseRoute, type BayEntryResult } from '@space-planner/starter';
import {
  ArrowsOutCardinal,
  ArrowUUpLeft,
  ArrowUUpRight,
  CaretLeft,
  Car,
  CheckCircle,
  Columns,
  Copy,
  Crosshair,
  CrosshairSimple,
  Cube,
  Cursor,
  DotsThree,
  DownloadSimple,
  Eye,
  Factory,
  FileText,
  ForkKnife,
  FrameCorners,
  GearSix,
  GridFour,
  Keyboard,
  LineSegments,
  ListBullets,
  Package,
  Magnet,
  MapTrifold,
  Ruler,
  SidebarSimple,
  Sparkle,
  Square,
  SquaresFour,
  Trash,
  Warning,
  Warehouse,
  WifiSlash,
  XCircle,
} from '@phosphor-icons/react';
import { useCallback, useDeferredValue, useEffect, useMemo, useReducer, useRef, useState, type ReactNode } from 'react';
import { actorName, api, subscribe } from '../api.js';
import { loadActivity, saveActivity, type Activity } from '../logic/activity.js';
import { acceleratedStep, arrowSteps, copyOffset, keyIntent, loadControls, ownsKeys, saveControls, turnNudge, type ControlSettings } from '../logic/controls.js';
import { formatCount, formatMetres } from '../logic/format.js';
import { nextId } from '../logic/ids.js';
import { REJECTION_MESSAGES } from '../logic/messages.js';
import { findFreeSpot } from '../logic/placement.js';
import { reduce, startSession, visibleProject, type Action } from '../logic/session.js';
import {
  duplicateCommands,
  elevateCommands,
  lockCommands,
  moveCommands,
  pasteCommands,
  removeCommands,
  rotateCommands,
  takenIds,
  toBatch,
} from '../logic/transform.js';
import { panBy, toWorld, type Viewport } from '../logic/viewport.js';
import { AgentPanel } from '../ui/AgentPanel.js';
import { Brand, Menu, Segmented, useToast } from '../ui/Fields.js';
import { HistoryPanel } from '../ui/HistoryPanel.js';
import { PropertiesPanel, ReviewPanel, statusLine, summarize } from '../ui/Inspector.js';
import { ItemTypeDialog, LibraryPanel } from '../ui/ItemTypes.js';
import { ControlsPanel, GRID_OPTIONS, ObjectsPanel } from '../ui/Panels.js';
import { PlanCanvas } from '../ui/PlanCanvas.js';
import { RoomPanel } from '../ui/RoomPanel.js';
import { View3D, type SceneLook } from '../ui/View3D.js';
import type { StockView } from '../ui/Stock.js';
import { colorsOf, ContainerViewTools, hex, hiddenAfter, LoadPanel, type ColorBy } from '../ui/Container.js';
import { WarehousePanel } from '../ui/Warehouse.js';
import { ProductionPanel } from '../ui/Production.js';
import { DepotPanel } from '../ui/Depot.js';
import { RestaurantPanel } from '../ui/Restaurant.js';

type ViewMode = 'plan' | '3d' | 'split';
type LeftPanel = 'load' | 'warehouse' | 'production' | 'depot' | 'restaurant' | 'library' | 'objects' | 'space' | 'precision';
type RightTab = 'properties' | 'review' | 'history';

const LOAD_PANEL: { id: LeftPanel; label: string; title: string; icon: ReactNode } = { id: 'load', label: 'Load', title: 'Loading plan', icon: <Package size={21} /> };
const WAREHOUSE_PANEL: { id: LeftPanel; label: string; title: string; icon: ReactNode } = { id: 'warehouse', label: 'Storage', title: 'Warehouse plan', icon: <Warehouse size={21} /> };
const PRODUCTION_PANEL: { id: LeftPanel; label: string; title: string; icon: ReactNode } = { id: 'production', label: 'Flow', title: 'Production line', icon: <Factory size={21} /> };
const DEPOT_PANEL: { id: LeftPanel; label: string; title: string; icon: ReactNode } = { id: 'depot', label: 'Bays', title: 'Vehicle depot', icon: <Car size={21} /> };
const SITE_PANEL: { id: LeftPanel; label: string; title: string; icon: ReactNode } = { id: 'depot', label: 'Site', title: 'Site plan', icon: <MapTrifold size={21} /> };
const RESTAURANT_PANEL: { id: LeftPanel; label: string; title: string; icon: ReactNode } = { id: 'restaurant', label: 'Covers', title: 'Restaurant', icon: <ForkKnife size={21} /> };
const LEFT_PANELS: ReadonlyArray<{ id: LeftPanel; label: string; title: string; icon: ReactNode }> = [
  { id: 'library', label: 'Library', title: 'Object library', icon: <SquaresFour size={21} /> },
  { id: 'objects', label: 'Objects', title: 'Objects', icon: <ListBullets size={21} /> },
  { id: 'space', label: 'Space', title: 'Space', icon: <FrameCorners size={21} /> },
  { id: 'precision', label: 'Precision', title: 'Precision', icon: <CrosshairSimple size={21} /> },
];

function download(name: string, text: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Loads a project from the server, then hands it to the editor. */
export function EditorPage({ projectId }: { projectId: string }) {
  const [project, setProject] = useState<Project | null>(null);
  const [missing, setMissing] = useState(false);
  useEffect(() => {
    setProject(null);
    api
      .getProject(projectId)
      .then(setProject)
      .catch(() => setMissing(true));
  }, [projectId]);
  if (missing) {
    return (
      <div className="site">
        <div className="center-empty">
          <div className="serif">This project does not exist</div>
          <p>It may have been deleted.</p>
          <a href="#/" className="btn">
            Back to projects
          </a>
        </div>
      </div>
    );
  }
  if (!project) {
    return (
      <div className="editor" style={{ alignItems: 'center', justifyContent: 'center', color: 'var(--ink-4)', gap: 10 }}>
        <span style={{ width: 180, height: 2, background: 'var(--line-mid)', overflow: 'hidden', borderRadius: 1 }}>
          <span style={{ display: 'block', width: '40%', height: '100%', background: 'var(--accent)', animation: 'atr-pulse 1s infinite' }} />
        </span>
        Loading plan
      </div>
    );
  }
  return <Editor key={project.id} initial={project} />;
}

function Editor({ initial }: { initial: Project }) {
  const [session, dispatch] = useReducer(reduce, initial, startSession);
  const [viewport, setViewport] = useState<Viewport | null>(null);
  const [controls, setControlsState] = useState<ControlSettings>(loadControls);
  const setControls = useCallback((next: ControlSettings) => {
    setControlsState(next);
    saveControls(next);
  }, []);
  const [toast, setNotice] = useToast();
  const cargo = loadActivity(initial).pack === 'container';
  // A container is easiest to read in 3D next to its floor plan.
  const [view, setView] = useState<ViewMode>(cargo ? 'split' : 'plan');
  const [left, setLeft] = useState<LeftPanel | null>(cargo ? 'load' : loadActivity(initial).pack === 'warehouse' ? 'warehouse' : loadActivity(initial).pack === 'production' ? 'production' : loadActivity(initial).pack === 'depot' || loadActivity(initial).pack === 'site' ? 'depot' : loadActivity(initial).pack === 'restaurant' ? 'restaurant' : 'library');
  const [routeEndpoints, setRouteEndpoints] = useState<{ dockId: string; rackId: string } | null>(null);
  const [stockView, setStockView] = useState<StockView>({ colorBy: 'material', find: null, slot: null });
  const [depotBayId, setDepotBayId] = useState<string | null>(null);
  const [tableRouteEndpoints, setTableRouteEndpoints] = useState<{ doorId: string; tableId: string } | null>(null);
  const [colorBy, setColorBy] = useState<ColorBy>('type');
  const [cutaway, setCutaway] = useState(true);
  const [playStep, setPlayStep] = useState<number | null>(null);
  const [right, setRight] = useState<RightTab>('properties');
  const [aiOpen, setAiOpen] = useState(false);
  const [aiRunning, setAiRunning] = useState(false);
  const [editingType, setEditingType] = useState<Id | 'new' | null>(null);
  const [fitToken, setFitToken] = useState(0);
  const [focus, setFocus] = useState<number | null>(null);
  const [offline, setOffline] = useState(false);
  const [retry, setRetry] = useState(0);
  const [preview, setPreview] = useState<{ revision: number; project: Project } | null>(null);
  const [scale, setScale] = useState({ zoom: 1, ratio: 100 });
  const lastGrid = useRef(controls.grid > 1 ? controls.grid : fromUnit(5, 'cm'));
  const sending = useRef(false);
  const canvasBox = useRef<HTMLDivElement>(null);

  const project = session.history.project;
  const shown = useMemo(() => visibleProject(session), [session]);
  // Checks can lag a frame behind a drag, so moving stays smooth in large halls.
  const checked = useDeferredValue(shown);
  const issues = useMemo(() => checkProject(checked), [checked]);
  const metrics = useMemo(() => measureProject(checked), [checked]);
  const [activity, setActivity] = useState<Activity>(() => loadActivity(initial));
  const rules = useMemo(() => checkPack(checked, activity.pack, activity.style), [checked, activity]);
  const summary = useMemo(() => summarize(issues, rules), [issues, rules]);
  const previewIssues = useMemo(() => (preview ? checkProject(preview.project) : []), [preview]);

  const load = useCallback(
    (next: Project, message?: string) => {
      dispatch({ type: 'load', project: next });
      if (message) setNotice(message);
    },
    [setNotice],
  );

  // Save local edits to the server one at a time, in order. If someone else changed the
  // project meanwhile (an agent, another window), take the server's version.
  useEffect(() => {
    const entry = session.outbox[0];
    if (!entry || sending.current) return;
    sending.current = true;
    api
      .sendCommands(project.id, [entry.command], entry.revision - 1)
      .then((result) => {
        setOffline(false);
        if (result.ok) dispatch({ type: 'saved', revision: entry.revision });
        else if ('conflict' in result) load(result.project, 'The project was changed elsewhere; the latest version is loaded.');
        else if ('rejection' in result) void api.getProject(project.id).then((p) => load(p, REJECTION_MESSAGES[result.rejection.code]));
      })
      .catch(() => setOffline(true))
      .finally(() => {
        sending.current = false;
      });
  }, [session.outbox, project.id, load, retry]);

  // Live changes made by agents or other windows.
  const latest = useRef({ revision: project.revision, pending: session.outbox.length });
  latest.current = { revision: project.revision, pending: session.outbox.length };
  // A change from elsewhere that arrived while our own edits were still being saved: fetched
  // once they are saved, so it is never lost.
  const missed = useRef<{ revision: number; message: string } | null>(null);
  const fetchLatest = useCallback(
    (message: string) =>
      void api.getProject(project.id).then((p) => {
        if (p.revision > latest.current.revision && latest.current.pending === 0) load(p, message);
      }),
    [project.id, load],
  );
  useEffect(() => {
    const refreshRuns = () =>
      void api
        .runs(project.id)
        .then((runs) => setAiRunning(runs[0]?.status === 'running'))
        .catch(() => undefined);
    refreshRuns();
    return subscribe({
      project: (e) => {
        if (e.projectId !== project.id || e.revision <= latest.current.revision) return;
        const message = `${actorName(e.actor)}: ${e.summary}`;
        if (latest.current.pending > 0) missed.current = { revision: e.revision, message };
        else fetchLatest(message);
      },
      run: (e) => e.projectId === project.id && refreshRuns(),
      // Changes made before the live connection opened (or while it was down) are fetched now.
      open: () => {
        if (latest.current.pending === 0) fetchLatest('Updated with changes made elsewhere');
      },
    });
  }, [project.id, fetchLatest]);
  useEffect(() => {
    const waiting = missed.current;
    if (session.outbox.length > 0 || !waiting) return;
    missed.current = null;
    if (waiting.revision > project.revision) fetchLatest(waiting.message);
  }, [session.outbox.length, project.revision, fetchLatest]);

  useEffect(() => {
    if (session.rejection) setNotice(REJECTION_MESSAGES[session.rejection.code]);
  }, [session.rejection, setNotice]);

  const fit = useCallback(() => {
    setViewport(null);
    setFitToken((n) => n + 1);
  }, []);

  const addItem = (definition: ItemDefinition, at?: Vec2) => {
    const id = nextId(definition.id, takenIds(project));
    const room = boundsOf(project.space.boundary);
    let spot = at ?? { x: (room.minX + room.maxX) / 2, y: (room.minY + room.maxY) / 2 };
    const box = canvasBox.current;
    if (!at && viewport && box && view !== '3d') {
      const pane = box.querySelector('.pane') as HTMLElement | null;
      const width = pane?.clientWidth ?? box.clientWidth;
      const centre = toWorld(viewport, { x: width / 2, y: box.clientHeight / 2 });
      if (centre.x > room.minX && centre.x < room.maxX && centre.y > room.minY && centre.y < room.maxY) spot = centre;
    }
    const item = { id, definitionId: definition.id, rotation: 0, locked: false };
    const position = findFreeSpot(project, item, definition, spot, Math.max(controls.grid, fromUnit(25, 'cm')));
    dispatch({ type: 'command', command: { type: 'item.add', item: { ...item, position } }, select: [id] });
  };

  // Keyboard: a held arrow (or PageUp/PageDown) shows the move live and saves it as one step
  // when the key is released, so a long press is one line in the history, not fifty.
  // Arrow keys follow the 3D camera when the 3D view was the last one touched.
  const heading = useRef<0 | 1 | 2 | 3>(0);
  const lastPane = useRef<'plan' | '3d'>('plan');
  const nudge = useRef<{ dx: number; dy: number; dz: number; repeats: number } | null>(null);
  const clipboard = useRef<readonly ItemInstance[]>([]);
  const blocked = preview !== null || editingType !== null;
  useEffect(() => {
    const typing = (event: Event) => ownsKeys(event.target);
    const ids = session.selectedIds;
    const in3d = view === '3d' || (view === 'split' && lastPane.current === '3d');
    // One press moves a visible amount: a few pixels at the plan's zoom, or a share of the room in 3D.
    const box = boundsOf(project.space.boundary);
    const roomPerPixel = Math.max(box.maxX - box.minX, box.maxY - box.minY) / 800;
    const keys = { ...controls, ...arrowSteps(controls, !in3d && viewport ? 1 / viewport.scale : roomPerPixel) };
    const run = (command: Command | null, select?: readonly Id[]) => command && dispatch({ type: 'command', command, ...(select ? { select } : {}) });
    const endNudge = () => {
      if (!nudge.current) return;
      nudge.current = null;
      dispatch({ type: 'preview-commit' });
    };
    const onKey = (event: KeyboardEvent) => {
      if (typing(event) || blocked) return;
      const intent = keyIntent({ key: event.key, ctrl: event.ctrlKey || event.metaKey, shift: event.shiftKey, alt: event.altKey }, keys);
      if (!intent) return;
      if (intent.kind === 'nudge' && ids.length === 0) {
        // Nothing selected: the arrows move the view. The 3D view turns its own camera.
        if (in3d || !viewport) return;
        event.preventDefault();
        const px = event.shiftKey ? 240 : 60;
        setViewport(panBy(viewport, -Math.sign(intent.dx) * px, Math.sign(intent.dy) * px));
        return;
      }
      if (intent.kind === 'nudge' || intent.kind === 'raise') {
        if (ids.length === 0) return;
        event.preventDefault();
        if (session.preview && !nudge.current) return; // a mouse gesture is running
        const n = nudge.current ?? { dx: 0, dy: 0, dz: 0, repeats: 0 };
        const k = acceleratedStep(1, event.repeat ? n.repeats + 1 : 0, controls.keyAcceleration);
        const arrow = intent.kind === 'nudge' ? turnNudge(intent.dx, intent.dy, in3d ? heading.current : 0) : { dx: 0, dy: 0 };
        const next =
          intent.kind === 'nudge'
            ? { ...n, dx: n.dx + arrow.dx * k, dy: n.dy + arrow.dy * k, repeats: event.repeat ? n.repeats + 1 : 0 }
            : { ...n, dz: n.dz + intent.dz * k, repeats: event.repeat ? n.repeats + 1 : 0 };
        nudge.current = next;
        const move = moveCommands(project, ids, { x: next.dx, y: next.dy });
        const moved = move ? apply(project, move) : null;
        const raise = elevateCommands(moved?.ok ? moved.project : project, ids, next.dz);
        dispatch({ type: 'preview', command: toBatch([move, raise].filter((c): c is Command => c !== null)) });
        return;
      }
      // Leave the browser's own copy and paste alone when there is nothing of ours to copy.
      if ((intent.kind === 'copy' || intent.kind === 'cut') && ids.length === 0) return;
      if (intent.kind === 'paste' && clipboard.current.length === 0) return;
      event.preventDefault();
      endNudge();
      switch (intent.kind) {
        case 'undo':
        case 'redo':
          dispatch({ type: intent.kind });
          break;
        case 'escape':
          dispatch(session.preview ? { type: 'preview-cancel' } : { type: 'select', ids: [] });
          break;
        case 'select-all':
          dispatch({ type: 'select', ids: Object.keys(project.items) });
          break;
        case 'delete':
          run(removeCommands(project, ids), []);
          break;
        case 'rotate':
          run(rotateCommands(project, ids, intent.by));
          break;
        case 'lock':
          run(lockCommands(project, ids, !ids.every((id) => project.items[id]?.locked)));
          break;
        case 'duplicate': {
          const copy = duplicateCommands(project, ids, copyOffset(controls));
          run(copy.command, copy.ids);
          break;
        }
        case 'copy':
        case 'cut':
          clipboard.current = ids.map((id) => project.items[id]).filter((i): i is ItemInstance => i !== undefined);
          if (clipboard.current.length > 0) setNotice(`Copied ${clipboard.current.length} ${clipboard.current.length === 1 ? 'item' : 'items'}.`);
          if (intent.kind === 'cut') run(removeCommands(project, ids), []);
          break;
        case 'paste': {
          const pasted = pasteCommands(project, clipboard.current, copyOffset(controls));
          run(pasted.command, pasted.ids);
          // The next paste lands one more step away, like drawing apps.
          clipboard.current = clipboard.current.map((i) => ({ ...i, position: { x: i.position.x + copyOffset(controls).x, y: i.position.y + copyOffset(controls).y } }));
          break;
        }
        case 'frame':
          fit();
          break;
      }
    };
    const onKeyUp = (event: KeyboardEvent) => {
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'PageUp', 'PageDown'].includes(event.key)) endNudge();
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', endNudge);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', endNudge);
    };
  }, [session.selectedIds, session.preview, project, controls, view, blocked, fit, setNotice, viewport]);

  const [renaming, setRenaming] = useState(false);
  const saving = session.outbox.length > 0;
  const status = statusLine(summary);
  const openReview = () => {
    setAiOpen(false);
    setRight('review');
  };
  const focusIssue = (issue: Issue) => {
    setAiOpen(false);
    setRight('review');
    setFocus(issues.indexOf(issue));
  };
  const onZoom = useCallback((zoom: number, ratio: number) => setScale((s) => (s.zoom === zoom && s.ratio === ratio ? s : { zoom, ratio })), []);
  const room = boundsOf(project.space.boundary);
  const roomLine = `${formatMetres(room.maxX - room.minX)} × ${formatMetres(room.maxY - room.minY)} m${project.space.ceilingHeight === undefined ? ' · Ceiling not set' : ` · Ceiling ${formatMetres(project.space.ceilingHeight)} m`}`;
  const single = session.selectedIds.length === 1 ? project.items[session.selectedIds[0]!] : undefined;
  const gridLabel = controls.grid <= 1 ? 'off' : (GRID_OPTIONS.find((o) => o.ticks === controls.grid)?.label ?? `${controls.grid / 100} cm`);
  const roomBox = boundsOf(project.space.boundary);
  const arrowStep = arrowSteps(controls, view !== '3d' && viewport ? 1 / viewport.scale : Math.max(roomBox.maxX - roomBox.minX, roomBox.maxY - roomBox.minY) / 800).step;
  const formatLength = (ticks: number) => (ticks >= 10_000 ? `${formatCount(ticks / 10_000)} m` : ticks >= 100 ? `${formatCount(ticks / 100)} cm` : `${formatCount(ticks / 10)} mm`);
  const shownProject = preview ? preview.project : shown;
  const shownIssues = preview ? previewIssues : issues;
  const paneDispatch = useCallback((a: Action) => (preview ? undefined : dispatch(a)), [preview]);
  const isCargo = activity.pack === 'container';
  const isWarehouse = activity.pack === 'warehouse';
  const isProduction = activity.pack === 'production';
  const isSite = activity.pack === 'site';
  const isDepot = activity.pack === 'depot' || isSite;
  const isRestaurant = activity.pack === 'restaurant';
  const route = useMemo(() => isWarehouse && routeEndpoints ? warehouseRoute(shownProject, routeEndpoints.dockId, routeEndpoints.rackId) : null, [isWarehouse, shownProject, routeEndpoints]);
  const flowPath = useMemo(() => (isProduction ? productionFlowPath(shownProject) : []), [isProduction, shownProject]);
  const depotEntry: BayEntryResult | null = useMemo(() => (isDepot && depotBayId ? bayEntry(shownProject, depotBayId) : null), [isDepot, shownProject, depotBayId]);
  const tableRoute = useMemo(() => isRestaurant && tableRouteEndpoints ? serviceRoute(shownProject, tableRouteEndpoints.doorId, tableRouteEndpoints.tableId) : null, [isRestaurant, shownProject, tableRouteEndpoints]);
  const routePoints = route?.reachable ? route.points : flowPath.length > 0 ? flowPath : depotEntry && depotEntry.path.length > 0 ? depotEntry.path : tableRoute?.reachable ? tableRoute.points : undefined;
  const panels = isCargo ? [LOAD_PANEL, ...LEFT_PANELS] : isWarehouse ? [WAREHOUSE_PANEL, ...LEFT_PANELS] : isProduction ? [PRODUCTION_PANEL, ...LEFT_PANELS] : isDepot ? [isSite ? SITE_PANEL : DEPOT_PANEL, ...LEFT_PANELS] : isRestaurant ? [RESTAURANT_PANEL, ...LEFT_PANELS] : LEFT_PANELS;
  const leftPanel = panels.find((p) => p.id === left);
  const colors = useMemo(() => (isCargo ? colorsOf(shownProject, colorBy) : null), [isCargo, shownProject, colorBy]);
  const planFills = useMemo(() => (colors ? new Map([...colors.colors].map(([id, c]) => [id, hex(c)])) : undefined), [colors]);
  // The plan numbers pieces by loading step when colouring by step (top pieces are drawn last).
  const planLabels = useMemo(
    () => (isCargo && colorBy === 'step' ? new Map(Object.values(shownProject.items).filter((i) => typeof i.meta?.step === 'number').map((i) => [i.id, String(i.meta!.step)])) : undefined),
    [isCargo, colorBy, shownProject],
  );
  const look = useMemo<SceneLook | undefined>(
    () => (isCargo && colors ? { itemColors: colors.colors, hidden: hiddenAfter(shownProject, playStep), cutaway } : isWarehouse ? { ...(routePoints ? { routePoints } : {}), stock: stockView } : routePoints ? { routePoints } : undefined),
    [isCargo, isWarehouse, colors, shownProject, playStep, cutaway, routePoints, stockView],
  );
  const onSlot = useCallback((slot: string, rackId: string) => {
    setStockView((v) => ({ ...v, slot }));
    dispatch({ type: 'select', ids: [rackId] });
    setRight('properties');
  }, []);

  const toggleSnap = () => {
    if (controls.grid > 1) {
      lastGrid.current = controls.grid;
      setControls({ ...controls, grid: 1 });
    } else setControls({ ...controls, grid: lastGrid.current });
  };

  return (
    <div className="editor">
      <header className="topbar">
        <Brand />
        <nav className="crumbs" aria-label="Breadcrumbs">
          <a href="#/">
            <CaretLeft size={15} />
            Projects
          </a>
          <span className="crumb-sep" />
          {renaming ? (
            <form
              className="rename"
              onSubmit={(e) => {
                e.preventDefault();
                const name = String(new FormData(e.currentTarget).get('name') ?? '').trim();
                if (name && name !== project.name) dispatch({ type: 'command', command: { type: 'project.rename', name } });
                setRenaming(false);
              }}
            >
              <input className="input" name="name" aria-label="Project name" defaultValue={project.name} autoFocus onBlur={(e) => e.currentTarget.form?.requestSubmit()} />
            </form>
          ) : (
            <h1 className="project-name" onDoubleClick={() => setRenaming(true)} title="Double-click to rename">
              {project.name}
            </h1>
          )}
          <span className="save-state" data-testid="save-state" data-saving={saving}>
            <span className={`dot${saving ? ' pulse' : ''}`} style={{ background: offline ? 'var(--warning)' : saving ? 'var(--accent)' : 'var(--ok)' }} />
            {offline ? 'Offline · changes kept here' : saving ? 'Saving…' : `Saved · Revision ${project.revision}`}
          </span>
        </nav>
        <div className="icon-pair">
          <button type="button" className="btn ghost icon" onClick={() => dispatch({ type: 'undo' })} disabled={session.history.undoStack.length === 0} title="Undo · Ctrl Z" aria-label="Undo">
            <ArrowUUpLeft size={17} />
          </button>
          <button type="button" className="btn ghost icon" onClick={() => dispatch({ type: 'redo' })} disabled={session.history.redoStack.length === 0} title="Redo · Ctrl Y" aria-label="Redo">
            <ArrowUUpRight size={17} />
          </button>
        </div>
        <span className="spacer" />
        <Segmented
          label="View"
          className="view-switch"
          value={view}
          onChange={(id) => {
            setView(id);
            fit();
          }}
          options={[
            { id: 'plan', label: <><Square size={15} />Plan</> },
            { id: '3d', label: <><Cube size={15} />3D</> },
            { id: 'split', label: <><Columns size={15} />Split</> },
          ]}
        />
        <a className={`btn ghost${saving ? ' disabled' : ''}`} href={saving ? undefined : `#/p/${project.id}/report`} aria-disabled={saving} title="Printable report for the client">
          <FileText size={16} />
          <span className="hide-narrow">Client report</span>
        </a>
        <button type="button" className={`btn${aiOpen ? ' accent' : ''}`} aria-pressed={aiOpen} onClick={() => setAiOpen((o) => !o)}>
          <Sparkle size={15} />
          AI Planner
          {aiRunning && <span className="dot pulse" style={{ background: 'var(--accent)' }} />}
        </button>
        <Menu
          label="More actions"
          button={(open, toggle) => (
            <button type="button" className="btn ghost icon" title="More actions" aria-label="More actions" aria-expanded={open} onClick={toggle}>
              <DotsThree size={18} />
            </button>
          )}
        >
          {(close) => (
            <>
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  download(`${project.name}.json`, serializeProject(project));
                  close();
                }}
              >
                <DownloadSimple size={15} />
                Export project file
              </button>
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  close();
                  void api.duplicateProject(project.id).then((p) => (window.location.hash = `#/p/${p.id}`));
                }}
              >
                <Copy size={15} />
                Duplicate project
              </button>
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setLeft('precision');
                  close();
                }}
              >
                <Keyboard size={15} />
                Keyboard shortcuts
              </button>
              <a role="menuitem" href="#/settings" onClick={close}>
                <GearSix size={15} />
                Settings
              </a>
              <button
                type="button"
                role="menuitem"
                className="danger"
                onClick={() => {
                  close();
                  if (window.confirm(`Delete “${project.name}” and its whole history? This cannot be undone.`)) void api.deleteProject(project.id).then(() => (window.location.hash = '#/'));
                }}
              >
                <Trash size={15} />
                Delete project
              </button>
            </>
          )}
        </Menu>
      </header>

      {offline && (
        <div className="offline-bar" role="status">
          <WifiSlash size={15} />
          <span>
            <strong style={{ fontWeight: 600 }}>Connection lost.</strong> Your last {formatCount(session.outbox.length)} {session.outbox.length === 1 ? 'change is' : 'changes are'} kept here and will be saved when the server is back.
          </span>
          <span className="spacer" />
          <button type="button" className="btn" onClick={() => setRetry((n) => n + 1)}>
            Try again
          </button>
        </div>
      )}

      <div className="editor-body">
        <aside className={`rail${left ? ' joined' : ''}`} aria-label="Tools">
          {panels.map((p) => (
            <button key={p.id} type="button" className={`rail-btn${left === p.id ? ' active' : ''}`} aria-pressed={left === p.id} title={p.title} onClick={() => setLeft(left === p.id ? null : p.id)}>
              {p.icon}
              {p.label}
            </button>
          ))}
          <span className="spacer" />
          <a href="#/settings" className="rail-gear" title="Settings" aria-label="Settings">
            <GearSix size={18} />
          </a>
        </aside>

        {leftPanel && (
          <aside className="leftpanel" aria-label={leftPanel.title}>
            <div className="panel-head">
              <h2>{leftPanel.title}</h2>
              <button type="button" className="btn ghost icon" style={{ width: 28, height: 28 }} title="Collapse panel" aria-label="Collapse panel" onClick={() => setLeft(null)}>
                <SidebarSimple size={16} />
              </button>
            </div>
            {left === 'load' && isCargo && <LoadPanel project={project} dispatch={dispatch} />}
            {left === 'warehouse' && isWarehouse && <WarehousePanel project={project} route={route} onRoute={(dockId, rackId) => setRouteEndpoints({ dockId, rackId })} onAddRack={() => { const rack = project.catalog['warehouse-rack-6']; if (rack) addItem(rack); }} stockView={stockView} onStockView={setStockView} dispatch={dispatch} />}
            {left === 'production' && isProduction && <ProductionPanel project={project} dispatch={dispatch} />}
            {left === 'depot' && isDepot && <DepotPanel project={project} entry={depotEntry} onCheck={setDepotBayId} dispatch={dispatch} site={isSite} />}
            {left === 'restaurant' && isRestaurant && <RestaurantPanel project={project} route={tableRoute} onRoute={(doorId, tableId) => setTableRouteEndpoints({ doorId, tableId })} />}
            {left === 'library' && <LibraryPanel project={project} pack={activity.pack} onAdd={(d) => addItem(d)} dispatch={dispatch} onEdit={setEditingType} />}
            {left === 'objects' && <ObjectsPanel project={project} issues={issues} selectedIds={session.selectedIds} dispatch={dispatch} />}
            {left === 'space' && <RoomPanel project={project} dispatch={dispatch} />}
            {left === 'precision' && <ControlsPanel controls={controls} onChange={setControls} />}
          </aside>
        )}

        <main className={`workspace${view === 'split' ? ' split' : ''}`} ref={canvasBox}>
          {view !== '3d' && (
            <section className="pane" aria-label="Plan view" onPointerDownCapture={() => (lastPane.current = 'plan')}>
              <div className="pane-title">
                <div className="serif">Plan</div>
                <div className="sub" data-testid="room-size">
                  {roomLine}
                </div>
              </div>
              <PlanCanvas
                project={shownProject}
                saved={preview ? preview.project : project}
                issues={shownIssues}
                selectedIds={preview ? [] : session.selectedIds}
                controls={controls}
                viewport={viewport}
                onViewport={setViewport}
                dispatch={paneDispatch}
                readOnly={preview !== null}
                onDropType={(id, at) => {
                  const definition = project.catalog[id];
                  if (definition) addItem(definition, at);
                }}
                onFit={fit}
                onZoom={onZoom}
                openEnd={isCargo ? 'east' : undefined}
                itemFills={planFills}
                itemLabels={planLabels}
                route={routePoints}
              />
            </section>
          )}
          {view !== 'plan' && (
            <section className="pane" aria-label="3D pane" onPointerDownCapture={() => (lastPane.current = '3d')}>
              <View3D
                project={shownProject}
                saved={preview ? preview.project : project}
                issues={shownIssues}
                selectedIds={preview ? [] : session.selectedIds}
                controls={controls}
                dispatch={paneDispatch}
                fitToken={fitToken}
                onHeading={(q) => (heading.current = q)}
                look={look}
                onSlot={isWarehouse && !preview ? onSlot : undefined}
                fullWallsAtStart={isCargo}
                keyboardActive={() => view === '3d' || lastPane.current === '3d'}
              />
              {isCargo && colors && (
                <ContainerViewTools project={shownProject} colorBy={colorBy} onColorBy={setColorBy} cutaway={cutaway} onCutaway={setCutaway} step={playStep} onStep={setPlayStep} legend={colors.legend} />
              )}
            </section>
          )}
          {preview && (
            <div className="pane-banner dark" role="status" data-testid="preview-banner">
              <Eye size={14} />
              Previewing revision {preview.revision}
              <button
                type="button"
                className="btn light"
                onClick={() => {
                  const revision = preview.revision;
                  void api.restore(project.id, revision).then((r) => {
                    setPreview(null);
                    load(r.project, `Restored revision ${revision}`);
                  });
                }}
              >
                Restore revision
              </button>
              <button type="button" className="btn ghost" onClick={() => setPreview(null)}>
                Exit
              </button>
            </div>
          )}
          {!preview && aiRunning && (
            <div className="pane-banner ai" role="status">
              <span className="dot pulse" style={{ background: 'var(--accent)', width: 7, height: 7 }} />
              AI Planner is editing · changes appear as they are saved
            </div>
          )}
          <div className="toast" role="status" data-testid="notice" hidden={!toast}>
            <CheckCircle size={15} />
            {toast}
          </div>
        </main>

        <aside className={`inspector${aiOpen ? ' ai' : ''}`} aria-label="Inspector">
          {aiOpen ? (
            <AgentPanel project={project} pack={activity.pack} onClose={() => setAiOpen(false)} />
          ) : (
            <>
              <div className="insp-tabs" role="tablist">
                {(
                  [
                    ['properties', 'Properties'],
                    ['review', 'Review'],
                    ['history', 'History'],
                  ] as const
                ).map(([id, label]) => (
                  <button key={id} type="button" role="tab" aria-selected={right === id} className={right === id ? 'active' : ''} onClick={() => setRight(id)}>
                    {label}
                    {id === 'review' && summary.findings > 0 && (
                      <span className={`count-badge${summary.errors === 0 ? ' warning' : ''}`} data-testid="review-badge">
                        {summary.findings}
                      </span>
                    )}
                  </button>
                ))}
              </div>
              <div className="insp-scroll">
                {right === 'properties' && (
                  <PropertiesPanel
                    project={project}
                    selectedIds={session.selectedIds}
                    controls={controls}
                    issues={issues}
                    metrics={metrics}
                    activity={activity}
                    summary={summary}
                    dispatch={dispatch}
                    onEditType={setEditingType}
                    onOpenReview={openReview}
                    onShow3D={() => {
                      if (view === 'plan') {
                        setView('split');
                        fit();
                      }
                    }}
                    onFocusIssue={focusIssue}
                    {...(isWarehouse ? { stockView, onStockView: setStockView } : {})}
                  />
                )}
                {right === 'review' && (
                  <ReviewPanel
                    project={checked}
                    issues={issues}
                    rules={rules}
                    activity={activity}
                    summary={summary}
                    focus={focus}
                    onFocus={setFocus}
                    onActivity={(next) => {
                      setActivity(next);
                      saveActivity(project.id, next);
                    }}
                    dispatch={dispatch}
                  />
                )}
                {right === 'history' && (
                  <HistoryPanel
                    project={project}
                    busy={saving}
                    previewing={preview?.revision ?? null}
                    onPreview={(revision) => void api.revision(project.id, revision).then((p) => setPreview({ revision, project: p }))}
                    onRestored={(p, revision) => {
                      setPreview(null);
                      load(p, `Restored revision ${revision}`);
                    }}
                  />
                )}
              </div>
            </>
          )}
        </aside>
      </div>

      <footer className="statusbar" aria-label="Status">
        <span title="Drawing scale and zoom">
          <Ruler size={13} />
          1:{Math.round(scale.ratio)} · {Math.round(scale.zoom * 100)}%
        </span>
        <span>
          <GridFour size={13} />
          Grid {gridLabel}
        </span>
        <button type="button" className={controls.grid > 1 ? 'on' : ''} aria-pressed={controls.grid > 1} onClick={toggleSnap} data-testid="snap-toggle">
          <Magnet size={13} />
          Snap {controls.grid > 1 ? 'on' : 'off'}
        </button>
        <button type="button" className={controls.guides ? 'on' : ''} aria-pressed={controls.guides} onClick={() => setControls({ ...controls, guides: !controls.guides })}>
          <LineSegments size={13} />
          Guides {controls.guides ? 'on' : 'off'}
        </button>
        <span>
          <Cursor size={13} />
          {session.selectedIds.length ? `${formatCount(session.selectedIds.length)} selected` : 'Nothing selected'}
        </span>
        <span className="hide-narrow" data-testid="arrow-step" title={controls.autoStep ? 'Each arrow press moves a selected item this far; it follows the zoom (Precision panel to change)' : 'Each arrow press moves a selected item this far (set in the Precision panel)'}>
          <ArrowsOutCardinal size={13} />
          Arrow {formatLength(arrowStep)}
        </span>
        <span className="hide-narrow">
          <Crosshair size={13} />
          {single ? `X ${formatCount(single.position.x / 100)} · Y ${formatCount(single.position.y / 100)} cm` : 'X — · Y —'}
        </span>
        <span className="spacer" />
        <button type="button" className={`state ${status.tone}`} onClick={openReview} data-testid="status-validation">
          {status.tone === 'error' ? <XCircle size={13} /> : status.tone === 'warning' ? <Warning size={13} /> : <CheckCircle size={13} />}
          {status.text}
        </button>
      </footer>

      {editingType && <ItemTypeDialog key={editingType} pack={activity.pack} project={project} editing={editingType} onClose={() => setEditingType(null)} dispatch={dispatch} />}
    </div>
  );
}
