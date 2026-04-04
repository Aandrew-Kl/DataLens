"use client";

import { useState } from "react";

import type { ColumnProfile } from "@/types/dataset";
import PivotConfigurator from "@/components/data/pivot-configurator";
import PivotTable from "@/components/data/pivot-table";
import PivotTableAdvanced from "@/components/data/pivot-table-advanced";
import { ErrorBoundary } from "@/components/ui/error-boundary";

import {
  AnimatedWorkspaceSection,
  ToolSection,
} from "@/components/home/workspace-shared";

interface PivotSectionProps {
  tableName: string;
  columns: ColumnProfile[];
}

export default function PivotSection({
  tableName,
  columns,
}: PivotSectionProps) {
  const [pivotView, setPivotView] = useState<"standard" | "advanced">(
    "standard",
  );

  return (
    <AnimatedWorkspaceSection>
      <div className="mb-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h2 className="text-lg font-semibold text-slate-900 dark:text-white mb-1">
              Pivot Table
            </h2>
            <p className="text-sm text-slate-500 dark:text-slate-400">
              Cross-tabulate your data with custom aggregations and switch
              between the standard and advanced pivot builders.
            </p>
          </div>
          <div className="inline-flex w-fit rounded-xl border border-slate-200 bg-white p-1 dark:border-slate-700 dark:bg-slate-800">
            <button
              onClick={() => setPivotView("standard")}
              className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
                pivotView === "standard"
                  ? "bg-indigo-500 text-white"
                  : "text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-700"
              }`}
            >
              Standard
            </button>
            <button
              onClick={() => setPivotView("advanced")}
              className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
                pivotView === "advanced"
                  ? "bg-indigo-500 text-white"
                  : "text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-700"
              }`}
            >
              Advanced
            </button>
          </div>
        </div>
      </div>

      <ErrorBoundary>
        {pivotView === "advanced" ? (
          <PivotTableAdvanced tableName={tableName} columns={columns} />
        ) : (
          <PivotTable tableName={tableName} columns={columns} />
        )}
      </ErrorBoundary>

      <div className="mt-6">
        <ToolSection
          title="Pivot Configurator"
          description="Build saved pivot recipes with drag-and-drop rows, columns, measures, filters, calculated fields, and conditional formatting."
        >
          <ErrorBoundary>
            <PivotConfigurator tableName={tableName} columns={columns} />
          </ErrorBoundary>
        </ToolSection>
      </div>
    </AnimatedWorkspaceSection>
  );
}
