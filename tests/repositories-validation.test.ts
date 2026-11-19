import assert from 'node:assert/strict';
import test from 'node:test';
import type { AuthenticatedUser } from '@/lib/server/auth';
import {
  bootstrapUserProfile,
  createBrand,
  createDevelopmentTestStore,
  createInvitation,
  createWorkspace,
  deleteBrand,
  listApplicationSettings,
  listAuditLogs,
  listBrands,
  listIntegrations,
  listNotifications,
  requestAccountDeletion,
  updateBrand,
  upsertApplicationSetting,
} from '@/lib/server/repositories';
import { STARTER_BRAND_PRESETS } from '@/lib/starter-brands';
import {
  DEFAULT_WORKSPACE_TIMEZONE,
  brandCreateSchema,
  onboardingCompleteSchema,
  settingUpdateSchema,
} from '@/lib/validation';

const ownerUser: AuthenticatedUser = {
  uid: 'uid_owner_01',
  email: 'saket@example.com',
  displayName: 'Saket Founder',
  authProvider: 'password',
};

const outsiderUser: AuthenticatedUser = {
  uid: 'uid_outsider_02',
  email: 'outsider@example.com',
  displayName: 'Outside User',
  authProvider: 'google.com',
};

test('Starter brand presets match Phase 1 list and avoid fabricated claims', () => {
  const keys = STARTER_BRAND_PRESETS.map((b) => b.name);
  assert.deepEqual(keys, ['Saket Personal', 'MAGNARC', 'GreenWeld', 'Sapphire']);
  for (const preset of STARTER_BRAND_PRESETS) {
    assert.ok(!preset.description.includes('$'));
    assert.ok(!preset.description.includes('ISO'));
  }
});

test('Validation schemas enforce strict Phase 1 timezone and fields', () => {
  const parsed = onboardingCompleteSchema.parse({
    displayName: 'Saket',
    workspaceName: 'Antara Core HQ',
  });
  assert.equal(parsed.timezone, DEFAULT_WORKSPACE_TIMEZONE);
  assert.equal(parsed.starterBrands.length, 4);

  assert.throws(() =>
    brandCreateSchema.parse({
      name: 'Valid Brand',
      primaryColor: 'not-a-hex',
      status: 'active',
    }),
  );

  assert.throws(() =>
    settingUpdateSchema.parse({
      category: 'nonexistent_category',
      values: { ok: true },
    }),
  );
});

test('Repositories isolate tenants, seed starter brands, log audit trails, and support account deletion', async () => {
  const store = createDevelopmentTestStore();
  assert.equal(store.isProductionPersistence, false);

  const profile = await bootstrapUserProfile(ownerUser, { store });
  assert.equal(profile.timezone, 'Asia/Kolkata');
  assert.equal(profile.onboardingCompleted, false);

  const ws = await createWorkspace(
    ownerUser,
    {
      name: 'Saket Multi-Brand HQ',
      timezone: 'Asia/Kolkata',
      starterBrands: ['saket_personal', 'magnarc', 'greenweld', 'sapphire'],
    },
    { store },
  );

  assert.equal(ws.timezone, 'Asia/Kolkata');
  assert.equal(ws.brandCount, 4);
  assert.equal(ws.role, 'owner');

  const brands = await listBrands(ownerUser.uid, ws.id, { store });
  assert.equal(brands.length, 4);

  const customBrand = await createBrand(
    ownerUser.uid,
    ownerUser.email,
    ws.id,
    {
      name: 'Delta Robotics',
      primaryColor: '#1E293B',
      accentColor: '#2563EB',
      contentPillars: ['Precision Automation'],
    },
    { store },
  );
  assert.equal(customBrand.name, 'Delta Robotics');

  const updatedBrand = await updateBrand(
    ownerUser.uid,
    ownerUser.email,
    ws.id,
    customBrand.id,
    { status: 'archived' },
    { store },
  );
  assert.equal(updatedBrand.status, 'archived');

  await deleteBrand(ownerUser.uid, ownerUser.email, ws.id, customBrand.id, { store });
  const remainingBrands = await listBrands(ownerUser.uid, ws.id, { store });
  assert.equal(remainingBrands.length, 4);

  // Settings Center: 12 categories initialized and updatable
  const settings = await listApplicationSettings(ownerUser.uid, ws.id, { store });
  assert.equal(settings.length, 12);

  await upsertApplicationSetting(
    ownerUser.uid,
    ownerUser.email,
    ws.id,
    {
      category: 'general',
      values: { defaultTimezone: 'Asia/Kolkata', language: 'en-IN', dateFormat: 'YYYY-MM-DD' },
    },
    { store },
  );

  // Integrations keep consent separated from login
  const integrations = await listIntegrations(ownerUser.uid, ws.id, { store });
  assert.ok(integrations.length >= 6);
  assert.ok(integrations.every((i) => i.consentSeparatedFromLogin === true));

  // Member invitation + Audit Logs + Notifications
  const invite = await createInvitation(
    ownerUser.uid,
    ownerUser.email,
    ws.id,
    { email: 'team@example.com', role: 'editor' },
    { store },
  );
  assert.equal(invite.status, 'pending');

  const auditLogs = await listAuditLogs(ownerUser.uid, ws.id, { store });
  assert.ok(auditLogs.some((l) => l.action === 'workspace.created'));
  assert.ok(auditLogs.some((l) => l.action === 'member.invited'));

  const notifications = await listNotifications(ownerUser.uid, ws.id, { store });
  assert.equal(notifications.length, 1);

  // Outsider blocked across workspace boundaries
  await assert.rejects(
    () => listBrands(outsiderUser.uid, ws.id, { store }),
    /not a member of this workspace/,
  );

  // Account deletion request preserved in UserProfile
  const deletedRequest = await requestAccountDeletion(ownerUser, { store });
  assert.equal(deletedRequest.accountDeletionStatus, 'requested');
  assert.ok(deletedRequest.accountDeletionRequestedAt);
});

test('bootstrapUserProfile recovers cleanly when concurrent Google sign-in creates user doc simultaneously', async () => {
  const baseStore = createDevelopmentTestStore();
  let commitAttempts = 0;

  const racingStore = {
    ...baseStore,
    async commit(ops: Parameters<typeof baseStore.commit>[0]) {
      commitAttempts += 1;
      if (commitAttempts === 1) {
        // Simulate another concurrent request creating the profile right before this commit lands
        await baseStore.commit(ops);
        throw new Error('409 ALREADY_EXISTS: Document already exists');
      }
      return baseStore.commit(ops);
    },
  };

  const googleUser: AuthenticatedUser = {
    uid: 'uid_google_race_01',
    email: 'khushraj518@gmail.com',
    displayName: 'Khushraj',
    photoUrl: 'https://lh3.googleusercontent.com/a/example',
    authProvider: 'google.com',
  };

  const profile = await bootstrapUserProfile(googleUser, { store: racingStore });
  assert.equal(profile.uid, googleUser.uid);
  assert.equal(profile.email, googleUser.email);
  assert.equal(profile.authProvider, 'google.com');
  assert.equal(profile.onboardingCompleted, false);
});

test('createWorkspace commits workspace + owner membership before seeding subcollections with rule-compliant statuses', async () => {
  const baseStore = createDevelopmentTestStore();
  const commitBatches: string[][] = [];

  const observingStore = {
    ...baseStore,
    async commit(ops: Parameters<typeof baseStore.commit>[0]) {
      commitBatches.push(ops.map((o) => o.path));
      return baseStore.commit(ops);
    },
  };

  await bootstrapUserProfile(outsiderUser, { store: observingStore });
  commitBatches.length = 0;

  const ws = await createWorkspace(
    outsiderUser,
    {
      name: 'Khushraj Studio',
      timezone: 'Asia/Kolkata',
      starterBrands: ['saket_personal'],
    },
    { store: observingStore },
  );

  // Batch 0 must create workspace + member + user membership before batch 1 seeds subcollections
  assert.ok(commitBatches.length >= 2);
  assert.ok(commitBatches[0]!.includes(`workspaces/${ws.id}`));
  assert.ok(commitBatches[0]!.includes(`workspaces/${ws.id}/members/${outsiderUser.uid}`));
  assert.ok(!commitBatches[0]!.some((p) => p.includes('/integrations/')));
  assert.ok(commitBatches[1]!.some((p) => p.includes('/integrations/gemini_ai')));

  const integrations = await listIntegrations(outsiderUser.uid, ws.id, { store: observingStore });
  const allowedCreateStatuses = new Set(['not_configured', 'authorization_required', 'disabled']);
  for (const item of integrations) {
    assert.ok(
      allowedCreateStatuses.has(item.status),
      `Integration ${item.id} has disallowed initial status "${item.status}"`,
    );
  }
});

