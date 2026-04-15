"use client";

import { quoteIdentifier } from "@/lib/utils/sql";
import {
  Suspense,
  startTransition,
  use,
  useMemo,
  useState,
} from "react";
import { motion } from "framer-motion";
import {
  Columns3,
  Download,
  Loader2,
  Sparkles,
  Split,
  TimerReset,
  Waves,
} from "lucide-react";
import { runQuery } from "@/lib/duckdb/client";
import { formatNumber } from "@/lib/utils/formatters";
import type { ColumnProfile } from "@/types/dataset";

interface DataEnrichmentProps {
  tableName: string;
  columns: ColumnProfile[];
}

type OperationKind =
  | "date_parts"
  | "string_ops"
  | "binning"
  | "ranking"
  | "lag_lead"
  | "running";

type DatePartMode = "year" | "month" | "day" | "weekday";
type StringMode = "initials" | "word_count" | "domain";
type BinningMode = "equal_width" | "equal_frequency" | "custom";
type RankingMode = "rank" | "dense_rank" | "row_number" | "percent_rank";
type LagLeadMode = "lag" | "lead";
type RunningMode = "sum" | "avg" | "count";
type SortDirection = "asc" | "desc";

interface OperationSpec {
  valid: boolean;
  error: string | null;
  expression: string;
  sql: string;
  newColumnName: string;
  previewColumns: string[];
}

const EASE = [0.22, 1, 0.36, 1] as const;
const PANEL_CLASS =
  "rounded-[1.75rem] border border-white/20 bg-white/75 shadow-xl shadow-slate-950/10 backdrop-blur-2xl dark:border-white/10 dark:bg-slate-950/45";
const FIELD_CLASS =
  "rounded-2xl border border-white/20 bg-white/80 px-4 py-3 text-sm text-slate-700 outline-none transition focus:border-cyan-400 focus:ring-4 focus:ring-cyan-500/10 dark:border-white/10 dark:bg-slate-950/50 dark:text-slate-100";
function slugify(value: string) {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9_]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 48) || "derived_column"
  );
}

function safeColumn(value: string, candidates: string[]) {
  return candidates.includes(value) ? value : candidates[0] ?? "";
}

function buildPartitionClause(partitionBy: string) {
  return partitionBy ? `PARTITION BY ${quoteIdentifier(partitionBy)} ` : "";
}

function buildPreviewQuery(tableName: string, columns: string[], expression: string, newColumnName: string) {
  const selectedColumns = columns.map((column) => quoteIdentifier(column)).join(", ");
  const selectList = selectedColumns
    ? `${selectedColumns}, ${expression} AS ${quoteIdentifier(newColumnName)}`
    : `${expression} AS ${quoteIdentifier(newColumnName)}`;
  return `
    SELECT ${selectList}
    FROM ${quoteIdentifier(tableName)}
    LIMIT 12
  `;
}

function buildDatePartExpression(column: string, mode: DatePartMode) {
  const casted = `TRY_CAST(${quoteIdentifier(column)} AS TIMESTAMP)`;
  if (mode === "weekday") {
    return `STRFTIME(${casted}, '%A')`;
  }
  if (mode === "year") return `EXTRACT(YEAR FROM ${casted})`;
  if (mode === "month") return `EXTRACT(MONTH FROM ${casted})`;
  return `EXTRACT(DAY FROM ${casted})`;
}

function buildStringExpression(column: string, mode: StringMode) {
  const text = `COALESCE(CAST(${quoteIdentifier(column)} AS VARCHAR), '')`;
  if (mode === "initials") {
    return `
      UPPER(
        CONCAT(
          SUBSTR(TRIM(${text}), 1, 1),
          CASE
            WHEN STRPOS(TRIM(${text}), ' ') > 0
              THEN SUBSTR(TRIM(${text}), STRPOS(TRIM(${text}), ' ') + 1, 1)
            ELSE ''
          END
        )
      )
    `;
  }
  if (mode === "word_count") {
    return `
      CASE
        WHEN TRIM(${text}) = '' THEN 0
        ELSE ARRAY_LENGTH(STRING_SPLIT(TRIM(${text}), ' '))
      END
    `;
  }
  return `
    LOWER(
      COALESCE(
        NULLIF(REGEXP_EXTRACT(${text}, '@([^@]+)$', 1), ''),
        NULLIF(REGEXP_EXTRACT(${text}, '^(?:https?://)?(?:www\\.)?([^/:?#]+)', 1), '')
      )
    )
  `;
}

function buildBinningExpression(column: string, mode: BinningMode, binCount: number, customBreakpoints: string) {
  const metric = `TRY_CAST(${quoteIdentifier(column)} AS DOUBLE)`;
  if (mode === "equal_frequency") {
    return `NTILE(${binCount}) OVER (ORDER BY ${metric})`;
  }

  if (mode === "custom") {
    const breakpoints = customBreakpoints
      .split(",")
      .map((entry) => Number(entry.trim()))
      .filter((entry) => Number.isFinite(entry))
      .sort((left, right) => left - right);

    if (breakpoints.length === 0) return "";

    const cases = breakpoints.map((breakpoint, index) => {
      if (index === 0) {
        return `WHEN ${metric} <= ${breakpoint} THEN '≤ ${breakpoint}'`;
      }
      const previous = breakpoints[index - 1];
      return `WHEN ${metric} <= ${breakpoint} THEN '${previous} – ${breakpoint}'`;
    });
    const finalLabel = `> ${breakpoints[breakpoints.length - 1]}`;
    return `
      CASE
        WHEN ${metric} IS NULL THEN NULL
        ${cases.join("\n        ")}
        ELSE '${finalLabel}'
      END
    `;
  }

  return `
    CASE
      WHEN ${metric} IS NULL THEN NULL
      WHEN MAX(${metric}) OVER () = MIN(${metric}) OVER () THEN 1
      ELSE LEAST(
        ${binCount},
        GREATEST(
          1,
          CAST(
            FLOOR(
              ((${metric} - MIN(${metric}) OVER ()) /
              NULLIF(MAX(${metric}) OVER () - MIN(${metric}) OVER (), 0)) * ${binCount}
            ) AS INTEGER
          ) + 1
        )
      )
    END
  `;
}

function buildRankingExpression(column: string, mode: RankingMode, direction: SortDirection, partitionBy: string) {
  const window = `${buildPartitionClause(partitionBy)}ORDER BY ${quoteIdentifier(column)} ${direction.toUpperCase()}`;
  if (mode === "dense_rank") return `DENSE_RANK() OVER (${window})`;
  if (mode === "row_number") return `ROW_NUMBER() OVER (${window})`;
  if (mode === "percent_rank") return `PERCENT_RANK() OVER (${window})`;
  return `RANK() OVER (${window})`;
}

function buildLagLeadExpression(
  column: string,
  orderBy: string,
  partitionBy: string,
  offset: number,
  mode: LagLeadMode,
) {
  const fn = mode === "lead" ? "LEAD" : "LAG";
  return `${fn}(${quoteIdentifier(column)}, ${offset}) OVER (${buildPartitionClause(partitionBy)}ORDER BY ${quoteIdentifier(orderBy)} ASC)`;
}

function buildRunningExpression(
  column: string,
  orderBy: string,
  partitionBy: string,
  mode: RunningMode,
) {
  const valueExpression =
    mode === "count" ? "*" : `TRY_CAST(${quoteIdentifier(column)} AS DOUBLE)`;
  const fn = mode === "avg" ? "AVG" : mode === "count" ? "COUNT" : "SUM";
  return `${fn}(${valueExpression}) OVER (${buildPartitionClause(partitionBy)}ORDER BY ${quoteIdentifier(orderBy)} ASC ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW)`;
}

function buildOperationSpec({
  tableName,
  allColumns,
  operation,
  sourceColumn,
  orderColumn,
  partitionBy,
  datePartMode,
  stringMode,
  binningMode,
  rankingMode,
  lagLeadMode,
  runningMode,
  orderDirection,
  binCount,
  offset,
  customBreakpoints,
  newColumnName,
}: {
  tableName: string;
  allColumns: string[];
  operation: OperationKind;
  sourceColumn: string;
  orderColumn: string;
  partitionBy: string;
  datePartMode: DatePartMode;
  stringMode: StringMode;
  binningMode: BinningMode;
  rankingMode: RankingMode;
  lagLeadMode: LagLeadMode;
  runningMode: RunningMode;
  orderDirection: SortDirection;
  binCount: number;
  offset: number;
  customBreakpoints: string;
  newColumnName: string;
}): OperationSpec {
  const resolvedName = slugify(newColumnName);
  let expression = "";
  let previewColumns = [sourceColumn].filter(Boolean);
  let error: string | null = null;

  if (!sourceColumn) {
    return {
      valid: false,
      error: "Choose a source column first.",
      expression: "",
      sql: "",
      newColumnName: resolvedName,
      previewColumns: [],
    };
  }

  if (operation === "date_parts") {
    expression = buildDatePartExpression(sourceColumn, datePartMode);
  } else if (operation === "string_ops") {
    expression = buildStringExpression(sourceColumn, stringMode);
  } else if (operation === "binning") {
    expression = buildBinningExpression(sourceColumn, binningMode, binCount, customBreakpoints);
    if (!expression) error = "Add at least one numeric breakpoint for custom bins.";
  } else if (operation === "ranking") {
    expression = buildRankingExpression(sourceColumn, rankingMode, orderDirection, partitionBy);
    previewColumns = [sourceColumn, partitionBy].filter(Boolean);
  } else if (operation === "lag_lead") {
    if (!orderColumn) error = "Lag and lead operations require an order column.";
    expression = orderColumn
      ? buildLagLeadExpression(sourceColumn, orderColumn, partitionBy, offset, lagLeadMode)
      : "";
    previewColumns = [partitionBy, orderColumn, sourceColumn].filter(Boolean);
  } else {
    if (!orderColumn) error = "Running aggregates require an order column.";
    expression = orderColumn
      ? buildRunningExpression(sourceColumn, orderColumn, partitionBy, runningMode)
      : "";
    previewColumns = [partitionBy, orderColumn, sourceColumn].filter(Boolean);
  }

  const baseColumns = allColumns
    .filter((column) => column !== resolvedName)
    .map((column) => quoteIdentifier(column))
    .join(", ");
  const selectList = baseColumns
    ? `${baseColumns}, ${expression} AS ${quoteIdentifier(resolvedName)}`
    : `${expression} AS ${quoteIdentifier(resolvedName)}`;

  return {
    valid: !error && Boolean(expression),
    error,
    expression,
    sql: `
      SELECT ${selectList}
      FROM ${quoteIdentifier(tableName)}
    `.trim(),
    newColumnName: resolvedName,
    previewColumns: previewColumns.filter((column, index, list) => column && list.indexOf(column) === index),
  };
}

async function replaceTableWithSelect(tableName: string, selectSql: string) {
  const tempTable = `${tableName}__enrich_temp_${Date.now()}`;
  const backupTable = `${tableName}__enrich_backup_${Date.now()}`;
  const source = quoteIdentifier(tableName);
  const temp = quoteIdentifier(tempTable);
  const backup = quoteIdentifier(backupTable);

  await runQuery(`DROP TABLE IF EXISTS ${temp}`);
  await runQuery(`CREATE TABLE ${temp} AS ${selectSql}`);
  await runQuery(`ALTER TABLE ${source} RENAME TO ${backup}`);

  try {
    await runQuery(`ALTER TABLE ${temp} RENAME TO ${source}`);
    await runQuery(`DROP TABLE ${backup}`);
  } catch (error) {
    await runQuery(`ALTER TABLE ${backup} RENAME TO ${source}`).catch(() => undefined);
    await runQuery(`DROP TABLE IF EXISTS ${temp}`).catch(() => undefined);
    throw error;
  }
}

function PreviewLoading() {
  return (
    <div className="flex min-h-[14rem] items-center justify-center rounded-3xl border border-white/15 bg-white/45 dark:bg-slate-950/35">
      <div className="flex items-center gap-3 text-sm text-slate-500 dark:text-slate-300">
        <Loader2 className="h-4 w-4 animate-spin" />
        Building preview…
      </div>
    </div>
  );
}

function PreviewPanel({
  tableName,
  spec,
}: {
  tableName: string;
  spec: OperationSpec;
}) {
  const previewPromise = useMemo(
    () =>
      spec.valid
        ? runQuery(buildPreviewQuery(tableName, spec.previewColumns, spec.expression, spec.newColumnName))
        : Promise.resolve<Record<string, unknown>[]>([]),
    [spec.expression, spec.newColumnName, spec.previewColumns, spec.valid, tableName],
  );
  const rows = use(previewPromise);

  if (!spec.valid) {
    return (
      <div className="rounded-3xl border border-amber-400/30 bg-amber-500/10 px-4 py-5 text-sm text-amber-700 dark:text-amber-300">
        {spec.error ?? "Complete the enrichment configuration to preview it."}
      </div>
    );
  }

  const headers = rows.length > 0 ? Object.keys(rows[0] ?? {}) : [...spec.previewColumns, spec.newColumnName];

  return (
    <div className="space-y-4">
      <div className="overflow-x-auto rounded-3xl border border-white/15 bg-white/45 dark:bg-slate-950/35">
        <table className="min-w-full text-left text-sm">
          <thead className="border-b border-white/15 text-xs uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">
            <tr>
              {headers.map((header) => (
                <th key={header} className="px-4 py-3 font-semibold">
                  {header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, rowIndex) => (
              <tr key={`${spec.newColumnName}-${rowIndex}`} className="border-b border-white/10 last:border-b-0">
                {headers.map((header) => (
                  <td
                    key={`${rowIndex}-${header}`}
                    className={`px-4 py-3 ${
                      header === spec.newColumnName
                        ? "font-medium text-cyan-700 dark:text-cyan-300"
                        : "text-slate-600 dark:text-slate-300"
                    }`}
                  >
                    {String(row[header] ?? "—")}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="rounded-3xl border border-white/15 bg-slate-950 px-4 py-4 text-xs text-slate-300">
        <div className="mb-2 font-semibold uppercase tracking-[0.18em] text-slate-400">
          Generated SQL
        </div>
        <pre className="overflow-x-auto whitespace-pre-wrap font-mono leading-6">{spec.sql}</pre>
      </div>
    </div>
  );
}

export default function DataEnrichment({ tableName, columns }: DataEnrichmentProps) {
  const columnNames = useMemo(() => columns.map((column) => column.name), [columns]);
  const dateColumns = useMemo(
    () => columns.filter((column) => column.type === "date").map((column) => column.name),
    [columns],
  );
  const numericColumns = useMemo(
    () => columns.filter((column) => column.type === "number").map((column) => column.name),
    [columns],
  );
  const stringColumns = useMemo(
    () => columns.filter((column) => column.type === "string").map((column) => column.name),
    [columns],
  );

  const [operation, setOperation] = useState<OperationKind>("date_parts");
  const [sourceColumn, setSourceColumn] = useState(columnNames[0] ?? "");
  const [orderColumn, setOrderColumn] = useState(dateColumns[0] ?? columnNames[0] ?? "");
  const [partitionBy, setPartitionBy] = useState("");
  const [datePartMode, setDatePartMode] = useState<DatePartMode>("year");
  const [stringMode, setStringMode] = useState<StringMode>("initials");
  const [binningMode, setBinningMode] = useState<BinningMode>("equal_width");
  const [rankingMode, setRankingMode] = useState<RankingMode>("rank");
  const [lagLeadMode, setLagLeadMode] = useState<LagLeadMode>("lag");
  const [runningMode, setRunningMode] = useState<RunningMode>("sum");
  const [orderDirection, setOrderDirection] = useState<SortDirection>("desc");
  const [binCount, setBinCount] = useState(5);
  const [offset, setOffset] = useState(1);
  const [customBreakpoints, setCustomBreakpoints] = useState("10,25,50,100");
  const [newColumnName, setNewColumnName] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const sourceCandidates =
    operation === "date_parts"
      ? dateColumns
      : operation === "string_ops"
        ? stringColumns
        : operation === "binning"
          ? numericColumns
          : columnNames;
  const safeSource = safeColumn(sourceColumn, sourceCandidates);
  const safeOrder = safeColumn(orderColumn, columnNames);
  const safePartition = partitionBy && columnNames.includes(partitionBy) ? partitionBy : "";
  const defaultColumnName =
    operation === "date_parts"
      ? `${safeSource}_${datePartMode}`
      : operation === "string_ops"
        ? `${safeSource}_${stringMode}`
        : operation === "binning"
          ? `${safeSource}_bin`
          : operation === "ranking"
            ? `${safeSource}_${rankingMode}`
            : operation === "lag_lead"
              ? `${safeSource}_${lagLeadMode}_${offset}`
              : `${safeSource}_running_${runningMode}`;
  const safeNewColumnName = newColumnName.trim() || defaultColumnName;

  const spec = useMemo(
    () =>
      buildOperationSpec({
        tableName,
        allColumns: columnNames,
        operation,
        sourceColumn: safeSource,
        orderColumn: safeOrder,
        partitionBy: safePartition,
        datePartMode,
        stringMode,
        binningMode,
        rankingMode,
        lagLeadMode,
        runningMode,
        orderDirection,
        binCount,
        offset,
        customBreakpoints,
        newColumnName: safeNewColumnName,
      }),
    [
      binCount,
      binningMode,
      columnNames,
      customBreakpoints,
      datePartMode,
      lagLeadMode,
      operation,
      orderDirection,
      offset,
      rankingMode,
      runningMode,
      safeNewColumnName,
      safeOrder,
      safePartition,
      safeSource,
      stringMode,
      tableName,
    ],
  );

  async function handleApply() {
    if (!spec.valid) {
      setNotice(spec.error ?? "Fix the enrichment settings before applying.");
      return;
    }

    setBusy(true);
    setNotice(null);
    try {
      await replaceTableWithSelect(tableName, spec.sql);
      setNotice(`Applied ${spec.newColumnName} to ${tableName}. Refresh the dataset view to see the new schema.`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Failed to apply enrichment.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <motion.section
        initial={{ opacity: 0, y: 18 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.36, ease: EASE }}
        className={`${PANEL_CLASS} p-5`}
      >
        <div className="grid gap-4 xl:grid-cols-[1.15fr_0.85fr]">
          <div className="space-y-4">
            <div>
              <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-cyan-600 dark:text-cyan-300">
                <Sparkles className="h-3.5 w-3.5" />
                Data enrichment
              </div>
              <h3 className="mt-2 text-xl font-semibold text-slate-950 dark:text-white">
                Add derived columns with DuckDB expressions and window functions
              </h3>
              <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">
                Preview the generated column before replacing the table with the enriched projection.
              </p>
            </div>

            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              <div>
                <label className="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
                  Operation
                </label>
                <select
                  value={operation}
                  onChange={(event) =>
                    startTransition(() => setOperation(event.target.value as OperationKind))
                  }
                  className={FIELD_CLASS}
                >
                  <option value="date_parts">Date parts</option>
                  <option value="string_ops">String operations</option>
                  <option value="binning">Binning</option>
                  <option value="ranking">Ranking</option>
                  <option value="lag_lead">Lag / lead</option>
                  <option value="running">Running aggregates</option>
                </select>
              </div>

              <div>
                <label className="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
                  Source column
                </label>
                <select
                  value={safeSource}
                  onChange={(event) =>
                    startTransition(() => setSourceColumn(event.target.value))
                  }
                  className={FIELD_CLASS}
                >
                  {sourceCandidates.map((column) => (
                    <option key={column} value={column}>
                      {column}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
                  New column
                </label>
                <input
                  value={safeNewColumnName}
                  onChange={(event) => setNewColumnName(event.target.value)}
                  className={FIELD_CLASS}
                />
              </div>
            </div>

            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {operation === "date_parts" ? (
                <div>
                  <label className="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
                    Date part
                  </label>
                  <select
                    value={datePartMode}
                    onChange={(event) =>
                      startTransition(() => setDatePartMode(event.target.value as DatePartMode))
                    }
                    className={FIELD_CLASS}
                  >
                    <option value="year">Year</option>
                    <option value="month">Month</option>
                    <option value="day">Day</option>
                    <option value="weekday">Weekday</option>
                  </select>
                </div>
              ) : null}

              {operation === "string_ops" ? (
                <div>
                  <label className="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
                    String mode
                  </label>
                  <select
                    value={stringMode}
                    onChange={(event) =>
                      startTransition(() => setStringMode(event.target.value as StringMode))
                    }
                    className={FIELD_CLASS}
                  >
                    <option value="initials">Initials</option>
                    <option value="word_count">Word count</option>
                    <option value="domain">Domain extraction</option>
                  </select>
                </div>
              ) : null}

              {operation === "binning" ? (
                <>
                  <div>
                    <label className="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
                      Binning mode
                    </label>
                    <select
                      value={binningMode}
                      onChange={(event) =>
                        startTransition(() => setBinningMode(event.target.value as BinningMode))
                      }
                      className={FIELD_CLASS}
                    >
                      <option value="equal_width">Equal width</option>
                      <option value="equal_frequency">Equal frequency</option>
                      <option value="custom">Custom breakpoints</option>
                    </select>
                  </div>
                  <label className="rounded-2xl border border-white/15 bg-white/45 px-4 py-3 dark:bg-slate-950/35">
                    <div className="flex items-center justify-between text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
                      <span>Bin count</span>
                      <span>{binCount}</span>
                    </div>
                    <input
                      type="range"
                      min={2}
                      max={12}
                      value={binCount}
                      onChange={(event) => setBinCount(Number(event.target.value))}
                      className="mt-3 h-2 w-full accent-cyan-500"
                    />
                  </label>
                  {binningMode === "custom" ? (
                    <div className="md:col-span-2 xl:col-span-1">
                      <label className="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
                        Breakpoints
                      </label>
                      <input
                        value={customBreakpoints}
                        onChange={(event) => setCustomBreakpoints(event.target.value)}
                        className={FIELD_CLASS}
                        placeholder="10,25,50,100"
                      />
                    </div>
                  ) : null}
                </>
              ) : null}

              {operation === "ranking" ? (
                <>
                  <div>
                    <label className="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
                      Ranking mode
                    </label>
                    <select
                      value={rankingMode}
                      onChange={(event) =>
                        startTransition(() => setRankingMode(event.target.value as RankingMode))
                      }
                      className={FIELD_CLASS}
                    >
                      <option value="rank">rank</option>
                      <option value="dense_rank">dense_rank</option>
                      <option value="row_number">row_number</option>
                      <option value="percent_rank">percent_rank</option>
                    </select>
                  </div>
                  <div>
                    <label className="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
                      Sort direction
                    </label>
                    <select
                      value={orderDirection}
                      onChange={(event) =>
                        startTransition(() => setOrderDirection(event.target.value as SortDirection))
                      }
                      className={FIELD_CLASS}
                    >
                      <option value="desc">Descending</option>
                      <option value="asc">Ascending</option>
                    </select>
                  </div>
                </>
              ) : null}

              {operation === "lag_lead" || operation === "running" ? (
                <>
                  <div>
                    <label className="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
                      Order column
                    </label>
                    <select
                      value={safeOrder}
                      onChange={(event) =>
                        startTransition(() => setOrderColumn(event.target.value))
                      }
                      className={FIELD_CLASS}
                    >
                      {columnNames.map((column) => (
                        <option key={column} value={column}>
                          {column}
                        </option>
                      ))}
                    </select>
                  </div>

                  {operation === "lag_lead" ? (
                    <>
                      <div>
                        <label className="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
                          Mode
                        </label>
                        <select
                          value={lagLeadMode}
                          onChange={(event) =>
                            startTransition(() => setLagLeadMode(event.target.value as LagLeadMode))
                          }
                          className={FIELD_CLASS}
                        >
                          <option value="lag">Previous value</option>
                          <option value="lead">Next value</option>
                        </select>
                      </div>
                      <label className="rounded-2xl border border-white/15 bg-white/45 px-4 py-3 dark:bg-slate-950/35">
                        <div className="flex items-center justify-between text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
                          <span>Offset</span>
                          <span>{offset}</span>
                        </div>
                        <input
                          type="range"
                          min={1}
                          max={5}
                          value={offset}
                          onChange={(event) => setOffset(Number(event.target.value))}
                          className="mt-3 h-2 w-full accent-cyan-500"
                        />
                      </label>
                    </>
                  ) : (
                    <div>
                      <label className="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
                        Aggregate
                      </label>
                      <select
                        value={runningMode}
                        onChange={(event) =>
                          startTransition(() => setRunningMode(event.target.value as RunningMode))
                        }
                        className={FIELD_CLASS}
                      >
                        <option value="sum">Running sum</option>
                        <option value="avg">Running average</option>
                        <option value="count">Running count</option>
                      </select>
                    </div>
                  )}
                </>
              ) : null}

              {(operation === "ranking" || operation === "lag_lead" || operation === "running") ? (
                <div>
                  <label className="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
                    Partition by
                  </label>
                  <select
                    value={safePartition}
                    onChange={(event) =>
                      startTransition(() => setPartitionBy(event.target.value))
                    }
                    className={FIELD_CLASS}
                  >
                    <option value="">No partition</option>
                    {columnNames.map((column) => (
                      <option key={column} value={column}>
                        {column}
                      </option>
                    ))}
                  </select>
                </div>
              ) : null}
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-1">
            <div className="rounded-3xl border border-white/15 bg-white/45 p-4 dark:bg-slate-950/35">
              <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
                <Columns3 className="h-3.5 w-3.5" />
                Target column
              </div>
              <div className="mt-3 text-lg font-semibold text-slate-950 dark:text-white">
                {spec.newColumnName}
              </div>
            </div>
            <div className="rounded-3xl border border-white/15 bg-white/45 p-4 dark:bg-slate-950/35">
              <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
                <Split className="h-3.5 w-3.5" />
                Operation type
              </div>
              <div className="mt-3 text-lg font-semibold capitalize text-slate-950 dark:text-white">
                {operation.replaceAll("_", " ")}
              </div>
            </div>
            <div className="rounded-3xl border border-white/15 bg-white/45 p-4 dark:bg-slate-950/35">
              <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
                <Waves className="h-3.5 w-3.5" />
                Preview columns
              </div>
              <div className="mt-3 text-sm text-slate-700 dark:text-slate-200">
                {spec.previewColumns.join(", ") || "Generated only"}
              </div>
            </div>
            <div className="rounded-3xl border border-white/15 bg-white/45 p-4 dark:bg-slate-950/35">
              <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
                <TimerReset className="h-3.5 w-3.5" />
                Input columns
              </div>
              <div className="mt-3 text-2xl font-semibold text-slate-950 dark:text-white">
                {formatNumber(spec.previewColumns.length)}
              </div>
            </div>
          </div>
        </div>
      </motion.section>

      {notice ? (
        <div className="rounded-3xl border border-cyan-400/30 bg-cyan-500/10 px-4 py-3 text-sm text-cyan-700 dark:text-cyan-300">
          {notice}
        </div>
      ) : null}

      <motion.section
        initial={{ opacity: 0, y: 18 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, ease: EASE }}
        className={`${PANEL_CLASS} p-5`}
      >
        <div className="mb-4 flex items-center justify-between gap-3">
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
              Preview before apply
            </div>
            <div className="mt-1 text-sm text-slate-600 dark:text-slate-300">
              The same generated SQL powers both the preview and the final table replacement.
            </div>
          </div>

          <button
            type="button"
            disabled={busy}
            onClick={() => void handleApply()}
            className="rounded-2xl border border-white/20 bg-white/55 px-3 py-2 text-sm text-slate-600 transition hover:border-cyan-300/40 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-slate-950/35 dark:text-slate-200"
          >
            <span className="flex items-center gap-2">
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
              Apply enrichment
            </span>
          </button>
        </div>

        <Suspense fallback={<PreviewLoading />}>
          <PreviewPanel tableName={tableName} spec={spec} />
        </Suspense>
      </motion.section>
    </div>
  );
}
