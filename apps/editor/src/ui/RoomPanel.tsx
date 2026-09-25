import { fromUnit, readRoom, roomProblems, roomSpace, toUnit, type ColumnSpec, type DoorSpec, type Project, type RoomSpec, type Wall } from '@space-planner/core';
import { CaretDown, CaretRight, DoorOpen, Plus, X } from '@phosphor-icons/react';
import { useEffect, useState } from 'react';
import { formatSquareMetres } from '../logic/format.js';
import { nextId } from '../logic/ids.js';
import type { Action } from '../logic/session.js';
import { NumberField } from './Fields.js';

export const WALL_NAMES: Readonly<Record<Wall, string>> = {
  south: 'South wall',
  north: 'North wall',
  west: 'West wall',
  east: 'East wall',
};
const WALLS: readonly Wall[] = ['south', 'north', 'west', 'east'];

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

/** Edit the room the way people describe it: size, ceiling, doors on walls, columns. Applied as one step. */
export function RoomPanel({ project, dispatch }: { project: Project; dispatch: (a: Action) => void }) {
  const [draft, setDraft] = useState(() => draftOf(project));
  const [dirty, setDirty] = useState(false);
  const [openDoor, setOpenDoor] = useState<string | null>(null);
  useEffect(() => {
    if (!dirty) setDraft(draftOf(project));
  }, [project, dirty]);

  if (!draft) {
    return (
      <div className="panel-pad">
        <p className="muted">This room is not a simple rectangle, so it cannot be edited here yet.</p>
      </div>
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
    problems = roomProblems(spec).map((p) => p.charAt(0).toUpperCase() + p.slice(1));
  } catch {
    problems = ['A number is larger than allowed'];
  }
  const setDoor = (i: number, patch: Partial<DoorDraft>) => update((d) => ({ ...d, doors: d.doors.map((x, j) => (j === i ? { ...x, ...patch } : x)) }));
  const setColumn = (i: number, patch: Partial<ColumnDraft>) => update((d) => ({ ...d, columns: d.columns.map((x, j) => (j === i ? { ...x, ...patch } : x)) }));

  return (
    <>
      <div className="panel-scroll panel-pad" aria-label="Room">
        <div className="section-title">
          <span className="kicker">Room dimensions</span>
        </div>
        <div className="grid-2">
          <NumberField name="room-width" label="W" ariaLabel="Room width" unit="m" value={draft.width} min={1} max={500} onChange={(v) => v !== undefined && update((d) => ({ ...d, width: v }))} />
          <NumberField name="room-depth" label="D" ariaLabel="Room depth" unit="m" value={draft.depth} min={1} max={500} onChange={(v) => v !== undefined && update((d) => ({ ...d, depth: v }))} />
          <span className="span-all">
            <NumberField name="room-ceiling" label="Ceiling" wideKey ariaLabel="Ceiling height" unit="m" placeholder="not set" value={draft.ceiling} min={0.5} max={50} allowEmpty onChange={(v) => update((d) => ({ ...d, ceiling: v }))} />
          </span>
        </div>
        <p className="muted" style={{ marginTop: 8 }}>
          Floor area {formatSquareMetres(Math.round(draft.width * draft.depth * 100) / 100)}. Measured inside the walls.
          {draft.ceiling === undefined && ' Without a ceiling height, heights are reported as unknown.'}
        </p>

        <div className="section-gap" />
        <div className="section-title">
          <span className="kicker">Doors · {draft.doors.length}</span>
          <button
            type="button"
            className="link-btn"
            onClick={() => {
              const id = nextId('door', taken);
              update((d) => ({ ...d, doors: [...d.doors, { id, wall: 'south', offset: 0.5, width: 90 }] }));
              setOpenDoor(id);
            }}
          >
            <Plus size={14} />
            Add door
          </button>
        </div>
        {draft.doors.map((door, i) => {
          const open = openDoor === door.id;
          return (
            <div className="door-row" key={door.id} data-door={door.id}>
              <button type="button" className="door-row-head" aria-expanded={open} onClick={() => setOpenDoor(open ? null : door.id)}>
                <span className="door-glyph">
                  <DoorOpen size={14} />
                </span>
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ fontWeight: 500 }}>{door.id}</span> <span className="faint">· {WALL_NAMES[door.wall]}</span>
                  <br />
                  <span className="faint" style={{ fontSize: 12 }}>
                    {door.width} cm wide · {door.offset} m from the corner
                  </span>
                </span>
                {open ? <CaretDown size={15} className="faint" /> : <CaretRight size={15} className="faint" />}
              </button>
              {open && (
                <div className="door-fields">
                  <select className="input span-all" aria-label="Wall" value={door.wall} onChange={(e) => setDoor(i, { wall: e.target.value as Wall })}>
                    {WALLS.map((w) => (
                      <option key={w} value={w}>
                        {WALL_NAMES[w]}
                      </option>
                    ))}
                  </select>
                  <NumberField label="At" ariaLabel="Distance from the corner" unit="m" value={door.offset} min={0} max={500} onChange={(v) => v !== undefined && setDoor(i, { offset: v })} />
                  <NumberField label="W" ariaLabel="Door width" unit="cm" value={door.width} min={1} max={5000} onChange={(v) => v !== undefined && setDoor(i, { width: v })} />
                  <button type="button" className="link-btn danger span-all" aria-label="Remove door" onClick={() => update((d) => ({ ...d, doors: d.doors.filter((_, j) => j !== i) }))}>
                    <X size={13} />
                    Remove door
                  </button>
                </div>
              )}
            </div>
          );
        })}

        <div className="section-gap" style={{ margin: '12px 0 16px' }} />
        <div className="section-title">
          <span className="kicker">Columns · {draft.columns.length}</span>
          <button type="button" className="link-btn" onClick={() => update((d) => ({ ...d, columns: [...d.columns, { id: nextId('column', taken), x: d.width / 2, y: d.depth / 2, width: 40, depth: 40 }] }))}>
            <Plus size={14} />
            Add column
          </button>
        </div>
        {draft.columns.length > 0 && (
          <p className="faint" style={{ fontSize: 11.5, margin: '-4px 0 6px' }}>
            Centre from the west and south walls, and size.
          </p>
        )}
        {draft.columns.map((col, i) => (
          <div className="col-row" key={col.id} data-column={col.id} title={col.id}>
            <NumberField label="X" ariaLabel={`${col.id} from the west wall`} unit="m" value={col.x} min={0} max={500} onChange={(v) => v !== undefined && setColumn(i, { x: v })} />
            <NumberField label="Y" ariaLabel={`${col.id} from the south wall`} unit="m" value={col.y} min={0} max={500} onChange={(v) => v !== undefined && setColumn(i, { y: v })} />
            <NumberField label="□" ariaLabel={`${col.id} size`} unit="cm" value={col.width} min={1} max={5000} onChange={(v) => v !== undefined && setColumn(i, { width: v, depth: v })} />
            <button type="button" className="btn ghost icon" style={{ width: 28, height: 28 }} aria-label="Remove column" onClick={() => update((d) => ({ ...d, columns: d.columns.filter((_, j) => j !== i) }))}>
              <X size={13} />
            </button>
          </div>
        ))}

        {problems.length > 0 && (
          <ul className="problems" style={{ marginTop: 14 }}>
            {problems.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        )}
      </div>
      <div className={`panel-foot nowrap${dirty ? ' dirty' : ''}`}>
        <span className="spacer" style={{ fontSize: 12.5, color: dirty ? 'var(--ink)' : 'var(--ink-3)' }}>
          {dirty ? 'Unsaved' : ''}
        </span>
        <button type="button" className="btn" disabled={!dirty} onClick={() => setDirty(false)}>
          Reset
        </button>
        <button
          type="button"
          className="btn primary"
          disabled={!dirty || problems.length > 0 || !spec}
          onClick={() => {
            if (!spec) return;
            dispatch({ type: 'command', command: { type: 'space.set', space: roomSpace(spec) } });
            setDirty(false);
          }}
        >
          Apply changes
        </button>
      </div>
    </>
  );
}
