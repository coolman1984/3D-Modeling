import type { Issue } from '@space-planner/core';
import type { RuleResult } from '@space-planner/starter';
import { ISSUE_GROUP, ISSUE_GROUPS } from './messages.js';

/**
 * The review in numbers. Kept apart from the inspector so the projects list can count without
 * loading the editor and its 3D engine.
 */
/** Everything the review counts, shared by the inspector tab, the status bar and the summary box. */
export interface ReviewSummary {
  readonly errors: number;
  readonly warnings: number;
  readonly passed: number;
  readonly unknown: number;
  /** errors + warnings: what the Review tab badge shows. */
  readonly findings: number;
}

export function summarize(issues: readonly Issue[], rules: readonly RuleResult[]): ReviewSummary {
  const errors = issues.filter((i) => i.severity === 'error').length;
  const warnings = issues.filter((i) => i.severity === 'warning').length + rules.filter((r) => r.status === 'fail').length;
  const unknown = issues.filter((i) => i.severity === 'info').length + rules.filter((r) => r.status === 'unknown').length;
  const cleanGroups = ISSUE_GROUPS.filter((g) => !issues.some((i) => ISSUE_GROUP[i.code] === g)).length;
  const passed = cleanGroups + rules.filter((r) => r.status === 'pass').length;
  return { errors, warnings, passed, unknown, findings: errors + warnings };
}

