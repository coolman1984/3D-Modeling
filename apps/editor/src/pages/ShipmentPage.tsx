import type { Id, Project } from '@space-planner/core';
import { containerMetrics, containerType, shipmentOf, stepOf } from '@space-planner/starter';
import { ArrowLeft, ArrowRight, CheckCircle, FileText, Pause, Play, Question, Warning, XCircle } from '@phosphor-icons/react';
import { useEffect, useMemo, useState } from 'react';
import { api, subscribe } from '../api.js';
import { formatCount, formatMass, formatPercent, plural } from '../logic/format.js';
import { frameCount, stepsAt, type PlayMode } from '../logic/shipment.js';
import { CATEGORICAL, colorsOf, hex, hiddenAfter, type ColorLegend } from '../ui/Container.js';
import { Segmented } from '../ui/Fields.js';
import type { ReviewSummary } from '../ui/Inspector.js';
import { cardOf, SiteHeader } from '../ui/Site.js';
import { ShipmentView3D } from '../ui/View3D.js';

type ShipmentColor = 'type' | 'step' | 'weight';

const COLOR_HINT: Readonly<Record<ShipmentColor, string>> = {
  type: 'Each part has the same colour in every container.',
  step: 'The order pieces go in: pale first, dark last, in each container.',
  weight: 'Darker blue is heavier.',
};

/** Colour by part across the whole shipment, so a part keeps its colour from container to container. */
function typeColors(projects: readonly Project[]): { colors: ReadonlyMap<Id, number>[]; legend: ColorLegend['legend'] } {
  const types = [...new Set(projects.flatMap((p) => Object.keys(p.catalog)))].sort();
  const colorOf = (t: string) => CATEGORICAL[types.indexOf(t) % CATEGORICAL.length]!;
  const names = new Map(projects.flatMap((p) => Object.values(p.catalog).map((d) => [d.id, d.name] as const)));
  return {
    colors: projects.map((p) => new Map(Object.values(p.items).map((i) => [i.id, colorOf(i.definitionId)]))),
    legend: types.map((t) => ({ label: names.get(t) ?? t, color: colorOf(t) })),
  };
}

/**
 * A shipment: its containers side by side in one 3D view with one play button for the stuffing,
 * the figures of each container, and a way into each container's own editor and report.
 */
export function ShipmentPage({ shipmentId }: { shipmentId: string }) {
  const [projects, setProjects] = useState<Project[] | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [colorBy, setColorBy] = useState<ShipmentColor>('type');
  const [cutaway, setCutaway] = useState(true);
  const [mode, setMode] = useState<PlayMode>('together');
  const [frame, setFrame] = useState<number | null>(null);
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    let alive = true;
    let ids = new Set<string>();
    const load = () =>
      void api
        .listProjects()
        .then((list) => Promise.all(list.filter((p) => p.collection === `shipment:${shipmentId}`).map((p) => api.getProject(p.id))))
        .then((loaded) => {
          if (!alive) return;
          ids = new Set(loaded.map((p) => p.id));
          setProjects(loaded.sort((a, b) => (shipmentOf(a)?.index ?? 0) - (shipmentOf(b)?.index ?? 0)));
          setMessage(null);
        })
        .catch(() => alive && setMessage('The server is not running, so the shipment cannot be loaded.'));
    load();
    // Containers are large: reload only when one of this shipment's containers changes.
    const off = subscribe({ projects: load, project: (e) => ids.has(e.projectId) && load(), open: load });
    return () => {
      alive = false;
      off();
    };
  }, [shipmentId]);

  const list = useMemo(() => projects ?? [], [projects]);
  const steps = useMemo(() => list.map((p) => Object.values(p.items).reduce((m, i) => Math.max(m, stepOf(i) ?? 0), 0)), [list]);
  const frames = frameCount(steps, mode);
  // A whole playback lasts about 25 seconds however many layers there are.
  const tick = Math.max(40, Math.min(450, Math.round(25_000 / Math.max(1, frames))));
  useEffect(() => {
    if (!playing) return;
    const timer = setTimeout(
      () => {
        if (frame === null) setFrame(0);
        else if (frame >= frames) {
          setFrame(null);
          setPlaying(false);
        } else setFrame(frame + 1);
      },
      frame === null ? 0 : tick,
    );
    return () => clearTimeout(timer);
  }, [playing, frame, frames, tick]);

  const colouring = useMemo(() => {
    if (colorBy === 'type') return typeColors(list);
    const each = list.map((p) => colorsOf(p, colorBy));
    return { colors: each.map((c) => c.colors), legend: each[0]?.legend ?? [] };
  }, [list, colorBy]);
  const shown = stepsAt(steps, frame, mode);
  // Colours and cut-away rebuild the scene; the playback step only hides pieces, so it is kept apart.
  const looks = useMemo(() => list.map((_, i) => ({ itemColors: colouring.colors[i]!, cutaway })), [list, colouring, cutaway]);
  const hidden = useMemo(
    () => list.map((p, i) => hiddenAfter(p, shown[i] ?? null)),
    // `shown` is derived from frame, mode and steps.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [list, frame, mode, steps],
  );
  const cards = useMemo(() => list.map((p) => ({ project: p, metrics: containerMetrics(p) })), [list]);
  // The full checks take a second or so per loaded container: the page and the 3D view come first,
  // then one container's checks at a time.
  const [summaries, setSummaries] = useState<ReadonlyMap<string, ReviewSummary>>(new Map());
  useEffect(() => {
    let alive = true;
    let timer = 0;
    const done = new Map<string, ReviewSummary>();
    const next = (k: number) => {
      const p = list[k];
      if (!alive || !p) return;
      done.set(`${p.id}@${p.revision}`, cardOf(p).summary);
      setSummaries(new Map(done));
      timer = window.setTimeout(() => next(k + 1), 0);
    };
    timer = window.setTimeout(() => next(0), 300);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [list]);

  const first = list[0];
  const info = first ? shipmentOf(first) : undefined;
  const type = first ? containerType(String(first.space.meta?.containerType ?? '')) : undefined;
  const totals = new Map<string, { name: string; per: number[] }>();
  list.forEach((p, i) =>
    Object.values(p.items).forEach((item) => {
      const d = p.catalog[item.definitionId];
      const row = totals.get(item.definitionId) ?? { name: d?.name ?? item.definitionId, per: list.map(() => 0) };
      row.per[i]!++;
      totals.set(item.definitionId, row);
    }),
  );
  const pieces = cards.reduce((s, c) => s + c.metrics.pieces, 0);
  const playLabel =
    frame === null ? 'Fully loaded' : frame === 0 ? 'Empty' : mode === 'together' ? `Layer ${frame} of ${frames}` : `Layer ${frame} of ${frames} · container ${Math.min(list.length, 1 + shown.findIndex((s) => s !== null))}`;

  return (
    <div className="site">
      <SiteHeader active="projects" />
      <main className="site-main shipment-main">
        <a href="#/" className="back-link">
          <ArrowLeft size={14} />
          All projects
        </a>
        <div className="kicker" style={{ marginTop: 20 }}>
          Container shipment
        </div>
        <h1 className="page-title shipment-title" data-testid="shipment-title">
          {info?.name ?? 'Shipment'}
        </h1>
        {message && (
          <p className="error-text" role="alert">
            {message}
          </p>
        )}
        {projects !== null && list.length === 0 && !message && <p className="lede">This shipment has no containers any more.</p>}
        {list.length > 0 && (
          <>
            <p className="lede shipment-lede" data-testid="shipment-summary">
              <strong>{plural(list.length, 'container')}</strong> · {type?.label ?? 'custom container'} · {formatCount(pieces)} pieces, loaded wall by wall from the front wall to the doors.
            </p>

            <section className="shipment-stage" aria-label="Containers side by side">
              <ShipmentView3D projects={list} looks={looks} hidden={hidden} />
              <div className="container-tools shipment-tools" aria-label="Shipment view">
                <Segmented
                  label="Colour pieces by"
                  className="compact"
                  value={colorBy}
                  onChange={setColorBy}
                  options={[
                    { id: 'type', label: 'Part' },
                    { id: 'weight', label: 'Weight' },
                    { id: 'step', label: 'Load order' },
                  ]}
                />
                <p className="container-tools-hint">{COLOR_HINT[colorBy]}</p>
                <label className="check-inline">
                  <input type="checkbox" checked={cutaway} onChange={(e) => setCutaway(e.target.checked)} />
                  Cut away side walls
                </label>
                <Segmented
                  label="Play"
                  className="compact"
                  value={mode}
                  onChange={(m) => {
                    setMode(m);
                    setFrame(null);
                    setPlaying(false);
                  }}
                  options={[
                    { id: 'together', label: 'All together' },
                    { id: 'in-turn', label: 'One after another' },
                  ]}
                />
                {frames > 0 && (
                  <div className="sequence">
                    <button type="button" className="btn ghost icon" style={{ width: 28, height: 28 }} aria-label={playing ? 'Pause stuffing' : 'Play stuffing'} data-testid="play-shipment" onClick={() => setPlaying((p) => !p)}>
                      {playing ? <Pause size={14} /> : <Play size={14} />}
                    </button>
                    <input type="range" min={0} max={frames} value={frame ?? frames} aria-label="Stuffing layer" onChange={(e) => setFrame(Number(e.target.value) >= frames ? null : Number(e.target.value))} />
                  </div>
                )}
                <span className="num faint" data-testid="shipment-play-label">
                  {playLabel}
                </span>
                <div className="legend-row">
                  {colouring.legend.slice(0, 8).map((l) => (
                    <span key={l.label}>
                      <span className="swatch" style={{ background: hex(l.color) }} />
                      {l.label}
                    </span>
                  ))}
                </div>
              </div>
            </section>

            <div className="section-head">
              <h2 className="serif">Containers</h2>
            </div>
            <div className="shipment-cards">
              {cards.map(({ project, metrics }, i) => {
                const summary = summaries.get(`${project.id}@${project.revision}`);
                return (
                <article key={project.id} className="shipment-card" data-container={i + 1}>
                  <header>
                    <span className="shipment-no">{i + 1}</span>
                    <span className="serif">Container {i + 1}</span>
                    {summary ? (
                      <span className={`chip ${summary.errors ? 'error' : summary.warnings ? 'warning' : 'ok'}`} data-testid={`checks-${i + 1}`}>
                        {summary.errors ? <XCircle size={13} /> : summary.warnings ? <Warning size={13} /> : <CheckCircle size={13} />}
                        {summary.errors ? plural(summary.errors, 'error') : summary.warnings ? plural(summary.warnings, 'warning') : summary.unknown ? `No problems · ${plural(summary.unknown, 'check')} unknown` : 'All checks pass'}
                      </span>
                    ) : (
                      <span className="chip">
                        <Question size={13} />
                        Checking…
                      </span>
                    )}
                  </header>
                  <div className="load-stats">
                    <Stat label="Volume" value={formatPercent(metrics.volumeUse)} bar={metrics.volumeUse} />
                    <Stat label="Floor" value={formatPercent(metrics.floorUse)} bar={metrics.floorUse} />
                    <Stat label="Payload" value={metrics.payloadUse === undefined ? '—' : formatPercent(metrics.payloadUse)} bar={metrics.payloadUse ?? 0} />
                  </div>
                  <div className="facts" style={{ padding: 0 }}>
                    {Object.values(project.catalog).map((d) => (
                      <div className="fact" key={d.id}>
                        <span>{d.name}</span>
                        <span data-testid={`pieces-${i + 1}-${d.id}`}>{formatCount(Object.values(project.items).filter((it) => it.definitionId === d.id).length)}</span>
                      </div>
                    ))}
                    <div className="fact">
                      <span>Load mass</span>
                      <span>{metrics.mass === undefined ? 'Unknown' : formatMass(metrics.mass)}</span>
                    </div>
                    <div className="fact">
                      <span>Loading layers</span>
                      <span>{formatCount(metrics.steps)}</span>
                    </div>
                  </div>
                  <footer>
                    <a className="btn small" href={`#/p/${project.id}/report`}>
                      <FileText size={13} />
                      Report
                    </a>
                    <a className="btn small primary" href={`#/p/${project.id}`} data-testid={`open-container-${i + 1}`}>
                      Open in editor
                      <ArrowRight size={13} />
                    </a>
                  </footer>
                </article>
                );
              })}
            </div>

            <div className="section-head">
              <h2 className="serif">Pieces per container</h2>
            </div>
            <table className="shipment-table">
              <thead>
                <tr>
                  <th>Part</th>
                  {list.map((_, i) => (
                    <th key={i} className="num">
                      {i + 1}
                    </th>
                  ))}
                  <th className="num">Total</th>
                </tr>
              </thead>
              <tbody>
                {[...totals].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([id, row]) => (
                  <tr key={id}>
                    <td>{row.name}</td>
                    {row.per.map((n, i) => (
                      <td key={i} className="num">
                        {n ? formatCount(n) : '—'}
                      </td>
                    ))}
                    <td className="num">
                      <strong>{formatCount(row.per.reduce((s, n) => s + n, 0))}</strong>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
      </main>
    </div>
  );
}

function Stat({ label, value, bar }: { label: string; value: string; bar: number }) {
  return (
    <div className="stat">
      <div className="stat-value">{value}</div>
      <div className="stat-bar">
        <span style={{ width: `${Math.min(100, bar * 100)}%`, background: bar > 1 ? 'var(--error)' : 'var(--accent)' }} />
      </div>
      <div className="stat-label">{label}</div>
    </div>
  );
}
