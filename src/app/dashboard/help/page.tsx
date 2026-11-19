'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { Download } from 'lucide-react';
import { useWorkspace } from '@/components/providers/WorkspaceContext';
import { apiRequest } from '@/lib/api-client';

const COMMON_ERRORS = [
  {
    code: 'APPROVAL_INVALIDATED',
    cause: 'Caption, media, destination account, or budget changed after a human approved the request.',
    resolution: 'Open Approvals Queue and approve the updated payload hash before publishing.',
  },
  {
    code: 'PUBLISH_STATUS_UNKNOWN',
    cause: 'External social API timed out or dropped connection after submission.',
    resolution:
      'Do not retry blindly. Open Publishing Center and run Reconcile Status first to verify whether the provider already created the post.',
  },
  {
    code: 'EMERGENCY_STOP_ACTIVE',
    cause: 'Global, brand, or platform Emergency Stop is engaged.',
    resolution: 'Verify incident resolution in Autonomy Settings before lifting the stop.',
  },
  {
    code: 'APP_REVIEW_REQUIRED',
    cause: 'Meta, TikTok, or Google Business Profile requires provider app review or API access approval.',
    resolution:
      'Keep drafts in Approval Queue or TikTok Draft Inbox until provider app review is approved in the external developer portal.',
  },
  {
    code: 'PAID_SPEND_NOT_AUTHORIZED',
    cause: 'Brand paid-advertising budget caps or explicit workspace owner authorization are missing.',
    resolution: 'Configure numeric daily/monthly limits under Performance / Campaigns.',
  },
  {
    code: 'TOKEN_EXPIRED',
    cause: 'External OAuth token expired or was revoked by the provider.',
    resolution: 'Re-authorize the affected account in Connected Accounts or Apps Script Center.',
  },
];

export default function HelpAndSupportPage() {
  const { activeWorkspace } = useWorkspace();
  const [exporting, setExporting] = useState(false);
  const [exportMessage, setExportMessage] = useState<string | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);

  async function handleExportWorkspace() {
    if (!activeWorkspace) return;
    setExporting(true);
    setExportError(null);
    setExportMessage(null);
    try {
      const payload = await apiRequest<Record<string, unknown>>(
        `/api/workspaces/${activeWorkspace.id}/export`,
      );
      const blob = new Blob([JSON.stringify(payload, null, 2)], {
        type: 'application/json',
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `antara-workspace-${activeWorkspace.slug || activeWorkspace.id}-export.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      setExportMessage(
        'Workspace data exported as JSON (all encrypted credentials and OAuth tokens excluded).',
      );
    } catch (err) {
      setExportError(
        err instanceof Error
          ? err.message
          : 'Export failed (requires Workspace Owner or Admin role).',
      );
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="border-b border-slate-200 pb-5">
        <p className="text-xs font-medium text-blue-700">Operator Documentation &amp; Governance</p>
        <h1 className="mt-1 font-display text-2xl font-semibold tracking-tight text-slate-900">
          Help Center &amp; Recovery Guides
        </h1>
        <p className="mt-1 text-sm text-slate-600">
          Integration instructions, error-code resolution, emergency recovery procedures, and
          self-service workspace data portability.
        </p>
      </div>

      {/* Quick Operations */}
      <div className="grid gap-4 sm:grid-cols-3">
        <div className="rounded-xl border border-slate-200 bg-white p-5">
          <h2 className="text-sm font-semibold text-slate-900">Pause Everything Instantly</h2>
          <p className="mt-1.5 text-xs leading-relaxed text-slate-600">
            Activate Global Emergency Stop to halt all scheduled publishing, autonomous actions,
            and outbound replies immediately.
          </p>
          <Link
            href="/dashboard/autonomy"
            className="mt-3 inline-block text-xs font-medium text-blue-700 hover:underline"
          >
            Open Autonomy &amp; Stop
          </Link>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-5">
          <h2 className="text-sm font-semibold text-slate-900">Reconnect Expired Accounts</h2>
          <p className="mt-1.5 text-xs leading-relaxed text-slate-600">
            Disconnecting or revoking a Google or social account automatically cancels pending
            jobs for that account without affecting other channels.
          </p>
          <Link
            href="/dashboard/publishing/accounts"
            className="mt-3 inline-block text-xs font-medium text-blue-700 hover:underline"
          >
            Open Connected Accounts
          </Link>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-5">
          <h2 className="text-sm font-semibold text-slate-900">Run Google OAuth Doctor</h2>
          <p className="mt-1.5 text-xs leading-relaxed text-slate-600">
            Verify Apps Script API permissions, granted scopes, and deployment entry points using
            the 16-check Google Doctor.
          </p>
          <Link
            href="/dashboard/apps-script"
            className="mt-3 inline-block text-xs font-medium text-blue-700 hover:underline"
          >
            Open Apps Script Center
          </Link>
        </div>
      </div>

      {/* Common Error Code Reference */}
      <section className="rounded-xl border border-slate-200 bg-white">
        <div className="border-b border-slate-200 px-5 py-4">
          <h2 className="text-sm font-semibold text-slate-900">
            Common Error Codes &amp; Recovery Procedures
          </h2>
        </div>
        <div className="divide-y divide-slate-100">
          {COMMON_ERRORS.map((item) => (
            <div key={item.code} className="px-5 py-3.5">
              <p className="font-mono text-xs font-semibold text-slate-900">{item.code}</p>
              <p className="mt-1 text-xs text-slate-600">
                <strong className="font-medium text-slate-800">Cause:</strong> {item.cause}
              </p>
              <p className="mt-0.5 text-xs text-slate-600">
                <strong className="font-medium text-slate-800">Recovery:</strong> {item.resolution}
              </p>
            </div>
          ))}
        </div>
      </section>

      {/* Data Portability & Account Governance */}
      <section className="rounded-xl border border-slate-200 bg-white p-5">
        <h2 className="text-sm font-semibold text-slate-900">
          Data Export &amp; Account Governance
        </h2>
        <p className="mt-1 text-xs text-slate-600">
          Workspace Owners and Administrators can export workspace brands, content, memory,
          leads, campaigns, and analytics as JSON. Encrypted OAuth credentials and master keys
          are strictly excluded.
        </p>

        {exportError && (
          <div role="alert" className="mt-3 rounded-lg border border-rose-200 bg-rose-50 p-3 text-xs text-rose-800">
            {exportError}
          </div>
        )}
        {exportMessage && (
          <div className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-900">
            {exportMessage}
          </div>
        )}

        <div className="mt-4 flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={() => void handleExportWorkspace()}
            disabled={!activeWorkspace || exporting}
            className="inline-flex items-center gap-2 rounded-lg bg-slate-900 px-4 py-2 text-xs font-medium text-white hover:bg-slate-800 disabled:opacity-50"
          >
            <Download className="h-3.5 w-3.5" />
            {exporting ? 'Preparing Export...' : 'Export Sanitized Workspace JSON'}
          </button>
          <Link
            href="/dashboard/settings"
            className="rounded-lg border border-slate-200 px-4 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50"
          >
            Account Deletion &amp; Settings
          </Link>
          <Link
            href="/privacy"
            className="text-xs font-medium text-blue-700 hover:underline"
          >
            Privacy Policy
          </Link>
          <Link
            href="/terms"
            className="text-xs font-medium text-blue-700 hover:underline"
          >
            Terms of Service
          </Link>
        </div>
      </section>
    </div>
  );
}
