import { fromUnit, toUnit, type Id, type Issue, type Project } from '@space-planner/core';
import { Lock, Warning, XCircle } from '@phosphor-icons/react';
import { CONTROL_LIMITS, DEFAULT_CONTROLS, sanitizeControls, type ControlSettings } from '../logic/controls.js';
import { formatCount } from '../logic/format.js';
import type { Action } from '../logic/session.js';
import { NumberField, Segmented, SwitchRow } from './Fields.js';

const cm = (v: number) => fromUnit(v, 'cm');
export const GRID_OPTIONS: ReadonlyArray<{ ticks: number; label: string }> = [
  { ticks: 1, label: 'Off' },
  { ticks: cm(1), label: '1 cm' },
  { ticks: cm(5), label: '5 cm' },
  { ticks: cm(10), label: '10 cm' },
  { ticks: cm(25), label: '25 cm' },
];

const SHORTCUTS: ReadonlyArray<readonly [string, string]> = [
  ['Move selection', '← ↑ → ↓'],
  ['Big step · fine step', 'Shift · Alt'],
  ['Raise or lower', 'Page Up / Down'],
  ['Rotate 90°', 'R · Shift R'],
  ['Rotate by the step', '[  ]'],
  ['Select all', 'Ctrl A'],
  ['Duplicate', 'Ctrl D'],
  ['Copy · cut · paste', 'Ctrl C · X · V'],
  ['Undo · redo', 'Ctrl Z · Ctrl Y'],
  ['Lock or unlock', 'L'],
  ['Fit room', 'F'],
  ['Clear selection', 'Esc'],
  ['Remove', 'Delete'],
  ['Pan the plan', 'Space + drag'],
  ['Move straight · slowly · freely', 'Shift · Alt · Ctrl + drag'],
  ['Raise in 3D', 'Shift + drag'],
];

/** Precision and speed of the mouse and keyboard; kept in this browser. */
export function ControlsPanel({ controls, onChange }: { controls: ControlSettings; onChange: (c: ControlSettings) => void }) {
  const set = (key: keyof ControlSettings) => (value: number | undefined) => value !== undefined && onChange(sanitizeControls({ ...controls, [key]: value }));
  const cmField = (key: 'grid' | 'step' | 'bigStep' | 'fineStep' | 'raiseStep', label: string) => (
    <NumberField
      variant="stack"
      name={`control-${key}`}
      label={label}
      unit="cm"
      value={toUnit(controls[key], 'cm')}
      min={toUnit(CONTROL_LIMITS[key][0], 'cm')}
      max={toUnit(CONTROL_LIMITS[key][1], 'cm')}
      onChange={(v) => v !== undefined && set(key)(fromUnit(v, 'cm'))}
    />
  );
  const known = GRID_OPTIONS.some((o) => o.ticks === controls.grid);
  return (
    <div className="panel-scroll panel-pad" aria-label="Precision">
      <div className="section-title">
        <span className="kicker">Grid</span>
      </div>
      <Segmented
        label="Grid"
        options={[...GRID_OPTIONS.map((o) => ({ id: o.ticks, label: o.label })), ...(known ? [] : [{ id: controls.grid, label: `${toUnit(controls.grid, 'cm')} cm` }])]}
        value={controls.grid}
        onChange={(ticks) => onChange({ ...controls, grid: ticks })}
      />
      <div style={{ marginTop: 14 }}>
        <SwitchRow name="control-guides" label="Smart guides" hint="Snap to edges and centres of nearby items and walls" on={controls.guides} onChange={(guides) => onChange({ ...controls, guides })} />
        <SwitchRow
          name="control-accelerate"
          label="Speed up while held"
          hint="Arrow keys move faster the longer you hold"
          on={controls.keyAcceleration > 0}
          onChange={(on) => onChange({ ...controls, keyAcceleration: on ? DEFAULT_CONTROLS.keyAcceleration || 1 : 0 })}
        />
      </div>

      <div className="section-title" style={{ marginTop: 22 }}>
        <span className="kicker">Mouse</span>
      </div>
      <div className="grid-2">
        {cmField('grid', 'Grid step')}
        <NumberField variant="stack" name="control-angleStep" label="Rotate step" unit="°" value={controls.angleStep / 1000} min={0.1} max={90} onChange={(v) => v !== undefined && set('angleStep')(v * 1000)} />
        <NumberField variant="stack" name="control-dragSpeed" label="Drag speed" unit="×" value={controls.dragSpeed} min={0.1} max={3} onChange={set('dragSpeed')} />
        <NumberField variant="stack" name="control-fineDragSpeed" label="Alt drag speed" unit="×" value={controls.fineDragSpeed} min={0.02} max={1} onChange={set('fineDragSpeed')} />
      </div>

      <div className="section-title" style={{ marginTop: 22 }}>
        <span className="kicker">Keyboard movement</span>
      </div>
      <div className="grid-2">
        {cmField('step', 'Arrow step')}
        {cmField('bigStep', 'Shift + arrow')}
        {cmField('fineStep', 'Alt + arrow')}
        {cmField('raiseStep', 'Page Up / Down')}
        <NumberField variant="stack" name="control-fineAngle" label="Alt + [ ]" unit="°" value={controls.fineAngle / 1000} min={0.01} max={45} onChange={(v) => v !== undefined && set('fineAngle')(v * 1000)} />
        <NumberField variant="stack" name="control-keyAcceleration" label="Hold speed-up" unit="×" value={controls.keyAcceleration} min={0} max={5} onChange={set('keyAcceleration')} />
      </div>
      <button type="button" className="link-btn" style={{ marginTop: 14 }} onClick={() => onChange(DEFAULT_CONTROLS)}>
        Reset to defaults
      </button>

      <div className="section-title" style={{ marginTop: 22 }}>
        <span className="kicker">Shortcuts</span>
      </div>
      {SHORTCUTS.map(([label, key]) => (
        <div className="shortcut-row" key={label}>
          <span>{label}</span>
          <span className="kbd">{key}</span>
        </div>
      ))}
    </div>
  );
}

/** Every placed item, grouped by type; click selects (Shift adds), and a whole type can be selected at once. */
export function ObjectsPanel({ project, issues, selectedIds, dispatch }: { project: Project; issues: readonly Issue[]; selectedIds: readonly Id[]; dispatch: (a: Action) => void }) {
  const severity = new Map<Id, 'error' | 'warning'>();
  for (const issue of issues) {
    const first = issue.entityIds[0];
    if (!first || issue.severity === 'info') continue;
    if (issue.severity === 'error' || !severity.has(first)) severity.set(first, issue.severity);
  }
  const groups = new Map<string, Id[]>();
  for (const item of Object.values(project.items).sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))) {
    const list = groups.get(item.definitionId) ?? [];
    list.push(item.id);
    groups.set(item.definitionId, list);
  }
  const ordered = [...groups].sort(([a], [b]) => {
    const na = project.catalog[a]?.name ?? a;
    const nb = project.catalog[b]?.name ?? b;
    return na < nb ? -1 : na > nb ? 1 : 0;
  });
  const selected = new Set(selectedIds);
  const count = Object.keys(project.items).length;
  return (
    <>
      <div className="panel-pad muted" style={{ paddingBottom: 10 }}>
        {count === 0 ? 'Nothing placed yet. Add items from the library.' : `${formatCount(count)} ${count === 1 ? 'item' : 'items'} · ${formatCount(groups.size)} ${groups.size === 1 ? 'type' : 'types'}`}
      </div>
      <div className="panel-scroll" style={{ padding: '0 12px 16px' }} aria-label="Objects">
        {ordered.map(([definitionId, ids]) => (
          <div key={definitionId}>
            <div className="obj-group-head">
              <span className="kicker">
                {project.catalog[definitionId]?.name ?? definitionId} · {ids.length}
              </span>
              <button type="button" className="link-btn" style={{ fontSize: 11.5 }} onClick={() => dispatch({ type: 'select', ids })}>
                Select all
              </button>
            </div>
            {ids.map((id) => {
              const item = project.items[id]!;
              const sev = severity.get(id);
              return (
                <button
                  key={id}
                  type="button"
                  className={`obj-row${selected.has(id) ? ' selected' : ''}`}
                  data-object={id}
                  onClick={(e) => dispatch({ type: 'select', ids: [id], mode: e.shiftKey || e.ctrlKey || e.metaKey ? 'toggle' : 'replace' })}
                >
                  <span className="obj-id">{id}</span>
                  <span className="obj-name">{project.catalog[item.definitionId]?.name ?? item.definitionId}</span>
                  {sev === 'error' && <XCircle size={13} color="var(--error)" aria-label="Error" />}
                  {sev === 'warning' && <Warning size={13} color="var(--warning)" aria-label="Warning" />}
                  {item.locked && <Lock size={13} color="var(--ink-3)" aria-label="Locked" />}
                </button>
              );
            })}
          </div>
        ))}
      </div>
    </>
  );
}
