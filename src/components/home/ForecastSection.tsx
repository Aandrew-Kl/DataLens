"use client";

import { useState } from "react";
import dynamic from "next/dynamic";

import type { ColumnProfile } from "@/types/dataset";
import DataForecast from "@/components/data/data-forecast";
import { ErrorBoundary } from "@/components/ui/error-boundary";

import { AnimatedWorkspaceSection } from "@/components/home/workspace-shared";

const TimeSeriesForecast = dynamic(
  () => import("@/components/data/time-series-forecast"),
  { ssr: false },
);

interface ForecastSectionProps {
  tableName: string;
  columns: ColumnProfile[];
}

export default function ForecastSection({
  tableName,
  columns,
}: ForecastSectionProps) {
  const [showMoreForecast, setShowMoreForecast] = useState(false);

  return (
    <AnimatedWorkspaceSection>
      <div>
        <h2 className="text-lg font-semibold text-slate-900 dark:text-white mb-1">
          Forecasting
        </h2>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Project future values from time-series columns with confidence bands
          and exportable forecast outputs.
        </p>
      </div>
      <ErrorBoundary>
        <DataForecast tableName={tableName} columns={columns} />
      </ErrorBoundary>
      <div className="mt-6">
        <button
          type="button"
          onClick={() => setShowMoreForecast((current) => !current)}
          className="flex items-center gap-2 text-sm font-semibold text-slate-700 hover:text-sky-600 dark:text-slate-200"
        >
          {showMoreForecast ? "▾" : "▸"} More Forecast Tools (1 available)
        </button>
        {showMoreForecast && (
          <div className="mt-4 grid gap-6">
            <ErrorBoundary>
              <TimeSeriesForecast tableName={tableName} columns={columns} />
            </ErrorBoundary>
          </div>
        )}
      </div>
    </AnimatedWorkspaceSection>
  );
}
