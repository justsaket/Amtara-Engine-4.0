'use client';

import React from 'react';

interface ErrorBoundaryState {
  hasError: boolean;
  message: string;
}

export class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  ErrorBoundaryState
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, message: '' };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return {
      hasError: true,
      message: error.message || 'An unexpected application error occurred.',
    };
  }

  componentDidCatch(error: Error): void {
    console.error('Antara Engine UI Error:', error);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex min-h-screen items-center justify-center bg-slate-50 px-6 py-16">
          <div className="w-full max-w-lg rounded-xl border border-slate-200 bg-white p-8 shadow-sm">
            <p className="font-mono text-xs uppercase tracking-wider text-rose-700">
              Runtime Recovery Boundary
            </p>
            <h1 className="mt-2 text-xl font-semibold text-slate-900">
              Unable to render this view
            </h1>
            <p className="mt-3 text-sm leading-relaxed text-slate-600">
              {this.state.message}
            </p>
            <button
              type="button"
              onClick={() => {
                this.setState({ hasError: false, message: '' });
                if (typeof window !== 'undefined') {
                  window.location.reload();
                }
              }}
              className="mt-6 inline-flex items-center rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800"
            >
              Reload Application
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
