import { measureProject, type Id, type Issue, type IssueCode, type Project, type RejectCode } from '@space-planner/core';
import type { RuleCode, RuleResult } from '@space-planner/starter';
import { formatCount, formatLength, formatMass, formatSquareMetres } from './format.js';

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
  payload: 'Payload',
  support: 'Every raised piece is supported',
  'load-on-top': 'Load on top of each piece',
  orientation: '“This way up” respected',
  'stacking-group': 'Stacking groups kept apart',
  'unloading-order': 'Unloading order (last in, first out)',
  balance: 'Centre of mass near the middle',
  unpacked: 'Every planned piece placed',
  'rack-capacity': 'Rack storage capacity',
  'rack-access': 'Forklift reaches every rack row',
  'aisle-width': 'Rack aisle clear width',
  'dock-access': 'Docks connect to storage',
  'restricted-zone': 'Racks avoid restricted zones',
  'rack-boundary': 'Racks fit inside the warehouse',
  'dock-approach': 'Dock approach areas',
  'machine-boundary': 'Stations fit inside the floor',
  'flow-reachability': 'Material handler reaches every station',
  'bay-boundary': 'Bays fit inside the depot',
  'bay-entry': 'A vehicle can turn into every empty bay',
  'area-per-cover': 'Floor area per cover',
  'table-reachability': 'Waitstaff reaches every table',
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
    case 'payload':
      return { measured: rule.measured === undefined ? dash : formatMass(rule.measured), required: rule.required === undefined ? dash : `${formatMass(rule.required)} or less` };
    case 'support':
      return { measured: rule.measured === undefined ? dash : `${rule.measured}% at the weakest`, required: `${rule.required ?? 70}% of the base` };
    case 'load-on-top':
      return { measured: rule.measured === undefined ? dash : `${formatMass(rule.measured)} heaviest`, required: 'Within each type’s limit' };
    case 'balance':
      return { measured: rule.measured === undefined ? dash : `${rule.measured}% off the middle`, required: `${rule.required ?? 10}% or less` };
    case 'unpacked':
      return { measured: rule.measured === undefined ? dash : `${formatCount(rule.measured)} placed`, required: rule.required === undefined ? dash : `${formatCount(rule.required)} planned` };
    case 'rack-capacity':
      return { measured: rule.measured === undefined ? dash : `${formatCount(rule.measured)} positions`, required: 'Valid rack dimensions' };
    case 'rack-access':
      return { measured: rule.measured === undefined ? dash : `${formatCount(rule.measured)} reachable`, required: rule.required === undefined ? dash : `${formatCount(rule.required)} rack rows` };
    case 'aisle-width':
      return { measured: rule.measured === undefined ? dash : formatLength(rule.measured), required: rule.required === undefined ? dash : `${formatLength(rule.required)} or wider` };
    case 'dock-access':
    case 'dock-approach':
      return { measured: rule.measured === undefined ? dash : `${formatCount(rule.measured)} connected`, required: rule.required === undefined ? dash : `${formatCount(rule.required)} docks` };
    case 'restricted-zone':
      return { measured: rule.measured === undefined ? dash : `${formatCount(rule.measured)} conflicts`, required: 'None' };
    case 'rack-boundary':
      return { measured: rule.measured === undefined ? dash : `${formatCount(rule.measured)} inside`, required: rule.required === undefined ? dash : `${formatCount(rule.required)} rack rows` };
    case 'machine-boundary':
      return { measured: rule.measured === undefined ? dash : `${formatCount(rule.measured)} inside`, required: rule.required === undefined ? dash : `${formatCount(rule.required)} stations` };
    case 'flow-reachability':
      return { measured: rule.measured === undefined ? dash : `${formatCount(rule.measured)} reachable`, required: rule.required === undefined ? dash : `${formatCount(rule.required)} segments` };
    case 'bay-boundary':
      return { measured: rule.measured === undefined ? dash : `${formatCount(rule.measured)} inside`, required: rule.required === undefined ? dash : `${formatCount(rule.required)} bays` };
    case 'bay-entry':
      return { measured: rule.measured === undefined ? dash : `${formatCount(rule.measured)} reachable`, required: rule.required === undefined ? dash : `${formatCount(rule.required)} empty bays` };
    case 'area-per-cover':
      return { measured: rule.measured === undefined ? dash : formatSquareMetres(rule.measured), required: rule.required === undefined ? dash : `${formatSquareMetres(rule.required)} or more` };
    case 'table-reachability':
      return { measured: rule.measured === undefined ? dash : `${formatCount(rule.measured)} reachable`, required: rule.required === undefined ? dash : `${formatCount(rule.required)} tables` };
    case 'orientation':
    case 'stacking-group':
    case 'unloading-order':
      return { measured: rule.measured === undefined ? dash : `${formatCount(rule.measured)} ${rule.measured === 1 ? 'piece' : 'pieces'} wrong`, required: 'None' };
  }
}

/** One sentence per rule, with the measured and required numbers. */
export function describeRule(project: Project, rule: RuleResult): string {
  if (rule.status === 'unknown') {
    switch (rule.reason) {
      case 'no-doors':
        return 'There is no door yet, so there is no way out to measure.';
      case 'no-desks':
        return 'There are no desks in the plan yet.';
      case 'no-cargo':
        return 'No cargo is loaded yet.';
      case 'no-mass':
        return 'Some cargo types have no mass, so weights cannot be checked.';
      case 'no-payload':
        return 'The container has no payload limit set.';
      case 'no-stops':
        return 'No unloading stops are set on the cargo.';
      case 'no-quantities':
        return 'No quantities are planned on the cargo types.';
      case 'no-orientation-data':
        return 'Some pieces lie on their side, but their type does not say whether that is allowed.';
      case 'no-stacking-data':
        return 'Some pieces carry weight, but their type has no load limit.';
      case 'no-racks':
        return 'Add rack rows to calculate capacity and access.';
      case 'no-zones':
        return 'Add the operational zones or link the dock to its approach zone before this check can run.';
      case 'rack-data':
        return 'A rack row needs valid bay, level and dimension data.';
      case 'no-stations':
        return 'Add stations to the production line to check it.';
      case 'one-station':
        return 'Add a second station to check the material flow between them.';
      case 'no-bays':
        return 'Add parking bays to check the depot.';
      case 'no-lanes':
        return 'Add a lane zone so a vehicle has somewhere to approach a bay from.';
      case 'all-occupied':
        return 'Every bay already has a vehicle in it; there is nothing empty to check.';
      case 'no-tables':
        return 'Add tables to check the restaurant.';
      case 'no-pass':
        return 'Add a kitchen pass door (its role set to "pass") so waitstaff have somewhere to start from.';
      default:
        return 'There are no seats in the plan yet.';
    }
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
    case 'payload':
      return rule.status === 'pass'
        ? `The load weighs ${formatMass(rule.measured ?? 0)}, within the ${formatMass(rule.required ?? 0)} payload.`
        : `The load weighs ${formatMass(rule.measured ?? 0)}, ${formatMass((rule.measured ?? 0) - (rule.required ?? 0))} over the ${formatMass(rule.required ?? 0)} payload.`;
    case 'support':
      return rule.status === 'pass' ? 'Every raised piece rests on the pieces below it.' : `Not supported well enough: ${list(rule.entityIds)}. Move them onto full stacks or down to the floor.`;
    case 'load-on-top':
      return rule.status === 'pass' ? 'No piece carries more than its type allows.' : `Too much weight on: ${list(rule.entityIds)}. Move heavy pieces down or off them.`;
    case 'orientation':
      return rule.status === 'pass' ? 'Pieces that must stay upright are upright.' : `Must stay upright but lie on their side: ${list(rule.entityIds)}.`;
    case 'stacking-group':
      return rule.status === 'pass' ? 'Stacks only mix pieces of the same group.' : `Stacked on a piece of another group: ${list(rule.entityIds)}.`;
    case 'unloading-order':
      return rule.status === 'pass' ? 'Each stop can be unloaded without moving cargo for a later stop.' : `Blocked by cargo for a later stop: ${list(rule.entityIds)}. Load them after, nearer the doors or on top.`;
    case 'balance':
      return `The centre of mass is ${rule.measured}% off the middle of the container; keep it within ${rule.required}%.`;
    case 'unpacked':
      return rule.status === 'pass' ? `All ${count(rule.required ?? 0)} planned pieces are placed.` : `${count((rule.required ?? 0) - (rule.measured ?? 0))} planned pieces are not placed yet (${rule.entityIds.join(', ')}).`;
    case 'rack-capacity':
      return `${count(rule.measured ?? 0)} addressable pallet positions in the rack rows.`;
    case 'rack-access':
      return rule.status === 'pass' ? 'A planning forklift can reach every rack row from a dock.' : `Forklift route blocked for: ${list(rule.entityIds)}.`;
    case 'aisle-width':
      return rule.status === 'pass' ? `The narrowest measured rack aisle is ${formatLength(rule.measured ?? 0)} wide.` : `Rack aisle between ${list(rule.entityIds)} is only ${formatLength(rule.measured ?? 0)}; the planning forklift needs ${formatLength(rule.required ?? 0)}.`;
    case 'dock-access':
      return rule.status === 'pass' ? 'Every dock has a planning forklift route to storage.' : `No storage route from: ${rule.entityIds.join(', ')}.`;
    case 'dock-approach':
      return rule.status === 'pass' ? 'Each dock opens into its named operational zone.' : `Dock approach is outside its named zone: ${rule.entityIds.join(', ')}.`;
    case 'restricted-zone':
      return rule.status === 'pass' ? 'No rack crosses a pedestrian or no-go zone.' : `Move racks out of restricted zones: ${list(rule.entityIds)}.`;
    case 'rack-boundary':
      return rule.status === 'pass' ? 'Every rack row fits inside the warehouse.' : `Rack rows outside the warehouse: ${list(rule.entityIds)}.`;
    case 'machine-boundary':
      return rule.status === 'pass' ? 'Every station fits inside the production floor.' : `Stations outside the floor: ${list(rule.entityIds)}.`;
    case 'flow-reachability':
      return rule.status === 'pass' ? 'The material handler can travel from each station to the next.' : `No route between: ${list(rule.entityIds)}.`;
    case 'bay-boundary':
      return rule.status === 'pass' ? 'Every bay fits inside the depot.' : `Bays outside the depot: ${list(rule.entityIds)}.`;
    case 'bay-entry':
      return rule.status === 'pass' ? 'A vehicle can turn from the lane into every empty bay.' : `No clear turn into: ${list(rule.entityIds)}.`;
    case 'area-per-cover':
      return `Each cover has ${formatSquareMetres(rule.measured ?? 0)} of floor; at least ${formatSquareMetres(rule.required ?? 0)} is needed.`;
    case 'table-reachability':
      return rule.status === 'pass' ? 'Waitstaff can reach every table from the kitchen pass.' : `No route from the pass to: ${list(rule.entityIds)}.`;
  }
}
