import {
  apply,
  execute,
  redo,
  startHistory,
  undo,
  type Command,
  type History,
  type Id,
  type Project,
  type Rejection,
} from '@space-planner/core';

/** Everything the editor remembers besides the view. All project changes go through core commands. */
export interface Session {
  readonly history: History;
  /** Selected items, in the order they were picked (the first one leads snapping and the panel). */
  readonly selectedIds: readonly Id[];
  /**
   * A change being shown but not yet saved: a drag, a rotation or a held arrow key.
   * It is committed as one command (one history step, one revision) when the gesture ends.
   */
  readonly preview: Command | null;
  /** Why the last action was refused, for the status line. */
  readonly rejection: Rejection | null;
  /** Commands applied here but not yet saved on the server, each with the revision it produced. */
  readonly outbox: readonly { readonly revision: number; readonly command: Command }[];
}

/** How a pick changes the selection: replace it, add to it, or flip the picked items. */
export type SelectMode = 'replace' | 'add' | 'toggle';

export type Action =
  | { readonly type: 'command'; readonly command: Command; readonly select?: readonly Id[] }
  | { readonly type: 'undo' }
  | { readonly type: 'redo' }
  | { readonly type: 'select'; readonly ids: readonly Id[]; readonly mode?: SelectMode }
  | { readonly type: 'preview'; readonly command: Command | null }
  | { readonly type: 'preview-commit' }
  | { readonly type: 'preview-cancel' }
  | { readonly type: 'load'; readonly project: Project }
  | { readonly type: 'saved'; readonly revision: number };

export function startSession(project: Project): Session {
  return { history: startHistory(project), selectedIds: [], preview: null, rejection: null, outbox: [] };
}

export function reduce(session: Session, action: Action): Session {
  switch (action.type) {
    case 'command': {
      const step = execute(session.history, action.command);
      if (!step.ok) return { ...session, rejection: step.outcome?.rejection ?? null };
      const selectedIds = action.select ?? session.selectedIds;
      return {
        ...session,
        history: step.history,
        selectedIds: keep(step.history.project, selectedIds),
        rejection: null,
        outbox: [...session.outbox, { revision: step.history.project.revision, command: action.command }],
      };
    }
    case 'undo':
    case 'redo': {
      const stack = action.type === 'undo' ? session.history.undoStack : session.history.redoStack;
      const command = stack.at(-1);
      const step = action.type === 'undo' ? undo(session.history) : redo(session.history);
      if (!step.ok || !command) return session;
      return {
        ...session,
        outbox: [...session.outbox, { revision: step.history.project.revision, command }],
        history: step.history,
        selectedIds: keep(step.history.project, session.selectedIds),
        preview: null,
        rejection: null,
      };
    }
    case 'select':
      return { ...session, selectedIds: keep(session.history.project, pick(session.selectedIds, action.ids, action.mode ?? 'replace')) };
    case 'preview':
      return { ...session, preview: action.command };
    case 'preview-commit': {
      const { preview } = session;
      const cleared = { ...session, preview: null };
      if (!preview || !changes(session.history.project, preview)) return cleared;
      return reduce(cleared, { type: 'command', command: preview });
    }
    case 'preview-cancel':
      return { ...session, preview: null };
    case 'load':
      return { ...startSession(action.project), selectedIds: keep(action.project, session.selectedIds) };
    case 'saved':
      return { ...session, outbox: session.outbox.filter((entry) => entry.revision > action.revision) };
  }
}

/** What to draw and check: the saved project, with the change in progress shown on top. */
export function visibleProject(session: Session): Project {
  const { preview, history } = session;
  if (!preview) return history.project;
  const shown = apply(history.project, preview);
  return shown.ok ? shown.project : history.project;
}

function pick(current: readonly Id[], ids: readonly Id[], mode: SelectMode): readonly Id[] {
  if (mode === 'replace') return [...new Set(ids)];
  if (mode === 'add') return [...new Set([...current, ...ids])];
  const flip = new Set(ids);
  return [...current.filter((id) => !flip.has(id)), ...[...flip].filter((id) => !current.includes(id))];
}

function keep(project: Project, ids: readonly Id[]): readonly Id[] {
  return ids.filter((id) => project.items[id] !== undefined);
}

/** True when a command would change anything besides the revision counter (a drag back to the start does not). */
function changes(project: Project, command: Command): boolean {
  const result = apply(project, command);
  if (!result.ok) return true; // let `command` report the refusal
  return JSON.stringify(result.project.items) !== JSON.stringify(project.items) || result.project.space !== project.space || result.project.catalog !== project.catalog || result.project.name !== project.name;
}
