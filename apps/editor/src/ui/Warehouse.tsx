import { boundsOf, fromUnit, type Project } from '@space-planner/core';
import { DEFAULT_FORKLIFT, WAREHOUSE_ZONE_KINDS, warehouseMetrics, type RouteResult } from '@space-planner/starter';
import { useEffect, useState } from 'react';
import { formatCount } from '../logic/format.js';
import { nextId } from '../logic/ids.js';
import type { Action } from '../logic/session.js';
import { takenIds } from '../logic/transform.js';

/** Warehouse controls in the existing Atrium left rail. Routes are derived, never saved. */
export function WarehousePanel({ project, route, onRoute, onAddRack, dispatch }: {
  project: Project;
  route: RouteResult | null;
  onRoute: (dockId: string, rackId: string) => void;
  onAddRack: () => void;
  dispatch: (action: Action) => void;
}) {
  const docks = project.space.doors;
  const racks = Object.values(project.items).filter((i) => project.catalog[i.definitionId]?.category === 'rack');
  const [dock, setDock] = useState(docks[0]?.id ?? '');
  const [rack, setRack] = useState(racks[0]?.id ?? '');
  const [kind, setKind] = useState<(typeof WAREHOUSE_ZONE_KINDS)[number]>('staging');
  const [box, setBox] = useState({ x: 1, y: 1, width: 3, depth: 2 });
  const [zoneError, setZoneError] = useState('');
  useEffect(() => { if (!racks.some((r) => r.id === rack)) setRack(racks[0]?.id ?? ''); }, [racks.map((r) => r.id).join(',')]);
  const metrics = warehouseMetrics(project);
  const addZone = () => {
    const room = boundsOf(project.space.boundary);
    const { x, y, width, depth } = box;
    if (![x, y, width, depth].every(Number.isFinite) || width <= 0 || depth <= 0 || fromUnit(x, 'm') < room.minX || fromUnit(y, 'm') < room.minY || fromUnit(x + width, 'm') > room.maxX || fromUnit(y + depth, 'm') > room.maxY) {
      setZoneError('Set a positive rectangle inside the warehouse.');
      return;
    }
    const x0 = fromUnit(x, 'm'), y0 = fromUnit(y, 'm'), x1 = fromUnit(x + width, 'm'), y1 = fromUnit(y + depth, 'm');
    const zone = { id: nextId(kind, takenIds(project)), kind, polygon: [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }] };
    dispatch({ type: 'command', command: { type: 'space.set', space: { ...project.space, zones: [...(project.space.zones ?? []), zone] } } });
    setZoneError('');
  };
  return (
    <div className="warehouse-panel" data-testid="warehouse-panel">
      <div className="kicker">Storage capacity</div>
      <div className="warehouse-big" data-testid="warehouse-capacity">{formatCount(metrics.positions)} <small>pallet positions</small></div>
      <div className="facts">
        <div className="fact"><span>Usable</span><span>{formatCount(metrics.usablePositions)}</span></div>
        <div className="fact"><span>Rack rows · bays</span><span>{metrics.rackRows} · {metrics.bays}</span></div>
        <div className="fact"><span>Rack footprint</span><span>{metrics.rackArea.toFixed(1)} m²</span></div>
        <div className="fact"><span>Floor use by racks</span><span>{(metrics.floorUtilization * 100).toFixed(1)}%</span></div>
        <div className="fact"><span>Staging · aisles</span><span>{metrics.stagingArea.toFixed(1)} · {metrics.aisleArea.toFixed(1)} m²</span></div>
        <div className="fact"><span>Docks</span><span>{metrics.docks}</span></div>
      </div>
      <button className="btn" type="button" onClick={onAddRack} style={{ margin: '18px 0 24px' }}>Add rack row</button>
      <div className="kicker">Forklift route</div>
      <p className="sub">{DEFAULT_FORKLIFT.name}. Select a dock and a rack row.</p>
      <label className="stack">From dock
        <select className="input" aria-label="Route from dock" value={dock} onChange={(e) => setDock(e.target.value)}>
          {docks.map((d) => <option key={d.id} value={d.id}>{d.id}</option>)}
        </select>
      </label>
      <label className="stack" style={{ marginTop: 12 }}>To rack row
        <select className="input" aria-label="Route to rack" value={rack} onChange={(e) => setRack(e.target.value)}>
          {racks.map((r) => <option key={r.id} value={r.id}>{r.id}</option>)}
        </select>
      </label>
      <button className="btn primary" type="button" disabled={!dock || !rack} onClick={() => onRoute(dock, rack)} style={{ marginTop: 16 }}>Show route</button>
      {route && <p className="warehouse-route" role="status">{route.reachable ? `${(route.distance / 10_000).toFixed(1)} m · reachable` : `Route unavailable · ${route.reason.replace(/-/g, ' ')}`}</p>}
      <p className="hint">Distance uses a 20 cm planning grid. Check site clearances and turning space separately.</p>
      <div className="kicker" style={{ marginTop: 28 }}>Operational zones</div>
      {(project.space.zones ?? []).map((zone) => <div className="fact" key={zone.id} data-zone-row={zone.id}>
        <span>{zone.kind.replace(/-/g, ' ')} · {zone.id}</span>
        <button type="button" className="btn ghost" aria-label={`Remove zone ${zone.id}`} onClick={() => dispatch({ type: 'command', command: { type: 'space.set', space: { ...project.space, zones: project.space.zones?.filter((z) => z.id !== zone.id) ?? [] } } })}>Remove</button>
      </div>)}
      <div className="kicker" style={{ marginTop: 20 }}>Add a rectangular zone</div>
      <select className="input" aria-label="Zone type" value={kind} onChange={(e) => setKind(e.target.value as typeof kind)}>{WAREHOUSE_ZONE_KINDS.map((type) => <option key={type} value={type}>{type.replace(/-/g, ' ')}</option>)}</select>
      <div className="warehouse-zone-fields">{(['x', 'y', 'width', 'depth'] as const).map((field) => <label key={field}>{field} (m)<input className="input" type="number" step="0.1" aria-label={`Zone ${field}`} value={box[field]} onChange={(e) => setBox({ ...box, [field]: Number(e.target.value) })} /></label>)}</div>
      <button className="btn" type="button" onClick={addZone} style={{ marginTop: 12 }}>Add zone</button>
      {zoneError && <p className="error-text" role="alert">{zoneError}</p>}
    </div>
  );
}
