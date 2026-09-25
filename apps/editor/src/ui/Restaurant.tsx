import type { Project } from '@space-planner/core';
import { DINING_ZONES, restaurantLayouts, restaurantMetrics, tablesOf, type Candidate } from '@space-planner/starter';
import { Sparkle } from '@phosphor-icons/react';
import { useEffect, useMemo, useState } from 'react';
import { formatCount, formatLength } from '../logic/format.js';
import type { Action } from '../logic/session.js';
import { ZonesSection } from './Zones.js';

const ZONE_LABEL: Readonly<Record<string, string>> = { dining: 'Dining', bar: 'Bar', terrace: 'Terrace', private: 'Private' };

/**
 * The dining panel: covers and service at a glance, table layouts to compare and apply (proposed,
 * never applied by themselves), and the dining zones.
 */
export function DiningPanel({ project, style, dispatch }: { project: Project; style: string; dispatch: (a: Action) => void }) {
  const r = useMemo(() => restaurantMetrics(project, style), [project, style]);
  const families = Object.values(project.catalog).filter((d) => (d.seats ?? 0) > 0);
  const [familyId, setFamilyId] = useState(families.find((d) => d.id === 'table-4')?.id ?? families[0]?.id ?? '');
  const [candidates, setCandidates] = useState<readonly Candidate[] | null>(null);
  // Proposals made for an older plan are not offered any more.
  useEffect(() => setCandidates(null), [project.revision]);
  return (
    <div className="panel-scroll panel-pad" data-testid="dining-panel">
      <div className="load-stats">
        <div className="stat">
          <div className="stat-value" data-testid="covers">
            {formatCount(r.covers)}
          </div>
          <div className="stat-label">Covers</div>
        </div>
        <div className="stat">
          <div className="stat-value">{r.floorPerCover === undefined ? '—' : r.floorPerCover.toFixed(2)}</div>
          <div className="stat-label">m² per cover</div>
        </div>
        <div className="stat">
          <div className="stat-value nowrap">{r.serviceMax === undefined ? '—' : `${(r.serviceMax / 10_000).toFixed(1)} m`}</div>
          <div className="stat-label">Longest walk</div>
        </div>
      </div>
      <div className="fact">
        <span>Tables</span>
        <span data-testid="table-count">{formatCount(r.tables)}</span>
      </div>
      <div className="fact">
        <span>Walk from the pass</span>
        <span>{r.serviceAverage === undefined ? '—' : `${formatLength(r.serviceAverage)} avg`}</span>
      </div>
      <div className="fact">
        <span>Tables a server cannot reach</span>
        <span data-testid="unreachable" style={r.unreachable ? { color: 'var(--error)' } : undefined}>
          {formatCount(r.unreachable)}
        </span>
      </div>

      <div className="section-gap" />
      <div className="section-title">
        <span className="kicker">Table layouts</span>
      </div>
      <select className="input" aria-label="Table family" value={familyId} onChange={(e) => setFamilyId(e.target.value)}>
        {families.map((d) => (
          <option key={d.id} value={d.id}>
            {d.name} · {d.seats} seats
          </option>
        ))}
      </select>
      <button type="button" className="btn primary" style={{ width: '100%', marginTop: 8 }} disabled={!familyId} onClick={() => setCandidates(restaurantLayouts.propose(project, { familyId, style }))} data-testid="propose-layouts">
        <Sparkle size={15} />
        Propose layouts for the dining zone
      </button>
      <p className="muted" style={{ fontSize: 12, marginTop: 8 }}>
        Rows of one table family with the service aisle between them: most covers, balanced and spacious. Tables no server can reach are left out. You choose.
      </p>
      {candidates?.map((c, i) => (
        <div key={c.label} className="candidate" data-candidate={i}>
          <div className="candidate-head">
            <span className="serif">{c.label}</span>
          </div>
          <div className="candidate-stats">
            <span>
              <strong>{formatCount(c.metrics.tables ?? 0)}</strong> tables
            </span>
            <span>
              <strong>{formatCount(c.metrics.covers ?? 0)}</strong> covers
            </span>
            <span>
              <strong>{Math.round((c.metrics.aisle ?? 0) / 100)} cm</strong> aisles
            </span>
          </div>
          <p className="muted" style={{ fontSize: 12 }}>
            {c.explanation}
          </p>
          <button
            type="button"
            className="btn small"
            disabled={c.commands.length === 0}
            onClick={() => {
              dispatch({ type: 'command', command: { type: 'batch', commands: c.commands } });
              setCandidates(null);
            }}
          >
            Apply this layout
          </button>
        </div>
      ))}

      <div className="section-gap" />
      <ZonesSection project={project} dispatch={dispatch} kinds={DINING_ZONES.map((k) => ({ id: k, label: ZONE_LABEL[k] ?? k }))} initialKind="terrace" hint="Floor per cover counts the dining, bar, terrace and private zones." />
      {tablesOf(project).length === 0 && <p className="muted" style={{ fontSize: 12 }}>Add tables from the library or propose a layout.</p>}
    </div>
  );
}

/** Facts about a restaurant for the inspector when nothing is selected. */
export function restaurantFacts(project: Project, style: string): Array<[string, string]> {
  const r = restaurantMetrics(project, style);
  return [
    ['Covers', `${formatCount(r.covers)} at ${formatCount(r.tables)} tables`],
    ['Guest floor', `${r.guestFloor.toFixed(1)} m²${r.floorPerCover === undefined ? '' : ` · ${r.floorPerCover.toFixed(2)} m² per cover`}`],
    ['By zone', Object.entries(r.coversByZone).map(([k, n]) => `${n} ${k}`).join(' · ') || '—'],
    ['Walk from the pass', r.serviceAverage === undefined ? '—' : `${formatLength(r.serviceAverage)} average · ${formatLength(r.serviceMax ?? 0)} longest`],
    ['Tables a server cannot reach', formatCount(r.unreachable)],
  ];
}
