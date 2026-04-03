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
