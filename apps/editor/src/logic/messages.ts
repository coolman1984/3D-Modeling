import { measureProject, type Id, type Issue, type IssueCode, type Project, type RejectCode } from '@space-planner/core';
import type { RuleCode, RuleResult } from '@space-planner/starter';
import { formatLength } from './format.js';

export const ISSUE_TITLES: Readonly<Record<IssueCode, string>> = {
  'out-of-bounds': 'خارج حدود القاعة',
  overlap: 'عنصرين داخلين في بعض',
  'on-obstacle': 'فوق عمود أو منطقة ممنوعة',
  'door-blocked': 'سادد فتحة باب',
  'too-tall': 'أطول من السقف',
  clearance: 'مساحة الاستخدام ناقصة',
  'height-unknown': 'ارتفاع السقف مش معروف',
};

/** Human name of any entity: item names from the catalog, doors and columns by kind. */
export function entityName(project: Project, id: Id): string {
  const item = project.items[id];
  if (item) {
    const definition = project.catalog[item.definitionId];
    return `${definition?.name ?? 'عنصر'} (${id})`;
  }
  if (project.space.doors.some((d) => d.id === id)) return `الباب (${id})`;
  const obstacle = project.space.obstacles.find((o) => o.id === id);
  if (obstacle) return `${obstacle.kind === 'column' ? 'العمود' : 'المنطقة الممنوعة'} (${id})`;
  return id;
}

/** One sentence the owner understands: what, with what, and by how much. */
export function describeIssue(project: Project, issue: Issue): string {
  const [first, second] = issue.entityIds.map((id) => entityName(project, id));
  const amount = issue.amount === undefined ? '' : formatLength(issue.amount);
  switch (issue.code) {
    case 'out-of-bounds':
      return `${first} طالع برّه الحيطة.`;
    case 'overlap':
      return `${first} داخل في ${second} بمقدار ${amount}.`;
    case 'on-obstacle':
      return `${first} فوق ${second}${amount ? ` بمقدار ${amount}` : ''}.`;
    case 'door-blocked':
      return `${first} في طريق ${second}؛ ابعده حوالي ${amount}.`;
    case 'too-tall':
      return `${first} أطول من السقف بـ ${amount}.`;
    case 'clearance':
      return second
        ? `${first} محتاج مساحة استخدام، و${second} واخد منها ${amount}.`
        : `${first} لازق في الحيطة ومفيش مساحة استخدام كفاية.`;
    case 'height-unknown':
      return 'اكتب ارتفاع السقف عشان نقدر نفحص الارتفاعات.';
  }
}

export const REJECTION_MESSAGES: Readonly<Record<RejectCode, string>> = {
  'invalid-payload': 'القيمة دي مش مقبولة.',
  'unknown-command': 'عملية غير معروفة.',
  'not-found': 'العنصر ده مش موجود.',
  'duplicate-id': 'الاسم ده مستخدم قبل كده.',
  locked: 'العنصر ده مقفول؛ افتح القفل الأول.',
  'in-use': 'النوع ده مستخدم في المخطط.',
  'broken-reference': 'النوع ده مش موجود في الكتالوج.',
  'empty-batch': 'مفيش حاجة تتنفذ.',
};

export const RULE_TITLES: Readonly<Record<RuleCode, string>> = {
  walkway: 'ممر من كل كرسي لباب',
  'area-per-guest': 'مساحة لكل ضيف',
  'area-per-person': 'مساحة لكل فرد',
  workstations: 'كل مكتب له كرسي',
  exits: 'عدد المخارج',
  'door-width': 'عرض الأبواب',
};

const squareMetres = (v: number) => `${new Intl.NumberFormat('ar-EG', { maximumFractionDigits: 2 }).format(v)} م²`;

/** One sentence per hall rule, with the measured and required numbers. */
export function describeRule(project: Project, rule: RuleResult): string {
  if (rule.status === 'unknown') {
    if (rule.reason === 'no-doors') return 'مفيش باب في المكان، فمفيش طريق للخروج نقيسه.';
    return rule.reason === 'no-desks' ? 'مفيش مكاتب في التصميم لسه.' : 'مفيش كراسي في التصميم لسه.';
  }
  const guests = measureProject(project).seats;
  const count = (n: number) => new Intl.NumberFormat('ar-EG').format(n);
  switch (rule.code) {
    case 'walkway': {
      const width = formatLength(rule.required ?? 0);
      if (rule.status === 'pass') return `كل الكراسي توصل لباب بممر عرضه ${width} على الأقل.`;
      const names = rule.entityIds.slice(0, 4).map((id) => entityName(project, id)).join('، ');
      const more = rule.entityIds.length > 4 ? ` و${count(rule.entityIds.length - 4)} غيرهم` : '';
      return `${count(rule.entityIds.length)} مالهمش ممر عرضه ${width} لباب: ${names}${more}. وسّع الممر أو شيل اللي سادده.`;
    }
    case 'area-per-guest':
      return `نصيب الضيف ${squareMetres(rule.measured ?? 0)} من الأرض، والمطلوب ${squareMetres(rule.required ?? 0)} على الأقل.`;
    case 'area-per-person':
      return `نصيب الفرد ${squareMetres(rule.measured ?? 0)} من الأرض، والمطلوب ${squareMetres(rule.required ?? 0)} على الأقل.`;
    case 'workstations': {
      if (rule.status === 'pass') return `كل المكاتب (${count(rule.required ?? 0)}) ليها كرسي قدامها.`;
      const names = rule.entityIds.slice(0, 4).map((id) => entityName(project, id)).join('، ');
      const more = rule.entityIds.length > 4 ? ` و${count(rule.entityIds.length - 4)} غيرهم` : '';
      return `${count(rule.entityIds.length)} من ${count(rule.required ?? 0)} مكتب من غير كرسي قريب: ${names}${more}.`;
    }
    case 'exits':
      return `${count(guests)} فرد محتاجين ${count(rule.required ?? 0)} باب على الأقل، والموجود ${count(rule.measured ?? 0)}.`;
    case 'door-width':
      return `${count(guests)} فرد محتاجين أبواب عرضها كلها ${formatLength(rule.required ?? 0)} على الأقل، والموجود ${formatLength(rule.measured ?? 0)}.`;
  }
}
