import type { Project } from '@space-planner/core';
import { flowOrder, productionMetrics, simulateProduction, stationKindOf } from '@space-planner/starter';
import { useState } from 'react';
import type { Action } from '../logic/session.js';

/** Production-line controls in the Atrium left rail. The flow route is derived, never saved. */
export function ProductionPanel({ project, dispatch }: { project: Project; dispatch: (action: Action) => void }) {
  const metrics = productionMetrics(project);
  const order = flowOrder(project);
  const [hours, setHours] = useState(8);
  const simulation = simulateProduction(project, hours);
  const unstepped = Object.values(project.items).filter((i) => stationKindOf(project.catalog[i.definitionId]) && !order.some((o) => o.id === i.id));
  return (
    <div className="production-panel" data-testid="production-panel">
      <div className="kicker">Flow length</div>
      <div className="production-big" data-testid="production-flow-length">{(metrics.flowLength / 10_000).toFixed(1)} <small>m</small></div>
      <div className="facts">
        <div className="fact"><span>Stations</span><span>{metrics.stations}</span></div>
        <div className="fact"><span>Machines</span><span>{metrics.machines}</span></div>
        <div className="fact"><span>Buffers · capacity</span><span>{metrics.buffers} · {metrics.bufferCapacity}</span></div>
        <div className="fact"><span>Segments reachable</span><span>{metrics.reachableSegments} of {metrics.totalSegments}</span></div>
        <div className="fact"><span>Floor area</span><span>{metrics.floorArea.toFixed(1)} m²</span></div>
      </div>
      <p className="hint">Add stations from the Library panel, then set each one's flow order in its Properties. Distance uses a 20 cm planning grid for a 1.0 m material handler.</p>

      <div className="kicker" style={{ marginTop: 24 }}>Operational simulation</div>
      <label className="stack" style={{ maxWidth: 180 }}>
        Horizon
        <span className="input-unit">
          <input
            className="input"
            type="number"
            aria-label="Simulation hours"
            min="0.1"
            max="744"
            step="0.5"
            value={hours}
            onChange={(e) => {
              const value = Number(e.target.value);
              if (Number.isFinite(value) && value > 0 && value <= 744) setHours(value);
            }}
          />
          <span>hours</span>
        </span>
      </label>
      {simulation.ok ? (
        <>
          <div className="production-big" data-testid="production-throughput" style={{ marginTop: 12 }}>
            {simulation.perHour.toFixed(1)} <small>parts / hour</small>
          </div>
          <div className="facts">
            <div className="fact"><span>Finished</span><span>{simulation.produced}</span></div>
            <div className="fact"><span>Average WIP</span><span>{simulation.wipAverage.toFixed(1)}</span></div>
            <div className="fact"><span>WIP at end</span><span>{simulation.wipEnd}</span></div>
            <div className="fact"><span>Bottleneck</span><span>{simulation.bottleneck ?? '—'}</span></div>
          </div>
          <div className="kicker" style={{ marginTop: 16 }}>Station states</div>
          {[...simulation.stations.entries()].map(([id, stats]) => (
            <div className="fact" key={id} data-simulation-station={id}>
              <span>{project.catalog[project.items[id]?.definitionId ?? '']?.name ?? id}</span>
              <span>{(stats.busy * 100).toFixed(0)}% busy · {(stats.blocked * 100).toFixed(0)}% blocked · {(stats.starved * 100).toFixed(0)}% waiting</span>
            </div>
          ))}
        </>
      ) : (
        <p className="hint" data-testid="production-simulation-missing">
          Simulation needs complete process data: {simulation.problem.replace(/-/g, ' ')}{simulation.ids.length ? ` · ${simulation.ids.join(', ')}` : ''}.
        </p>
      )}
      <p className="hint">Throughput uses only cycle times and buffer capacities entered on station types. Layout distance is never converted into processing time.</p>

      <div className="kicker" style={{ marginTop: 24 }}>Flow order</div>
      {order.length === 0 && <p className="hint">No stations have a flow order yet.</p>}
      {order.map((item, i) => (
        <div className="fact" key={item.id} data-flow-row={item.id}>
          <span>{i + 1}. {project.catalog[item.definitionId]?.name ?? item.id}</span>
          <span style={{ textTransform: 'capitalize' }}>{stationKindOf(project.catalog[item.definitionId])}</span>
        </div>
      ))}
      {unstepped.length > 0 && (
        <>
          <div className="kicker" style={{ marginTop: 20 }}>Not in the flow yet</div>
          {unstepped.map((item) => (
            <div className="fact" key={item.id}>
              <span>{project.catalog[item.definitionId]?.name ?? item.id}</span>
              <button type="button" className="btn ghost" onClick={() => dispatch({ type: 'command', command: { type: 'item.meta', id: item.id, meta: { ...item.meta, step: order.length + 1 } }, select: [item.id] })}>
                Add to end
              </button>
            </div>
          ))}
        </>
      )}
    </div>
  );
}
