import { fromUnit, readRoom, roomProblems, roomSpace, toUnit, type ColumnSpec, type DoorSpec, type Project, type RoomSpec, type Wall } from '@space-planner/core';
import { useEffect, useState } from 'react';
import { nextId } from '../logic/ids.js';
import type { Action } from '../logic/session.js';
import { NumberField } from './Fields.js';

const WALLS: ReadonlyArray<{ id: Wall; label: string }> = [
  { id: 'south', label: 'الجنوبية (تحت)' },
  { id: 'north', label: 'الشمالية (فوق)' },
  { id: 'west', label: 'الغربية (شمال)' },
  { id: 'east', label: 'الشرقية (يمين)' },
];

interface DoorDraft {
  id: string;
  wall: Wall;
  offset: number; // m
  width: number; // cm
}

interface ColumnDraft {
  id: string;
  x: number; // m
  y: number; // m
  width: number; // cm
  depth: number; // cm
}

interface RoomDraft {
  width: number;
  depth: number;
  ceiling: number | undefined;
  doors: DoorDraft[];
  columns: ColumnDraft[];
}

function draftOf(project: Project): RoomDraft | null {
  const room = readRoom(project.space);
  if (!room) return null;
  const m = (t: number) => toUnit(t, 'm');
  const c = (t: number) => toUnit(t, 'cm');
  return {
    width: m(room.width),
    depth: m(room.depth),
    ceiling: room.ceilingHeight === undefined ? undefined : m(room.ceilingHeight),
    doors: room.doors.map((d) => ({ id: d.id, wall: d.wall, offset: m(d.offset), width: c(d.width) })),
    columns: room.columns.map((col) => ({ id: col.id, x: m(col.center.x), y: m(col.center.y), width: c(col.width), depth: c(col.depth) })),
  };
}

const PROBLEM_WORDS: Array<[RegExp, string]> = [
  [/door (.+): does not fit on the (\w+) wall/, 'الباب $1 مش داخل على الحيطة'],
  [/door (.+): width must be positive/, 'عرض الباب $1 لازم يكون أكبر من صفر'],
  [/column (.+): centre is outside the room/, 'العمود $1 برّه القاعة'],
  [/column (.+): size must be positive/, 'مقاس العمود $1 لازم يكون أكبر من صفر'],
  [/room width and depth must be positive/, 'مقاسات القاعة لازم تكون أكبر من صفر'],
];

function arabicProblem(text: string): string {
  for (const [pattern, words] of PROBLEM_WORDS) if (pattern.test(text)) return text.replace(pattern, words);
  return text;
}

/** Edit the room the way people describe it: size, ceiling, doors on walls, columns. */
export function RoomPanel({ project, dispatch }: { project: Project; dispatch: (a: Action) => void }) {
  const [draft, setDraft] = useState(() => draftOf(project));
  const [dirty, setDirty] = useState(false);
  useEffect(() => {
    if (!dirty) setDraft(draftOf(project));
  }, [project, dirty]);

  if (!draft) {
    return (
      <section className="panel" aria-label="القاعة">
        <h2>القاعة</h2>
        <p className="muted">شكل القاعة دي مش مستطيل بسيط، فتعديلها من هنا مش متاح لسه.</p>
      </section>
    );
  }

  const update = (change: (d: RoomDraft) => RoomDraft) => {
    setDraft((d) => (d ? change(d) : d));
    setDirty(true);
  };
  const taken = new Set([...Object.keys(project.items), ...Object.keys(project.catalog), project.id, ...draft.doors.map((d) => d.id), ...draft.columns.map((c) => c.id)]);
  const m = (v: number) => fromUnit(v, 'm');
  const cm = (v: number) => fromUnit(v, 'cm');
  let spec: RoomSpec | undefined;
  let problems: string[] = [];
  try {
    spec = {
      width: m(draft.width),
      depth: m(draft.depth),
      ...(draft.ceiling === undefined ? {} : { ceilingHeight: m(draft.ceiling) }),
      doors: draft.doors.map((d): DoorSpec => ({ id: d.id, wall: d.wall, offset: m(d.offset), width: cm(d.width) })),
      columns: draft.columns.map((c): ColumnSpec => ({ id: c.id, center: { x: m(c.x), y: m(c.y) }, width: cm(c.width), depth: cm(c.depth) })),
    };
    problems = roomProblems(spec).map(arabicProblem);
  } catch {
    problems = ['فيه رقم أكبر من المسموح'];
  }

  return (
    <section className="panel" aria-label="القاعة">
      <h2>القاعة</h2>
      <div className="grid3">
        <NumberField name="room-width" label="العرض" unit="م" value={draft.width} min={1} max={500} onChange={(v) => v !== undefined && update((d) => ({ ...d, width: v }))} />
        <NumberField name="room-depth" label="الطول" unit="م" value={draft.depth} min={1} max={500} onChange={(v) => v !== undefined && update((d) => ({ ...d, depth: v }))} />
        <NumberField name="room-ceiling" label="السقف" unit="م" value={draft.ceiling} min={0.5} max={50} allowEmpty onChange={(v) => update((d) => ({ ...d, ceiling: v }))} />
      </div>

      <h3>
        الأبواب
        <button type="button" className="small" onClick={() => update((d) => ({ ...d, doors: [...d.doors, { id: nextId('door', taken), wall: 'south', offset: 0.5, width: 90 }] }))}>
          ضيف باب
        </button>
      </h3>
      {draft.doors.map((door, i) => (
        <div className="subrow" key={door.id} data-door={door.id}>
          <select
            aria-label="الحيطة"
            value={door.wall}
            onChange={(e) => update((d) => ({ ...d, doors: d.doors.map((x, j) => (j === i ? { ...x, wall: e.target.value as Wall } : x)) }))}
          >
            {WALLS.map((w) => (
              <option key={w.id} value={w.id}>
                {w.label}
              </option>
            ))}
          </select>
          <NumberField label="يبعد" unit="م" value={door.offset} min={0} max={500} onChange={(v) => v !== undefined && update((d) => ({ ...d, doors: d.doors.map((x, j) => (j === i ? { ...x, offset: v } : x)) }))} />
          <NumberField label="عرضه" unit="سم" value={door.width} min={1} max={5000} onChange={(v) => v !== undefined && update((d) => ({ ...d, doors: d.doors.map((x, j) => (j === i ? { ...x, width: v } : x)) }))} />
          <button type="button" className="icon danger" aria-label="امسح الباب" onClick={() => update((d) => ({ ...d, doors: d.doors.filter((_, j) => j !== i) }))}>
            ✕
          </button>
        </div>
      ))}

      <h3>
        الأعمدة
        <button type="button" className="small" onClick={() => update((d) => ({ ...d, columns: [...d.columns, { id: nextId('column', taken), x: d.width / 2, y: d.depth / 2, width: 40, depth: 40 }] }))}>
          ضيف عمود
        </button>
      </h3>
      {draft.columns.map((col, i) => (
        <div className="subrow" key={col.id} data-column={col.id}>
          <NumberField label="من الغرب" unit="م" value={col.x} min={0} max={500} onChange={(v) => v !== undefined && update((d) => ({ ...d, columns: d.columns.map((x, j) => (j === i ? { ...x, x: v } : x)) }))} />
          <NumberField label="من الجنوب" unit="م" value={col.y} min={0} max={500} onChange={(v) => v !== undefined && update((d) => ({ ...d, columns: d.columns.map((x, j) => (j === i ? { ...x, y: v } : x)) }))} />
          <NumberField label="مقاسه" unit="سم" value={col.width} min={1} max={5000} onChange={(v) => v !== undefined && update((d) => ({ ...d, columns: d.columns.map((x, j) => (j === i ? { ...x, width: v, depth: v } : x)) }))} />
          <button type="button" className="icon danger" aria-label="امسح العمود" onClick={() => update((d) => ({ ...d, columns: d.columns.filter((_, j) => j !== i) }))}>
            ✕
          </button>
        </div>
      ))}

      {problems.length > 0 && (
        <ul className="problems">
          {problems.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
      )}
      <div className="row">
        <button
          type="button"
          className="primary"
          disabled={!dirty || problems.length > 0 || !spec}
          onClick={() => {
            if (!spec) return;
            dispatch({ type: 'command', command: { type: 'space.set', space: roomSpace(spec) } });
            setDirty(false);
          }}
        >
          طبّق على القاعة
        </button>
        <button type="button" disabled={!dirty} onClick={() => setDirty(false)}>
          تراجع عن التعديل
        </button>
      </div>
    </section>
  );
}
