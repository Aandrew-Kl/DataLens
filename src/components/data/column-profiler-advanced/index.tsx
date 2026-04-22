"use client";

import { AnimatePresence, motion } from "framer-motion";
import { AlertTriangle } from "lucide-react";
import { useState } from "react";

import { runQuery } from "@/lib/duckdb/client";
import { quoteIdentifier } from "@/lib/utils/sql";
import type { ColumnProfile } from "@/types/dataset";

import { useAdvancedProfile, useEscapeToClose } from "./hooks";
import { escapeCsv, triggerDownload, useDarkMode } from "./lib";
import { DistributionCard, FrequencyCard } from "./parts/distribution-frequency";
import { Header } from "./parts/header";
import { OutlierCard } from "./parts/outlier-card";
import { PatternCard } from "./parts/pattern-card";
import { Card } from "./parts/primitives";
import { QualityCard, StatisticsCard } from "./parts/statistics-quality";
import { TemporalCard } from "./parts/temporal-card";
import { EASE } from "./types";

interface ColumnProfilerAdvancedProps {
  tableName: string;
  column: ColumnProfile;
  rowCount: number;
  onClose: () => void;
}

export default function ColumnProfilerAdvanced({
  tableName,
  column,
  rowCount,
  onClose,
}: ColumnProfilerAdvancedProps) {
  const dark = useDarkMode();
  const { data, loading, error } = useAdvancedProfile(tableName, column, rowCount);
  const [copied, setCopied] = useState(false);
  const [exporting, setExporting] = useState(false);

  useEscapeToClose(onClose);

  const histogramColor =
    column.type === "number" ? "#38bdf8" : column.type === "date" ? "#34d399" : "#a855f7";

  const handleCopyStatistics = async () => {
    if (!data) return;
    const payload = {
      tableName,
      column: column.name,
      type: column.type,
      statistics: data.statistics,
      quality: data.quality,
      patterns: data.patterns,
      temporal: data.temporal,
      outliers: data.outliers,
    };
    await navigator.clipboard.writeText(JSON.stringify(payload, null, 2));
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  };

  const handleExportColumn = async () => {
    setExporting(true);
    try {
      const rows = await runQuery(
        `SELECT ${quoteIdentifier(column.name)} AS value FROM ${quoteIdentifier(tableName)}`,
      );
      const csv = ["value", ...rows.map((row) => escapeCsv(row.value))].join("\n");
      triggerDownload(
        new Blob([csv], { type: "text/csv;charset=utf-8" }),
        `${tableName}-${column.name}.csv`,
      );
    } finally {
      setExporting(false);
    }
  };

  return (
    <AnimatePresence>
      <motion.div
        className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-3 backdrop-blur-md sm:p-6"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.24, ease: EASE }}
        onClick={onClose}
      >
        <motion.div
          initial={{ opacity: 0, y: 28, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 20, scale: 0.99 }}
          transition={{ duration: 0.34, ease: EASE }}
          onClick={(event) => event.stopPropagation()}
          className="flex h-[96vh] w-full max-w-[1500px] flex-col overflow-hidden rounded-[2rem] border border-white/15 bg-slate-100/90 shadow-2xl shadow-slate-950/30 backdrop-blur-2xl dark:bg-slate-950/85"
        >
          <Header
            tableName={tableName}
            columnName={column.name}
            copied={copied}
            exporting={exporting}
            onCopy={handleCopyStatistics}
            onExport={handleExportColumn}
            onClose={onClose}
          />

          <div className="flex-1 overflow-y-auto px-4 py-4 sm:px-6">
            {loading && !data ? (
              <div className="grid gap-4 xl:grid-cols-2">
                {Array.from({ length: 6 }).map((_, index) => (
                  <div
                    key={index}
                    className="h-72 animate-pulse rounded-[1.75rem] border border-white/20 bg-white/60 dark:border-white/10 dark:bg-slate-900/40"
                  />
                ))}
              </div>
            ) : error ? (
              <Card title="Profile Error" icon={AlertTriangle} subtitle={error}>
                <p className="text-sm text-slate-600 dark:text-slate-300">
                  DuckDB could not compute the requested column profile for this field.
                </p>
              </Card>
            ) : data ? (
              <div className="grid gap-4">
                <div className="grid gap-4 xl:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]">
                  <StatisticsCard statistics={data.statistics} />
                  <QualityCard quality={data.quality} />
                </div>

                <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
                  <DistributionCard
                    histogram={data.histogram}
                    columnType={column.type}
                    dark={dark}
                    color={histogramColor}
                  />
                  <FrequencyCard frequencyRows={data.frequencyRows} />
                </div>

                {data.patterns ? <PatternCard patterns={data.patterns} /> : null}
                {data.temporal ? <TemporalCard temporal={data.temporal} dark={dark} /> : null}
                {data.outliers ? <OutlierCard outliers={data.outliers} dark={dark} /> : null}
              </div>
            ) : null}
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
