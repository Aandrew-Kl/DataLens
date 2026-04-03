"use client";

import {
  Suspense,
  startTransition,
  use,
  useMemo,
  useState,
} from "react";
import { motion } from "framer-motion";
import {
  ArrowLeftRight,
  Clock3,
  Download,
  FileDiff,
  GitCompareArrows,
  Loader2,
  SplitSquareHorizontal,
  TableProperties,
} from "lucide-react";
import { runQuery } from "@/lib/duckdb/client";
import { downloadFile } from "@/lib/utils/export";
import { formatNumber } from "@/lib/utils/formatters";
import type { ColumnProfile } from "@/types/dataset";

interface DataDiffProps {
  tableName: string;
  columns: ColumnProfile[];
}

interface TableOption {
  value: string;
  label: string;
  kind: "current" | "version" | "table";
  timestamp: number | null;
}

interface ColumnDiffSummary {
  column: string;
  changes: number;
}

interface DiffRow {
  diffKey: string;
  changeType: "added" | "removed" | "modified";
  changedColumns: string[];
  leftValues: Record<string, unknown>;
  rightValues: Record<string, unknown>;
}

interface DiffResult {
  keyOptions: string[];
  resolvedKey: string;
  comparedColumns: string[];
  leftColumns: string[];
  rightColumns: string[];
  addedCount: number;
  removedCount: number;
  modifiedCount: number;
  rows: DiffRow[];
  columnSummary: ColumnDiffSummary[];
  warning: string | null;
  error: string | null;
}

type ViewMode = "side" | "unified";

const EASE = [0.22, 1, 0.36, 1] as const;
const PANEL_CLASS =
  "rounded-[1.75rem] border border-white/20 bg-white/75 shadow-xl shadow-slate-950/10 backdrop-blur-2xl dark:border-white/10 dark:bg-slate-950/45";
const FIELD_CLASS =
  "rounded-2xl border border-white/20 bg-white/80 px-4 py-3 text-sm text-slate-700 outline-none transition focus:border-cyan-400 focus:ring-4 focus:ring-cyan-500/10 dark:border-white/10 dark:bg-slate-950/50 dark:text-slate-100";

function quoteIdentifier(value: string) {
  return `"${value.replaceAll('"', '""')}"`;
}

function sanitizeTableName(value: string) {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9_]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 48) || "table"
  );
}

function formatScalar(value: unknown) {
  if (value == null) return "—";
  if (typeof value === "number") return Number.isFinite(value) ? formatNumber(value) : "—";
  if (typeof value === "boolean") return value ? "true" : "false";
  return String(value);
}

function inferKey(columns: string[]) {
  const idLike = columns.find((column) => /(^id$|_id$|uuid|guid|key$)/i.test(column));
  return idLike ?? "__row_index__";
}

function normalizeTableRows(rows: Record<string, unknown>[]) {
  return Array.from(
    new Set(
      rows
        .map((row) => String(row.name ?? row.table_name ?? row.table ?? ""))
        .filter(Boolean),
    ),
  );
}

async function loadTableOptions(tableName: string): Promise<TableOption[]> {
  const rows = await runQuery("SHOW TABLES");
  const tables = normalizeTableRows(rows);
  const versionPrefix = `__version_${sanitizeTableName(tableName)}_`;
  const options = tables.map<TableOption>((name) => {
    if (name === tableName) {
      return {
        value: name,
        label: `${name} (current)`,
        kind: "current",
        timestamp: null,
      };
    }

    if (name.startsWith(versionPrefix)) {
      const match = /_(\d{10,})$/.exec(name);
      const timestamp = match ? Number(match[1]) : null;
      const baseLabel = name
        .slice(versionPrefix.length)
        .replace(/_(\d{10,})$/, "")
        .replaceAll("_", " ")
        .trim();

      return {
        value: name,
        label: baseLabel ? `${baseLabel} snapshot` : name,
        kind: "version",
        timestamp,
      };
    }

    return {
      value: name,
      label: name,
      kind: "table",
      timestamp: null,
    };
  });

  return options.sort((left, right) => {
    const leftRank = left.kind === "current" ? 0 : left.kind === "version" ? 1 : 2;
    const rightRank = right.kind === "current" ? 0 : right.kind === "version" ? 1 : 2;
    if (leftRank !== rightRank) return leftRank - rightRank;
    if (left.kind === "version" && right.kind === "version") {
      return (left.timestamp ?? 0) - (right.timestamp ?? 0);
    }
    return left.label.localeCompare(right.label);
  });
}

async function describeColumns(tableName: string) {
  const rows = await runQuery(`DESCRIBE ${quoteIdentifier(tableName)}`);
  return rows
    .map((row) => String(row.column_name ?? ""))
    .filter(Boolean);
}

function buildSourceCte(tableName: string, columns: string[], keyColumn: string) {
  const selectedColumns = columns.map((column) => quoteIdentifier(column)).join(", ");
  if (keyColumn === "__row_index__") {
    return `
      SELECT
        CAST(ROW_NUMBER() OVER () AS VARCHAR) AS diff_key,
        ${selectedColumns}
      FROM ${quoteIdentifier(tableName)}
    `;
  }

  return `
    SELECT
      CAST(${quoteIdentifier(keyColumn)} AS VARCHAR) AS diff_key,
      ${selectedColumns}
    FROM ${quoteIdentifier(tableName)}
    WHERE ${quoteIdentifier(keyColumn)} IS NOT NULL
  `;
}

function buildChangedExpression(columns: string[]) {
  if (columns.length === 0) return "FALSE";
  return columns
    .map((column) => `l.${quoteIdentifier(column)} IS DISTINCT FROM r.${quoteIdentifier(column)}`)
    .join(" OR ");
}

async function loadDiffData(
  leftTable: string,
  rightTable: string,
  keyPreference: string,
): Promise<DiffResult> {
  const [leftColumns, rightColumns] = await Promise.all([
    describeColumns(leftTable),
    describeColumns(rightTable),
  ]);
  const sharedColumns = leftColumns.filter((column) => rightColumns.includes(column));
  const keyOptions = ["__row_index__", ...sharedColumns];
  const resolvedKey = keyOptions.includes(keyPreference) ? keyPreference : inferKey(sharedColumns);
  const comparedColumns = sharedColumns.filter((column) => column !== resolvedKey);

  if (sharedColumns.length === 0) {
    return {
      keyOptions,
      resolvedKey,
      comparedColumns: [],
      leftColumns,
      rightColumns,
      addedCount: 0,
      removedCount: 0,
      modifiedCount: 0,
      rows: [],
      columnSummary: [],
      warning: null,
      error: "These tables do not share any column names, so a diff cannot be computed.",
    };
  }

  const sourceColumns = resolvedKey === "__row_index__" ? sharedColumns : sharedColumns;
  const changedExpression = buildChangedExpression(comparedColumns);
  const leftSource = buildSourceCte(leftTable, sourceColumns, resolvedKey);
  const rightSource = buildSourceCte(rightTable, sourceColumns, resolvedKey);
  const cte = `
    WITH left_rows AS (
      ${leftSource}
    ),
    right_rows AS (
      ${rightSource}
    )
  `;

  const [summaryRows, columnSummaryRows, sampleRows] = await Promise.all([
    runQuery(`
      ${cte}
      SELECT
        COUNT(*) FILTER (WHERE l.diff_key IS NULL) AS added_count,
        COUNT(*) FILTER (WHERE r.diff_key IS NULL) AS removed_count,
        COUNT(*) FILTER (
          WHERE l.diff_key IS NOT NULL
            AND r.diff_key IS NOT NULL
            AND (${changedExpression})
        ) AS modified_count
      FROM left_rows l
      FULL OUTER JOIN right_rows r USING (diff_key)
    `),
    comparedColumns.length > 0
      ? runQuery(`
          ${cte}
          SELECT
            ${comparedColumns
              .map(
                (column) =>
                  `SUM(CASE WHEN l.${quoteIdentifier(column)} IS DISTINCT FROM r.${quoteIdentifier(column)} THEN 1 ELSE 0 END) AS ${quoteIdentifier(`changes__${column}`)}`,
              )
              .join(",\n            ")}
          FROM left_rows l
          JOIN right_rows r USING (diff_key)
          WHERE ${changedExpression}
        `)
      : Promise.resolve<Record<string, unknown>[]>([]),
    runQuery(`
      ${cte}
      SELECT
        COALESCE(l.diff_key, r.diff_key) AS diff_key,
        CASE
          WHEN l.diff_key IS NULL THEN 'added'
          WHEN r.diff_key IS NULL THEN 'removed'
          WHEN (${changedExpression}) THEN 'modified'
          ELSE 'unchanged'
        END AS change_type,
        ${comparedColumns
          .flatMap((column) => [
            `l.${quoteIdentifier(column)} AS ${quoteIdentifier(`left__${column}`)}`,
            `r.${quoteIdentifier(column)} AS ${quoteIdentifier(`right__${column}`)}`,
          ])
          .join(",\n        ")}
      FROM left_rows l
      FULL OUTER JOIN right_rows r USING (diff_key)
      WHERE l.diff_key IS NULL OR r.diff_key IS NULL OR (${changedExpression})
      ORDER BY
        CASE
          WHEN l.diff_key IS NOT NULL AND r.diff_key IS NOT NULL AND (${changedExpression}) THEN 0
          WHEN l.diff_key IS NULL THEN 1
          ELSE 2
        END,
        COALESCE(l.diff_key, r.diff_key)
      LIMIT 60
    `),
  ]);

  const summary = summaryRows[0] ?? {};
  const columnSummaryRow = columnSummaryRows[0] ?? {};

  const rows = sampleRows.flatMap<DiffRow>((row) => {
    const changeType =
      row.change_type === "added" || row.change_type === "removed" || row.change_type === "modified"
        ? row.change_type
        : null;
    if (!changeType) return [];

    const leftValues = Object.fromEntries(
      comparedColumns.map((column) => [column, row[`left__${column}`] ?? null]),
    );
    const rightValues = Object.fromEntries(
      comparedColumns.map((column) => [column, row[`right__${column}`] ?? null]),
    );
    const changedColumns = comparedColumns.filter(
      (column) => leftValues[column] !== rightValues[column],
    );

    return [
      {
        diffKey: String(row.diff_key ?? ""),
        changeType,
        changedColumns,
        leftValues,
        rightValues,
      },
    ];
  });

  return {
    keyOptions,
    resolvedKey,
    comparedColumns,
    leftColumns,
    rightColumns,
    addedCount: Number(summary.added_count ?? 0),
    removedCount: Number(summary.removed_count ?? 0),
    modifiedCount: Number(summary.modified_count ?? 0),
    rows,
    columnSummary: comparedColumns
      .map((column) => ({
        column,
        changes: Number(columnSummaryRow[`changes__${column}`] ?? 0),
      }))
      .sort((left, right) => right.changes - left.changes),
    warning:
      resolvedKey === "__row_index__"
        ? "Diff keys are based on row order because no shared key column was selected."
        : null,
    error: null,
  };
}

function DataDiffLoading() {
  return (
    <div className={`${PANEL_CLASS} flex min-h-[28rem] items-center justify-center`}>
      <div className="flex items-center gap-3 text-sm text-slate-500 dark:text-slate-300">
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading comparison workspace…
      </div>
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-3xl border border-white/15 bg-white/45 p-4 dark:bg-slate-950/35">
      <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
        {label}
      </div>
      <div className="mt-3 text-2xl font-semibold text-slate-950 dark:text-white">
        {value}
      </div>
    </div>
  );
}

function SideBySideRow({
  row,
  columns,
}: {
  row: DiffRow;
  columns: string[];
}) {
  const toneClass =
    row.changeType === "added"
      ? "border-emerald-400/30"
      : row.changeType === "removed"
        ? "border-rose-400/30"
        : "border-amber-400/30";

  return (
    <div className={`rounded-3xl border ${toneClass} bg-white/45 p-4 dark:bg-slate-950/35`}>
      <div className="mb-3 flex items-center justify-between gap-3">
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
            {row.changeType}
          </div>
          <div className="mt-1 font-mono text-sm text-slate-700 dark:text-slate-200">
            {row.diffKey}
          </div>
        </div>
        <div className="rounded-full border border-white/15 px-3 py-1 text-xs text-slate-500 dark:text-slate-300">
          {row.changedColumns.length} changed columns
        </div>
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        <div className="rounded-2xl border border-white/15 bg-white/55 p-3 dark:bg-slate-950/35">
          <div className="mb-2 text-xs font-semibold uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">
            Left
          </div>
          <div className="space-y-2">
            {columns.map((column) => (
              <div
                key={`${row.diffKey}-left-${column}`}
                className={`flex items-center justify-between gap-3 rounded-2xl px-3 py-2 text-sm ${
                  row.changedColumns.includes(column)
                    ? "bg-amber-500/12 text-amber-800 dark:text-amber-200"
                    : "bg-transparent text-slate-600 dark:text-slate-300"
                }`}
              >
                <span className="truncate">{column}</span>
                <span className="font-mono">{formatScalar(row.leftValues[column])}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-2xl border border-white/15 bg-white/55 p-3 dark:bg-slate-950/35">
          <div className="mb-2 text-xs font-semibold uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">
            Right
          </div>
          <div className="space-y-2">
            {columns.map((column) => (
              <div
                key={`${row.diffKey}-right-${column}`}
                className={`flex items-center justify-between gap-3 rounded-2xl px-3 py-2 text-sm ${
                  row.changedColumns.includes(column)
                    ? "bg-cyan-500/12 text-cyan-800 dark:text-cyan-200"
                    : "bg-transparent text-slate-600 dark:text-slate-300"
                }`}
              >
                <span className="truncate">{column}</span>
                <span className="font-mono">{formatScalar(row.rightValues[column])}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function UnifiedRow({
  row,
}: {
  row: DiffRow;
}) {
  return (
    <div className="rounded-3xl border border-white/15 bg-white/45 p-4 dark:bg-slate-950/35">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
            {row.changeType}
          </div>
          <div className="mt-1 font-mono text-sm text-slate-700 dark:text-slate-200">
            {row.diffKey}
          </div>
        </div>
        <div className="text-xs text-slate-500 dark:text-slate-400">
          {row.changedColumns.join(", ") || "No field delta"}
        </div>
      </div>
      <div className="mt-4 space-y-3">
        {row.changedColumns.map((column) => (
          <div
            key={`${row.diffKey}-${column}`}
            className="rounded-2xl border border-white/15 bg-white/55 px-3 py-3 dark:bg-slate-950/35"
          >
            <div className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">
              {column}
            </div>
            <div className="mt-2 grid gap-2 md:grid-cols-2">
              <div className="rounded-2xl bg-rose-500/10 px-3 py-2 text-sm text-rose-700 dark:text-rose-300">
                Left: <span className="font-mono">{formatScalar(row.leftValues[column])}</span>
              </div>
              <div className="rounded-2xl bg-cyan-500/10 px-3 py-2 text-sm text-cyan-700 dark:text-cyan-300">
                Right: <span className="font-mono">{formatScalar(row.rightValues[column])}</span>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function DataDiffReady({ tableName }: DataDiffProps) {
  const optionsPromise = useMemo(() => loadTableOptions(tableName), [tableName]);
  const options = use(optionsPromise);
  const versionOptions = options.filter((option) => option.kind === "version");
  const initialRightSelection =
    versionOptions[versionOptions.length - 1]?.value ??
    options.find((option) => option.value !== tableName)?.value ??
    tableName;

  const [leftSelection, setLeftSelection] = useState(tableName);
  const [rightSelection, setRightSelection] = useState(initialRightSelection);
  const [keyPreference, setKeyPreference] = useState("");
  const [viewMode, setViewMode] = useState<ViewMode>("side");
  const [diffPromise, setDiffPromise] = useState(() =>
    loadDiffData(tableName, initialRightSelection, "").catch((error) => ({
      keyOptions: [],
      resolvedKey: "__row_index__",
      comparedColumns: [],
      leftColumns: [],
      rightColumns: [],
      addedCount: 0,
      removedCount: 0,
      modifiedCount: 0,
      rows: [],
      columnSummary: [],
      warning: null,
      error:
        error instanceof Error
          ? error.message
          : "Unable to compute dataset diff.",
    })),
  );

  const safeLeft = options.some((option) => option.value === leftSelection)
    ? leftSelection
    : tableName;
  const fallbackRight =
    versionOptions[versionOptions.length - 1]?.value ??
    options.find((option) => option.value !== safeLeft)?.value ??
    safeLeft;
  const safeRight =
    options.some((option) => option.value === rightSelection) && rightSelection
      ? rightSelection
      : fallbackRight;

  const result = use(diffPromise);
  const totalChanges = result.addedCount + result.removedCount + result.modifiedCount;
  const timelineIndex = Math.max(
    0,
    versionOptions.findIndex((option) => option.value === safeRight),
  );

  function createDiffRequest(leftTable: string, rightTable: string, keyColumn: string) {
    return loadDiffData(leftTable, rightTable, keyColumn).catch((error) => ({
      keyOptions: [],
      resolvedKey: "__row_index__",
      comparedColumns: [],
      leftColumns: [],
      rightColumns: [],
      addedCount: 0,
      removedCount: 0,
      modifiedCount: 0,
      rows: [],
      columnSummary: [],
      warning: null,
      error:
        error instanceof Error
          ? error.message
          : "Unable to compute dataset diff.",
    }));
  }

  function handleExport() {
    const headers = [
      "diff_key",
      "change_type",
      "changed_columns",
      ...result.comparedColumns.flatMap((column) => [`left__${column}`, `right__${column}`]),
    ];
    const lines = result.rows.map((row) =>
      [
        row.diffKey,
        row.changeType,
        row.changedColumns.join("|"),
        ...result.comparedColumns.flatMap((column) => [
          formatScalar(row.leftValues[column]),
          formatScalar(row.rightValues[column]),
        ]),
      ]
        .map((cell) =>
          String(cell)
            .replaceAll('"', '""')
            .replaceAll("\n", " "),
        )
        .map((cell) => (cell.includes(",") ? `"${cell}"` : cell))
        .join(","),
    );
    downloadFile(
      [headers.join(","), ...lines].join("\n"),
      `${safeLeft}-vs-${safeRight}-diff.csv`,
      "text/csv;charset=utf-8;",
    );
  }

  return (
    <div className="space-y-6">
      <motion.section
        initial={{ opacity: 0, y: 18 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.36, ease: EASE }}
        className={`${PANEL_CLASS} p-5`}
      >
        <div className="grid gap-4 xl:grid-cols-[1.1fr_0.9fr]">
          <div className="space-y-4">
            <div>
              <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-cyan-600 dark:text-cyan-300">
                <GitCompareArrows className="h-3.5 w-3.5" />
                Dataset diff
              </div>
              <h3 className="mt-2 text-xl font-semibold text-slate-950 dark:text-white">
                Compare two snapshots or tables side by side
              </h3>
              <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">
                Added, removed, and modified rows are computed in DuckDB using a shared key or row-order fallback.
              </p>
            </div>

            <div className="grid gap-3 md:grid-cols-3">
              <div>
                <label className="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
                  Left dataset
                </label>
                <select
                  value={safeLeft}
                  onChange={(event) => {
                    const nextLeft = event.target.value;
                    const nextRight =
                      options.some((option) => option.value === rightSelection) && rightSelection
                        ? rightSelection
                        : versionOptions[versionOptions.length - 1]?.value ??
                          options.find((option) => option.value !== nextLeft)?.value ??
                          nextLeft;
                    startTransition(() => {
                      setLeftSelection(nextLeft);
                      setRightSelection(nextRight);
                      setDiffPromise(createDiffRequest(nextLeft, nextRight, keyPreference));
                    });
                  }}
                  className={FIELD_CLASS}
                >
                  {options.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
                  Right dataset
                </label>
                <select
                  value={safeRight}
                  onChange={(event) => {
                    const nextRight = event.target.value;
                    startTransition(() => {
                      setRightSelection(nextRight);
                      setDiffPromise(createDiffRequest(safeLeft, nextRight, keyPreference));
                    });
                  }}
                  className={FIELD_CLASS}
                >
                  {options.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
                  Diff key
                </label>
                <select
                  value={result.resolvedKey}
                  onChange={(event) => {
                    const nextKey = event.target.value;
                    startTransition(() => {
                      setKeyPreference(nextKey);
                      setDiffPromise(createDiffRequest(safeLeft, safeRight, nextKey));
                    });
                  }}
                  className={FIELD_CLASS}
                >
                  {result.keyOptions.map((option) => (
                    <option key={option} value={option}>
                      {option === "__row_index__" ? "Row order fallback" : option}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {versionOptions.length > 1 ? (
              <label className="block rounded-2xl border border-white/15 bg-white/45 px-4 py-4 dark:bg-slate-950/35">
                <div className="mb-3 flex items-center justify-between gap-3 text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
                  <span className="flex items-center gap-2">
                    <Clock3 className="h-3.5 w-3.5" />
                    Version timeline
                  </span>
                  <span>{versionOptions[timelineIndex]?.label ?? "Snapshot"}</span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={Math.max(versionOptions.length - 1, 0)}
                  value={timelineIndex}
                  onChange={(event) => {
                    const nextRight = versionOptions[Number(event.target.value)]?.value ?? safeRight;
                    startTransition(() => {
                      setRightSelection(nextRight);
                      setDiffPromise(createDiffRequest(safeLeft, nextRight, keyPreference));
                    });
                  }}
                  className="h-2 w-full accent-cyan-500"
                />
                <div className="mt-3 flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
                  <span>{versionOptions[0]?.label ?? "Earliest"}</span>
                  <span>{versionOptions[versionOptions.length - 1]?.label ?? "Latest"}</span>
                </div>
              </label>
            ) : null}

            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => startTransition(() => setViewMode("side"))}
                className={`rounded-2xl border px-3 py-2 text-sm transition ${
                  viewMode === "side"
                    ? "border-cyan-400/50 bg-cyan-500/15 text-cyan-700 dark:text-cyan-200"
                    : "border-white/20 bg-white/55 text-slate-600 dark:bg-slate-950/35 dark:text-slate-200"
                }`}
              >
                <span className="flex items-center gap-2">
                  <SplitSquareHorizontal className="h-4 w-4" />
                  Side by side
                </span>
              </button>
              <button
                type="button"
                onClick={() => startTransition(() => setViewMode("unified"))}
                className={`rounded-2xl border px-3 py-2 text-sm transition ${
                  viewMode === "unified"
                    ? "border-cyan-400/50 bg-cyan-500/15 text-cyan-700 dark:text-cyan-200"
                    : "border-white/20 bg-white/55 text-slate-600 dark:bg-slate-950/35 dark:text-slate-200"
                }`}
              >
                <span className="flex items-center gap-2">
                  <TableProperties className="h-4 w-4" />
                  Unified
                </span>
              </button>
              <button
                type="button"
                onClick={handleExport}
                className="rounded-2xl border border-white/20 bg-white/55 px-3 py-2 text-sm text-slate-600 transition hover:border-cyan-300/40 dark:bg-slate-950/35 dark:text-slate-200"
              >
                <span className="flex items-center gap-2">
                  <Download className="h-4 w-4" />
                  Export diff CSV
                </span>
              </button>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-2">
            <StatCard label="Total changes" value={formatNumber(totalChanges)} />
            <StatCard label="Added rows" value={formatNumber(result.addedCount)} />
            <StatCard label="Removed rows" value={formatNumber(result.removedCount)} />
            <StatCard label="Modified rows" value={formatNumber(result.modifiedCount)} />
          </div>
        </div>
      </motion.section>

      {result.warning ? (
        <div className="rounded-3xl border border-amber-400/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-700 dark:text-amber-300">
          {result.warning}
        </div>
      ) : null}

      {result.error ? (
        <div className="rounded-3xl border border-rose-400/30 bg-rose-500/10 px-4 py-5 text-sm text-rose-700 dark:text-rose-300">
          {result.error}
        </div>
      ) : (
        <>
          <motion.section
            initial={{ opacity: 0, y: 18 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, ease: EASE }}
            className={`${PANEL_CLASS} p-5`}
          >
            <div className="mb-4 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
              <ArrowLeftRight className="h-3.5 w-3.5" />
              Column impact
            </div>
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {result.columnSummary.slice(0, 9).map((entry) => (
                <div
                  key={entry.column}
                  className="rounded-3xl border border-white/15 bg-white/45 p-4 dark:bg-slate-950/35"
                >
                  <div className="text-sm font-semibold text-slate-950 dark:text-white">
                    {entry.column}
                  </div>
                  <div className="mt-2 text-xs uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">
                    {formatNumber(entry.changes)} row deltas
                  </div>
                  <div className="mt-4 h-2 overflow-hidden rounded-full bg-white/60 dark:bg-slate-900/80">
                    <div
                      className="h-full rounded-full bg-cyan-500"
                      style={{
                        width: `${totalChanges === 0 ? 0 : (entry.changes / totalChanges) * 100}%`,
                      }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </motion.section>

          <motion.section
            initial={{ opacity: 0, y: 18 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.42, ease: EASE }}
            className={`${PANEL_CLASS} p-5`}
          >
            <div className="mb-4 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
              <FileDiff className="h-3.5 w-3.5" />
              Row preview
            </div>
            <div className="space-y-4">
              {result.rows.length === 0 ? (
                <div className="rounded-3xl border border-white/15 bg-white/45 px-4 py-5 text-sm text-slate-600 dark:bg-slate-950/35 dark:text-slate-300">
                  No row-level changes were detected for the selected comparison.
                </div>
              ) : viewMode === "side" ? (
                result.rows.map((row) => (
                  <SideBySideRow
                    key={`${row.changeType}-${row.diffKey}`}
                    row={row}
                    columns={result.comparedColumns}
                  />
                ))
              ) : (
                result.rows.map((row) => (
                  <UnifiedRow key={`${row.changeType}-${row.diffKey}`} row={row} />
                ))
              )}
            </div>
          </motion.section>
        </>
      )}
    </div>
  );
}

export default function DataDiff({ tableName, columns }: DataDiffProps) {
  return (
    <Suspense fallback={<DataDiffLoading />}>
      <DataDiffReady tableName={tableName} columns={columns} />
    </Suspense>
  );
}
