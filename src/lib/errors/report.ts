import * as Sentry from "@sentry/nextjs";

export interface ErrorContext {
  scope?: string;
  componentStack?: string;
  [key: string]: unknown;
}

export function reportError(error: unknown, context?: ErrorContext): void {
  const err = error instanceof Error ? error : new Error(String(error));

  if (process.env.NEXT_PUBLIC_SENTRY_DSN) {
    Sentry.captureException(err, { extra: context });
  }

  if (process.env.NODE_ENV !== "production") {
    console.error(`[reportError:${context?.scope ?? "unknown"}]`, err, context);
  }
}
