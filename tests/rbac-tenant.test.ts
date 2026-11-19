import assert from 'node:assert/strict';
import test from 'node:test';
import { canAssignRole, canManageMember, hasPermission } from '@/lib/rbac';
import { assertCrossTenantMatch, evaluateTenantAccess } from '@/lib/server/tenant-guard';
import type { WorkspaceMember } from '@/types/domain';

const makeMember = (
  uid: string,
  workspaceId: string,
  role: WorkspaceMember['role'],
  status: WorkspaceMember['status'] = 'active',
): WorkspaceMember => ({
  uid,
  workspaceId,
  email: `${uid}@example.com`,
  displayName: uid,
  role,
  status,
  invitedBy: 'owner_1',
  joinedAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
});

test('5-tier RBAC permission matrix enforces least privilege', () => {
  assert.equal(hasPermission('owner', 'workspace:delete'), true);
  assert.equal(hasPermission('admin', 'workspace:delete'), false);
  assert.equal(hasPermission('admin', 'settings:update'), true);
  assert.equal(hasPermission('manager', 'brands:delete'), true);
  assert.equal(hasPermission('manager', 'settings:update'), false);
  assert.equal(hasPermission('editor', 'brands:update'), true);
  assert.equal(hasPermission('editor', 'brands:delete'), false);
  assert.equal(hasPermission('viewer', 'brands:read'), true);
  assert.equal(hasPermission('viewer', 'brands:create'), false);
  assert.equal(hasPermission(null, 'workspace:read'), false);
});

test('canAssignRole & canManageMember prevent owner escalation and self-modification', () => {
  assert.equal(canAssignRole('owner', 'admin'), true);
  assert.equal(canAssignRole('owner', 'owner'), false);
  assert.equal(canAssignRole('admin', 'admin'), true);
  assert.equal(canAssignRole('admin', 'owner'), false);
  assert.equal(canAssignRole('manager', 'editor'), false);

  const owner = makeMember('u_owner', 'ws_1', 'owner');
  const admin = makeMember('u_admin', 'ws_1', 'admin');
  const editor = makeMember('u_editor', 'ws_1', 'editor');

  assert.equal(canManageMember('admin', 'u_admin', owner), false);
  assert.equal(canManageMember('admin', 'u_admin', admin), false);
  assert.equal(canManageMember('admin', 'u_admin', editor), true);
  assert.equal(canManageMember('owner', 'u_owner', admin), true);
});

test('evaluateTenantAccess and assertCrossTenantMatch block cross-tenant & suspended access', () => {
  const editorWs1 = makeMember('u_1', 'ws_1', 'editor', 'active');
  assert.equal(evaluateTenantAccess(editorWs1, 'ws_1', 'brands:create').allowed, true);
  assert.equal(evaluateTenantAccess(editorWs1, 'ws_2', 'brands:read').allowed, false);
  assert.equal(evaluateTenantAccess(null, 'ws_1', 'workspace:read').allowed, false);

  const suspended = makeMember('u_2', 'ws_1', 'admin', 'suspended');
  assert.equal(evaluateTenantAccess(suspended, 'ws_1', 'workspace:read').allowed, false);

  assert.doesNotThrow(() => assertCrossTenantMatch('ws_1', 'ws_1', 'brand'));
  assert.throws(
    () => assertCrossTenantMatch('ws_1', 'ws_2', 'brand'),
    (err: unknown) =>
      typeof err === 'object' &&
      err !== null &&
      'code' in err &&
      (err as { code?: string }).code === 'CROSS_TENANT_FORBIDDEN',
  );
});
