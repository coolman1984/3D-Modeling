import { deserializeProject, serializeProject, type Project } from '@space-planner/core';

const AUTOSAVE_KEY = 'space-planner.autosave.v1';

/** Browser storage can be missing or blocked; autosave is a convenience, never the only copy. */
export function loadAutosave(): Project | null {
  try {
    const text = localStorage.getItem(AUTOSAVE_KEY);
    if (!text) return null;
    const result = deserializeProject(text);
    return result.ok ? result.project : null;
  } catch {
    return null;
  }
}

export function saveAutosave(project: Project): boolean {
  try {
    localStorage.setItem(AUTOSAVE_KEY, serializeProject(project));
    return true;
  } catch {
    return false;
  }
}

export function downloadProject(project: Project): void {
  const blob = new Blob([serializeProject(project)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${project.name || 'مخطط'}.json`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
