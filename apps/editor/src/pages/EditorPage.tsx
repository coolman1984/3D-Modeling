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
  type Project,
} from '@space-planner/core';
import { useCallback, useDeferredValue, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { actorName, api, subscribe } from '../api.js';
import { acceleratedStep, copyOffset, keyIntent, loadControls, saveControls, turnNudge, type ControlSettings } from '../logic/controls.js';
import { nextId } from '../logic/ids.js';
import { REJECTION_MESSAGES } from '../logic/messages.js';
import { findFreeSpot } from '../logic/placement.js';
import { reduce, startSession, visibleProject } from '../logic/session.js';
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
import { toWorld, type Viewport } from '../logic/viewport.js';
import { AgentPanel } from '../ui/AgentPanel.js';
import { Tabs } from '../ui/Fields.js';
import { HistoryPanel } from '../ui/HistoryPanel.js';
import { ItemTypesPanel } from '../ui/ItemTypes.js';
import { ControlsPanel, HallRulesPanel, IssuesPanel, MetricsPanel, SelectionPanel } from '../ui/Panels.js';
import { checkHall, type HallStyle } from '@space-planner/starter';
import { loadHallStyle, saveHallStyle } from '../logic/hallStyle.js';
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
type StartTab = 'items' | 'room' | 'controls';
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
  const [controls, setControlsState] = useState<ControlSettings>(loadControls);
  const setControls = useCallback((next: ControlSettings) => {
    setControlsState(next);
    saveControls(next);
  }, []);
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
  // Checks can lag a frame behind a drag, so moving stays smooth in large halls.
  const checked = useDeferredValue(shown);
  const issues = useMemo(() => checkProject(checked), [checked]);
  const metrics = useMemo(() => measureProject(checked), [checked]);
  const [hallStyle, setHallStyle] = useState<HallStyle>(() => loadHallStyle(initial.id));
  const rules = useMemo(() => checkHall(checked, hallStyle), [checked, hallStyle]);

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
  useEffect(
    () =>
      subscribe({
        project: (e) => {
          if (e.projectId !== project.id || e.revision <= latest.current.revision) return;
          const message = `${actorName(e.actor)}: ${e.summary}`;
          if (latest.current.pending > 0) missed.current = { revision: e.revision, message };
          else fetchLatest(message);
        },
      }),
    [project.id, fetchLatest],
  );
  useEffect(() => {
    const waiting = missed.current;
    if (session.outbox.length > 0 || !waiting) return;
    missed.current = null;
    if (waiting.revision > project.revision) fetchLatest(waiting.message);
  }, [session.outbox.length, project.revision, fetchLatest]);

  useEffect(() => {
    if (session.rejection) setNotice(REJECTION_MESSAGES[session.rejection.code]);
  }, [session.rejection]);

  const addItem = (definition: ItemDefinition) => {
    const id = nextId(definition.id, takenIds(project));
    const room = boundsOf(project.space.boundary);
    let spot = { x: (room.minX + room.maxX) / 2, y: (room.minY + room.maxY) / 2 };
    const box = canvasBox.current;
    if (viewport && box && view !== '3d') {
      const centre = toWorld(viewport, { x: box.clientWidth / 2, y: box.clientHeight / 2 });
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
  useEffect(() => {
    const typing = (event: Event) => event.target instanceof HTMLElement && ['INPUT', 'TEXTAREA', 'SELECT'].includes(event.target.tagName);
    const ids = session.selectedIds;
    const run = (command: Command | null, select?: readonly Id[]) => command && dispatch({ type: 'command', command, ...(select ? { select } : {}) });
    const endNudge = () => {
      if (!nudge.current) return;
      nudge.current = null;
      dispatch({ type: 'preview-commit' });
    };
    const onKey = (event: KeyboardEvent) => {
      if (typing(event)) return;
      const intent = keyIntent({ key: event.key, ctrl: event.ctrlKey || event.metaKey, shift: event.shiftKey, alt: event.altKey }, controls);
      if (!intent) return;
      if (intent.kind === 'nudge' || intent.kind === 'raise') {
        if (ids.length === 0) return;
        event.preventDefault();
        if (session.preview && !nudge.current) return; // a mouse gesture is running
        const n = nudge.current ?? { dx: 0, dy: 0, dz: 0, repeats: 0 };
        const k = acceleratedStep(1, event.repeat ? n.repeats + 1 : 0, controls.keyAcceleration);
        const in3d = view === '3d' || (view === 'split' && lastPane.current === '3d');
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
          if (clipboard.current.length > 0) setNotice(`اتنسخ ${clipboard.current.length} عنصر.`);
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
          setViewport(null);
          setFitToken((n) => n + 1);
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
  }, [session.selectedIds, session.preview, project, controls, view]);

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
            <select value={SNAP_OPTIONS.some((o) => o.ticks === controls.grid) ? controls.grid : 'other'} onChange={(e) => e.target.value !== 'other' && setControls({ ...controls, grid: Number(e.target.value) })}>
              {SNAP_OPTIONS.map((o) => (
                <option key={o.ticks} value={o.ticks}>
                  {o.label}
                </option>
              ))}
              {!SNAP_OPTIONS.some((o) => o.ticks === controls.grid) && <option value="other">مخصوص</option>}
            </select>
          </label>
          <button type="button" onClick={() => download(`${project.name}.json`, serializeProject(project))}>
            صدّر ملف
          </button>
          <a
            className={`button${saving ? ' disabled' : ''}`}
            href={saving ? undefined : `#/p/${project.id}/report`}
            aria-disabled={saving}
            title="تقرير للعميل جاهز للطباعة"
          >
            التقرير
          </a>
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
            { id: 'controls', label: 'الدقة والسرعة' },
          ]}
        />
        {startTab === 'items' && (
          <>
            <SelectionPanel project={project} selectedIds={session.selectedIds} controls={controls} dispatch={dispatch} onEditType={setEditingType} />
            <ItemTypesPanel project={project} onAdd={addItem} dispatch={dispatch} editing={editingType} setEditing={setEditingType} />
          </>
        )}
        {startTab === 'room' && <RoomPanel project={project} dispatch={dispatch} />}
        {startTab === 'controls' && (
          <>
            <ControlsPanel controls={controls} onChange={setControls} />
            <SelectionPanel project={project} selectedIds={session.selectedIds} controls={controls} dispatch={dispatch} onEditType={setEditingType} />
          </>
        )}
      </aside>
      <main className={`canvas view-${view}`} ref={canvasBox}>
        {view !== '3d' && (
          <div className="pane" onPointerDownCapture={() => (lastPane.current = 'plan')}>
            <PlanCanvas
              project={shown}
              saved={project}
              issues={issues}
              selectedIds={session.selectedIds}
              controls={controls}
              viewport={viewport}
              onViewport={setViewport}
              dispatch={dispatch}
            />
            <p className="hint">اسحب العناصر · اسحب الأرضية للاختيار بمربع · الزرار الأوسط أو اليمين أو المسطرة للتحريك · العجلة للتكبير · الأسهم للتحريك الدقيق</p>
          </div>
        )}
        {view !== 'plan' && (
          <div className="pane" onPointerDownCapture={() => (lastPane.current = '3d')}>
            <View3D
              project={shown}
              saved={project}
              issues={issues}
              selectedIds={session.selectedIds}
              controls={controls}
              dispatch={dispatch}
              fitToken={fitToken}
              onHeading={(q) => (heading.current = q)}
            />
            <p className="hint">اسحب العنصر يتحرك على الأرض · Shift + سحب يرفعه وينزّله · اسحب الفاضي عشان تلف حوالين القاعة · الزرار اليمين للتحريك</p>
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
            <HallRulesPanel
              project={checked}
              rules={rules}
              style={hallStyle}
              onStyle={(style) => {
                setHallStyle(style);
                saveHallStyle(project.id, style);
              }}
              dispatch={dispatch}
            />
            <MetricsPanel metrics={metrics} />
          </>
        )}
        {endTab === 'history' && <HistoryPanel project={project} busy={saving} onRestored={(p) => load(p, 'اترجعت النسخة.')} />}
        {endTab === 'agent' && <AgentPanel project={project} />}
      </aside>
    </div>
  );
}
