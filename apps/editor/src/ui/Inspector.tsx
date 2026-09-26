import { apply, boundsOf, fromUnit, toSquareMetres, toUnit, type Command, type Id, type Issue, type Metrics, type Project } from '@space-planner/core';
import { packOf, PACKS, productionMetrics, rackDefinition, rackSpecOf, SHAPES, shapeOf, stationKindOf, stepOf, vehicleProfileOf, warehouseMetrics, type RackSpec, type RuleResult } from '@space-planner/starter';
import {
  AlignBottom,
  AlignCenterHorizontal,
  AlignCenterVertical,
  AlignLeft,
  AlignRight,
  AlignTop,
  ArrowClockwise,
  ArrowCounterClockwise,
  ArrowLineDown,
  ArrowLineUp,
  ArrowsHorizontal,
  ArrowsVertical,
  Check,
  CheckCircle,
  Copy,
  Cube,
  LockSimple,
  LockSimpleOpen,
  PencilSimpleLine,
  Question,
  Trash,
  Warning,
  X,
  XCircle,
} from '@phosphor-icons/react';
import { useState, type ReactNode } from 'react';
import { activityOf, type Activity } from '../logic/activity.js';
import { copyOffset, type ControlSettings } from '../logic/controls.js';
import { nextId } from '../logic/ids.js';
import { formatArea, formatCentimetres, formatCount, formatDegrees, formatLength, formatMetres, formatPercent, formatSquareMetres, plural } from '../logic/format.js';
import {
  describeIssue,
  describeRule,
  ISSUE_GROUP,
  ISSUE_GROUPS,
  issueAmounts,
  issueHeadline,
  RULE_STATUS_WORD,
  RULE_TITLES,
  ruleFigures,
  SEVERITY_WORD,
  SOURCE_KIND_WORD,
  type IssueGroup,
} from '../logic/messages.js';
import type { Action } from '../logic/session.js';
import {
  alignCommands,
  distributeCommands,
  duplicateCommands,
  elevateCommands,
  lockCommands,
  moveCommands,
  removeCommands,
  rotateCommands,
  setElevationCommands,
  setRotationCommands,
  toBatch,
  takenIds,
  type AlignEdge,
} from '../logic/transform.js';
import { CommitField, NumberField } from './Fields.js';
import { CargoGroup, containerFacts } from './Container.js';
import { RackLocations, type StockView } from './Stock.js';
import { toTicks } from './units.js';

/** Everything the review counts, shared by the inspector tab, the status bar and the summary box. */
export interface ReviewSummary {
  readonly errors: number;
  readonly warnings: number;
  readonly passed: number;
  readonly unknown: number;
  /** errors + warnings: what the Review tab badge shows. */
  readonly findings: number;
}

export function summarize(issues: readonly Issue[], rules: readonly RuleResult[]): ReviewSummary {
  const errors = issues.filter((i) => i.severity === 'error').length;
  const warnings = issues.filter((i) => i.severity === 'warning').length + rules.filter((r) => r.status === 'fail').length;
  const unknown = issues.filter((i) => i.severity === 'info').length + rules.filter((r) => r.status === 'unknown').length;
  const cleanGroups = ISSUE_GROUPS.filter((g) => !issues.some((i) => ISSUE_GROUP[i.code] === g)).length;
  const passed = cleanGroups + rules.filter((r) => r.status === 'pass').length;
  return { errors, warnings, passed, unknown, findings: errors + warnings };
}

export function statusLine(s: ReviewSummary): { tone: 'error' | 'warning' | 'ok'; text: string } {
  if (s.errors > 0) return { tone: 'error', text: `${plural(s.errors, 'error')} · ${plural(s.warnings, 'warning')}` };
  if (s.warnings > 0) return { tone: 'warning', text: `No errors · ${plural(s.warnings, 'warning')}` };
  return { tone: 'ok', text: s.unknown > 0 ? `No issues · ${formatCount(s.unknown)} unknown` : 'No issues found' };
}

const SHAPE_LABEL = new Map(SHAPES.map((s) => [s.key as string, s.label]));
const run = (dispatch: (a: Action) => void, command: Command | null, select?: readonly Id[]) => command && dispatch({ type: 'command', command, ...(select ? { select } : {}) });

function Group({ title, hint, children }: { title: string; hint?: string | undefined; children: ReactNode }) {
  return (
    <div className="insp-group">
      <div className="kicker">{title}</div>
      {children}
      {hint ? <p className="hint">{hint}</p> : <div style={{ height: 14 }} />}
    </div>
  );
}

/**
 * The Properties tab: the project at a glance when nothing is selected, exact numbers for one
 * item, and align / distribute / move-by for several. Every button is one command, one step.
 */
export function PropertiesPanel({
  project,
  selectedIds,
  controls,
  issues,
  metrics,
  activity,
  summary,
  dispatch,
  onEditType,
  onOpenReview,
  onShow3D,
  onFocusIssue,
  stockView,
  onStockView,
}: {
  project: Project;
  selectedIds: readonly Id[];
  controls: ControlSettings;
  issues: readonly Issue[];
  metrics: Metrics;
  activity: Activity;
  summary: ReviewSummary;
  dispatch: (a: Action) => void;
  onEditType: (id: Id) => void;
  onOpenReview: () => void;
  onShow3D: () => void;
  onFocusIssue: (issue: Issue) => void;
  stockView?: StockView;
  onStockView?: (view: StockView) => void;
}) {
  const items = selectedIds.map((id) => project.items[id]).filter((i) => i !== undefined);
  if (items.length === 0) return <ProjectSummary project={project} metrics={metrics} activity={activity} summary={summary} onOpenReview={onOpenReview} />;
  if (items.length === 1) return <OneItem project={project} id={items[0]!.id} controls={controls} issues={issues} dispatch={dispatch} onEditType={onEditType} onShow3D={onShow3D} onFocusIssue={onFocusIssue} cargo={activity.pack === 'container'} production={activity.pack === 'production'} stockView={stockView} onStockView={onStockView} />;
  return <ManyItems project={project} ids={items.map((i) => i.id)} controls={controls} dispatch={dispatch} />;
}

function ProjectSummary({ project, metrics, activity, summary, onOpenReview }: { project: Project; metrics: Metrics; activity: Activity; summary: ReviewSummary; onOpenReview: () => void }) {
  const pack = packOf(activity.pack);
  const style = pack.styles.find((s) => s.id === activity.style)?.label ?? '';
  const room = boundsOf(project.space.boundary);
  const types = new Set(Object.values(project.items).map((i) => i.definitionId)).size;
  const columns = project.space.obstacles.filter((o) => o.kind === 'column').length;
  const areaPerSeat = metrics.seats > 0 ? toSquareMetres(metrics.floorArea) / metrics.seats : undefined;
  const facts: Array<[string, ReactNode]> = activity.pack === 'container' ? containerFacts(project) : activity.pack === 'warehouse' ? (() => {
    const w = warehouseMetrics(project);
    return [
      ['Warehouse', `${formatMetres(room.maxX - room.minX)} × ${formatMetres(room.maxY - room.minY)} m`],
      ['Rack rows · bays', `${w.rackRows} · ${w.bays}`],
      ['Pallet positions', <span data-testid="warehouse-inspector-capacity">{formatCount(w.positions)}</span>],
      ['Usable positions', formatCount(w.usablePositions)],
      ['Rack footprint', `${w.rackArea.toFixed(1)} m² of ${w.floorArea.toFixed(1)} m²`],
      ['Docks', formatCount(w.docks)],
    ] as Array<[string, ReactNode]>;
  })() : [
    ['Room', `${formatMetres(room.maxX - room.minX)} × ${formatMetres(room.maxY - room.minY)} m`],
    ['Ceiling', project.space.ceilingHeight === undefined ? 'Not set' : `${formatMetres(project.space.ceilingHeight)} m`],
    ['Floor area', formatArea(metrics.floorArea)],
    ['Seats', <span data-testid="seats">{formatCount(metrics.seats)}</span>],
    ['Area per seat', areaPerSeat === undefined ? '—' : formatSquareMetres(Math.round(areaPerSeat * 100) / 100)],
    ['Occupied', `${formatArea(metrics.occupiedArea)} · ${formatPercent(metrics.occupancy)}`],
    ['Items placed', `${formatCount(metrics.itemCount)} · ${plural(types, 'type')}`],
    ['Doors · columns', `${formatCount(project.space.doors.length)} · ${formatCount(columns)}`],
  ];
  const box =
    summary.errors > 0
      ? { tone: 'error', icon: <XCircle size={16} />, title: `${plural(summary.errors, 'error')} · ${plural(summary.warnings, 'warning')}`, text: 'Fix the errors before sharing the client report. Warnings can be accepted.' }
      : summary.warnings > 0
        ? { tone: 'warning', icon: <Warning size={16} />, title: `No errors · ${plural(summary.warnings, 'warning')}`, text: 'Review the warnings; each one can be fixed or accepted.' }
        : { tone: 'ok', icon: <CheckCircle size={16} />, title: 'Every check passes', text: summary.unknown > 0 ? `${plural(summary.unknown, 'check')} could not be run because data is missing.` : 'The plan is ready for the client report.' };
  return (
    <div aria-label="Project">
      <div className="insp-head" style={{ paddingTop: 28 }}>
        <div className="kicker">
          {pack.label} · {style}
        </div>
        <h3 className="xl">{project.name}</h3>
        <p className="sub">Nothing selected. Click an item to edit it.</p>
      </div>
      <div className="facts">
        {facts.map(([k, v]) => (
          <div className="fact" key={k}>
            <span>{k}</span>
            <span>{v}</span>
          </div>
        ))}
      </div>
      <div className={`state-box ${box.tone}`}>
        <div className="title">
          {box.icon}
          {box.title}
        </div>
        <p>{box.text}</p>
        <button type="button" className="btn" onClick={onOpenReview}>
          Open review
        </button>
      </div>
      {metrics.bom.length > 0 && (
        <div className="bom-list">
          <div className="kicker" style={{ marginBottom: 6 }}>
            Quantities
          </div>
          {metrics.bom.map((line) => (
            <div className="bom-row" key={line.definitionId}>
              <span>{line.name}</span>
              <span>× {formatCount(line.count)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function OneItem({
  project,
  id,
  controls,
  issues,
  dispatch,
  onEditType,
  onShow3D,
  onFocusIssue,
  cargo,
  production,
  stockView,
  onStockView,
}: {
  cargo: boolean;
  production: boolean;
  stockView?: StockView | undefined;
  onStockView?: ((view: StockView) => void) | undefined;
  project: Project;
  id: Id;
  controls: ControlSettings;
  issues: readonly Issue[];
  dispatch: (a: Action) => void;
  onEditType: (id: Id) => void;
  onShow3D: () => void;
  onFocusIssue: (issue: Issue) => void;
}) {
  const item = project.items[id]!;
  const definition = project.catalog[item.definitionId];
  if (!definition) return null;
  const ids = [id];
  const cm = (t: number) => toUnit(t, 'cm');
  const issue = issues.find((i) => i.entityIds[0] === id && i.severity !== 'info') ?? issues.find((i) => i.entityIds.includes(id) && i.severity !== 'info');
  const same = Object.values(project.items).filter((i) => i.definitionId === definition.id).length;
  const actions: Array<{ label: string; icon: ReactNode; onClick: () => void; on?: boolean; danger?: boolean; disabled?: boolean }> = [
    { label: 'Rotate 90° right · R', icon: <ArrowClockwise size={16} />, onClick: () => run(dispatch, rotateCommands(project, ids, -90_000)), disabled: item.locked },
    { label: 'Rotate 90° left · Shift R', icon: <ArrowCounterClockwise size={16} />, onClick: () => run(dispatch, rotateCommands(project, ids, 90_000)), disabled: item.locked },
    { label: item.locked ? 'Unlock · L' : 'Lock · L', icon: item.locked ? <LockSimple size={16} /> : <LockSimpleOpen size={16} />, onClick: () => run(dispatch, lockCommands(project, ids, !item.locked)), on: item.locked },
    {
      label: 'Duplicate · Ctrl D',
      icon: <Copy size={16} />,
      onClick: () => {
        const d = duplicateCommands(project, ids, copyOffset(controls));
        run(dispatch, d.command, d.ids);
      },
    },
    { label: 'Show in 3D', icon: <Cube size={16} />, onClick: onShow3D },
    { label: 'Remove · Delete', icon: <Trash size={16} />, onClick: () => run(dispatch, removeCommands(project, ids), []), danger: true, disabled: item.locked },
  ];
  return (
    <div aria-label="Selected item">
      <div className="insp-head">
        <div className="kicker">
          <span>
            {SHAPE_LABEL.get(shapeOf(definition.category)) ?? 'Item'} · {id}
          </span>
          {item.locked && (
            <span className="locked-chip">
              <LockSimple size={12} />
              Locked
            </span>
          )}
        </div>
        <h3>{definition.name}</h3>
        <p className="sub">
          {formatCentimetres(definition.size.w)} × {formatCentimetres(definition.size.d)} × {formatCentimetres(definition.size.h)} cm
          {definition.seats ? ` · ${plural(definition.seats, 'seat')}` : ''}
        </p>
        <div className="icon-actions">
          {actions.map((a) => (
            <button key={a.label} type="button" title={a.label} aria-label={a.label} className={`${a.on ? 'on' : ''} ${a.danger ? 'danger' : ''}`} disabled={a.disabled} onClick={a.onClick}>
              {a.icon}
            </button>
          ))}
        </div>
        {issue && (
          <button type="button" className={`callout ${issue.severity}`} onClick={() => onFocusIssue(issue)}>
            <span className="sev">{issue.severity === 'error' ? <XCircle size={16} /> : <Warning size={16} />}</span>
            <span>
              <strong style={{ fontWeight: 500 }}>{issueHeadline(project, issue)}</strong>
              <br />
              <span className="muted">{describeIssue(project, issue)}</span>
            </span>
          </button>
        )}
      </div>
      <Group title="Position" hint="Centre, measured from the west and south walls.">
        <div className="grid-2">
          <CommitField label="X" ariaLabel="X position" unit="cm" value={cm(item.position.x)} onCommit={(x) => run(dispatch, moveCommands(project, ids, { x: toTicks(x) - item.position.x, y: 0 }))} readOnly={item.locked} />
          <CommitField label="Y" ariaLabel="Y position" unit="cm" value={cm(item.position.y)} onCommit={(y) => run(dispatch, moveCommands(project, ids, { x: 0, y: toTicks(y) - item.position.y }))} readOnly={item.locked} />
        </div>
      </Group>
      <Group title="Rotation & elevation">
        <div className="grid-2">
          <CommitField label="∠" ariaLabel="Rotation" unit="°" digits={3} limit={3600} value={item.rotation / 1000} onCommit={(a) => run(dispatch, setRotationCommands(project, ids, Math.round(a * 1000)))} readOnly={item.locked} />
          <CommitField label="↑" ariaLabel="Elevation" unit="cm" value={cm(item.elevation ?? 0)} onCommit={(z) => run(dispatch, setElevationCommands(project, ids, toTicks(z)))} readOnly={item.locked} />
        </div>
        <div className="btn-grid" style={{ marginTop: 8 }}>
          <button type="button" title={`Rotate ${formatDegrees(controls.angleStep)} left · [`} aria-label={`Rotate ${formatDegrees(controls.angleStep)} left`} disabled={item.locked} onClick={() => run(dispatch, rotateCommands(project, ids, controls.angleStep))}>
            <ArrowCounterClockwise size={16} />
          </button>
          <button type="button" title={`Rotate ${formatDegrees(controls.angleStep)} right · ]`} aria-label={`Rotate ${formatDegrees(controls.angleStep)} right`} disabled={item.locked} onClick={() => run(dispatch, rotateCommands(project, ids, -controls.angleStep))}>
            <ArrowClockwise size={16} />
          </button>
          <button type="button" title={`Raise ${formatLength(controls.raiseStep)} · Page Up`} aria-label="Raise" disabled={item.locked} onClick={() => run(dispatch, elevateCommands(project, ids, controls.raiseStep))}>
            <ArrowLineUp size={16} />
          </button>
          <button type="button" title={`Lower ${formatLength(controls.raiseStep)} · Page Down`} aria-label="Lower" disabled={item.locked || !item.elevation} onClick={() => run(dispatch, elevateCommands(project, ids, -controls.raiseStep))}>
            <ArrowLineDown size={16} />
          </button>
        </div>
      </Group>
      {cargo && <CargoGroup project={project} item={item} dispatch={dispatch} />}
      {rackSpecOf(definition) && stockView && onStockView && <RackLocations project={project} item={item} view={stockView} onView={onStockView} dispatch={dispatch} />}
      {rackSpecOf(definition) && <RackGroup project={project} item={item} dispatch={dispatch} />}
      {production && stationKindOf(definition) && <FlowGroup project={project} item={item} dispatch={dispatch} />}
      {vehicleProfileOf(definition) && <DepotGroup project={project} item={item} />}
      <Group title="Dimensions" hint="Set by the item type.">
        <div className="grid-3">
          <CommitField label="W" ariaLabel="Width" unit="cm" value={cm(definition.size.w)} readOnly />
          <CommitField label="D" ariaLabel="Depth" unit="cm" value={cm(definition.size.d)} readOnly />
          <CommitField label="H" ariaLabel="Height" unit="cm" value={cm(definition.size.h)} readOnly />
        </div>
      </Group>
      <Group title="Clearance" hint="Free space needed around the item to use it.">
        <div className="grid-2">
          <CommitField label="F" ariaLabel="Front clearance" unit="cm" value={cm(definition.clearance.front)} readOnly />
          <CommitField label="B" ariaLabel="Back clearance" unit="cm" value={cm(definition.clearance.back)} readOnly />
          <CommitField label="L" ariaLabel="Left clearance" unit="cm" value={cm(definition.clearance.left)} readOnly />
          <CommitField label="R" ariaLabel="Right clearance" unit="cm" value={cm(definition.clearance.right)} readOnly />
        </div>
      </Group>
      <div className="insp-foot">
        <button type="button" className="link-btn" style={{ fontSize: 13 }} onClick={() => onEditType(definition.id)}>
          <PencilSimpleLine size={14} />
          Edit item type · applies to {same} placed
        </button>
      </div>
    </div>
  );
}

function RackGroup({ project, item, dispatch }: { project: Project; item: Project['items'][string]; dispatch: (a: Action) => void }) {
  const spec = rackSpecOf(project.catalog[item.definitionId]);
  if (!spec) return null;
  const capacity = Math.min(spec.bays * spec.levels * spec.positionsPerLevel, spec.maxPositions ?? Infinity);
  const change = (key: keyof Pick<RackSpec, 'bays' | 'levels' | 'positionsPerLevel' | 'bayWidth' | 'depth' | 'height'>, value: number) => {
    const next = { ...spec, [key]: key === 'bayWidth' || key === 'depth' || key === 'height' ? fromUnit(value, 'cm') : value };
    try {
      const id = nextId(`rack-${item.id}`, takenIds(project));
      const definition = rackDefinition(id, next);
      const command = toBatch([
        { type: 'catalog.define', definition },
        { type: 'item.remove', id: item.id },
        { type: 'item.add', item: { ...item, definitionId: id } },
      ]);
      if (command) dispatch({ type: 'command', command, select: [item.id] });
    } catch { /* Invalid rack inputs do not create revisions. */ }
  };
  return <Group title="Rack capacity" hint="Each edited row gets its own rack type. The saved plan holds one row, not each structural piece.">
    <div className="facts"><div className="fact"><span>Rack row</span><span>{item.id}</span></div><div className="fact"><span>Total positions</span><span>{capacity}</span></div></div>
    <div className="grid-2">
      <span className="span-all"><CommitField label="Bays" wideKey ariaLabel="Rack bays" unit="" value={spec.bays} digits={0} onCommit={(n) => change('bays', n)} readOnly={item.locked} /></span>
      <span className="span-all"><CommitField label="Levels" wideKey ariaLabel="Rack levels" unit="" value={spec.levels} digits={0} onCommit={(n) => change('levels', n)} readOnly={item.locked} /></span>
      <span className="span-all"><CommitField label="Positions" wideKey ariaLabel="Pallets per level per bay" unit="" value={spec.positionsPerLevel} digits={0} onCommit={(n) => change('positionsPerLevel', n)} readOnly={item.locked} /></span>
      <span className="span-all"><CommitField label="Bay w." wideKey ariaLabel="Rack bay width" unit="cm" value={toUnit(spec.bayWidth, 'cm')} onCommit={(n) => change('bayWidth', n)} readOnly={item.locked} /></span>
      <span className="span-all"><CommitField label="Depth" wideKey ariaLabel="Rack depth" unit="cm" value={toUnit(spec.depth, 'cm')} onCommit={(n) => change('depth', n)} readOnly={item.locked} /></span>
      <span className="span-all"><CommitField label="Height" wideKey ariaLabel="Rack height" unit="cm" value={toUnit(spec.height, 'cm')} onCommit={(n) => change('height', n)} readOnly={item.locked} /></span>
    </div>
  </Group>;
}

function DepotGroup({ project, item }: { project: Project; item: Project['items'][string] }) {
  const vehicle = vehicleProfileOf(project.catalog[item.definitionId]);
  if (!vehicle) return null;
  return <Group title="Vehicle" hint="Fixed by the vehicle type; edit the item type to change it.">
    <div className="facts">
      <div className="fact"><span>Turning radius</span><span>{toUnit(vehicle.minTurningRadius, 'cm') / 100} m</span></div>
      <div className="fact"><span>Rear overhang</span><span>{toUnit(vehicle.rearOverhang, 'cm')} cm</span></div>
    </div>
  </Group>;
}

function FlowGroup({ project, item, dispatch }: { project: Project; item: Project['items'][string]; dispatch: (a: Action) => void }) {
  const definition = project.catalog[item.definitionId];
  const kind = stationKindOf(definition);
  if (!kind) return null;
  const step = stepOf(item);
  const capacity = definition?.meta?.capacity;
  const metrics = productionMetrics(project);
  const changeStep = (n: number) => dispatch({ type: 'command', command: { type: 'item.meta', id: item.id, meta: { ...item.meta, step: Math.round(n) } }, select: [item.id] });
  return <Group title="Production flow" hint="Order decides the line; a station without an order is not part of the flow.">
    <div className="facts">
      <div className="fact"><span>Station kind</span><span style={{ textTransform: 'capitalize' }}>{kind}</span></div>
      {capacity !== undefined && <div className="fact"><span>Capacity</span><span>{capacity}</span></div>}
      <div className="fact"><span>Line flow length</span><span>{(metrics.flowLength / 10_000).toFixed(1)} m</span></div>
    </div>
    <div className="grid-2" style={{ marginTop: 10 }}>
      <span className="span-all"><CommitField label="Order" wideKey ariaLabel="Flow order" unit="" value={step ?? 0} digits={0} onCommit={changeStep} readOnly={item.locked} /></span>
    </div>
    {step === undefined && <p className="hint">Set a flow order to place this station in the line (1 = first).</p>}
  </Group>;
}

function ManyItems({ project, ids, controls, dispatch }: { project: Project; ids: readonly Id[]; controls: ControlSettings; dispatch: (a: Action) => void }) {
  const [by, setBy] = useState({ x: 0, y: 0, z: 0 });
  const items = ids.map((id) => project.items[id]!);
  const allLocked = items.every((i) => i.locked);
  const anyMovable = items.some((i) => !i.locked);
  const types = new Map<string, number>();
  for (const i of items) {
    const name = project.catalog[i.definitionId]?.name ?? i.definitionId;
    types.set(name, (types.get(name) ?? 0) + 1);
  }
  const align = (edge: AlignEdge) => run(dispatch, alignCommands(project, ids, edge));
  const iconButtons = (buttons: Array<[string, ReactNode, () => void, boolean?]>) => (
    <div className="btn-grid">
      {buttons.map(([label, icon, onClick, disabled]) => (
        <button key={label} type="button" title={label} aria-label={label} onClick={onClick} disabled={disabled || !anyMovable}>
          {icon}
        </button>
      ))}
    </div>
  );
  return (
    <div aria-label="Selected items">
      <div className="insp-head">
        <div className="kicker">Multiple selection</div>
        <h3>{formatCount(items.length)} objects</h3>
        <p className="sub">{[...types].map(([n, c]) => `${n} × ${c}`).join(' · ')}</p>
      </div>
      <Group title="Align">
        {iconButtons([
          ['Align west edges', <AlignLeft size={17} />, () => align('west')],
          ['Align centres', <AlignCenterHorizontal size={17} />, () => align('centre-x')],
          ['Align east edges', <AlignRight size={17} />, () => align('east')],
          ['Align north edges', <AlignTop size={17} />, () => align('north')],
          ['Align middles', <AlignCenterVertical size={17} />, () => align('centre-y')],
          ['Align south edges', <AlignBottom size={17} />, () => align('south')],
        ])}
      </Group>
      <Group title="Distribute" hint={items.length < 3 ? 'Select three or more items to space them evenly.' : undefined}>
        {iconButtons([
          ['Distribute horizontally', <ArrowsHorizontal size={17} />, () => run(dispatch, distributeCommands(project, ids, 'x')), items.length < 3],
          ['Distribute vertically', <ArrowsVertical size={17} />, () => run(dispatch, distributeCommands(project, ids, 'y')), items.length < 3],
        ])}
      </Group>
      <Group title="Transform">
        {iconButtons([
          [`Rotate ${formatDegrees(controls.angleStep)} left`, <ArrowCounterClockwise size={17} />, () => run(dispatch, rotateCommands(project, ids, controls.angleStep))],
          [`Rotate ${formatDegrees(controls.angleStep)} right`, <ArrowClockwise size={17} />, () => run(dispatch, rotateCommands(project, ids, -controls.angleStep))],
          [`Raise ${formatLength(controls.raiseStep)}`, <ArrowLineUp size={17} />, () => run(dispatch, elevateCommands(project, ids, controls.raiseStep))],
          [`Lower ${formatLength(controls.raiseStep)}`, <ArrowLineDown size={17} />, () => run(dispatch, elevateCommands(project, ids, -controls.raiseStep))],
        ])}
      </Group>
      <Group title="Move by">
        <div className="grid-3">
          <NumberField name="move-x" label="E" ariaLabel="Move east" unit="cm" value={by.x} min={-100_000} max={100_000} onChange={(x) => x !== undefined && setBy((b) => ({ ...b, x }))} />
          <NumberField name="move-y" label="N" ariaLabel="Move north" unit="cm" value={by.y} min={-100_000} max={100_000} onChange={(y) => y !== undefined && setBy((b) => ({ ...b, y }))} />
          <NumberField name="move-z" label="↑" ariaLabel="Raise by" unit="cm" value={by.z} min={-100_000} max={100_000} onChange={(z) => z !== undefined && setBy((b) => ({ ...b, z }))} />
        </div>
        <button
          type="button"
          className="btn small"
          style={{ marginTop: 8 }}
          disabled={!anyMovable || (by.x === 0 && by.y === 0 && by.z === 0)}
          onClick={() => {
            const move = moveCommands(project, ids, { x: toTicks(by.x), y: toTicks(by.y) });
            const moved = move ? apply(project, move) : null;
            const raise = elevateCommands(moved?.ok ? moved.project : project, ids, toTicks(by.z));
            run(dispatch, toBatch([move, raise].filter((c): c is Command => c !== null)));
          }}
        >
          Apply move
        </button>
      </Group>
      <div className="insp-group action-list">
        <div className="kicker" style={{ marginBottom: 4 }}>
          Actions
        </div>
        <button
          type="button"
          onClick={() => {
            const d = duplicateCommands(project, ids, copyOffset(controls));
            run(dispatch, d.command, d.ids);
          }}
        >
          <Copy size={15} />
          <span className="spacer">Duplicate</span>
          <span className="key">Ctrl D</span>
        </button>
        <button type="button" onClick={() => run(dispatch, lockCommands(project, ids, !allLocked))}>
          {allLocked ? <LockSimpleOpen size={15} /> : <LockSimple size={15} />}
          <span className="spacer">{allLocked ? 'Unlock all' : 'Lock all'}</span>
          <span className="key">L</span>
        </button>
        <button type="button" onClick={() => dispatch({ type: 'select', ids: [] })}>
          <X size={15} />
          <span className="spacer">Clear selection</span>
          <span className="key">Esc</span>
        </button>
        <button type="button" className="danger" disabled={!anyMovable} onClick={() => run(dispatch, removeCommands(project, ids), [])}>
          <Trash size={15} />
          <span className="spacer">Remove</span>
          <span className="key">Delete</span>
        </button>
      </div>
      <div style={{ height: 24 }} />
    </div>
  );
}

type Filter = 'all' | 'error' | 'warning';

/** The Review tab: counts, findings grouped by kind, then the activity's planning rules. */
export function ReviewPanel({
  project,
  issues,
  rules,
  activity,
  summary,
  focus,
  onActivity,
  onFocus,
  dispatch,
}: {
  project: Project;
  issues: readonly Issue[];
  rules: readonly RuleResult[];
  activity: Activity;
  summary: ReviewSummary;
  focus: number | null;
  onActivity: (activity: Activity) => void;
  onFocus: (index: number | null) => void;
  dispatch: (a: Action) => void;
}) {
  const [filter, setFilter] = useState<Filter>('all');
  const pack = packOf(activity.pack);
  const counts: Array<{ key: Filter | 'none'; n: number; label: string; icon: ReactNode; tone: string }> = [
    { key: 'error', n: summary.errors, label: 'Errors', icon: <XCircle size={12} />, tone: summary.errors ? 'error' : '' },
    { key: 'warning', n: summary.warnings, label: 'Warnings', icon: <Warning size={12} />, tone: summary.warnings ? 'warning' : '' },
    { key: 'none', n: summary.passed, label: 'Passed', icon: <CheckCircle size={12} />, tone: 'ok' },
    { key: 'none', n: summary.unknown, label: 'Unknown', icon: <Question size={12} />, tone: '' },
  ];
  const visible = (sev: Issue['severity']) => filter === 'all' || sev === filter;
  const groups = ISSUE_GROUPS.map((group) => ({
    group,
    all: issues.map((issue, index) => ({ issue, index })).filter(({ issue }) => ISSUE_GROUP[issue.code] === group),
  }));
  const showRules = filter !== 'error';
  const selectFirst = (issue: Issue, index: number) => {
    onFocus(index);
    const first = issue.entityIds.find((id) => project.items[id]);
    if (first) dispatch({ type: 'select', ids: [first] });
  };
  return (
    <div aria-label="Review">
      <div className="counts">
        {counts.map((c) => (
          <button
            key={c.label}
            type="button"
            className={`count ${c.tone}${c.key !== 'none' && filter === c.key ? ' active' : ''}`}
            data-testid={c.key === 'error' ? 'issue-count' : undefined}
            aria-pressed={c.key !== 'none' ? filter === c.key : undefined}
            onClick={() => c.key !== 'none' && setFilter(filter === c.key ? 'all' : c.key)}
          >
            <div className="n">{formatCount(c.n)}</div>
            <div className="label">
              {c.icon}
              {c.label}
            </div>
          </button>
        ))}
      </div>
      {issues.length === 0 && rules.every((r) => r.status === 'pass') && (
        <div className="all-clear">
          <CheckCircle size={26} />
          <div className="serif">No issues found</div>
          <p className="muted" style={{ marginTop: 4 }}>
            Every check passes for this plan.
          </p>
        </div>
      )}
      {groups.map(({ group, all }) => {
        const shown = all.filter(({ issue }) => visible(issue.severity));
        if (filter !== 'all' && shown.length === 0) return null;
        return <ReviewGroup key={group} group={group} project={project} total={all.length} shown={shown} focus={focus} onPick={selectFirst} />;
      })}
      {showRules && (
        <div className="rules-block" aria-label="Planning rules">
          <h4>Planning rules</h4>
          <div className="grid-2" style={{ margin: '12px 0 6px' }}>
            <label className="stack" style={{ fontSize: 11.5, color: 'var(--ink-3)' }}>
              Activity
              <select className="input" name="activity" value={activity.pack} onChange={(e) => onActivity(activityOf(e.target.value, null))}>
                {PACKS.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="stack" style={{ fontSize: 11.5, color: 'var(--ink-3)' }}>
              Planning style
              <select className="input" name="activity-style" value={activity.style} onChange={(e) => onActivity(activityOf(activity.pack, e.target.value))}>
                {pack.styles.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.label}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div data-testid="rules-count" hidden>
            {rules.filter((r) => r.status === 'fail').length}
          </div>
          {rules.map((rule) => {
            const figures = ruleFigures(project, rule);
            const clickable = rule.entityIds.length > 0;
            const Tag = clickable ? 'button' : 'div';
            return (
              <Tag
                key={rule.code}
                {...(clickable ? { type: 'button' as const, onClick: () => dispatch({ type: 'select', ids: rule.entityIds }), title: 'Select the items this rule names' } : {})}
                className={`rule-row ${rule.status}`}
                data-rule={rule.code}
                data-status={rule.status}
              >
                <span className="icon">{rule.status === 'pass' ? <Check size={15} /> : rule.status === 'fail' ? <XCircle size={15} /> : <Question size={15} />}</span>
                <span>
                  <span className="name" style={{ display: 'block' }}>
                    {RULE_TITLES[rule.code]}
                  </span>
                  <span className="measure" style={{ display: 'block' }}>
                    Measured {figures.measured} · Required {figures.required}
                  </span>
                  {rule.status !== 'pass' && (
                    <span className="note" style={{ display: 'block' }}>
                      {describeRule(project, rule)}
                    </span>
                  )}
                  {rule.source && (
                    <span className="source" style={{ display: 'block' }} title={rule.source.title} data-source={rule.source.kind}>
                      {SOURCE_KIND_WORD[rule.source.kind]} · {rule.source.ruleSet}
                    </span>
                  )}
                </span>
                <span className="status">{RULE_STATUS_WORD[rule.status]}</span>
              </Tag>
            );
          })}
          <p className="muted" style={{ marginTop: 14, fontSize: 12 }}>
            Each rule names where its numbers come from. None is a verified local regulation yet. Missing data is reported as unknown, never as a pass.
          </p>
        </div>
      )}
    </div>
  );
}

function ReviewGroup({
  group,
  project,
  total,
  shown,
  focus,
  onPick,
}: {
  group: IssueGroup;
  project: Project;
  total: number;
  shown: ReadonlyArray<{ issue: Issue; index: number }>;
  focus: number | null;
  onPick: (issue: Issue, index: number) => void;
}) {
  const unknownOnly = total > 0 && shown.every(({ issue }) => issue.severity === 'info');
  return (
    <div className="review-group" data-group={group}>
      <div className="review-group-head">
        <span className="kicker">{group}</span>
        <span className={`state${total === 0 ? ' ok' : ''}`}>{total === 0 ? 'Passed' : unknownOnly ? 'Unknown' : plural(total, 'finding')}</span>
      </div>
      {shown.map(({ issue, index }) => {
        const amounts = issueAmounts(issue);
        if (issue.severity === 'info') {
          return (
            <div key={index} className="finding info" data-issue={issue.code}>
              <span className="sev">
                <Question size={15} />
              </span>
              <span className="finding-body">
                <span className="finding-title">Unknown · {issueHeadline(project, issue)}</span>
                <span className="finding-fix">{describeIssue(project, issue)}</span>
              </span>
            </div>
          );
        }
        return (
          <button key={index} type="button" className={`finding ${issue.severity}${focus === index ? ' focus' : ''}`} data-issue={issue.code} onClick={() => onPick(issue, index)}>
            <span className="sev">{issue.severity === 'error' ? <XCircle size={16} /> : <Warning size={16} />}</span>
            <span className="finding-body">
              <span className="finding-title">{issueHeadline(project, issue)}</span>
              <span className="finding-where">
                {SEVERITY_WORD[issue.severity]} · {issue.entityIds.join(', ')}
              </span>
              {amounts && (
                <span className="finding-amounts">
                  <strong className="gap">{amounts.gap}</strong>
                  <span className="need">Required: {amounts.need.toLowerCase()}</span>
                </span>
              )}
              <span className="finding-fix">{describeIssue(project, issue)}</span>
            </span>
          </button>
        );
      })}
    </div>
  );
}
