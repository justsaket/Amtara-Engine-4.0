import { hasPermission } from '@/lib/rbac';
import type { Permission, WorkspaceMember } from '@/types/domain';
import { AppError } from './error-handler';

export interface TenantAccessDecision {
  allowed: boolean;
  reason?: string;
}

export function evaluateTenantAccess(
  member: WorkspaceMember | null | undefined,
  requestedWorkspaceId: string,
  requiredPermission: Permission,
): TenantAccessDecision {
  if (!member) {
    return {
      allowed: false,
      reason: 'User is not a member of this workspace.',
    };
  }

  if (member.workspaceId !== requestedWorkspaceId) {
    return {
      allowed: false,
      reason: 'Cross-tenant access attempt blocked: membership belongs to another workspace.',
    };
  }

  if (member.status !== 'active') {
    return {
      allowed: false,
      reason: `Workspace membership status is "${member.status}".`,
    };
  }

  if (!hasPermission(member.role, requiredPermission)) {
    return {
      allowed: false,
      reason: `Role "${member.role}" lacks required permission "${requiredPermission}".`,
    };
  }

  return { allowed: true };
}

export function assertCrossTenantMatch(
  resourceWorkspaceId: string,
  routeWorkspaceId: string,
  resourceLabel: string,
): void {
  if (resourceWorkspaceId !== routeWorkspaceId) {
    throw new AppError(
      403,
      'CROSS_TENANT_FORBIDDEN',
      `Security boundary violation: ${resourceLabel} does not belong to workspace "${routeWorkspaceId}".`,
    );
  }
}
