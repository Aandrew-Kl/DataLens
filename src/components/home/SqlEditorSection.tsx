"use client";

import { useCallback, useState } from "react";
import { GitMerge } from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";
import dynamic from "next/dynamic";

import { sanitizeTableName } from "@/lib/utils/formatters";
import type { ColumnProfile, DatasetMeta } from "@/types/dataset";
import DataJoinWizard from "@/components/data/data-join-wizard";
import DataTable from "@/components/data/data-table";
import QueryBuilder from "@/components/query/query-builder";
import QueryHistory from "@/components/query/query-history";
import SavedQueries from "@/components/query/saved-queries";
import SQLPlayground from "@/components/query/sql-playground";
import SQLEditor from "@/components/query/sql-editor";
import TemplatePicker from "@/components/query/template-picker";
import { ErrorBoundary } from "@/components/ui/error-boundary";

import { AnimatedWorkspaceSection } from "@/components/home/workspace-shared";

const QueryDebugger = dynamic(() => import("@/components/query/query-debugger"), {
  ssr: false,
});
const QueryDiff = dynamic(() => import("@/components/query/query-diff"), {
  ssr: false,
});
const QueryExplainViewer = dynamic(
  () => import("@/components/query/query-explain-viewer"),
  { ssr: false },
);
const QueryOptimizer = dynamic(() => import("@/components/query/query-optimizer"), {
  ssr: false,
});
const QuerySchedulerDyn = dynamic(
  () => import("@/components/query/query-scheduler"),
  { ssr: false },
);
const QueryTemplateBuilderDyn = dynamic(
  () => import("@/components/query/query-template-builder"),
  { ssr: false },
);
const SavedQueryManager = dynamic(
  () => import("@/components/query/saved-query-manager"),
  { ssr: false },
);

function buildDefaultSql(tableName: string) {
  return `SELECT *\nFROM "${tableName}"\nLIMIT 100;`;
}

function SqlEditorWorkspace({
  tableName,
  columns,
  datasetId,
}: {
  tableName: string;
  columns: ColumnProfile[];
  datasetId: string;
}) {
  const [lastResult, setLastResult] = useState<{
    data: Record<string, unknown>[];
    columns: string[];
    sql: string;
    executionTimeMs: number;
  } | null>(null);
  const [editorDefaultSql, setEditorDefaultSql] = useState(() =>
    buildDefaultSql(tableName),
  );
  const [editorInstanceKey, setEditorInstanceKey] = useState(0);
  const [showQueryBuilder, setShowQueryBuilder] = useState(true);
  const [showPlayground, setShowPlayground] = useState(false);

  const handleSelectSql = useCallback((sql: string) => {
    setEditorDefaultSql(sql);
    setEditorInstanceKey((current) => current + 1);
    setLastResult(null);
    setShowPlayground(false);
  }, []);

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-4">
      <div className="space-y-6 lg:col-span-3">
        <div className="rounded-xl border border-slate-200/70 bg-white/80 p-4 shadow-sm dark:border-slate-700/60 dark:bg-slate-900/60">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h3 className="text-sm font-semibold text-slate-900 dark:text-white">
                Query Composer
              </h3>
              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                Build SQL visually, then switch between the classic editor and
                the multi-tab playground.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                onClick={() => setShowQueryBuilder((current) => !current)}
                className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 transition-colors hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700"
              >
                {showQueryBuilder ? "Hide Builder" : "Show Builder"}
              </button>
              <div className="inline-flex rounded-lg border border-slate-200 bg-white p-1 dark:border-slate-700 dark:bg-slate-800">
                <button
                  onClick={() => setShowPlayground(false)}
                  className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                    showPlayground
                      ? "text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"
                      : "bg-indigo-500 text-white shadow-sm"
                  }`}
                >
                  SQL Editor
                </button>
                <button
                  onClick={() => setShowPlayground(true)}
                  className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                    showPlayground
                      ? "bg-indigo-500 text-white shadow-sm"
                      : "text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"
                  }`}
                >
                  SQL Playground
                </button>
              </div>
            </div>
          </div>
        </div>

        <AnimatePresence initial={false}>
          {showQueryBuilder && (
            <motion.div
              initial={{ opacity: 0, y: -8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.2 }}
            >
              <QueryBuilder
                tableName={tableName}
                columns={columns}
                onQueryGenerated={handleSelectSql}
              />
            </motion.div>
          )}
        </AnimatePresence>

        <div className={showPlayground ? "hidden" : "space-y-6"}>
          <SQLEditor
            key={`${tableName}-${editorInstanceKey}`}
            tableName={tableName}
            columns={columns}
            defaultSQL={editorDefaultSql}
            onQueryResult={setLastResult}
          />

          {lastResult && lastResult.data.length > 0 && (
            <motion.div
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3 }}
            >
              <div className="mb-3 flex items-center justify-between">
                <h3 className="text-sm font-semibold text-slate-900 dark:text-white">
                  Results
                </h3>
                <span className="text-xs text-slate-400">
                  {lastResult.data.length} rows &middot;{" "}
                  {lastResult.executionTimeMs.toFixed(1)}ms
                </span>
              </div>
              <DataTable
                data={lastResult.data}
                columns={lastResult.columns}
                pageSize={50}
                searchable
                sortable
                exportable
              />
            </motion.div>
          )}
        </div>

        <div className={showPlayground ? "block" : "hidden"}>
          <SQLPlayground tableName={tableName} columns={columns} />
        </div>
      </div>

      <div className="space-y-4">
        <ErrorBoundary>
          <TemplatePicker
            tableName={tableName}
            columns={columns}
            onSelectSQL={handleSelectSql}
          />
        </ErrorBoundary>
        <ErrorBoundary>
          <QueryHistory datasetId={datasetId} onSelectQuery={handleSelectSql} />
        </ErrorBoundary>
        <ErrorBoundary>
          <SavedQueries onSelectQuery={handleSelectSql} />
        </ErrorBoundary>
      </div>
    </div>
  );
}

interface SqlEditorSectionProps {
  tableName: string;
  columns: ColumnProfile[];
  datasetId: string;
  datasets: DatasetMeta[];
  onJoinComplete: (result: {
    tableName: string;
    sql: string;
    columns: string[];
  }) => void;
}

export default function SqlEditorSection({
  tableName,
  columns,
  datasetId,
  datasets,
  onJoinComplete,
}: SqlEditorSectionProps) {
  return (
    <AnimatedWorkspaceSection>
      <div className="mb-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold text-slate-900 dark:text-white mb-1">
              SQL Editor
            </h2>
            <p className="text-sm text-slate-500 dark:text-slate-400">
              Write and execute SQL queries directly against your data with DuckDB
            </p>
          </div>
        </div>
      </div>

      <ErrorBoundary>
        <SqlEditorWorkspace
          key={tableName}
          tableName={tableName}
          columns={columns}
          datasetId={datasetId}
        />
      </ErrorBoundary>

      <details className="group rounded-2xl border border-slate-200/70 bg-white/80 p-4 shadow-sm dark:border-slate-700/60 dark:bg-slate-900/60">
        <summary className="cursor-pointer list-none">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-start gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-500/10 text-indigo-600 dark:text-indigo-300">
                <GitMerge className="h-4 w-4" />
              </div>
              <div>
                <h3 className="text-sm font-semibold text-slate-900 dark:text-white">
                  Data Join Wizard
                </h3>
                <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                  Build and materialize multi-table joins in a guided workflow
                  without leaving the SQL tab.
                </p>
              </div>
            </div>
            <span className="text-xs font-medium text-slate-400 dark:text-slate-500">
              Expand
            </span>
          </div>
        </summary>
        <div className="mt-4">
          {datasets.length > 1 ? (
            <ErrorBoundary>
              <DataJoinWizard
                tables={datasets.map((dataset) =>
                  sanitizeTableName(dataset.fileName),
                )}
                onJoinComplete={onJoinComplete}
              />
            </ErrorBoundary>
          ) : (
            <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-300">
              Load at least one more dataset to use the join wizard.
            </div>
          )}
        </div>
      </details>

      <details className="group mt-6 rounded-2xl border border-slate-200/70 bg-white/80 p-4 shadow-sm dark:border-slate-700/60 dark:bg-slate-900/60">
        <summary className="cursor-pointer list-none">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h3 className="text-sm font-semibold text-slate-900 dark:text-white">
                SQL Tools
              </h3>
              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                Debug, diff, explain, optimize, schedule, and manage SQL queries
                with advanced tooling.
              </p>
            </div>
            <span className="text-xs font-medium text-slate-400 dark:text-slate-500">
              Expand
            </span>
          </div>
        </summary>
        <div className="mt-4 space-y-6">
          <ErrorBoundary>
            <QueryDebugger tableName={tableName} columns={columns} />
          </ErrorBoundary>
          <ErrorBoundary>
            <QueryDiff tableName={tableName} columns={columns} />
          </ErrorBoundary>
          <ErrorBoundary>
            <QueryExplainViewer tableName={tableName} columns={columns} />
          </ErrorBoundary>
          <ErrorBoundary>
            <QueryOptimizer tableName={tableName} columns={columns} />
          </ErrorBoundary>
          <ErrorBoundary>
            <QuerySchedulerDyn tableName={tableName} columns={columns} />
          </ErrorBoundary>
          <ErrorBoundary>
            <QueryTemplateBuilderDyn tableName={tableName} columns={columns} />
          </ErrorBoundary>
          <ErrorBoundary>
            <SavedQueryManager tableName={tableName} columns={columns} />
          </ErrorBoundary>
        </div>
      </details>
    </AnimatedWorkspaceSection>
  );
}
