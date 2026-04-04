"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type KeyboardEvent,
} from "react";
import {
  AlertCircle,
  Clock,
  Database,
  History,
  Loader2,
  Play,
  Terminal,
} from "lucide-react";
import DataTable from "@/components/data/data-table";
import { useDatasetStore } from "@/stores/dataset-store";
import { useQueryStore } from "@/stores/query-store";
import type { QueryResult } from "@/types/query";
import { runQuery } from "@/lib/duckdb/client";
import {
  formatDuration,
  formatRelativeTime,
  generateId,
  sanitizeTableName,
} from "@/lib/utils/formatters";

const GLASS_PANEL_CLASS =
  "bg-white/60 dark:bg-slate-900/60 backdrop-blur-xl rounded-2xl border border-white/30 dark:border-white/10";

function getStarterSQL(tableName: string) {
  return "SELECT *\nFROM \"" + tableName + "\"\nLIMIT 100;";
}

function summarizeQuery(sql: string) {
  const firstLine = sql.split("\n")[0]?.trim() ?? "";
  return firstLine.length ? firstLine.slice(0, 120) : "Manual SQL";
}

export default function SqlPage() {
  const datasets = useDatasetStore((state) => state.datasets);
  const activeDatasetId = useDatasetStore((state) => state.activeDatasetId);

  const history = useQueryStore((state) => state.history);
  const lastResult = useQueryStore((state) => state.lastResult);
  const isQuerying = useQueryStore((state) => state.isQuerying);
  const addToHistory = useQueryStore((state) => state.addToHistory);
  const setLastResult = useQueryStore((state) => state.setLastResult);
  const setIsQuerying = useQueryStore((state) => state.setIsQuerying);

  const activeDataset = useMemo(
    () => datasets.find((dataset) => dataset.id === activeDatasetId) ?? null,
    [datasets, activeDatasetId],
  );

  const datasetId = activeDataset?.id ?? "";
  const tableName = useMemo(
    () => (activeDataset ? sanitizeTableName(activeDataset.fileName) : ""),
    [activeDataset],
  );

  const [sql, setSQL] = useState("");
  const [error, setError] = useState<string | null>(null);

  const datasetHistory = useMemo(
    () => history.filter((entry) => entry.datasetId === datasetId).slice(0, 8),
    [history, datasetId],
  );

  useEffect(() => {
    if (tableName) {
      setSQL(getStarterSQL(tableName));
    } else {
      setSQL("");
    }
    setError(null);
  }, [tableName]);

  const runCurrentQuery = useCallback(async () => {
    const trimmedSQL = sql.trim();

    if (!trimmedSQL || !activeDataset || isQuerying) return;

    setError(null);
    setLastResult(null);
    setIsQuerying(true);

    const start = performance.now();

    try {
      const rows = await runQuery(trimmedSQL);
      const executionTimeMs = performance.now() - start;
      const columns = rows.length > 0 ? Object.keys(rows[0] ?? {}) : [];
      const result: QueryResult = {
        sql: trimmedSQL,
        data: rows,
        columns,
        rowCount: rows.length,
        executionTimeMs,
      };

      setLastResult(result);
      addToHistory({
        id: generateId(),
        question: summarizeQuery(trimmedSQL),
        sql: trimmedSQL,
        datasetId,
        createdAt: Date.now(),
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to run query.");
      setLastResult(null);
    } finally {
      setIsQuerying(false);
    }
  }, [activeDataset, datasetId, addToHistory, isQuerying, setIsQuerying, setLastResult, sql]);

  const loadQueryFromHistory = useCallback((nextSQL: string) => {
    setSQL(nextSQL);
    setError(null);
  }, []);

  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLTextAreaElement>) => {
      if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
        event.preventDefault();
        void runCurrentQuery();
      }
    },
    [runCurrentQuery],
  );

  const canRun = Boolean(activeDataset && sql.trim() && !isQuerying);

  return (
    <div className="space-y-4">
      <section className={`${GLASS_PANEL_CLASS} p-4 md:p-6`}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-1.5">
            <h1 className="text-lg font-semibold text-slate-900 dark:text-white">
              SQL Editor
            </h1>
            <p className="text-sm text-slate-600 dark:text-slate-400">
              Write and run SQL directly against your active dataset.
            </p>
          </div>
          <span className="inline-flex items-center gap-2 rounded-xl border border-white/40 bg-white/40 px-3 py-1.5 text-xs font-medium text-slate-600 dark:border-white/20 dark:text-slate-300">
            <Database className="h-3.5 w-3.5" />
            {activeDataset ? activeDataset.name : "No active dataset"}
          </span>
        </div>

        <div className="mt-5">
          {!activeDataset ? (
            <div className="rounded-2xl border border-white/30 bg-white/55 px-4 py-3 text-sm text-slate-600 dark:border-white/10 dark:bg-slate-950/40 dark:text-slate-300">
              Open a dataset in the workspace to start writing and running SQL.
            </div>
          ) : (
            <div className="space-y-4">
              <label
                className="flex items-center gap-2 text-sm font-medium text-slate-700 dark:text-slate-200"
                htmlFor="sql-editor"
              >
                <Terminal className="h-4 w-4" /> SQL editor
              </label>
              <textarea
                id="sql-editor"
                value={sql}
                onChange={(event) => setSQL(event.target.value)}
                onKeyDown={handleKeyDown}
                className="h-44 w-full resize-y rounded-xl border border-white/40 bg-white/80 px-3 py-3 font-mono text-sm text-slate-900 outline-none focus:border-cyan-400 focus:ring-2 focus:ring-cyan-400/25 dark:border-white/10 dark:bg-slate-950/60 dark:text-slate-100"
                spellCheck={false}
              />

              <div className="flex flex-wrap items-center justify-between gap-3">
                <button
                  type="button"
                  onClick={() => void runCurrentQuery()}
                  disabled={!canRun}
                  className="inline-flex items-center gap-2 rounded-xl bg-cyan-500 px-4 py-2 text-sm font-semibold text-white transition hover:bg-cyan-600 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {isQuerying ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Running
                    </>
                  ) : (
                    <>
                      <Play className="h-4 w-4" />
                      Run
                    </>
                  )}
                </button>

                <p className="text-xs text-slate-600 dark:text-slate-400">
                  Tip: press Ctrl/Cmd + Enter to execute quickly.
                </p>
              </div>

              {error ? (
                <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-800/70 dark:bg-red-900/20 dark:text-red-200 flex items-start gap-2">
                  <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                  {error}
                </div>
              ) : null}
            </div>
          )}
        </div>
      </section>

      <section className={`${GLASS_PANEL_CLASS} p-4 md:p-6`}>
        <div className="mb-4 flex items-center justify-between gap-3">
          <h2 className="text-base font-semibold text-slate-900 dark:text-white">
            Query result
          </h2>
          {lastResult ? (
            <div className="flex items-center gap-2 text-xs text-slate-600 dark:text-slate-300">
              <Clock className="h-3.5 w-3.5" />
              <span>
                {lastResult.rowCount.toLocaleString()} rows • {formatDuration(lastResult.executionTimeMs)}
              </span>
            </div>
          ) : null}
        </div>

        {isQuerying && !lastResult ? (
          <div className="rounded-2xl border border-white/25 bg-white/40 p-4 text-sm text-slate-600 dark:border-white/15 dark:bg-slate-950/40 dark:text-slate-300">
            Running query with DuckDB...
          </div>
        ) : null}

        {lastResult ? (
          <>
            <div className="mb-3 rounded-xl border border-white/40 bg-white/55 px-3 py-2">
              <pre className="overflow-x-auto rounded-lg bg-slate-950 p-3 text-xs text-slate-100">
                {lastResult.sql}
              </pre>
            </div>

            {lastResult.data.length === 0 ? (
              <p className="rounded-xl border border-white/40 bg-white/45 px-3 py-3 text-sm text-slate-600 dark:border-white/15 dark:bg-slate-950/40 dark:text-slate-300">
                Query ran successfully, but returned no rows.
              </p>
            ) : (
              <DataTable
                data={lastResult.data}
                columns={lastResult.columns}
                searchable
                sortable
                exportable
                maxHeight="420px"
              />
            )}
          </>
        ) : (
          !isQuerying && (
            <p className="rounded-xl border border-dashed border-white/35 bg-white/45 px-3 py-3 text-sm text-slate-600 dark:border-white/15 dark:bg-slate-950/35 dark:text-slate-300">
              Run a query to populate the result table.
            </p>
          )
        )}
      </section>

      <section className={`${GLASS_PANEL_CLASS} p-4 md:p-6`}>
        <h2 className="mb-3 flex items-center gap-2 text-base font-semibold text-slate-900 dark:text-white">
          <History className="h-4 w-4" />
          Query history
        </h2>

        {datasetHistory.length === 0 ? (
          <p className="rounded-xl border border-white/35 bg-white/45 px-3 py-3 text-sm text-slate-600 dark:border-white/15 dark:bg-slate-950/30 dark:text-slate-300">
            No saved SQL history for this dataset yet.
          </p>
        ) : (
          <div className="space-y-2">
            {datasetHistory.map((entry) => (
              <button
                type="button"
                key={entry.id}
                onClick={() => loadQueryFromHistory(entry.sql)}
                className="w-full rounded-xl border border-white/35 bg-white/55 px-3 py-2 text-left transition hover:border-cyan-300/80 hover:bg-white/70 dark:border-white/15 dark:bg-slate-950/45 dark:hover:border-cyan-700/70 dark:hover:bg-slate-950/55"
              >
                <p className="text-sm font-medium text-slate-900 dark:text-slate-100">
                  {entry.question}
                </p>
                <p className="mt-1 truncate text-xs text-slate-500 dark:text-slate-400">
                  {entry.sql}
                </p>
                <p className="mt-2 text-[11px] text-slate-500 dark:text-slate-500">
                  {formatRelativeTime(entry.createdAt)}
                </p>
              </button>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
