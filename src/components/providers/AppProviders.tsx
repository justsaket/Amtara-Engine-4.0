'use client';

import React from 'react';
import { AuthProvider } from './AuthContext';
import { ErrorBoundary } from './ErrorBoundary';
import { WorkspaceProvider } from './WorkspaceContext';

export function AppProviders({ children }: { children: React.ReactNode }) {
  return (
    <ErrorBoundary>
      <AuthProvider>
        <WorkspaceProvider>{children}</WorkspaceProvider>
      </AuthProvider>
    </ErrorBoundary>
  );
}
