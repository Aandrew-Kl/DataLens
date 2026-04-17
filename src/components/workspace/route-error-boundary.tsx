"use client";

import { Component, type ErrorInfo, type ReactNode } from "react";
import { AlertCircle, RotateCcw } from "lucide-react";
import { reportError } from "@/lib/errors/report";

interface Props {
  children: ReactNode;
  scope?: string;
  fallback?: ReactNode;
}

interface State {
  error: Error | null;
}

export class RouteErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    reportError(error, {
      scope: this.props.scope ?? "route-error-boundary",
      componentStack: errorInfo.componentStack ?? undefined,
    });
  }

  handleReset = () => this.setState({ error: null });

  render() {
    if (this.state.error) {
      if (this.props.fallback) return this.props.fallback;

      return (
        <div className="rounded-[1.3rem] border border-rose-200/50 bg-rose-50/70 p-5 text-rose-950 shadow-[0_18px_40px_-28px_rgba(15,23,42,0.35)] backdrop-blur-xl dark:bg-rose-950/20 dark:text-rose-100">
          <div className="flex items-start gap-3">
            <div className="mt-0.5 inline-flex h-10 w-10 items-center justify-center rounded-xl border border-rose-200/70 bg-white/70 dark:border-rose-400/20 dark:bg-rose-950/30">
              <AlertCircle className="h-5 w-5" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold">This section failed to render</p>
              <p className="mt-1 text-sm text-rose-800/80 dark:text-rose-200/80">
                {this.state.error.message || "An unexpected error occurred."}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={this.handleReset}
            className="mt-4 inline-flex items-center gap-2 rounded-xl border border-rose-200/70 bg-white/80 px-4 py-2 text-sm font-semibold text-rose-900 transition hover:bg-white dark:border-rose-400/20 dark:bg-rose-950/40 dark:text-rose-100 dark:hover:bg-rose-950/60"
          >
            <RotateCcw className="h-4 w-4" />
            Retry
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}

export default RouteErrorBoundary;
