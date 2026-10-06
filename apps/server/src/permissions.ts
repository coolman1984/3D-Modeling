/**
 * Roles are a property of a membership (one person can be an owner in one company and a viewer
 * in another), and every route and agent tool names the permission it needs. Anything not granted
 * here is refused: deny by default.
 */
export const ROLES = ['owner', 'admin', 'designer', 'operator', 'reviewer', 'viewer'] as const;
export type Role = (typeof ROLES)[number];

export type Permission =
  | 'project.read'
  | 'project.create'
  | 'project.edit'
  /** Place, move, turn, raise, lock and remove items — not the room, item types or rules. */
  | 'project.edit.items'
  | 'project.delete'
  | 'project.restore'
  | 'project.export'
  | 'project.share'
  | 'project.approve'
  | 'agent.run'
  | 'members.manage'
  | 'keys.manage'
  | 'company.manage'
  | 'audit.read';

const DESIGNER: readonly Permission[] = [
  'project.read', 'project.create', 'project.edit', 'project.edit.items', 'project.restore', 'project.export', 'project.share', 'agent.run',
];

const GRANTS: Readonly<Record<Role, readonly Permission[]>> = {
  owner: [...DESIGNER, 'project.delete', 'project.approve', 'members.manage', 'keys.manage', 'company.manage', 'audit.read'],
  admin: [...DESIGNER, 'project.delete', 'project.approve', 'members.manage', 'keys.manage', 'company.manage', 'audit.read'],
  designer: DESIGNER,
  operator: ['project.read', 'project.edit.items'],
  reviewer: ['project.read', 'project.export', 'project.approve'],
  viewer: ['project.read'],
};

export const isRole = (value: unknown): value is Role => typeof value === 'string' && (ROLES as readonly string[]).includes(value);

export function permissionsOf(role: Role): readonly Permission[] {
  return GRANTS[role];
}

export function can(role: Role, permission: Permission): boolean {
  return GRANTS[role].includes(permission);
}

/** Roles an API key may carry: agents never manage people, keys or the company. */
export const KEY_ROLES: readonly Role[] = ['designer', 'operator', 'viewer'];

/**
 * Commands an operator may send: items only. Anything that changes the room, the item types
 * (the company's catalogue) or the project's name needs `project.edit`.
 */
export function itemsOnly(commands: readonly { type: string; commands?: readonly unknown[] }[]): boolean {
  return commands.every((c) =>
    c.type === 'batch' ? itemsOnly((c.commands ?? []) as { type: string }[]) : c.type.startsWith('item.'),
  );
}
