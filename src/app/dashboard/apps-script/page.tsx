import React, { Suspense } from 'react';
import { AppsScriptWorkspaceConsole } from '@/components/apps-script/AppsScriptWorkspaceConsole';

export default function AppsScriptCenterPage() {
  return (
    <Suspense
      fallback={
        <div className="rounded-xl border border-slate-200 bg-white p-8 text-sm text-slate-500">
          Loading Apps Script Control Plane…
        </div>
      }
    >
      <AppsScriptWorkspaceConsole />
    </Suspense>
  );
}
