import {
  fromUnit,
  normalizeAngle,
  toUnit,
  type Id,
  type Issue,
  type Metrics,
  type Project,
} from '@space-planner/core';
import { useEffect, useState } from 'react';
import { formatArea, formatCount, formatDegrees, formatLength, formatPercent } from '../logic/format.js';
import { describeIssue, ISSUE_TITLES } from '../logic/messages.js';
import type { Action } from '../logic/session.js';

/** A number field in centimetres that commits on Enter or when it loses focus. */
export function CentimetreField({ label, value, onCommit }: { label: string; value: number; onCommit: (ticks: number) => void }) {
  const shown = String(toUnit(value, 'cm'));
  const [text, setText] = useState(shown);
  useEffect(() => setText(shown), [shown]);
  const commit = () => {
    const n = Number(text.replace(',', '.'));
    if (text.trim() !== '' && Number.isFinite(n) && Math.abs(n) <= 100_000) onCommit(fromUnit(n, 'cm'));
    else setText(shown);
  };
  return (
    <label className="field">
      <span>{label}</span>
      <input
        inputMode="decimal"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => e.key === 'Enter' && commit()}
      />
      <span className="muted">سم</span>
    </label>
  );
}

export function Inspector({ project, selectedId, dispatch, onEditType }: { project: Project; selectedId: Id | null; dispatch: (a: Action) => void; onEditType: (id: Id) => void }) {
  const item = selectedId ? project.items[selectedId] : undefined;
  const definition = item ? project.catalog[item.definitionId] : undefined;
  if (!item || !definition) {
    return (
      <section className="panel" aria-label="العنصر المختار">
        <h2>العنصر المختار</h2>
        <p className="muted">اضغط على أي عنصر في المخطط عشان تعدّله.</p>
      </section>
    );
  }
  const rotateBy = (delta: number) => dispatch({ type: 'command', command: { type: 'item.rotate', id: item.id, to: normalizeAngle(item.rotation + delta) } });
  return (
    <section className="panel" aria-label="العنصر المختار">
      <h2>{definition.name}</h2>
      <p className="muted">
        {item.id} · {formatLength(definition.size.w)} × {formatLength(definition.size.d)} · ارتفاع {formatLength(definition.size.h)}
      </p>
      <div className="fields">
        <CentimetreField label="من الغرب" value={item.position.x} onCommit={(x) => dispatch({ type: 'command', command: { type: 'item.move', id: item.id, to: { x, y: item.position.y } } })} />
        <CentimetreField label="من الجنوب" value={item.position.y} onCommit={(y) => dispatch({ type: 'command', command: { type: 'item.move', id: item.id, to: { x: item.position.x, y } } })} />
      </div>
      <div className="row">
        <span>الاتجاه: {formatDegrees(item.rotation)}</span>
        <button type="button" onClick={() => rotateBy(-90_000)} title="لف مع عقارب الساعة (R)" disabled={item.locked}>
          لف ٩٠° ↻
        </button>
        <button type="button" onClick={() => rotateBy(90_000)} title="لف عكس عقارب الساعة (Shift+R)" disabled={item.locked}>
          ↺
        </button>
        <button type="button" onClick={() => rotateBy(-15_000)} disabled={item.locked}>
          ١٥° ↻
        </button>
      </div>
      <div className="row">
        <button type="button" onClick={() => dispatch({ type: 'command', command: { type: 'item.lock', id: item.id, locked: !item.locked } })}>
          {item.locked ? 'افتح القفل' : 'اقفل مكانه'}
        </button>
        <button type="button" className="danger" onClick={() => dispatch({ type: 'command', command: { type: 'item.remove', id: item.id }, select: null })} disabled={item.locked}>
          امسح
        </button>
        <button type="button" onClick={() => onEditType(definition.id)}>
          عدّل مقاسات الصنف
        </button>
      </div>
    </section>
  );
}

export function IssuesPanel({ project, issues, dispatch }: { project: Project; issues: readonly Issue[]; dispatch: (a: Action) => void }) {
  const errors = issues.filter((i) => i.severity === 'error').length;
  const warnings = issues.filter((i) => i.severity === 'warning').length;
  return (
    <section className="panel" aria-label="المشاكل">
      <h2>
        المشاكل{' '}
        <span className={`badge ${errors ? 'error' : warnings ? 'warning' : 'ok'}`} data-testid="issue-count">
          {issues.length === 0 ? 'مفيش' : formatCount(issues.length)}
        </span>
      </h2>
      {issues.length === 0 ? (
        <p className="muted">كله تمام: مفيش تداخل ولا باب مسدود ولا عنصر برّه الحدود.</p>
      ) : (
        <ul className="issues">
          {issues.map((issue, i) => (
            <li key={i} className={issue.severity} data-issue={issue.code}>
              <button type="button" onClick={() => issue.entityIds[0] && dispatch({ type: 'select', id: issue.entityIds[0] })}>
                <strong>{ISSUE_TITLES[issue.code]}</strong>
                <span>{describeIssue(project, issue)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function MetricsPanel({ metrics }: { metrics: Metrics }) {
  return (
    <section className="panel" aria-label="الأرقام">
      <h2>الأرقام</h2>
      <dl className="metrics">
        <div>
          <dt>الكراسي</dt>
          <dd data-testid="seats">{formatCount(metrics.seats)}</dd>
        </div>
        <div>
          <dt>العناصر</dt>
          <dd>{formatCount(metrics.itemCount)}</dd>
        </div>
        <div>
          <dt>مساحة الأرض</dt>
          <dd>{formatArea(metrics.floorArea)}</dd>
        </div>
        <div>
          <dt>المشغول</dt>
          <dd>
            {formatArea(metrics.occupiedArea)} ({formatPercent(metrics.occupancy)})
          </dd>
        </div>
      </dl>
      {metrics.bom.length > 0 && (
        <table className="bom">
          <thead>
            <tr>
              <th>الصنف</th>
              <th>العدد</th>
            </tr>
          </thead>
          <tbody>
            {metrics.bom.map((line) => (
              <tr key={line.definitionId}>
                <td>{line.name}</td>
                <td>{formatCount(line.count)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
