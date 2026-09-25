import { measureProject, type Id, type Issue, type IssueCode, type Project, type RejectCode } from '@space-planner/core';
import type { RuleCode, RuleResult } from '@space-planner/starter';
import { formatCount, formatLength, formatSquareMetres } from './format.js';

export const ISSUE_TITLES: Readonly<Record<IssueCode, string>> = {
  'out-of-bounds': 'Outside the room',
  overlap: 'Items overlap',
  'on-obstacle': 'On a column or blocked zone',
  'door-blocked': 'Blocks a door',
  'too-tall': 'Taller than the ceiling',
  clearance: 'Not enough room to use it',
  'height-unknown': 'Ceiling height unknown',
};

/** The review groups findings are shown in, in this order. */
export type IssueGroup = 'Geometry' | 'Clearances' | 'Doors & exits' | 'Height';
export const ISSUE_GROUPS: readonly IssueGroup[] = ['Geometry', 'Clearances', 'Doors & exits', 'Height'];
export const ISSUE_GROUP: Readonly<Record<IssueCode, IssueGroup>> = {
  'out-of-bounds': 'Geometry',
  overlap: 'Geometry',
  'on-obstacle': 'Geometry',
  clearance: 'Clearances',
  'door-blocked': 'Doors & exits',
  'too-tall': 'Height',
  'height-unknown': 'Height',
};

/** Human name of any entity: item names from the catalog, doors and columns by kind. */
export function entityName(project: Project, id: Id): string {
  return `${shortName(project, id)} (${id})`;
}

/** The name alone, without the id: "Round table 180", "Door", "Column". */
export function shortName(project: Project, id: Id): string {
  const item = project.items[id];
  if (item) return project.catalog[item.definitionId]?.name ?? 'Item';
  if (project.space.doors.some((d) => d.id === id)) return 'Door';
  const obstacle = project.space.obstacles.find((o) => o.id === id);
  if (obstacle) return obstacle.kind === 'column' ? 'Column' : 'Blocked zone';
  return id;
}

/** One sentence the owner understands: what, with what, and by how much. */
export function describeIssue(project: Project, issue: Issue): string {
  const [first, second] = issue.entityIds.map((id) => entityName(project, id));
  const amount = issue.amount === undefined ? '' : formatLength(issue.amount);
  switch (issue.code) {
    case 'out-of-bounds':
      return `${first} sticks out past the wall. Move it back inside the room.`;
    case 'overlap':
      return `${first} overlaps ${second} by ${amount}. Move them at least ${amount} apart.`;
    case 'on-obstacle':
      return `${first} sits on ${second}${amount ? ` by ${amount}` : ''}. Move it clear.`;
    case 'door-blocked':
      return `${first} is in the swing of ${second}. Move it about ${amount} away.`;
    case 'too-tall':
      return `${first} is ${amount} taller than the ceiling.`;
    case 'clearance':
      return second
        ? `${first} needs free space to be used, and ${second} takes ${amount} of it.`
        : `${first} is against the wall without enough room to use it.`;
    case 'height-unknown':
      return 'Enter the ceiling height so heights can be checked.';
  }
}

/** A specific headline for a finding, e.g. "Round table 180 overlaps Column". */
export function issueHeadline(project: Project, issue: Issue): string {
  const [a, b] = issue.entityIds.map((id) => shortName(project, id));
  switch (issue.code) {
    case 'out-of-bounds':
      return `${a} is outside the walls`;
    case 'overlap':
      return `${a} overlaps ${b}`;
    case 'on-obstacle':
      return `${a} sits on ${(b ?? 'a column').toLowerCase()}`;
    case 'door-blocked':
      return `${a} blocks a door`;
    case 'too-tall':
      return `${a} is taller than the ceiling`;
    case 'clearance':
      return `${a} needs more room`;
    case 'height-unknown':
      return 'Ceiling height is not set';
  }
}

/** What was found and what is needed, e.g. ["14 cm overlap", "No overlap"]. */
export function issueAmounts(issue: Issue): { gap: string; need: string } | null {
  const amount = issue.amount === undefined ? null : formatLength(issue.amount);
  switch (issue.code) {
    case 'out-of-bounds':
      return { gap: 'Outside the walls', need: 'Inside the room' };
    case 'overlap':
      return { gap: amount ? `${amount} overlap` : 'Overlapping', need: 'No overlap' };
    case 'on-obstacle':
      return { gap: amount ? `${amount} over it` : 'On top of it', need: 'Clear of columns' };
    case 'door-blocked':
      return { gap: amount ? `${amount} in the door swing` : 'In the door swing', need: 'Swing kept clear' };
    case 'too-tall':
      return { gap: amount ? `${amount} too tall` : 'Too tall', need: 'Under the ceiling' };
    case 'clearance':
      return { gap: amount ? `Short by ${amount}` : 'Too close', need: 'Full clearance' };
    case 'height-unknown':
      return null;
  }
}

export const SEVERITY_WORD = { error: 'Error', warning: 'Warning', info: 'Unknown' } as const;

export const REJECTION_MESSAGES: Readonly<Record<RejectCode, string>> = {
  'invalid-payload': 'That value is not accepted.',
  'unknown-command': 'Unknown action.',
  'not-found': 'That item no longer exists.',
  'duplicate-id': 'That id is already in use.',
  locked: 'This item is locked. Unlock it first.',
  'in-use': 'This item type is placed on the plan.',
  'broken-reference': 'This item type is not in the library.',
  'empty-batch': 'Nothing to do.',
};

export const RULE_TITLES: Readonly<Record<RuleCode, string>> = {
  walkway: 'Walkway from every seat to a door',
  'area-per-guest': 'Floor area per guest',
  'area-per-person': 'Floor area per person',
  workstations: 'Every desk has a chair',
  exits: 'Number of exits',
  'door-width': 'Total door width',
};

/** How much weight a rule's numbers carry, in words. */
export const SOURCE_KIND_WORD = {
  engineering: 'Engineering check',
  'company-policy': 'Company policy',
  'common-guidance': 'Common guidance',
  'verified-regulation': 'Verified regulation',
} as const;

export const RULE_STATUS_WORD = { pass: 'Passes', fail: 'Fails', unknown: 'Unknown' } as const;

/** The measured and required values of a rule, in words; "—" when not known. */
export function ruleFigures(project: Project, rule: RuleResult): { measured: string; required: string } {
  const dash = '—';
  const seats = measureProject(project).seats;
  switch (rule.code) {
    case 'walkway':
      return {
        measured: rule.measured === undefined ? dash : `${formatCount(rule.measured)} of ${formatCount(seats)} seats reach a door`,
        required: rule.required === undefined ? dash : `${formatLength(rule.required)} wide`,
      };
    case 'area-per-guest':
    case 'area-per-person':
      return {
        measured: rule.measured === undefined ? dash : formatSquareMetres(rule.measured),
        required: rule.required === undefined ? dash : `${formatSquareMetres(rule.required)} or more`,
      };
    case 'workstations':
      return {
        measured: rule.measured === undefined ? dash : `${formatCount(rule.measured)} with a chair`,
        required: rule.required === undefined ? dash : `${formatCount(rule.required)} desks`,
      };
    case 'exits':
      return {
        measured: rule.measured === undefined ? dash : `${formatCount(rule.measured)} ${rule.measured === 1 ? 'door' : 'doors'}`,
        required: rule.required === undefined ? dash : `${formatCount(rule.required)} for ${formatCount(seats)} people`,
      };
    case 'door-width':
      return {
        measured: rule.measured === undefined ? dash : formatLength(rule.measured),
        required: rule.required === undefined ? dash : formatLength(rule.required),
      };
  }
}

/** One sentence per rule, with the measured and required numbers. */
export function describeRule(project: Project, rule: RuleResult): string {
  if (rule.status === 'unknown') {
    if (rule.reason === 'no-doors') return 'There is no door yet, so there is no way out to measure.';
    return rule.reason === 'no-desks' ? 'There are no desks in the plan yet.' : 'There are no seats in the plan yet.';
  }
  const guests = measureProject(project).seats;
  const count = formatCount;
  const list = (ids: readonly Id[]) => {
    const names = ids.slice(0, 4).map((id) => entityName(project, id)).join(', ');
    return ids.length > 4 ? `${names} and ${count(ids.length - 4)} more` : names;
  };
  switch (rule.code) {
    case 'walkway': {
      const width = formatLength(rule.required ?? 0);
      if (rule.status === 'pass') return `Every seat reaches a door by a walkway at least ${width} wide.`;
      return `${count(rule.entityIds.length)} ${rule.entityIds.length === 1 ? 'seat has' : 'seats have'} no ${width} walkway to a door: ${list(rule.entityIds)}. Widen the walkway or move what blocks it.`;
    }
    case 'area-per-guest':
      return `Each guest has ${formatSquareMetres(rule.measured ?? 0)} of floor; at least ${formatSquareMetres(rule.required ?? 0)} is needed.`;
    case 'area-per-person':
      return `Each person has ${formatSquareMetres(rule.measured ?? 0)} of floor; at least ${formatSquareMetres(rule.required ?? 0)} is needed.`;
    case 'workstations':
      if (rule.status === 'pass') return rule.required === 1 ? 'The desk has a chair.' : `All ${count(rule.required ?? 0)} desks have a chair.`;
      return rule.required === 1
        ? `The desk has no chair nearby: ${list(rule.entityIds)}.`
        : `${count(rule.entityIds.length)} of ${count(rule.required ?? 0)} desks have no chair nearby: ${list(rule.entityIds)}.`;
    case 'exits':
      return `${count(guests)} people need at least ${count(rule.required ?? 0)} ${rule.required === 1 ? 'door' : 'doors'}; there ${rule.measured === 1 ? 'is' : 'are'} ${count(rule.measured ?? 0)}.`;
    case 'door-width':
      return `${count(guests)} people need doors at least ${formatLength(rule.required ?? 0)} wide in total; there is ${formatLength(rule.measured ?? 0)}.`;
  }
}
