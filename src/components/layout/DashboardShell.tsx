'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import {
  Activity,
  BarChart3,
  Bell,
  Building2,
  Calendar,
  CheckSquare,
  Compass,
  Cpu,
  Database,
  FileCode2,
  FlaskConical,
  FolderSync,
  Gauge,
  HeartPulse,
  HelpCircle,
  History,
  Image,
  Layers,
  LayoutDashboard,
  Lock,
  LogOut,
  Megaphone,
  Menu,
  MessageSquare,
  Palette,
  PenTool,
  Plug,
  Send,
  Settings,
  ShieldAlert,
  ShieldCheck,
  Star,
  Target,
  UserPlus,
  Users,
  Workflow,
  X,
} from 'lucide-react';
import { AuthGuard } from '@/components/auth/AuthGuard';
import { useAuth } from '@/components/providers/AuthContext';
import { useWorkspace } from '@/components/providers/WorkspaceContext';
import {
  ALL_DASHBOARD_NAV_ITEMS,
  DASHBOARD_NAV_GROUPS,
  type DashboardNavGroup,
  type DashboardNavItem,
} from '@/lib/navigation';

const ICON_MAP: Record<
  DashboardNavItem['iconName'],
  React.ComponentType<{ className?: string }>
> = {
  LayoutDashboard,
  Building2,
  Layers,
  Plug,
  Settings,
  ShieldCheck,
  Bell,
  Cpu,
  Users,
  FileCode2,
  Workflow,
  PenTool,
  Send,
  CheckSquare,
  BarChart3,
  History,
  Compass,
  Database,
  Megaphone,
  Calendar,
  Image,
  Palette,
  MessageSquare,
  Star,
  UserPlus,
  Target,
  FlaskConical,
  ShieldAlert,
  Activity,
  HeartPulse,
  Gauge,
  HelpCircle,
  Lock,
  FolderSync,
};

export function DashboardShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { profile, signOut } = useAuth();
  const { workspaces, activeWorkspace, setActiveWorkspaceId } = useWorkspace();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const isWorkspaceAdmin =
    activeWorkspace?.role === 'owner' || activeWorkspace?.role === 'admin';

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape' && sidebarOpen) {
        setSidebarOpen(false);
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [sidebarOpen]);

  async function handleSignOut() {
    await signOut();
    router.replace('/login');
  }

  const currentNavItem =
    ALL_DASHBOARD_NAV_ITEMS.find((item) =>
      item.href === '/dashboard'
        ? pathname === '/dashboard'
        : pathname === item.href || pathname.startsWith(`${item.href}/`),
    ) || null;

  function renderNavGroup(group: DashboardNavGroup) {
    const visibleItems = group.items.filter((item) => !item.adminOnly || isWorkspaceAdmin);
    if (visibleItems.length === 0) return null;

    return (
      <div key={group.id} className="space-y-0.5">
        <p className="px-3 pb-1 text-[11px] font-semibold tracking-wide text-slate-400">
          {group.title}
        </p>
        {visibleItems.map((item) => {
          const Icon = ICON_MAP[item.iconName];
          const active =
            item.href === '/dashboard'
              ? pathname === '/dashboard'
              : pathname === item.href ||
                (item.href !== '/dashboard/publishing' && pathname.startsWith(`${item.href}/`));

          return (
            <Link
              key={item.href}
              href={item.href}
              onClick={() => setSidebarOpen(false)}
              aria-current={active ? 'page' : undefined}
              className={`flex items-center gap-2.5 rounded-lg px-3 py-1.5 text-sm transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700 ${
                active
                  ? 'bg-slate-900 font-medium text-white'
                  : 'text-slate-700 hover:bg-slate-100 hover:text-slate-900'
              }`}
            >
              <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
              <span className="truncate whitespace-nowrap">{item.label}</span>
            </Link>
          );
        })}
      </div>
    );
  }

  const sidebarContent = (
    <div className="flex h-full flex-col bg-white">
      <div className="flex h-16 shrink-0 items-center justify-between border-b border-slate-200 px-4">
        <Link
          href="/dashboard"
          className="flex items-center gap-2.5 whitespace-nowrap focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700"
        >
          <span className="flex h-7 w-7 items-center justify-center rounded-md bg-slate-900 text-xs font-semibold text-white">
            AE
          </span>
          <span className="font-display text-sm font-semibold text-slate-900">
            Antara Engine
          </span>
        </Link>
        <button
          type="button"
          aria-label="Close navigation drawer"
          onClick={() => setSidebarOpen(false)}
          className="rounded-md p-2 text-slate-500 hover:bg-slate-100 lg:hidden"
        >
          <X className="h-5 w-5" />
        </button>
      </div>

      {/* Tenant Switcher */}
      <div className="border-b border-slate-100 p-4">
        <label
          htmlFor="ws-switcher"
          className="block text-[11px] font-medium text-slate-500"
        >
          Active Workspace
        </label>
        <select
          id="ws-switcher"
          value={activeWorkspace?.id || ''}
          onChange={(e) => setActiveWorkspaceId(e.target.value)}
          disabled={workspaces.length === 0}
          className="mt-1.5 w-full rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-2 text-sm font-medium text-slate-900 focus:border-blue-700 focus:outline-none"
        >
          {workspaces.length === 0 ? (
            <option value="">No workspace loaded</option>
          ) : (
            workspaces.map((ws) => (
              <option key={ws.id} value={ws.id}>
                {ws.name} ({ws.role})
              </option>
            ))
          )}
        </select>
      </div>

      <nav
        aria-label="Workspace navigation"
        className="flex-1 space-y-5 overflow-y-auto px-3 py-4"
      >
        {DASHBOARD_NAV_GROUPS.map((group) => renderNavGroup(group))}
      </nav>

      <div className="border-t border-slate-200 p-4">
        <p className="truncate text-xs font-medium text-slate-900">
          {profile?.displayName || 'Workspace Member'}
        </p>
        <p className="truncate text-xs text-slate-500">{profile?.email}</p>
        <button
          type="button"
          onClick={handleSignOut}
          className="mt-3 flex w-full items-center justify-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700"
        >
          <LogOut className="h-3.5 w-3.5" aria-hidden="true" />
          Sign Out
        </button>
      </div>
    </div>
  );

  return (
    <AuthGuard>
      <div className="flex min-h-screen bg-slate-50">
        <a
          href="#main-workspace-content"
          className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-lg focus:bg-slate-900 focus:px-4 focus:py-2 focus:text-sm focus:font-medium focus:text-white"
        >
          Skip to main content
        </a>

        {/* Desktop Sidebar */}
        <aside className="hidden w-64 shrink-0 border-r border-slate-200 lg:block">
          <div className="sticky top-0 h-screen">{sidebarContent}</div>
        </aside>

        {/* Mobile Drawer */}
        {sidebarOpen && (
          <div
            className="fixed inset-0 z-50 flex lg:hidden"
            role="dialog"
            aria-modal="true"
            aria-label="Workspace navigation drawer"
          >
            <div
              className="fixed inset-0 bg-slate-900/40"
              onClick={() => setSidebarOpen(false)}
              aria-hidden="true"
            />
            <aside className="relative z-10 w-72 max-w-[85vw] border-r border-slate-200">
              {sidebarContent}
            </aside>
          </div>
        )}

        {/* Main Shell */}
        <div className="flex min-w-0 flex-1 flex-col">
          <header className="sticky top-0 z-30 flex h-16 items-center justify-between gap-4 border-b border-slate-200 bg-white px-4 sm:px-6">
            <div className="flex min-w-0 items-center gap-3">
              <button
                type="button"
                aria-label="Open workspace navigation"
                onClick={() => setSidebarOpen(true)}
                className="rounded-lg border border-slate-200 p-2.5 text-slate-700 hover:bg-slate-50 lg:hidden"
              >
                <Menu className="h-4 w-4" />
              </button>
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-slate-900">
                  {activeWorkspace?.name || 'Antara Workspace'}
                  {currentNavItem && currentNavItem.href !== '/dashboard' ? (
                    <span className="font-normal text-slate-400">
                      {' '}
                      / <span className="text-slate-700">{currentNavItem.label}</span>
                    </span>
                  ) : null}
                </p>
                <p className="truncate font-mono text-[11px] text-slate-500">
                  {activeWorkspace?.role || 'viewer'} · {activeWorkspace?.timezone || 'Asia/Kolkata'}
                </p>
              </div>
            </div>

            <div className="flex shrink-0 items-center gap-2 sm:gap-3">
              <Link
                href="/dashboard/autonomy"
                className="inline-flex items-center whitespace-nowrap rounded-lg border border-slate-200 px-3 py-2 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-50"
              >
                Autonomy &amp; Stop
              </Link>
              <Link
                href="/dashboard/notifications"
                aria-label="Notifications"
                className="rounded-lg border border-slate-200 p-2 text-slate-600 transition-colors hover:bg-slate-50 hover:text-slate-900"
              >
                <Bell className="h-4 w-4" />
              </Link>
              <Link
                href="/dashboard/ai"
                className="hidden whitespace-nowrap rounded-lg bg-slate-900 px-3.5 py-2 text-xs font-medium text-white transition-colors hover:bg-slate-800 sm:inline-flex"
              >
                AI Command
              </Link>
            </div>
          </header>

          <main
            id="main-workspace-content"
            className="mx-auto w-full max-w-6xl flex-1 p-4 sm:p-6 lg:p-8"
          >
            {children}
          </main>
        </div>
      </div>
    </AuthGuard>
  );
}
