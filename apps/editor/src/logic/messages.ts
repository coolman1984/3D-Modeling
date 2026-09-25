import type { Id, Issue, IssueCode, Project, RejectCode } from '@space-planner/core';
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
