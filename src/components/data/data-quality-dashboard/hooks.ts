import { startTransition, useEffect, useEffectEvent, useMemo, useState } from "react";

import { runQuery } from "@/lib/duckdb/client";
import type { ColumnProfile } from "@/types/dataset";

import { buildDashboardMetrics, buildMetricQuery } from "./query";
import type { DashboardMetrics } from "./types";

export function useDarkMode() {
  const [dark, setDark] = useState(false);

  const syncDarkMode = useEffectEvent(() => {
    setDark(document.documentElement.classList.contains("dark"));
  });

  useEffect(() => {
    syncDarkMode();
    const observer = new MutationObserver(() => syncDarkMode());
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class"],
    });
    return () => observer.disconnect();
  }, []);

  return dark;
}

export function useQualityMetrics(tableName: string, columns: ColumnProfile[]) {
  const [metrics, setMetrics] = useState<DashboardMetrics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const signature = useMemo(
    () =>
      `${tableName}:${columns
        .map(
          (column) =>
            `${column.name}:${column.type}:${column.nullCount}:${column.uniqueCount}`,
        )
        .join("|")}`,
    [columns, tableName],
  );

  useEffect(() => {
    if (!columns.length) {
      setMetrics(null);
      setLoading(false);
      setError(null);
      return;
    }

    let cancelled = false;

    async function loadMetrics() {
      setLoading(true);
      setError(null);

      try {
        const sql = buildMetricQuery(tableName, columns);
        const row = (await runQuery(sql))[0] ?? {};
        if (cancelled) return;
        const nextMetrics = buildDashboardMetrics(row, columns);
        startTransition(() => setMetrics(nextMetrics));
      } catch (nextError) {
        if (cancelled) return;
        setError(
          nextError instanceof Error
            ? nextError.message
            : "Unable to compute data quality metrics.",
        );
        startTransition(() => setMetrics(null));
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void loadMetrics();

    return () => {
      cancelled = true;
    };
  }, [columns, signature, tableName]);

  return { metrics, loading, error };
}
