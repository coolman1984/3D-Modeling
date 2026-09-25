import { boundsOf, checkProject, itemPolygon, type Project } from '@space-planner/core';
import { checkPack } from '@space-planner/starter';
import { useEffect, useState, type ReactNode } from 'react';
import { api } from '../api.js';
import { loadActivity } from '../logic/activity.js';
import { pathOf, fitViewport } from '../logic/viewport.js';
import { summarize, type ReviewSummary } from './Inspector.js';
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
  const ink = dark ? 'rgba(233,230,224,.85)' : '#1a1917';
  const soft = dark ? 'rgba(233,230,224,.45)' : 'rgba(26,25,23,.55)';
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden="true">
      <path d={pathOf(v, project.space.boundary)} fill={dark ? 'transparent' : '#fff'} stroke={ink} strokeWidth={dark ? 2 : 1.5} />
      {project.space.obstacles.map((o) => (
        <path key={o.id} d={pathOf(v, o.polygon)} fill={ink} />
      ))}
      {Object.values(project.items).map((item) => {
        const definition = project.catalog[item.definitionId];
        if (!definition) return null;
        const stage = definition.category === 'stage';
        return <path key={item.id} d={pathOf(v, itemPolygon(item, definition))} fill={stage ? ink : 'none'} stroke={definition.seats ? soft : ink} strokeWidth={0.8} />;
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
