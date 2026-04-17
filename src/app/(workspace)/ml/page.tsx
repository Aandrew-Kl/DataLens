"use client";

import { useMemo, useState } from "react";
import { FlaskConical, ScatterChart, TriangleAlert, Radar } from "lucide-react";

import { useDatasetStore } from "@/stores/dataset-store";
import { useWorkspaceStore } from "@/stores/workspace-store";
import ClusteringView from "@/components/ml/clustering-view";
import RegressionView from "@/components/ml/regression-view";
import AnomalyDetector from "@/components/ml/anomaly-detector";
import RouteErrorBoundary from "@/components/workspace/route-error-boundary";
import { sanitizeTableName } from "@/lib/utils/formatters";

const GLASS_PANEL_CLASS =
  "rounded-2xl border border-white/30 bg-white/60 p-4 backdrop-blur-xl dark:border-white/10 dark:bg-slate-900/60";

type MLTab = "regression" | "clustering" | "anomaly";

export default function MLPage() {
  const [activeTab, setActiveTab] = useState<MLTab>("regression");
  const activeDataset = useDatasetStore((state) => state.getActiveDataset());

  const workspaceColumns = useWorkspaceStore((state) => state.profileData);
  const tableName = activeDataset ? sanitizeTableName(activeDataset.fileName) : "";
  const columns = useMemo(
    () =>
      activeDataset && activeDataset.columns.length > 0
        ? activeDataset.columns
        : workspaceColumns,
    [activeDataset, workspaceColumns],
  );

  const hasDataset = Boolean(activeDataset);

  return (
    <RouteErrorBoundary scope="ml-route">
      <div className="space-y-5">
        <section className={GLASS_PANEL_CLASS}>
          <div className="space-y-3">
            <div className="flex items-center gap-2 text-slate-900 dark:text-white">
              <FlaskConical className="h-5 w-5 text-cyan-500" />
              <h1 className="text-lg font-semibold">Machine Learning</h1>
            </div>
            <p className="text-sm text-slate-600 dark:text-slate-300">
              {hasDataset
                ? `Analyze ${activeDataset?.fileName} with interactive ML tools.`
                : "Select a dataset from the sidebar to start ML modeling."}
            </p>
          </div>

          <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-3">
            <button
              type="button"
              onClick={() => setActiveTab("regression")}
              className={`inline-flex items-center justify-center gap-2 rounded-xl border px-4 py-3 text-sm font-medium transition ${
                activeTab === "regression"
                  ? "border-cyan-300 bg-cyan-500/20 text-cyan-700 dark:text-cyan-200"
                  : "border-white/30 bg-white/40 text-slate-700 hover:border-cyan-300/60 hover:bg-white/60 dark:border-white/15 dark:bg-slate-900/30 dark:text-slate-200"
              }`}
            >
              <FlaskConical className="h-4 w-4" />
              Regression
            </button>
            <button
              type="button"
              onClick={() => setActiveTab("clustering")}
              className={`inline-flex items-center justify-center gap-2 rounded-xl border px-4 py-3 text-sm font-medium transition ${
                activeTab === "clustering"
                  ? "border-emerald-300 bg-emerald-500/20 text-emerald-700 dark:text-emerald-200"
                  : "border-white/30 bg-white/40 text-slate-700 hover:border-emerald-300/60 hover:bg-white/60 dark:border-white/15 dark:bg-slate-900/30 dark:text-slate-200"
              }`}
            >
              <ScatterChart className="h-4 w-4" />
              Clustering
            </button>
            <button
              type="button"
              onClick={() => setActiveTab("anomaly")}
              className={`inline-flex items-center justify-center gap-2 rounded-xl border px-4 py-3 text-sm font-medium transition ${
                activeTab === "anomaly"
                  ? "border-amber-300 bg-amber-500/20 text-amber-700 dark:text-amber-200"
                  : "border-white/30 bg-white/40 text-slate-700 hover:border-amber-300/60 hover:bg-white/60 dark:border-white/15 dark:bg-slate-900/30 dark:text-slate-200"
              }`}
            >
              <TriangleAlert className="h-4 w-4" />
              Outlier Detection
            </button>
          </div>
        </section>

        <section className={GLASS_PANEL_CLASS}>
          {!hasDataset ? (
            <div className="rounded-xl border border-dashed border-white/50 bg-white/50 p-6 text-sm text-slate-700 dark:bg-slate-900/40 dark:text-slate-300">
              <div className="flex items-center gap-2 text-slate-900 dark:text-white">
                <Radar className="h-4 w-4" />
                No active dataset found
              </div>
              <p className="mt-2">
                Pick a dataset in the workspace to enable regression, clustering, and outlier detection.
              </p>
            </div>
          ) : null}

          {hasDataset && activeTab === "regression" && (
            <RegressionView tableName={tableName} columns={columns} />
          )}
          {hasDataset && activeTab === "clustering" && (
            <ClusteringView tableName={tableName} columns={columns} />
          )}
          {hasDataset && activeTab === "anomaly" && (
            <AnomalyDetector tableName={tableName} columns={columns} />
          )}
        </section>
      </div>
    </RouteErrorBoundary>
  );
}
