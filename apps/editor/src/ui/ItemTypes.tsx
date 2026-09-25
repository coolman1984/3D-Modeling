import { fromUnit, toUnit, type Id, type ItemDefinition, type Project } from '@space-planner/core';
import { SHAPES, shapeOf } from '@space-planner/starter';
import { useState } from 'react';
import { formatLength } from '../logic/format.js';
import { nextId } from '../logic/ids.js';
import type { Action } from '../logic/session.js';
import { NumberField } from './Fields.js';

const cm = (v: number) => fromUnit(v, 'cm');

interface Draft {
  id: Id | null;
  name: string;
  category: string;
  w: number;
  d: number;
  h: number;
  front: number;
  back: number;
  left: number;
  right: number;
  seats: number;
}

function draftOf(definition: ItemDefinition): Draft {
  const c = (t: number) => toUnit(t, 'cm');
  return {
    id: definition.id,
    name: definition.name,
    category: shapeOf(definition.category) === 'box' && definition.category !== 'box' ? definition.category : shapeOf(definition.category),
    w: c(definition.size.w),
    d: c(definition.size.d),
    h: c(definition.size.h),
    front: c(definition.clearance.front),
    back: c(definition.clearance.back),
    left: c(definition.clearance.left),
    right: c(definition.clearance.right),
    seats: definition.seats ?? 0,
  };
}

const EMPTY: Draft = { id: null, name: '', category: 'box', w: 100, d: 60, h: 75, front: 0, back: 0, left: 0, right: 0, seats: 0 };

/** The project's item types: add a copy to the plan, or create and edit types with real sizes. */
export function ItemTypesPanel({
  project,
  onAdd,
  dispatch,
  editing,
  setEditing,
}: {
  project: Project;
  onAdd: (definition: ItemDefinition) => void;
  dispatch: (a: Action) => void;
  editing: Id | 'new' | null;
  setEditing: (id: Id | 'new' | null) => void;
}) {
  const definitions = Object.values(project.catalog);
  const current = editing === 'new' ? EMPTY : editing ? project.catalog[editing] : undefined;
  return (
    <section className="panel" aria-label="الأصناف">
      <h2>
        الأصناف
        <button type="button" className="small" onClick={() => setEditing('new')}>
          صنف جديد
        </button>
      </h2>
      {editing && current && (
        <ItemTypeForm
          key={editing}
          draft={'size' in current ? draftOf(current) : current}
          project={project}
          onCancel={() => setEditing(null)}
          onSave={(definition) => {
            dispatch({ type: 'command', command: { type: 'catalog.define', definition } });
            setEditing(null);
          }}
          onDelete={(id) => {
            dispatch({ type: 'command', command: { type: 'catalog.remove', id } });
            setEditing(null);
          }}
        />
      )}
      <ul className="catalog">
        {definitions.map((d) => (
          <li key={d.id}>
            <button type="button" onClick={() => onAdd(d)} data-add={d.id} title="أضف واحد للمخطط">
              <span className="catalog-name">{d.name}</span>
              <span className="muted">
                {formatLength(d.size.w)} × {formatLength(d.size.d)}
              </span>
            </button>
            <button type="button" className="icon" onClick={() => setEditing(d.id)} aria-label={`عدّل ${d.name}`} data-edit={d.id}>
              ✎
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

function ItemTypeForm({
  draft: initial,
  project,
  onSave,
  onCancel,
  onDelete,
}: {
  draft: Draft;
  project: Project;
  onSave: (d: ItemDefinition) => void;
  onCancel: () => void;
  onDelete: (id: Id) => void;
}) {
  const [draft, setDraft] = useState(initial);
  const set = <K extends keyof Draft>(key: K) => (value: Draft[K] | undefined) => value !== undefined && setDraft((d) => ({ ...d, [key]: value }));
  const used = draft.id ? Object.values(project.items).filter((i) => i.definitionId === draft.id).length : 0;
  const valid = draft.name.trim() !== '' && draft.w > 0 && draft.d > 0 && draft.h > 0;
  const save = () => {
    const taken = new Set([...Object.keys(project.catalog), ...Object.keys(project.items), project.id, ...project.space.doors.map((d) => d.id), ...project.space.obstacles.map((o) => o.id)]);
    const id = draft.id ?? nextId(draft.category === 'box' ? 'item' : draft.category, taken);
    onSave({
      id,
      name: draft.name.trim(),
      category: draft.category,
      size: { w: cm(draft.w), d: cm(draft.d), h: cm(draft.h) },
      clearance: { front: cm(draft.front), back: cm(draft.back), left: cm(draft.left), right: cm(draft.right) },
      ...(draft.seats > 0 ? { seats: Math.round(draft.seats) } : {}),
    });
  };
  return (
    <form
      className="type-form"
      aria-label="بيانات الصنف"
      onSubmit={(e) => {
        e.preventDefault();
        if (valid) save();
      }}
    >
      <label className="field">
        <span>الاسم</span>
        <input name="type-name" value={draft.name} onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))} />
      </label>
      <label className="field">
        <span>الشكل</span>
        <select name="type-shape" value={draft.category} onChange={(e) => setDraft((d) => ({ ...d, category: e.target.value }))}>
          {SHAPES.map((s) => (
            <option key={s.key} value={s.key}>
              {s.label}
            </option>
          ))}
          {!SHAPES.some((s) => s.key === draft.category) && <option value={draft.category}>{draft.category}</option>}
        </select>
      </label>
      <div className="grid3">
        <NumberField name="type-w" label="العرض" unit="سم" value={draft.w} min={1} max={100_000} onChange={set('w')} />
        <NumberField name="type-d" label="العمق" unit="سم" value={draft.d} min={1} max={100_000} onChange={set('d')} />
        <NumberField name="type-h" label="الارتفاع" unit="سم" value={draft.h} min={1} max={10_000} onChange={set('h')} />
      </div>
      <p className="muted">مساحة الاستخدام حوالين الصنف (قدام / ورا / شمال / يمين):</p>
      <div className="grid4">
        <NumberField label="قدام" unit="سم" value={draft.front} min={0} max={100_000} onChange={set('front')} />
        <NumberField label="ورا" unit="سم" value={draft.back} min={0} max={100_000} onChange={set('back')} />
        <NumberField label="شمال" unit="سم" value={draft.left} min={0} max={100_000} onChange={set('left')} />
        <NumberField label="يمين" unit="سم" value={draft.right} min={0} max={100_000} onChange={set('right')} />
      </div>
      <NumberField label="عدد الكراسي" unit="" value={draft.seats} min={0} max={10_000} onChange={set('seats')} />
      {used > 0 && <p className="muted">التعديل هيسري على {used} نسخة في المخطط.</p>}
      <div className="row">
        <button type="submit" className="primary" disabled={!valid}>
          احفظ الصنف
        </button>
        <button type="button" onClick={onCancel}>
          إلغاء
        </button>
        {draft.id && (
          <button type="button" className="danger" disabled={used > 0} title={used > 0 ? 'امسح النسخ من المخطط الأول' : ''} onClick={() => onDelete(draft.id!)}>
            امسح الصنف
          </button>
        )}
      </div>
    </form>
  );
}
