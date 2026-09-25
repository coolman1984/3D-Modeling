import { checkProject, type Project } from '@space-planner/core';
import { containerMetrics, containerType, SHAPES, shapeOf, stepOf, stopOf } from '@space-planner/starter';
import { colorsOf } from '../ui/Container.js';
import { CaretLeft, Check, CheckCircle, Printer, Question, Warning, XCircle } from '@phosphor-icons/react';
import { useEffect, useMemo, useState } from 'react';
import { api } from '../api.js';
import { loadActivity } from '../logic/activity.js';
import { formatCentimetres, formatCount, formatLength, formatMass, formatMetres, formatPercent, formatSquareMetres, plural } from '../logic/format.js';
import { buildReport } from '../logic/report.js';
import { RULE_STATUS_WORD, SEVERITY_WORD, SOURCE_KIND_WORD } from '../logic/messages.js';
import { PlanDrawing } from '../ui/PlanDrawing.js';
import { renderSnapshot } from '../ui/View3D.js';

const VERDICT = {
  ready: { tone: 'ok', title: 'Ready to approve', text: 'Nothing overlaps, no door is blocked, nothing is outside the room, and every planning rule passes.' },
  check: { tone: 'warning', title: 'Check before approval', text: 'There are no errors, but some notes or planning rules need a look (page 4).' },
  problems: { tone: 'error', title: 'Needs attention', text: 'Some errors must be fixed before this plan is set up (page 4).' },
} as const;

const SHAPE_LABEL = new Map(SHAPES.map((s) => [s.key as string, s.label]));
const PAGES = 4;

function Foot({ name, revision, page }: { name: string; revision: number; page: number }) {
  return (
    <div className="sheet-foot">
      <span>
        {name} · Revision {revision}
      </span>
      <span>
        {page} / {PAGES}
      </span>
    </div>
  );
}

/**
 * The client report for one saved revision: cover, plan, 3D picture with the bill of materials,
 * and the rules and issues, laid out as A4 pages. Printing uses the browser (save as PDF works too).
 */
export function ReportPage({ projectId }: { projectId: string }) {
  const [project, setProject] = useState<Project | null>(null);
  const [missing, setMissing] = useState(false);
  const [picture, setPicture] = useState<string | null | 'pending'>('pending');
  const [showIssues, setShowIssues] = useState(true);
  useEffect(() => {
    api
      .getProject(projectId)
      .then(setProject)
      .catch(() => setMissing(true));
  }, [projectId]);
  const report = useMemo(() => (project ? buildReport(project, loadActivity(project)) : null), [project]);
  const issues = useMemo(() => (project ? checkProject(project) : []), [project]);
  useEffect(() => {
    if (!project) return;
    // Let the page paint first; drawing the 3D picture takes a moment on slow machines.
    const cargo = project.space.meta?.pack === 'container';
    const look = cargo ? { itemColors: colorsOf(project, 'stop').colors, cutaway: true } : undefined;
    const timer = setTimeout(() => setPicture(renderSnapshot(project, issues, 1200, 640, look, cargo)), 30);
    return () => clearTimeout(timer);
  }, [project, issues]);
  useEffect(() => {
    if (report) document.title = `Client report · ${report.name}`;
    return () => {
      document.title = 'Atrium';
    };
  }, [report]);

  if (missing) {
    return (
      <div className="site">
        <div className="center-empty">
          <div className="serif">This project does not exist</div>
          <p>It may have been deleted.</p>
          <a href="#/" className="btn">
            Back to projects
          </a>
        </div>
      </div>
    );
  }
  if (!project || !report) {
    return (
      <div className="report">
        <div className="center-empty muted">Preparing report…</div>
      </div>
    );
  }

  const today = new Intl.DateTimeFormat('en-GB', { dateStyle: 'long' }).format(new Date());
  const verdict = VERDICT[report.verdict];
  const doorWidth = project.space.doors.reduce((n, d) => n + d.width, 0);
  const problems = report.issues.filter((i) => i.severity !== 'info');
  const unknown = report.issues.filter((i) => i.severity === 'info');
  const roomSize = `${formatMetres(report.room.width)} × ${formatMetres(report.room.depth)} m`;
  const kicker = `${report.activity.label} · ${report.activity.styleLabel}`;
  const seatsLine = report.totals.seats > 0 ? `A plan for ${plural(report.totals.seats, 'seat')}` : 'A plan';
  const cargo = report.activity.pack === 'container';
  const load = cargo ? containerMetrics(project) : null;
  const box = cargo ? containerType(String(project.space.meta?.containerType ?? '')) : undefined;
  const sequence = cargo
    ? Object.values(project.items).sort((a, b) => (stepOf(a) ?? Infinity) - (stepOf(b) ?? Infinity) || (a.id < b.id ? -1 : 1))
    : [];
  return (
    <div className="report" data-testid="report">
      <nav className="report-bar">
        <a href={`#/p/${project.id}`}>
          <CaretLeft size={16} />
          Back to plan
        </a>
        <span style={{ color: '#c9c5bc' }}>/</span>
        <span style={{ fontWeight: 500 }}>Client report</span>
        <span className="muted" style={{ fontSize: 13 }}>
          · Revision {report.revision} · {PAGES} pages · A4
        </span>
        <span className="spacer" />
        <label className="check">
          <input type="checkbox" checked={showIssues} onChange={(e) => setShowIssues(e.target.checked)} />
          Include issues
        </label>
        <button type="button" className="btn primary" onClick={() => window.print()}>
          <Printer size={15} />
          Print or save PDF
        </button>
      </nav>

      <div className="sheets">
        <article className="sheet cover" aria-label="Cover">
          <div className="sheet-top">
            <span className="brand-mark" />
            <span className="brand-name">Atrium</span>
            <span className="date">Client report · {today}</span>
          </div>
          <div className="cover-kicker">{kicker}</div>
          <h1>{report.name}</h1>
          <p className="cover-lede">
            {cargo && load ? (
              <>
                A loading plan for {plural(load.pieces, 'piece')} in a {box?.label ?? 'custom container'} ({roomSize} inside), checked for fit, support, load on top, orientation, unloading order and balance.
              </>
            ) : (
              <>
            {seatsLine} in a {roomSize} room with {plural(report.room.doors, 'door')} and {plural(report.room.columns, 'column')}, checked item by item for fit, clearance and safe ways out.
              </>
            )}
          </p>
          <div className="info-grid">
            {[
              ['Room', roomSize],
              ['Ceiling', report.room.ceiling === undefined ? 'Not set' : `${formatMetres(report.room.ceiling)} m`],
              ['Revision', <span data-testid="report-revision">{formatCount(report.revision)}</span>],
              ['Floor area', formatSquareMetres(report.room.floorArea)],
              ['Doors', formatCount(report.room.doors)],
              ['Columns', formatCount(report.room.columns)],
            ].map(([k, v]) => (
              <div key={String(k)}>
                <div className="k">{k}</div>
                <div className="v">{v}</div>
              </div>
            ))}
          </div>
          <div className="contents">
            {[
              ['Plan', 'Layout seen from above', 2],
              ['3D view', 'The room in perspective', 3],
              ['Quantities', 'Bill of materials', 3],
              ['Rules & issues', 'What to check before approval', 4],
            ].map(([t, d, p]) => (
              <div key={String(t)}>
                <div className="t">{t}</div>
                <div className="d">{d}</div>
                <div className="p">Page {p}</div>
              </div>
            ))}
          </div>
          <span className="fill" />
          <div className="cover-status">
            <div>
              <div className="k">Overall status</div>
              <div className={`title ${verdict.tone}`} data-testid="report-verdict">
                {verdict.tone === 'ok' ? <CheckCircle size={22} /> : verdict.tone === 'warning' ? <Warning size={22} /> : <XCircle size={22} />}
                {verdict.title}
              </div>
              <div className="text">
                {verdict.text} {report.counts.error > 0 || report.counts.warning > 0 ? `${plural(report.counts.error, 'error')} · ${plural(report.counts.warning, 'warning')}.` : ''}
                {report.rules.some((r) => r.status === 'fail') ? ` ${plural(report.rules.filter((r) => r.status === 'fail').length, 'planning rule')} not met.` : ''}
              </div>
            </div>
            <div className="cover-metrics">
              {(cargo && load
                ? [
                    [<span data-testid="report-pieces">{formatCount(load.pieces)}</span>, 'Pieces'],
                    [load.mass === undefined ? '—' : formatMass(load.mass), 'Load mass'],
                    [formatPercent(load.volumeUse), 'Volume used'],
                    [load.payloadUse === undefined ? '—' : formatPercent(load.payloadUse), 'Payload used'],
                    [formatPercent(load.floorUse), 'Floor used'],
                    [load.balance ? `${Math.round(Math.max(load.balance.along, load.balance.across))}%` : '—', 'Off centre'],
                  ]
                : [
                [<span data-testid="report-seats">{formatCount(report.totals.seats)}</span>, 'Seats'],
                [formatCount(report.totals.items), 'Items'],
                [formatSquareMetres(Math.round(report.room.floorArea)), 'Floor area'],
                [report.totals.areaPerSeat === undefined ? '—' : formatSquareMetres(Math.round(report.totals.areaPerSeat * 100) / 100), 'Area per seat'],
                [formatCount(report.room.doors), 'Exits'],
                [formatLength(doorWidth), 'Door width'],
              ]).map(([v, k]) => (
                <div key={String(k)}>
                  <div className="v">{v}</div>
                  <div className="k">{k}</div>
                </div>
              ))}
            </div>
          </div>
          <div className="sheet-foot">
            <span>Prepared with Atrium · {today}</span>
            <span>1 / {PAGES}</span>
          </div>
        </article>

        <article className="sheet" aria-label="Plan">
          <div className="sheet-h">
            <h2>Plan</h2>
            <span>{roomSize} · north up</span>
          </div>
          <PlanDrawing project={project} issues={issues} keyOf={report.keyOf} width={900} height={620} />
          <div className="legend">
            <span>
              <span className="sw" style={{ background: 'var(--ink)' }} />
              Column
            </span>
            <span>
              <span className="sw" style={{ border: '1px solid var(--ink)', borderRadius: '0 100% 0 0', borderLeft: 0, borderBottom: 0 }} />
              Door swing
            </span>
            <span>
              <span className="sw" style={{ border: '1.2px dashed var(--error)' }} />
              Needs attention
            </span>
            <span>Numbers on items are their line in the bill of materials</span>
          </div>
          <span className="fill" />
          <div className="keyline">
            {[
              ['Seats', formatCount(report.totals.seats)],
              ['Items', formatCount(report.totals.items)],
              ['Occupied floor', `${formatSquareMetres(Math.round(report.totals.occupiedArea * 100) / 100)} · ${formatPercent(report.totals.occupancy)}`],
              ['Doors · columns', `${formatCount(report.room.doors)} · ${formatCount(report.room.columns)}`],
            ].map(([k, v]) => (
              <div key={k}>
                <div className="k">{k}</div>
                <div className="v">{v}</div>
              </div>
            ))}
          </div>
          <p className="muted" data-testid="report-room" style={{ marginTop: '4mm', fontSize: '9pt' }}>
            Room {roomSize}; {report.room.ceiling === undefined ? 'ceiling height not given' : `ceiling ${formatMetres(report.room.ceiling)} m`}; {plural(report.room.doors, 'door')}; {plural(report.room.columns, 'column')}.
          </p>
          <Foot name={report.name} revision={report.revision} page={2} />
        </article>

        <article className="sheet" aria-label="3D view and quantities">
          <div className="sheet-h">
            <h2>3D view</h2>
            <span>Perspective from the south · walls cut at 1.10 m</span>
          </div>
          {picture === 'pending' ? (
            <p className="muted" style={{ marginTop: '6mm' }}>
              Drawing the picture…
            </p>
          ) : picture ? (
            <img src={picture} alt="The room in 3D" className="report-picture" data-testid="report-picture" />
          ) : (
            <p className="muted" style={{ marginTop: '6mm' }}>
              This browser cannot draw 3D; the rest of the report is complete.
            </p>
          )}
          <div className="sheet-h later">
            <h2>Bill of materials</h2>
            <span>
              {plural(report.totals.items, 'piece')} · {plural(report.lines.length, 'type')}
            </span>
          </div>
          {report.lines.length === 0 ? (
            <p className="muted" style={{ marginTop: '4mm' }}>
              No items in the plan yet.
            </p>
          ) : (
            <table className="bom-table" data-testid="report-bom">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Item</th>
                  <th>Size (W × D × H)</th>
                  <th className="r">Seats</th>
                  <th className="r">Qty</th>
                </tr>
              </thead>
              <tbody>
                {report.lines.map((line) => {
                  const category = project.catalog[line.definitionId]?.category;
                  return (
                    <tr key={line.definitionId}>
                      <td className="key">{formatCount(line.key)}</td>
                      <td>
                        {line.name}
                        {category && <span style={{ color: 'var(--ink-2)', fontSize: '9pt' }}> · {SHAPE_LABEL.get(shapeOf(category))}</span>}
                      </td>
                      <td className="size">
                        {formatCentimetres(line.size.w)} × {formatCentimetres(line.size.d)} × {formatCentimetres(line.size.h)} cm
                      </td>
                      <td className="r">{line.seats > 0 ? formatCount(line.seats) : '—'}</td>
                      <td className="r">{formatCount(line.count)}</td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr>
                  <td />
                  <td>Total</td>
                  <td />
                  <td className="r">{formatCount(report.totals.seats)}</td>
                  <td className="r">{formatCount(report.totals.items)}</td>
                </tr>
              </tfoot>
            </table>
          )}
          {cargo && sequence.length > 0 && (
            <>
              <div className="sheet-h later">
                <h2>Loading sequence</h2>
                <span>Front wall to doors · stop 1 is unloaded first</span>
              </div>
              <table className="bom-table" data-testid="report-sequence">
                <thead>
                  <tr>
                    <th>Step</th>
                    <th>Piece</th>
                    <th>Stop</th>
                    <th>Centre from front wall × side · underside</th>
                    <th className="r">Orientation</th>
                  </tr>
                </thead>
                <tbody>
                  {sequence.map((i) => {
                    const d = project.catalog[i.definitionId]!;
                    return (
                      <tr key={i.id}>
                        <td className="key">{stepOf(i) ?? '—'}</td>
                        <td>
                          {i.id}
                          <span style={{ color: 'var(--ink-2)', fontSize: '9pt' }}> · {d.name}</span>
                        </td>
                        <td>{stopOf(i, d) ?? '—'}</td>
                        <td className="size">
                          {formatCentimetres(i.position.x)} × {formatCentimetres(i.position.y)} × {formatCentimetres(i.elevation ?? 0)} cm
                        </td>
                        <td className="r">{i.tilt === 'x' ? 'Width up' : i.tilt === 'y' ? 'Depth up' : 'Upright'}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </>
          )}
          <span className="fill" />
          <Foot name={report.name} revision={report.revision} page={3} />
        </article>

        <article className="sheet" aria-label="Rules and issues">
          <div className="sheet-h">
            <h2>Planning rules</h2>
            <span>{kicker}</span>
          </div>
          <div data-testid="report-rules">
            {report.rules.map((rule) => (
              <div key={rule.code} className={`report-rule ${rule.status}`} data-rule={rule.code} data-status={rule.status}>
                {rule.status === 'pass' ? <Check size={15} /> : rule.status === 'fail' ? <XCircle size={15} /> : <Question size={15} />}
                <span className="nm">
                  {rule.title}
                  {rule.status !== 'pass' && <span className="note">{rule.text}</span>}
                  {rule.source && (
                    <span className="note">
                      {SOURCE_KIND_WORD[rule.source.kind]}: {rule.source.title}
                    </span>
                  )}
                </span>
                <span className="sm">
                  <span>Measured</span>
                  {rule.measured}
                </span>
                <span className="sm">
                  <span>Required</span>
                  {rule.required}
                </span>
                <span className="st">{RULE_STATUS_WORD[rule.status]}</span>
              </div>
            ))}
          </div>
          {showIssues && (
            <>
              <div className="sheet-h later">
                <h2>Issues requiring attention</h2>
                <span>
                  {plural(report.counts.error, 'error')} · {plural(report.counts.warning, 'warning')}
                  {report.counts.info ? ` · ${formatCount(report.counts.info)} unknown` : ''}
                </span>
              </div>
              {report.issues.length === 0 ? (
                <p style={{ marginTop: '4mm' }}>No issues found.</p>
              ) : (
                <div data-testid="report-issues">
                  {[...problems, ...unknown].map((issue, i) => (
                    <div key={i} className={`report-issue ${issue.severity}`}>
                      {issue.severity === 'error' ? <XCircle size={15} /> : issue.severity === 'warning' ? <Warning size={15} /> : <Question size={15} />}
                      <div>
                        <div className="t">{issue.headline}</div>
                        <div className="w">
                          {SEVERITY_WORD[issue.severity]} · {issue.title}
                          {issue.where ? ` · ${issue.where}` : ''}
                        </div>
                        <div className="w" style={{ color: '#3d3a35' }}>
                          {issue.text}
                        </div>
                      </div>
                      <div className="amt">
                        {issue.gap && <div className="gap">{issue.gap}</div>}
                        {issue.need && <div style={{ color: 'var(--ink-2)', marginTop: '1mm' }}>Required: {issue.need.toLowerCase()}</div>}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
          <span className="fill" />
          <p className="report-note">
            Checks use the sizes written in the plan: overlaps, the room's walls, door swings, columns, the free space each item needs, and the ceiling height. Planning rules follow the {report.activity.label.toLowerCase()} pack
            (walkways measured to 5 cm). Missing data is reported as unknown, never as a pass. This is not a replacement for civil-defence approval or an engineer's review.
          </p>
          <Foot name={report.name} revision={report.revision} page={4} />
        </article>
      </div>
    </div>
  );
}
