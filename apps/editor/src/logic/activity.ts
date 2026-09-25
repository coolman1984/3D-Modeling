import type { Project } from '@space-planner/core';
import { detectPack, packOf, type PackId } from '@space-planner/starter';

/** Which activity pack a project is checked as, and for which style (a banquet, an open-plan office…). */
export interface Activity {
  readonly pack: PackId;
  readonly style: string;
}

const key = (projectId: string) => `space-planner.activity.${projectId}`;
const oldHallKey = (projectId: string) => `space-planner.hall-style.${projectId}`;

/** Keep the style only when it belongs to the pack; otherwise use the pack's first style. */
export function activityOf(pack: string | null | undefined, style: string | null | undefined): Activity {
  const p = packOf(pack);
  return { pack: p.id, style: p.styles.some((s) => s.id === style) ? style! : p.styles[0]!.id };
}

/**
 * The activity chosen for a project in this browser; when none was chosen, the pack read
 * from the project's catalog. Hall styles saved by the previous version are kept.
 */
export function loadActivity(project: Project): Activity {
  try {
    const saved = globalThis.localStorage?.getItem(key(project.id));
    if (saved) {
      const value = JSON.parse(saved) as { pack?: unknown; style?: unknown };
      return activityOf(typeof value.pack === 'string' ? value.pack : null, typeof value.style === 'string' ? value.style : null);
    }
    const oldStyle = globalThis.localStorage?.getItem(oldHallKey(project.id));
    if (oldStyle) return activityOf('hall', oldStyle);
  } catch {
    // Unreadable storage: fall back to the catalog.
  }
  return activityOf(detectPack(project), null);
}

export function saveActivity(projectId: string, activity: Activity): void {
  try {
    globalThis.localStorage?.setItem(key(projectId), JSON.stringify(activity));
  } catch {
    // Storage may be refused (private windows); the choice still holds for this visit.
  }
}
