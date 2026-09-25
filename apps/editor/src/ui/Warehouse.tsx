import { fromUnit, toUnit, type Id, type ItemInstance, type Project } from '@space-planner/core';
import { aislesInFront, baysOf, rackOf, rackRows, topBeam, TRUCK_PROFILES, truckOf, warehouseMetrics, ZONE_KINDS } from '@space-planner/starter';
import { Plus } from '@phosphor-icons/react';
import { useMemo, useState } from 'react';
import { formatCount, formatLength, formatMass, formatPercent } from '../logic/format.js';
import type { Action } from '../logic/session.js';
import { takenIds } from '../logic/transform.js';
import { NumberField, Segmented } from './Fields.js';
import { ZonesSection } from './Zones.js';

const ZONE_LABEL: Readonly<Record<string, string>> = { dock: 'Dock', staging: 'Staging', picking: 'Picking', 'no-go': 'No-go' };
const m = (v: number) => fromUnit(v, 'm');

/**
 * The warehouse panel: the truck the layout is planned for, capacity at a glance, a rack row
 * generator and the zones. Every change is one command, so it is one step in the history.
 */
export function WarehousePanel({ project, dispatch }: { project: Project; dispatch: (a: Action) => void }) {
  const truck = truckOf(project);
  const w = useMemo(() => warehouseMetrics(project), [project]);
  const rackTypes = Object.values(project.catalog).filter((d) => rackOf(d));
  const [typeId, setTypeId] = useState<Id>(rackTypes[0]?.id ?? '');
  const [bays, setBays] = useState<number | undefined>(8);
  const [rows, setRows] = useState<number | undefined>(4);
  const [aisle, setAisle] = useState<number | undefined>(undefined);
  const [flue, setFlue] = useState<number | undefined>(20);
  const [x, setX] = useState<number | undefined>(4);
  const [y, setY] = useState<number | undefined>(10);
  const [facing, setFacing] = useState<'south' | 'north'>('south');

  const chosen = project.catalog[typeId] ?? rackTypes[0];
  const aisleM = aisle ?? toUnit(truck.aisle, 'm');
  const ready = chosen !== undefined && bays !== undefined && rows !== undefined && x !== undefined && y !== undefined && flue !== undefined && bays >= 1 && rows >= 1 && bays * rows <= 5000;
  const addRows = () => {
    if (!ready || !chosen) return;
    const commands = rackRows(chosen, { definitionId: chosen.id, origin: { x: m(x!), y: m(y!) }, bays: bays!, rows: rows!, aisle: m(aisleM), flue: fromUnit(flue!, 'cm'), firstFacing: facing, taken: takenIds(project) });
    dispatch({ type: 'command', command: { type: 'batch', commands }, select: commands.map((c) => (c.type === 'item.add' ? c.item.id : '')) });
  };
  const setTruck = (id: string) => {
    if (id === truck.id) return;
    dispatch({ type: 'command', command: { type: 'space.set', space: { ...project.space, meta: { ...(project.space.meta ?? {}), truck: id } } } });
  };
  return (
    <div className="panel-scroll panel-pad" data-testid="warehouse-panel">
      <div className="section-title">
        <span className="kicker">Truck</span>
      </div>
      <select className="input" aria-label="Truck" value={truck.id} onChange={(e) => setTruck(e.target.value)}>
        {TRUCK_PROFILES.map((t) => (
          <option key={t.id} value={t.id}>
            {t.label}
          </option>
        ))}
      </select>
      <p className="muted" style={{ fontSize: 12, margin: '6px 0 0' }} data-testid="truck-needs">
        Needs a {formatLength(truck.aisle)} aisle, lifts to {formatLength(truck.maxLift)}. Typical figures: use the rated aisle of the truck you buy.
      </p>

      <div className="load-stats" style={{ marginTop: 12 }}>
        <Stat label="Pallet locations" value={formatCount(w.locations)} testId="locations" />
        <Stat label="Floor used" value={formatPercent(w.storageFloorShare)} />
        <Stat label="Volume used" value={w.cubeShare === undefined ? '—' : formatPercent(w.cubeShare)} />
      </div>
      <div className="fact">
        <span>Rack bays</span>
        <span data-testid="bays">{formatCount(w.bays)}</span>
      </div>
      <div className="fact">
        <span>Rack capacity</span>
        <span>{w.rackCapacity === undefined ? 'Not stated' : formatMass(w.rackCapacity)}</span>
      </div>
      <div className="fact">
        <span>Dock to rack</span>
        <span data-testid="travel">{w.travelAverage === undefined ? '—' : `${formatLength(w.travelAverage)} avg · ${formatLength(w.travelMax ?? 0)} max`}</span>
      </div>

      <div className="section-gap" />
      <div className="section-title">
        <span className="kicker">Add rack rows</span>
      </div>
      <label className="stack">
        Rack type
        <select className="input" aria-label="Rack type" value={chosen?.id ?? ''} onChange={(e) => setTypeId(e.target.value)}>
          {rackTypes.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
        </select>
      </label>
      <div className="form-grid" style={{ marginTop: 8 }}>
        <NumberField label="Bays" wideKey ariaLabel="Bays per row" value={bays} unit="" min={1} max={500} onChange={setBays} />
        <NumberField label="Rows" wideKey ariaLabel="Number of rows" value={rows} unit="" min={1} max={200} onChange={setRows} />
        <NumberField label="Aisle" wideKey ariaLabel="Aisle width" value={aisleM} unit="m" min={0.5} max={20} onChange={setAisle} />
        <NumberField label="Flue" wideKey ariaLabel="Flue between back-to-back rows" value={flue} unit="cm" min={0} max={200} onChange={setFlue} />
        <NumberField label="X" ariaLabel="First bay x" value={x} unit="m" min={-1000} max={1000} onChange={setX} />
        <NumberField label="Y" ariaLabel="First bay y" value={y} unit="m" min={-1000} max={1000} onChange={setY} />
      </div>
      <Segmented
        label="First row faces"
        value={facing}
        onChange={setFacing}
        options={[
          { id: 'south', label: 'First faces south' },
          { id: 'north', label: 'First faces north' },
        ]}
      />
      <p className="muted" style={{ fontSize: 12, margin: '6px 0 8px' }}>
        Rows run east from the south-west corner of the first bay; pairs stand back to back across the flue and face each other across the aisle.
      </p>
      <button type="button" className="btn primary" style={{ width: '100%' }} disabled={!ready} onClick={addRows} data-testid="add-rows">
        <Plus size={15} />
        {ready ? `Add ${formatCount(bays! * rows!)} bays` : 'Add rack rows'}
      </button>

      <div className="section-gap" />
      <ZonesSection project={project} dispatch={dispatch} kinds={ZONE_KINDS.map((k) => ({ id: k, label: ZONE_LABEL[k] ?? k }))} initialKind="staging" hint="Trucks start from docks and never drive through no-go zones." />
    </div>
  );
}

function Stat({ label, value, testId }: { label: string; value: string; testId?: string }) {
  return (
    <div className="stat">
      <div className="stat-value" data-testid={testId}>
        {value}
      </div>
      <div className="stat-label">{label}</div>
    </div>
  );
}

/** The rack section of the inspector for one bay: what it holds, its aisle, and the drive to it. */
export function RackGroup({ project, item, travel }: { project: Project; item: ItemInstance; travel: number | undefined }) {
  const definition = project.catalog[item.definitionId]!;
  const spec = rackOf(definition)!;
  const truck = truckOf(project);
  const gap = useMemo(() => aislesInFront(project, baysOf(project).filter((b) => b.item.id === item.id)).get(item.id), [project, item.id]);
  return (
    <div className="insp-group" aria-label="Rack bay">
      <div className="kicker">Rack bay</div>
      <div className="facts" style={{ padding: '4px 0 0' }}>
        <div className="fact">
          <span>Pallet locations</span>
          <span data-testid="bay-locations">
            {formatCount(spec.levels * spec.positions)} · {spec.levels} levels × {spec.positions}
          </span>
        </div>
        <div className="fact">
          <span>Top beam</span>
          <span>{formatLength(topBeam(spec))}</span>
        </div>
        <div className="fact">
          <span>Load per pallet</span>
          <span>{spec.positionLoad === undefined ? 'Not stated' : formatMass(spec.positionLoad)}</span>
        </div>
        <div className="fact">
          <span>Aisle in front</span>
          <span data-testid="bay-aisle" style={gap !== undefined && gap < truck.aisle ? { color: 'var(--error)' } : undefined}>
            {gap === undefined ? '—' : `${formatLength(gap)} · needs ${formatLength(truck.aisle)}`}
          </span>
        </div>
        <div className="fact">
          <span>Drive from a dock</span>
          <span data-testid="bay-travel" style={travel === undefined ? { color: 'var(--error)' } : undefined}>
            {travel === undefined ? 'Not reachable' : formatLength(travel)}
          </span>
        </div>
      </div>
      <p className="hint">The dashed line on the plan is the truck’s route from the nearest dock. The front edge (orange) is where pallets go in.</p>
    </div>
  );
}

/** Facts about a warehouse for the inspector when nothing is selected. */
export function warehouseFacts(project: Project): Array<[string, string]> {
  const w = warehouseMetrics(project);
  const truck = truckOf(project);
  return [
    ['Truck', truck.label],
    ['Pallet locations', `${formatCount(w.locations)}${w.floorPallets ? ` · ${formatCount(w.floorPallets)} on the floor` : ''}`],
    ['Rack bays', formatCount(w.bays)],
    ['Rack capacity', w.rackCapacity === undefined ? 'Not stated' : formatMass(w.rackCapacity)],
    ['Floor used by storage', formatPercent(w.storageFloorShare)],
    ['Volume used', w.cubeShare === undefined ? 'Ceiling not set' : formatPercent(w.cubeShare)],
    ['Docks', formatCount(w.docks)],
    ['Dock to rack face', w.travelAverage === undefined ? '—' : `${formatLength(w.travelAverage)} average`],
  ];
}

