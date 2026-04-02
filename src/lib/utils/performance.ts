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
