import type { Command, Project } from '@space-planner/core';

/**
 * A layout or packing proposal. Optimisers never change a project: they return commands that a
 * person or an agent applies through the normal path (one revision, undoable), usually into a
 * candidate variant first.
 */
export interface Candidate {
  /** Short name shown to people, e.g. "Heaviest first", "Balanced". */
  readonly label: string;
  /** Commands that turn the input project into this candidate. */
  readonly commands: readonly Command[];
  /** The numbers that make this candidate better or worse, in plain words and values. */
  readonly metrics: Readonly<Record<string, number>>;
  /** Why it looks the way it does; never a single mysterious score. */
  readonly explanation: string;
  /** What could not be placed or satisfied (item ids, rule codes). */
  readonly leftOver: readonly string[];
}

/** Anything that proposes candidates: a built-in heuristic now, an external solver later. */
/**
 * A simulator: reads a project and options, returns results. Like an optimiser it never changes
 * the project; its answers depend only on the data people entered (cycle times…), not on guesses.
 */
export interface SimulationPort<Options, Result> {
  readonly id: string;
  run(project: Project, options: Options): Result;
}

export interface OptimizationPort<Goal> {
  readonly id: string;
  /** Deterministic for the same project and goal. */
  propose(project: Project, goal: Goal): readonly Candidate[];
}
