import { fromUnit, toUnit, type Id, type ItemDefinition, type Project } from '@space-planner/core';
import { missingPackItems, packOf, PACKS, ROUND_SHAPES, SHAPES, shapeOf, type PackId, type ShapeKey } from '@space-planner/starter';
import { MagnifyingGlass, PencilSimpleLine, Plus, DownloadSimple } from '@phosphor-icons/react';
import { useMemo, useState } from 'react';
import { formatCentimetres, formatCount } from '../logic/format.js';
import { nextId } from '../logic/ids.js';
import { takenIds } from '../logic/transform.js';
import type { Action } from '../logic/session.js';
import { Dialog, LineTabs, NumberField, SwitchRow } from './Fields.js';

const cm = (v: number) => fromUnit(v, 'cm');

/** Library categories, from the item's shape. Item types not from any pack are "Custom". */
export type Category = 'All' | 'Tables' | 'Seating' | 'Stages' | 'Service' | 'Office' | 'Storage' | 'Production' | 'Other' | 'Custom';
const CATEGORY_OF_SHAPE: Readonly<Record<ShapeKey, Exclude<Category, 'All' | 'Custom'>>> = {
  table: 'Tables',
  'round-table': 'Tables',
  chair: 'Seating',
  sofa: 'Seating',
  stage: 'Stages',
  'dance-floor': 'Stages',
  counter: 'Service',
  desk: 'Office',
  shelf: 'Office',
  plant: 'Other',
  box: 'Other',
  rack: 'Storage',
  machine: 'Production',
  conveyor: 'Production',
};
const CATEGORIES: readonly Category[] = ['All', 'Tables', 'Seating', 'Stages', 'Service', 'Office', 'Storage', 'Production', 'Other', 'Custom'];
const PACK_IDS = new Set(PACKS.flatMap((p) => p.catalog.map((d) => d.id)));

export function categoryOf(definition: ItemDefinition): Exclude<Category, 'All'> {
  return PACK_IDS.has(definition.id) ? CATEGORY_OF_SHAPE[shapeOf(definition.category)] : 'Custom';
}

/** "180 × 80 cm · 10 seats", or "Ø 180 cm" for round items. */
export function sizeLine(d: ItemDefinition): string {
  const size = d.footprint === 'round' && d.size.w === d.size.d ? `Ø ${formatCentimetres(d.size.w)} cm` : `${formatCentimetres(d.size.w)} × ${formatCentimetres(d.size.d)} cm`;
  return d.seats ? `${size} · ${d.seats} ${d.seats === 1 ? 'seat' : 'seats'}` : size;
}

/** A small top view of an item type: its outline, front edge and, dotted, the room it needs. */
export function TypeArt({ definition, box = 64 }: { definition: ItemDefinition; box?: number }) {
  const c = definition.clearance;
  const totalW = definition.size.w + c.left + c.right;
  const totalD = definition.size.d + c.front + c.back;
  const k = Math.min(box / Math.max(totalW, 1), (box * 0.8) / Math.max(totalD, 1), 0.02);
  const w = Math.max(6, definition.size.w * k);
  const d = Math.max(6, definition.size.d * k);
  const hasClear = c.left + c.right + c.front + c.back > 0;
  const dark = shapeOf(definition.category) === 'stage';
  const round = definition.footprint === 'round';
  const x = (c.left - c.right) * k * 0.5;
  const y = (c.back - c.front) * k * 0.5;
  return (
    <svg width={box} height={box * 0.8} viewBox={`${-box / 2} ${-box * 0.4} ${box} ${box * 0.8}`} aria-hidden="true">
      {hasClear && (
        <rect x={-w / 2 - c.left * k + x} y={-d / 2 - c.back * k + y} width={totalW * k} height={totalD * k} fill="none" stroke="#7a756c" strokeWidth={1} strokeDasharray="1.5 2.5" />
      )}
      {round ? (
        <>
          <ellipse cx={x} cy={y} rx={w / 2} ry={d / 2} fill="#fdfcfa" stroke="#1a1917" strokeWidth={1.3} />
          {(definition.seats ?? 0) === 0 && definition.category === 'round-table' && <ellipse cx={x} cy={y} rx={w / 2 + 4} ry={d / 2 + 4} fill="none" stroke="#7a756c" strokeWidth={1} strokeDasharray="1.5 2" />}
        </>
      ) : (
        <>
          <rect x={-w / 2 + x} y={-d / 2 + y} width={w} height={d} fill={dark ? '#2b2a27' : '#fdfcfa'} stroke="#1a1917" strokeWidth={1.3} />
          <line x1={-w / 2 + x} y1={d / 2 + y} x2={w / 2 + x} y2={d / 2 + y} stroke="#1a1917" strokeWidth={2.2} />
        </>
      )}
    </svg>
  );
}

/** The object library: search, categories and a tile per item type; a click or a drag places one. */
export function LibraryPanel({
  project,
  pack,
  onAdd,
  dispatch,
  onEdit,
}: {
  project: Project;
  /** The activity pack whose missing items can be brought in. */
  pack: PackId;
  onAdd: (definition: ItemDefinition) => void;
  dispatch: (a: Action) => void;
  onEdit: (id: Id | 'new') => void;
}) {
  const [filter, setFilter] = useState('');
  const [category, setCategory] = useState<Category>('All');
  const all = useMemo(() => Object.values(project.catalog), [project.catalog]);
  const words = filter.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const searching = words.length > 0;
  const shown = all.filter((d) => (searching ? words.every((w) => d.name.toLowerCase().includes(w)) : category === 'All' || categoryOf(d) === category));
  const counts = new Map<Category, number>();
  for (const d of all) counts.set(categoryOf(d), (counts.get(categoryOf(d)) ?? 0) + 1);
  const tabs = CATEGORIES.filter((c) => c === 'All' || c === 'Custom' || (counts.get(c) ?? 0) > 0).map((c) => ({ id: c, label: c, count: c === 'All' ? all.length : (counts.get(c) ?? 0) }));
  // The pack's items this project does not have yet (older projects, another activity, or deleted by hand).
  const taken = takenIds(project);
  const missing = missingPackItems(project, pack).filter((d) => !taken.has(d.id));
  return (
    <>
      <div className="panel-pad" style={{ paddingBottom: 12 }}>
        <label className="search">
          <MagnifyingGlass size={15} />
          <input className="input" name="catalog-filter" type="search" placeholder={`Search ${all.length} item types`} aria-label="Search item types" value={filter} onChange={(e) => setFilter(e.target.value)} />
        </label>
        <LineTabs className={searching ? 'dimmed' : ''} tabs={tabs} value={searching ? ('none' as Category) : category} onChange={(c) => { setCategory(c); setFilter(''); }} />
      </div>
      <div className="panel-scroll" style={{ padding: '2px 14px 16px' }}>
        {shown.length === 0 ? (
          <div className="empty-note">
            <div className="serif">{searching ? 'No matching item types' : 'No item types here yet'}</div>
            <p style={{ marginTop: 6, fontSize: 12.5, lineHeight: 1.5 }}>
              {searching ? `Nothing matches “${filter.trim()}”. Try a shorter name.` : 'Create an item type with its real dimensions and clearance.'}
            </p>
          </div>
        ) : (
          <ul className="tiles" style={{ listStyle: 'none', padding: 0, margin: '6px 0 0' }}>
            {shown.map((d) => (
              <li key={d.id} className="tile-wrap">
                <button
                  type="button"
                  className="tile"
                  style={{ width: '100%' }}
                  onClick={() => onAdd(d)}
                  data-add={d.id}
                  title="Click to place · drag onto the plan"
                  draggable
                  onDragStart={(e) => {
                    e.dataTransfer.setData('application/x-atrium-type', d.id);
                    e.dataTransfer.effectAllowed = 'copy';
                  }}
                >
                  <span className="tile-art">
                    <TypeArt definition={d} />
                  </span>
                  <span className="tile-name">{d.name}</span>
                  <span className="tile-dims">{sizeLine(d)}</span>
                </button>
                <button type="button" className="tile-edit" onClick={() => onEdit(d.id)} aria-label={`Edit ${d.name}`} title="Edit item type" data-edit={d.id}>
                  <PencilSimpleLine size={14} />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="panel-foot">
        <button type="button" className="btn" onClick={() => onEdit('new')}>
          <Plus size={15} />
          New item type
        </button>
        <span className="faint" style={{ fontSize: 12 }}>
          Click a tile to place
        </span>
        {missing.length > 0 && (
          <button
            type="button"
            className="link-btn"
            data-testid="bring-missing"
            onClick={() => dispatch({ type: 'command', command: { type: 'batch', commands: missing.map((definition) => ({ type: 'catalog.define', definition })) } })}
          >
            <DownloadSimple size={14} />
            Add {formatCount(missing.length)} missing {packOf(pack).label.toLowerCase()} item types
          </button>
        )}
      </div>
    </>
  );
}

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
  round: boolean;
  /** Mass of one piece in kg; undefined = unknown. */
  massKg: number | undefined;
  /** Cargo data (containers); undefined = not stated. */
  quantity: number | undefined;
  stackable: boolean | undefined;
  maxLoadKg: number | undefined;
  allowTilt: boolean | undefined;
  stackGroup: string;
  stop: number | undefined;
  /** Production line station data (factories); '' = not a station. */
  station: string;
  cycleS: number | undefined;
  capacity: number | undefined;
  maintFront: number | undefined;
  maintBack: number | undefined;
  maintLeft: number | undefined;
  maintRight: number | undefined;
}

const CARGO_KEYS = ['quantity', 'stackable', 'maxLoadOnTop', 'allowTilt', 'stackGroup', 'stop'] as const;
const STATION_KEYS = ['station', 'cycle', 'capacity', 'maintFront', 'maintBack', 'maintLeft', 'maintRight'] as const;
const STATION_KINDS = [
  ['', 'Not a station'],
  ['source', 'Source (parts come in)'],
  ['machine', 'Machine'],
  ['buffer', 'Buffer'],
  ['conveyor', 'Conveyor'],
  ['sink', 'Sink (parts leave)'],
] as const;

function draftOf(definition: ItemDefinition): Draft {
  const c = (t: number) => toUnit(t, 'cm');
  const m = definition.meta ?? {};
  return {
    id: definition.id,
    name: definition.name,
    category: definition.category,
    w: c(definition.size.w),
    d: c(definition.size.d),
    h: c(definition.size.h),
    front: c(definition.clearance.front),
    back: c(definition.clearance.back),
    left: c(definition.clearance.left),
    right: c(definition.clearance.right),
    seats: definition.seats ?? 0,
    round: definition.footprint === 'round',
    massKg: definition.mass === undefined ? undefined : definition.mass / 1000,
    quantity: typeof m.quantity === 'number' ? m.quantity : undefined,
    stackable: typeof m.stackable === 'boolean' ? m.stackable : undefined,
    maxLoadKg: typeof m.maxLoadOnTop === 'number' ? m.maxLoadOnTop / 1000 : undefined,
    allowTilt: typeof m.allowTilt === 'boolean' ? m.allowTilt : undefined,
    stackGroup: typeof m.stackGroup === 'string' ? m.stackGroup : '',
    stop: typeof m.stop === 'number' ? m.stop : undefined,
    station: typeof m.station === 'string' ? m.station : '',
    cycleS: typeof m.cycle === 'number' ? m.cycle / 1000 : undefined,
    capacity: typeof m.capacity === 'number' ? m.capacity : undefined,
    maintFront: typeof m.maintFront === 'number' ? c(m.maintFront) : undefined,
    maintBack: typeof m.maintBack === 'number' ? c(m.maintBack) : undefined,
    maintLeft: typeof m.maintLeft === 'number' ? c(m.maintLeft) : undefined,
    maintRight: typeof m.maintRight === 'number' ? c(m.maintRight) : undefined,
  };
}

const EMPTY: Draft = { id: null, name: '', category: 'box', w: 100, d: 60, h: 75, front: 0, back: 0, left: 0, right: 0, seats: 0, round: false, massKg: undefined, quantity: undefined, stackable: undefined, maxLoadKg: undefined, allowTilt: undefined, stackGroup: '', stop: undefined, station: '', cycleS: undefined, capacity: undefined, maintFront: undefined, maintBack: undefined, maintLeft: undefined, maintRight: undefined };

/**
 * The type's meta with the fields the dialog shows (cargo always; station data for production
 * lines); other keys are kept as they were.
 */
function metaOf(previous: ItemDefinition['meta'], d: Draft, pack: PackId): { meta?: Record<string, string | number | boolean> } {
  const managed: readonly string[] = pack === 'factory' ? [...CARGO_KEYS, ...STATION_KEYS] : CARGO_KEYS;
  const meta: Record<string, string | number | boolean> = Object.fromEntries(Object.entries(previous ?? {}).filter(([k]) => !managed.includes(k)));
  if (pack === 'factory' && d.station) {
    meta.station = d.station;
    if (d.cycleS !== undefined && d.cycleS > 0) meta.cycle = Math.round(d.cycleS * 1000);
    if (d.capacity !== undefined && d.capacity > 0) meta.capacity = Math.round(d.capacity);
    for (const [key, v] of [['maintFront', d.maintFront], ['maintBack', d.maintBack], ['maintLeft', d.maintLeft], ['maintRight', d.maintRight]] as const) if (v !== undefined) meta[key] = cm(v);
  }
  if (d.quantity !== undefined && d.quantity > 0) meta.quantity = Math.round(d.quantity);
  if (d.stackable !== undefined) meta.stackable = d.stackable;
  if (d.maxLoadKg !== undefined) meta.maxLoadOnTop = Math.round(d.maxLoadKg * 1000);
  if (d.allowTilt !== undefined) meta.allowTilt = d.allowTilt;
  if (d.stackGroup.trim()) meta.stackGroup = d.stackGroup.trim();
  if (d.stop !== undefined) meta.stop = Math.round(d.stop);
  return Object.keys(meta).length > 0 ? { meta } : {};
}

/** Create or edit an item type with its real size and the free space it needs. */
export function ItemTypeDialog({
  project,
  editing,
  onClose,
  dispatch,
  pack,
}: {
  pack: PackId;
  project: Project;
  editing: Id | 'new';
  onClose: () => void;
  dispatch: (a: Action) => void;
}) {
  const existing = editing === 'new' ? undefined : project.catalog[editing];
  const [draft, setDraft] = useState<Draft>(() => (existing ? draftOf(existing) : EMPTY));
  const set = <K extends keyof Draft>(key: K) => (value: Draft[K] | undefined) => value !== undefined && setDraft((d) => ({ ...d, [key]: value }));
  const used = draft.id ? Object.values(project.items).filter((i) => i.definitionId === draft.id).length : 0;
  const valid = draft.name.trim() !== '' && draft.w > 0 && draft.d > 0 && draft.h > 0;
  const save = () => {
    const taken = new Set([...Object.keys(project.catalog), ...Object.keys(project.items), project.id, ...project.space.doors.map((d) => d.id), ...project.space.obstacles.map((o) => o.id), ...(project.space.zones ?? []).map((z) => z.id)]);
    const id = draft.id ?? nextId(shapeOf(draft.category) === 'box' ? 'item' : draft.category, taken);
    dispatch({
      type: 'command',
      command: {
        type: 'catalog.define',
        definition: {
          id,
          name: draft.name.trim(),
          category: draft.category,
          size: { w: cm(draft.w), d: cm(draft.d), h: cm(draft.h) },
          clearance: { front: cm(draft.front), back: cm(draft.back), left: cm(draft.left), right: cm(draft.right) },
          ...(draft.seats > 0 ? { seats: Math.round(draft.seats) } : {}),
          ...(draft.round ? { footprint: 'round' as const } : {}),
          ...(draft.massKg !== undefined && draft.massKg > 0 ? { mass: Math.round(draft.massKg * 1000) } : {}),
          ...metaOf(existing?.meta, draft, pack),
        },
      },
    });
    onClose();
  };
  const note = draft.id ? (used > 0 ? `Applies to ${used} placed` : 'Not placed yet') : 'Added to the library';
  return (
    <Dialog label="Item type" onClose={onClose}>
      <form
        aria-label="Item type details"
        onSubmit={(e) => {
          e.preventDefault();
          if (valid) save();
        }}
      >
        <div className="dialog-head">
          <div className="kicker">{draft.id ? 'Edit item type' : 'Object library'}</div>
          <h3>{draft.id ? existing?.name ?? draft.name : 'New item type'}</h3>
        </div>
        <div className="dialog-body">
          <label className="stack">
            Name
            <input className="input" name="type-name" value={draft.name} autoFocus onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))} placeholder="e.g. Round table 180" />
          </label>
          <div className="grid-2">
            <label className="stack">
              3D shape
              <select
                className="input"
                name="type-shape"
                value={draft.category}
                onChange={(e) => {
                  const category = e.target.value;
                  setDraft((d) => ({ ...d, category, round: ROUND_SHAPES.includes(category as ShapeKey) }));
                }}
              >
                {SHAPES.map((s) => (
                  <option key={s.key} value={s.key}>
                    {s.label}
                  </option>
                ))}
                {!SHAPES.some((s) => s.key === draft.category) && <option value={draft.category}>{draft.category}</option>}
              </select>
            </label>
            <label className="stack">
              Footprint
              <select className="input" name="type-footprint" value={draft.round ? 'round' : 'rect'} onChange={(e) => setDraft((d) => ({ ...d, round: e.target.value === 'round' }))}>
                <option value="rect">Rectangle</option>
                <option value="round">Round</option>
              </select>
            </label>
          </div>
          <div>
            <div className="kicker" style={{ marginBottom: 8 }}>
              Size
            </div>
            <div className="grid-4">
              <NumberField name="type-w" label="W" ariaLabel="Width" unit="cm" value={draft.w} min={1} max={100_000} onChange={set('w')} />
              <NumberField name="type-d" label="D" ariaLabel="Depth" unit="cm" value={draft.d} min={1} max={100_000} onChange={set('d')} />
              <NumberField name="type-h" label="H" ariaLabel="Height" unit="cm" value={draft.h} min={1} max={10_000} onChange={set('h')} />
              <NumberField name="type-seats" label="#" ariaLabel="Seats" unit="seats" value={draft.seats} min={0} max={10_000} onChange={set('seats')} />
            </div>
          </div>
          <div className="grid-4">
            <NumberField name="type-mass" label="kg" ariaLabel="Mass in kilograms" unit="" placeholder="mass" value={draft.massKg} min={0} max={1_000_000} allowEmpty onChange={(v) => setDraft((d) => ({ ...d, massKg: v }))} />
          </div>
          {pack === 'container' && (
            <div aria-label="Cargo">
              <div className="kicker" style={{ marginBottom: 8 }}>
                Cargo
              </div>
              <div className="grid-4">
                <NumberField name="type-quantity" label="#" ariaLabel="Quantity to load" unit="pcs" value={draft.quantity} min={0} max={10_000} allowEmpty onChange={(v) => setDraft((d) => ({ ...d, quantity: v }))} />
                <NumberField name="type-max-load" label="Top" ariaLabel="Maximum load on top in kilograms" wideKey unit="kg" value={draft.maxLoadKg} min={0} max={1_000_000} allowEmpty onChange={(v) => setDraft((d) => ({ ...d, maxLoadKg: v }))} />
                <NumberField name="type-stop" label="Stop" ariaLabel="Unloading stop" wideKey unit="" value={draft.stop} min={1} max={999} allowEmpty onChange={(v) => setDraft((d) => ({ ...d, stop: v }))} />
                <input className="input" name="type-stack-group" aria-label="Stacking group" placeholder="Group" value={draft.stackGroup} onChange={(e) => setDraft((d) => ({ ...d, stackGroup: e.target.value }))} />
              </div>
              <SwitchRow name="type-stackable" label="Other pieces may rest on it" on={draft.stackable !== false} onChange={(on) => setDraft((d) => ({ ...d, stackable: on }))} />
              <SwitchRow name="type-allow-tilt" label="May lie on its side" hint="Off means “this way up”" on={draft.allowTilt === true} onChange={(on) => setDraft((d) => ({ ...d, allowTilt: on }))} />
            </div>
          )}
          {pack === 'factory' && (
            <div aria-label="Station">
              <div className="kicker" style={{ marginBottom: 8 }}>
                Production line
              </div>
              <select className="input" name="type-station" aria-label="Station kind" value={draft.station} onChange={(e) => setDraft((d) => ({ ...d, station: e.target.value }))}>
                {STATION_KINDS.map(([id, label]) => (
                  <option key={id} value={id}>
                    {label}
                  </option>
                ))}
              </select>
              {draft.station && (
                <>
                  <div className="grid-2" style={{ marginTop: 8 }}>
                    {draft.station !== 'buffer' && draft.station !== 'sink' && (
                      <NumberField
                        name="type-cycle"
                        label={draft.station === 'source' ? 'Every' : draft.station === 'conveyor' ? 'Transit' : 'Cycle'}
                        wideKey
                        ariaLabel={draft.station === 'source' ? 'Release interval in seconds' : draft.station === 'conveyor' ? 'Transit time in seconds' : 'Cycle time in seconds'}
                        unit="s"
                        value={draft.cycleS}
                        min={0.001}
                        max={86_400}
                        allowEmpty
                        onChange={(v) => setDraft((d) => ({ ...d, cycleS: v }))}
                      />
                    )}
                    {(draft.station === 'buffer' || draft.station === 'conveyor') && (
                      <NumberField name="type-capacity" label="Holds" wideKey ariaLabel="Parts it holds" unit="parts" value={draft.capacity} min={1} max={100_000} allowEmpty onChange={(v) => setDraft((d) => ({ ...d, capacity: v }))} />
                    )}
                  </div>
                  <div className="muted" style={{ fontSize: 12, margin: '8px 0 6px' }}>
                    Maintenance space · leave empty when not stated
                  </div>
                  <div className="grid-4">
                    <NumberField name="type-maint-front" label="F" ariaLabel="Maintenance space in front" unit="cm" value={draft.maintFront} min={0} max={100_000} allowEmpty onChange={(v) => setDraft((d) => ({ ...d, maintFront: v }))} />
                    <NumberField name="type-maint-back" label="B" ariaLabel="Maintenance space behind" unit="cm" value={draft.maintBack} min={0} max={100_000} allowEmpty onChange={(v) => setDraft((d) => ({ ...d, maintBack: v }))} />
                    <NumberField name="type-maint-left" label="L" ariaLabel="Maintenance space on the left" unit="cm" value={draft.maintLeft} min={0} max={100_000} allowEmpty onChange={(v) => setDraft((d) => ({ ...d, maintLeft: v }))} />
                    <NumberField name="type-maint-right" label="R" ariaLabel="Maintenance space on the right" unit="cm" value={draft.maintRight} min={0} max={100_000} allowEmpty onChange={(v) => setDraft((d) => ({ ...d, maintRight: v }))} />
                  </div>
                  <p className="hint">Enter measured times: throughput is simulated only from these, never from the drawing.</p>
                </>
              )}
            </div>
          )}
          <div>
            <div className="kicker" style={{ marginBottom: 8 }}>
              Clearance · free space needed to use it
            </div>
            <div className="grid-4">
              <NumberField name="type-front" label="F" ariaLabel="Front clearance" unit="cm" value={draft.front} min={0} max={100_000} onChange={set('front')} />
              <NumberField name="type-back" label="B" ariaLabel="Back clearance" unit="cm" value={draft.back} min={0} max={100_000} onChange={set('back')} />
              <NumberField name="type-left" label="L" ariaLabel="Left clearance" unit="cm" value={draft.left} min={0} max={100_000} onChange={set('left')} />
              <NumberField name="type-right" label="R" ariaLabel="Right clearance" unit="cm" value={draft.right} min={0} max={100_000} onChange={set('right')} />
            </div>
          </div>
        </div>
        <div className="dialog-foot">
          <span className="spacer muted">{note}</span>
          {draft.id && (
            <button
              type="button"
              className="btn danger"
              disabled={used > 0}
              title={used > 0 ? 'Remove the placed copies from the plan first' : ''}
              onClick={() => {
                dispatch({ type: 'command', command: { type: 'catalog.remove', id: draft.id! } });
                onClose();
              }}
            >
              Delete
            </button>
          )}
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn primary" disabled={!valid}>
            Save item type
          </button>
        </div>
      </form>
    </Dialog>
  );
}
