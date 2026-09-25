import {
  boundsOf,
  checkProject,
  deserializeProject,
  fromUnit,
  measureProject,
  normalizeAngle,
  type ItemDefinition,
  type Project,
} from '@space-planner/core';
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { demoHall, newHall } from './logic/demo.js';
import { nextId } from './logic/ids.js';
import { REJECTION_MESSAGES } from './logic/messages.js';
import { reduce, startSession, visibleProject } from './logic/session.js';
import { findFreeSpot } from './logic/placement.js';
import { downloadProject, loadAutosave, saveAutosave } from './logic/storage.js';
import { toWorld, type Viewport } from './logic/viewport.js';
import { PlanCanvas } from './ui/PlanCanvas.js';
import { CatalogPanel, Inspector, IssuesPanel, MetricsPanel, NewHallForm } from './ui/Panels.js';

const SNAP_OPTIONS = [
  { label: 'بدون', ticks: 1 },
  { label: '١ سم', ticks: fromUnit(1, 'cm') },
  { label: '٥ سم', ticks: fromUnit(5, 'cm') },
  { label: '١٠ سم', ticks: fromUnit(10, 'cm') },
];

export function App() {
  const [session, dispatch] = useReducer(reduce, undefined, () => startSession(loadAutosave() ?? demoHall()));
  const [viewport, setViewport] = useState<Viewport | null>(null);
  const [snapStep, setSnapStep] = useState(fromUnit(5, 'cm'));
  const [notice, setNotice] = useState<string | null>(null);
  const [showNewHall, setShowNewHall] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const canvasBox = useRef<HTMLDivElement>(null);

  const project = session.history.project;
  const shown = useMemo(() => visibleProject(session), [session]);
  const issues = useMemo(() => checkProject(shown), [shown]);
  const metrics = useMemo(() => measureProject(shown), [shown]);

  useEffect(() => {
    if (!saveAutosave(project)) setNotice('المتصفح مش سامح بالحفظ التلقائي؛ احفظ الملف بنفسك.');
  }, [project]);

  useEffect(() => {
    if (session.rejection) setNotice(REJECTION_MESSAGES[session.rejection.code]);
  }, [session.rejection]);

  const load = useCallback((next: Project, message: string) => {
    dispatch({ type: 'load', project: next });
    setViewport(null);
    setNotice(message);
  }, []);

  const addItem = (definition: ItemDefinition) => {
    const taken = new Set([...Object.keys(project.items), ...Object.keys(project.catalog), project.id,
      ...project.space.doors.map((d) => d.id), ...project.space.obstacles.map((o) => o.id)]);
    const id = nextId(definition.id, taken);
    const room = boundsOf(project.space.boundary);
    let spot = { x: (room.minX + room.maxX) / 2, y: (room.minY + room.maxY) / 2 };
    const box = canvasBox.current;
    if (viewport && box) {
      const centre = toWorld(viewport, { x: box.clientWidth / 2, y: box.clientHeight / 2 });
      if (centre.x > room.minX && centre.x < room.maxX && centre.y > room.minY && centre.y < room.maxY) spot = centre;
    }
    const item = { id, definitionId: definition.id, rotation: 0, locked: false };
    const position = findFreeSpot(project, item, definition, spot, Math.max(snapStep, fromUnit(25, 'cm')));
    dispatch({ type: 'command', command: { type: 'item.add', item: { ...item, position } }, select: id });
  };

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) return;
      const ctrl = event.ctrlKey || event.metaKey;
      const key = event.key.toLowerCase();
      const selected = session.selectedId ? project.items[session.selectedId] : undefined;
      if (ctrl && key === 'z') {
        event.preventDefault();
        dispatch({ type: event.shiftKey ? 'redo' : 'undo' });
      } else if (ctrl && key === 'y') {
        event.preventDefault();
        dispatch({ type: 'redo' });
      } else if (key === 'escape') {
        dispatch(session.drag ? { type: 'drag-cancel' } : { type: 'select', id: null });
      } else if (selected && (key === 'delete' || key === 'backspace')) {
        event.preventDefault();
        dispatch({ type: 'command', command: { type: 'item.remove', id: selected.id }, select: null });
      } else if (selected && (key === 'r' || key === 'ق')) {
        const to = normalizeAngle(selected.rotation + (event.shiftKey ? 90_000 : -90_000));
        dispatch({ type: 'command', command: { type: 'item.rotate', id: selected.id, to } });
      } else if (selected && key.startsWith('arrow')) {
        event.preventDefault();
        const step = fromUnit(event.shiftKey ? 10 : 1, 'cm');
        const d = { arrowup: [0, step], arrowdown: [0, -step], arrowleft: [-step, 0], arrowright: [step, 0] }[key];
        if (d) dispatch({ type: 'command', command: { type: 'item.move', id: selected.id, to: { x: selected.position.x + d[0]!, y: selected.position.y + d[1]! } } });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [session.selectedId, session.drag, project]);

  const openFile = async (file: File) => {
    const result = deserializeProject(await file.text());
    if (result.ok) load(result.project, `اتفتح «${result.project.name}».`);
    else setNotice(`الملف ده مش مخطط سليم (${result.problems.length} مشكلة). أول مشكلة: ${result.problems[0]?.path ?? ''}`);
  };

  return (
    <div className="app">
      <header className="toolbar">
        <h1>{project.name}</h1>
        <div className="toolbar-group">
          <button type="button" onClick={() => setShowNewHall(true)}>قاعة جديدة</button>
          <button type="button" onClick={() => load(demoHall(), 'اتفتحت القاعة التجريبية.')}>القاعة التجريبية</button>
          <button type="button" onClick={() => fileInput.current?.click()}>افتح ملف</button>
          <button type="button" onClick={() => { downloadProject(project); setNotice('اتحفظ الملف في التنزيلات.'); }}>احفظ ملف</button>
          <input ref={fileInput} type="file" accept=".json,application/json" hidden data-testid="file-input"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) void openFile(f); e.target.value = ''; }} />
        </div>
        <div className="toolbar-group">
          <button type="button" onClick={() => dispatch({ type: 'undo' })} disabled={session.history.undoStack.length === 0} title="Ctrl+Z">رجوع</button>
          <button type="button" onClick={() => dispatch({ type: 'redo' })} disabled={session.history.redoStack.length === 0} title="Ctrl+Y">إعادة</button>
          <button type="button" onClick={() => setViewport(null)}>اعرض القاعة كلها</button>
          <label className="field compact">
            <span>المغناطيس</span>
            <select value={snapStep} onChange={(e) => setSnapStep(Number(e.target.value))}>
              {SNAP_OPTIONS.map((o) => <option key={o.ticks} value={o.ticks}>{o.label}</option>)}
            </select>
          </label>
        </div>
        <p className="notice" role="status">{notice}</p>
      </header>
      <aside className="sidebar start">
        <CatalogPanel catalog={project.catalog} onAdd={addItem} />
        <Inspector project={project} selectedId={session.selectedId} dispatch={dispatch} />
      </aside>
      <main className="canvas" ref={canvasBox}>
        <PlanCanvas project={shown} issues={issues} selectedId={session.selectedId} snapStep={snapStep}
          viewport={viewport} onViewport={setViewport} dispatch={dispatch} />
        <p className="hint">اسحب العناصر بالماوس · العجلة للتكبير · اسحب الأرضية للتحريك · R للّف · Delete للمسح</p>
      </main>
      <aside className="sidebar end">
        <IssuesPanel project={shown} issues={issues} dispatch={dispatch} />
        <MetricsPanel metrics={metrics} />
      </aside>
      {showNewHall && (
        <NewHallForm
          onCancel={() => setShowNewHall(false)}
          onCreate={(w, d, h) => { setShowNewHall(false); load(newHall(w, d, h), 'اتعملت قاعة جديدة.'); }}
        />
      )}
    </div>
  );
}
