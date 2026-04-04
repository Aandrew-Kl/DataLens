"use client";

import { Component, type ErrorInfo, type ReactNode } from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";

const GLASS_PANEL_CLASS =
  "rounded-2xl border border-white/30 bg-white/60 p-5 backdrop-blur-xl dark:border-white/10 dark:bg-slate-900/60";

interface ErrorBoundaryProps {
  children: ReactNode;
  fallback?: ReactNode;
  onReset?: () => void;
}

interface ErrorBoundaryState {
  error: Error | null;
}

interface ErrorStateCardProps {
  error: Error | null;
  onRetry?: () => void;
  title?: string;
  description?: string;
}

export function ErrorStateCard({
  error,
  onRetry,
  title = "Something went wrong",
  description = "We couldn't render this part of DataLens. Try again to recover.",
}: ErrorStateCardProps) {
  return (
    <div className="flex min-h-[280px] items-center justify-center p-4">
      <div
        role="alert"
        className={`${GLASS_PANEL_CLASS} w-full max-w-lg space-y-4 text-center shadow-xl shadow-slate-950/5`}
      >
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-rose-500/10 text-rose-600 dark:bg-rose-500/15 dark:text-rose-300">
          <AlertTriangle className="h-6 w-6" />
        </div>

        <div className="space-y-2">
          <h2 className="text-lg font-semibold text-slate-950 dark:text-slate-50">
            {title}
          </h2>
          <p className="text-sm leading-6 text-slate-600 dark:text-slate-300">
            {description}
          </p>
          <p className="rounded-xl border border-white/35 bg-white/55 px-3 py-2 text-sm text-slate-700 dark:border-white/10 dark:bg-slate-950/45 dark:text-slate-200">
            {error?.message || "An unexpected runtime error interrupted this view."}
          </p>
        </div>

        {onRetry ? (
          <div className="flex justify-center">
            <button
              type="button"
              onClick={onRetry}
              className="inline-flex items-center justify-center gap-2 rounded-xl bg-slate-950 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-slate-800 dark:bg-white dark:text-slate-950 dark:hover:bg-slate-200"
            >
              <RefreshCw className="h-4 w-4" />
              Try again
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}

export class ErrorBoundary extends Component<
  ErrorBoundaryProps,
  ErrorBoundaryState
> {
  state: ErrorBoundaryState = {
    error: null,
  };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    if (process.env.NODE_ENV === "development") {
      console.error("ErrorBoundary caught an error:", error, errorInfo);
    }
  }

  private handleReset = () => {
    this.setState({ error: null });
    this.props.onReset?.();
  };

  render() {
    if (this.state.error) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      return <ErrorStateCard error={this.state.error} onRetry={this.handleReset} />;
    }

    return this.props.children;
  }
}

export function ErrorFallback({
  error,
  resetErrorBoundary,
}: {
  error: Error;
  resetErrorBoundary: () => void;
}) {
  return <ErrorStateCard error={error} onRetry={resetErrorBoundary} />;
}
