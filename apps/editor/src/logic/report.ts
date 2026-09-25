import {
  boundsOf,
  checkProject,
  measureProject,
  toSquareMetres,
  type Id,
  type Project,
  type Severity,
  type Size3,
  type Tick,
} from '@space-planner/core';
import { checkPack, packOf, type RuleResult } from '@space-planner/starter';
import { activityOf, type Activity } from './activity.js';
import { describeIssue, describeRule, ISSUE_TITLES, RULE_TITLES } from './messages.js';

/** One line of the client's bill of materials; `key` is the number drawn on the plan. */
export interface ReportLine {
  readonly key: number;
  readonly definitionId: Id;
  readonly name: string;
  readonly size: Size3;
  readonly count: number;
  readonly seats: number;
}

export interface ReportIssue {
  readonly severity: Severity;
  readonly title: string;
  readonly text: string;
}

/**
 * Everything the printed client report shows, computed from one saved revision.
 * Pure: the same project always gives the same report (the print date comes from outside).
 */
export interface ReportData {
  readonly name: string;
  readonly revision: number;
  readonly room: {
    readonly width: Tick;
    readonly depth: Tick;
    readonly ceiling: Tick | undefined;
    readonly doors: number;
    readonly columns: number;
    /** Square metres, columns and blocked zones taken out. */
    readonly floorArea: number;
  };
  readonly totals: {
    readonly items: number;
    readonly seats: number;
    /** Square metres covered by furniture. */
    readonly occupiedArea: number;
    readonly occupancy: number;
    /** Square metres of floor per seat; undefined when there are no seats. */
    readonly areaPerSeat: number | undefined;
  };
  readonly lines: readonly ReportLine[];
  /** Plan number of each placed item, by item id. */
  readonly keyOf: Readonly<Record<Id, number>>;
  readonly issues: readonly ReportIssue[];
  readonly counts: { readonly error: number; readonly warning: number; readonly info: number };
  /** The activity and style the rules were checked for, e.g. "قاعة مناسبات", "مسرح أو محاضرة". */
  readonly activity: { readonly pack: string; readonly label: string; readonly style: string; readonly styleLabel: string };
  readonly rules: readonly (ReportIssue & { readonly code: RuleResult['code']; readonly status: RuleResult['status'] })[];
  /** 'ready' only when nothing is wrong or unknown and every hall rule passes. */
  readonly verdict: 'ready' | 'check' | 'problems';
}

export function buildReport(project: Project, chosen: Activity = activityOf('hall', null)): ReportData {
  const activity = activityOf(chosen.pack, chosen.style);
  const pack = packOf(activity.pack);
  const rules = checkPack(project, pack.id, activity.style);
  const metrics = measureProject(project);
  const issues = checkProject(project);
  const box = boundsOf(project.space.boundary);
  const lines: ReportLine[] = metrics.bom.map((line, i) => ({
    key: i + 1,
    definitionId: line.definitionId,
    name: line.name,
    size: line.size,
    count: line.count,
    seats: line.seats,
  }));
  const keyByDefinition = new Map(lines.map((l) => [l.definitionId, l.key]));
  const keyOf: Record<Id, number> = {};
  for (const item of Object.values(project.items)) keyOf[item.id] = keyByDefinition.get(item.definitionId) ?? 0;
  const counts = { error: 0, warning: 0, info: 0 };
  for (const issue of issues) counts[issue.severity]++;
  const floorArea = toSquareMetres(metrics.floorArea);
  return {
    name: project.name,
    revision: project.revision,
    room: {
      width: box.maxX - box.minX,
      depth: box.maxY - box.minY,
      ceiling: project.space.ceilingHeight,
      doors: project.space.doors.length,
      columns: project.space.obstacles.filter((o) => o.kind === 'column').length,
      floorArea,
    },
    totals: {
      items: metrics.itemCount,
      seats: metrics.seats,
      occupiedArea: toSquareMetres(metrics.occupiedArea),
      occupancy: metrics.occupancy,
      areaPerSeat: metrics.seats > 0 ? floorArea / metrics.seats : undefined,
    },
    lines,
    keyOf,
    issues: issues.map((issue) => ({ severity: issue.severity, title: ISSUE_TITLES[issue.code], text: describeIssue(project, issue) })),
    counts,
    activity: { pack: pack.id, label: pack.label, style: activity.style, styleLabel: pack.styles.find((s) => s.id === activity.style)!.label },
    rules: rules.map((rule) => ({
      code: rule.code,
      status: rule.status,
      severity: rule.status === 'fail' ? 'warning' : 'info',
      title: RULE_TITLES[rule.code],
      text: describeRule(project, rule),
    })),
    verdict: counts.error > 0 ? 'problems' : counts.warning > 0 || counts.info > 0 || rules.some((r) => r.status !== 'pass') ? 'check' : 'ready',
  };
}
