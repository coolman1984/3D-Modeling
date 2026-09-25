import type { Project } from '@space-planner/core';
import { flowOrder, productionMetrics, stationKindOf } from '@space-planner/starter';
import type { Action } from '../logic/session.js';

/** Production-line controls in the Atrium left rail. The flow route is derived, never saved. */
export function ProductionPanel({ project, dispatch }: { project: Project; dispatch: (action: Action) => void }) {
  const metrics = productionMetrics(project);
  const order = flowOrder(project);
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
