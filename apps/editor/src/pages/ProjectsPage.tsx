import { boundsOf, serializeProject } from '@space-planner/core';
import { CONTAINER_TYPES, packOf, type PackId } from '@space-planner/starter';
import {
  ArrowRight,
  ArrowUpRight,
  Briefcase,
  Car,
  Package,
  Warehouse,
  Check,
  CheckCircle,
  CircleDashed,
  Confetti,
  Copy,
  DotsThree,
  DownloadSimple,
  Factory,
  FolderOpen,
  ListBullets,
  MagnifyingGlass,
  Plus,
  Question,
  SpinnerGap,
  SquaresFour,
  Trash,
  Warning,
  XCircle,
} from '@phosphor-icons/react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { api, subscribe, type ProjectSummary } from '../api.js';
import { formatAgo, formatCount, formatMetres, plural } from '../logic/format.js';
import { Dialog, LineTabs, Menu, NumberField, Segmented, useToast } from '../ui/Fields.js';
import { ProjectThumb, SiteHeader, useProjectCards, type ProjectCard } from '../ui/Site.js';

type Filter = 'all' | PackId;
type Sort = 'edited' | 'name';
type Layout = 'list' | 'grid';

function download(name: string, text: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** The validation state of a project in a few words, with its colour and icon. */
function stateOf(card: ProjectCard | undefined, items: number): { tone: string; icon: ReactNode; text: string } {
  if (!card) return { tone: 'draft', icon: <SpinnerGap size={16} />, text: 'Checking…' };
  const s = card.summary;
  if (items === 0) return { tone: 'draft', icon: <CircleDashed size={16} />, text: 'Not checked yet' };
  if (s.errors > 0) return { tone: 'error', icon: <XCircle size={16} />, text: `${plural(s.errors, 'error')} · ${plural(s.warnings, 'warning')}` };
  if (s.warnings > 0) return { tone: 'warning', icon: <Warning size={16} />, text: plural(s.warnings, 'warning') };
  if (s.unknown > 0) return { tone: 'unknown', icon: <Question size={16} />, text: `${plural(s.unknown, 'check')} unknown` };
  return { tone: 'ok', icon: <CheckCircle size={16} />, text: 'Ready to share' };
}

const LAYOUT_KEY = 'atrium.projects.layout';

/** All projects in the database: continue, open, create, copy, export, delete, import a file. */
export function ProjectsPage({ open }: { open: (id: string) => void }) {
  const [projects, setProjects] = useState<ProjectSummary[] | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [filter, setFilter] = useState<Filter>('all');
  const [sort, setSort] = useState<Sort>('edited');
  const [query, setQuery] = useState('');
  const [layout, setLayoutState] = useState<Layout>(() => {
    try {
      return globalThis.localStorage?.getItem(LAYOUT_KEY) === 'grid' ? 'grid' : 'list';
    } catch {
      return 'list';
    }
  });
  const [toast, showToast] = useToast(2600);
  const fileInput = useRef<HTMLInputElement>(null);
  const setLayout = (next: Layout) => {
    setLayoutState(next);
    try {
      globalThis.localStorage?.setItem(LAYOUT_KEY, next);
    } catch {
      // The choice still holds for this visit.
    }
  };

  const refresh = () =>
    void api
      .listProjects()
      .then((list) => {
        setProjects(list);
        setMessage(null);
      })
      .catch(() => setMessage('The Atrium server is not running, so projects cannot be loaded.'));
  useEffect(() => {
    refresh();
    return subscribe({ projects: refresh, open: refresh });
  }, []);
  const cards = useProjectCards(projects?.map((p) => p.id) ?? [], (projects ?? []).map((p) => `${p.id}@${p.revision}`).join(','));

  const packOfProject = (p: ProjectSummary): PackId | null => cards.get(p.id)?.activity.pack ?? null;
  const words = query.trim().toLowerCase();
  const rows = (projects ?? [])
    .filter((p) => filter === 'all' || packOfProject(p) === filter)
    .filter((p) => !words || `${p.name} ${cards.get(p.id) ? packOf(cards.get(p.id)!.activity.pack).label : ''}`.toLowerCase().includes(words))
    .sort((a, b) => (sort === 'name' ? (a.name < b.name ? -1 : a.name > b.name ? 1 : 0) : 0));
  const count = (f: Filter) => (projects ?? []).filter((p) => f === 'all' || packOfProject(p) === f).length;
  const recent = projects?.[0];
  const recentCard = recent ? cards.get(recent.id) : undefined;

  const importFile = (file: File) =>
    void file
      .text()
      .then((text) => api.createProject({ name: file.name.replace(/\.json$/, ''), file: text }))
      .then((p) => open(p.id))
      .catch((error: unknown) => setMessage(error instanceof Error ? error.message : String(error)));

  return (
    <div className="site">
      <SiteHeader active="projects" />
      <main className="site-main">
        <div className="hero-row">
          <div>
            <h1 className="page-title">Projects</h1>
            <p className="lede">Measured spaces and the plans inside them. Check that everything fits and works before anything is ordered.</p>
          </div>
          <div className="hero-actions">
            <button type="button" className="btn" onClick={() => fileInput.current?.click()}>
              <FolderOpen size={17} />
              Open file
            </button>
            <button type="button" className="btn primary" onClick={() => setCreating(true)}>
              <Plus size={17} />
              Create project
            </button>
          </div>
          <input
            ref={fileInput}
            type="file"
            accept=".json,application/json"
            hidden
            data-testid="import-input"
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = '';
              if (file) importFile(file);
            }}
          />
        </div>
        {message && (
          <p className="error-text" role="alert" style={{ marginTop: 20 }}>
            {message}
          </p>
        )}

        {recent && !words && filter === 'all' && (
          <a href={`#/p/${recent.id}`} className="continue" data-testid="continue">
            <div className="continue-text">
              <div className="kicker">Continue where you left off</div>
              <div className="continue-name">{recent.name}</div>
              <div className="continue-meta">
                {recentCard ? <CardMeta card={recentCard} items={recent.itemCount} /> : `${plural(recent.itemCount, 'item')}`}
              </div>
              <span className="spacer" style={{ minHeight: 24 }} />
              <div className="continue-foot">
                {recentCard && recentCard.summary.errors > 0 && (
                  <span className="err">
                    <XCircle size={15} />
                    {plural(recentCard.summary.errors, 'error')} to fix
                  </span>
                )}
                {recentCard && recentCard.summary.warnings > 0 && (
                  <span className="warn">
                    <Warning size={15} />
                    {plural(recentCard.summary.warnings, 'warning')}
                  </span>
                )}
                {recentCard && recentCard.summary.errors + recentCard.summary.warnings === 0 && recent.itemCount > 0 && (
                  <span className="ok">
                    <CheckCircle size={15} />
                    No issues
                  </span>
                )}
                <span style={{ color: '#a29d93' }}>
                  Revision {recent.revision} · {formatAgo(recent.updatedAt)}
                </span>
                <span className="continue-open">
                  Open plan
                  <ArrowRight size={15} />
                </span>
              </div>
            </div>
            <div className="continue-art">{recentCard && <ProjectThumb project={recentCard.project} width={420} height={280} dark />}</div>
          </a>
        )}

        <div className="list-head">
          <h2>All projects</h2>
          <LineTabs
            value={filter}
            onChange={setFilter}
            tabs={[
              { id: 'all', label: 'All', count: count('all') },
              { id: 'hall', label: 'Event hall', count: count('hall') },
              { id: 'office', label: 'Office', count: count('office') },
              { id: 'container', label: 'Container', count: count('container') },
              { id: 'warehouse', label: 'Warehouse', count: count('warehouse') },
            ]}
          />
          <span className="spacer" />
          <label className="search">
            <MagnifyingGlass size={16} />
            <input className="input" type="search" placeholder="Search projects" aria-label="Search projects" value={query} onChange={(e) => setQuery(e.target.value)} />
          </label>
          <select className="input" aria-label="Sort" value={sort} onChange={(e) => setSort(e.target.value as Sort)}>
            <option value="edited">Last edited</option>
            <option value="name">Name</option>
          </select>
          <Segmented
            label="Layout"
            value={layout}
            onChange={setLayout}
            options={[
              { id: 'list', label: <ListBullets size={17} />, title: 'List' },
              { id: 'grid', label: <SquaresFour size={17} />, title: 'Grid' },
            ]}
          />
        </div>
        <div className="rule-ink" />

        {projects === null && !message ? (
          [1, 2, 3].map((k) => (
            <div key={k} className="proj-cols" style={{ padding: '20px 0', borderBottom: '1px solid var(--line)' }}>
              <div className="skeleton" style={{ height: 84 }} />
              <div className="skeleton" style={{ height: 16, width: '40%' }} />
            </div>
          ))
        ) : rows.length === 0 ? (
          <div className="center-empty">
            {projects && projects.length === 0 ? (
              <>
                <div className="serif">No projects yet</div>
                <p>Start with the room: its size, then doors, columns and items.</p>
                <button type="button" className="btn primary" onClick={() => setCreating(true)}>
                  <Plus size={16} />
                  Create project
                </button>
              </>
            ) : (
              <>
                <div className="serif">No projects match{words ? ` “${query.trim()}”` : ''}</div>
                <p>Try a client name, a venue, or an activity.</p>
                <button
                  type="button"
                  className="btn"
                  onClick={() => {
                    setQuery('');
                    setFilter('all');
                  }}
                >
                  Clear search
                </button>
              </>
            )}
          </div>
        ) : layout === 'list' ? (
          <>
            <div className="proj-cols proj-colhead kicker">
              <span />
              <span>Project</span>
              <span className="opt">Activity</span>
              <span className="opt">Room</span>
              <span className="opt">Items</span>
              <span className="opt">Validation</span>
              <span>Edited</span>
              <span />
            </div>
            {rows.map((p) => {
              const card = cards.get(p.id);
              const state = stateOf(card, p.itemCount);
              const room = card ? boundsOf(card.project.space.boundary) : null;
              const pack = card ? packOf(card.activity.pack) : null;
              return (
                <div className="proj-row" key={p.id} data-project={p.id}>
                  <a href={`#/p/${p.id}`} className="proj-cols">
                    <span className="thumb">{card && <ProjectThumb project={card.project} width={96} height={62} />}</span>
                    <span style={{ minWidth: 0 }}>
                      <span className="proj-name">{p.name}</span>
                      <span className="proj-sub">Revision {p.revision}</span>
                    </span>
                    <span className="opt">
                      {pack?.label ?? '—'}
                      <span className="proj-sub">{pack?.styles.find((s) => s.id === card?.activity.style)?.label}</span>
                    </span>
                    <span className="opt num">{room ? `${formatMetres(room.maxX - room.minX).replace('.00', '')} × ${formatMetres(room.maxY - room.minY).replace('.00', '')} m` : '—'}</span>
                    <span className="opt num" style={{ color: p.itemCount ? undefined : 'var(--ink-3)' }}>
                      {p.itemCount ? formatCount(p.itemCount) : 'Empty'}
                    </span>
                    <span className={`opt proj-state state-${state.tone}`}>
                      {state.icon}
                      {state.text}
                    </span>
                    <span style={{ color: 'var(--ink-4)' }}>{formatAgo(p.updatedAt)}</span>
                    <span />
                  </a>
                  <RowMenu project={p} open={open} onDone={showToast} />
                </div>
              );
            })}
          </>
        ) : (
          <div className="proj-grid">
            {rows.map((p) => {
              const card = cards.get(p.id);
              const state = stateOf(card, p.itemCount);
              const room = card ? boundsOf(card.project.space.boundary) : null;
              return (
                <a key={p.id} href={`#/p/${p.id}`} className="proj-card" data-project={p.id}>
                  <span className="proj-card-art">{card && <ProjectThumb project={card.project} width={230} height={160} />}</span>
                  <span className="proj-card-title">
                    <span className="serif">{p.name}</span>
                    <span className="faint" style={{ fontSize: 12, whiteSpace: 'nowrap' }}>
                      {formatAgo(p.updatedAt)}
                    </span>
                  </span>
                  <span className="proj-sub" style={{ fontSize: 13, marginTop: 6 }}>
                    {[card ? packOf(card.activity.pack).label : null, room ? `${formatMetres(room.maxX - room.minX)} × ${formatMetres(room.maxY - room.minY)} m` : null, plural(p.itemCount, 'item')].filter(Boolean).join(' · ')}
                  </span>
                  <span className={`proj-state state-${state.tone}`} style={{ fontSize: 13, marginTop: 10 }}>
                    {state.icon}
                    {state.text}
                  </span>
                </a>
              );
            })}
          </div>
        )}
      </main>
      <div className="toast fixed" role="status" hidden={!toast}>
        <Check size={16} />
        {toast}
      </div>
      {creating && <CreateDialog onClose={() => setCreating(false)} open={open} />}
    </div>
  );
}

function CardMeta({ card, items }: { card: ProjectCard; items: number }) {
  const pack = packOf(card.activity.pack);
  const room = boundsOf(card.project.space.boundary);
  const seats = Object.values(card.project.items).reduce((n, i) => n + (card.project.catalog[i.definitionId]?.seats ?? 0), 0);
  return (
    <>
      {[pack.label, pack.styles.find((s) => s.id === card.activity.style)?.label, `${formatMetres(room.maxX - room.minX)} × ${formatMetres(room.maxY - room.minY)} m`, seats ? plural(seats, 'seat') : plural(items, 'item')].filter(Boolean).join(' · ')}
    </>
  );
}

function RowMenu({ project, open, onDone }: { project: ProjectSummary; open: (id: string) => void; onDone: (text: string) => void }) {
  return (
    <Menu
      label={`Actions for ${project.name}`}
      button={(isOpen, toggle) => (
        <button type="button" className="row-menu-btn" title="More actions" aria-label={`More actions for ${project.name}`} aria-expanded={isOpen} onClick={toggle}>
          <DotsThree size={18} />
        </button>
      )}
    >
      {(close) => (
        <>
          <button type="button" role="menuitem" onClick={() => open(project.id)}>
            <ArrowUpRight size={16} />
            Open
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              close();
              void api.duplicateProject(project.id).then(() => onDone('Project duplicated'));
            }}
          >
            <Copy size={16} />
            Duplicate
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              close();
              void api.getProject(project.id).then((p) => download(`${p.name}.json`, serializeProject(p)));
            }}
          >
            <DownloadSimple size={16} />
            Export project file
          </button>
          <button
            type="button"
            role="menuitem"
            className="danger"
            onClick={() => {
              close();
              if (window.confirm(`Delete “${project.name}” and its whole history? This cannot be undone.`)) void api.deleteProject(project.id).then(() => onDone('Project deleted'));
            }}
          >
            <Trash size={16} />
            Delete
          </button>
        </>
      )}
    </Menu>
  );
}

interface Template {
  readonly id: string;
  readonly name: string;
  readonly desc: string;
  readonly width: number;
  readonly depth: number;
  readonly ceiling: number;
  readonly pack: PackId;
  /** The ready-made 10 × 8 m demo hall from the server, with a door and a column. */
  readonly demo?: boolean;
}

const TEMPLATES: readonly Template[] = [
  { id: 'hall', name: 'Event hall', desc: '24 × 16 m · 4.5 m ceiling · one door', width: 24, depth: 16, ceiling: 4.5, pack: 'hall' },
  { id: 'office', name: 'Open office', desc: '32 × 18 m · 3.0 m ceiling · one door', width: 32, depth: 18, ceiling: 3, pack: 'office' },
  { id: 'meeting', name: 'Meeting room', desc: '7.2 × 5.4 m · 2.8 m ceiling · one door', width: 7.2, depth: 5.4, ceiling: 2.8, pack: 'office' },
  { id: 'demo', name: 'Demo hall', desc: '10 × 8 m · a door and a column to try things', width: 10, depth: 8, ceiling: 3, pack: 'hall', demo: true },
  { id: 'warehouse', name: 'Reference warehouse', desc: '30 × 20 m · 5 rack rows · 240 pallet positions', width: 30, depth: 20, ceiling: 8, pack: 'warehouse' },
  { id: 'warehouse-empty', name: 'Empty warehouse', desc: '30 × 20 m · add your own rack rows and zones', width: 30, depth: 20, ceiling: 8, pack: 'warehouse' },
  { id: 'production', name: 'Reference production line', desc: '30 × 8 m · source → machine → buffer → machine → inspection → finished goods', width: 30, depth: 8, ceiling: 4, pack: 'production' },
  { id: 'production-empty', name: 'Empty production floor', desc: '30 × 8 m · add your own stations', width: 30, depth: 8, ceiling: 4, pack: 'production' },
  { id: 'depot', name: 'Reference depot', desc: '30 × 18 m · a two-way lane · 6 bays, 2 occupied', width: 30, depth: 18, ceiling: 4, pack: 'depot' },
  { id: 'depot-empty', name: 'Empty depot', desc: '30 × 18 m · add your own lanes, bays and vehicles', width: 30, depth: 18, ceiling: 4, pack: 'depot' },
  { id: 'blank', name: 'Blank', desc: 'Any size · add everything yourself', width: 12, depth: 9, ceiling: 3, pack: 'hall' },
];

/** "Start with the room": name, activity, size and a live preview; opens the editor when done. */
function CreateDialog({ onClose, open }: { onClose: () => void; open: (id: string) => void }) {
  const [template, setTemplate] = useState<Template>(TEMPLATES.find((t) => t.id === 'blank')!);
  const [name, setName] = useState('');
  const [activity, setActivity] = useState<PackId>('hall');
  const [width, setWidth] = useState<number | undefined>(12);
  const [depth, setDepth] = useState<number | undefined>(9);
  const [ceiling, setCeiling] = useState<number | undefined>(3);
  const [touched, setTouched] = useState(false);
  const [containerId, setContainerId] = useState(CONTAINER_TYPES[0]!.id);
  const isContainer = activity === 'container';
  const container = CONTAINER_TYPES.find((c) => c.id === containerId)!;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sizeOk = isContainer || ((width ?? 0) > 0 && (depth ?? 0) > 0);
  const valid = sizeOk && (name.trim() !== '' || template.demo === true);
  const w = isContainer ? container.length / 10_000 : (width ?? 0);
  const d = isContainer ? container.width / 10_000 : (depth ?? 0);
  const k = w > 0 && d > 0 ? Math.min(300 / w, 130 / d) : 0;
  const choose = (t: Template) => {
    setTemplate(t);
    setWidth(t.width);
    setDepth(t.depth);
    setCeiling(t.ceiling);
    setActivity(t.pack);
  };
  const create = async () => {
    if (!valid) {
      setTouched(true);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const project = isContainer
        ? await api.createProject({ name: name.trim(), activity: 'container', container_type: containerId })
        : template.id === 'warehouse' && activity === 'warehouse' && width === 30 && depth === 20 && ceiling === 8
        ? await api.createProject({ name: name.trim() || 'Reference warehouse', template: 'warehouse-reference' })
        : template.id === 'production' && activity === 'production' && width === 30 && depth === 8 && ceiling === 4
        ? await api.createProject({ name: name.trim() || 'Reference production line', template: 'production-reference' })
        : template.id === 'depot' && activity === 'depot' && width === 30 && depth === 18 && ceiling === 4
        ? await api.createProject({ name: name.trim() || 'Reference depot', template: 'depot-reference' })
        : template.demo
        ? await api.createProject({ name: name.trim() || 'Demo hall 10 × 8 m', template: 'demo' })
        : await api.createProject({ name: name.trim(), width_m: w, depth_m: d, activity, ...(ceiling === undefined ? {} : { ceiling_m: ceiling }) });
      open(project.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };
  return (
    <Dialog label="Create project" onClose={onClose} className="create">
      <form
        className="create-form"
        onSubmit={(e) => {
          e.preventDefault();
          void create();
        }}
      >
        <div className="kicker" style={{ letterSpacing: '.12em' }}>
          New project
        </div>
        <h2>Start with the room.</h2>
        <p className="intro">Doors, columns and items can be added inside the project.</p>
        <label className="stack">
          Project name
          <input
            className={`input${touched && !name.trim() && !template.demo ? ' invalid' : ''}`}
            name="project-name"
            autoFocus
            placeholder="Client — venue"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <div className="stack" style={{ marginTop: 20 }}>
          Activity
          <div className="activity-cards" role="group" aria-label="Activity">
            {(
              [
                ['hall', 'Event hall', 'Weddings, conferences, galas', <Confetti size={22} />],
                ['office', 'Office', 'Workstations, meeting rooms', <Briefcase size={22} />],
                ['container', 'Container', 'Cargo loading plans', <Package size={22} />],
                ['warehouse', 'Warehouse', 'Racks, capacity and forklift routes', <Warehouse size={22} />],
                ['production', 'Production line', 'Machines, buffers and material flow', <Factory size={22} />],
                ['depot', 'Vehicle depot', 'Parking bays, lanes and turning paths', <Car size={22} />],
              ] as const
            ).map(([id, label, hint, icon]) => (
              <button
                key={id}
                type="button"
                className={`activity-card${activity === id ? ' active' : ''}`}
                aria-pressed={activity === id}
                data-activity={id}
                disabled={template.demo && id !== 'container'}
                onClick={() => {
                  if (id === 'warehouse') choose(TEMPLATES.find((t) => t.id === 'warehouse')!);
                  else if (id === 'production') choose(TEMPLATES.find((t) => t.id === 'production')!);
                  else if (id === 'depot') choose(TEMPLATES.find((t) => t.id === 'depot')!);
                  else setActivity(id);
                  if (id === 'container' && template.demo) setTemplate(TEMPLATES.find((t) => t.id === 'blank')!);
                }}
              >
                {icon}
                <span>
                  <span style={{ display: 'block', fontSize: 13.5, fontWeight: 500 }}>{label}</span>
                  <span className="hint">{hint}</span>
                </span>
              </button>
            ))}
          </div>
        </div>
        {isContainer ? (
          <label className="stack" style={{ marginTop: 20 }}>
            Container type
            <select className="input" name="container-type" value={containerId} onChange={(e) => setContainerId(e.target.value)}>
              {CONTAINER_TYPES.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label}
                </option>
              ))}
            </select>
          </label>
        ) : (
        <div className="grid-3" style={{ marginTop: 20 }}>
          <NumberField variant="stack" name="new-width" label="Width" unit="m" value={width} min={1} max={500} onChange={setWidth} />
          <NumberField variant="stack" name="new-depth" label="Depth" unit="m" value={depth} min={1} max={500} onChange={setDepth} />
          <NumberField variant="stack" name="new-ceiling" label="Ceiling height" unit="m" value={ceiling} min={0.5} max={50} allowEmpty onChange={setCeiling} />
        </div>
        )}
        {!sizeOk && (
          <p className="error-text" style={{ marginTop: 8, fontSize: 12, display: 'flex', gap: 6, alignItems: 'center' }}>
            <XCircle size={14} />
            Width and depth must be more than 0.
          </p>
        )}
        {error && (
          <p className="error-text" style={{ marginTop: 8, fontSize: 12 }}>
            {error}
          </p>
        )}
        <button type="submit" hidden />
      </form>
      <div className="create-side">
        <div className="room-preview">
          <span className="room" style={{ width: Math.max(8, Math.round(w * k)), height: Math.max(8, Math.round(d * k)) }}>
            <span className="w">{w.toFixed(2)} m</span>
            <span className="d">{d.toFixed(2)} m</span>
          </span>
        </div>
        <div className="muted" style={{ marginTop: 10, fontSize: 12 }}>
          {isContainer
            ? `Inside ${w.toFixed(2)} × ${d.toFixed(2)} × ${(container.height / 10_000).toFixed(2)} m · ${(w * d * (container.height / 10_000)).toFixed(1)} m³ · typical payload ${(container.maxPayload / 1_000_000).toFixed(1)} t`
            : w && d
              ? `Floor area ${(w * d).toFixed(0)} m²${ceiling === undefined ? ' · ceiling not set' : ` · ceiling ${ceiling.toFixed(2)} m`}`
              : 'Enter a width and depth'}
        </div>
        <div className="kicker" style={{ marginTop: 28, letterSpacing: '.12em' }}>
          {isContainer ? 'Container types' : 'Templates'}
        </div>
        <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column' }}>
          {isContainer &&
            CONTAINER_TYPES.map((c) => {
              const kk = Math.min(46 / (c.length / 10_000), 32 / (c.width / 10_000));
              return (
                <button key={c.id} type="button" className={`template${containerId === c.id ? ' active' : ''}`} aria-pressed={containerId === c.id} data-container={c.id} onClick={() => setContainerId(c.id)}>
                  <span className="shape">
                    <span style={{ width: Math.round((c.length / 10_000) * kk), height: Math.max(4, Math.round((c.width / 10_000) * kk)) }} />
                  </span>
                  <span style={{ flex: 1 }}>
                    <span className="name">{c.label}</span>
                    <span className="desc">
                      {(c.length / 100).toFixed(0)} × {(c.width / 100).toFixed(0)} × {(c.height / 100).toFixed(0)} cm inside · {(c.maxPayload / 1_000_000).toFixed(1)} t
                    </span>
                  </span>
                  {containerId === c.id && <Check size={18} />}
                </button>
              );
            })}
          {!isContainer && TEMPLATES.map((t) => {
            const kk = Math.min(46 / t.width, 32 / t.depth);
            return (
              <button key={t.id} type="button" className={`template${template.id === t.id ? ' active' : ''}`} aria-pressed={template.id === t.id} data-template={t.id} onClick={() => choose(t)}>
                <span className="shape">
                  <span style={{ width: Math.round(t.width * kk), height: Math.round(t.depth * kk) }} />
                </span>
                <span style={{ flex: 1 }}>
                  <span className="name">{t.name}</span>
                  <span className="desc">{t.desc}</span>
                </span>
                {template.id === t.id && <Check size={18} />}
              </button>
            );
          })}
        </div>
        <span className="spacer" style={{ minHeight: 24 }} />
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <span className="spacer faint" style={{ fontSize: 12 }}>
            {valid ? 'Opens the plan editor' : 'Add a project name to continue'}
          </span>
          <button type="button" className="btn large" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn primary large" disabled={busy} aria-disabled={!valid} onClick={() => void create()} data-testid="create-project">
            {busy && <SpinnerGap size={16} />}
            {busy ? 'Creating…' : 'Create project'}
          </button>
        </div>
      </div>
    </Dialog>
  );
}
