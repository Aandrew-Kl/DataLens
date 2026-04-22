"use client";

import { AnimatePresence, motion } from "framer-motion";

import type { ColumnProfile } from "@/types/dataset";

import { useDarkMode, useQualityMetrics } from "./hooks";
import { ColumnTable } from "./parts/column-table";
import { DashboardHeader } from "./parts/header";
import { DimensionCard } from "./parts/dimension-card";
import { ExecutivePanel } from "./parts/executive-panel";
import { EmptyState, ErrorState, LoadingState } from "./parts/states";
import { SummaryPanel } from "./parts/summary-panel";
import { containerVariants } from "./types";

interface DataQualityDashboardProps {
  tableName: string;
  columns: ColumnProfile[];
}

export default function DataQualityDashboard({
  tableName,
  columns,
}: DataQualityDashboardProps) {
  const dark = useDarkMode();
  const { metrics, loading, error } = useQualityMetrics(tableName, columns);

  const dimensionList = metrics
    ? [
        metrics.dimensions.completeness,
        metrics.dimensions.uniqueness,
        metrics.dimensions.validity,
        metrics.dimensions.consistency,
        metrics.dimensions.timeliness,
      ]
    : [];

  const weakestColumn = metrics?.columnRows[0] ?? null;
  const healthiestColumns = metrics
    ? metrics.columnRows.filter((column) => column.overall >= 90).length
    : 0;

  return (
    <section className="overflow-hidden rounded-[32px] border border-slate-200/70 bg-linear-to-br from-slate-50/95 via-white/85 to-slate-100/80 shadow-[0_28px_100px_-46px_rgba(15,23,42,0.52)] backdrop-blur-2xl dark:border-slate-800/80 dark:from-slate-950 dark:via-slate-950/95 dark:to-slate-900/92">
      <DashboardHeader tableName={tableName} columnCount={columns.length} />

      <AnimatePresence mode="wait">
        {loading ? (
          <motion.div key="loading" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <LoadingState />
          </motion.div>
        ) : error ? (
          <motion.div
            key="error"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
          >
            <ErrorState message={error} />
          </motion.div>
        ) : !metrics ? (
          <motion.div
            key="empty"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
          >
            <EmptyState tableName={tableName} />
          </motion.div>
        ) : (
          <motion.div
            key="ready"
            variants={containerVariants}
            initial="hidden"
            animate="show"
            className="space-y-6 px-6 py-6"
          >
            <div className="grid gap-6 xl:grid-cols-[1.12fr_0.88fr]">
              <SummaryPanel
                metrics={metrics}
                dimensionList={dimensionList}
                columnCount={columns.length}
                healthiestColumns={healthiestColumns}
                weakestColumn={weakestColumn}
                dark={dark}
              />
              <ExecutivePanel
                overallScore={metrics.overallScore}
                dimensionList={dimensionList}
                weakestColumn={weakestColumn}
              />
            </div>

            <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
              {dimensionList.map((summary) => (
                <DimensionCard key={summary.key} dark={dark} summary={summary} />
              ))}
            </div>

            <ColumnTable metrics={metrics} healthiestColumns={healthiestColumns} />
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  );
}
