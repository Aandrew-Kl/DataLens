/**
 * Performance measurement helpers.
 *
 * Two complementary APIs live here:
 *
 *  1. **Ad-hoc timing** — `measureQueryTime` + `createPerformanceTracker`
 *     provide a lightweight, in-memory way to time individual promise-returning
 *     operations and aggregate the results.
 *
 *  2. **Named render / query instrumentation** — `measureRender` and
 *     `measureQuery` integrate with the browser `Performance` API (marks &
 *     measures) and collect the observations into a report that can be
 *     inspected via `getPerformanceReport()` / cleared via `clearMetrics()`.
 *
 * Both used to live in separate modules (`performance.ts` + `performance-monitor.ts`).
 * They share the same domain so they were consolidated here with two clearly
 * labelled sections.
 */

// ---------------------------------------------------------------------------
// Section 1: Ad-hoc timing helpers
// ---------------------------------------------------------------------------

type OperationMetrics = {
  count: number;
  totalDurationMs: number;
  averageDurationMs: number;
  lastDurationMs: number;
  minDurationMs: number;
  maxDurationMs: number;
};

export type PerformanceMetrics = {
  totalDurationMs: number;
  completedOperations: number;
  activeOperations: number;
  operations: Record<string, OperationMetrics>;
};

const DEFAULT_OPERATION = "default";

function now(): number {
  return typeof performance !== "undefined" ? performance.now() : Date.now();
}

export async function measureQueryTime<T>(
  fn: () => Promise<T>
): Promise<{ result: T; durationMs: number }> {
  const startedAt = now();
  const result = await fn();

  return {
    result,
    durationMs: now() - startedAt,
  };
}

/**
 * Format a millisecond duration as a compact human-readable string.
 *
 * This is a performance-oriented formatter that treats negative / NaN inputs
 * as `0ms` and uses slightly different unit boundaries than the generic
 * `formatDuration` in `formatters.ts`. Kept as `formatDuration` in this file
 * because callers expect this exact semantics.
 */
export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return "0ms";
  if (ms < 1) return "<1ms";
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 10_000) return `${(ms / 1000).toFixed(1)}s`;
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`;

  const minutes = Math.floor(ms / 60_000);
  const seconds = Math.round((ms % 60_000) / 1000);

  if (minutes < 60) return `${minutes}m ${seconds}s`;

  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m`;
}

export function createPerformanceTracker() {
  const activeStarts = new Map<string, number[]>();
  const completedDurations = new Map<string, number[]>();

  const start = (operationName = DEFAULT_OPERATION): void => {
    const starts = activeStarts.get(operationName) ?? [];
    starts.push(now());
    activeStarts.set(operationName, starts);
  };

  const end = (operationName = DEFAULT_OPERATION): number => {
    const starts = activeStarts.get(operationName);
    const startedAt = starts?.pop();

    if (startedAt === undefined || !starts) return 0;
    if (starts.length === 0) activeStarts.delete(operationName);

    const durationMs = now() - startedAt;
    const durations = completedDurations.get(operationName) ?? [];
    durations.push(durationMs);
    completedDurations.set(operationName, durations);

    return durationMs;
  };

  const getDuration = (operationName?: string): number => {
    if (operationName) {
      const durations = completedDurations.get(operationName);
      return durations?.[durations.length - 1] ?? 0;
    }

    let totalDurationMs = 0;

    for (const durations of completedDurations.values()) {
      for (const durationMs of durations) totalDurationMs += durationMs;
    }

    return totalDurationMs;
  };

  const getMetrics = (): PerformanceMetrics => {
    const operations: PerformanceMetrics["operations"] = {};
    let totalDurationMs = 0;
    let completedOperations = 0;
    let activeOperations = 0;

    for (const starts of activeStarts.values()) activeOperations += starts.length;

    for (const [operationName, durations] of completedDurations.entries()) {
      const count = durations.length;
      const operationTotal = durations.reduce((sum, duration) => sum + duration, 0);

      operations[operationName] = {
        count,
        totalDurationMs: operationTotal,
        averageDurationMs: operationTotal / count,
        lastDurationMs: durations[count - 1],
        minDurationMs: Math.min(...durations),
        maxDurationMs: Math.max(...durations),
      };

      totalDurationMs += operationTotal;
      completedOperations += count;
    }

    return { totalDurationMs, completedOperations, activeOperations, operations };
  };

  return { start, end, getDuration, getMetrics };
}

// ---------------------------------------------------------------------------
// Section 2: Named render / query instrumentation
// ---------------------------------------------------------------------------

export interface RenderMetric {
  component: string;
  durationMs: number;
  timestamp: number;
}

export interface QueryMetric {
  label: string;
  durationMs: number;
  timestamp: number;
}

export interface PerformanceReport {
  renders: RenderMetric[];
  queries: QueryMetric[];
  totalRenders: number;
  avgRenderMs: number;
  totalQueries: number;
  avgQueryMs: number;
}

interface MeasurementSession {
  endMark: string;
  measureName: string;
  startMark: string;
  startedAt: number;
}

const renderMetrics: RenderMetric[] = [];
const queryMetrics: QueryMetric[] = [];

let measurementSequence = 0;

function isPerformanceApiAvailable(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof performance !== "undefined" &&
    typeof performance.mark === "function" &&
    typeof performance.measure === "function"
  );
}

function getNow(): number {
  if (typeof performance !== "undefined" && typeof performance.now === "function") {
    return performance.now();
  }

  return Date.now();
}

function createMeasurementSession(kind: "query" | "render", label: string): MeasurementSession {
  measurementSequence += 1;
  const suffix = `${kind}:${label}:${measurementSequence}`;

  return {
    startMark: `datalens:${suffix}:start`,
    endMark: `datalens:${suffix}:end`,
    measureName: `datalens:${suffix}:measure`,
    startedAt: getNow(),
  };
}

function readMeasuredDuration(session: MeasurementSession): number {
  if (
    isPerformanceApiAvailable() &&
    typeof performance.getEntriesByName === "function"
  ) {
    const entries = performance.getEntriesByName(session.measureName, "measure");
    const measuredEntry = entries[entries.length - 1];

    if (
      measuredEntry &&
      typeof measuredEntry.duration === "number" &&
      Number.isFinite(measuredEntry.duration)
    ) {
      return measuredEntry.duration;
    }
  }

  return Math.max(0, getNow() - session.startedAt);
}

function finalizeMeasurement(session: MeasurementSession): number {
  if (isPerformanceApiAvailable()) {
    performance.mark(session.endMark);
    performance.measure(session.measureName, session.startMark, session.endMark);
  }

  const durationMs = readMeasuredDuration(session);

  if (isPerformanceApiAvailable()) {
    if (typeof performance.clearMarks === "function") {
      performance.clearMarks(session.startMark);
      performance.clearMarks(session.endMark);
    }

    if (typeof performance.clearMeasures === "function") {
      performance.clearMeasures(session.measureName);
    }
  }

  return durationMs;
}

function markStart(session: MeasurementSession): void {
  if (isPerformanceApiAvailable()) {
    performance.mark(session.startMark);
  }
}

function average(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }

  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

export function measureRender(componentName: string): { start: () => void; end: () => void } {
  let activeSession: MeasurementSession | null = null;

  return {
    start: () => {
      activeSession = createMeasurementSession("render", componentName);
      markStart(activeSession);
    },
    end: () => {
      if (activeSession === null) {
        return;
      }

      const completedSession = activeSession;
      activeSession = null;

      renderMetrics.push({
        component: componentName,
        durationMs: finalizeMeasurement(completedSession),
        timestamp: Date.now(),
      });
    },
  };
}

export async function measureQuery<T>(
  label: string,
  fn: () => Promise<T>,
): Promise<{ result: T; durationMs: number }> {
  const session = createMeasurementSession("query", label);
  markStart(session);

  try {
    const result = await fn();
    const durationMs = finalizeMeasurement(session);

    queryMetrics.push({
      label,
      durationMs,
      timestamp: Date.now(),
    });

    return {
      result,
      durationMs,
    };
  } catch (error: unknown) {
    queryMetrics.push({
      label,
      durationMs: finalizeMeasurement(session),
      timestamp: Date.now(),
    });

    throw error;
  }
}

export function getPerformanceReport(): PerformanceReport {
  const renderDurations = renderMetrics.map((metric) => metric.durationMs);
  const queryDurations = queryMetrics.map((metric) => metric.durationMs);

  return {
    renders: [...renderMetrics],
    queries: [...queryMetrics],
    totalRenders: renderMetrics.length,
    avgRenderMs: average(renderDurations),
    totalQueries: queryMetrics.length,
    avgQueryMs: average(queryDurations),
  };
}

export function clearMetrics(): void {
  renderMetrics.length = 0;
  queryMetrics.length = 0;
}
