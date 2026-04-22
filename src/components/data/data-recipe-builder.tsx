"use client";

import { useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  ChefHat,
  Download,
  Filter,
  FunctionSquare,
  Loader2,
  Play,
  Plus,
  Save,
  Sigma,
  SortAsc,
  Trash2,
  Upload,
} from "lucide-react";
import { runQuery } from "@/lib/duckdb/client";
import {
  ANALYTICS_EASE,
  BUTTON_CLASS,
  FIELD_CLASS,
  GLASS_CARD_CLASS,
  GLASS_PANEL_CLASS,
  quoteIdentifier,
  quoteLiteral,
} from "@/lib/utils/advanced-analytics";
import { downloadFile } from "@/lib/utils/export";
import { formatNumber } from "@/lib/utils/formatters";
import { buildMetricExpression } from "@/lib/utils/sql";
import type { ColumnProfile } from "@/types/dataset";

interface DataRecipeBuilderProps {
  tableName: string;
  columns: ColumnProfile[];
}

type RecipeStepType = "rename" | "filter" | "derive" | "aggregate" | "sort";
type RecipeFilterOperator = "=" | "!=" | ">" | ">=" | "<" | "<=" | "contains";
type RecipeSortDirection = "ASC" | "DESC";
type RecipeAggregate = "COUNT" | "SUM" | "AVG" | "MIN" | "MAX";

interface RecipeStep {
  id: string;
  type: RecipeStepType;
  sourceColumn: string;
  targetColumn: string;
  filterOperator: RecipeFilterOperator;
  filterValue: string;
  expression: string;
  aggregateFunction: RecipeAggregate;
  aggregateColumn: string;
  groupByColumns: string[];
  sortDirection: RecipeSortDirection;
}

interface SavedRecipe {
  id: string;
  name: string;
  description: string;
  steps: RecipeStep[];
  savedAt: number;
}

const STORAGE_KEY = "datalens:data-recipes";
const FILTER_OPERATORS = ["=", "!=", ">", ">=", "<", "<=", "contains"] as const;
const SORT_DIRECTIONS = ["ASC", "DESC"] as const;
const AGGREGATIONS = ["COUNT", "SUM", "AVG", "MIN", "MAX"] as const;
const RECIPE_STEP_OPTIONS = [
  { type: "rename", label: "Rename", icon: ChefHat },
  { type: "filter", label: "Filter", icon: Filter },
  { type: "derive", label: "Derive", icon: FunctionSquare },
  { type: "aggregate", label: "Aggregate", icon: Sigma },
  { type: "sort", label: "Sort", icon: SortAsc },
] as const satisfies ReadonlyArray<{
  type: RecipeStepType;
  label: string;
  icon: typeof ChefHat;
}>;

function createRecipeStepId() {
  return `recipe-step-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function readRecipes() {
  if (typeof window === "undefined") return [] as SavedRecipe[];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? (JSON.parse(raw) as SavedRecipe[]) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeRecipes(recipes: SavedRecipe[]) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(recipes));
}

function toggleSelection(current: string[], value: string) {
  return current.includes(value)
    ? current.filter((entry) => entry !== value)
    : [...current, value];
}

function createRecipeStep(type: RecipeStepType, columns: ColumnProfile[]): RecipeStep {
  const firstColumn = columns[0]?.name ?? "";
  const firstNumeric = columns.find((column) => column.type === "number")?.name ?? firstColumn;
  return {
    id: createRecipeStepId(),
    type,
    sourceColumn: firstColumn,
    targetColumn: firstColumn ? `${firstColumn}_new` : "new_column",
    filterOperator: "=",
    filterValue: "",
    expression: firstColumn ? `CAST(${quoteIdentifier(firstColumn)} AS VARCHAR)` : "NULL",
    aggregateFunction: "COUNT",
    aggregateColumn: firstNumeric,
    groupByColumns: firstColumn ? [firstColumn] : [],
    sortDirection: "ASC",
  };
}

function buildFilterClause(step: RecipeStep) {
  const column = quoteIdentifier(step.sourceColumn);
  if (step.filterOperator === "contains") {
    return `${column} IS NOT NULL AND LOWER(CAST(${column} AS VARCHAR)) LIKE LOWER(${quoteLiteral(`%${step.filterValue}%`)})`;
  }
  return `${column} ${step.filterOperator} ${quoteLiteral(step.filterValue)}`;
}

function buildAggregateExpression(step: RecipeStep) {
  if (step.aggregateFunction === "COUNT") {
    return "COUNT(*)";
  }
  return buildMetricExpression(
    step.aggregateFunction,
    step.aggregateColumn,
    (column) => `TRY_CAST(${quoteIdentifier(column)} AS DOUBLE)`,
    { cast: false },
  );
}

function compileRecipe(tableName: string, steps: RecipeStep[]) {
  let source = quoteIdentifier(tableName);
  const ctes: string[] = [];

  for (let index = 0; index < steps.length; index += 1) {
    const step = steps[index];
    const cteName = `recipe_stage_${index + 1}`;
    let sql = "";

    if (step.type === "rename") {
      sql = `SELECT * REPLACE (${quoteIdentifier(step.sourceColumn)} AS ${quoteIdentifier(step.targetColumn.trim() || `${step.sourceColumn}_new`)}) FROM ${source}`;
    } else if (step.type === "filter") {
      sql = `SELECT * FROM ${source} WHERE ${buildFilterClause(step)}`;
    } else if (step.type === "derive") {
      const alias = step.targetColumn.trim() || "derived_value";
      sql = `SELECT *, ${step.expression.trim() || "NULL"} AS ${quoteIdentifier(alias)} FROM ${source}`;
    } else if (step.type === "aggregate") {
      const groups = step.groupByColumns.filter(Boolean);
      const alias = step.targetColumn.trim() || "metric_value";
      sql = [
        "SELECT",
        `  ${[...groups.map((column) => quoteIdentifier(column)), `${buildAggregateExpression(step)} AS ${quoteIdentifier(alias)}`].join(",\n  ")}`,
        `FROM ${source}`,
        groups.length > 0
          ? `GROUP BY ${groups.map((column) => quoteIdentifier(column)).join(", ")}`
          : "",
      ]
        .filter(Boolean)
        .join("\n");
    } else if (step.type === "sort") {
      sql = `SELECT * FROM ${source} ORDER BY ${quoteIdentifier(step.sourceColumn)} ${step.sortDirection} NULLS LAST`;
    }

    ctes.push(`${quoteIdentifier(cteName)} AS (${sql})`);
    source = quoteIdentifier(cteName);
  }

  if (ctes.length === 0) {
    return `SELECT * FROM ${quoteIdentifier(tableName)}`;
  }
  return `WITH ${ctes.join(",\n")} SELECT * FROM ${source}`;
}

function PreviewTable({ rows }: { rows: Record<string, unknown>[] }) {
  if (rows.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-white/20 px-4 py-8 text-sm text-slate-500 dark:text-slate-400">
        Apply the recipe to inspect the transformed output.
      </div>
    );
  }
  const headers = Object.keys(rows[0] ?? {});
  return (
    <div className="overflow-x-auto rounded-2xl border border-white/20">
      <table className="min-w-full text-left text-sm text-slate-700 dark:text-slate-200">
        <thead className="bg-slate-950/5 text-xs uppercase tracking-[0.16em] text-slate-500 dark:bg-white/5 dark:text-slate-400">
          <tr>
            {headers.map((header) => (
              <th key={header} className="px-4 py-3">
                {header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, rowIndex) => (
            <tr key={`recipe-row-${rowIndex}`} className="border-t border-white/15">
              {headers.map((header) => (
                <td key={`${rowIndex}-${header}`} className="px-4 py-3">
                  {String(row[header] ?? "—")}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function DataRecipeBuilder({
  tableName,
  columns,
}: DataRecipeBuilderProps) {
  const columnNames = useMemo(() => columns.map((column) => column.name), [columns]);
  const [recipeName, setRecipeName] = useState("Reusable recipe");
  const [recipeDescription, setRecipeDescription] = useState("");
  const [steps, setSteps] = useState<RecipeStep[]>([]);
  const [savedRecipes, setSavedRecipes] = useState<SavedRecipe[]>(() => readRecipes());
  const [importText, setImportText] = useState("");
  const [previewRows, setPreviewRows] = useState<Record<string, unknown>[]>([]);
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState(
    "Build a reusable recipe, save it to localStorage, then apply it to the current table.",
  );

  const compiledSql = useMemo(() => compileRecipe(tableName, steps), [steps, tableName]);

  function updateStep(stepId: string, patch: Partial<RecipeStep>) {
    setSteps((current) =>
      current.map((step) => (step.id === stepId ? { ...step, ...patch } : step)),
    );
  }

  function saveRecipe() {
    const nextRecipe: SavedRecipe = {
      id: `recipe-${Date.now().toString(36)}`,
      name: recipeName.trim() || "Reusable recipe",
      description: recipeDescription.trim(),
      steps,
      savedAt: Date.now(),
    };
    const nextRecipes = [nextRecipe, ...savedRecipes].slice(0, 20);
    setSavedRecipes(nextRecipes);
    writeRecipes(nextRecipes);
    setNotice(`Saved "${nextRecipe.name}" to localStorage.`);
  }

  async function applyRecipe(targetSteps: RecipeStep[] = steps) {
    setLoading(true);
    setNotice("Applying recipe to the current table...");

    try {
      const sql = compileRecipe(tableName, targetSteps);
      const rows = await runQuery(`SELECT * FROM (${sql}) AS recipe_output LIMIT 12`);
      setPreviewRows(rows);
      setNotice(`Applied recipe and previewed ${formatNumber(rows.length)} rows.`);
    } catch (error) {
      setPreviewRows([]);
      setNotice(error instanceof Error ? error.message : "Recipe application failed.");
    } finally {
      setLoading(false);
    }
  }

  function exportRecipes() {
    downloadFile(
      JSON.stringify(savedRecipes, null, 2),
      "datalens-recipes.json",
      "application/json;charset=utf-8;",
    );
  }

  function importRecipes() {
    try {
      const parsed = JSON.parse(importText) as SavedRecipe[];
      if (!Array.isArray(parsed)) {
        throw new Error("Imported recipe payload must be an array.");
      }
      setSavedRecipes(parsed);
      writeRecipes(parsed);
      setNotice(`Imported ${formatNumber(parsed.length)} recipes.`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Recipe import failed.");
    }
  }

  return (
    <motion.section
      initial={{ opacity: 0, y: 18 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.28, ease: ANALYTICS_EASE }}
      className={`${GLASS_PANEL_CLASS} space-y-6 p-6`}
    >
      <div className="flex flex-col gap-4 border-b border-white/20 pb-6 dark:border-white/10 xl:flex-row xl:items-start xl:justify-between">
        <div className="space-y-3">
          <div className="inline-flex items-center gap-2 rounded-full border border-cyan-500/20 bg-cyan-500/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.2em] text-cyan-700 dark:text-cyan-300">
            <ChefHat className="h-3.5 w-3.5" />
            Data Recipe Builder
          </div>
          <div>
            <h2 className="text-2xl font-semibold text-slate-950 dark:text-white">
              Build reusable transformation recipes for any table
            </h2>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600 dark:text-slate-300">
              Combine rename, filter, derive, aggregate, and sort steps into a named recipe.
              Save recipes to localStorage, export them as JSON, import them later, and apply
              them to the current dataset instantly.
            </p>
          </div>
        </div>
        <div className="grid gap-3 md:grid-cols-2">
          <input
            aria-label="Recipe name"
            value={recipeName}
            onChange={(event) => setRecipeName(event.currentTarget.value)}
            className={FIELD_CLASS}
            placeholder="Recipe name"
          />
          <textarea
            aria-label="Recipe description"
            value={recipeDescription}
            onChange={(event) => setRecipeDescription(event.currentTarget.value)}
            className={`${FIELD_CLASS} min-h-24`}
            placeholder="Describe what this recipe does."
          />
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        {RECIPE_STEP_OPTIONS.map((option) => {
          const Icon = option.icon;
          return (
            <button
              key={option.type}
              type="button"
              onClick={() => setSteps((current) => [...current, createRecipeStep(option.type, columns)])}
              className={BUTTON_CLASS}
            >
              <Plus className="h-4 w-4" />
              <Icon className="h-4 w-4" />
              {option.label}
            </button>
          );
        })}
      </div>

      <p className="text-sm text-slate-600 dark:text-slate-300">{notice}</p>

      <div className="grid gap-6 xl:grid-cols-[1.15fr_0.85fr]">
        <div className="space-y-4">
          <AnimatePresence initial={false}>
            {steps.map((step) => (
              <motion.article
                key={step.id}
                layout
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                transition={{ duration: 0.22, ease: ANALYTICS_EASE }}
                className={`${GLASS_CARD_CLASS} space-y-4 p-5`}
              >
                <div className="flex items-center justify-between gap-3">
                  <p className="text-sm font-semibold text-slate-900 dark:text-white">
                    {step.type} step
                  </p>
                  <button
                    type="button"
                    onClick={() => setSteps((current) => current.filter((entry) => entry.id !== step.id))}
                    className={BUTTON_CLASS}
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
                <div className="grid gap-4 md:grid-cols-2">
                  {step.type === "rename" ? (
                    <>
                      <select aria-label={`Rename source ${step.id}`} value={step.sourceColumn} onChange={(event) => updateStep(step.id, { sourceColumn: event.currentTarget.value })} className={FIELD_CLASS}>
                        {columnNames.map((column) => (
                          <option key={column} value={column}>
                            {column}
                          </option>
                        ))}
                      </select>
                      <input aria-label={`Rename target ${step.id}`} value={step.targetColumn} onChange={(event) => updateStep(step.id, { targetColumn: event.currentTarget.value })} className={FIELD_CLASS} placeholder="New column name" />
                    </>
                  ) : null}

                  {step.type === "filter" ? (
                    <>
                      <select aria-label={`Filter source ${step.id}`} value={step.sourceColumn} onChange={(event) => updateStep(step.id, { sourceColumn: event.currentTarget.value })} className={FIELD_CLASS}>
                        {columnNames.map((column) => (
                          <option key={column} value={column}>
                            {column}
                          </option>
                        ))}
                      </select>
                      <select aria-label={`Filter operator ${step.id}`} value={step.filterOperator} onChange={(event) => updateStep(step.id, { filterOperator: event.currentTarget.value as RecipeFilterOperator })} className={FIELD_CLASS}>
                        {FILTER_OPERATORS.map((operator) => (
                          <option key={operator} value={operator}>
                            {operator}
                          </option>
                        ))}
                      </select>
                      <input aria-label={`Filter value ${step.id}`} value={step.filterValue} onChange={(event) => updateStep(step.id, { filterValue: event.currentTarget.value })} className={`${FIELD_CLASS} md:col-span-2`} placeholder="Value" />
                    </>
                  ) : null}

                  {step.type === "derive" ? (
                    <>
                      <input aria-label={`Derive expression ${step.id}`} value={step.expression} onChange={(event) => updateStep(step.id, { expression: event.currentTarget.value })} className={`${FIELD_CLASS} md:col-span-2`} placeholder='Example: "price" - "cost"' />
                      <input aria-label={`Derive alias ${step.id}`} value={step.targetColumn} onChange={(event) => updateStep(step.id, { targetColumn: event.currentTarget.value })} className={FIELD_CLASS} placeholder="Derived alias" />
                    </>
                  ) : null}

                  {step.type === "aggregate" ? (
                    <>
                      <div className="space-y-2 md:col-span-2">
                        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
                          Group by
                        </p>
                        <div className="flex flex-wrap gap-2">
                          {columnNames.map((column) => {
                            const selected = step.groupByColumns.includes(column);
                            return (
                              <button
                                key={column}
                                type="button"
                                onClick={() =>
                                  updateStep(step.id, {
                                    groupByColumns: toggleSelection(step.groupByColumns, column),
                                  })
                                }
                                className={
                                  selected
                                    ? "rounded-full border border-cyan-400/40 bg-cyan-500/10 px-3 py-1.5 text-sm text-cyan-700 dark:text-cyan-300"
                                    : "rounded-full border border-white/20 bg-white/60 px-3 py-1.5 text-sm text-slate-600 dark:bg-slate-950/40 dark:text-slate-300"
                                }
                              >
                                {column}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                      <select aria-label={`Aggregate function ${step.id}`} value={step.aggregateFunction} onChange={(event) => updateStep(step.id, { aggregateFunction: event.currentTarget.value as RecipeAggregate })} className={FIELD_CLASS}>
                        {AGGREGATIONS.map((aggregation) => (
                          <option key={aggregation} value={aggregation}>
                            {aggregation}
                          </option>
                        ))}
                      </select>
                      <select aria-label={`Aggregate column ${step.id}`} value={step.aggregateColumn} onChange={(event) => updateStep(step.id, { aggregateColumn: event.currentTarget.value })} className={FIELD_CLASS}>
                        {columnNames.map((column) => (
                          <option key={column} value={column}>
                            {column}
                          </option>
                        ))}
                      </select>
                      <input aria-label={`Aggregate alias ${step.id}`} value={step.targetColumn} onChange={(event) => updateStep(step.id, { targetColumn: event.currentTarget.value })} className={`${FIELD_CLASS} md:col-span-2`} placeholder="Metric alias" />
                    </>
                  ) : null}

                  {step.type === "sort" ? (
                    <>
                      <select aria-label={`Sort source ${step.id}`} value={step.sourceColumn} onChange={(event) => updateStep(step.id, { sourceColumn: event.currentTarget.value })} className={FIELD_CLASS}>
                        {columnNames.map((column) => (
                          <option key={column} value={column}>
                            {column}
                          </option>
                        ))}
                      </select>
                      <select aria-label={`Sort direction ${step.id}`} value={step.sortDirection} onChange={(event) => updateStep(step.id, { sortDirection: event.currentTarget.value as RecipeSortDirection })} className={FIELD_CLASS}>
                        {SORT_DIRECTIONS.map((direction) => (
                          <option key={direction} value={direction}>
                            {direction}
                          </option>
                        ))}
                      </select>
                    </>
                  ) : null}
                </div>
              </motion.article>
            ))}
          </AnimatePresence>
        </div>

        <div className="space-y-4">
          <div className={`${GLASS_CARD_CLASS} space-y-4 p-5`}>
            <div className="flex flex-wrap items-center gap-3">
              <button type="button" onClick={saveRecipe} className={BUTTON_CLASS}>
                <Save className="h-4 w-4" />
                Save recipe
              </button>
              <button type="button" onClick={() => applyRecipe()} className={BUTTON_CLASS}>
                {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
                Apply recipe
              </button>
              <button type="button" onClick={exportRecipes} className={BUTTON_CLASS}>
                <Download className="h-4 w-4" />
                Export recipes JSON
              </button>
            </div>
            <pre className="overflow-x-auto rounded-2xl bg-slate-950 px-4 py-4 text-xs leading-6 text-slate-100">
              {compiledSql}
            </pre>
          </div>

          <div className={`${GLASS_CARD_CLASS} space-y-4 p-5`}>
            <div className="flex items-center gap-2">
              <Upload className="h-4 w-4 text-cyan-600 dark:text-cyan-300" />
              <p className="text-sm font-semibold text-slate-900 dark:text-white">Import recipes JSON</p>
            </div>
            <textarea
              aria-label="Recipe import JSON"
              value={importText}
              onChange={(event) => setImportText(event.currentTarget.value)}
              className={`${FIELD_CLASS} min-h-32`}
              placeholder='Paste [{"id":"...","name":"...","description":"","steps":[],"savedAt":0}]'
            />
            <button type="button" onClick={importRecipes} className={BUTTON_CLASS}>
              <Upload className="h-4 w-4" />
              Import JSON
            </button>
          </div>

          <div className={`${GLASS_CARD_CLASS} space-y-4 p-5`}>
            <div className="flex items-center justify-between gap-3">
              <p className="text-sm font-semibold text-slate-900 dark:text-white">Saved recipes</p>
              <p className="text-xs uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">
                {formatNumber(savedRecipes.length)} saved
              </p>
            </div>
            <div className="space-y-3">
              {savedRecipes.map((recipe) => (
                <div key={recipe.id} className="rounded-2xl border border-white/20 bg-white/50 p-4 dark:bg-slate-950/25">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-slate-900 dark:text-white">{recipe.name}</p>
                      <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">{recipe.description || "No description"}</p>
                    </div>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          setRecipeName(recipe.name);
                          setRecipeDescription(recipe.description);
                          setSteps(recipe.steps);
                        }}
                        className={BUTTON_CLASS}
                      >
                        Load
                      </button>
                      <button
                        type="button"
                        onClick={() => applyRecipe(recipe.steps)}
                        className={BUTTON_CLASS}
                      >
                        Apply
                      </button>
                    </div>
                  </div>
                </div>
              ))}
              {savedRecipes.length === 0 ? (
                <p className="text-sm text-slate-500 dark:text-slate-400">No recipes saved yet.</p>
              ) : null}
            </div>
          </div>

          <div className={`${GLASS_CARD_CLASS} p-5`}>
            <p className="text-sm font-semibold text-slate-900 dark:text-white">Preview output</p>
            <div className="mt-4">
              <PreviewTable rows={previewRows} />
            </div>
          </div>
        </div>
      </div>
    </motion.section>
  );
}
