import {
  boundsOf,
  checkProject,
  fromUnit,
  measureProject,
  normalizeAngle,
  serializeProject,
  type Id,
  type ItemDefinition,
  type Project,
} from '@space-planner/core';
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { actorName, api, subscribe } from '../api.js';
import { nextId } from '../logic/ids.js';
import { REJECTION_MESSAGES } from '../logic/messages.js';
import { findFreeSpot } from '../logic/placement.js';
import { reduce, startSession, visibleProject } from '../logic/session.js';
import { toWorld, type Viewport } from '../logic/viewport.js';
import { AgentPanel } from '../ui/AgentPanel.js';
import { Tabs } from '../ui/Fields.js';
import { HistoryPanel } from '../ui/HistoryPanel.js';
import { ItemTypesPanel } from '../ui/ItemTypes.js';
import { Inspector, IssuesPanel, MetricsPanel } from '../ui/Panels.js';
import { PlanCanvas } from '../ui/PlanCanvas.js';
import { RoomPanel } from '../ui/RoomPanel.js';
import { View3D } from '../ui/View3D.js';

const SNAP_OPTIONS = [
  { label: 'بدون', ticks: 1 },
  { label: '١ سم', ticks: fromUnit(1, 'cm') },
  { label: '٥ سم', ticks: fromUnit(5, 'cm') },
  { label: '١٠ سم', ticks: fromUnit(10, 'cm') },
];

type ViewMode = 'plan' | '3d' | 'split';
type StartTab = 'items' | 'room';
type EndTab = 'check' | 'history' | 'agent';

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
      <div className="page">
        <p>المشروع ده مش موجود.</p>
        <a href="#/" className="button">رجوع للمشاريع</a>
      </div>
    );
  }
  return project ? <Editor key={project.id} initial={project} /> : <div className="page"><p className="muted">بيحمّل…</p></div>;
}

function Editor({ initial }: { initial: Project }) {
  const [session, dispatch] = useReducer(reduce, initial, startSession);
  const [viewport, setViewport] = useState<Viewport | null>(null);
  const [snapStep, setSnapStep] = useState(fromUnit(5, 'cm'));
  const [notice, setNotice] = useState<string | null>(null);
  const [view, setView] = useState<ViewMode>('plan');
  const [startTab, setStartTab] = useState<StartTab>('items');
  const [endTab, setEndTab] = useState<EndTab>('check');
  const [editingType, setEditingType] = useState<Id | 'new' | null>(null);
  const [fitToken, setFitToken] = useState(0);
  const sending = useRef(false);
  const canvasBox = useRef<HTMLDivElement>(null);

  const project = session.history.project;
  const shown = useMemo(() => visibleProject(session), [session]);
  const issues = useMemo(() => checkProject(shown), [shown]);
  const metrics = useMemo(() => measureProject(shown), [shown]);

  const load = useCallback((next: Project, message?: string) => {
    dispatch({ type: 'load', project: next });
    if (message) setNotice(message);
  }, []);

  // Save local edits to the server one at a time, in order. If someone else changed the
  // project meanwhile (an agent, another window), take the server's version.
  useEffect(() => {
    const entry = session.outbox[0];
    if (!entry || sending.current) return;
    sending.current = true;
    api
      .sendCommands(project.id, [entry.command], entry.revision - 1)
      .then((result) => {
        if (result.ok) dispatch({ type: 'saved', revision: entry.revision });
        else if ('conflict' in result) load(result.project, 'المشروع اتعدّل من مكان تاني؛ اتحمّلت آخر نسخة.');
        else if ('rejection' in result) void api.getProject(project.id).then((p) => load(p, REJECTION_MESSAGES[result.rejection.code]));
      })
      .catch(() => setNotice('مقدرتش أحفظ التعديل؛ البرنامج شغّال؟'))
      .finally(() => {
        sending.current = false;
      });
  }, [session.outbox, project.id, load]);

  // Live changes made by agents or other windows.
  const latest = useRef({ revision: project.revision, pending: session.outbox.length });
  latest.current = { revision: project.revision, pending: session.outbox.length };
  useEffect(
    () =>
      subscribe({
        project: (e) => {
          if (e.projectId !== project.id || e.revision <= latest.current.revision || latest.current.pending > 0) return;
          void api.getProject(project.id).then((p) => {
            if (p.revision > latest.current.revision) load(p, `${actorName(e.actor)}: ${e.summary}`);
          });
        },
      }),
    [project.id, load],
  );

  useEffect(() => {
    if (session.rejection) setNotice(REJECTION_MESSAGES[session.rejection.code]);
  }, [session.rejection]);

  const addItem = (definition: ItemDefinition) => {
    const taken = new Set([
      ...Object.keys(project.items),
      ...Object.keys(project.catalog),
      project.id,
      ...project.space.doors.map((d) => d.id),
      ...project.space.obstacles.map((o) => o.id),
    ]);
    const id = nextId(definition.id, taken);
    const room = boundsOf(project.space.boundary);
    let spot = { x: (room.minX + room.maxX) / 2, y: (room.minY + room.maxY) / 2 };
    const box = canvasBox.current;
    if (viewport && box && view !== '3d') {
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

  const [renaming, setRenaming] = useState(false);
  const saving = session.outbox.length > 0;

  return (
    <div className="app">
      <header className="toolbar">
        <a href="#/" className="button" title="كل المشاريع">
          المشاريع
        </a>
        {renaming ? (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const name = String(new FormData(e.currentTarget).get('name') ?? '').trim();
              if (name && name !== project.name) dispatch({ type: 'command', command: { type: 'project.rename', name } });
              setRenaming(false);
            }}
          >
            <input name="name" defaultValue={project.name} autoFocus onBlur={(e) => e.currentTarget.form?.requestSubmit()} />
          </form>
        ) : (
          <h1 onDoubleClick={() => setRenaming(true)} title="دبل كليك لتغيير الاسم">
            {project.name}
          </h1>
        )}
        <span className={`save-state ${saving ? 'busy' : ''}`} data-testid="save-state">
          {saving ? 'بيحفظ…' : 'محفوظ'}
        </span>
        <div className="toolbar-group">
          <button type="button" onClick={() => dispatch({ type: 'undo' })} disabled={session.history.undoStack.length === 0} title="Ctrl+Z">
            رجوع
          </button>
          <button type="button" onClick={() => dispatch({ type: 'redo' })} disabled={session.history.redoStack.length === 0} title="Ctrl+Y">
            إعادة
          </button>
        </div>
        <div className="toolbar-group segmented" role="group" aria-label="طريقة العرض">
          {(
            [
              ['plan', 'مسطح'],
              ['3d', 'مجسم'],
              ['split', 'الاتنين'],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              className={view === id ? 'active' : ''}
              aria-pressed={view === id}
              onClick={() => {
                setView(id);
                setViewport(null);
                setFitToken((n) => n + 1);
              }}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="toolbar-group">
          <button
            type="button"
            onClick={() => {
              setViewport(null);
              setFitToken((n) => n + 1);
            }}
          >
            اعرض القاعة كلها
          </button>
          <label className="field compact">
            <span>المغناطيس</span>
            <select value={snapStep} onChange={(e) => setSnapStep(Number(e.target.value))}>
              {SNAP_OPTIONS.map((o) => (
                <option key={o.ticks} value={o.ticks}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
          <button type="button" onClick={() => download(`${project.name}.json`, serializeProject(project))}>
            صدّر ملف
          </button>
        </div>
        <p className="notice" role="status">
          {notice}
        </p>
      </header>
      <aside className="sidebar start">
        <Tabs
          value={startTab}
          onChange={setStartTab}
          tabs={[
            { id: 'items', label: 'العناصر' },
            { id: 'room', label: 'القاعة' },
          ]}
        />
        {startTab === 'items' ? (
          <>
            <ItemTypesPanel project={project} onAdd={addItem} dispatch={dispatch} editing={editingType} setEditing={setEditingType} />
            <Inspector project={project} selectedId={session.selectedId} dispatch={dispatch} onEditType={setEditingType} />
          </>
        ) : (
          <RoomPanel project={project} dispatch={dispatch} />
        )}
      </aside>
      <main className={`canvas view-${view}`} ref={canvasBox}>
        {view !== '3d' && (
          <div className="pane">
            <PlanCanvas
              project={shown}
              issues={issues}
              selectedId={session.selectedId}
              snapStep={snapStep}
              viewport={viewport}
              onViewport={setViewport}
              dispatch={dispatch}
            />
            <p className="hint">اسحب العناصر بالماوس · العجلة للتكبير · اسحب الأرضية للتحريك · R للّف · Delete للمسح</p>
          </div>
        )}
        {view !== 'plan' && (
          <div className="pane">
            <View3D project={shown} issues={issues} selectedId={session.selectedId} onSelect={(id) => dispatch({ type: 'select', id })} fitToken={fitToken} />
          </div>
        )}
      </main>
      <aside className="sidebar end">
        <Tabs
          value={endTab}
          onChange={setEndTab}
          tabs={[
            { id: 'check', label: 'المشاكل والأرقام' },
            { id: 'history', label: 'السجل' },
            { id: 'agent', label: 'الوكيل الذكي' },
          ]}
        />
        {endTab === 'check' && (
          <>
            <IssuesPanel project={shown} issues={issues} dispatch={dispatch} />
            <MetricsPanel metrics={metrics} />
          </>
        )}
        {endTab === 'history' && <HistoryPanel project={project} busy={saving} onRestored={(p) => load(p, 'اترجعت النسخة.')} />}
        {endTab === 'agent' && <AgentPanel project={project} />}
      </aside>
    </div>
  );
}
