import { hallStyle, type HallStyle } from '@space-planner/starter';

const key = (projectId: string) => `space-planner.hall-style.${projectId}`;

/** The event style chosen for a project, kept in this browser (banquet when never chosen). */
export function loadHallStyle(projectId: string): HallStyle {
  try {
    return hallStyle(globalThis.localStorage?.getItem(key(projectId))).id;
  } catch {
    return hallStyle(null).id;
  }
}

export function saveHallStyle(projectId: string, style: HallStyle): void {
  try {
    globalThis.localStorage?.setItem(key(projectId), style);
  } catch {
    // Storage may be refused (private windows); the choice still holds for this visit.
  }
}
