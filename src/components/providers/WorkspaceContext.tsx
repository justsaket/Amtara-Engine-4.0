'use client';

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { apiRequest } from '@/lib/api-client';
import { useAuth } from './AuthContext';
import type { WorkspaceWithRole } from '@/types/domain';

interface WorkspaceContextValue {
  workspaces: WorkspaceWithRole[];
  activeWorkspace: WorkspaceWithRole | null;
  loading: boolean;
  error: string | null;
  setActiveWorkspaceId: (workspaceId: string) => void;
  refreshWorkspaces: () => Promise<WorkspaceWithRole[]>;
  createWorkspace: (input: {
    name: string;
    description?: string;
    timezone?: string;
    includeStarterBrands?: boolean;
  }) => Promise<WorkspaceWithRole>;
}

const WorkspaceContext = createContext<WorkspaceContextValue | null>(null);
const ACTIVE_WS_STORAGE_KEY = 'antara_active_workspace_id';

export function WorkspaceProvider({ children }: { children: React.ReactNode }) {
  const { firebaseUser, profile } = useAuth();
  const [workspaces, setWorkspaces] = useState<WorkspaceWithRole[]>([]);
  const [activeWorkspaceId, setActiveWorkspaceIdState] = useState<string>('');
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const refreshWorkspaces = useCallback(async (): Promise<WorkspaceWithRole[]> => {
    if (!firebaseUser) {
      setWorkspaces([]);
      setActiveWorkspaceIdState('');
      return [];
    }
    setLoading(true);
    setError(null);
    try {
      const data = await apiRequest<{ workspaces: WorkspaceWithRole[] }>(
        '/api/workspaces',
      );
      setWorkspaces(data.workspaces);

      const saved =
        typeof window !== 'undefined'
          ? window.localStorage.getItem(ACTIVE_WS_STORAGE_KEY) || ''
          : '';
      const validSaved = data.workspaces.find((w) => w.id === saved)?.id;
      const validDefault = data.workspaces.find(
        (w) => w.id === profile?.defaultWorkspaceId,
      )?.id;
      const nextId = validSaved || validDefault || data.workspaces[0]?.id || '';
      setActiveWorkspaceIdState(nextId);
      if (nextId && typeof window !== 'undefined') {
        window.localStorage.setItem(ACTIVE_WS_STORAGE_KEY, nextId);
      }
      return data.workspaces;
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Unable to load workspace list.',
      );
      return [];
    } finally {
      setLoading(false);
    }
  }, [firebaseUser, profile?.defaultWorkspaceId]);

  useEffect(() => {
    if (firebaseUser && profile) {
      void refreshWorkspaces();
    } else if (!firebaseUser) {
      setWorkspaces([]);
      setActiveWorkspaceIdState('');
    }
  }, [firebaseUser, profile, refreshWorkspaces]);

  const setActiveWorkspaceId = useCallback((workspaceId: string) => {
    setActiveWorkspaceIdState(workspaceId);
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(ACTIVE_WS_STORAGE_KEY, workspaceId);
    }
  }, []);

  const createWorkspace = useCallback(
    async (input: {
      name: string;
      description?: string;
      timezone?: string;
      includeStarterBrands?: boolean;
    }): Promise<WorkspaceWithRole> => {
      const data = await apiRequest<{ workspace: WorkspaceWithRole }>(
        '/api/workspaces',
        {
          method: 'POST',
          body: JSON.stringify(input),
        },
      );
      await refreshWorkspaces();
      setActiveWorkspaceId(data.workspace.id);
      return data.workspace;
    },
    [refreshWorkspaces, setActiveWorkspaceId],
  );

  const activeWorkspace = useMemo(
    () => workspaces.find((w) => w.id === activeWorkspaceId) || workspaces[0] || null,
    [workspaces, activeWorkspaceId],
  );

  const value = useMemo<WorkspaceContextValue>(
    () => ({
      workspaces,
      activeWorkspace,
      loading,
      error,
      setActiveWorkspaceId,
      refreshWorkspaces,
      createWorkspace,
    }),
    [
      workspaces,
      activeWorkspace,
      loading,
      error,
      setActiveWorkspaceId,
      refreshWorkspaces,
      createWorkspace,
    ],
  );

  return (
    <WorkspaceContext.Provider value={value}>
      {children}
    </WorkspaceContext.Provider>
  );
}

export function useWorkspace(): WorkspaceContextValue {
  const ctx = useContext(WorkspaceContext);
  if (!ctx) {
    throw new Error('useWorkspace must be used inside <WorkspaceProvider>.');
  }
  return ctx;
}
