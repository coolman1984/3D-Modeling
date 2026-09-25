import type { Id, ItemInstance, Project, Vec2 } from '@space-planner/core';
import { crossings, factoryMetrics, flowsOf, lineSimulator, maintenanceZone, nextOf, stationOf, stationsOf, withNext, type Station } from '@space-planner/starter';
import { ArrowRight, Play, X } from '@phosphor-icons/react';
import { useMemo, useState } from 'react';
import { formatCount, formatLength, formatPercent } from '../logic/format.js';
import type { Action } from '../logic/session.js';
import { NumberField } from './Fields.js';

const KIND_LABEL = { source: 'Source', machine: 'Machine', buffer: 'Buffer', conveyor: 'Conveyor', sink: 'Sink' } as const;
const seconds = (ms: number | undefined) => (ms === undefined ? 'Not set' : `${Math.round(ms / 100) / 10} s`);

/** Stations in flow order: sources first, then breadth-first along the flows; the rest after. */
function flowOrder(stations: readonly Station[]): Station[] {
  const byId = new Map(stations.map((s) => [s.item.id, s]));
  const seen = new Set<Id>();
  const order: Station[] = [];
  const queue = stations.filter((s) => s.data.kind === 'source');
  while (queue.length) {
    const s = queue.shift()!;
    if (seen.has(s.item.id)) continue;
    seen.add(s.item.id);
    order.push(s);
    for (const id of nextOf(s.item)) {
      const n = byId.get(id);
      if (n && !seen.has(id)) queue.push(n);
    }
  }
  return [...order, ...stations.filter((s) => !seen.has(s.item.id))];
}

/**
 * The line panel: stations in flow order with their cycle times, and a simulation of a shift from
 * those cycle times. The simulation is derived and never saved; it runs again when the plan changes.
 */
export function LinePanel({ project, onSelect }: { project: Project; onSelect: (id: Id) => void }) {
  const stations = useMemo(() => flowOrder(stationsOf(project)), [project]);
  const f = useMemo(() => factoryMetrics(project, 'cart'), [project]);
  const [hours, setHours] = useState<number | undefined>(8);
  const [asked, setAsked] = useState<number | null>(null);
  const result = useMemo(() => (asked === null ? null : lineSimulator.run(project, { hours: asked })), [project, asked]);
  return (
    <div className="panel-scroll panel-pad" data-testid="line-panel">
      <div className="load-stats">
        <div className="stat">
          <div className="stat-value" data-testid="station-count">{formatCount(stations.length)}</div>
          <div className="stat-label">Stations</div>
        </div>
        <div className="stat">
          <div className="stat-value nowrap">{(f.straightLength / 10_000).toFixed(1)} m</div>
          <div className="stat-label">Flow length</div>
        </div>
        <div className="stat">
          <div className="stat-value" data-testid="crossings" style={f.crossings ? { color: 'var(--error)' } : undefined}>
            {formatCount(f.crossings)}
          </div>
          <div className="stat-label">Crossings</div>
        </div>
      </div>

      <div className="section-gap" />
      <div className="section-title">
        <span className="kicker">Stations in flow order</span>
      </div>
      {stations.length === 0 && <p className="muted">Add stations from the library, then connect them in the inspector.</p>}
      {stations.map((s) => (
        <button key={s.item.id} type="button" className="station-row" data-station={s.item.id} onClick={() => onSelect(s.item.id)}>
          <span className={`station-kind ${s.data.kind}`}>{KIND_LABEL[s.data.kind]}</span>
          <span className="station-name">
            {s.definition.name}
            <span className="faint"> · {s.item.id}</span>
          </span>
          <span className="faint num">{s.data.kind === 'buffer' ? `${s.data.capacity ?? '?'} parts` : s.data.kind === 'sink' ? '' : seconds(s.data.cycle)}</span>
          <span className="station-next faint">{nextOf(s.item).length ? `→ ${nextOf(s.item).join(', ')}` : s.data.kind === 'sink' ? '' : 'no flow'}</span>
        </button>
      ))}

      <div className="section-gap" />
      <div className="section-title">
        <span className="kicker">Simulate</span>
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        <NumberField label="Hours" wideKey ariaLabel="Hours to simulate" value={hours} unit="h" min={0.1} max={744} onChange={setHours} />
        <button type="button" className="btn primary" disabled={hours === undefined} onClick={() => setAsked(hours ?? 8)} data-testid="simulate">
          <Play size={14} />
          Run
        </button>
      </div>
      <p className="muted" style={{ fontSize: 12, marginTop: 8 }}>
        From the cycle times on each station type. Moving parts between stations takes no time unless a conveyor is placed between them.
      </p>
      {result && !result.ok && (
        <p className="error-text" data-testid="sim-problem">
          Cannot simulate: {result.problem === 'missing-cycle' ? 'no cycle time for' : result.problem === 'missing-capacity' ? 'no capacity for' : result.problem === 'unknown-next' ? 'a flow goes to a missing station from' : result.problem === 'no-source' ? 'there is no source' : 'there is no sink'} {result.ids.join(', ')}.
        </p>
      )}
      {result && result.ok && (
        <div className="sim-result" data-testid="sim-result">
          <div className="fact">
            <span>Parts made</span>
            <span data-testid="sim-produced">{formatCount(result.produced)}</span>
          </div>
          <div className="fact">
            <span>Per hour</span>
            <span data-testid="sim-rate">{(Math.round(result.perHour * 10) / 10).toFixed(1)}</span>
          </div>
          <div className="fact">
            <span>Work in progress</span>
            <span>{(Math.round(result.wipAverage * 10) / 10).toFixed(1)} parts on average</span>
          </div>
          <div className="fact">
            <span>Bottleneck</span>
            <span data-testid="sim-bottleneck">{result.bottleneck ?? '—'}</span>
          </div>
          <div className="sim-legend">
            <span><i className="busy" />Busy</span>
            <span><i className="blocked" />Blocked</span>
            <span><i className="starved" />Waiting for parts</span>
          </div>
          {[...result.stations].filter(([id]) => stationOf(project.catalog[project.items[id]?.definitionId ?? '']!)?.kind === 'machine').map(([id, st]) => (
            <div key={id} className="sim-row" data-sim-station={id}>
              <span className="num">{id}</span>
              <span className="sim-bar" title={`Busy ${formatPercent(st.busy)} · blocked ${formatPercent(st.blocked)} · waiting ${formatPercent(st.starved)}`}>
                <span className="busy" style={{ width: `${st.busy * 100}%` }} />
                <span className="blocked" style={{ width: `${st.blocked * 100}%` }} />
                <span className="starved" style={{ width: `${st.starved * 100}%` }} />
              </span>
              <span className="faint num">{formatPercent(st.busy)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** The flow section of the inspector for one station: where its parts go, and its data. */
export function FlowGroup({ project, item, dispatch }: { project: Project; item: ItemInstance; dispatch: (a: Action) => void }) {
  const data = stationOf(project.catalog[item.definitionId])!;
  const next = nextOf(item);
  const others = stationsOf(project).filter((s) => s.item.id !== item.id && s.data.kind !== 'source' && !next.includes(s.item.id));
  const set = (ids: Id[]) => dispatch({ type: 'command', command: { type: 'item.meta', id: item.id, meta: withNext(item, ids) } });
  return (
    <div className="insp-group" aria-label="Flow">
      <div className="kicker">{KIND_LABEL[data.kind]}</div>
      {data.kind !== 'sink' && (
        <>
          <div className="muted" style={{ fontSize: 12, margin: '4px 0 6px' }}>
            Sends parts to
          </div>
          {next.length === 0 && <p className="muted">Nowhere yet.</p>}
          {next.map((id) => (
            <div key={id} className="flow-chip" data-next={id}>
              <ArrowRight size={13} />
              <span>{project.items[id] ? `${project.catalog[project.items[id].definitionId]?.name ?? id} · ${id}` : `${id} (missing)`}</span>
              <button type="button" className="btn ghost icon" style={{ width: 24, height: 24 }} aria-label={`Stop sending to ${id}`} onClick={() => set(next.filter((n) => n !== id))}>
                <X size={12} />
              </button>
            </div>
          ))}
          {others.length > 0 && (
            <select className="input" aria-label="Send parts to" value="" onChange={(e) => e.target.value && set([...next, e.target.value])} style={{ marginTop: 6 }}>
              <option value="">Add a station…</option>
              {others.map((s) => (
                <option key={s.item.id} value={s.item.id}>
                  {s.definition.name} · {s.item.id}
                </option>
              ))}
            </select>
          )}
        </>
      )}
      <div className="facts" style={{ padding: '8px 0 0' }}>
        {data.kind !== 'buffer' && data.kind !== 'sink' && (
          <div className="fact">
            <span>{data.kind === 'source' ? 'Releases a part every' : data.kind === 'conveyor' ? 'Transit time' : 'Cycle time'}</span>
            <span data-testid="station-cycle">{seconds(data.cycle)}</span>
          </div>
        )}
        {(data.kind === 'buffer' || data.kind === 'conveyor') && (
          <div className="fact">
            <span>Holds</span>
            <span>{data.capacity === undefined ? 'Not set' : `${data.capacity} parts`}</span>
          </div>
        )}
        <div className="fact">
          <span>Maintenance space</span>
          <span>{data.maintenance ? `${formatLength(data.maintenance.back)} behind · ${formatLength(data.maintenance.left)} / ${formatLength(data.maintenance.right)} sides` : 'Not stated'}</span>
        </div>
      </div>
      <p className="hint">Parts enter at the {data.inSide} and leave at the {data.outSide}. Cycle times are set on the station type.</p>
    </div>
  );
}

/** Flows as arrows and maintenance zones as outlines, for the plan. */
export function lineOverlay(project: Project): { arrows: Array<{ from: Vec2; to: Vec2; crossing: boolean; key: string }>; outlines: Array<{ key: string; polygon: readonly Vec2[] }> } {
  const stations = stationsOf(project);
  const flows = flowsOf(project, stations);
  const crossed = new Set(crossings(flows).flatMap(([a, b]) => [a, b]));
  return {
    arrows: flows.map((f) => ({ from: f.start, to: f.end, crossing: crossed.has(f), key: `${f.from.item.id}>${f.to.item.id}` })),
    outlines: stations.flatMap((s) => {
      const z = maintenanceZone(s);
      return z ? [{ key: s.item.id, polygon: z }] : [];
    }),
  };
}

/** Facts about a line for the inspector when nothing is selected. */
export function factoryFacts(project: Project): Array<[string, string]> {
  const f = factoryMetrics(project, 'cart');
  const shift = lineSimulator.run(project, { hours: 8 });
  return [
    ['Stations', `${formatCount(f.stations.machine)} machines · ${formatCount(f.stations.buffer + f.stations.conveyor)} buffers and conveyors`],
    ['Sources · sinks', `${formatCount(f.stations.source)} · ${formatCount(f.stations.sink)}`],
    ['Flows', `${formatCount(f.flows)} · ${formatLength(f.straightLength)}`],
    ['Flow crossings', formatCount(f.crossings)],
    ['Floor used by stations', formatPercent(f.floorShare)],
    ['One shift (simulated)', shift.ok ? `${formatCount(shift.produced)} parts · ${(Math.round(shift.perHour * 10) / 10).toFixed(1)} per hour` : 'Needs cycle times and flows'],
  ];
}
