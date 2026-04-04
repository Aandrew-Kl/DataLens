"use client";

import { useCallback, useMemo, useRef } from "react";
import DataTable from "@/components/data/data-table";
import ChatInterface from "@/components/query/chat-interface";
import NaturalLanguageBar from "@/components/query/natural-language-bar";
import { GLASS_PANEL_CLASS } from "@/lib/utils/advanced-analytics";
import { sanitizeTableName } from "@/lib/utils/formatters";
import type { ColumnProfile } from "@/types/dataset";
import { useDatasetStore } from "@/stores/dataset-store";
import { useQueryStore } from "@/stores/query-store";

export default function QueryPage() {
  const queryTabRef = useRef<HTMLDivElement>(null);
  const datasets = useDatasetStore((state) => state.datasets);
  const activeDatasetId = useDatasetStore((state) => state.activeDatasetId);
  const lastResult = useQueryStore((state) => state.lastResult);
  const isQuerying = useQueryStore((state) => state.isQuerying);

  const activeDataset = useMemo(
    () => datasets.find((dataset) => dataset.id === activeDatasetId) ?? null,
    [datasets, activeDatasetId],
  );

  const tableName = activeDataset ? sanitizeTableName(activeDataset.fileName) : "";
  const columns = useMemo<ColumnProfile[]>(() => activeDataset?.columns ?? [], [activeDataset]);
  const datasetId = activeDataset?.id ?? "";

  const submitNaturalLanguageQuestion = useCallback((question: string) => {
    const container = queryTabRef.current;
    const input = container?.querySelector<HTMLInputElement>(
      'input[placeholder="Ask anything about your data..."]',
    );
    const form = input?.closest("form");

    if (!input || !(form instanceof HTMLFormElement)) {
      return;
    }

    const setter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )?.set;

    setter?.call(input, question);
    input.dispatchEvent(new Event("input", { bubbles: true }));

    if (typeof form.requestSubmit === "function") {
      form.requestSubmit();
    } else {
      form.dispatchEvent(
        new Event("submit", { bubbles: true, cancelable: true }),
      );
    }
  }, []);

  return (
    <div ref={queryTabRef} className="space-y-4">
      <section className={`${GLASS_PANEL_CLASS} p-4 md:p-6`}>
        <div className="space-y-3">
          <h1 className="text-lg font-semibold text-slate-900 dark:text-white">
            Ask AI
          </h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Ask natural-language questions and let AI generate SQL, execute it,
            and summarize the result.
          </p>
        </div>

        {activeDataset ? (
          <div className="mt-5 space-y-6">
            <NaturalLanguageBar
              tableName={tableName}
              columns={columns}
              onSubmit={submitNaturalLanguageQuestion}
            />
            <ChatInterface
              datasetId={datasetId}
              tableName={tableName}
              columns={columns}
            />
          </div>
        ) : (
          <div className="mt-4 rounded-2xl border border-white/25 bg-white/35 px-4 py-3 text-sm text-slate-500 dark:border-white/10 dark:bg-slate-950/40">
            No active dataset. Open a CSV from the workspace sidebar to run
            AI-powered queries.
          </div>
        )}
      </section>

      <section className={`${GLASS_PANEL_CLASS} p-4 md:p-6`}>
        <h2 className="text-base font-semibold text-slate-900 dark:text-white">
          Last query results &amp; AI explanation
        </h2>

        {activeDataset ? null : (
          <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
            Query output will appear here after you run a question.
          </p>
        )}

        {activeDataset ? (
          <>
            {isQuerying ? (
              <p className="mt-3 text-sm text-purple-600 dark:text-purple-300">
                AI is running your question...
              </p>
            ) : null}

            {lastResult ? (
              <div className="mt-4 space-y-4">
                <div className="rounded-2xl border border-slate-200/70 bg-white/60 p-3 text-sm text-slate-700 dark:border-slate-700/60 dark:bg-slate-900/45 dark:text-slate-200">
                  <p className="mb-2 font-medium text-slate-900 dark:text-white">
                    Generated SQL
                  </p>
                  <pre className="overflow-x-auto rounded-xl border border-slate-200/70 bg-slate-950/80 p-3 text-xs font-mono text-slate-100">
                    {lastResult.sql}
                  </pre>
                  <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
                    {lastResult.rowCount.toLocaleString()} rows in {lastResult.executionTimeMs.toFixed(1)}ms
                  </p>
                </div>

                {lastResult.summary ? (
                  <div className="rounded-2xl border border-cyan-200/40 bg-cyan-500/10 p-3 text-sm text-slate-700 dark:border-cyan-500/30 dark:bg-cyan-500/15 dark:text-slate-200">
                    <p className="mb-1 text-xs font-semibold uppercase tracking-[0.18em] text-cyan-600 dark:text-cyan-300">
                      AI explanation
                    </p>
                    <p>{lastResult.summary}</p>
                  </div>
                ) : null}

                <div>
                  <p className="mb-2 text-sm font-medium text-slate-800 dark:text-slate-200">
                    Result table
                  </p>
                  <DataTable
                    data={lastResult.data}
                    columns={lastResult.columns}
                    searchable
                    sortable
                    exportable
                  />
                </div>
              </div>
            ) : null}

            {!lastResult && !isQuerying ? (
              <p className="mt-4 text-sm text-slate-500 dark:text-slate-400">
                Ask a question above to populate results and AI explanations.
              </p>
            ) : null}
          </>
        ) : null}
      </section>
    </div>
  );
}
