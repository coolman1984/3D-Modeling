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
  type Vec2,
} from '@space-planner/core';

/** Everything the editor remembers besides the view. All project changes go through core commands. */
export interface Session {
  readonly history: History;
  readonly selectedId: Id | null;
  /** An item being dragged: shown at `to`, committed as one move command on drop. */
  readonly drag: { readonly id: Id; readonly to: Vec2 } | null;
  /** Why the last action was refused, for the status line. */
  readonly rejection: Rejection | null;
  /** Commands applied here but not yet saved on the server, each with the revision it produced. */
  readonly outbox: readonly { readonly revision: number; readonly command: Command }[];
}

export type Action =
  | { readonly type: 'command'; readonly command: Command; readonly select?: Id | null }
  | { readonly type: 'undo' }
  | { readonly type: 'redo' }
  | { readonly type: 'select'; readonly id: Id | null }
  | { readonly type: 'drag-move'; readonly id: Id; readonly to: Vec2 }
  | { readonly type: 'drag-end' }
  | { readonly type: 'drag-cancel' }
  | { readonly type: 'load'; readonly project: Project }
  | { readonly type: 'saved'; readonly revision: number };

export function startSession(project: Project): Session {
  return { history: startHistory(project), selectedId: null, drag: null, rejection: null, outbox: [] };
}

export function reduce(session: Session, action: Action): Session {
  switch (action.type) {
    case 'command': {
      const step = execute(session.history, action.command);
      if (!step.ok) return { ...session, rejection: step.outcome?.rejection ?? null };
      const selectedId = action.select === undefined ? session.selectedId : action.select;
      return {
        ...session,
        history: step.history,
        selectedId: keep(step.history.project, selectedId),
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
        selectedId: keep(step.history.project, session.selectedId),
        drag: null,
        rejection: null,
      };
    }
    case 'select':
      return { ...session, selectedId: keep(session.history.project, action.id) };
    case 'drag-move':
      return { ...session, drag: { id: action.id, to: action.to }, selectedId: action.id };
    case 'drag-end': {
      const { drag } = session;
      if (!drag) return session;
      const item = session.history.project.items[drag.id];
      const cleared = { ...session, drag: null };
      if (!item || (item.position.x === drag.to.x && item.position.y === drag.to.y)) return cleared;
      return reduce(cleared, { type: 'command', command: { type: 'item.move', id: drag.id, to: drag.to } });
    }
    case 'drag-cancel':
      return { ...session, drag: null };
    case 'load':
      return { ...startSession(action.project), selectedId: keep(action.project, session.selectedId) };
    case 'saved':
      return { ...session, outbox: session.outbox.filter((entry) => entry.revision > action.revision) };
  }
}

/** What to draw and check: the saved project, with a dragged item shown at its preview spot. */
export function visibleProject(session: Session): Project {
  const { drag, history } = session;
  if (!drag) return history.project;
  const preview = apply(history.project, { type: 'item.move', id: drag.id, to: drag.to });
  return preview.ok ? preview.project : history.project;
}

function keep(project: Project, id: Id | null): Id | null {
  return id !== null && project.items[id] ? id : null;
}
