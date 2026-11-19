'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { Plus, UserPlus } from 'lucide-react';
import { useAuth } from '@/components/providers/AuthContext';
import { useWorkspace } from '@/components/providers/WorkspaceContext';
import { apiRequest } from '@/lib/api-client';
import { hasPermission, ROLE_METADATA } from '@/lib/rbac';
import { DEFAULT_WORKSPACE_TIMEZONE } from '@/lib/validation';
import type {
  WorkspaceInvitation,
  WorkspaceMember,
  WorkspaceRole,
} from '@/types/domain';

export default function WorkspacesPage() {
  const { firebaseUser } = useAuth();
  const {
    workspaces,
    activeWorkspace,
    setActiveWorkspaceId,
    refreshWorkspaces,
    createWorkspace,
  } = useWorkspace();

  const [members, setMembers] = useState<WorkspaceMember[]>([]);
  const [invitations, setInvitations] = useState<WorkspaceInvitation[]>([]);
  const [loadingMembers, setLoadingMembers] = useState(false);

  const [wsName, setWsName] = useState('');
  const [wsDescription, setWsDescription] = useState('');
  const [wsTimezone, setWsTimezone] = useState(DEFAULT_WORKSPACE_TIMEZONE);
  const [newWsName, setNewWsName] = useState('');
  const [newWsIncludeBrands, setNewWsIncludeBrands] = useState(true);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<Exclude<WorkspaceRole, 'owner'>>('editor');
  const [feedback, setFeedback] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const canUpdateWorkspace = hasPermission(activeWorkspace?.role, 'workspace:update');
  const canInvite = hasPermission(activeWorkspace?.role, 'members:invite');
  const canChangeRole = hasPermission(activeWorkspace?.role, 'members:update_role');

  const loadMembers = useCallback(async () => {
    if (!activeWorkspace) return;
    setLoadingMembers(true);
    try {
      const data = await apiRequest<{
        members: WorkspaceMember[];
        invitations: WorkspaceInvitation[];
      }>(`/api/workspaces/${activeWorkspace.id}/members`);
      setMembers(data.members);
      setInvitations(data.invitations);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load workspace members.');
    } finally {
      setLoadingMembers(false);
    }
  }, [activeWorkspace]);

  useEffect(() => {
    if (activeWorkspace) {
      setWsName(activeWorkspace.name);
      setWsDescription(activeWorkspace.description || '');
      setWsTimezone(activeWorkspace.timezone || DEFAULT_WORKSPACE_TIMEZONE);
      void loadMembers();
    }
  }, [activeWorkspace, loadMembers]);

  async function handleSaveWorkspace(e: React.FormEvent) {
    e.preventDefault();
    if (!activeWorkspace) return;
    setFeedback(null);
    setError(null);
    try {
      await apiRequest(`/api/workspaces/${activeWorkspace.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          name: wsName.trim(),
          description: wsDescription.trim(),
          timezone: wsTimezone.trim(),
        }),
      });
      await refreshWorkspaces();
      setFeedback('Workspace governance details saved.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update workspace.');
    }
  }

  async function handleCreateWorkspace(e: React.FormEvent) {
    e.preventDefault();
    if (!newWsName.trim()) return;
    setFeedback(null);
    setError(null);
    try {
      const created = await createWorkspace({
        name: newWsName.trim(),
        timezone: DEFAULT_WORKSPACE_TIMEZONE,
        includeStarterBrands: newWsIncludeBrands,
      });
      setNewWsName('');
      setFeedback(`Created workspace "${created.name}".`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create workspace.');
    }
  }

  async function handleInvite(e: React.FormEvent) {
    e.preventDefault();
    if (!activeWorkspace) return;
    setFeedback(null);
    setError(null);
    try {
      await apiRequest(`/api/workspaces/${activeWorkspace.id}/members`, {
        method: 'POST',
        body: JSON.stringify({ email: inviteEmail.trim(), role: inviteRole }),
      });
      setInviteEmail('');
      await loadMembers();
      setFeedback('Workspace invitation recorded.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to send invitation.');
    }
  }

  async function handleRoleChange(
    memberUid: string,
    role: Exclude<WorkspaceRole, 'owner'>,
  ) {
    if (!activeWorkspace) return;
    setFeedback(null);
    setError(null);
    try {
      await apiRequest(`/api/workspaces/${activeWorkspace.id}/members/${memberUid}`, {
        method: 'PATCH',
        body: JSON.stringify({ role }),
      });
      await loadMembers();
      setFeedback('Member role updated.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to update member role.');
    }
  }

  return (
    <div className="space-y-8">
      <div>
        <p className="font-mono text-xs uppercase tracking-widest text-blue-700">
          Multi-Tenant Governance
        </p>
        <h1 className="mt-1 font-display text-2xl font-semibold text-slate-900">
          Workspaces, RBAC & Team Invitations
        </h1>
        <p className="mt-1 text-sm text-slate-600">
          Isolate brands, settings, and external credentials per tenant organization.
        </p>
      </div>

      {feedback && (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
          {feedback}
        </div>
      )}
      {error && (
        <div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
          {error}
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Workspace Governance Form */}
        <section className="rounded-xl border border-slate-200 bg-white p-6">
          <h2 className="text-base font-semibold text-slate-900">
            Active Workspace Settings
          </h2>
          <form onSubmit={handleSaveWorkspace} className="mt-4 space-y-4">
            <div>
              <label
                htmlFor="ws-edit-name"
                className="block text-xs font-medium text-slate-700"
              >
                Workspace Name
              </label>
              <input
                id="ws-edit-name"
                type="text"
                disabled={!canUpdateWorkspace}
                value={wsName}
                onChange={(e) => setWsName(e.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm disabled:bg-slate-50"
              />
            </div>

            <div>
              <label
                htmlFor="ws-edit-desc"
                className="block text-xs font-medium text-slate-700"
              >
                Description
              </label>
              <input
                id="ws-edit-desc"
                type="text"
                disabled={!canUpdateWorkspace}
                value={wsDescription}
                onChange={(e) => setWsDescription(e.target.value)}
                placeholder="Enterprise automation tenant"
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm disabled:bg-slate-50"
              />
            </div>

            <div>
              <label
                htmlFor="ws-edit-tz"
                className="block text-xs font-medium text-slate-700"
              >
                Default Timezone
              </label>
              <input
                id="ws-edit-tz"
                type="text"
                disabled={!canUpdateWorkspace}
                value={wsTimezone}
                onChange={(e) => setWsTimezone(e.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 font-mono text-sm disabled:bg-slate-50"
              />
            </div>

            {canUpdateWorkspace && (
              <button
                type="submit"
                className="rounded-lg bg-slate-900 px-4 py-2 text-xs font-medium text-white hover:bg-slate-800"
              >
                Save Workspace Details
              </button>
            )}
          </form>
        </section>

        {/* Create Additional Workspace */}
        <section className="rounded-xl border border-slate-200 bg-white p-6">
          <h2 className="text-base font-semibold text-slate-900">
            Create Tenant Workspace
          </h2>
          <form onSubmit={handleCreateWorkspace} className="mt-4 space-y-4">
            <div>
              <label
                htmlFor="new-ws-name"
                className="block text-xs font-medium text-slate-700"
              >
                New Workspace Name
              </label>
              <input
                id="new-ws-name"
                type="text"
                required
                value={newWsName}
                onChange={(e) => setNewWsName(e.target.value)}
                placeholder="Regional Operations"
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              />
            </div>

            <label className="flex items-center gap-2 text-xs text-slate-700">
              <input
                type="checkbox"
                checked={newWsIncludeBrands}
                onChange={(e) => setNewWsIncludeBrands(e.target.checked)}
                className="h-4 w-4 rounded border-slate-300 text-blue-700"
              />
              Initialize starter brands (Saket Personal, MAGNARC, GreenWeld, Sapphire)
            </label>

            <button
              type="submit"
              className="inline-flex items-center gap-1.5 rounded-lg bg-blue-700 px-4 py-2 text-xs font-medium text-white hover:bg-blue-800"
            >
              <Plus className="h-3.5 w-3.5" />
              Create Workspace
            </button>
          </form>

          <div className="mt-6 border-t border-slate-100 pt-4">
            <p className="font-mono text-[11px] uppercase tracking-wider text-slate-500">
              Your Workspaces ({workspaces.length})
            </p>
            <div className="mt-2 space-y-2">
              {workspaces.map((ws) => (
                <button
                  key={ws.id}
                  type="button"
                  onClick={() => setActiveWorkspaceId(ws.id)}
                  className={`flex w-full items-center justify-between rounded-lg border px-3 py-2 text-left text-xs ${
                    ws.id === activeWorkspace?.id
                      ? 'border-blue-600 bg-blue-50/40 font-semibold text-slate-900'
                      : 'border-slate-200 text-slate-700 hover:bg-slate-50'
                  }`}
                >
                  <span>{ws.name}</span>
                  <span className="font-mono uppercase text-slate-500">{ws.role}</span>
                </button>
              ))}
            </div>
          </div>
        </section>
      </div>

      {/* Team Members & RBAC */}
      <section className="rounded-xl border border-slate-200 bg-white p-6">
        <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
          <div>
            <h2 className="text-base font-semibold text-slate-900">
              Workspace Team & Role Matrix
            </h2>
            <p className="text-xs text-slate-500">
              Owner role cannot be downgraded or reassigned via client updates.
            </p>
          </div>

          {canInvite && (
            <form onSubmit={handleInvite} className="flex flex-wrap items-center gap-2">
              <input
                type="email"
                required
                aria-label="Invite member email"
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
                placeholder="teammate@company.com"
                className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs"
              />
              <select
                aria-label="Invite member role"
                value={inviteRole}
                onChange={(e) =>
                  setInviteRole(e.target.value as Exclude<WorkspaceRole, 'owner'>)
                }
                className="rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs"
              >
                <option value="admin">Admin</option>
                <option value="manager">Manager</option>
                <option value="editor">Editor</option>
                <option value="viewer">Viewer</option>
              </select>
              <button
                type="submit"
                className="inline-flex items-center gap-1 rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-800"
              >
                <UserPlus className="h-3.5 w-3.5" />
                Invite
              </button>
            </form>
          )}
        </div>

        <div className="mt-5 overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-slate-200 font-mono text-[11px] uppercase tracking-wider text-slate-500">
                <th className="py-2 pr-4">Member</th>
                <th className="py-2 pr-4">Role</th>
                <th className="py-2 pr-4">Status</th>
                <th className="py-2">Permissions Summary</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loadingMembers ? (
                <tr>
                  <td colSpan={4} className="py-6 text-xs text-slate-500">
                    Loading workspace members…
                  </td>
                </tr>
              ) : (
                members.map((m) => (
                  <tr key={m.uid}>
                    <td className="py-3 pr-4">
                      <p className="font-medium text-slate-900">{m.displayName}</p>
                      <p className="text-xs text-slate-500">{m.email}</p>
                    </td>
                    <td className="py-3 pr-4">
                      {canChangeRole && m.role !== 'owner' && m.uid !== firebaseUser?.uid ? (
                        <select
                          aria-label={`Change role for ${m.email}`}
                          value={m.role}
                          onChange={(e) =>
                            handleRoleChange(
                              m.uid,
                              e.target.value as Exclude<WorkspaceRole, 'owner'>,
                            )
                          }
                          className="rounded border border-slate-300 bg-white px-2 py-1 text-xs"
                        >
                          <option value="admin">admin</option>
                          <option value="manager">manager</option>
                          <option value="editor">editor</option>
                          <option value="viewer">viewer</option>
                        </select>
                      ) : (
                        <span className="font-mono text-xs font-semibold uppercase text-slate-800">
                          {m.role}
                        </span>
                      )}
                    </td>
                    <td className="py-3 pr-4 font-mono text-xs uppercase text-emerald-700">
                      {m.status}
                    </td>
                    <td className="py-3 text-xs text-slate-600">
                      {ROLE_METADATA[m.role]?.summary}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {invitations.length > 0 && (
          <div className="mt-6 border-t border-slate-100 pt-4">
            <p className="font-mono text-[11px] uppercase tracking-wider text-slate-500">
              Invitations ({invitations.length})
            </p>
            <div className="mt-2 divide-y divide-slate-100">
              {invitations.map((inv) => (
                <div
                  key={inv.id}
                  className="flex items-center justify-between py-2 text-xs"
                >
                  <span className="text-slate-800">
                    {inv.email} · role {inv.role}
                  </span>
                  <span className="font-mono uppercase text-slate-500">{inv.status}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
