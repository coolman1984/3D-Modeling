import type { Project } from '@space-planner/core';
import { DEFAULT_SERVER, restaurantMetrics, tableFamilyOf, type RouteResult } from '@space-planner/starter';
import { useEffect, useState } from 'react';
import { formatCount } from '../logic/format.js';

/** Restaurant controls in the Atrium left rail: metrics and a service-route check to a table. */
export function RestaurantPanel({ project, route, onRoute }: {
  project: Project;
  route: RouteResult | null;
  onRoute: (doorId: string, tableId: string) => void;
}) {
  const passes = project.space.doors.filter((d) => d.meta?.role === 'pass');
  const tables = Object.values(project.items).filter((i) => tableFamilyOf(project.catalog[i.definitionId]));
  const [pass, setPass] = useState(passes[0]?.id ?? '');
  const [table, setTable] = useState(tables[0]?.id ?? '');
  useEffect(() => { if (!passes.some((d) => d.id === pass)) setPass(passes[0]?.id ?? ''); }, [passes.map((d) => d.id).join(',')]);
  useEffect(() => { if (!tables.some((t) => t.id === table)) setTable(tables[0]?.id ?? ''); }, [tables.map((t) => t.id).join(',')]);
  const metrics = restaurantMetrics(project);
  return (
    <div className="restaurant-panel" data-testid="restaurant-panel">
      <div className="kicker">Covers</div>
      <div className="restaurant-big" data-testid="restaurant-covers">{formatCount(metrics.covers)} <small>covers</small></div>
      <div className="facts">
        <div className="fact"><span>Tables</span><span>{formatCount(metrics.tables)}</span></div>
        <div className="fact"><span>Floor per cover</span><span>{metrics.floorPerCover.toFixed(2)} m²</span></div>
        <div className="fact"><span>Reachable tables</span><span>{metrics.reachableTables} of {metrics.totalTables}</span></div>
        <div className="fact"><span>Dining · bar · terrace · private</span><span>{metrics.zoneArea.dining.toFixed(1)} · {metrics.zoneArea.bar.toFixed(1)} · {metrics.zoneArea.terrace.toFixed(1)} · {metrics.zoneArea.private.toFixed(1)} m²</span></div>
      </div>
      <div className="kicker" style={{ marginTop: 24 }}>Service route</div>
      <p className="sub">{DEFAULT_SERVER.name}. Select the kitchen pass and a table.</p>
      <label className="stack">From pass
        <select className="input" aria-label="Route from pass" value={pass} onChange={(e) => setPass(e.target.value)}>
          {passes.map((d) => <option key={d.id} value={d.id}>{d.id}</option>)}
        </select>
      </label>
      <label className="stack" style={{ marginTop: 12 }}>To table
        <select className="input" aria-label="Route to table" value={table} onChange={(e) => setTable(e.target.value)}>
          {tables.map((t) => <option key={t.id} value={t.id}>{t.id}</option>)}
        </select>
      </label>
      <button className="btn primary" type="button" disabled={!pass || !table} onClick={() => onRoute(pass, table)} style={{ marginTop: 16 }}>Show route</button>
      {route && <p className="restaurant-route" role="status">{route.reachable ? `${(route.distance / 10_000).toFixed(1)} m · reachable` : `Route unavailable · ${route.reason.replace(/-/g, ' ')}`}</p>}
      <p className="hint">Distance uses a 20 cm planning grid. Table families and covers are set by the item type.</p>
    </div>
  );
}
