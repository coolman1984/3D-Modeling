import {
  apply,
  fromUnit,
  toUnit,
  type Command,
  type Id,
  type Issue,
  type Metrics,
  type Project,
} from '@space-planner/core';
import { useEffect, useState } from 'react';
import { CONTROL_LIMITS, copyOffset, DEFAULT_CONTROLS, sanitizeControls, type ControlSettings } from '../logic/controls.js';
import { formatArea, formatCount, formatDegrees, formatLength, formatPercent } from '../logic/format.js';
import { describeIssue, describeRule, ISSUE_TITLES, RULE_TITLES } from '../logic/messages.js';
import { packOf, PACKS, type RuleResult } from '@space-planner/starter';
import { activityOf, type Activity } from '../logic/activity.js';
import type { Action } from '../logic/session.js';
import {
  alignCommands,
  distributeCommands,
  duplicateCommands,
  elevateCommands,
  lockCommands,
  moveCommands,
  removeCommands,
  rotateCommands,
  setElevationCommands,
  setRotationCommands,
  toBatch,
  type AlignEdge,
} from '../logic/transform.js';
import { NumberField } from './Fields.js';

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

/** A number field in degrees that commits on Enter or when it loses focus. */
function DegreeField({ label, value, onCommit }: { label: string; value: number; onCommit: (millidegrees: number) => void }) {
  const shown = String(+(value / 1000).toFixed(3));
  const [text, setText] = useState(shown);
  useEffect(() => setText(shown), [shown]);
  const commit = () => {
    const n = Number(text.replace(',', '.'));
    if (text.trim() !== '' && Number.isFinite(n) && Math.abs(n) <= 3600) onCommit(Math.round(n * 1000));
    else setText(shown);
  };
  return (
    <label className="field">
      <span>{label}</span>
      <input inputMode="decimal" value={text} onChange={(e) => setText(e.target.value)} onBlur={commit} onKeyDown={(e) => e.key === 'Enter' && commit()} />
      <span className="muted">°</span>
    </label>
  );
}

/**
 * The selected items: exact place, height and angle for one item; move-by, align and
 * distribute for several. Every button is one command, so one step in the history.
 */
export function SelectionPanel({
  project,
  selectedIds,
  controls,
  dispatch,
  onEditType,
}: {
  project: Project;
  selectedIds: readonly Id[];
  controls: ControlSettings;
  dispatch: (a: Action) => void;
  onEditType: (id: Id) => void;
}) {
  const run = (command: Command | null, select?: readonly Id[]) => command && dispatch({ type: 'command', command, ...(select ? { select } : {}) });
  const items = selectedIds.map((id) => project.items[id]).filter((i) => i !== undefined);
  const [by, setBy] = useState({ x: 0, y: 0, z: 0 });
  if (items.length === 0) {
    return (
      <section className="panel" aria-label="العنصر المختار">
        <h2>العنصر المختار</h2>
        <p className="muted">اضغط على أي عنصر عشان تعدّله، أو اسحب على الأرضية عشان تختار كذا عنصر. Shift مع الضغط بيزوّد على الاختيار.</p>
      </section>
    );
  }
  const ids = items.map((i) => i.id);
  const allLocked = items.every((i) => i.locked);
  const anyMovable = items.some((i) => !i.locked);
  const offset = copyOffset(controls);
  const turnButtons = (
    <div className="row">
      <button type="button" onClick={() => run(rotateCommands(project, ids, -90_000))} title="R" disabled={!anyMovable}>
        لف ٩٠° ↻
      </button>
      <button type="button" onClick={() => run(rotateCommands(project, ids, 90_000))} title="Shift+R" disabled={!anyMovable}>
        ↺
      </button>
      <button type="button" onClick={() => run(rotateCommands(project, ids, -controls.angleStep))} title="]" disabled={!anyMovable}>
        {formatDegrees(controls.angleStep)} ↻
      </button>
      <button type="button" onClick={() => run(rotateCommands(project, ids, controls.angleStep))} title="[" disabled={!anyMovable}>
        {formatDegrees(controls.angleStep)} ↺
      </button>
    </div>
  );
  const common = (
    <div className="row">
      <button type="button" onClick={() => run(lockCommands(project, ids, !allLocked))} title="L">
        {allLocked ? 'افتح القفل' : 'اقفل مكانه'}
      </button>
      <button type="button" onClick={() => { const d = duplicateCommands(project, ids, offset); run(d.command, d.ids); }} title="Ctrl+D">
        كرّر
      </button>
      <button type="button" className="danger" onClick={() => run(removeCommands(project, ids), [])} disabled={!anyMovable} title="Delete">
        امسح
      </button>
    </div>
  );

  if (items.length === 1) {
    const item = items[0]!;
    const definition = project.catalog[item.definitionId];
    if (!definition) return null;
    return (
      <section className="panel" aria-label="العنصر المختار">
        <h2>{definition.name}</h2>
        <p className="muted">
          {item.id} · {formatLength(definition.size.w)} × {formatLength(definition.size.d)} · ارتفاع {formatLength(definition.size.h)}
        </p>
        <div className="fields">
          <CentimetreField label="من الغرب" value={item.position.x} onCommit={(x) => run(moveCommands(project, ids, { x: x - item.position.x, y: 0 }))} />
          <CentimetreField label="من الجنوب" value={item.position.y} onCommit={(y) => run(moveCommands(project, ids, { x: 0, y: y - item.position.y }))} />
          <CentimetreField label="فوق الأرض" value={item.elevation ?? 0} onCommit={(z) => run(setElevationCommands(project, ids, z))} />
          <DegreeField label="الاتجاه" value={item.rotation} onCommit={(a) => run(setRotationCommands(project, ids, a))} />
        </div>
        {turnButtons}
        {common}
        <div className="row">
          <button type="button" onClick={() => onEditType(definition.id)}>
            عدّل مقاسات الصنف
          </button>
        </div>
      </section>
    );
  }

  const align = (edge: AlignEdge) => run(alignCommands(project, ids, edge));
  return (
    <section className="panel" aria-label="العنصر المختار">
      <h2>
        {formatCount(items.length)} عناصر مختارة
      </h2>
      <p className="muted">{[...new Set(items.map((i) => project.catalog[i.definitionId]?.name ?? i.definitionId))].join('، ')}</p>
      <div className="fields">
        <CentimetreField label="حرّك شرق" value={by.x} onCommit={(x) => setBy((b) => ({ ...b, x }))} />
        <CentimetreField label="حرّك شمال" value={by.y} onCommit={(y) => setBy((b) => ({ ...b, y }))} />
        <CentimetreField label="ارفع" value={by.z} onCommit={(z) => setBy((b) => ({ ...b, z }))} />
      </div>
      <div className="row">
        <button
          type="button"
          disabled={!anyMovable}
          onClick={() => {
            const move = moveCommands(project, ids, { x: by.x, y: by.y });
            const raise = elevateCommands(move ? applyOr(project, move) : project, ids, by.z);
            run(toBatch([move, raise].filter((c): c is Command => c !== null)));
          }}
        >
          طبّق الحركة
        </button>
      </div>
      {turnButtons}
      <h3 className="subhead">رصّ</h3>
      <div className="row align" role="group" aria-label="رص">
        <button type="button" onClick={() => align('west')} title="على الحافة الغربية">⇤ غرب</button>
        <button type="button" onClick={() => align('centre-x')} title="على خط النص الطولي">↔ نص</button>
        <button type="button" onClick={() => align('east')} title="على الحافة الشرقية">شرق ⇥</button>
        <button type="button" onClick={() => align('north')} title="على الحافة الشمالية">⤒ شمال</button>
        <button type="button" onClick={() => align('centre-y')} title="على خط النص العرضي">↕ نص</button>
        <button type="button" onClick={() => align('south')} title="على الحافة الجنوبية">⤓ جنوب</button>
      </div>
      <div className="row">
        <button type="button" onClick={() => run(distributeCommands(project, ids, 'x'))} disabled={items.length < 3}>
          وزّع بالعرض
        </button>
        <button type="button" onClick={() => run(distributeCommands(project, ids, 'y'))} disabled={items.length < 3}>
          وزّع بالطول
        </button>
      </div>
      {common}
    </section>
  );
}

function applyOr(project: Project, command: Command): Project {
  const result = apply(project, command);
  return result.ok ? result.project : project;
}

/** Precision and speed of the mouse and keyboard; kept in this browser. */
export function ControlsPanel({ controls, onChange }: { controls: ControlSettings; onChange: (c: ControlSettings) => void }) {
  const set = (key: keyof ControlSettings) => (value: number | undefined) => value !== undefined && onChange(sanitizeControls({ ...controls, [key]: value }));
  const cmField = (key: 'grid' | 'step' | 'bigStep' | 'fineStep' | 'raiseStep', label: string) => (
    <NumberField name={`control-${key}`} label={label} unit="سم" value={toUnit(controls[key], 'cm')} min={toUnit(CONTROL_LIMITS[key][0], 'cm')} max={toUnit(CONTROL_LIMITS[key][1], 'cm')} onChange={(v) => v !== undefined && set(key)(fromUnit(v, 'cm'))} />
  );
  return (
    <section className="panel" aria-label="الدقة والسرعة">
      <h2>الدقة والسرعة</h2>
      <h3 className="subhead">الماوس</h3>
      <div className="fields">
        {cmField('grid', 'خطوة الشبكة')}
        <NumberField name="control-dragSpeed" label="سرعة السحب" unit="×" value={controls.dragSpeed} min={0.1} max={3} onChange={set('dragSpeed')} />
        <NumberField name="control-fineDragSpeed" label="سرعة Alt الدقيقة" unit="×" value={controls.fineDragSpeed} min={0.02} max={1} onChange={set('fineDragSpeed')} />
        <NumberField name="control-angleStep" label="تقريب اللف" unit="°" value={controls.angleStep / 1000} min={0.1} max={90} onChange={(v) => v !== undefined && set('angleStep')(v * 1000)} />
      </div>
      <label className="check">
        <input type="checkbox" name="control-guides" checked={controls.guides} onChange={(e) => onChange({ ...controls, guides: e.target.checked })} />
        خطوط الرص الذكية (تلزق في حواف العناصر والحيطان)
      </label>
      <h3 className="subhead">الكيبورد</h3>
      <div className="fields">
        {cmField('step', 'الأسهم')}
        {cmField('bigStep', 'Shift + الأسهم')}
        {cmField('fineStep', 'Alt + الأسهم')}
        {cmField('raiseStep', 'PageUp / PageDown')}
        <NumberField name="control-fineAngle" label="Alt + [ ]" unit="°" value={controls.fineAngle / 1000} min={0.01} max={45} onChange={(v) => v !== undefined && set('fineAngle')(v * 1000)} />
        <NumberField name="control-keyAcceleration" label="تسارع الضغط الطويل" unit="×" value={controls.keyAcceleration} min={0} max={5} onChange={set('keyAcceleration')} />
      </div>
      <div className="row">
        <button type="button" onClick={() => onChange(DEFAULT_CONTROLS)}>
          رجّع الإعدادات الأصلية
        </button>
      </div>
      <details className="shortcuts">
        <summary>الاختصارات</summary>
        <dl>
          <dt>سحب</dt><dd>حرّك (Shift: على خط واحد · Alt: ببطء ودقة · Ctrl: من غير مغناطيس)</dd>
          <dt>سحب على الأرضية</dt><dd>اختار بمربع (Shift يزوّد)</dd>
          <dt>زرار الماوس الأوسط أو اليمين أو مسطرة + سحب</dt><dd>حرّك المنظر</dd>
          <dt>الأسهم</dt><dd>حرّك خطوة (Shift كبيرة · Alt صغيرة)؛ الضغط الطويل بيسرّع</dd>
          <dt>PageUp / PageDown</dt><dd>ارفع ونزّل</dd>
          <dt>R / Shift+R</dt><dd>لف ربع لفة</dd>
          <dt>[ ]</dt><dd>لف بخطوة التقريب (Alt أدق)</dd>
          <dt>Ctrl+A · Ctrl+D · Ctrl+C · Ctrl+V · Ctrl+X</dt><dd>اختار الكل · كرّر · انسخ · الصق · قص</dd>
          <dt>L · Delete · Esc · F</dt><dd>قفل · مسح · إلغاء · اعرض القاعة كلها</dd>
          <dt>في المجسم</dt><dd>اسحب العنصر على الأرض · Shift + سحب يرفعه وينزّله</dd>
        </dl>
      </details>
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
              <button type="button" onClick={() => issue.entityIds[0] && project.items[issue.entityIds[0]] && dispatch({ type: 'select', ids: [issue.entityIds[0]] })}>
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

const RULE_BADGE = { pass: ['ok', 'تمام'], fail: ['warning', 'محتاج مراجعة'], unknown: ['info', 'مش معروف'] } as const;

/** The activity pack's rules for the chosen activity and style; clicking a failed rule selects what it names. */
export function RulesPanel({
  project,
  rules,
  activity,
  onActivity,
  dispatch,
}: {
  project: Project;
  rules: readonly RuleResult[];
  activity: Activity;
  onActivity: (activity: Activity) => void;
  dispatch: (a: Action) => void;
}) {
  const failed = rules.filter((r) => r.status === 'fail').length;
  const pack = packOf(activity.pack);
  return (
    <section className="panel" aria-label="قواعد النشاط">
      <h2>
        قواعد {pack.label}{' '}
        <span className={`badge ${failed ? 'warning' : 'ok'}`} data-testid="rules-count">
          {failed ? formatCount(failed) : 'تمام'}
        </span>
      </h2>
      <div className="fields">
        <label className="field">
          <span>النشاط</span>
          <select name="activity" value={activity.pack} onChange={(e) => onActivity(activityOf(e.target.value, null))}>
            {PACKS.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>النوع</span>
          <select name="activity-style" value={activity.style} onChange={(e) => onActivity(activityOf(activity.pack, e.target.value))}>
            {pack.styles.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </select>
        </label>
      </div>
      <ul className="issues rules">
        {rules.map((rule) => {
          const [className, word] = RULE_BADGE[rule.status];
          return (
            <li key={rule.code} className={className} data-rule={rule.code} data-status={rule.status}>
              <button type="button" onClick={() => rule.entityIds.length > 0 && dispatch({ type: 'select', ids: rule.entityIds })}>
                <strong>
                  {RULE_TITLES[rule.code]} · {word}
                </strong>
                <span>{describeRule(project, rule)}</span>
              </button>
            </li>
          );
        })}
      </ul>
      <p className="muted">إرشادات تخطيط شائعة، مش بديل عن اشتراطات الدفاع المدني.</p>
    </section>
  );
}
