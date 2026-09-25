import type { Project } from '../model/types.js';
import { apply, type Outcome } from './apply.js';
import type { Command } from './types.js';

/** An editing session: the current project plus what can be undone and redone. */
export interface History {
  readonly project: Project;
  /** Inverse commands, most recent last. */
  readonly undoStack: readonly Command[];
  /** Commands that re-apply undone work, most recent last. */
  readonly redoStack: readonly Command[];
  /** Oldest undo steps are dropped beyond this many. */
  readonly limit: number;
}

export function startHistory(project: Project, limit = 200): History {
  return { project, undoStack: [], redoStack: [], limit };
}

export type HistoryStep =
  | { readonly ok: true; readonly history: History }
  | { readonly ok: false; readonly history: History; readonly outcome?: Extract<Outcome, { ok: false }> };

/** Apply a new command. Success clears the redo stack. */
export function execute(history: History, command: Command): HistoryStep {
  const outcome = apply(history.project, command);
  if (!outcome.ok) return { ok: false, history, outcome };
  const undoStack = [...history.undoStack, outcome.inverse].slice(-history.limit);
  return { ok: true, history: { ...history, project: outcome.project, undoStack, redoStack: [] } };
}

export function canUndo(history: History): boolean {
  return history.undoStack.length > 0;
}

export function canRedo(history: History): boolean {
  return history.redoStack.length > 0;
}

/** Undo the last command. Undo is itself a new revision; history is never rewritten. */
export function undo(history: History): HistoryStep {
  return step(history, 'undo');
}

export function redo(history: History): HistoryStep {
  return step(history, 'redo');
}

function step(history: History, direction: 'undo' | 'redo'): HistoryStep {
  const from = direction === 'undo' ? history.undoStack : history.redoStack;
  const command = from.at(-1);
  if (!command) return { ok: false, history };
  const outcome = apply(history.project, command);
  if (!outcome.ok) return { ok: false, history, outcome };
  const remaining = from.slice(0, -1);
  const to = [...(direction === 'undo' ? history.redoStack : history.undoStack), outcome.inverse];
  return {
    ok: true,
    history: {
      ...history,
      project: outcome.project,
      undoStack: direction === 'undo' ? remaining : to,
      redoStack: direction === 'undo' ? to : remaining,
    },
  };
}
