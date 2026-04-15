"use client";

import { quoteIdentifier } from "@/lib/utils/sql";
import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  AlertTriangle,
  ArrowRightLeft,
  CheckCircle2,
  ChevronRight,
  Code2,
  Database,
  Eye,
  Link2,
  Loader2,
  Plus,
  RefreshCw,
  Save,
  Sparkles,
  Table2,
  Trash2,
} from "lucide-react";
import type { ColumnProfile, DatasetMeta } from "@/types/dataset";
import { runQuery } from "@/lib/duckdb/client";
import { formatNumber } from "@/lib/utils/formatters";

interface JoinBuilderProps {
  datasets: DatasetMeta[];
  onJoinComplete: (result: { tableName: string; sql: string }) => void;
}

type JoinType = "INNER" | "LEFT" | "RIGHT" | "FULL OUTER";

interface JoinCondition {
  id: string;
  leftColumn: string;
  rightColumn: string;
}

interface JoinSuggestion {
  id: string;
  leftColumn: string;
  rightColumn: string;
  reason: string;
  score: number;
}

interface ProjectedColumn {
  alias: string;
  expression: string;
}

const STEP_META = [
  { label: "Tables", icon: Database },
  { label: "Type", icon: ArrowRightLeft },
  { label: "Keys", icon: Link2 },
  { label: "Preview", icon: Eye },
  { label: "Save", icon: Save },
] as const;

const JOIN_OPTIONS: Array<{
  value: JoinType;
  label: string;
  description: string;
}> = [
  {
    value: "INNER",
    label: "Inner Join",
    description: "Keep only rows that match on both sides.",
  },
  {
    value: "LEFT",
    label: "Left Join",
    description: "Keep every row from the left dataset.",
  },
  {
    value: "RIGHT",
    label: "Right Join",
    description: "Keep every row from the right dataset.",
  },
  {
    value: "FULL OUTER",
    label: "Full Outer Join",
    description: "Keep every row from both datasets.",
  },
] as const;

function createId() {
  return Math.random().toString(36).slice(2, 10);
}

function normalizeName(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function tokenizeName(value: string) {
  return normalizeName(value).split("_").filter(Boolean);
}
function sanitizeViewName(value: string) {
  const sanitized = value
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 63);

  return sanitized || "joined_view";
}

function formatValue(value: unknown) {
  if (value === null || value === undefined) {
    return "null";
  }

  if (typeof value === "number") {
    return Number.isFinite(value) ? value.toLocaleString() : String(value);
  }

  if (typeof value === "boolean") {
    return value ? "true" : "false";
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  return String(value);
}

function buildJoinSuggestions(
  leftColumns: ColumnProfile[],
  rightColumns: ColumnProfile[],
): JoinSuggestion[] {
  const suggestions: JoinSuggestion[] = [];

  for (const leftColumn of leftColumns) {
    const leftName = normalizeName(leftColumn.name);
    const leftTokens = tokenizeName(leftColumn.name);

    for (const rightColumn of rightColumns) {
      const rightName = normalizeName(rightColumn.name);
      const rightTokens = tokenizeName(rightColumn.name);

      let score = 0;
      const reasons: string[] = [];

      if (leftName === rightName) {
        score += 100;
        reasons.push("Exact name match");
      }

      const overlappingTokens = leftTokens.filter((token) =>
        rightTokens.includes(token),
      );
      if (overlappingTokens.length > 0) {
        score += overlappingTokens.length * 14;
        reasons.push(`Shared tokens: ${overlappingTokens.join(", ")}`);
      }

      if (
        leftName.includes(rightName) ||
        rightName.includes(leftName)
      ) {
        score += 16;
        reasons.push("Similar field name");
      }

      if (leftColumn.type === rightColumn.type) {
        score += leftColumn.type === "unknown" ? 8 : 24;
        reasons.push(`Matching ${leftColumn.type} type`);
      }

      if (
        leftName.endsWith("_id") &&
        rightName.endsWith("_id")
      ) {
        score += 12;
        reasons.push("Both look like key columns");
      }

      const uniqueRatioGap =
        Math.abs(leftColumn.uniqueCount - rightColumn.uniqueCount) /
        Math.max(leftColumn.uniqueCount, rightColumn.uniqueCount, 1);
      if (uniqueRatioGap <= 0.15) {
        score += 8;
        reasons.push("Similar uniqueness");
      }

      if (score >= 40) {
        suggestions.push({
          id: `${leftColumn.name}:${rightColumn.name}`,
          leftColumn: leftColumn.name,
          rightColumn: rightColumn.name,
          reason: reasons.slice(0, 2).join(" • "),
          score,
        });
      }
    }
  }

  return suggestions.sort((a, b) => b.score - a.score).slice(0, 8);
}

function buildProjectedColumns(leftDataset: DatasetMeta, rightDataset: DatasetMeta) {
  const leftNormalizedNames = new Set(
    leftDataset.columns.map((column) => normalizeName(column.name)),
  );

  const projected: ProjectedColumn[] = leftDataset.columns.map((column) => ({
    alias: column.name,
    expression: `l.${quoteIdentifier(column.name)} AS ${quoteIdentifier(column.name)}`,
  }));

  for (const column of rightDataset.columns) {
    const alias = leftNormalizedNames.has(normalizeName(column.name))
      ? `${rightDataset.name}__${column.name}`
      : column.name;

    projected.push({
      alias,
      expression: `r.${quoteIdentifier(column.name)} AS ${quoteIdentifier(alias)}`,
    });
  }

  return projected;
}

function buildJoinSelectSQL(
  leftDataset: DatasetMeta,
  rightDataset: DatasetMeta,
  joinType: JoinType,
  conditions: JoinCondition[],
) {
  const projectedColumns = buildProjectedColumns(leftDataset, rightDataset);
  const onClause = conditions
    .map(
      (condition) =>
        `l.${quoteIdentifier(condition.leftColumn)} = r.${quoteIdentifier(condition.rightColumn)}`,
    )
    .join("\n  AND ");

  return [
    "SELECT",
    projectedColumns.map((column) => `  ${column.expression}`).join(",\n"),
    `FROM ${quoteIdentifier(leftDataset.name)} l`,
    `${joinType} JOIN ${quoteIdentifier(rightDataset.name)} r`,
    `  ON ${onClause}`,
  ].join("\n");
}

function DatasetCard({
  dataset,
  selected,
  side,
  onSelect,
}: {
  dataset: DatasetMeta;
  selected: boolean;
  side: "left" | "right";
  onSelect: (datasetId: string) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onSelect(dataset.id)}
      className={`w-full rounded-xl border p-4 text-left transition-all ${
        selected
          ? "border-sky-400 bg-sky-500/10 shadow-lg shadow-sky-500/10"
          : "border-gray-200/70 bg-white/70 hover:border-gray-300 hover:bg-white dark:border-gray-700/70 dark:bg-gray-950/30 dark:hover:border-gray-600 dark:hover:bg-gray-950/40"
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="rounded-full bg-gray-900 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.18em] text-white dark:bg-white dark:text-gray-900">
              {side}
            </span>
            <span className="truncate text-sm font-semibold text-gray-900 dark:text-gray-100">
              {dataset.name}
            </span>
          </div>
          <p className="mt-1 truncate text-xs text-gray-500 dark:text-gray-400">
            {dataset.fileName}
          </p>
        </div>
        {selected && <CheckCircle2 className="h-4 w-4 shrink-0 text-sky-500" />}
      </div>

      <div className="mt-4 grid grid-cols-3 gap-2 text-xs">
        <div className="rounded-lg bg-gray-100/80 px-2 py-2 text-gray-600 dark:bg-gray-800/80 dark:text-gray-300">
          <p className="text-[10px] uppercase tracking-wide text-gray-400 dark:text-gray-500">
            Rows
          </p>
          <p className="mt-1 font-medium">{formatNumber(dataset.rowCount)}</p>
        </div>
        <div className="rounded-lg bg-gray-100/80 px-2 py-2 text-gray-600 dark:bg-gray-800/80 dark:text-gray-300">
          <p className="text-[10px] uppercase tracking-wide text-gray-400 dark:text-gray-500">
            Columns
          </p>
          <p className="mt-1 font-medium">{formatNumber(dataset.columnCount)}</p>
        </div>
        <div className="rounded-lg bg-gray-100/80 px-2 py-2 text-gray-600 dark:bg-gray-800/80 dark:text-gray-300">
          <p className="text-[10px] uppercase tracking-wide text-gray-400 dark:text-gray-500">
            Uploaded
          </p>
          <p className="mt-1 font-medium">
            {new Date(dataset.uploadedAt).toLocaleDateString()}
          </p>
        </div>
      </div>
    </button>
  );
}

function PreviewTable({
  columns,
  rows,
}: {
  columns: string[];
  rows: Record<string, unknown>[];
}) {
  if (!columns.length) {
    return (
      <div className="rounded-xl border border-dashed border-gray-300/70 px-4 py-8 text-center text-sm text-gray-500 dark:border-gray-700/70 dark:text-gray-400">
        No preview columns available yet.
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-xl border border-gray-200/70 dark:border-gray-700/70">
      <div className="max-h-[360px] overflow-auto">
        <table className="min-w-full divide-y divide-gray-200/70 text-left text-sm dark:divide-gray-700/70">
          <thead className="sticky top-0 bg-gray-50/95 backdrop-blur-sm dark:bg-gray-950/95">
            <tr>
              {columns.map((column) => (
                <th
                  key={column}
                  className="whitespace-nowrap px-3 py-2 text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400"
                >
                  {column}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200/60 bg-white/80 dark:divide-gray-800/70 dark:bg-gray-900/40">
            {rows.length === 0 ? (
              <tr>
                <td
                  colSpan={columns.length}
                  className="px-3 py-8 text-center text-sm text-gray-500 dark:text-gray-400"
                >
                  The preview returned zero rows.
                </td>
              </tr>
            ) : (
              rows.map((row, index) => (
                <tr key={index} className="hover:bg-gray-50/80 dark:hover:bg-gray-800/40">
                  {columns.map((column) => (
                    <td
                      key={`${index}:${column}`}
                      className="max-w-[220px] truncate whitespace-nowrap px-3 py-2 font-mono text-xs text-gray-700 dark:text-gray-200"
                      title={formatValue(row[column])}
                    >
                      {formatValue(row[column])}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function JoinBuilder({
  datasets,
  onJoinComplete,
}: JoinBuilderProps) {
  const [currentStep, setCurrentStep] = useState(0);
  const [leftDatasetId, setLeftDatasetId] = useState<string>(datasets[0]?.id ?? "");
  const [rightDatasetId, setRightDatasetId] = useState<string>(datasets[1]?.id ?? datasets[0]?.id ?? "");
  const [joinType, setJoinType] = useState<JoinType>("INNER");
  const [conditions, setConditions] = useState<JoinCondition[]>([]);
  const [previewRows, setPreviewRows] = useState<Record<string, unknown>[]>([]);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [isPreviewLoading, setIsPreviewLoading] = useState(false);
  const [previewRefreshKey, setPreviewRefreshKey] = useState(0);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState<string | null>(null);
  const [viewName, setViewName] = useState("");
  const [viewNameEdited, setViewNameEdited] = useState(false);

  const leftDataset = useMemo(
    () => datasets.find((dataset) => dataset.id === leftDatasetId) ?? null,
    [datasets, leftDatasetId],
  );
  const rightDataset = useMemo(
    () => datasets.find((dataset) => dataset.id === rightDatasetId) ?? null,
    [datasets, rightDatasetId],
  );

  const suggestions = useMemo(
    () =>
      leftDataset && rightDataset
        ? buildJoinSuggestions(leftDataset.columns, rightDataset.columns)
        : [],
    [leftDataset, rightDataset],
  );

  const suggestedViewName = useMemo(() => {
    if (!leftDataset || !rightDataset) {
      return "joined_view";
    }

    return sanitizeViewName(
      `${leftDataset.name}_${joinType.toLowerCase().replace(/\s+/g, "_")}_${rightDataset.name}`,
    );
  }, [joinType, leftDataset, rightDataset]);

  const projectedColumns = useMemo(
    () =>
      leftDataset && rightDataset
        ? buildProjectedColumns(leftDataset, rightDataset)
        : [],
    [leftDataset, rightDataset],
  );

  const validConditions = useMemo(
    () =>
      conditions.filter(
        (condition) => condition.leftColumn.trim() && condition.rightColumn.trim(),
      ),
    [conditions],
  );

  const joinSQL = useMemo(() => {
    if (!leftDataset || !rightDataset || validConditions.length === 0) {
      return "";
    }

    return buildJoinSelectSQL(
      leftDataset,
      rightDataset,
      joinType,
      validConditions,
    );
  }, [joinType, leftDataset, rightDataset, validConditions]);

  const previewSQL = useMemo(() => {
    if (!joinSQL) {
      return "";
    }

    return `${joinSQL}\nLIMIT 25;`;
  }, [joinSQL]);

  const previewColumns = useMemo(() => {
    if (previewRows.length > 0) {
      return Object.keys(previewRows[0]);
    }

    return projectedColumns.map((column) => column.alias);
  }, [previewRows, projectedColumns]);

  useEffect(() => {
    if (!viewNameEdited) {
      setViewName(suggestedViewName);
    }
  }, [suggestedViewName, viewNameEdited]);

  useEffect(() => {
    if (!leftDataset || !rightDataset) {
      setConditions([]);
      return;
    }

    setConditions((current) => {
      const leftNames = new Set(leftDataset.columns.map((column) => column.name));
      const rightNames = new Set(rightDataset.columns.map((column) => column.name));

      const filtered = current.filter(
        (condition) =>
          leftNames.has(condition.leftColumn) && rightNames.has(condition.rightColumn),
      );

      if (filtered.length > 0) {
        return filtered;
      }

      if (suggestions[0]) {
        return [
          {
            id: createId(),
            leftColumn: suggestions[0].leftColumn,
            rightColumn: suggestions[0].rightColumn,
          },
        ];
      }

      const fallbackLeft = leftDataset.columns[0]?.name;
      const fallbackRight = rightDataset.columns[0]?.name;

      if (!fallbackLeft || !fallbackRight) {
        return [];
      }

      return [
        {
          id: createId(),
          leftColumn: fallbackLeft,
          rightColumn: fallbackRight,
        },
      ];
    });
  }, [leftDataset, rightDataset, suggestions]);

  useEffect(() => {
    let cancelled = false;

    async function loadPreview() {
      if (currentStep !== 3 || !previewSQL) {
        return;
      }

      setIsPreviewLoading(true);
      setPreviewError(null);

      try {
        const rows = await runQuery(previewSQL);
        if (!cancelled) {
          setPreviewRows(rows);
        }
      } catch (error) {
        if (!cancelled) {
          setPreviewRows([]);
          setPreviewError(
            error instanceof Error ? error.message : "Failed to preview join.",
          );
        }
      } finally {
        if (!cancelled) {
          setIsPreviewLoading(false);
        }
      }
    }

    void loadPreview();

    return () => {
      cancelled = true;
    };
  }, [currentStep, previewRefreshKey, previewSQL]);

  const canAdvance = useMemo(() => {
    switch (currentStep) {
      case 0:
        return Boolean(leftDataset && rightDataset);
      case 1:
        return Boolean(joinType);
      case 2:
        return validConditions.length > 0;
      case 3:
        return Boolean(joinSQL) && !isPreviewLoading && !previewError;
      default:
        return false;
    }
  }, [
    currentStep,
    isPreviewLoading,
    joinSQL,
    joinType,
    leftDataset,
    previewError,
    rightDataset,
    validConditions.length,
  ]);

  const addCondition = () => {
    const fallbackLeft = leftDataset?.columns[0]?.name ?? "";
    const fallbackRight = rightDataset?.columns[0]?.name ?? "";

    setConditions((current) => [
      ...current,
      {
        id: createId(),
        leftColumn: fallbackLeft,
        rightColumn: fallbackRight,
      },
    ]);
  };

  const applySuggestion = (suggestion: JoinSuggestion) => {
    setConditions((current) => {
      const alreadyExists = current.some(
        (condition) =>
          condition.leftColumn === suggestion.leftColumn &&
          condition.rightColumn === suggestion.rightColumn,
      );

      if (alreadyExists) {
        return current;
      }

      return [
        ...current,
        {
          id: createId(),
          leftColumn: suggestion.leftColumn,
          rightColumn: suggestion.rightColumn,
        },
      ];
    });
  };

  const updateCondition = (
    id: string,
    side: "leftColumn" | "rightColumn",
    value: string,
  ) => {
    setConditions((current) =>
      current.map((condition) =>
        condition.id === id ? { ...condition, [side]: value } : condition,
      ),
    );
  };

  const removeCondition = (id: string) => {
    setConditions((current) => current.filter((condition) => condition.id !== id));
  };

  const handleRefreshPreview = () => {
    setPreviewRefreshKey((value) => value + 1);
  };

  const handleSaveView = async () => {
    if (!joinSQL) {
      return;
    }

    const tableName = sanitizeViewName(viewName);
    const sql = `CREATE OR REPLACE VIEW ${quoteIdentifier(tableName)} AS\n${joinSQL};`;

    setIsSaving(true);
    setSaveError(null);
    setSaveSuccess(null);

    try {
      await runQuery(sql);
      setSaveSuccess(`Saved DuckDB view "${tableName}".`);
      onJoinComplete({ tableName, sql });
    } catch (error) {
      setSaveError(
        error instanceof Error ? error.message : "Failed to save joined view.",
      );
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <section className="overflow-hidden rounded-xl border border-gray-200/70 bg-white/80 backdrop-blur-sm dark:border-gray-700/70 dark:bg-gray-900/60">
      <div className="border-b border-gray-200/70 px-6 py-5 dark:border-gray-700/70">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full border border-sky-300/40 bg-sky-500/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-sky-700 dark:border-sky-700/40 dark:text-sky-300">
              <Sparkles className="h-3.5 w-3.5" />
              Join Builder
            </div>
            <h2 className="mt-3 text-xl font-semibold text-gray-900 dark:text-gray-50">
              Compose a reusable DuckDB view from two datasets
            </h2>
            <p className="mt-2 max-w-2xl text-sm text-gray-600 dark:text-gray-300">
              Pick source tables, choose the join strategy, map matching keys, preview
              the generated SQL, then save the result as a view you can query anywhere
              in DataLens.
            </p>
          </div>

          <div className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
            <div className="rounded-xl border border-gray-200/70 bg-gray-50/80 px-3 py-2 dark:border-gray-700/70 dark:bg-gray-950/30">
              <p className="text-gray-500 dark:text-gray-400">Datasets</p>
              <p className="mt-1 font-semibold text-gray-900 dark:text-gray-100">
                {datasets.length}
              </p>
            </div>
            <div className="rounded-xl border border-gray-200/70 bg-gray-50/80 px-3 py-2 dark:border-gray-700/70 dark:bg-gray-950/30">
              <p className="text-gray-500 dark:text-gray-400">Join Type</p>
              <p className="mt-1 font-semibold text-gray-900 dark:text-gray-100">
                {joinType}
              </p>
            </div>
            <div className="rounded-xl border border-gray-200/70 bg-gray-50/80 px-3 py-2 dark:border-gray-700/70 dark:bg-gray-950/30">
              <p className="text-gray-500 dark:text-gray-400">Keys</p>
              <p className="mt-1 font-semibold text-gray-900 dark:text-gray-100">
                {validConditions.length}
              </p>
            </div>
            <div className="rounded-xl border border-gray-200/70 bg-gray-50/80 px-3 py-2 dark:border-gray-700/70 dark:bg-gray-950/30">
              <p className="text-gray-500 dark:text-gray-400">Preview Fields</p>
              <p className="mt-1 font-semibold text-gray-900 dark:text-gray-100">
                {projectedColumns.length}
              </p>
            </div>
          </div>
        </div>

        <div className="mt-6 grid gap-3 sm:grid-cols-5">
          {STEP_META.map((step, index) => {
            const Icon = step.icon;
            const isActive = currentStep === index;
            const isComplete = currentStep > index;

            return (
              <div
                key={step.label}
                className={`flex items-center gap-3 rounded-xl border px-4 py-3 text-sm transition-colors ${
                  isActive
                    ? "border-sky-400 bg-sky-500/10 text-sky-800 dark:border-sky-600 dark:text-sky-200"
                    : isComplete
                      ? "border-emerald-300 bg-emerald-500/10 text-emerald-700 dark:border-emerald-700 dark:text-emerald-300"
                      : "border-gray-200/70 bg-gray-50/70 text-gray-500 dark:border-gray-700/70 dark:bg-gray-950/30 dark:text-gray-400"
                }`}
              >
                <div className="flex h-9 w-9 items-center justify-center rounded-full border border-current/20 bg-white/70 dark:bg-gray-950/40">
                  {isComplete ? (
                    <CheckCircle2 className="h-4 w-4" />
                  ) : (
                    <Icon className="h-4 w-4" />
                  )}
                </div>
                <div>
                  <p className="text-[10px] uppercase tracking-[0.18em] opacity-70">
                    Step {index + 1}
                  </p>
                  <p className="font-semibold">{step.label}</p>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="px-6 py-6">
        {datasets.length < 2 ? (
          <div className="rounded-xl border border-amber-300/50 bg-amber-500/10 p-4 text-sm text-amber-900 dark:border-amber-800/50 dark:text-amber-200">
            <div className="flex items-start gap-3">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <div>
                <p className="font-semibold">At least two datasets are required.</p>
                <p className="mt-1 text-amber-800/90 dark:text-amber-300/90">
                  Load one more dataset into DuckDB-WASM before opening the join wizard.
                </p>
              </div>
            </div>
          </div>
        ) : (
          <>
            <AnimatePresence mode="wait">
              <motion.div
                key={currentStep}
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -12 }}
                transition={{ duration: 0.22 }}
                className="space-y-6"
              >
                {currentStep === 0 && (
                  <div className="grid gap-6 xl:grid-cols-2">
                    <div className="space-y-3">
                      <div className="flex items-center gap-2 text-sm font-semibold text-gray-900 dark:text-gray-100">
                        <Database className="h-4 w-4 text-sky-500" />
                        Left dataset
                      </div>
                      {datasets.map((dataset) => (
                        <DatasetCard
                          key={`left:${dataset.id}`}
                          dataset={dataset}
                          selected={dataset.id === leftDatasetId}
                          side="left"
                          onSelect={setLeftDatasetId}
                        />
                      ))}
                    </div>

                    <div className="space-y-3">
                      <div className="flex items-center gap-2 text-sm font-semibold text-gray-900 dark:text-gray-100">
                        <Database className="h-4 w-4 text-violet-500" />
                        Right dataset
                      </div>
                      {datasets.map((dataset) => (
                        <DatasetCard
                          key={`right:${dataset.id}`}
                          dataset={dataset}
                          selected={dataset.id === rightDatasetId}
                          side="right"
                          onSelect={setRightDatasetId}
                        />
                      ))}
                    </div>
                  </div>
                )}

                {currentStep === 1 && (
                  <div className="grid gap-4 md:grid-cols-2">
                    {JOIN_OPTIONS.map((option) => (
                      <button
                        key={option.value}
                        type="button"
                        onClick={() => setJoinType(option.value)}
                        className={`rounded-xl border p-5 text-left transition-all ${
                          joinType === option.value
                            ? "border-sky-400 bg-sky-500/10 shadow-lg shadow-sky-500/10"
                            : "border-gray-200/70 bg-white/70 hover:border-gray-300 dark:border-gray-700/70 dark:bg-gray-950/30 dark:hover:border-gray-600"
                        }`}
                      >
                        <div className="flex items-center justify-between gap-3">
                          <div>
                            <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">
                              {option.label}
                            </p>
                            <p className="mt-2 text-sm text-gray-600 dark:text-gray-300">
                              {option.description}
                            </p>
                          </div>
                          {joinType === option.value ? (
                            <CheckCircle2 className="h-5 w-5 shrink-0 text-sky-500" />
                          ) : (
                            <ArrowRightLeft className="h-5 w-5 shrink-0 text-gray-400" />
                          )}
                        </div>
                      </button>
                    ))}
                  </div>
                )}

                {currentStep === 2 && leftDataset && rightDataset && (
                  <div className="space-y-6">
                    <div className="rounded-xl border border-gray-200/70 bg-gray-50/80 p-4 dark:border-gray-700/70 dark:bg-gray-950/30">
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div>
                          <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">
                            Suggested join keys
                          </p>
                          <p className="mt-1 text-sm text-gray-600 dark:text-gray-300">
                            Auto-matches are ranked from column names, types, and uniqueness.
                          </p>
                        </div>
                        <span className="rounded-full bg-white px-3 py-1 text-xs font-medium text-gray-600 shadow-sm dark:bg-gray-900 dark:text-gray-300">
                          {suggestions.length} suggestion{suggestions.length === 1 ? "" : "s"}
                        </span>
                      </div>

                      <div className="mt-4 flex flex-wrap gap-2">
                        {suggestions.length === 0 ? (
                          <div className="rounded-lg border border-dashed border-gray-300/70 px-3 py-2 text-sm text-gray-500 dark:border-gray-700/70 dark:text-gray-400">
                            No strong auto-matches found. Pick columns manually below.
                          </div>
                        ) : (
                          suggestions.map((suggestion) => (
                            <button
                              key={suggestion.id}
                              type="button"
                              onClick={() => applySuggestion(suggestion)}
                              className="rounded-full border border-sky-300/40 bg-sky-500/10 px-3 py-2 text-left text-xs text-sky-800 transition-colors hover:bg-sky-500/15 dark:border-sky-700/40 dark:text-sky-200"
                            >
                              <span className="font-semibold">
                                {suggestion.leftColumn}
                              </span>
                              <span className="mx-1 text-sky-500">=</span>
                              <span className="font-semibold">
                                {suggestion.rightColumn}
                              </span>
                              <span className="ml-2 text-sky-700/70 dark:text-sky-300/70">
                                {suggestion.reason}
                              </span>
                            </button>
                          ))
                        )}
                      </div>
                    </div>

                    <div className="space-y-3">
                      {conditions.map((condition, index) => (
                        <div
                          key={condition.id}
                          className="grid gap-3 rounded-xl border border-gray-200/70 bg-white/70 p-4 dark:border-gray-700/70 dark:bg-gray-950/30 lg:grid-cols-[1fr_auto_1fr_auto]"
                        >
                          <label className="space-y-2">
                            <span className="text-xs font-semibold uppercase tracking-[0.18em] text-gray-500 dark:text-gray-400">
                              Left key {index + 1}
                            </span>
                            <select
                              value={condition.leftColumn}
                              onChange={(event) =>
                                updateCondition(
                                  condition.id,
                                  "leftColumn",
                                  event.target.value,
                                )
                              }
                              className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 outline-none transition focus:border-sky-400 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100"
                            >
                              {leftDataset.columns.map((column) => (
                                <option key={column.name} value={column.name}>
                                  {column.name}
                                </option>
                              ))}
                            </select>
                          </label>

                          <div className="flex items-end justify-center pb-2">
                            <div className="rounded-full bg-gray-100 p-2 text-gray-500 dark:bg-gray-800 dark:text-gray-300">
                              <Link2 className="h-4 w-4" />
                            </div>
                          </div>

                          <label className="space-y-2">
                            <span className="text-xs font-semibold uppercase tracking-[0.18em] text-gray-500 dark:text-gray-400">
                              Right key {index + 1}
                            </span>
                            <select
                              value={condition.rightColumn}
                              onChange={(event) =>
                                updateCondition(
                                  condition.id,
                                  "rightColumn",
                                  event.target.value,
                                )
                              }
                              className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 outline-none transition focus:border-sky-400 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100"
                            >
                              {rightDataset.columns.map((column) => (
                                <option key={column.name} value={column.name}>
                                  {column.name}
                                </option>
                              ))}
                            </select>
                          </label>

                          <div className="flex items-end justify-end pb-2">
                            <button
                              type="button"
                              onClick={() => removeCondition(condition.id)}
                              disabled={conditions.length === 1}
                              className="rounded-lg border border-gray-200 p-2 text-gray-500 transition hover:border-red-300 hover:text-red-500 disabled:cursor-not-allowed disabled:opacity-40 dark:border-gray-700 dark:text-gray-400 dark:hover:border-red-700 dark:hover:text-red-400"
                              aria-label="Remove join condition"
                            >
                              <Trash2 className="h-4 w-4" />
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>

                    <button
                      type="button"
                      onClick={addCondition}
                      className="inline-flex items-center gap-2 rounded-xl border border-dashed border-gray-300 px-4 py-2 text-sm font-medium text-gray-600 transition hover:border-sky-400 hover:text-sky-600 dark:border-gray-700 dark:text-gray-300 dark:hover:border-sky-600 dark:hover:text-sky-300"
                    >
                      <Plus className="h-4 w-4" />
                      Add another join condition
                    </button>
                  </div>
                )}

                {currentStep === 3 && (
                  <div className="space-y-6">
                    <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-gray-200/70 bg-gray-50/80 p-4 dark:border-gray-700/70 dark:bg-gray-950/30">
                      <div>
                        <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">
                          Preview join SQL and sample rows
                        </p>
                        <p className="mt-1 text-sm text-gray-600 dark:text-gray-300">
                          Runs the generated SQL against DuckDB-WASM with a 25-row limit.
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={handleRefreshPreview}
                        disabled={isPreviewLoading || !previewSQL}
                        className="inline-flex items-center gap-2 rounded-xl border border-gray-200 bg-white px-4 py-2 text-sm font-medium text-gray-700 transition hover:border-sky-300 hover:text-sky-700 disabled:cursor-not-allowed disabled:opacity-60 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200 dark:hover:border-sky-700 dark:hover:text-sky-300"
                      >
                        {isPreviewLoading ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <RefreshCw className="h-4 w-4" />
                        )}
                        Refresh preview
                      </button>
                    </div>

                    <div className="rounded-xl border border-gray-200/70 bg-gray-950 p-4 dark:border-gray-700/70">
                      <div className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-sky-300">
                        <Code2 className="h-4 w-4" />
                        Generated SQL
                      </div>
                      <pre className="overflow-x-auto whitespace-pre-wrap text-sm leading-6 text-gray-100">
                        {previewSQL || "-- Configure a valid join to preview SQL"}
                      </pre>
                    </div>

                    {previewError && (
                      <div className="rounded-xl border border-red-300/50 bg-red-500/10 p-4 text-sm text-red-800 dark:border-red-800/50 dark:text-red-200">
                        <div className="flex items-start gap-3">
                          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                          <div>
                            <p className="font-semibold">Preview failed</p>
                            <p className="mt-1">{previewError}</p>
                          </div>
                        </div>
                      </div>
                    )}

                    <div className="space-y-3">
                      <div className="flex items-center gap-2 text-sm font-semibold text-gray-900 dark:text-gray-100">
                        <Table2 className="h-4 w-4 text-sky-500" />
                        Result preview
                      </div>
                      <PreviewTable columns={previewColumns} rows={previewRows} />
                    </div>
                  </div>
                )}

                {currentStep === 4 && (
                  <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_340px]">
                    <div className="space-y-4">
                      <div className="rounded-xl border border-gray-200/70 bg-gray-950 p-4 dark:border-gray-700/70">
                        <div className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-sky-300">
                          <Code2 className="h-4 w-4" />
                          Final view SQL
                        </div>
                        <pre className="overflow-x-auto whitespace-pre-wrap text-sm leading-6 text-gray-100">
                          {`CREATE OR REPLACE VIEW ${quoteIdentifier(
                            sanitizeViewName(viewName),
                          )} AS\n${joinSQL || "-- Configure a valid join to save"}`}
                        </pre>
                      </div>

                      {saveError && (
                        <div className="rounded-xl border border-red-300/50 bg-red-500/10 p-4 text-sm text-red-800 dark:border-red-800/50 dark:text-red-200">
                          <div className="flex items-start gap-3">
                            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                            <div>
                              <p className="font-semibold">View save failed</p>
                              <p className="mt-1">{saveError}</p>
                            </div>
                          </div>
                        </div>
                      )}

                      {saveSuccess && (
                        <div className="rounded-xl border border-emerald-300/50 bg-emerald-500/10 p-4 text-sm text-emerald-800 dark:border-emerald-800/50 dark:text-emerald-200">
                          <div className="flex items-start gap-3">
                            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
                            <div>
                              <p className="font-semibold">View created</p>
                              <p className="mt-1">{saveSuccess}</p>
                            </div>
                          </div>
                        </div>
                      )}
                    </div>

                    <div className="space-y-4 rounded-xl border border-gray-200/70 bg-gray-50/80 p-5 dark:border-gray-700/70 dark:bg-gray-950/30">
                      <div>
                        <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">
                          Save settings
                        </p>
                        <p className="mt-1 text-sm text-gray-600 dark:text-gray-300">
                          The join will be stored as a DuckDB view and can be queried by name.
                        </p>
                      </div>

                      <label className="block space-y-2">
                        <span className="text-xs font-semibold uppercase tracking-[0.18em] text-gray-500 dark:text-gray-400">
                          View name
                        </span>
                        <input
                          value={viewName}
                          onChange={(event) => {
                            setViewNameEdited(true);
                            setViewName(event.target.value);
                          }}
                          placeholder="joined_view"
                          className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 outline-none transition focus:border-sky-400 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100"
                        />
                      </label>

                      <div className="rounded-xl border border-gray-200/70 bg-white/80 p-4 text-sm dark:border-gray-700/70 dark:bg-gray-900/70">
                        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-gray-500 dark:text-gray-400">
                          Summary
                        </p>
                        <div className="mt-3 space-y-3 text-gray-700 dark:text-gray-200">
                          <div className="flex items-center justify-between gap-3">
                            <span>Left table</span>
                            <span className="font-semibold">{leftDataset?.name ?? "—"}</span>
                          </div>
                          <div className="flex items-center justify-between gap-3">
                            <span>Right table</span>
                            <span className="font-semibold">{rightDataset?.name ?? "—"}</span>
                          </div>
                          <div className="flex items-center justify-between gap-3">
                            <span>Join type</span>
                            <span className="font-semibold">{joinType}</span>
                          </div>
                          <div className="flex items-center justify-between gap-3">
                            <span>Join keys</span>
                            <span className="font-semibold">{validConditions.length}</span>
                          </div>
                          <div className="flex items-center justify-between gap-3">
                            <span>View name</span>
                            <span className="font-semibold">{sanitizeViewName(viewName)}</span>
                          </div>
                        </div>
                      </div>

                      <button
                        type="button"
                        onClick={() => void handleSaveView()}
                        disabled={isSaving || !joinSQL}
                        className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-sky-600 px-4 py-3 text-sm font-semibold text-white transition hover:bg-sky-500 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        {isSaving ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <Save className="h-4 w-4" />
                        )}
                        Save as view
                      </button>
                    </div>
                  </div>
                )}
              </motion.div>
            </AnimatePresence>

            <div className="mt-8 flex flex-wrap items-center justify-between gap-3 border-t border-gray-200/70 pt-5 dark:border-gray-700/70">
              <div className="text-sm text-gray-500 dark:text-gray-400">
                {leftDataset && rightDataset ? (
                  <span className="inline-flex items-center gap-2">
                    <span className="font-medium text-gray-700 dark:text-gray-200">
                      {leftDataset.name}
                    </span>
                    <ChevronRight className="h-4 w-4" />
                    <span className="rounded-full bg-gray-100 px-2 py-1 text-xs font-semibold uppercase tracking-wide text-gray-600 dark:bg-gray-800 dark:text-gray-300">
                      {joinType}
                    </span>
                    <ChevronRight className="h-4 w-4" />
                    <span className="font-medium text-gray-700 dark:text-gray-200">
                      {rightDataset.name}
                    </span>
                  </span>
                ) : (
                  "Select both datasets to start building the join."
                )}
              </div>

              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => setCurrentStep((step) => Math.max(step - 1, 0))}
                  disabled={currentStep === 0}
                  className="rounded-xl border border-gray-200 px-4 py-2 text-sm font-medium text-gray-700 transition hover:border-gray-300 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-gray-700 dark:text-gray-200 dark:hover:border-gray-600 dark:hover:bg-gray-900"
                >
                  Back
                </button>

                {currentStep < STEP_META.length - 1 && (
                  <button
                    type="button"
                    onClick={() =>
                      setCurrentStep((step) =>
                        Math.min(step + 1, STEP_META.length - 1),
                      )
                    }
                    disabled={!canAdvance}
                    className="inline-flex items-center gap-2 rounded-xl bg-sky-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-sky-500 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    Continue
                    <ChevronRight className="h-4 w-4" />
                  </button>
                )}
              </div>
            </div>
          </>
        )}
      </div>
    </section>
  );
}
