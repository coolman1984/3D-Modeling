import { checkProject } from '@space-planner/core';
import { checkPack, detectPack, packOf, type Figure, type PackId } from '@space-planner/starter';
import type { ProjectSummary, Store } from './store.js';

/** One column of a variant comparison: the project, its issues, rules and the pack's figures. */
export interface VariantRow {
  readonly project: ProjectSummary;
  readonly base: boolean;
  readonly pack: PackId;
  readonly errors: number;
  readonly warnings: number;
  readonly rulesFailed: number;
  readonly rulesUnknown: number;
  readonly figures: readonly Figure[];
}

/**
 * The base and its variants side by side, measured the same way (the pack's first style when a
 * pack has styles). Deterministic: same projects, same rows.
 */
export function compareFamily(store: Store, id: string, style?: string): VariantRow[] {
  return store.familyOf(id).flatMap((summary, k) => {
    const project = store.getProject(summary.id);
    if (!project) return [];
    const pack = detectPack(project);
    const issues = checkProject(project);
    const rules = checkPack(project, pack, style);
    return [
      {
        project: summary,
        base: k === 0 && summary.variantOf === null,
        pack,
        errors: issues.filter((i) => i.severity === 'error').length,
        warnings: issues.filter((i) => i.severity === 'warning').length,
        rulesFailed: rules.filter((r) => r.status === 'fail').length,
        rulesUnknown: rules.filter((r) => r.status === 'unknown').length,
        figures: packOf(pack).figures(project),
      },
    ];
  });
}

/** A figure as text for agents and logs. */
export function figureText(f: Figure): string {
  if (f.value === undefined) return 'unknown';
  switch (f.unit) {
    case 'percent':
      return `${(f.value * 100).toFixed(1)}%`;
    case 'square-metres':
      return `${f.value} m²`;
    case 'grams':
      return `${Math.round(f.value / 100) / 10} kg`;
    case 'ticks':
      return `${Math.round(f.value / 100) / 100} m`;
    default:
      return String(f.value);
  }
}
