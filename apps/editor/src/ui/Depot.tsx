import { fromUnit, type Project } from '@space-planner/core';
import { BAY_TYPES, bayTypeOf, bayZone, DEFAULT_VEHICLE, depotMetrics, type BayEntryResult, type BayType } from '@space-planner/starter';
import { useEffect, useState } from 'react';
import { formatCount } from '../logic/format.js';
import { nextId } from '../logic/ids.js';
import type { Action } from '../logic/session.js';
import { takenIds } from '../logic/transform.js';

/** Depot controls in the Atrium left rail: metrics, an "add bay" form and a bay-entry check. */
export function DepotPanel({ project, entry, onCheck, dispatch }: {
  project: Project;
  entry: BayEntryResult | null;
  onCheck: (bayId: string) => void;
  dispatch: (action: Action) => void;
}) {
  const bays = (project.space.zones ?? []).filter((z) => bayTypeOf(z));
  const [bay, setBay] = useState(bays[0]?.id ?? '');
  useEffect(() => { if (!bays.some((b) => b.id === bay)) setBay(bays[0]?.id ?? ''); }, [bays.map((b) => b.id).join(',')]);
  const metrics = depotMetrics(project);
  const [type, setType] = useState<BayType>('perpendicular');
  const [pos, setPos] = useState({ x: 1, y: 1, direction: 0 });
  const [bayError, setBayError] = useState('');
  const addBay = () => {
    const { x, y, direction } = pos;
    if (![x, y, direction].every(Number.isFinite)) {
      setBayError('Set a centre and direction.');
      return;
    }
    const zone = bayZone(nextId('bay', takenIds(project)), { x: fromUnit(x, 'm'), y: fromUnit(y, 'm') }, type, direction);
    dispatch({ type: 'command', command: { type: 'space.set', space: { ...project.space, zones: [...(project.space.zones ?? []), zone] } } });
    setBayError('');
  };
  return (
    <div className="depot-panel" data-testid="depot-panel">
      <div className="kicker">Parking bays</div>
      <div className="depot-big" data-testid="depot-bays">{formatCount(metrics.bays)} <small>bays</small></div>
      <div className="facts">
        <div className="fact"><span>Occupied</span><span>{formatCount(metrics.occupiedBays)}</span></div>
        <div className="fact"><span>Usable (empty, reachable)</span><span>{formatCount(metrics.usableBays)}</span></div>
        <div className="fact"><span>Vehicles</span><span>{formatCount(metrics.vehicles)}</span></div>
        <div className="fact"><span>Floor area</span><span>{metrics.floorArea.toFixed(1)} m²</span></div>
      </div>
      <div className="kicker" style={{ marginTop: 24 }}>Bay entry check</div>
      <p className="sub">{DEFAULT_VEHICLE.name}. Turning radius {(DEFAULT_VEHICLE.minTurningRadius / 10_000).toFixed(1)} m.</p>
      <label className="stack">Bay
        <select className="input" aria-label="Bay to check" value={bay} onChange={(e) => setBay(e.target.value)}>
          {bays.map((b) => <option key={b.id} value={b.id}>{b.id}</option>)}
        </select>
      </label>
      <button className="btn primary" type="button" disabled={!bay} onClick={() => onCheck(bay)} style={{ marginTop: 16 }}>Show entry path</button>
      {entry && (
        <p className="depot-entry" role="status">
          {entry.clear ? 'Clear — the swept body stays on the floor' : `Not clear · ${(entry.reason ?? 'blocked').replace(/-/g, ' ')}`}
        </p>
      )}
      <p className="hint">Path is a minimum-turning-radius curve sampled every 20 cm; it is a planning estimate, not a site approval.</p>
      <div className="kicker" style={{ marginTop: 28 }}>Add a bay</div>
      <select className="input" aria-label="Bay type" value={type} onChange={(e) => setType(e.target.value as BayType)}>{BAY_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}</select>
      <div className="warehouse-zone-fields">
        <label>x (m)<input className="input" type="number" step="0.1" aria-label="Bay x" value={pos.x} onChange={(e) => setPos({ ...pos, x: Number(e.target.value) })} /></label>
        <label>y (m)<input className="input" type="number" step="0.1" aria-label="Bay y" value={pos.y} onChange={(e) => setPos({ ...pos, y: Number(e.target.value) })} /></label>
        <label>direction (°)<input className="input" type="number" step="15" aria-label="Bay direction" value={pos.direction} onChange={(e) => setPos({ ...pos, direction: Number(e.target.value) })} /></label>
      </div>
      <button className="btn" type="button" onClick={addBay} style={{ marginTop: 12 }}>Add bay</button>
      {bayError && <p className="error-text" role="alert">{bayError}</p>}
    </div>
  );
}
