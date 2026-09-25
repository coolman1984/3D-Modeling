import { fromUnit, toUnit, type Id, type Project, type Space, type Vec2, type Zone } from '@space-planner/core';
import { bayAccess, bayRow, baysOfDepot, BAY_USES, DEPOT_CATALOG, depotMetrics, gatesOf, orientedZone, sweptOutlines, vehicleOf, type VehicleBay } from '@space-planner/starter';
import { Plus, Trash } from '@phosphor-icons/react';
import { useMemo, useState } from 'react';
import { formatCount, formatLength } from '../logic/format.js';
import { nextId } from '../logic/ids.js';
import type { Action } from '../logic/session.js';
import { takenIds } from '../logic/transform.js';
import { NumberField, Segmented } from './Fields.js';

const m = (v: number) => fromUnit(v, 'm');
const STATUS_WORD = { pass: 'Usable', fail: 'No way', unknown: 'Not settled' } as const;
const HEADINGS = [
  { id: 90_000, label: 'North' },
  { id: 0, label: 'East' },
  { id: 270_000, label: 'South' },
  { id: 180_000, label: 'West' },
] as const;

function withZones(space: Space, zones: readonly Zone[]): Space {
  const { zones: _old, ...rest } = space;
  return zones.length ? { ...rest, zones } : rest;
}

/** Access of every bay (memoised in the pack: the same yard is searched once). */
export function useBayAccess(project: Project) {
  return useMemo(() => new Map(baysOfDepot(project).map((b) => [b.zone.id, { bay: b, access: bayAccess(project, b) }])), [project]);
}

/**
 * The depot panel: bays with whether their vehicle can drive in and out, a bay-row generator and
 * gates. Choosing a bay shows its vehicle's swept path on the plan.
 */
export function DepotPanel({ project, dispatch, focus, onFocus }: { project: Project; dispatch: (a: Action) => void; focus: Id | null; onFocus: (id: Id | null) => void }) {
  const access = useBayAccess(project);
  const d = useMemo(() => depotMetrics(project), [project]);
  // The pack's own order (car, van, truck, bus), then the project's own vehicles by name: a saved
  // project lists types alphabetically, which would offer the bus first.
  const order = (id: Id) => {
    const k = DEPOT_CATALOG.findIndex((d) => d.id === id);
    return k < 0 ? DEPOT_CATALOG.length : k;
  };
  const vehicles = Object.values(project.catalog)
    .filter((def) => vehicleOf(def))
    .sort((a, b) => order(a.id) - order(b.id) || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  const [vehicleId, setVehicleId] = useState<Id>(vehicles[0]?.id ?? '');
  const v = vehicleOf(project.catalog[vehicleId]);
  const [count, setCount] = useState<number | undefined>(5);
  const [angle, setAngle] = useState<90 | 60 | 45 | 0>(90);
  const [width, setWidth] = useState<number | undefined>(undefined);
  const [length, setLength] = useState<number | undefined>(undefined);
  const [x, setX] = useState<number | undefined>(4);
  const [y, setY] = useState<number | undefined>(12);
  const [facing, setFacing] = useState<'north' | 'south'>('north');
  const [entry, setEntry] = useState<'forward' | 'reverse' | 'either'>('forward');
  const [use, setUse] = useState<string>('parking');
  const [gate, setGate] = useState<{ x: number | undefined; y: number | undefined; w: number | undefined; heading: number }>({ x: 20, y: 2, w: 6, heading: 90_000 });
  const bayW = width ?? (v ? toUnit(v.width, 'm') + 0.7 : 2.5);
  const bayL = length ?? (v ? toUnit(v.length, 'm') + 0.3 : 5);
  const zones = project.space.zones ?? [];
  const ready = v !== undefined && count !== undefined && count >= 1 && x !== undefined && y !== undefined;
  const addRow = () => {
    if (!ready) return;
    const row = bayRow({ vehicleId, use: use as (typeof BAY_USES)[number], origin: { x: m(x!), y: m(y!) }, count: count!, angle, bayWidth: m(bayW), bayLength: m(bayL), facing, entry, taken: takenIds(project) });
    dispatch({ type: 'command', command: { type: 'space.set', space: withZones(project.space, [...zones, ...row]) } });
  };
  const addGate = () => {
    if (gate.x === undefined || gate.y === undefined || gate.w === undefined) return;
    const id = nextId('gate', takenIds(project));
    // A gate zone 4 m deep, centred on the given point, across the driving direction.
    const z = orientedZone(id, 'gate', `Gate ${id.slice(5)}`, { x: m(gate.x), y: m(gate.y) }, m(gate.w), m(4), gate.heading, { heading: gate.heading });
    dispatch({ type: 'command', command: { type: 'space.set', space: withZones(project.space, [...zones, z]) } });
  };
  const remove = (id: Id) => {
    if (focus === id) onFocus(null);
    dispatch({ type: 'command', command: { type: 'space.set', space: withZones(project.space, zones.filter((z) => z.id !== id)) } });
  };
  return (
    <div className="panel-scroll panel-pad" data-testid="depot-panel">
      <div className="load-stats">
        <div className="stat">
          <div className="stat-value" data-testid="usable-bays">
            {formatCount(d.accessible)}
          </div>
          <div className="stat-label">Usable bays</div>
        </div>
        <div className="stat">
          <div className="stat-value">{formatCount(d.bays)}</div>
          <div className="stat-label">Bays drawn</div>
        </div>
        <div className="stat">
          <div className="stat-value">{formatCount(d.gates)}</div>
          <div className="stat-label">Gates</div>
        </div>
      </div>

      <div className="section-gap" />
      <div className="section-title">
        <span className="kicker">Bays</span>
      </div>
      {access.size === 0 && <p className="muted">No bays yet. Add a row below.</p>}
      {[...access.values()].map(({ bay, access: a }) => (
        <div key={bay.zone.id} className={`bay-row${focus === bay.zone.id ? ' active' : ''}`} data-bay={bay.zone.id} data-status={a.status}>
          <button type="button" className="bay-pick" onClick={() => onFocus(focus === bay.zone.id ? null : bay.zone.id)} title="Show the swept path on the plan">
            <span className={`status-dot ${a.status}`} />
            <span>
              {bay.zone.name ?? bay.zone.id}
              <span className="faint"> · {bay.vehicle?.label ?? 'no vehicle'} · {bay.use}</span>
            </span>
            <span className="faint">{a.status === 'pass' ? `${formatLength(a.enter.length)} in${a.enter.gearChanges + a.leave.gearChanges ? ' · reverses' : ''}` : STATUS_WORD[a.status]}</span>
          </button>
          <button type="button" className="btn ghost icon" style={{ width: 26, height: 26 }} aria-label={`Remove ${bay.zone.name ?? bay.zone.id}`} onClick={() => remove(bay.zone.id)}>
            <Trash size={13} />
          </button>
        </div>
      ))}

      <div className="section-gap" />
      <div className="section-title">
        <span className="kicker">Add a row of bays</span>
      </div>
      <div className="form-grid">
        <select className="input" aria-label="Bay vehicle" value={vehicleId} onChange={(e) => setVehicleId(e.target.value)}>
          {vehicles.map((def) => (
            <option key={def.id} value={def.id}>
              {def.name}
            </option>
          ))}
        </select>
        <select className="input" aria-label="Bay use" value={use} onChange={(e) => setUse(e.target.value)}>
          {BAY_USES.map((u) => (
            <option key={u} value={u}>
              {u[0]!.toUpperCase() + u.slice(1)}
            </option>
          ))}
        </select>
      </div>
      <Segmented
        label="Bay angle"
        value={angle}
        onChange={setAngle}
        options={[
          { id: 90, label: '90°' },
          { id: 60, label: '60°' },
          { id: 45, label: '45°' },
          { id: 0, label: 'Parallel' },
        ]}
      />
      <div className="form-grid" style={{ marginTop: 8 }}>
        <NumberField label="Bays" wideKey ariaLabel="Number of bays" value={count} unit="" min={1} max={200} onChange={setCount} />
        <select className="input" aria-label="How vehicles park" value={entry} onChange={(e) => setEntry(e.target.value as typeof entry)}>
          <option value="forward">Nose in</option>
          <option value="reverse">Backed in</option>
          <option value="either">Either way</option>
        </select>
        <NumberField label="W" ariaLabel="Bay width" value={bayW} unit="m" min={1} max={10} onChange={setWidth} />
        <NumberField label="L" ariaLabel="Bay length" value={bayL} unit="m" min={2} max={30} onChange={setLength} />
        <NumberField label="X" ariaLabel="Row start x" value={x} unit="m" min={-1000} max={1000} onChange={setX} />
        <NumberField label="Y" ariaLabel="Row start y" value={y} unit="m" min={-1000} max={1000} onChange={setY} />
      </div>
      <Segmented
        label="Row side"
        value={facing}
        onChange={setFacing}
        options={[
          { id: 'north', label: 'Row north of the aisle' },
          { id: 'south', label: 'South' },
        ]}
      />
      <button type="button" className="btn primary" style={{ width: '100%', marginTop: 8 }} disabled={!ready} onClick={addRow} data-testid="add-bays">
        <Plus size={15} />
        {ready ? `Add ${formatCount(count!)} bays` : 'Add bays'}
      </button>

      <div className="section-gap" />
      <div className="section-title">
        <span className="kicker">Gates</span>
      </div>
      {gatesOf(project).map((g) => (
        <div key={g.zone.id} className="zone-row" data-gate={g.zone.id}>
          <span className="swatch dock" />
          <span>
            {g.zone.name ?? g.zone.id}
            <span className="faint"> · in heading {HEADINGS.find((h) => Math.abs(h.id / 1000 - (g.heading * 180) / Math.PI) < 1)?.label ?? `${Math.round((g.heading * 180) / Math.PI)}°`}</span>
          </span>
          <span />
          <button type="button" className="btn ghost icon" style={{ width: 26, height: 26 }} aria-label={`Remove ${g.zone.name ?? g.zone.id}`} onClick={() => remove(g.zone.id)}>
            <Trash size={13} />
          </button>
        </div>
      ))}
      <div className="form-grid" style={{ marginTop: 8 }}>
        <NumberField label="X" ariaLabel="Gate x" value={gate.x} unit="m" min={-1000} max={1000} onChange={(v2) => setGate({ ...gate, x: v2 })} />
        <NumberField label="Y" ariaLabel="Gate y" value={gate.y} unit="m" min={-1000} max={1000} onChange={(v2) => setGate({ ...gate, y: v2 })} />
        <NumberField label="W" ariaLabel="Gate width" value={gate.w} unit="m" min={1} max={50} onChange={(v2) => setGate({ ...gate, w: v2 })} />
        <select className="input" aria-label="Vehicles drive in heading" value={gate.heading} onChange={(e) => setGate({ ...gate, heading: Number(e.target.value) })}>
          {HEADINGS.map((h) => (
            <option key={h.id} value={h.id}>
              In heading {h.label.toLowerCase()}
            </option>
          ))}
        </select>
      </div>
      <button type="button" className="btn" style={{ width: '100%' }} onClick={addGate} data-testid="add-gate">
        <Plus size={15} />
        Add gate
      </button>
      <p className="muted" style={{ fontSize: 12, marginTop: 8 }}>
        A bay counts only if its vehicle can drive in from a gate and out again at its turning circle without its body touching walls, columns or parked vehicles.
      </p>
    </div>
  );
}

/** The swept path of one bay's vehicle, for the plan: body outlines and the rear-axle paths. */
export function sweptOverlay(project: Project, bayId: Id | null): { outlines: Array<{ key: string; polygon: readonly Vec2[]; tone: 'enter' | 'leave' }>; paths: Array<{ key: string; points: readonly Vec2[]; tone: 'enter' | 'leave' }> } | undefined {
  if (!bayId) return undefined;
  const bay: VehicleBay | undefined = baysOfDepot(project).find((b) => b.zone.id === bayId);
  if (!bay?.vehicle) return undefined;
  const a = bayAccess(project, bay);
  if (a.status !== 'pass') return { outlines: [], paths: [] };
  const v = bay.vehicle;
  return {
    outlines: [
      ...sweptOutlines(v, a.enter).map((polygon, i) => ({ key: `in-${i}`, polygon, tone: 'enter' as const })),
      ...sweptOutlines(v, a.leave).map((polygon, i) => ({ key: `out-${i}`, polygon, tone: 'leave' as const })),
    ],
    paths: [
      { key: 'in', points: a.enter.poses, tone: 'enter' },
      { key: 'out', points: a.leave.poses, tone: 'leave' },
    ],
  };
}

/** Facts about a depot for the inspector when nothing is selected. */
export function depotFacts(project: Project): Array<[string, string]> {
  const d = depotMetrics(project);
  return [
    ['Bays', `${formatCount(d.bays)} · ${Object.entries(d.byUse).map(([k, n]) => `${n} ${k}`).join(', ') || 'none'}`],
    ['Usable bays', `${formatCount(d.accessible)}${d.unknown ? ` · ${formatCount(d.unknown)} not settled` : ''}`],
    ['Bays needing a reverse', formatCount(d.withReversing)],
    ['Drive into a bay', d.entryAverage === undefined ? '—' : `${formatLength(d.entryAverage)} average`],
    ['Gates', formatCount(d.gates)],
    ['Yard', `${Math.round(d.yardArea)} m²`],
  ];
}
