import { boundsOf, checkProject, itemPolygon, type Project } from '@space-planner/core';
import { checkPack } from '@space-planner/starter';
import { useEffect, useState, type CSSProperties, type ReactNode } from 'react';
import { api } from '../api.js';
import { loadActivity } from '../logic/activity.js';
import { pathOf, fitViewport, toScreen } from '../logic/viewport.js';
import { homeFill, homeSymbol } from './PlanSymbols.js';
import { summarize, type ReviewSummary } from '../logic/review.js';
import { Brand } from './Fields.js';

/** Header of the projects and settings pages: brand, navigation and whether the local server answers. */
export function SiteHeader({ active, right }: { active: 'projects' | 'settings'; right?: ReactNode }) {
  const [online, setOnline] = useState<boolean | null>(null);
  useEffect(() => {
    let alive = true;
    const ping = () =>
      fetch('/api/health')
        .then((r) => alive && setOnline(r.ok))
        .catch(() => alive && setOnline(false));
    ping();
    const timer = setInterval(ping, 15_000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, []);
  return (
    <header className="site-head">
      <Brand />
      <nav className="site-nav" aria-label="Main">
        <a href="#/" className={active === 'projects' ? 'active' : ''} aria-current={active === 'projects' ? 'page' : undefined}>
          Projects
        </a>
        <a href="#/settings" className={active === 'settings' ? 'active' : ''} aria-current={active === 'settings' ? 'page' : undefined}>
          Settings
        </a>
      </nav>
      <span className="spacer" />
      {right ?? (
        <span className="server-state" role="status">
          <span className="dot" style={{ background: online === false ? 'var(--error)' : online ? 'var(--ok)' : 'var(--ink-5)' }} />
          {online === false ? 'Server not reachable' : online ? 'Server connected' : 'Connecting…'}
        </span>
      )}
    </header>
  );
}

/** A tiny top view of a project: walls, columns and item outlines, for lists and cards. */
export function ProjectThumb({ project, width, height, dark = false }: { project: Project; width: number; height: number; dark?: boolean }) {
  const room = boundsOf(project.space.boundary);
  const v = fitViewport(room, width, height, 4);
  const ink = dark ? 'rgba(233,230,224,.85)' : 'var(--ink)';
  const soft = dark ? 'rgba(233,230,224,.45)' : 'color-mix(in srgb, var(--ink) 55%, transparent)';
  // Rugs under the furniture; home pieces drawn with their plan symbol and soft colour.
  const layer = (item: (typeof project.items)[string]) => (project.catalog[item.definitionId]?.surface ? -1 : (item.elevation ?? 0));
  const items = Object.values(project.items).sort((a, b) => layer(a) - layer(b));
  const lines = dark ? ({ '--ink-2': 'rgba(233,230,224,.75)', '--ink-3': 'rgba(233,230,224,.45)', '--paper': '#161a22' } as CSSProperties) : undefined;
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden="true" style={lines}>
      <path d={pathOf(v, project.space.boundary)} fill={dark ? 'transparent' : 'var(--paper)'} stroke={ink} strokeWidth={dark ? 2 : 1.5} />
      {project.space.obstacles.map((o) => (
        <path key={o.id} d={pathOf(v, o.polygon)} fill={ink} />
      ))}
      {items.map((item) => {
        const definition = project.catalog[item.definitionId];
        if (!definition) return null;
        const solid = definition.category === 'stage' || definition.category === 'wall';
        const symbol = homeSymbol(definition);
        const centre = toScreen(v, item.position);
        return (
          <g key={item.id}>
            <path d={pathOf(v, itemPolygon(item, definition))} fill={solid ? ink : symbol && !dark ? (homeFill(definition) ?? 'none') : 'none'} stroke={definition.seats && !symbol ? soft : ink} strokeWidth={0.8} />
            {symbol && Math.min(definition.size.w, definition.size.d) * v.scale > 6 && (
              <g transform={`translate(${centre.x.toFixed(1)},${centre.y.toFixed(1)}) rotate(${(-item.rotation / 1000).toFixed(2)}) scale(${v.scale})`}>{symbol}</g>
            )}
          </g>
        );
      })}
    </svg>
  );
}

/** A project with what the lists show about it, worked out from the saved revision. */
export interface ProjectCard {
  readonly project: Project;
  readonly summary: ReviewSummary;
  readonly activity: ReturnType<typeof loadActivity>;
}

export function cardOf(project: Project): ProjectCard {
  const activity = loadActivity(project);
  return { project, activity, summary: summarize(checkProject(project), checkPack(project, activity.pack, activity.style)) };
}

/** The whole projects, loaded after the list so the page appears at once. */
export function useProjectCards(ids: readonly string[], versions: string): Map<string, ProjectCard> {
  const [cards, setCards] = useState(new Map<string, ProjectCard>());
  useEffect(() => {
    let alive = true;
    void Promise.all(ids.map((id) => api.getProject(id).then(cardOf).catch(() => null))).then((list) => {
      if (alive) setCards(new Map(list.filter((c): c is ProjectCard => c !== null).map((c) => [c.project.id, c])));
    });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [versions]);
  return cards;
}
