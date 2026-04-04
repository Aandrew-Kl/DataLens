"use client";

import { Suspense, use, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { Download, GitMerge, Layers3, Play, Save } from "lucide-react";
import { runQuery } from "@/lib/duckdb/client";
import {
  ANALYTICS_EASE,
  BUTTON_CLASS,
  FIELD_CLASS,
  GLASS_CARD_CLASS,
  GLASS_PANEL_CLASS,
  quoteIdentifier,
  toCount,
} from "@/lib/utils/advanced-analytics";
import { downloadFile } from "@/lib/utils/export";
import { formatNumber } from "@/lib/utils/formatters";
import type { ColumnProfile } from "@/types/dataset";

interface DataMergeToolProps {
  tableName: string;
  columns: ColumnProfile[];
}

type MergeStrategy = "append" | "intersect" | "except";

interface MergeTable {
  tableName: string;
  rowCount: number;
  columns: string[];
}

interface MergeCatalog {
  tables: MergeTable[];
  warning: string | null;
}

interface MergeToolReadyProps extends DataMergeToolProps {
  promise: Promise<MergeCatalog>;
}

function uniqueStrings(values: string[]) {
  return Array.from(new Set(values.filter((value) => value.trim() !== "")));
}

function readTableName(row: Record<string, unknown>) {
  const value = row.name ?? row.table_name;
  return typeof value === "string" ? value : null;
}

async function loadMergeCatalog(
  tableName: string,
  columns: ColumnProfile[],
): Promise<MergeCatalog> {
  try {
    const rows = await runQuery("SHOW TABLES");
    const tableNames = uniqueStrings(
      rows
        .map((row) => readTableName(row))
        .filter((value): value is string => value !== null)
        .concat(tableName),
    ).slice(0, 12);

    const tables = await Promise.all(
      tableNames.map(async (name) => {
        const [schemaRows, countRows] = await Promise.all([
          runQuery(`DESCRIBE ${quoteIdentifier(name)}`),
          runQuery(`SELECT COUNT(*) AS row_count FROM ${quoteIdentifier(name)}`),
        ]);
        const schemaColumns = uniqueStrings(
          schemaRows
            .map((row) => {
              const value = row.column_name ?? row.name;
              return typeof value === "string" ? value : "";
            })
            .concat(name === tableName ? columns.map((column) => column.name) : []),
        );

        return {
          tableName: name,
          rowCount: toCount(countRows[0]?.row_count),
          columns: schemaColumns,
        } satisfies MergeTable;
      }),
    );

    return { tables, warning: null };
  } catch (error) {
    return {
      tables: [
        {
          tableName,
          rowCount: 0,
          columns: columns.map((column) => column.name),
        },
      ],
      warning: error instanceof Error ? error.message : "Table catalog lookup failed.",
    };
  }
}

function buildMergeQuery(
  selectedTables: MergeTable[],
  strategy: MergeStrategy,
) {
  if (selectedTables.length < 2) {
    return "";
  }

  if (strategy === "append") {
    const allColumns = uniqueStrings(selectedTables.flatMap((table) => table.columns));
    return selectedTables
      .map((table) => {
        const tableColumnSet = new Set(table.columns);
        const projection = allColumns
          .map((column) =>
            tableColumnSet.has(column)
              ? `${quoteIdentifier(column)} AS ${quoteIdentifier(column)}`
              : `NULL AS ${quoteIdentifier(column)}`,
          )
          .join(", ");
        return `SELECT ${projection} FROM ${quoteIdentifier(table.tableName)}`;
      })
      .join("\nUNION ALL\n");
  }

  const commonColumns = selectedTables.reduce<string[]>((shared, table, index) => {
    if (index === 0) {
      return [...table.columns];
    }
    return shared.filter((column) => table.columns.includes(column));
  }, []);
  if (commonColumns.length === 0) {
    return "";
  }

  const projection = commonColumns.map((column) => quoteIdentifier(column)).join(", ");
  const operator = strategy === "intersect" ? "INTERSECT" : "EXCEPT";

  return selectedTables
    .map((table) => `SELECT ${projection} FROM ${quoteIdentifier(table.tableName)}`)
    .join(`\n${operator}\n`);
}

function buildCsv(rows: Record<string, unknown>[]) {
  if (rows.length === 0) return "";
  const headers = Object.keys(rows[0] ?? {});
  return [
    headers.join(","),
    ...rows.map((row) => headers.map((header) => String(row[header] ?? "")).join(",")),
  ].join("\n");
}

function MergeLoadingState() {
  return (
    <div className={`${GLASS_CARD_CLASS} flex min-h-[24rem] items-center justify-center p-6 text-sm text-slate-600 dark:text-slate-300`}>
      Loading DuckDB catalog…
    </div>
  );
}

function MergePreviewTable({ rows }: { rows: Record<string, unknown>[] }) {
  if (rows.length === 0) {
    return (
      <div className="rounded-3xl border border-dashed border-white/25 px-4 py-8 text-sm text-slate-600 dark:text-slate-300">
        Preview the merged query to compare the result set.
      </div>
    );
  }

  const headers = Object.keys(rows[0] ?? {});

  return (
    <div className="overflow-hidden rounded-3xl border border-white/20">
      <table className="min-w-full text-left text-sm text-slate-700 dark:text-slate-200">
        <thead className="bg-slate-950/5 text-xs uppercase tracking-[0.16em] text-slate-500 dark:bg-white/5 dark:text-slate-400">
          <tr>
            {headers.map((header) => (
              <th key={header} className="px-4 py-3">{header}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={`row-${index}`} className="border-t border-white/15">
              {headers.map((header) => (
                <td key={`${index}-${header}`} className="px-4 py-3">
                  {String(row[header] ?? "")}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function MergeToolReady({ tableName, promise }: MergeToolReadyProps) {
  const catalog = use(promise);
  const [selectedTableNames, setSelectedTableNames] = useState<string[]>([]);
  const [strategy, setStrategy] = useState<MergeStrategy>("append");
  const [previewRows, setPreviewRows] = useState<Record<string, unknown>[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(catalog.warning);
  const [outputTableName, setOutputTableName] = useState(`${tableName}_merged`);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  const defaultSelection = useMemo(
    () => catalog.tables.slice(0, 2).map((table) => table.tableName),
    [catalog.tables],
  );
  const effectiveSelectedNames =
    selectedTableNames.length > 0 ? selectedTableNames : defaultSelection;
  const selectedTables = catalog.tables.filter((table) =>
    effectiveSelectedNames.includes(table.tableName),
  );
  const query = useMemo(
    () => buildMergeQuery(selectedTables, strategy),
    [selectedTables, strategy],
  );

  function toggleTable(tableNameToToggle: string) {
    setSelectedTableNames((current) => {
      const base = current.length > 0 ? current : defaultSelection;
      return base.includes(tableNameToToggle)
        ? base.filter((value) => value !== tableNameToToggle)
        : [...base, tableNameToToggle];
    });
  }

  async function handlePreview() {
    if (selectedTables.length < 2 || !query) {
      setError("Choose at least two tables before previewing a merge.");
      setPreviewRows([]);
      return;
    }

    setLoading(true);
    setError(null);
    setStatusMessage(null);

    try {
      const rows = await runQuery(`${query}\nLIMIT 50`);
      setPreviewRows(rows);
    } catch (cause) {
      setPreviewRows([]);
      setError(cause instanceof Error ? cause.message : "Merge preview failed.");
    } finally {
      setLoading(false);
    }
  }

  async function handleExecute() {
    if (!query || selectedTables.length < 2) {
      setError("Choose at least two tables before executing the merge.");
      return;
    }

    setLoading(true);
    setError(null);

    try {
      await runQuery(
        `CREATE OR REPLACE TABLE ${quoteIdentifier(outputTableName)} AS ${query}`,
      );
      setStatusMessage(`Created ${outputTableName}.`);
    } catch (cause) {
      setStatusMessage(null);
      setError(cause instanceof Error ? cause.message : "Merge execution failed.");
    } finally {
      setLoading(false);
    }
  }

  function handleExport() {
    if (previewRows.length === 0) return;
    downloadFile(
      buildCsv(previewRows),
      `${outputTableName || tableName}-merge-preview.csv`,
      "text/csv;charset=utf-8;",
    );
  }

  return (
    <div className="space-y-6">
      <div className="grid gap-4 md:grid-cols-3">
        {selectedTables.map((table) => (
          <div key={table.tableName} className={`${GLASS_CARD_CLASS} p-4`}>
            <div className="text-xs uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
              {table.tableName}
            </div>
            <div className="mt-2 text-2xl font-semibold text-slate-950 dark:text-white">
              {formatNumber(table.rowCount)}
            </div>
            <div className="mt-1 text-sm text-slate-600 dark:text-slate-300">
              {formatNumber(table.columns.length)} columns
            </div>
          </div>
        ))}
      </div>

      <div className="grid gap-6 xl:grid-cols-[0.95fr_1.05fr]">
        <div className="space-y-4">
          <div className={`${GLASS_CARD_CLASS} p-5`}>
            <div className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400">
              Select tables
            </div>
            <div className="mt-4 space-y-3">
              {catalog.tables.map((table) => (
                <label
                  key={table.tableName}
                  className="flex items-center justify-between rounded-3xl bg-slate-950/5 px-4 py-3 text-sm dark:bg-white/5"
                >
                  <span>{table.tableName}</span>
                  <input
                    type="checkbox"
                    checked={effectiveSelectedNames.includes(table.tableName)}
                    onChange={() => toggleTable(table.tableName)}
                  />
                </label>
              ))}
            </div>
          </div>

          <div className={`${GLASS_CARD_CLASS} p-5`}>
            <div className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400">
              Merge strategy
            </div>
            <div className="mt-4 grid gap-2 sm:grid-cols-3">
              {(["append", "intersect", "except"] as const).map((value) => (
                <button
                  key={value}
                  type="button"
                  className={`rounded-2xl px-4 py-3 text-sm transition ${
                    strategy === value
                      ? "bg-cyan-500/15 text-cyan-700 dark:text-cyan-300"
                      : "bg-slate-950/5 text-slate-700 dark:bg-white/5 dark:text-slate-200"
                  }`}
                  onClick={() => setStrategy(value)}
                >
                  {value}
                </button>
              ))}
            </div>
            <label className="mt-4 block text-sm text-slate-700 dark:text-slate-200">
              Output table name
              <input
                className={`${FIELD_CLASS} mt-2`}
                value={outputTableName}
                onChange={(event) => setOutputTableName(event.target.value)}
              />
            </label>
          </div>
        </div>

        <div className="space-y-4">
          <div className={`${GLASS_CARD_CLASS} p-5`}>
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400">
                  Merge query
                </div>
                <div className="mt-1 text-sm text-slate-600 dark:text-slate-300">
                  Append aligns schemas, intersect keeps shared rows, except subtracts later tables from the first.
                </div>
              </div>
              <div className="flex gap-2">
                <button type="button" className={BUTTON_CLASS} disabled={!previewRows.length} onClick={handleExport}>
                  <Download className="h-4 w-4" />
                  Export CSV
                </button>
                <button type="button" className={BUTTON_CLASS} disabled={loading} onClick={handlePreview}>
                  <Play className="h-4 w-4" />
                  Preview
                </button>
                <button type="button" className={BUTTON_CLASS} disabled={loading} onClick={handleExecute}>
                  <Save className="h-4 w-4" />
                  Execute
                </button>
              </div>
            </div>
            <pre className="mt-4 overflow-x-auto rounded-3xl bg-slate-950 px-4 py-4 text-xs text-slate-100">
              <code>{query || "Choose at least two tables to build a merge query."}</code>
            </pre>
            {error ? (
              <p className="mt-3 text-sm text-rose-700 dark:text-rose-300">{error}</p>
            ) : null}
            {statusMessage ? (
              <p className="mt-3 text-sm text-emerald-700 dark:text-emerald-300">{statusMessage}</p>
            ) : null}
          </div>

          <div className={`${GLASS_CARD_CLASS} p-5`}>
            <div className="mb-4 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400">
              <Layers3 className="h-4 w-4" />
              Preview merged result
            </div>
            <MergePreviewTable rows={previewRows} />
          </div>
        </div>
      </div>
    </div>
  );
}

export default function DataMergeTool({
  tableName,
  columns,
}: DataMergeToolProps) {
  const promise = useMemo(() => loadMergeCatalog(tableName, columns), [columns, tableName]);

  return (
    <motion.section
      initial={{ opacity: 0, y: 18 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.28, ease: ANALYTICS_EASE }}
      className={`${GLASS_PANEL_CLASS} p-6`}
    >
      <div className="mb-6">
        <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.22em] text-cyan-700 dark:text-cyan-300">
          <GitMerge className="h-4 w-4" />
          Data Merge Tool
        </div>
        <h2 className="mt-2 text-2xl font-semibold text-slate-950 dark:text-white">
          Merge multiple DuckDB tables with set-based strategies
        </h2>
      </div>

      <Suspense fallback={<MergeLoadingState />}>
        <MergeToolReady tableName={tableName} columns={columns} promise={promise} />
      </Suspense>
    </motion.section>
  );
}
