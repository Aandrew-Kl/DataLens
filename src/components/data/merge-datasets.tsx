"use client";

import { quoteIdentifier } from "@/lib/utils/sql";
import type { ChangeEvent } from "react";
import { useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  Check,
  Eye,
  GitMerge,
  Layers3,
  Link2,
  Loader2,
  Plus,
  Save,
  Upload,
} from "lucide-react";
import {
  getTableRowCount,
  loadCSVIntoDB,
  loadJSONIntoDB,
  runQuery,
} from "@/lib/duckdb/client";
import { profileTable } from "@/lib/duckdb/profiler";
import { parseExcel } from "@/lib/parsers/excel-parser";
import { parseJSON } from "@/lib/parsers/json-parser";
import { formatNumber, generateId, getFileExtension, sanitizeTableName } from "@/lib/utils/formatters";
import { useDatasetStore } from "@/stores/dataset-store";
import type { DatasetMeta, ColumnProfile, ColumnType } from "@/types/dataset";

interface MergeDatasetsProps {
  onMergeComplete: (tableName: string) => void;
}

type MergeStep = 0 | 1 | 2 | 3;
type MergeStrategy = "append-rows" | "join-by-column" | "union-all";
type ConflictResolution = "keep-first" | "keep-last" | "keep-both";
type BusyState = "upload" | "preview" | "save" | null;

interface SelectedDataset {
  tableName: string;
  fileName: string;
  rowCount: number;
  columns: ColumnProfile[];
}

interface SchemaMapping {
  id: string;
  targetName: string;
  outputType: ColumnType;
  sourceColumns: Record<string, string>;
}

interface MergePlan {
  sql: string;
  outputColumns: string[];
}

interface MergeStats {
  rowCount: number;
  columnCount: number;
  nullFillRate: number;
}

const EASE = [0.22, 1, 0.36, 1] as const;
const STEPS: Array<{ id: MergeStep; label: string }> = [
  { id: 0, label: "Sources" },
  { id: 1, label: "Strategy" },
  { id: 2, label: "Mapping" },
  { id: 3, label: "Preview" },
];
function readNumber(value: unknown): number {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : 0;
  }

  if (typeof value === "bigint") {
    return Number(value);
  }

  const numeric = Number(value ?? 0);
  return Number.isFinite(numeric) ? numeric : 0;
}

function normalize(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function duckType(columnType: ColumnType): string {
  if (columnType === "number") {
    return "DOUBLE";
  }

  if (columnType === "date") {
    return "TIMESTAMP";
  }

  if (columnType === "boolean") {
    return "BOOLEAN";
  }

  return "VARCHAR";
}

function buildDefaultMergedName(datasets: SelectedDataset[], strategy: MergeStrategy): string {
  const fragment = datasets.slice(0, 3).map((dataset) => sanitizeTableName(dataset.tableName)).join("_");
  return `${fragment || "merged"}_${strategy.replaceAll("-", "_")}`;
}

function suggestJoinColumn(dataset: SelectedDataset, preferredName?: string): string {
  if (preferredName) {
    const exact = dataset.columns.find((column) => normalize(column.name) === normalize(preferredName));
    if (exact) {
      return exact.name;
    }
  }

  const identifierLike = dataset.columns.find((column) => /(^id$|_id$|key$|code$)/i.test(column.name));
  return identifierLike?.name ?? dataset.columns[0]?.name ?? "";
}

function buildSchemaMappings(datasets: SelectedDataset[]): SchemaMapping[] {
  const mappingByKey = new Map<string, SchemaMapping>();

  datasets.forEach((dataset) => {
    dataset.columns.forEach((column) => {
      const key = normalize(column.name);
      const existing = mappingByKey.get(key);

      if (!existing) {
        mappingByKey.set(key, {
          id: createId(),
          targetName: column.name,
          outputType: column.type,
          sourceColumns: {
            [dataset.tableName]: column.name,
          },
        });
        return;
      }

      existing.sourceColumns[dataset.tableName] = column.name;
      if (existing.outputType !== column.type) {
        existing.outputType = "string";
      }
    });
  });

  return Array.from(mappingByKey.values());
}

function createId(): string {
  return Math.random().toString(36).slice(2, 10);
}

function buildStackPlan(
  datasets: SelectedDataset[],
  mappings: SchemaMapping[],
  strategy: MergeStrategy,
): MergePlan {
  const operator = strategy === "append-rows" ? "UNION" : "UNION ALL";
  const outputColumns = mappings.map((mapping) => mapping.targetName);
  const sql = datasets
    .map((dataset) => {
      const selectList = mappings
        .map((mapping) => {
          const sourceColumn = mapping.sourceColumns[dataset.tableName];
          const expression = sourceColumn
            ? `CAST(${quoteIdentifier(sourceColumn)} AS ${duckType(mapping.outputType)})`
            : `CAST(NULL AS ${duckType(mapping.outputType)})`;

          return `${expression} AS ${quoteIdentifier(mapping.targetName)}`;
        })
        .join(",\n  ");

      return `SELECT
  ${selectList}
FROM ${quoteIdentifier(dataset.tableName)}`;
    })
    .join(`\n${operator}\n`);

  return { sql, outputColumns };
}

function buildJoinPlan(
  datasets: SelectedDataset[],
  joinColumns: Record<string, string>,
  conflictResolution: ConflictResolution,
): MergePlan {
  const occurrences = new Map<
    string,
    Array<{ tableIndex: number; tableName: string; columnName: string }>
  >();

  datasets.forEach((dataset, tableIndex) => {
    dataset.columns.forEach((column) => {
      const key = normalize(column.name);
      const current = occurrences.get(key) ?? [];
      current.push({
        tableIndex,
        tableName: dataset.tableName,
        columnName: column.name,
      });
      occurrences.set(key, current);
    });
  });

  const selectList: string[] = [];
  const outputColumns: string[] = [];

  occurrences.forEach((items) => {
    const targetName = items[0]?.columnName ?? "column";
    if (conflictResolution === "keep-both" && items.length > 1) {
      items.forEach((item, itemIndex) => {
        const alias = itemIndex === 0 ? targetName : `${item.tableName}__${item.columnName}`;
        selectList.push(`t${item.tableIndex}.${quoteIdentifier(item.columnName)} AS ${quoteIdentifier(alias)}`);
        outputColumns.push(alias);
      });
      return;
    }

    const orderedItems = conflictResolution === "keep-last" ? [...items].reverse() : items;
    const coalesced = orderedItems
      .map((item) => `t${item.tableIndex}.${quoteIdentifier(item.columnName)}`)
      .join(", ");

    selectList.push(`COALESCE(${coalesced}) AS ${quoteIdentifier(targetName)}`);
    outputColumns.push(targetName);
  });

  const fromLines = datasets.flatMap((dataset, index) => {
    if (index === 0) {
      return [`FROM ${quoteIdentifier(dataset.tableName)} t0`];
    }

    return [
      `LEFT JOIN ${quoteIdentifier(dataset.tableName)} t${index}`,
      `  ON t0.${quoteIdentifier(joinColumns[datasets[0].tableName] ?? "")} = t${index}.${quoteIdentifier(joinColumns[dataset.tableName] ?? "")}`,
    ];
  });

  return {
    sql: `SELECT
  ${selectList.join(",\n  ")}
${fromLines.join("\n")}`,
    outputColumns,
  };
}

function makeUniqueTableName(baseName: string, existingNames: Set<string>): string {
  let nextName = baseName || "dataset";
  let index = 1;

  while (existingNames.has(nextName)) {
    nextName = `${baseName}_${index}`;
    index += 1;
  }

  return nextName;
}

function previousStep(step: MergeStep): MergeStep {
  if (step === 0) {
    return 0;
  }

  if (step === 1) {
    return 0;
  }

  if (step === 2) {
    return 1;
  }

  return 2;
}

function nextStep(step: MergeStep): MergeStep {
  if (step === 0) {
    return 1;
  }

  if (step === 1) {
    return 2;
  }

  if (step === 2) {
    return 3;
  }

  return 3;
}

function StepIndicator({ step }: { step: MergeStep }) {
  return (
    <div className="mb-6 flex items-center gap-2">
      {STEPS.map((item, index) => {
        const active = item.id === step;
        const completed = item.id < step;
        return (
          <div key={item.id} className="flex flex-1 items-center gap-2">
            <div
              className={`flex h-8 w-8 items-center justify-center rounded-full border text-xs font-semibold ${
                completed
                  ? "border-emerald-400/30 bg-emerald-500/15 text-emerald-700 dark:text-emerald-300"
                  : active
                    ? "border-sky-400/30 bg-sky-500/15 text-sky-700 dark:text-sky-300"
                    : "border-white/10 bg-white/10 text-slate-500 dark:text-slate-400"
              }`}
            >
              {completed ? <Check className="h-4 w-4" /> : index + 1}
            </div>
            <span className={`text-sm ${active ? "text-slate-900 dark:text-slate-100" : "text-slate-500 dark:text-slate-400"}`}>
              {item.label}
            </span>
            {index < STEPS.length - 1 ? <div className="h-px flex-1 bg-white/10" /> : null}
          </div>
        );
      })}
    </div>
  );
}

function PreviewTable({ rows }: { rows: Record<string, unknown>[] }) {
  if (rows.length === 0) {
    return (
      <div className="flex h-40 items-center justify-center rounded-2xl border border-dashed border-white/10 text-sm text-slate-500 dark:text-slate-400">
        Preview the merge to inspect the first 50 rows.
      </div>
    );
  }

  const headers = Object.keys(rows[0] ?? {});

  return (
    <div className="overflow-auto rounded-2xl border border-white/10">
      <table className="min-w-full text-left text-sm">
        <thead className="sticky top-0 bg-white/75 dark:bg-slate-950/80">
          <tr>
            {headers.map((header) => (
              <th key={header} className="whitespace-nowrap px-3 py-2 font-semibold text-slate-700 dark:text-slate-200">
                {header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, rowIndex) => (
            <tr key={`preview-row-${rowIndex}`} className="border-t border-white/10">
              {headers.map((header) => (
                <td key={`${rowIndex}-${header}`} className="max-w-56 truncate px-3 py-2 text-slate-600 dark:text-slate-300">
                  {String(row[header] ?? "null")}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function MergeDatasets({ onMergeComplete }: MergeDatasetsProps) {
  const datasets = useDatasetStore((state) => state.datasets);
  const addDataset = useDatasetStore((state) => state.addDataset);

  const [step, setStep] = useState<MergeStep>(0);
  const [selectedTableNames, setSelectedTableNames] = useState<string[]>([]);
  const [mergeStrategy, setMergeStrategy] = useState<MergeStrategy>("append-rows");
  const [conflictResolution, setConflictResolution] = useState<ConflictResolution>("keep-first");
  const [mappingOverrides, setMappingOverrides] = useState<Record<string, string>>({});
  const [joinSelections, setJoinSelections] = useState<Record<string, string>>({});
  const [mergedTableName, setMergedTableName] = useState("");
  const [busy, setBusy] = useState<BusyState>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [previewRows, setPreviewRows] = useState<Record<string, unknown>[]>([]);
  const [stats, setStats] = useState<MergeStats | null>(null);

  const datasetOptions = useMemo<SelectedDataset[]>(
    () =>
      datasets.map((dataset) => ({
        tableName: dataset.name,
        fileName: dataset.fileName,
        rowCount: dataset.rowCount,
        columns: dataset.columns,
      })),
    [datasets],
  );

  const effectiveSelectedNames = selectedTableNames.length > 0
    ? selectedTableNames
    : datasetOptions.slice(0, 2).map((dataset) => dataset.tableName);

  const selectedDatasets = useMemo(
    () =>
      effectiveSelectedNames
        .map((tableName) => datasetOptions.find((dataset) => dataset.tableName === tableName))
        .filter((dataset): dataset is SelectedDataset => Boolean(dataset)),
    [datasetOptions, effectiveSelectedNames],
  );

  const baseMappings = useMemo(() => buildSchemaMappings(selectedDatasets), [selectedDatasets]);

  const resolvedMappings = useMemo(
    () =>
      baseMappings.map((mapping) => ({
        ...mapping,
        sourceColumns: selectedDatasets.reduce<Record<string, string>>((accumulator, dataset) => {
          const overrideKey = `${mapping.targetName}::${dataset.tableName}`;
          accumulator[dataset.tableName] = mappingOverrides[overrideKey] ?? mapping.sourceColumns[dataset.tableName] ?? "";
          return accumulator;
        }, {}),
      })),
    [baseMappings, mappingOverrides, selectedDatasets],
  );

  const resolvedJoinColumns = useMemo(() => {
    const baseDataset = selectedDatasets[0];
    const baseJoin = baseDataset
      ? joinSelections[baseDataset.tableName] ?? suggestJoinColumn(baseDataset)
      : "";

    return selectedDatasets.reduce<Record<string, string>>((accumulator, dataset, index) => {
      accumulator[dataset.tableName] =
        joinSelections[dataset.tableName] ??
        suggestJoinColumn(dataset, index === 0 ? undefined : baseJoin);
      return accumulator;
    }, {});
  }, [joinSelections, selectedDatasets]);

  const mergePlan = useMemo<MergePlan | null>(() => {
    if (selectedDatasets.length < 2) {
      return null;
    }

    if (mergeStrategy === "join-by-column") {
      return buildJoinPlan(selectedDatasets, resolvedJoinColumns, conflictResolution);
    }

    return buildStackPlan(selectedDatasets, resolvedMappings, mergeStrategy);
  }, [conflictResolution, mergeStrategy, resolvedJoinColumns, resolvedMappings, selectedDatasets]);

  const effectiveMergedName = mergedTableName.trim() || buildDefaultMergedName(selectedDatasets, mergeStrategy);

  const canAdvance =
    (step === 0 && selectedDatasets.length >= 2) ||
    step === 1 ||
    step === 2 ||
    step === 3;

  async function handleUpload(event: ChangeEvent<HTMLInputElement>): Promise<void> {
    const files = Array.from(event.target.files ?? []);
    if (files.length === 0) {
      return;
    }

    event.target.value = "";
    setBusy("upload");
    setNotice(null);

    try {
      const existingNames = new Set(datasetOptions.map((dataset) => dataset.tableName));
      const createdNames: string[] = [];

      for (const file of files) {
        const extension = getFileExtension(file.name);
        const baseName = sanitizeTableName(file.name);
        const tableName = makeUniqueTableName(baseName, existingNames);
        existingNames.add(tableName);

        if (extension === "json") {
          const jsonContent = await parseJSON(file);
          await loadJSONIntoDB(tableName, jsonContent);
        } else if (extension === "xlsx" || extension === "xls") {
          const csvContent = await parseExcel(file);
          await loadCSVIntoDB(tableName, csvContent);
        } else {
          const content = await file.text();
          await loadCSVIntoDB(tableName, content);
        }

        const [columns, rowCount] = await Promise.all([
          profileTable(tableName),
          getTableRowCount(tableName),
        ]);

        const meta: DatasetMeta = {
          id: generateId(),
          name: tableName,
          fileName: file.name,
          rowCount,
          columnCount: columns.length,
          columns,
          uploadedAt: Date.now(),
          sizeBytes: file.size,
        };

        addDataset(meta);
        createdNames.push(tableName);
      }

      setSelectedTableNames((current) => Array.from(new Set([...current, ...createdNames])));
      setNotice(`Loaded ${createdNames.length} dataset${createdNames.length === 1 ? "" : "s"} for merging.`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Dataset upload failed.");
    } finally {
      setBusy(null);
    }
  }

  async function previewMerge(): Promise<void> {
    if (!mergePlan) {
      return;
    }

    setBusy("preview");
    setNotice(null);

    try {
      const nullFillExpression =
        mergePlan.outputColumns.length > 0
          ? mergePlan.outputColumns
              .map((columnName) => `SUM(CASE WHEN ${quoteIdentifier(columnName)} IS NULL THEN 1 ELSE 0 END)`)
              .join(" + ")
          : "0";

      const [rows, statRows] = await Promise.all([
        runQuery(`SELECT * FROM (${mergePlan.sql}) AS merged_preview LIMIT 50`),
        runQuery(`
          SELECT
            COUNT(*) AS row_count,
            (${nullFillExpression}) / NULLIF(COUNT(*) * ${Math.max(mergePlan.outputColumns.length, 1)}, 0) AS null_fill_rate
          FROM (${mergePlan.sql}) AS merged_stats
        `),
      ]);

      const statRow = statRows[0] ?? {};
      setPreviewRows(rows);
      setStats({
        rowCount: readNumber(statRow.row_count),
        columnCount: mergePlan.outputColumns.length,
        nullFillRate: readNumber(statRow.null_fill_rate),
      });
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Preview failed.");
      setPreviewRows([]);
      setStats(null);
    } finally {
      setBusy(null);
    }
  }

  async function materializeMerge(): Promise<void> {
    if (!mergePlan) {
      return;
    }

    setBusy("save");
    setNotice(null);

    try {
      await runQuery(`CREATE OR REPLACE TABLE ${quoteIdentifier(effectiveMergedName)} AS ${mergePlan.sql}`);
      setNotice(`Created ${effectiveMergedName}.`);
      onMergeComplete(effectiveMergedName);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Create table failed.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="overflow-hidden rounded-[30px] border border-white/15 bg-[radial-gradient(circle_at_top_left,rgba(56,189,248,0.18),transparent_24%),linear-gradient(135deg,rgba(248,250,252,0.92),rgba(226,232,240,0.75))] shadow-[0_30px_120px_-50px_rgba(15,23,42,0.9)] dark:border-white/10 dark:bg-[radial-gradient(circle_at_top_left,rgba(56,189,248,0.16),transparent_22%),linear-gradient(135deg,rgba(2,6,23,0.95),rgba(15,23,42,0.88))]">
      <div className="border-b border-white/10 px-6 py-5">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full border border-cyan-400/20 bg-cyan-500/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.22em] text-cyan-700 dark:text-cyan-300">
              <GitMerge className="h-3.5 w-3.5" />
              Merge datasets
            </div>
            <h2 className="mt-3 text-2xl font-semibold tracking-tight text-slate-950 dark:text-slate-50">
              Step-by-step merge wizard
            </h2>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600 dark:text-slate-300">
              Stack rows, union schemas, or join tables by a shared key. Uploaded inputs are immediately profiled and become reusable DataLens datasets.
            </p>
          </div>

          <label className="inline-flex cursor-pointer items-center gap-2 rounded-2xl border border-white/10 bg-white/10 px-4 py-3 text-sm font-medium text-slate-700 transition hover:bg-white/15 dark:bg-slate-950/40 dark:text-slate-200">
            {busy === "upload" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
            Upload dataset
            <input
              type="file"
              accept=".csv,.tsv,.json,.xlsx,.xls"
              multiple
              onChange={(event) => void handleUpload(event)}
              className="hidden"
            />
          </label>
        </div>
      </div>

      <div className="px-6 py-6">
        <StepIndicator step={step} />

        <AnimatePresence mode="wait">
          <motion.div
            key={step}
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -12 }}
            transition={{ duration: 0.26, ease: EASE }}
            className="space-y-5"
          >
            {step === 0 ? (
              <div className="grid gap-4 lg:grid-cols-2">
                {datasetOptions.map((dataset) => {
                  const selected = effectiveSelectedNames.includes(dataset.tableName);
                  return (
                    <button
                      key={dataset.tableName}
                      type="button"
                      onClick={() =>
                        setSelectedTableNames((current) =>
                          current.includes(dataset.tableName)
                            ? current.filter((name) => name !== dataset.tableName)
                            : [...current, dataset.tableName],
                        )
                      }
                      className={`rounded-3xl border p-5 text-left transition ${
                        selected
                          ? "border-cyan-400/30 bg-cyan-500/10"
                          : "border-white/10 bg-white/10 hover:border-cyan-400/20 dark:bg-slate-950/35"
                      }`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="text-lg font-semibold text-slate-950 dark:text-slate-50">{dataset.tableName}</p>
                          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{dataset.fileName}</p>
                        </div>
                        {selected ? (
                          <span className="rounded-full border border-cyan-400/30 bg-cyan-500/15 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-cyan-700 dark:text-cyan-200">
                            Selected
                          </span>
                        ) : null}
                      </div>
                      <div className="mt-4 grid gap-3 sm:grid-cols-3">
                        <div className="rounded-2xl border border-white/10 bg-white/10 px-3 py-2.5 dark:bg-slate-950/35">
                          <div className="text-[11px] uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">Rows</div>
                          <div className="mt-1 text-sm font-semibold text-slate-900 dark:text-slate-100">{formatNumber(dataset.rowCount)}</div>
                        </div>
                        <div className="rounded-2xl border border-white/10 bg-white/10 px-3 py-2.5 dark:bg-slate-950/35">
                          <div className="text-[11px] uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">Columns</div>
                          <div className="mt-1 text-sm font-semibold text-slate-900 dark:text-slate-100">{dataset.columns.length}</div>
                        </div>
                        <div className="rounded-2xl border border-white/10 bg-white/10 px-3 py-2.5 dark:bg-slate-950/35">
                          <div className="text-[11px] uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">Profile</div>
                          <div className="mt-1 text-sm font-semibold text-slate-900 dark:text-slate-100">{dataset.columns.map((column) => column.type).filter(Boolean).slice(0, 2).join(", ")}</div>
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            ) : null}

            {step === 1 ? (
              <div className="grid gap-5 xl:grid-cols-[0.95fr_1.05fr]">
                <div className="rounded-3xl border border-white/10 bg-white/10 p-5 dark:bg-slate-950/35">
                  <div className="mb-4 flex items-center gap-2 text-slate-900 dark:text-slate-100">
                    <Layers3 className="h-4 w-4 text-cyan-600 dark:text-cyan-300" />
                    Merge strategy
                  </div>
                  <div className="space-y-3">
                    {(
                      [
                        ["append-rows", "Append rows", "Align columns, then remove exact duplicates across inputs."],
                        ["union-all", "Union all", "Align columns and keep every row exactly as provided."],
                        ["join-by-column", "Join by column", "Use the first selected table as the left-side join anchor."],
                      ] as const
                    ).map(([value, label, description]) => (
                      <button
                        key={value}
                        type="button"
                        onClick={() => setMergeStrategy(value)}
                        className={`w-full rounded-2xl border px-4 py-4 text-left transition ${
                          mergeStrategy === value
                            ? "border-cyan-400/30 bg-cyan-500/10"
                            : "border-white/10 bg-white/10 hover:border-cyan-400/20 dark:bg-slate-950/35"
                        }`}
                      >
                        <div className="text-sm font-semibold text-slate-950 dark:text-slate-50">{label}</div>
                        <div className="mt-1 text-sm leading-6 text-slate-600 dark:text-slate-300">{description}</div>
                      </button>
                    ))}
                  </div>
                </div>

                <div className="space-y-5">
                  <div className="rounded-3xl border border-white/10 bg-white/10 p-5 dark:bg-slate-950/35">
                    <div className="mb-4 flex items-center gap-2 text-slate-900 dark:text-slate-100">
                      <Link2 className="h-4 w-4 text-cyan-600 dark:text-cyan-300" />
                      Conflict resolution
                    </div>
                    <div className="grid gap-3 md:grid-cols-3">
                      {(
                        [
                          ["keep-first", "Keep first"],
                          ["keep-last", "Keep last"],
                          ["keep-both", "Keep both"],
                        ] as const
                      ).map(([value, label]) => (
                        <button
                          key={value}
                          type="button"
                          onClick={() => setConflictResolution(value)}
                          className={`rounded-2xl border px-4 py-3 text-sm transition ${
                            conflictResolution === value
                              ? "border-amber-400/30 bg-amber-500/10 text-amber-800 dark:text-amber-200"
                              : "border-white/10 bg-white/10 text-slate-600 hover:border-amber-400/20 dark:bg-slate-950/35 dark:text-slate-300"
                          }`}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                  </div>

                  {mergeStrategy === "join-by-column" ? (
                    <div className="rounded-3xl border border-white/10 bg-white/10 p-5 dark:bg-slate-950/35">
                      <div className="mb-4 text-sm font-semibold text-slate-900 dark:text-slate-100">Join keys</div>
                      <div className="space-y-3">
                        {selectedDatasets.map((dataset) => (
                          <label key={dataset.tableName} className="block text-sm text-slate-600 dark:text-slate-300">
                            <span className="mb-2 block font-medium text-slate-900 dark:text-slate-100">{dataset.tableName}</span>
                            <select
                              value={resolvedJoinColumns[dataset.tableName] ?? ""}
                              onChange={(event) =>
                                setJoinSelections((current) => ({
                                  ...current,
                                  [dataset.tableName]: event.target.value,
                                }))
                              }
                              className="w-full rounded-2xl border border-white/10 bg-white/50 px-3 py-2.5 outline-none dark:bg-slate-950/45"
                            >
                              {dataset.columns.map((column) => (
                                <option key={column.name} value={column.name}>
                                  {column.name}
                                </option>
                              ))}
                            </select>
                          </label>
                        ))}
                      </div>
                    </div>
                  ) : null}
                </div>
              </div>
            ) : null}

            {step === 2 ? (
              <div className="rounded-3xl border border-white/10 bg-white/10 p-5 dark:bg-slate-950/35">
                <div className="mb-4 flex items-center gap-2 text-slate-900 dark:text-slate-100">
                  <Layers3 className="h-4 w-4 text-cyan-600 dark:text-cyan-300" />
                  {mergeStrategy === "join-by-column" ? "Join projection" : "Column mapping"}
                </div>

                {mergeStrategy === "join-by-column" ? (
                  <div className="grid gap-3 md:grid-cols-2">
                    {selectedDatasets.map((dataset) => (
                      <div
                        key={dataset.tableName}
                        className="rounded-2xl border border-white/10 bg-white/10 px-4 py-4 dark:bg-slate-950/35"
                      >
                        <div className="text-sm font-semibold text-slate-950 dark:text-slate-50">{dataset.tableName}</div>
                        <p className="mt-1 text-sm leading-6 text-slate-600 dark:text-slate-300">
                          Joining on <span className="font-mono">{resolvedJoinColumns[dataset.tableName]}</span> with{" "}
                          <span className="font-mono">{conflictResolution}</span> collision handling.
                        </p>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="overflow-auto rounded-2xl border border-white/10">
                    <table className="min-w-full text-left text-sm">
                      <thead className="bg-white/75 dark:bg-slate-950/80">
                        <tr>
                          <th className="px-3 py-2 font-semibold text-slate-700 dark:text-slate-200">Output column</th>
                          {selectedDatasets.map((dataset) => (
                            <th key={dataset.tableName} className="px-3 py-2 font-semibold text-slate-700 dark:text-slate-200">
                              {dataset.tableName}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {resolvedMappings.map((mapping) => (
                          <tr key={mapping.id} className="border-t border-white/10">
                            <td className="px-3 py-2 text-slate-700 dark:text-slate-200">{mapping.targetName}</td>
                            {selectedDatasets.map((dataset) => {
                              const overrideKey = `${mapping.targetName}::${dataset.tableName}`;
                              return (
                                <td key={overrideKey} className="px-3 py-2">
                                  <select
                                    value={mapping.sourceColumns[dataset.tableName] ?? ""}
                                    onChange={(event) =>
                                      setMappingOverrides((current) => ({
                                        ...current,
                                        [overrideKey]: event.target.value,
                                      }))
                                    }
                                    className="w-full rounded-2xl border border-white/10 bg-white/50 px-3 py-2 outline-none dark:bg-slate-950/45"
                                  >
                                    <option value="">No column</option>
                                    {dataset.columns.map((column) => (
                                      <option key={column.name} value={column.name}>
                                        {column.name}
                                      </option>
                                    ))}
                                  </select>
                                </td>
                              );
                            })}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            ) : null}

            {step === 3 ? (
              <div className="grid gap-5 xl:grid-cols-[1.05fr_0.95fr]">
                <div className="space-y-5">
                  <div className="rounded-3xl border border-white/10 bg-white/10 p-5 dark:bg-slate-950/35">
                    <div className="mb-4 flex items-center justify-between gap-3">
                      <div className="flex items-center gap-2 text-slate-900 dark:text-slate-100">
                        <Eye className="h-4 w-4 text-cyan-600 dark:text-cyan-300" />
                        Result preview
                      </div>
                      <button
                        type="button"
                        onClick={() => void previewMerge()}
                        className="inline-flex items-center gap-2 rounded-2xl border border-cyan-400/20 bg-cyan-500/10 px-4 py-2.5 text-sm font-medium text-cyan-800 dark:text-cyan-200"
                      >
                        {busy === "preview" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Eye className="h-4 w-4" />}
                        Preview 50 rows
                      </button>
                    </div>
                    <PreviewTable rows={previewRows} />
                  </div>

                  <div className="rounded-3xl border border-white/10 bg-white/10 p-5 dark:bg-slate-950/35">
                    <div className="mb-4 flex items-center gap-2 text-slate-900 dark:text-slate-100">
                      <Layers3 className="h-4 w-4 text-cyan-600 dark:text-cyan-300" />
                      Merge SQL
                    </div>
                    <div className="rounded-2xl border border-white/10 bg-slate-950/85 p-4 text-xs leading-6 text-cyan-200">
                      {mergePlan?.sql ?? "-- Select at least two datasets to build the merge plan."}
                    </div>
                  </div>
                </div>

                <div className="space-y-5">
                  <div className="rounded-3xl border border-white/10 bg-white/10 p-5 dark:bg-slate-950/35">
                    <div className="mb-4 flex items-center gap-2 text-slate-900 dark:text-slate-100">
                      <Save className="h-4 w-4 text-cyan-600 dark:text-cyan-300" />
                      Materialize merged table
                    </div>
                    <label className="block text-sm text-slate-600 dark:text-slate-300">
                      <span className="mb-2 block font-medium text-slate-900 dark:text-slate-100">Table name</span>
                      <input
                        value={mergedTableName}
                        onChange={(event) => setMergedTableName(event.target.value)}
                        placeholder={effectiveMergedName}
                        className="w-full rounded-2xl border border-white/10 bg-white/50 px-3 py-2.5 outline-none dark:bg-slate-950/45"
                      />
                    </label>
                    <button
                      type="button"
                      onClick={() => void materializeMerge()}
                      disabled={!mergePlan || busy === "save"}
                      className="mt-4 inline-flex items-center gap-2 rounded-2xl border border-emerald-400/20 bg-emerald-500/10 px-4 py-3 text-sm font-medium text-emerald-800 disabled:opacity-60 dark:text-emerald-200"
                    >
                      {busy === "save" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                      Create merged table
                    </button>
                  </div>

                  <div className="rounded-3xl border border-white/10 bg-white/10 p-5 dark:bg-slate-950/35">
                    <div className="mb-4 text-sm font-semibold text-slate-900 dark:text-slate-100">Result statistics</div>
                    <div className="grid gap-3 md:grid-cols-3">
                      <div className="rounded-2xl border border-white/10 bg-white/10 px-4 py-3 dark:bg-slate-950/35">
                        <div className="text-[11px] uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">Rows</div>
                        <div className="mt-2 text-xl font-semibold text-slate-950 dark:text-slate-50">
                          {stats ? formatNumber(stats.rowCount) : "—"}
                        </div>
                      </div>
                      <div className="rounded-2xl border border-white/10 bg-white/10 px-4 py-3 dark:bg-slate-950/35">
                        <div className="text-[11px] uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">Columns</div>
                        <div className="mt-2 text-xl font-semibold text-slate-950 dark:text-slate-50">
                          {stats ? stats.columnCount : "—"}
                        </div>
                      </div>
                      <div className="rounded-2xl border border-white/10 bg-white/10 px-4 py-3 dark:bg-slate-950/35">
                        <div className="text-[11px] uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">Null fill rate</div>
                        <div className="mt-2 text-xl font-semibold text-slate-950 dark:text-slate-50">
                          {stats ? `${(stats.nullFillRate * 100).toFixed(1)}%` : "—"}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            ) : null}
          </motion.div>
        </AnimatePresence>

        <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
          <button
            type="button"
            onClick={() => setStep((current) => previousStep(current))}
            disabled={step === 0}
            className="inline-flex items-center gap-2 rounded-2xl border border-white/10 bg-white/10 px-4 py-3 text-sm text-slate-700 transition disabled:opacity-50 dark:bg-slate-950/35 dark:text-slate-200"
          >
            Previous
          </button>

          <button
            type="button"
            onClick={() => setStep((current) => nextStep(current))}
            disabled={!canAdvance || step === 3}
            className="inline-flex items-center gap-2 rounded-2xl border border-cyan-400/20 bg-cyan-500/10 px-4 py-3 text-sm font-medium text-cyan-800 transition disabled:opacity-50 dark:text-cyan-200"
          >
            {step === 2 ? "Review preview" : "Next step"}
            <Plus className="h-4 w-4" />
          </button>
        </div>

        {notice ? (
          <div className="mt-4 rounded-2xl border border-cyan-400/20 bg-cyan-500/10 px-4 py-3 text-sm text-cyan-800 dark:text-cyan-200">
            {notice}
          </div>
        ) : null}
      </div>
    </section>
  );
}
