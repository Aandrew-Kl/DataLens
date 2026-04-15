"use client";

import { quoteIdentifier } from "@/lib/utils/sql";
import { Loader2, ScissorsLineDashed, Sparkles } from "lucide-react";
import type { Dispatch, SetStateAction } from "react";
import type { ColumnProfile } from "@/types/dataset";
import type { OperationType } from "./wrangler-toolbar";

export type FillStrategy = "constant" | "mean" | "median" | "forward-fill" | "backward-fill";

export interface SplitFormState {
  column: string;
  delimiter: string;
  parts: number;
  prefix: string;
}

export interface MergeFormState {
  columns: string[];
  separator: string;
  output: string;
}

export interface FillFormState {
  column: string;
  strategy: FillStrategy;
  constantValue: string;
}

export interface DateFormState {
  column: string;
  format: string;
  output: string;
}

export interface RegexFormState {
  column: string;
  pattern: string;
  groupNames: string;
}

export interface TrimFormState {
  columns: string[];
}

export interface DedupeFormState {
  columns: string[];
}

export interface BuiltOperation {
  operation: OperationType;
  label: string;
  selectSql: string;
  applySql: string;
}

export interface PreviewRequest extends BuiltOperation {
  requestId: string;
}

const FIELD_CLASS =
  "w-full rounded-2xl border border-white/15 bg-white/75 px-4 py-3 text-sm text-slate-700 outline-none transition focus:border-cyan-400 focus:ring-4 focus:ring-cyan-500/10 dark:border-white/10 dark:bg-slate-950/45 dark:text-slate-100";

export function getTextColumns(columns: ColumnProfile[]) {
  return columns.filter((column) => column.type === "string" || column.type === "unknown");
}

export function getNumericColumns(columns: ColumnProfile[]) {
  return columns.filter((column) => column.type === "number");
}

function quoteLiteral(value: string) {
  return `'${value.replaceAll("'", "''")}'`;
}

function buildSelectList(columns: ColumnProfile[]) {
  return columns.map((column) => quoteIdentifier(column.name)).join(", ");
}

function buildReplacementSelect(columns: ColumnProfile[], replacements: Record<string, string>) {
  return columns.map((column) => `${replacements[column.name] ?? quoteIdentifier(column.name)} AS ${quoteIdentifier(column.name)}`).join(", ");
}

function normalizeOutputName(value: string) {
  return value.trim().replace(/[^a-zA-Z0-9_]+/g, "_").replace(/^_+|_+$/g, "");
}

function ensureUniqueNewColumns(existingColumns: ColumnProfile[], names: string[]) {
  const normalized = names.map(normalizeOutputName).filter(Boolean);
  if (normalized.length !== names.length || new Set(normalized).size !== normalized.length) return null;
  if (normalized.some((name) => existingColumns.some((column) => column.name === name))) return null;
  return normalized;
}

function literalForColumn(column: ColumnProfile | undefined, value: string) {
  if (!column) throw new Error("Choose a valid target column.");
  if (column.type === "number") {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) throw new Error("Constant fill for numeric columns requires a valid number.");
    return String(numeric);
  }
  if (column.type === "boolean") {
    const normalized = value.trim().toLowerCase();
    if (["true", "1", "yes"].includes(normalized)) return "TRUE";
    if (["false", "0", "no"].includes(normalized)) return "FALSE";
    throw new Error("Constant fill for boolean columns accepts true/false values.");
  }
  return quoteLiteral(value);
}

interface BuildWranglerOperationArgs {
  tableName: string;
  workingColumns: ColumnProfile[];
  activeTab: OperationType;
  splitForm: SplitFormState;
  mergeForm: MergeFormState;
  fillForm: FillFormState;
  dateForm: DateFormState;
  regexForm: RegexFormState;
  trimForm: TrimFormState;
  dedupeForm: DedupeFormState;
}

export function buildWranglerOperation(args: BuildWranglerOperationArgs): BuiltOperation {
  const { tableName, workingColumns, activeTab, splitForm, mergeForm, fillForm, dateForm, regexForm, trimForm, dedupeForm } = args;
  const safeTable = quoteIdentifier(tableName);
  const selectList = buildSelectList(workingColumns);
  const numericColumns = getNumericColumns(workingColumns);
  const validateOutputName = (name: string) => {
    const normalized = normalizeOutputName(name);
    return normalized && !workingColumns.some((column) => column.name === normalized) ? normalized : null;
  };

  switch (activeTab) {
    case "split": {
      if (!splitForm.column || splitForm.parts < 2) throw new Error("Choose a text column and at least two output parts.");
      const outputPrefix = normalizeOutputName(splitForm.prefix);
      const splitOutputs = ensureUniqueNewColumns(workingColumns, Array.from({ length: splitForm.parts }, (_, index) => `${outputPrefix}_${index + 1}`));
      if (!outputPrefix || !splitOutputs) throw new Error("Use a unique output prefix for the split columns.");
      const sourceColumn = quoteIdentifier(splitForm.column);
      const additions = splitOutputs.map((output, index) => `split_part(CAST(${sourceColumn} AS VARCHAR), ${quoteLiteral(splitForm.delimiter)}, ${index + 1}) AS ${quoteIdentifier(output)}`).join(", ");
      const selectSql = `SELECT ${selectList}, ${additions} FROM ${safeTable}`;
      return { operation: "split", label: `Split ${splitForm.column} by "${splitForm.delimiter}"`, selectSql, applySql: `CREATE OR REPLACE TABLE ${safeTable} AS ${selectSql}` };
    }
    case "merge": {
      if (mergeForm.columns.length < 2) throw new Error("Pick at least two columns to merge.");
      const outputName = validateOutputName(mergeForm.output);
      if (!outputName) throw new Error("Use a unique output name for the merged column.");
      const expression = `concat_ws(${quoteLiteral(mergeForm.separator)}, ${mergeForm.columns.map((column) => `NULLIF(CAST(${quoteIdentifier(column)} AS VARCHAR), '')`).join(", ")})`;
      const selectSql = `SELECT ${selectList}, ${expression} AS ${quoteIdentifier(outputName)} FROM ${safeTable}`;
      return { operation: "merge", label: `Merge ${mergeForm.columns.join(", ")} into ${outputName}`, selectSql, applySql: `CREATE OR REPLACE TABLE ${safeTable} AS ${selectSql}` };
    }
    case "fill": {
      if (!fillForm.column) throw new Error("Choose a target column to fill.");
      const safeColumn = quoteIdentifier(fillForm.column);
      if (fillForm.strategy === "constant") {
        const replacement = `COALESCE(${safeColumn}, ${literalForColumn(workingColumns.find((column) => column.name === fillForm.column), fillForm.constantValue)})`;
        const selectSql = `SELECT ${buildReplacementSelect(workingColumns, { [fillForm.column]: replacement })} FROM ${safeTable}`;
        return { operation: "fill", label: `Fill nulls in ${fillForm.column} with a constant`, selectSql, applySql: `CREATE OR REPLACE TABLE ${safeTable} AS ${selectSql}` };
      }
      if (fillForm.strategy === "mean" || fillForm.strategy === "median") {
        if (!numericColumns.some((column) => column.name === fillForm.column)) throw new Error("Mean and median fill require a numeric column.");
        const aggregateExpression = fillForm.strategy === "mean" ? `AVG(TRY_CAST(${safeColumn} AS DOUBLE))` : `MEDIAN(TRY_CAST(${safeColumn} AS DOUBLE))`;
        const expression = `COALESCE(TRY_CAST(${safeColumn} AS DOUBLE), stats.fill_value)`;
        const selectSql = `WITH stats AS (SELECT ${aggregateExpression} AS fill_value FROM ${safeTable}) SELECT ${buildReplacementSelect(workingColumns, { [fillForm.column]: expression })} FROM ${safeTable}, stats`;
        return { operation: "fill", label: `Fill nulls in ${fillForm.column} with ${fillForm.strategy}`, selectSql, applySql: `CREATE OR REPLACE TABLE ${safeTable} AS ${selectSql}` };
      }
      const orderedColumnSelect = workingColumns.map((column) => quoteIdentifier(column.name)).join(", ");
      const fillExpression = fillForm.strategy === "forward-fill" ? `COALESCE(${safeColumn}, LAST_VALUE(${safeColumn} IGNORE NULLS) OVER (ORDER BY __row_id ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW))` : `COALESCE(${safeColumn}, FIRST_VALUE(${safeColumn} IGNORE NULLS) OVER (ORDER BY __row_id DESC ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW))`;
      const selectSql = `WITH ordered AS (SELECT ${orderedColumnSelect}, ROW_NUMBER() OVER () AS __row_id FROM ${safeTable}) SELECT ${buildReplacementSelect(workingColumns, { [fillForm.column]: fillExpression })} FROM ordered`;
      return { operation: "fill", label: `${fillForm.strategy === "forward-fill" ? "Forward fill" : "Backward fill"} ${fillForm.column}`, selectSql, applySql: `CREATE OR REPLACE TABLE ${safeTable} AS ${selectSql}` };
    }
    case "dates": {
      if (!dateForm.column) throw new Error("Choose a source column to parse.");
      const outputName = validateOutputName(dateForm.output);
      if (!outputName) throw new Error("Use a unique output column name for parsed dates.");
      const expression = `CAST(try_strptime(CAST(${quoteIdentifier(dateForm.column)} AS VARCHAR), ${quoteLiteral(dateForm.format)}) AS DATE)`;
      const selectSql = `SELECT ${selectList}, ${expression} AS ${quoteIdentifier(outputName)} FROM ${safeTable}`;
      return { operation: "dates", label: `Parse ${dateForm.column} into ${outputName}`, selectSql, applySql: `CREATE OR REPLACE TABLE ${safeTable} AS ${selectSql}` };
    }
    case "regex": {
      if (!regexForm.column || !regexForm.pattern.trim()) throw new Error("Choose a text column and provide a regex pattern.");
      const outputNames = ensureUniqueNewColumns(workingColumns, regexForm.groupNames.split(",").map((name) => name.trim()));
      if (!outputNames || outputNames.length === 0) throw new Error("Provide at least one output group name.");
      const additions = outputNames.map((groupName, index) => `NULLIF(regexp_extract(CAST(${quoteIdentifier(regexForm.column)} AS VARCHAR), ${quoteLiteral(regexForm.pattern)}, ${index + 1}), '') AS ${quoteIdentifier(groupName)}`).join(", ");
      const selectSql = `SELECT ${selectList}, ${additions} FROM ${safeTable}`;
      return { operation: "regex", label: `Extract regex groups from ${regexForm.column}`, selectSql, applySql: `CREATE OR REPLACE TABLE ${safeTable} AS ${selectSql}` };
    }
    case "trim": {
      if (trimForm.columns.length === 0) throw new Error("Choose at least one text column to trim.");
      const replacements = Object.fromEntries(trimForm.columns.map((columnName) => [columnName, `CASE WHEN ${quoteIdentifier(columnName)} IS NULL THEN NULL ELSE TRIM(CAST(${quoteIdentifier(columnName)} AS VARCHAR)) END`]));
      const selectSql = `SELECT ${buildReplacementSelect(workingColumns, replacements)} FROM ${safeTable}`;
      return { operation: "trim", label: `Trim whitespace in ${trimForm.columns.join(", ")}`, selectSql, applySql: `CREATE OR REPLACE TABLE ${safeTable} AS ${selectSql}` };
    }
    case "dedupe": {
      const selectedColumns = dedupeForm.columns.length > 0 ? dedupeForm.columns : workingColumns.map((column) => column.name);
      const baseColumnList = buildSelectList(workingColumns);
      const partitionBy = selectedColumns.map((column) => quoteIdentifier(column)).join(", ");
      const selectSql = `WITH ranked AS (SELECT ${baseColumnList}, ROW_NUMBER() OVER () AS __row_id FROM ${safeTable}), marked AS (SELECT ${baseColumnList}, ROW_NUMBER() OVER (PARTITION BY ${partitionBy} ORDER BY __row_id) AS __duplicate_rank FROM ranked) SELECT ${baseColumnList} FROM marked WHERE __duplicate_rank = 1`;
      return { operation: "dedupe", label: `Remove duplicates using ${selectedColumns.join(", ")}`, selectSql, applySql: `CREATE OR REPLACE TABLE ${safeTable} AS ${selectSql}` };
    }
  }
}

function MultiColumnPicker({ columns, selected, onToggle }: { columns: ColumnProfile[]; selected: string[]; onToggle: (columnName: string) => void }) {
  return (
    <div className="flex flex-wrap gap-2">
      {columns.map((column) => {
        const active = selected.includes(column.name);
        return (
          <button key={column.name} type="button" onClick={() => onToggle(column.name)} className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition ${active ? "border-cyan-400/45 bg-cyan-500/12 text-cyan-700 dark:text-cyan-200" : "border-white/12 bg-white/35 text-slate-600 hover:border-cyan-300/28 dark:border-white/10 dark:bg-slate-950/30 dark:text-slate-300"}`}>
            {column.name}
          </button>
        );
      })}
    </div>
  );
}

interface WranglerFiltersProps {
  activeTab: OperationType;
  busy: boolean;
  workingColumns: ColumnProfile[];
  textColumns: ColumnProfile[];
  splitForm: SplitFormState;
  setSplitForm: Dispatch<SetStateAction<SplitFormState>>;
  mergeForm: MergeFormState;
  setMergeForm: Dispatch<SetStateAction<MergeFormState>>;
  fillForm: FillFormState;
  setFillForm: Dispatch<SetStateAction<FillFormState>>;
  dateForm: DateFormState;
  setDateForm: Dispatch<SetStateAction<DateFormState>>;
  regexForm: RegexFormState;
  setRegexForm: Dispatch<SetStateAction<RegexFormState>>;
  trimForm: TrimFormState;
  setTrimForm: Dispatch<SetStateAction<TrimFormState>>;
  dedupeForm: DedupeFormState;
  setDedupeForm: Dispatch<SetStateAction<DedupeFormState>>;
  onPreview: () => void;
  onApply: () => void;
}

export function WranglerFilters(props: WranglerFiltersProps) {
  const { activeTab, busy, workingColumns, textColumns, splitForm, setSplitForm, mergeForm, setMergeForm, fillForm, setFillForm, dateForm, setDateForm, regexForm, setRegexForm, trimForm, setTrimForm, dedupeForm, setDedupeForm, onPreview, onApply } = props;
  const toggleColumns = <K extends { columns: string[] }>(setter: Dispatch<SetStateAction<K>>, columnName: string) => {
    setter((current) => ({ ...current, columns: current.columns.includes(columnName) ? current.columns.filter((entry) => entry !== columnName) : [...current.columns, columnName] }));
  };

  return (
    <div className="rounded-[1.35rem] border border-white/12 bg-white/45 p-5 backdrop-blur-xl dark:border-white/10 dark:bg-slate-950/35">
      <div className="mb-4 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
        <Sparkles className="h-3.5 w-3.5" />
        Operation builder
      </div>

      {activeTab === "split" ? (
        <div className="space-y-4">
          <div>
            <label className="mb-2 block text-xs font-semibold uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">Source column</label>
            <select value={splitForm.column} onChange={(event) => setSplitForm((current) => ({ ...current, column: event.target.value, prefix: `${event.target.value || "part"}_split` }))} className={FIELD_CLASS}>
              {textColumns.map((column) => <option key={column.name} value={column.name}>{column.name}</option>)}
            </select>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="mb-2 block text-xs font-semibold uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">Delimiter</label>
              <input value={splitForm.delimiter} onChange={(event) => setSplitForm((current) => ({ ...current, delimiter: event.target.value }))} className={FIELD_CLASS} />
            </div>
            <div>
              <label className="mb-2 block text-xs font-semibold uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">Parts</label>
              <input type="number" min={2} max={6} value={splitForm.parts} onChange={(event) => setSplitForm((current) => ({ ...current, parts: Number(event.target.value) }))} className={FIELD_CLASS} />
            </div>
          </div>
          <div>
            <label className="mb-2 block text-xs font-semibold uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">Output prefix</label>
            <input value={splitForm.prefix} onChange={(event) => setSplitForm((current) => ({ ...current, prefix: event.target.value }))} className={FIELD_CLASS} />
          </div>
        </div>
      ) : null}

      {activeTab === "merge" ? (
        <div className="space-y-4">
          <div>
            <label className="mb-2 block text-xs font-semibold uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">Columns to merge</label>
            <MultiColumnPicker columns={workingColumns} selected={mergeForm.columns} onToggle={(columnName) => toggleColumns(setMergeForm, columnName)} />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="mb-2 block text-xs font-semibold uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">Separator</label>
              <input value={mergeForm.separator} onChange={(event) => setMergeForm((current) => ({ ...current, separator: event.target.value }))} className={FIELD_CLASS} />
            </div>
            <div>
              <label className="mb-2 block text-xs font-semibold uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">Output column</label>
              <input value={mergeForm.output} onChange={(event) => setMergeForm((current) => ({ ...current, output: event.target.value }))} className={FIELD_CLASS} />
            </div>
          </div>
        </div>
      ) : null}

      {activeTab === "fill" ? (
        <div className="space-y-4">
          <div>
            <label className="mb-2 block text-xs font-semibold uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">Target column</label>
            <select value={fillForm.column} onChange={(event) => setFillForm((current) => ({ ...current, column: event.target.value }))} className={FIELD_CLASS}>
              {workingColumns.map((column) => <option key={column.name} value={column.name}>{column.name}</option>)}
            </select>
          </div>
          <div>
            <label className="mb-2 block text-xs font-semibold uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">Strategy</label>
            <select value={fillForm.strategy} onChange={(event) => setFillForm((current) => ({ ...current, strategy: event.target.value as FillStrategy }))} className={FIELD_CLASS}>
              <option value="constant">Constant</option>
              <option value="mean">Mean</option>
              <option value="median">Median</option>
              <option value="forward-fill">Forward-fill</option>
              <option value="backward-fill">Backward-fill</option>
            </select>
          </div>
          {fillForm.strategy === "constant" ? (
            <div>
              <label className="mb-2 block text-xs font-semibold uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">Constant value</label>
              <input value={fillForm.constantValue} onChange={(event) => setFillForm((current) => ({ ...current, constantValue: event.target.value }))} className={FIELD_CLASS} />
            </div>
          ) : null}
        </div>
      ) : null}

      {activeTab === "dates" ? (
        <div className="space-y-4">
          <div>
            <label className="mb-2 block text-xs font-semibold uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">Source column</label>
            <select value={dateForm.column} onChange={(event) => setDateForm((current) => ({ ...current, column: event.target.value, output: `${event.target.value || "date"}_parsed` }))} className={FIELD_CLASS}>
              {textColumns.map((column) => <option key={column.name} value={column.name}>{column.name}</option>)}
            </select>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="mb-2 block text-xs font-semibold uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">Date format</label>
              <input value={dateForm.format} onChange={(event) => setDateForm((current) => ({ ...current, format: event.target.value }))} className={FIELD_CLASS} />
            </div>
            <div>
              <label className="mb-2 block text-xs font-semibold uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">Output column</label>
              <input value={dateForm.output} onChange={(event) => setDateForm((current) => ({ ...current, output: event.target.value }))} className={FIELD_CLASS} />
            </div>
          </div>
        </div>
      ) : null}

      {activeTab === "regex" ? (
        <div className="space-y-4">
          <div>
            <label className="mb-2 block text-xs font-semibold uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">Source column</label>
            <select value={regexForm.column} onChange={(event) => setRegexForm((current) => ({ ...current, column: event.target.value }))} className={FIELD_CLASS}>
              {textColumns.map((column) => <option key={column.name} value={column.name}>{column.name}</option>)}
            </select>
          </div>
          <div>
            <label className="mb-2 block text-xs font-semibold uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">Regex pattern</label>
            <input value={regexForm.pattern} onChange={(event) => setRegexForm((current) => ({ ...current, pattern: event.target.value }))} className={FIELD_CLASS} placeholder="e.g. ^(\\w+)-(\\d+)$" />
          </div>
          <div>
            <label className="mb-2 block text-xs font-semibold uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">Output group names</label>
            <input value={regexForm.groupNames} onChange={(event) => setRegexForm((current) => ({ ...current, groupNames: event.target.value }))} className={FIELD_CLASS} placeholder="prefix, sequence" />
          </div>
        </div>
      ) : null}

      {activeTab === "trim" ? (
        <div className="space-y-4">
          <label className="mb-2 block text-xs font-semibold uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">Columns to trim</label>
          <MultiColumnPicker columns={textColumns} selected={trimForm.columns} onToggle={(columnName) => toggleColumns(setTrimForm, columnName)} />
        </div>
      ) : null}

      {activeTab === "dedupe" ? (
        <div className="space-y-4">
          <label className="mb-2 block text-xs font-semibold uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">Duplicate keys</label>
          <MultiColumnPicker columns={workingColumns} selected={dedupeForm.columns} onToggle={(columnName) => toggleColumns(setDedupeForm, columnName)} />
        </div>
      ) : null}

      <div className="mt-6 flex flex-wrap gap-3">
        <button type="button" onClick={onPreview} className="inline-flex items-center gap-2 rounded-2xl border border-white/15 bg-white/50 px-4 py-3 text-sm font-semibold text-slate-700 transition hover:border-cyan-300/30 dark:border-white/10 dark:bg-slate-950/35 dark:text-slate-100">
          <ScissorsLineDashed className="h-4 w-4" />
          Preview
        </button>
        <button type="button" onClick={onApply} disabled={busy} className="inline-flex items-center gap-2 rounded-2xl border border-cyan-400/35 bg-cyan-500/14 px-4 py-3 text-sm font-semibold text-cyan-700 transition hover:bg-cyan-500/18 disabled:cursor-not-allowed disabled:opacity-45 dark:text-cyan-200">
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
          Apply SQL transform
        </button>
      </div>
    </div>
  );
}
