"use client";

import { quoteIdentifier } from "@/lib/utils/sql";
import { Suspense, startTransition, use, useMemo, useState } from "react";
import { motion } from "framer-motion";
import {
  ArrowLeftRight,
  Columns2,
  Eraser,
  GitBranchPlus,
  History,
  Loader2,
  Regex,
  RotateCcw,
  ScissorsLineDashed,
  Sparkles,
  WandSparkles,
} from "lucide-react";
import { getTableRowCount, runQuery } from "@/lib/duckdb/client";
import { profileTable } from "@/lib/duckdb/profiler";
import { appendLineageEvent } from "@/components/data/data-lineage-graph";
import { formatNumber, generateId } from "@/lib/utils/formatters";
import type { ColumnProfile } from "@/types/dataset";

interface DataWranglerProps {
  tableName: string;
  columns: ColumnProfile[];
}

type OperationType = "split" | "merge" | "fill" | "dates" | "regex" | "trim" | "dedupe";
type FillStrategy = "constant" | "mean" | "median" | "forward-fill" | "backward-fill";
type StatusState =
  | {
      tone: "success" | "error" | "info";
      message: string;
    }
  | null;

interface SplitFormState {
  column: string;
  delimiter: string;
  parts: number;
  prefix: string;
}

interface MergeFormState {
  columns: string[];
  separator: string;
  output: string;
}

interface FillFormState {
  column: string;
  strategy: FillStrategy;
  constantValue: string;
}

interface DateFormState {
  column: string;
  format: string;
  output: string;
}

interface RegexFormState {
  column: string;
  pattern: string;
  groupNames: string;
}

interface TrimFormState {
  columns: string[];
}

interface DedupeFormState {
  columns: string[];
}

interface BuiltOperation {
  operation: OperationType;
  label: string;
  selectSql: string;
  applySql: string;
}

interface PreviewRequest extends BuiltOperation {
  requestId: string;
}

interface PreviewResult {
  beforeRows: Record<string, unknown>[];
  afterRows: Record<string, unknown>[];
  beforeCount: number;
  afterCount: number;
}

interface HistoryEntry {
  id: string;
  operation: OperationType;
  label: string;
  sql: string;
  backupTable: string;
  beforeCount: number;
  afterCount: number;
  timestamp: number;
  status: "applied" | "undone";
}

const EASE = [0.22, 1, 0.36, 1] as const;
const PANEL_CLASS =
  "rounded-[1.85rem] border border-white/15 bg-white/60 shadow-[0_24px_90px_-46px_rgba(15,23,42,0.78)] backdrop-blur-2xl dark:border-white/10 dark:bg-slate-950/45";
const FIELD_CLASS =
  "w-full rounded-2xl border border-white/15 bg-white/75 px-4 py-3 text-sm text-slate-700 outline-none transition focus:border-cyan-400 focus:ring-4 focus:ring-cyan-500/10 dark:border-white/10 dark:bg-slate-950/45 dark:text-slate-100";

const TAB_META: Array<{
  key: OperationType;
  label: string;
  Icon: typeof ScissorsLineDashed;
}> = [
  { key: "split", label: "Split column", Icon: ScissorsLineDashed },
  { key: "merge", label: "Merge columns", Icon: Columns2 },
  { key: "fill", label: "Fill nulls", Icon: WandSparkles },
  { key: "dates", label: "Parse dates", Icon: Sparkles },
  { key: "regex", label: "Regex extract", Icon: Regex },
  { key: "trim", label: "Trim whitespace", Icon: Eraser },
  { key: "dedupe", label: "Remove duplicates", Icon: GitBranchPlus },
] as const;
function quoteLiteral(value: string) {
  return `'${value.replaceAll("'", "''")}'`;
}

function getTextColumns(columns: ColumnProfile[]) {
  return columns.filter((column) => column.type === "string" || column.type === "unknown");
}

function getNumericColumns(columns: ColumnProfile[]) {
  return columns.filter((column) => column.type === "number");
}

function buildSelectList(columns: ColumnProfile[]) {
  return columns.map((column) => quoteIdentifier(column.name)).join(", ");
}

function buildReplacementSelect(
  columns: ColumnProfile[],
  replacements: Record<string, string>,
) {
  return columns
    .map((column) => `${replacements[column.name] ?? quoteIdentifier(column.name)} AS ${quoteIdentifier(column.name)}`)
    .join(", ");
}

function normalizeOutputName(value: string) {
  return value
    .trim()
    .replace(/[^a-zA-Z0-9_]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function ensureUniqueNewColumns(
  existingColumns: ColumnProfile[],
  names: string[],
) {
  const normalized = names.map(normalizeOutputName).filter(Boolean);
  if (normalized.length !== names.length) {
    return null;
  }

  if (new Set(normalized).size !== normalized.length) {
    return null;
  }

  if (normalized.some((name) => existingColumns.some((column) => column.name === name))) {
    return null;
  }

  return normalized;
}

function literalForColumn(column: ColumnProfile | undefined, value: string) {
  if (!column) {
    throw new Error("Choose a valid target column.");
  }

  if (column.type === "number") {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) {
      throw new Error("Constant fill for numeric columns requires a valid number.");
    }
    return String(numeric);
  }

  if (column.type === "boolean") {
    const normalized = value.trim().toLowerCase();
    if (["true", "1", "yes"].includes(normalized)) {
      return "TRUE";
    }
    if (["false", "0", "no"].includes(normalized)) {
      return "FALSE";
    }
    throw new Error("Constant fill for boolean columns accepts true/false values.");
  }

  return quoteLiteral(value);
}

function formatTimestamp(timestamp: number) {
  return new Date(timestamp).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

async function loadPreview(
  tableName: string,
  request: PreviewRequest,
): Promise<PreviewResult> {
  const [beforeRows, afterRows, beforeCountRows, afterCountRows] = await Promise.all([
    runQuery(`SELECT * FROM ${quoteIdentifier(tableName)} LIMIT 10`),
    runQuery(`SELECT * FROM (${request.selectSql}) AS preview LIMIT 10`),
    runQuery(`SELECT COUNT(*) AS cnt FROM ${quoteIdentifier(tableName)}`),
    runQuery(`SELECT COUNT(*) AS cnt FROM (${request.selectSql}) AS preview_count`),
  ]);

  return {
    beforeRows,
    afterRows,
    beforeCount: Number(beforeCountRows[0]?.cnt ?? 0),
    afterCount: Number(afterCountRows[0]?.cnt ?? 0),
  };
}

function PreviewTable({
  title,
  rows,
}: {
  title: string;
  rows: Record<string, unknown>[];
}) {
  const visibleColumns = Array.from(
    rows.reduce((set, row) => {
      Object.keys(row).forEach((key) => set.add(key));
      return set;
    }, new Set<string>()),
  );

  return (
    <div className="overflow-hidden rounded-[1.2rem] border border-white/10 bg-white/40 dark:bg-slate-950/35">
      <div className="border-b border-white/10 px-4 py-3 text-sm font-semibold text-slate-950 dark:text-white">
        {title}
      </div>
      <div className="overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead className="bg-white/70 dark:bg-slate-950/65">
            <tr>
              {visibleColumns.map((column) => (
                <th key={column} className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">
                  {column}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => (
              <tr key={`${title}:${index}`} className={index % 2 === 0 ? "bg-white/10" : "bg-slate-100/20 dark:bg-slate-900/18"}>
                {visibleColumns.map((column) => (
                  <td key={`${title}:${index}:${column}`} className="max-w-[16rem] px-4 py-3 text-slate-700 dark:text-slate-200">
                    {row[column] == null ? (
                      <span className="rounded-full border border-rose-400/30 bg-rose-500/10 px-2 py-0.5 text-xs font-semibold text-rose-700 dark:text-rose-300">
                        null
                      </span>
                    ) : (
                      <span className="line-clamp-2 break-words">{String(row[column])}</span>
                    )}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function PreviewContent({
  tableName,
  request,
}: {
  tableName: string;
  request: PreviewRequest;
}) {
  const previewPromise = useMemo(
    () => loadPreview(tableName, request),
    [request, tableName],
  );
  const preview = use(previewPromise);

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="rounded-2xl border border-white/10 bg-white/40 px-4 py-3 dark:bg-slate-950/35">
          <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
            Before
          </div>
          <div className="mt-2 text-2xl font-semibold text-slate-950 dark:text-white">
            {formatNumber(preview.beforeCount)}
          </div>
        </div>
        <div className="rounded-2xl border border-white/10 bg-white/40 px-4 py-3 dark:bg-slate-950/35">
          <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
            After
          </div>
          <div className="mt-2 text-2xl font-semibold text-slate-950 dark:text-white">
            {formatNumber(preview.afterCount)}
          </div>
        </div>
      </div>
      <div className="grid gap-4 xl:grid-cols-2">
        <PreviewTable title="Before preview" rows={preview.beforeRows} />
        <PreviewTable title="After preview" rows={preview.afterRows} />
      </div>
    </div>
  );
}

function PreviewFallback() {
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="h-20 animate-pulse rounded-2xl bg-white/35 dark:bg-slate-800/55" />
        <div className="h-20 animate-pulse rounded-2xl bg-white/35 dark:bg-slate-800/55" />
      </div>
      <div className="grid gap-4 xl:grid-cols-2">
        <div className="h-64 animate-pulse rounded-[1.2rem] bg-white/30 dark:bg-slate-800/50" />
        <div className="h-64 animate-pulse rounded-[1.2rem] bg-white/30 dark:bg-slate-800/50" />
      </div>
    </div>
  );
}

function OperationToggle({
  active,
  label,
  Icon,
  onClick,
}: {
  active: boolean;
  label: string;
  Icon: typeof ScissorsLineDashed;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex items-center gap-2 rounded-2xl border px-3 py-2 text-sm transition ${
        active
          ? "border-cyan-400/45 bg-cyan-500/12 text-cyan-700 dark:text-cyan-200"
          : "border-white/12 bg-white/35 text-slate-600 hover:border-cyan-300/28 dark:border-white/10 dark:bg-slate-950/30 dark:text-slate-300"
      }`}
    >
      <Icon className="h-4 w-4" />
      {label}
    </button>
  );
}

function MultiColumnPicker({
  columns,
  selected,
  onToggle,
}: {
  columns: ColumnProfile[];
  selected: string[];
  onToggle: (columnName: string) => void;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {columns.map((column) => {
        const active = selected.includes(column.name);
        return (
          <button
            key={column.name}
            type="button"
            onClick={() => onToggle(column.name)}
            className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition ${
              active
                ? "border-cyan-400/45 bg-cyan-500/12 text-cyan-700 dark:text-cyan-200"
                : "border-white/12 bg-white/35 text-slate-600 hover:border-cyan-300/28 dark:border-white/10 dark:bg-slate-950/30 dark:text-slate-300"
            }`}
          >
            {column.name}
          </button>
        );
      })}
    </div>
  );
}

export default function DataWrangler({ tableName, columns }: DataWranglerProps) {
  const [workingColumns, setWorkingColumns] = useState(columns);
  const textColumns = getTextColumns(workingColumns);
  const numericColumns = getNumericColumns(workingColumns);

  const [activeTab, setActiveTab] = useState<OperationType>("split");
  const [previewRequest, setPreviewRequest] = useState<PreviewRequest | null>(null);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [status, setStatus] = useState<StatusState>(null);
  const [busy, setBusy] = useState(false);

  const [splitForm, setSplitForm] = useState<SplitFormState>({
    column: textColumns[0]?.name ?? "",
    delimiter: ",",
    parts: 2,
    prefix: `${textColumns[0]?.name ?? "part"}_split`,
  });
  const [mergeForm, setMergeForm] = useState<MergeFormState>({
    columns: workingColumns.slice(0, 2).map((column) => column.name),
    separator: " ",
    output: "merged_column",
  });
  const [fillForm, setFillForm] = useState<FillFormState>({
    column: workingColumns[0]?.name ?? "",
    strategy: "constant",
    constantValue: "",
  });
  const [dateForm, setDateForm] = useState<DateFormState>({
    column: textColumns[0]?.name ?? "",
    format: "%Y-%m-%d",
    output: `${textColumns[0]?.name ?? "date"}_parsed`,
  });
  const [regexForm, setRegexForm] = useState<RegexFormState>({
    column: textColumns[0]?.name ?? "",
    pattern: "",
    groupNames: "group_1",
  });
  const [trimForm, setTrimForm] = useState<TrimFormState>({
    columns: textColumns.map((column) => column.name),
  });
  const [dedupeForm, setDedupeForm] = useState<DedupeFormState>({
    columns: workingColumns.map((column) => column.name),
  });

  const latestUndoableEntry = history.find((entry) => entry.status === "applied") ?? null;

  function validateOutputName(name: string) {
    const normalized = normalizeOutputName(name);
    if (!normalized) {
      return null;
    }

    const exists = workingColumns.some((column) => column.name === normalized);
    return exists ? null : normalized;
  }

  function buildOperation(): BuiltOperation {
    const safeTable = quoteIdentifier(tableName);
    const selectList = buildSelectList(workingColumns);

    switch (activeTab) {
      case "split": {
        if (!splitForm.column || splitForm.parts < 2) {
          throw new Error("Choose a text column and at least two output parts.");
        }

        const outputPrefix = normalizeOutputName(splitForm.prefix);
        const splitOutputs = ensureUniqueNewColumns(
          workingColumns,
          Array.from({ length: splitForm.parts }, (_, index) => `${outputPrefix}_${index + 1}`),
        );
        if (!outputPrefix || !splitOutputs) {
          throw new Error("Use a unique output prefix for the split columns.");
        }

        const sourceColumn = quoteIdentifier(splitForm.column);
        const additions = splitOutputs.map((output, index) => {
          return `split_part(CAST(${sourceColumn} AS VARCHAR), ${quoteLiteral(splitForm.delimiter)}, ${index + 1}) AS ${quoteIdentifier(output)}`;
        }).join(", ");
        const selectSql = `SELECT ${selectList}, ${additions} FROM ${safeTable}`;
        return {
          operation: "split",
          label: `Split ${splitForm.column} by "${splitForm.delimiter}"`,
          selectSql,
          applySql: `CREATE OR REPLACE TABLE ${safeTable} AS ${selectSql}`,
        };
      }
      case "merge": {
        if (mergeForm.columns.length < 2) {
          throw new Error("Pick at least two columns to merge.");
        }

        const outputName = validateOutputName(mergeForm.output);
        if (!outputName) {
          throw new Error("Use a unique output name for the merged column.");
        }

        const expression = `concat_ws(${quoteLiteral(mergeForm.separator)}, ${mergeForm.columns
          .map((column) => `NULLIF(CAST(${quoteIdentifier(column)} AS VARCHAR), '')`)
          .join(", ")})`;
        const selectSql = `SELECT ${selectList}, ${expression} AS ${quoteIdentifier(outputName)} FROM ${safeTable}`;
        return {
          operation: "merge",
          label: `Merge ${mergeForm.columns.join(", ")} into ${outputName}`,
          selectSql,
          applySql: `CREATE OR REPLACE TABLE ${safeTable} AS ${selectSql}`,
        };
      }
      case "fill": {
        if (!fillForm.column) {
          throw new Error("Choose a target column to fill.");
        }

        const safeColumn = quoteIdentifier(fillForm.column);
        if (fillForm.strategy === "constant") {
          const replacement = `COALESCE(${safeColumn}, ${literalForColumn(workingColumns.find((column) => column.name === fillForm.column), fillForm.constantValue)})`;
          const selectSql = `SELECT ${buildReplacementSelect(workingColumns, { [fillForm.column]: replacement })} FROM ${safeTable}`;
          return {
            operation: "fill",
            label: `Fill nulls in ${fillForm.column} with a constant`,
            selectSql,
            applySql: `CREATE OR REPLACE TABLE ${safeTable} AS ${selectSql}`,
          };
        }

        if (fillForm.strategy === "mean" || fillForm.strategy === "median") {
          if (!numericColumns.some((column) => column.name === fillForm.column)) {
            throw new Error("Mean and median fill require a numeric column.");
          }

          const aggregate = fillForm.strategy === "mean" ? "AVG" : "MEDIAN";
          const expression = `COALESCE(TRY_CAST(${safeColumn} AS DOUBLE), stats.fill_value)`;
          const selectSql = `
            WITH stats AS (
              SELECT ${aggregate}(TRY_CAST(${safeColumn} AS DOUBLE)) AS fill_value
              FROM ${safeTable}
            )
            SELECT ${buildReplacementSelect(workingColumns, { [fillForm.column]: expression })}
            FROM ${safeTable}, stats
          `;
          return {
            operation: "fill",
            label: `Fill nulls in ${fillForm.column} with ${fillForm.strategy}`,
            selectSql,
            applySql: `CREATE OR REPLACE TABLE ${safeTable} AS ${selectSql}`,
          };
        }

        const orderedColumnSelect = workingColumns
          .map((column) => quoteIdentifier(column.name))
          .join(", ");
        const fillExpression =
          fillForm.strategy === "forward-fill"
            ? `COALESCE(${safeColumn}, LAST_VALUE(${safeColumn} IGNORE NULLS) OVER (ORDER BY __row_id ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW))`
            : `COALESCE(${safeColumn}, FIRST_VALUE(${safeColumn} IGNORE NULLS) OVER (ORDER BY __row_id DESC ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW))`;
        const selectSql = `
          WITH ordered AS (
            SELECT ${orderedColumnSelect}, ROW_NUMBER() OVER () AS __row_id
            FROM ${safeTable}
          )
          SELECT ${buildReplacementSelect(workingColumns, { [fillForm.column]: fillExpression })}
          FROM ordered
        `;
        return {
          operation: "fill",
          label: `${fillForm.strategy === "forward-fill" ? "Forward fill" : "Backward fill"} ${fillForm.column}`,
          selectSql,
          applySql: `CREATE OR REPLACE TABLE ${safeTable} AS ${selectSql}`,
        };
      }
      case "dates": {
        if (!dateForm.column) {
          throw new Error("Choose a source column to parse.");
        }

        const outputName = validateOutputName(dateForm.output);
        if (!outputName) {
          throw new Error("Use a unique output column name for parsed dates.");
        }

        const expression = `CAST(try_strptime(CAST(${quoteIdentifier(dateForm.column)} AS VARCHAR), ${quoteLiteral(dateForm.format)}) AS DATE)`;
        const selectSql = `SELECT ${selectList}, ${expression} AS ${quoteIdentifier(outputName)} FROM ${safeTable}`;
        return {
          operation: "dates",
          label: `Parse ${dateForm.column} into ${outputName}`,
          selectSql,
          applySql: `CREATE OR REPLACE TABLE ${safeTable} AS ${selectSql}`,
        };
      }
      case "regex": {
        if (!regexForm.column || !regexForm.pattern.trim()) {
          throw new Error("Choose a text column and provide a regex pattern.");
        }

        const groupNames = regexForm.groupNames
          .split(",")
          .map((name) => name.trim());
        const outputNames = ensureUniqueNewColumns(workingColumns, groupNames);

        if (!outputNames || outputNames.length === 0) {
          throw new Error("Provide at least one output group name.");
        }

        const additions = outputNames
          .map(
            (groupName, index) =>
              `NULLIF(regexp_extract(CAST(${quoteIdentifier(regexForm.column)} AS VARCHAR), ${quoteLiteral(regexForm.pattern)}, ${index + 1}), '') AS ${quoteIdentifier(groupName)}`,
          )
          .join(", ");
        const selectSql = `SELECT ${selectList}, ${additions} FROM ${safeTable}`;
        return {
          operation: "regex",
          label: `Extract regex groups from ${regexForm.column}`,
          selectSql,
          applySql: `CREATE OR REPLACE TABLE ${safeTable} AS ${selectSql}`,
        };
      }
      case "trim": {
        if (trimForm.columns.length === 0) {
          throw new Error("Choose at least one text column to trim.");
        }

        const replacements = Object.fromEntries(
          trimForm.columns.map((columnName) => [
            columnName,
            `CASE WHEN ${quoteIdentifier(columnName)} IS NULL THEN NULL ELSE TRIM(CAST(${quoteIdentifier(columnName)} AS VARCHAR)) END`,
          ]),
        );
        const selectSql = `SELECT ${buildReplacementSelect(workingColumns, replacements)} FROM ${safeTable}`;
        return {
          operation: "trim",
          label: `Trim whitespace in ${trimForm.columns.join(", ")}`,
          selectSql,
          applySql: `CREATE OR REPLACE TABLE ${safeTable} AS ${selectSql}`,
        };
      }
      case "dedupe": {
        const selectedColumns = dedupeForm.columns.length > 0
          ? dedupeForm.columns
          : workingColumns.map((column) => column.name);

        const baseColumnList = buildSelectList(workingColumns);
        const partitionBy = selectedColumns.map((column) => quoteIdentifier(column)).join(", ");
        const selectSql = `
          WITH ranked AS (
            SELECT ${baseColumnList}, ROW_NUMBER() OVER () AS __row_id
            FROM ${safeTable}
          ),
          marked AS (
            SELECT ${baseColumnList},
              ROW_NUMBER() OVER (PARTITION BY ${partitionBy} ORDER BY __row_id) AS __duplicate_rank
            FROM ranked
          )
          SELECT ${baseColumnList}
          FROM marked
          WHERE __duplicate_rank = 1
        `;
        return {
          operation: "dedupe",
          label: `Remove duplicates using ${selectedColumns.join(", ")}`,
          selectSql,
          applySql: `CREATE OR REPLACE TABLE ${safeTable} AS ${selectSql}`,
        };
      }
    }
  }

  function queuePreview() {
    try {
      const built = buildOperation();
      setPreviewRequest({
        ...built,
        requestId: generateId(),
      });
      setStatus(null);
    } catch (error) {
      setStatus({
        tone: "error",
        message: error instanceof Error ? error.message : "Preview could not be created.",
      });
    }
  }

  async function refreshProfiles() {
    const nextProfiles = await profileTable(tableName);
    startTransition(() => {
      setWorkingColumns(nextProfiles);
    });
  }

  async function applyOperation() {
    let built: BuiltOperation;
    try {
      built = buildOperation();
    } catch (error) {
      setStatus({
        tone: "error",
        message: error instanceof Error ? error.message : "Operation is not valid.",
      });
      return;
    }

    setBusy(true);
    setStatus(null);
    const historyId = generateId();
    const backupTableName = `${tableName}__wrangler_backup_${historyId}`;
    const safeBackup = quoteIdentifier(backupTableName);
    const safeTable = quoteIdentifier(tableName);

    try {
      const beforeCount = await getTableRowCount(tableName);
      await runQuery(`DROP TABLE IF EXISTS ${safeBackup}`);
      await runQuery(`CREATE TABLE ${safeBackup} AS SELECT * FROM ${safeTable}`);
      await runQuery(built.applySql);
      const afterCount = await getTableRowCount(tableName);
      await refreshProfiles();

      const entry: HistoryEntry = {
        id: historyId,
        operation: built.operation,
        label: built.label,
        sql: built.applySql,
        backupTable: backupTableName,
        beforeCount,
        afterCount,
        timestamp: Date.now(),
        status: "applied",
      };

      appendLineageEvent(tableName, {
        type: "transform",
        label: built.label,
        description: built.label,
        sql: built.applySql,
        rowsBefore: beforeCount,
        rowsAfter: afterCount,
        metadata: { operation: built.operation },
      });

      startTransition(() => {
        setHistory((current) => [entry, ...current]);
        setPreviewRequest({
          ...built,
          requestId: generateId(),
        });
        setStatus({
          tone: "success",
          message: `${built.label} applied to ${tableName}.`,
        });
      });
    } catch (error) {
      setStatus({
        tone: "error",
        message: error instanceof Error ? error.message : "DuckDB rejected the transformation.",
      });
    } finally {
      setBusy(false);
    }
  }

  async function undoLatest() {
    if (!latestUndoableEntry) {
      return;
    }

    setBusy(true);
    setStatus(null);

    try {
      const beforeCount = await getTableRowCount(tableName);
      await runQuery(
        `CREATE OR REPLACE TABLE ${quoteIdentifier(tableName)} AS SELECT * FROM ${quoteIdentifier(latestUndoableEntry.backupTable)}`,
      );
      const afterCount = await getTableRowCount(tableName);
      await refreshProfiles();

      appendLineageEvent(tableName, {
        type: "transform",
        label: `Undo ${latestUndoableEntry.label}`,
        description: `Undo ${latestUndoableEntry.label}`,
        sql: `CREATE OR REPLACE TABLE ${quoteIdentifier(tableName)} AS SELECT * FROM ${quoteIdentifier(latestUndoableEntry.backupTable)}`,
        rowsBefore: beforeCount,
        rowsAfter: afterCount,
        metadata: { undoOf: latestUndoableEntry.id },
      });

      startTransition(() => {
        setHistory((current) =>
          current.map((entry) =>
            entry.id === latestUndoableEntry.id ? { ...entry, status: "undone" } : entry,
          ),
        );
        setPreviewRequest(null);
        setStatus({
          tone: "success",
          message: `Undid ${latestUndoableEntry.label}.`,
        });
      });
    } catch (error) {
      setStatus({
        tone: "error",
        message: error instanceof Error ? error.message : "Undo failed.",
      });
    } finally {
      setBusy(false);
    }
  }

  function toggleMultiSelect<K extends { columns: string[] }>(
    state: K,
    setter: (updater: (current: K) => K) => void,
    columnName: string,
  ) {
    setter((current) => ({
      ...current,
      columns: current.columns.includes(columnName)
        ? current.columns.filter((entry) => entry !== columnName)
        : [...current.columns, columnName],
    }));
  }

  return (
    <section className={`${PANEL_CLASS} p-6`}>
      <div className="flex flex-col gap-4 border-b border-white/10 pb-5 lg:flex-row lg:items-start lg:justify-between">
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-cyan-600 dark:text-cyan-300">
            <ArrowLeftRight className="h-3.5 w-3.5" />
            SQL-backed cleaning
          </div>
          <h2 className="text-xl font-semibold text-slate-950 dark:text-white">Data wrangler</h2>
          <p className="max-w-3xl text-sm text-slate-600 dark:text-slate-300">
            Chain DuckDB-powered column transforms, preview the first ten rows before committing, and undo the latest applied step when needed.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <div className="rounded-2xl border border-white/15 bg-white/45 px-4 py-3 dark:border-white/10 dark:bg-slate-950/35">
            <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
              Columns
            </div>
            <div className="mt-1 text-xl font-semibold text-slate-950 dark:text-white">
              {formatNumber(workingColumns.length)}
            </div>
          </div>
          <button
            type="button"
            onClick={undoLatest}
            disabled={!latestUndoableEntry || busy}
            className="inline-flex items-center gap-2 rounded-2xl border border-white/15 bg-white/50 px-4 py-3 text-sm font-semibold text-slate-700 transition hover:border-cyan-300/30 disabled:cursor-not-allowed disabled:opacity-45 dark:border-white/10 dark:bg-slate-950/35 dark:text-slate-100"
          >
            <RotateCcw className="h-4 w-4" />
            Undo latest
          </button>
        </div>
      </div>

      <div className="mt-5 flex flex-wrap gap-2">
        {TAB_META.map(({ key, label, Icon }) => (
          <OperationToggle
            key={key}
            active={activeTab === key}
            label={label}
            Icon={Icon}
            onClick={() => setActiveTab(key)}
          />
        ))}
      </div>

      {status ? (
        <div
          className={`mt-5 rounded-2xl border px-4 py-3 text-sm ${
            status.tone === "error"
              ? "border-rose-400/35 bg-rose-500/10 text-rose-700 dark:text-rose-300"
              : status.tone === "success"
                ? "border-emerald-400/35 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
                : "border-cyan-400/35 bg-cyan-500/10 text-cyan-700 dark:text-cyan-300"
          }`}
        >
          {status.message}
        </div>
      ) : null}

      <div className="mt-5 grid gap-6 xl:grid-cols-[0.9fr_1.1fr]">
        <div className="space-y-6">
          <div className="rounded-[1.35rem] border border-white/12 bg-white/45 p-5 backdrop-blur-xl dark:border-white/10 dark:bg-slate-950/35">
            <div className="mb-4 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
              <Sparkles className="h-3.5 w-3.5" />
              Operation builder
            </div>

            {activeTab === "split" ? (
              <div className="space-y-4">
                <div>
                  <label className="mb-2 block text-xs font-semibold uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">
                    Source column
                  </label>
                  <select
                    value={splitForm.column}
                    onChange={(event) =>
                      setSplitForm((current) => ({
                        ...current,
                        column: event.target.value,
                        prefix: `${event.target.value || "part"}_split`,
                      }))
                    }
                    className={FIELD_CLASS}
                  >
                    {textColumns.map((column) => (
                      <option key={column.name} value={column.name}>
                        {column.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div>
                    <label className="mb-2 block text-xs font-semibold uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">
                      Delimiter
                    </label>
                    <input
                      value={splitForm.delimiter}
                      onChange={(event) => setSplitForm((current) => ({ ...current, delimiter: event.target.value }))}
                      className={FIELD_CLASS}
                    />
                  </div>
                  <div>
                    <label className="mb-2 block text-xs font-semibold uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">
                      Parts
                    </label>
                    <input
                      type="number"
                      min={2}
                      max={6}
                      value={splitForm.parts}
                      onChange={(event) => setSplitForm((current) => ({ ...current, parts: Number(event.target.value) }))}
                      className={FIELD_CLASS}
                    />
                  </div>
                </div>
                <div>
                  <label className="mb-2 block text-xs font-semibold uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">
                    Output prefix
                  </label>
                  <input
                    value={splitForm.prefix}
                    onChange={(event) => setSplitForm((current) => ({ ...current, prefix: event.target.value }))}
                    className={FIELD_CLASS}
                  />
                </div>
              </div>
            ) : null}

            {activeTab === "merge" ? (
              <div className="space-y-4">
                <div>
                  <label className="mb-2 block text-xs font-semibold uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">
                    Columns to merge
                  </label>
                  <MultiColumnPicker
                    columns={workingColumns}
                    selected={mergeForm.columns}
                    onToggle={(columnName) =>
                      toggleMultiSelect(mergeForm, (updater) => setMergeForm(updater), columnName)
                    }
                  />
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div>
                    <label className="mb-2 block text-xs font-semibold uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">
                      Separator
                    </label>
                    <input
                      value={mergeForm.separator}
                      onChange={(event) => setMergeForm((current) => ({ ...current, separator: event.target.value }))}
                      className={FIELD_CLASS}
                    />
                  </div>
                  <div>
                    <label className="mb-2 block text-xs font-semibold uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">
                      Output column
                    </label>
                    <input
                      value={mergeForm.output}
                      onChange={(event) => setMergeForm((current) => ({ ...current, output: event.target.value }))}
                      className={FIELD_CLASS}
                    />
                  </div>
                </div>
              </div>
            ) : null}

            {activeTab === "fill" ? (
              <div className="space-y-4">
                <div>
                  <label className="mb-2 block text-xs font-semibold uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">
                    Target column
                  </label>
                  <select
                    value={fillForm.column}
                    onChange={(event) => setFillForm((current) => ({ ...current, column: event.target.value }))}
                    className={FIELD_CLASS}
                  >
                    {workingColumns.map((column) => (
                      <option key={column.name} value={column.name}>
                        {column.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="mb-2 block text-xs font-semibold uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">
                    Strategy
                  </label>
                  <select
                    value={fillForm.strategy}
                    onChange={(event) =>
                      setFillForm((current) => ({
                        ...current,
                        strategy: event.target.value as FillStrategy,
                      }))
                    }
                    className={FIELD_CLASS}
                  >
                    <option value="constant">Constant</option>
                    <option value="mean">Mean</option>
                    <option value="median">Median</option>
                    <option value="forward-fill">Forward-fill</option>
                    <option value="backward-fill">Backward-fill</option>
                  </select>
                </div>
                {fillForm.strategy === "constant" ? (
                  <div>
                    <label className="mb-2 block text-xs font-semibold uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">
                      Constant value
                    </label>
                    <input
                      value={fillForm.constantValue}
                      onChange={(event) => setFillForm((current) => ({ ...current, constantValue: event.target.value }))}
                      className={FIELD_CLASS}
                    />
                  </div>
                ) : null}
              </div>
            ) : null}

            {activeTab === "dates" ? (
              <div className="space-y-4">
                <div>
                  <label className="mb-2 block text-xs font-semibold uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">
                    Source column
                  </label>
                  <select
                    value={dateForm.column}
                    onChange={(event) =>
                      setDateForm((current) => ({
                        ...current,
                        column: event.target.value,
                        output: `${event.target.value || "date"}_parsed`,
                      }))
                    }
                    className={FIELD_CLASS}
                  >
                    {textColumns.map((column) => (
                      <option key={column.name} value={column.name}>
                        {column.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div>
                    <label className="mb-2 block text-xs font-semibold uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">
                      Date format
                    </label>
                    <input
                      value={dateForm.format}
                      onChange={(event) => setDateForm((current) => ({ ...current, format: event.target.value }))}
                      className={FIELD_CLASS}
                    />
                  </div>
                  <div>
                    <label className="mb-2 block text-xs font-semibold uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">
                      Output column
                    </label>
                    <input
                      value={dateForm.output}
                      onChange={(event) => setDateForm((current) => ({ ...current, output: event.target.value }))}
                      className={FIELD_CLASS}
                    />
                  </div>
                </div>
              </div>
            ) : null}

            {activeTab === "regex" ? (
              <div className="space-y-4">
                <div>
                  <label className="mb-2 block text-xs font-semibold uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">
                    Source column
                  </label>
                  <select
                    value={regexForm.column}
                    onChange={(event) => setRegexForm((current) => ({ ...current, column: event.target.value }))}
                    className={FIELD_CLASS}
                  >
                    {textColumns.map((column) => (
                      <option key={column.name} value={column.name}>
                        {column.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="mb-2 block text-xs font-semibold uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">
                    Regex pattern
                  </label>
                  <input
                    value={regexForm.pattern}
                    onChange={(event) => setRegexForm((current) => ({ ...current, pattern: event.target.value }))}
                    className={FIELD_CLASS}
                    placeholder="e.g. ^(\\w+)-(\\d+)$"
                  />
                </div>
                <div>
                  <label className="mb-2 block text-xs font-semibold uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">
                    Output group names
                  </label>
                  <input
                    value={regexForm.groupNames}
                    onChange={(event) => setRegexForm((current) => ({ ...current, groupNames: event.target.value }))}
                    className={FIELD_CLASS}
                    placeholder="prefix, sequence"
                  />
                </div>
              </div>
            ) : null}

            {activeTab === "trim" ? (
              <div className="space-y-4">
                <div>
                  <label className="mb-2 block text-xs font-semibold uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">
                    Columns to trim
                  </label>
                  <MultiColumnPicker
                    columns={textColumns}
                    selected={trimForm.columns}
                    onToggle={(columnName) =>
                      toggleMultiSelect(trimForm, (updater) => setTrimForm(updater), columnName)
                    }
                  />
                </div>
              </div>
            ) : null}

            {activeTab === "dedupe" ? (
              <div className="space-y-4">
                <div>
                  <label className="mb-2 block text-xs font-semibold uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">
                    Duplicate keys
                  </label>
                  <MultiColumnPicker
                    columns={workingColumns}
                    selected={dedupeForm.columns}
                    onToggle={(columnName) =>
                      toggleMultiSelect(dedupeForm, (updater) => setDedupeForm(updater), columnName)
                    }
                  />
                </div>
              </div>
            ) : null}

            <div className="mt-6 flex flex-wrap gap-3">
              <button
                type="button"
                onClick={queuePreview}
                className="inline-flex items-center gap-2 rounded-2xl border border-white/15 bg-white/50 px-4 py-3 text-sm font-semibold text-slate-700 transition hover:border-cyan-300/30 dark:border-white/10 dark:bg-slate-950/35 dark:text-slate-100"
              >
                <ScissorsLineDashed className="h-4 w-4" />
                Preview
              </button>
              <button
                type="button"
                onClick={() => void applyOperation()}
                disabled={busy}
                className="inline-flex items-center gap-2 rounded-2xl border border-cyan-400/35 bg-cyan-500/14 px-4 py-3 text-sm font-semibold text-cyan-700 transition hover:bg-cyan-500/18 disabled:cursor-not-allowed disabled:opacity-45 dark:text-cyan-200"
              >
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                Apply SQL transform
              </button>
            </div>
          </div>

          <div className="rounded-[1.35rem] border border-white/12 bg-white/45 p-5 backdrop-blur-xl dark:border-white/10 dark:bg-slate-950/35">
            <div className="mb-4 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
              <Columns2 className="h-3.5 w-3.5" />
              Before / after preview
            </div>

            {previewRequest ? (
              <Suspense fallback={<PreviewFallback />}>
                <PreviewContent tableName={tableName} request={previewRequest} />
              </Suspense>
            ) : (
              <div className="flex min-h-[22rem] flex-col items-center justify-center gap-4 text-center">
                <ScissorsLineDashed className="h-8 w-8 text-slate-400" />
                <div className="space-y-2">
                  <p className="text-base font-semibold text-slate-950 dark:text-white">
                    Build an operation and preview it
                  </p>
                  <p className="max-w-lg text-sm text-slate-500 dark:text-slate-400">
                    The wrangler runs the transform as DuckDB SQL and renders the first ten rows before and after the change.
                  </p>
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="rounded-[1.35rem] border border-white/12 bg-white/45 p-5 backdrop-blur-xl dark:border-white/10 dark:bg-slate-950/35">
          <div className="mb-4 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
            <History className="h-3.5 w-3.5" />
            Operation history
          </div>

          {history.length === 0 ? (
            <div className="flex min-h-[22rem] flex-col items-center justify-center gap-4 text-center">
              <RotateCcw className="h-8 w-8 text-slate-400" />
              <div className="space-y-2">
                <p className="text-base font-semibold text-slate-950 dark:text-white">
                  No operations applied yet
                </p>
                <p className="max-w-md text-sm text-slate-500 dark:text-slate-400">
                  Applied SQL transforms will appear here with row count deltas and undo support.
                </p>
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              {history.map((entry) => {
                const undoable = latestUndoableEntry?.id === entry.id && entry.status === "applied";
                return (
                  <motion.article
                    key={entry.id}
                    initial={{ opacity: 0, y: 14 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.28, ease: EASE }}
                    className="overflow-hidden rounded-[1.2rem] border border-white/12 bg-white/40 dark:border-white/10 dark:bg-slate-950/34"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-3 px-4 py-4">
                      <div>
                        <div className="text-sm font-semibold text-slate-950 dark:text-white">
                          {entry.label}
                        </div>
                        <div className="mt-2 text-xs text-slate-500 dark:text-slate-400">
                          {formatTimestamp(entry.timestamp)}
                        </div>
                      </div>
                      <span
                        className={`rounded-full px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] ${
                          entry.status === "applied"
                            ? "bg-emerald-500/12 text-emerald-700 dark:text-emerald-300"
                            : "bg-slate-500/12 text-slate-600 dark:text-slate-300"
                        }`}
                      >
                        {entry.status}
                      </span>
                    </div>

                    <div className="grid gap-3 border-t border-white/10 px-4 py-4 sm:grid-cols-2">
                      <div className="rounded-2xl border border-white/10 bg-white/35 px-4 py-3 text-sm dark:bg-slate-950/30">
                        <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">
                          Row delta
                        </div>
                        <div className="mt-1 text-lg font-semibold text-slate-950 dark:text-white">
                          {formatNumber(entry.beforeCount)} → {formatNumber(entry.afterCount)}
                        </div>
                      </div>
                      <div className="rounded-2xl border border-white/10 bg-white/35 px-4 py-3 text-sm dark:bg-slate-950/30">
                        <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">
                          Backup table
                        </div>
                        <div className="mt-1 truncate font-mono text-xs text-slate-600 dark:text-slate-300">
                          {entry.backupTable}
                        </div>
                      </div>
                    </div>

                    <pre className="overflow-x-auto border-t border-white/10 bg-slate-950/90 px-4 py-4 text-xs leading-6 text-slate-200">
                      {entry.sql}
                    </pre>

                    {undoable ? (
                      <div className="border-t border-white/10 px-4 py-4">
                        <button
                          type="button"
                          onClick={undoLatest}
                          disabled={busy}
                          className="inline-flex items-center gap-2 rounded-2xl border border-white/15 bg-white/50 px-4 py-2 text-sm font-semibold text-slate-700 transition hover:border-cyan-300/30 disabled:cursor-not-allowed disabled:opacity-45 dark:border-white/10 dark:bg-slate-950/35 dark:text-slate-100"
                        >
                          <RotateCcw className="h-4 w-4" />
                          Undo this step
                        </button>
                      </div>
                    ) : null}
                  </motion.article>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
