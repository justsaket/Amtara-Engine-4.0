import type { Permission, WorkspaceMember, WorkspaceRole } from '@/types/domain';

export const WORKSPACE_ROLES: readonly WorkspaceRole[] = [
  'owner',
  'admin',
  'manager',
  'editor',
  'viewer',
] as const;

export const ROLE_RANK: Record<WorkspaceRole, number> = {
  viewer: 1,
  editor: 2,
  manager: 3,
  admin: 4,
  owner: 5,
};

const VIEWER_PERMISSIONS: readonly Permission[] = [
  'workspace:read',
  'members:read',
  'brands:read',
  'integrations:read',
  'google:read',
  'apps_script:read',
  'settings:read',
  'notifications:read',
  'audit:read',
  'roadmap:read',
  'ai:read',
  'memory:read',
  'research:read',
  'marketing:read',
  'analytics:read',
];

const EDITOR_PERMISSIONS: readonly Permission[] = [
  ...VIEWER_PERMISSIONS,
  'brands:create',
  'brands:update',
  'apps_script:write',
  'ai:run',
  'memory:propose',
  'research:run',
  'strategy:write',
  'content:write',
  'assets:write',
  'leads:manage',
];

const MANAGER_PERMISSIONS: readonly Permission[] = [
  ...EDITOR_PERMISSIONS,
  'brands:delete',
  'apps_script:deploy',
  'apps_script:execute',
  'memory:approve',
  'playbooks:trigger',
  'content:approve',
  'publishing:schedule',
  'publishing:execute',
  'inbox:reply',
  'reviews:reply',
  'campaigns:manage',
  'emergency:stop',
];

const ADMIN_PERMISSIONS: readonly Permission[] = [
  ...MANAGER_PERMISSIONS,
  'workspace:update',
  'members:invite',
  'members:update_role',
  'members:remove',
  'integrations:configure',
  'google:connect',
  'google:disconnect',
  'apps_script:approve',
  'agents:configure',
  'settings:update',
  'security:manage',
  'autonomy:manage',
];

const OWNER_PERMISSIONS: readonly Permission[] = [
  ...ADMIN_PERMISSIONS,
  'workspace:delete',
];

export const ROLE_PERMISSIONS: Record<WorkspaceRole, readonly Permission[]> = {
  viewer: VIEWER_PERMISSIONS,
  editor: EDITOR_PERMISSIONS,
  manager: MANAGER_PERMISSIONS,
  admin: ADMIN_PERMISSIONS,
  owner: OWNER_PERMISSIONS,
};

export const ROLE_METADATA: Record<
  WorkspaceRole,
  { label: string; summary: string }
> = {
  owner: {
    label: 'Owner',
    summary: 'Full workspace ownership, administrator delegation, security governance, and workspace deletion.',
  },
  admin: {
    label: 'Administrator',
    summary: 'Manages workspace settings, team roles, invitations, encryption status, and external integration boundaries.',
  },
  manager: {
    label: 'Manager',
    summary: 'Manages brand portfolios and archives inactive brand profiles within the workspace.',
  },
  editor: {
    label: 'Editor',
    summary: 'Creates and refines brand profiles, content pillars, voice rules, and target audience records.',
  },
  viewer: {
    label: 'Viewer',
    summary: 'Read-only access to workspace architecture, brands, settings status, notifications, and audit logs.',
  },
};

export function hasPermission(
  role: WorkspaceRole | null | undefined,
  permission: Permission,
): boolean {
  if (!role) return false;
  const list = ROLE_PERMISSIONS[role];
  return Boolean(list && list.includes(permission));
}

export function canAssignRole(
  actorRole: WorkspaceRole,
  targetRole: WorkspaceRole,
): boolean {
  if (targetRole === 'owner') return false;
  if (actorRole === 'owner') return true;
  if (actorRole === 'admin') {
    return ROLE_RANK[targetRole] <= ROLE_RANK.admin;
  }
  return false;
}

export function canManageMember(
  actorRole: WorkspaceRole,
  actorUid: string,
  targetMember: Pick<WorkspaceMember, 'uid' | 'role'>,
): boolean {
  if (targetMember.role === 'owner') return false;
  if (targetMember.uid === actorUid) return false;
  if (actorRole === 'owner') return true;
  if (actorRole === 'admin') {
    return ROLE_RANK[targetMember.role] < ROLE_RANK.owner;
  }
  return false;
}
