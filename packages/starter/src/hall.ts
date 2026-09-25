import { fromUnit, type Project, type Tick } from '@space-planner/core';
import { areaRule, exitRules, walkwayRule, type RuleResult } from './rules.js';

/**
 * Hall rules: guidance for event halls, kept in the hall pack so the core stays free of
 * activity knowledge. The numbers are common planning guidance, not a civil-defence approval.
 */

export type HallStyle = 'banquet' | 'theatre' | 'classroom';

export interface HallStyleSpec {
  readonly id: HallStyle;
  readonly label: string;
  /** Floor area each guest needs, in square metres. */
  readonly areaPerGuest: number;
  /** Clear width of the walkway from every seat to a door. */
  readonly walkway: Tick;
}

const cm = (v: number) => fromUnit(v, 'cm');

export const HALL_STYLES: readonly HallStyleSpec[] = [
  { id: 'banquet', label: 'عشاء أو فرح (ترابيزات)', areaPerGuest: 1.2, walkway: cm(90) },
  { id: 'theatre', label: 'مسرح أو محاضرة (صفوف)', areaPerGuest: 0.7, walkway: cm(100) },
  { id: 'classroom', label: 'فصل أو ورشة (ترابيزات صغيرة)', areaPerGuest: 1.6, walkway: cm(90) },
];

export function hallStyle(id: string | null | undefined): HallStyleSpec {
  return HALL_STYLES.find((s) => s.id === id) ?? HALL_STYLES[0]!;
}

/**
 * Check a hall against the style's rules. Deterministic; results always in the same order.
 * Seats are items whose type has seats; guests are the total seats.
 */
export function checkHall(project: Project, styleId: HallStyle = 'banquet'): RuleResult[] {
  const style = hallStyle(styleId);
  return [walkwayRule(project, style.walkway), areaRule('area-per-guest', project, style.areaPerGuest), ...exitRules(project)];
}
