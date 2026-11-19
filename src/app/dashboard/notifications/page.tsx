'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { Bell, Check } from 'lucide-react';
import { useWorkspace } from '@/components/providers/WorkspaceContext';
import { apiRequest } from '@/lib/api-client';
import type { NotificationRecord } from '@/types/domain';

export default function NotificationsPage() {
  const { activeWorkspace } = useWorkspace();
  const [items, setItems] = useState<NotificationRecord[]>([]);
  const [loading, setLoading] = useState(false);

  const loadNotifications = useCallback(async () => {
    if (!activeWorkspace) return;
    setLoading(true);
    try {
      const res = await apiRequest<{ notifications: NotificationRecord[] }>(
        `/api/workspaces/${activeWorkspace.id}/notifications`,
      );
      setItems(res.notifications);
    } finally {
      setLoading(false);
    }
  }, [activeWorkspace]);

  useEffect(() => {
    void loadNotifications();
  }, [loadNotifications]);

  async function handleToggleRead(item: NotificationRecord) {
    if (!activeWorkspace) return;
    await apiRequest(`/api/workspaces/${activeWorkspace.id}/notifications`, {
      method: 'PATCH',
      body: JSON.stringify({
        notificationId: item.id,
        read: !item.read,
      }),
    });
    await loadNotifications();
  }

  return (
    <div className="space-y-6">
      <div>
        <p className="font-mono text-xs uppercase tracking-widest text-blue-700">
          Workspace Alerts
        </p>
        <h1 className="mt-1 font-display text-2xl font-semibold text-slate-900">
          Notifications
        </h1>
        <p className="mt-1 text-sm text-slate-600">
          Onboarding confirmations, configuration notices, and security status events.
        </p>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white">
        {loading ? (
          <p className="p-6 text-sm text-slate-500">Loading notifications…</p>
        ) : items.length === 0 ? (
          <div className="flex flex-col items-center justify-center p-10 text-center">
            <Bell className="h-6 w-6 text-slate-400" />
            <p className="mt-2 text-sm font-medium text-slate-900">
              No notifications yet
            </p>
            <p className="mt-1 text-xs text-slate-500">
              Workspace onboarding and security alerts will appear here.
            </p>
          </div>
        ) : (
          <div className="divide-y divide-slate-100">
            {items.map((item) => (
              <div
                key={item.id}
                className={`flex flex-col justify-between gap-3 p-5 sm:flex-row sm:items-center ${
                  item.read ? 'bg-white' : 'bg-blue-50/30'
                }`}
              >
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-[10px] uppercase tracking-wider text-blue-700">
                      {item.category}
                    </span>
                    <span className="font-mono text-[10px] uppercase text-slate-400">
                      {item.severity}
                    </span>
                  </div>
                  <h2 className="mt-1 text-sm font-semibold text-slate-900">
                    {item.title}
                  </h2>
                  <p className="mt-1 text-xs text-slate-600">{item.message}</p>
                </div>
                <button
                  type="button"
                  onClick={() => handleToggleRead(item)}
                  className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
                >
                  <Check className="h-3.5 w-3.5" />
                  {item.read ? 'Mark Unread' : 'Mark Read'}
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
