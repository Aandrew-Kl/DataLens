"use client";

import { quoteIdentifier } from "@/lib/utils/sql";
import { useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  ArrowRight,
  Database,
  Eye,
  Loader2,
  RotateCcw,
  Save,
  Sparkles,
  Wand2,
} from "lucide-react";
import { runQuery } from "@/lib/duckdb/client";
import type { ColumnProfile } from "@/types/dataset";

interface ColumnTransformerProps {
  tableName: string;
  columns: ColumnProfile[];
}

type TransformKind =
  | "normalize_minmax"
  | "normalize_zscore"
  | "log"
  | "bin"
  | "label_encode"
  | "one_hot"
  | "extract_year"
  | "extract_month"
  | "extract_day"
  | "trim"
  | "upper"
  | "lower"
  | "regex_replace"
  | "custom";

interface TransformStep {
  id: string;
  sourceColumn: string;
  newColumnName: string;
  kind: TransformKind;
  bins: number;
  matchValue: string;
  regexPattern: string;
  regexReplacement: string;
  customSql: string;
}

interface SavedRecipe {
  id: string;
  name: string;
  steps: TransformStep[];
  savedAt: number;
}

interface TransformHistoryEntry {
  id: string;
  backupTableName: string;
  restoredColumns: ColumnProfile[];
  steps: TransformStep[];
}

const STORAGE_KEY = "datalens:transform-recipes";
const EASE = [0.22, 1, 0.36, 1] as const;
const CARD_CLASS =
  "rounded-[1.75rem] border border-white/20 bg-white/75 shadow-xl shadow-slate-950/10 backdrop-blur-2xl dark:border-white/10 dark:bg-slate-950/45";
function quoteLiteral(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

function createId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function readRecipes(): SavedRecipe[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as SavedRecipe[]) : [];
  } catch {
    return [];
  }
}

function writeRecipes(recipes: SavedRecipe[]) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(recipes));
}

function inferColumnType(step: TransformStep, columns: ColumnProfile[]): ColumnProfile["type"] {
  if (
    step.kind === "normalize_minmax" ||
    step.kind === "normalize_zscore" ||
    step.kind === "log" ||
    step.kind === "bin" ||
    step.kind === "label_encode" ||
    step.kind === "one_hot" ||
    step.kind === "extract_year" ||
    step.kind === "extract_month" ||
    step.kind === "extract_day"
  ) {
    return "number";
  }

  if (step.kind === "custom") {
    return columns.find((column) => column.name === step.sourceColumn)?.type ?? "unknown";
  }

  return "string";
}

function createDefaultStep(sourceColumn: string): TransformStep {
  return {
    id: createId(),
    sourceColumn,
    newColumnName: `${sourceColumn}_transformed`,
    kind: "normalize_minmax",
    bins: 5,
    matchValue: "",
    regexPattern: "",
    regexReplacement: "",
    customSql: "{{column}}",
  };
}

function buildStepQueryParts(step: TransformStep, stageName: string): {
  selectSql: string;
  statsSql?: string;
} {
  const sourceExpr = `${stageName}.${quoteIdentifier(step.sourceColumn)}`;

  switch (step.kind) {
    case "normalize_minmax":
      return {
        statsSql: `SELECT MIN(CAST(${sourceExpr} AS DOUBLE)) AS min_val, MAX(CAST(${sourceExpr} AS DOUBLE)) AS max_val FROM ${stageName}`,
        selectSql: `(CAST(${sourceExpr} AS DOUBLE) - stats.min_val) / NULLIF(stats.max_val - stats.min_val, 0)`,
      };
    case "normalize_zscore":
      return {
        statsSql: `SELECT AVG(CAST(${sourceExpr} AS DOUBLE)) AS mean_val, STDDEV_SAMP(CAST(${sourceExpr} AS DOUBLE)) AS std_val FROM ${stageName}`,
        selectSql: `(CAST(${sourceExpr} AS DOUBLE) - stats.mean_val) / NULLIF(stats.std_val, 0)`,
      };
    case "log":
      return {
        selectSql: `CASE WHEN CAST(${sourceExpr} AS DOUBLE) < 0 THEN NULL ELSE LN(CAST(${sourceExpr} AS DOUBLE) + 1) END`,
      };
    case "bin":
      return {
        statsSql: `SELECT MIN(CAST(${sourceExpr} AS DOUBLE)) AS min_val, MAX(CAST(${sourceExpr} AS DOUBLE)) AS max_val FROM ${stageName}`,
        selectSql: `WIDTH_BUCKET(CAST(${sourceExpr} AS DOUBLE), stats.min_val, stats.max_val, ${Math.max(step.bins, 1)})`,
      };
    case "label_encode":
      return {
        selectSql: `DENSE_RANK() OVER (ORDER BY CAST(${sourceExpr} AS VARCHAR)) - 1`,
      };
    case "one_hot":
      return {
        selectSql: `CASE WHEN CAST(${sourceExpr} AS VARCHAR) = ${quoteLiteral(step.matchValue)} THEN 1 ELSE 0 END`,
      };
    case "extract_year":
      return { selectSql: `EXTRACT(YEAR FROM CAST(${sourceExpr} AS DATE))` };
    case "extract_month":
      return { selectSql: `EXTRACT(MONTH FROM CAST(${sourceExpr} AS DATE))` };
    case "extract_day":
      return { selectSql: `EXTRACT(DAY FROM CAST(${sourceExpr} AS DATE))` };
    case "trim":
      return { selectSql: `TRIM(CAST(${sourceExpr} AS VARCHAR))` };
    case "upper":
      return { selectSql: `UPPER(CAST(${sourceExpr} AS VARCHAR))` };
    case "lower":
      return { selectSql: `LOWER(CAST(${sourceExpr} AS VARCHAR))` };
    case "regex_replace":
      return {
        selectSql: `REGEXP_REPLACE(CAST(${sourceExpr} AS VARCHAR), ${quoteLiteral(step.regexPattern)}, ${quoteLiteral(step.regexReplacement)}, 'g')`,
      };
    case "custom":
      return {
        selectSql: step.customSql.replaceAll("{{column}}", sourceExpr),
      };
  }
}

function buildPipelineSelectSql(tableName: string, steps: TransformStep[]): string {
  if (steps.length === 0) {
    return `SELECT * FROM ${quoteIdentifier(tableName)}`;
  }

  const ctes: string[] = [`stage_0 AS (SELECT * FROM ${quoteIdentifier(tableName)})`];

  steps.forEach((step, index) => {
    const sourceStage = `stage_${index}`;
    const nextStage = `stage_${index + 1}`;
    const parts = buildStepQueryParts(step, sourceStage);

    if (parts.statsSql) {
      ctes.push(`stats_${index} AS (${parts.statsSql})`);
      ctes.push(
        `${nextStage} AS (
          SELECT
            ${sourceStage}.*,
            ${parts.selectSql} AS ${quoteIdentifier(step.newColumnName)}
          FROM ${sourceStage}
          CROSS JOIN stats_${index} stats
        )`,
      );
      return;
    }

    ctes.push(
      `${nextStage} AS (
        SELECT
          ${sourceStage}.*,
          ${parts.selectSql} AS ${quoteIdentifier(step.newColumnName)}
        FROM ${sourceStage}
      )`,
    );
  });

  return `WITH ${ctes.join(",\n")} SELECT * FROM stage_${steps.length}`;
}

function PreviewTable({
  rows,
}: {
  rows: Record<string, unknown>[];
}) {
  const columns = Object.keys(rows[0] ?? {});

  if (rows.length === 0 || columns.length === 0) {
    return (
      <div className="rounded-[1rem] border border-dashed border-white/20 px-4 py-10 text-center text-sm text-slate-500 dark:text-slate-400">
        Preview the first 20 rows before applying the transformation chain.
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-[1rem] border border-white/15 bg-white/55 dark:bg-slate-950/25">
      <div className="overflow-x-auto">
        <table className="min-w-full text-left text-sm">
          <thead className="bg-white/60 dark:bg-slate-900/60">
            <tr>
              {columns.map((column) => (
                <th key={column} className="px-4 py-3 font-semibold text-slate-700 dark:text-slate-200">
                  {column}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => (
              <tr key={`preview-${index}`} className="border-t border-white/10">
                {columns.map((column) => (
                  <td key={`${index}-${column}`} className="px-4 py-3 text-slate-600 dark:text-slate-300">
                    {String(row[column] ?? "")}
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

export default function ColumnTransformer({
  tableName,
  columns,
}: ColumnTransformerProps) {
  const [workingColumns, setWorkingColumns] = useState<ColumnProfile[]>(columns);
  const [draftStep, setDraftStep] = useState<TransformStep>(() =>
    createDefaultStep(columns[0]?.name ?? "column"),
  );
  const [queuedSteps, setQueuedSteps] = useState<TransformStep[]>([]);
  const [previewRows, setPreviewRows] = useState<Record<string, unknown>[]>([]);
  const [recipes, setRecipes] = useState<SavedRecipe[]>(() => readRecipes());
  const [recipeName, setRecipeName] = useState("My transform recipe");
  const [history, setHistory] = useState<TransformHistoryEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const availableColumns = useMemo(
    () => workingColumns.map((column) => column.name),
    [workingColumns],
  );

  const effectiveSteps = useMemo(
    () => [...queuedSteps, draftStep].filter((step) => Boolean(step.sourceColumn && step.newColumnName)),
    [draftStep, queuedSteps],
  );

  function updateDraft(partial: Partial<TransformStep>) {
    setDraftStep((current) => ({ ...current, ...partial }));
  }

  function queueCurrentStep() {
    if (!draftStep.sourceColumn || !draftStep.newColumnName.trim()) {
      setError("Choose a source column and a target column name.");
      return;
    }

    const queuedStep = {
      ...draftStep,
      id: createId(),
      newColumnName: draftStep.newColumnName.trim(),
    };

    setQueuedSteps((current) => [...current, queuedStep]);
    setDraftStep(
      createDefaultStep(queuedStep.newColumnName.trim()),
    );
    setNotice(`Queued ${queuedStep.newColumnName.trim()} for preview and apply.`);
    setError(null);
  }

  async function previewPipeline() {
    if (effectiveSteps.length === 0) {
      setError("Add at least one transformation step first.");
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const sql = `${buildPipelineSelectSql(tableName, effectiveSteps)} LIMIT 20`;
      const rows = await runQuery(sql);
      setPreviewRows(rows);
      setNotice("Preview generated from DuckDB.");
    } catch (previewError) {
      setError(previewError instanceof Error ? previewError.message : "Preview failed.");
    } finally {
      setLoading(false);
    }
  }

  async function applyPipeline() {
    if (effectiveSteps.length === 0) {
      setError("There is nothing to apply.");
      return;
    }

    setLoading(true);
    setError(null);

    const backupTableName = `${tableName}__transform_backup_${Date.now()}`;
    const nextTableName = `${tableName}__transform_next_${Date.now()}`;

    try {
      await runQuery(
        `CREATE OR REPLACE TABLE ${quoteIdentifier(backupTableName)} AS SELECT * FROM ${quoteIdentifier(tableName)}`,
      );
      await runQuery(
        `CREATE OR REPLACE TABLE ${quoteIdentifier(nextTableName)} AS ${buildPipelineSelectSql(tableName, effectiveSteps)}`,
      );
      await runQuery(`DROP TABLE ${quoteIdentifier(tableName)}`);
      await runQuery(
        `ALTER TABLE ${quoteIdentifier(nextTableName)} RENAME TO ${quoteIdentifier(tableName)}`,
      );

      const nextColumns = [
        ...workingColumns,
        ...effectiveSteps.map((step) => ({
          name: step.newColumnName,
          type: inferColumnType(step, workingColumns),
          nullCount: 0,
          uniqueCount: 0,
          sampleValues: [],
        })),
      ];

      setHistory((current) => [
        {
          id: createId(),
          backupTableName,
          restoredColumns: workingColumns,
          steps: effectiveSteps,
        },
        ...current,
      ]);
      setWorkingColumns(nextColumns);
      setQueuedSteps([]);
      setDraftStep(createDefaultStep(effectiveSteps.at(-1)?.newColumnName ?? availableColumns[0] ?? "column"));
      setNotice("Transformation chain applied to the active DuckDB table.");
    } catch (applyError) {
      setError(applyError instanceof Error ? applyError.message : "Apply failed.");
    } finally {
      setLoading(false);
    }
  }

  async function undoLastTransformation() {
    const latest = history[0];
    if (!latest) {
      setError("There is no transformation to undo.");
      return;
    }

    const restoreTableName = `${tableName}__restore_${Date.now()}`;
    setLoading(true);
    setError(null);

    try {
      await runQuery(
        `CREATE OR REPLACE TABLE ${quoteIdentifier(restoreTableName)} AS SELECT * FROM ${quoteIdentifier(latest.backupTableName)}`,
      );
      await runQuery(`DROP TABLE ${quoteIdentifier(tableName)}`);
      await runQuery(
        `ALTER TABLE ${quoteIdentifier(restoreTableName)} RENAME TO ${quoteIdentifier(tableName)}`,
      );
      await runQuery(`DROP TABLE ${quoteIdentifier(latest.backupTableName)}`);

      setHistory((current) => current.slice(1));
      setWorkingColumns(latest.restoredColumns);
      setNotice("Last transformation chain was undone.");
    } catch (undoError) {
      setError(undoError instanceof Error ? undoError.message : "Undo failed.");
    } finally {
      setLoading(false);
    }
  }

  function saveRecipe() {
    if (!recipeName.trim() || effectiveSteps.length === 0) {
      setError("Provide a recipe name and at least one step.");
      return;
    }

    const nextRecipes = [
      {
        id: createId(),
        name: recipeName.trim(),
        steps: effectiveSteps,
        savedAt: Date.now(),
      },
      ...recipes,
    ].slice(0, 12);

    setRecipes(nextRecipes);
    writeRecipes(nextRecipes);
    setNotice(`Saved recipe ${recipeName.trim()}.`);
  }

  function loadRecipe(recipe: SavedRecipe) {
    setQueuedSteps(recipe.steps.slice(0, Math.max(recipe.steps.length - 1, 0)));
    setDraftStep(recipe.steps.at(-1) ?? createDefaultStep(availableColumns[0] ?? "column"));
    setNotice(`Loaded recipe ${recipe.name}.`);
  }

  return (
    <section className={`${CARD_CLASS} overflow-hidden p-5`}>
      <div className="flex flex-col gap-5 border-b border-white/15 pb-5 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex items-center gap-4">
          <div className="flex h-12 w-12 items-center justify-center rounded-[1.25rem] bg-cyan-500/10 text-cyan-700 dark:text-cyan-300">
            <Wand2 className="h-5 w-5" />
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-slate-500 dark:text-slate-400">
              Column Transformer
            </p>
            <h2 className="mt-1 text-xl font-semibold text-slate-950 dark:text-slate-50">
              Build reusable DuckDB-backed transformation chains
            </h2>
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => void undoLastTransformation()}
            className="inline-flex items-center gap-2 rounded-[1rem] border border-white/15 bg-white/45 px-4 py-3 text-sm text-slate-700 transition hover:bg-white/60 dark:bg-slate-900/30 dark:text-slate-200"
          >
            <RotateCcw className="h-4 w-4" />
            Undo last
          </button>
          <button
            type="button"
            onClick={saveRecipe}
            className="inline-flex items-center gap-2 rounded-[1rem] bg-cyan-600 px-4 py-3 text-sm font-semibold text-white transition hover:bg-cyan-500"
          >
            <Save className="h-4 w-4" />
            Save recipe
          </button>
        </div>
      </div>

      {error ? (
        <div className="mt-4 rounded-[1.2rem] border border-rose-400/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-700 dark:text-rose-300">
          {error}
        </div>
      ) : null}
      {notice ? (
        <div className="mt-4 rounded-[1.2rem] border border-cyan-400/20 bg-cyan-500/10 px-4 py-3 text-sm text-cyan-800 dark:text-cyan-300">
          {notice}
        </div>
      ) : null}

      <div className="mt-5 grid gap-5 xl:grid-cols-[1.05fr_0.95fr]">
        <div className="space-y-4">
          <motion.div
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.28, ease: EASE }}
            className="rounded-[1.4rem] border border-white/15 bg-white/45 p-4 dark:bg-slate-900/30"
          >
            <div className="grid gap-3 md:grid-cols-2">
              <select
                value={draftStep.sourceColumn}
                onChange={(event) => updateDraft({ sourceColumn: event.target.value })}
                className="rounded-[1rem] border border-white/20 bg-white/75 px-4 py-3 text-sm text-slate-900 outline-none dark:bg-slate-950/60 dark:text-slate-50"
              >
                {availableColumns.map((column) => (
                  <option key={column} value={column}>
                    {column}
                  </option>
                ))}
              </select>
              <input
                value={draftStep.newColumnName}
                onChange={(event) => updateDraft({ newColumnName: event.target.value })}
                placeholder="New column name"
                className="rounded-[1rem] border border-white/20 bg-white/75 px-4 py-3 text-sm text-slate-900 outline-none dark:bg-slate-950/60 dark:text-slate-50"
              />
              <select
                value={draftStep.kind}
                onChange={(event) => updateDraft({ kind: event.target.value as TransformKind })}
                className="rounded-[1rem] border border-white/20 bg-white/75 px-4 py-3 text-sm text-slate-900 outline-none dark:bg-slate-950/60 dark:text-slate-50"
              >
                <option value="normalize_minmax">Normalize · Min-max</option>
                <option value="normalize_zscore">Normalize · Z-score</option>
                <option value="log">Log transform</option>
                <option value="bin">Bin / bucket</option>
                <option value="one_hot">Encode · One-hot</option>
                <option value="label_encode">Encode · Label</option>
                <option value="extract_year">Extract year</option>
                <option value="extract_month">Extract month</option>
                <option value="extract_day">Extract day</option>
                <option value="trim">String · Trim</option>
                <option value="upper">String · Upper</option>
                <option value="lower">String · Lower</option>
                <option value="regex_replace">String · Regex replace</option>
                <option value="custom">Custom SQL expression</option>
              </select>
              <input
                value={recipeName}
                onChange={(event) => setRecipeName(event.target.value)}
                placeholder="Recipe name"
                className="rounded-[1rem] border border-white/20 bg-white/75 px-4 py-3 text-sm text-slate-900 outline-none dark:bg-slate-950/60 dark:text-slate-50"
              />
            </div>

            <AnimatePresence mode="wait">
              {draftStep.kind === "bin" ? (
                <motion.div
                  key="bin"
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -8 }}
                  transition={{ duration: 0.2, ease: EASE }}
                  className="mt-4"
                >
                  <input
                    type="number"
                    min={2}
                    max={20}
                    value={draftStep.bins}
                    onChange={(event) => updateDraft({ bins: Math.max(Number(event.target.value), 2) })}
                    className="w-full rounded-[1rem] border border-white/20 bg-white/75 px-4 py-3 text-sm text-slate-900 outline-none dark:bg-slate-950/60 dark:text-slate-50"
                  />
                </motion.div>
              ) : null}
              {draftStep.kind === "one_hot" ? (
                <motion.div
                  key="one-hot"
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -8 }}
                  transition={{ duration: 0.2, ease: EASE }}
                  className="mt-4"
                >
                  <input
                    value={draftStep.matchValue}
                    onChange={(event) => updateDraft({ matchValue: event.target.value })}
                    placeholder="Value to match"
                    className="w-full rounded-[1rem] border border-white/20 bg-white/75 px-4 py-3 text-sm text-slate-900 outline-none dark:bg-slate-950/60 dark:text-slate-50"
                  />
                </motion.div>
              ) : null}
              {draftStep.kind === "regex_replace" ? (
                <motion.div
                  key="regex"
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -8 }}
                  transition={{ duration: 0.2, ease: EASE }}
                  className="mt-4 grid gap-3 md:grid-cols-2"
                >
                  <input
                    value={draftStep.regexPattern}
                    onChange={(event) => updateDraft({ regexPattern: event.target.value })}
                    placeholder="Regex pattern"
                    className="rounded-[1rem] border border-white/20 bg-white/75 px-4 py-3 text-sm text-slate-900 outline-none dark:bg-slate-950/60 dark:text-slate-50"
                  />
                  <input
                    value={draftStep.regexReplacement}
                    onChange={(event) => updateDraft({ regexReplacement: event.target.value })}
                    placeholder="Replacement"
                    className="rounded-[1rem] border border-white/20 bg-white/75 px-4 py-3 text-sm text-slate-900 outline-none dark:bg-slate-950/60 dark:text-slate-50"
                  />
                </motion.div>
              ) : null}
              {draftStep.kind === "custom" ? (
                <motion.div
                  key="custom"
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -8 }}
                  transition={{ duration: 0.2, ease: EASE }}
                  className="mt-4"
                >
                  <textarea
                    value={draftStep.customSql}
                    onChange={(event) => updateDraft({ customSql: event.target.value })}
                    rows={4}
                    className="w-full rounded-[1rem] border border-white/20 bg-white/75 px-4 py-3 text-sm text-slate-900 outline-none dark:bg-slate-950/60 dark:text-slate-50"
                  />
                  <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
                    Use <code>{"{{column}}"}</code> as the source column placeholder.
                  </p>
                </motion.div>
              ) : null}
            </AnimatePresence>

            <div className="mt-4 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={queueCurrentStep}
                className="inline-flex items-center gap-2 rounded-[1rem] border border-white/15 bg-white/55 px-4 py-3 text-sm text-slate-700 transition hover:bg-white/70 dark:bg-slate-950/35 dark:text-slate-200"
              >
                <Sparkles className="h-4 w-4" />
                Add to chain
              </button>
              <button
                type="button"
                onClick={() => void previewPipeline()}
                className="inline-flex items-center gap-2 rounded-[1rem] bg-cyan-600 px-4 py-3 text-sm font-semibold text-white transition hover:bg-cyan-500"
              >
                {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Eye className="h-4 w-4" />}
                Preview
              </button>
              <button
                type="button"
                onClick={() => void applyPipeline()}
                className="inline-flex items-center gap-2 rounded-[1rem] bg-emerald-600 px-4 py-3 text-sm font-semibold text-white transition hover:bg-emerald-500"
              >
                <Database className="h-4 w-4" />
                Apply chain
              </button>
            </div>
          </motion.div>

          <div className="rounded-[1.4rem] border border-white/15 bg-white/45 p-4 dark:bg-slate-900/30">
            <p className="text-sm font-semibold text-slate-900 dark:text-slate-50">
              Transformation chain
            </p>
            <div className="mt-4 space-y-3">
              {effectiveSteps.length === 0 ? (
                <p className="text-sm text-slate-500 dark:text-slate-400">
                  Queue steps to see the chain that will be applied.
                </p>
              ) : (
                effectiveSteps.map((step, index) => (
                  <div
                    key={step.id}
                    className="flex items-center gap-3 rounded-[1rem] border border-white/15 bg-white/55 px-4 py-3 dark:bg-slate-950/25"
                  >
                    <span className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400">
                      {index + 1}
                    </span>
                    <span className="text-sm text-slate-700 dark:text-slate-200">
                      {step.sourceColumn}
                    </span>
                    <ArrowRight className="h-4 w-4 text-slate-400" />
                    <span className="text-sm font-semibold text-slate-900 dark:text-slate-50">
                      {step.newColumnName}
                    </span>
                    <span className="ml-auto text-xs text-slate-500 dark:text-slate-400">
                      {step.kind}
                    </span>
                  </div>
                ))
              )}
            </div>
          </div>

          <div className="rounded-[1.4rem] border border-white/15 bg-white/45 p-4 dark:bg-slate-900/30">
            <p className="text-sm font-semibold text-slate-900 dark:text-slate-50">Saved recipes</p>
            <div className="mt-4 space-y-3">
              {recipes.length === 0 ? (
                <p className="text-sm text-slate-500 dark:text-slate-400">
                  Save a chain to reuse it later from localStorage.
                </p>
              ) : (
                recipes.map((recipe) => (
                  <button
                    key={recipe.id}
                    type="button"
                    onClick={() => loadRecipe(recipe)}
                    className="w-full rounded-[1rem] border border-white/15 bg-white/55 px-4 py-3 text-left transition hover:bg-white/70 dark:bg-slate-950/25 dark:hover:bg-slate-950/40"
                  >
                    <p className="text-sm font-semibold text-slate-900 dark:text-slate-50">{recipe.name}</p>
                    <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                      {recipe.steps.length} step(s)
                    </p>
                  </button>
                ))
              )}
            </div>
          </div>
        </div>

        <div className="space-y-4">
          <div className="rounded-[1.4rem] border border-white/15 bg-white/45 p-4 dark:bg-slate-900/30">
            <p className="text-sm font-semibold text-slate-900 dark:text-slate-50">
              Before / after preview
            </p>
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
              DuckDB evaluates the current chain and returns the first twenty rows.
            </p>
            <div className="mt-4">
              <PreviewTable rows={previewRows} />
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
