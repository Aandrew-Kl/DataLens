"use client";
import { startTransition, useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { AlertTriangle, CheckCircle2, Loader2, Plus, ShieldAlert, Trash2, XCircle } from "lucide-react";
import { runQuery } from "@/lib/duckdb/client";
import type { ColumnProfile } from "@/types/dataset";
import { formatNumber, generateId } from "@/lib/utils/formatters";

interface DataValidatorProps { tableName: string; columns: ColumnProfile[]; }
type RuleType = "not_null" | "unique" | "range" | "regex" | "allowed_values";
type RulesByColumn = Record<string, ValidationRule[]>;
interface ValidationRule { id: string; type: RuleType; min: string; max: string; pattern: string; allowedValues: string; }
interface ValidationTask { id: string; columnName: string; label: string; detail: string; countSql: string; sampleSql: string; }
interface ValidationWarning { id: string; columnName: string; message: string; }
interface ValidationResult extends ValidationTask { violationCount: number; sampleRows: Record<string, unknown>[]; }

const fieldClass = "w-full rounded-xl border border-slate-300/80 bg-white px-3 py-2 text-sm text-slate-950 outline-none transition focus:border-cyan-400 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-50";
const panelClass = "rounded-2xl border border-slate-200/70 bg-white/80 shadow-sm backdrop-blur dark:border-slate-800/80 dark:bg-slate-950/60";
const RULE_OPTIONS: Array<{ value: RuleType; label: string }> = [
  { value: "not_null", label: "Not null" },
  { value: "unique", label: "Unique" },
  { value: "range", label: "Min / max range" },
  { value: "regex", label: "Regex pattern" },
  { value: "allowed_values", label: "Allowed values" },
];

function createRule(type: RuleType = "not_null"): ValidationRule {
  return { id: generateId(), type, min: "", max: "", pattern: "", allowedValues: "" };
}
function quoteIdentifier(value: string) { return `"${value.replace(/"/g, '""')}"`; }
function escapeLiteral(value: string) { return `'${value.replace(/'/g, "''")}'`; }
function parseAllowedValues(value: string) { return value.split(/[\n,]+/).map((entry) => entry.trim()).filter(Boolean); }
function renderValue(value: unknown) {
  if (value == null) return "null";
  if (typeof value === "number") return Number.isInteger(value) ? value.toLocaleString() : value.toFixed(2);
  if (typeof value === "boolean") return value ? "true" : "false";
  return String(value);
}
function getSampleSelect(columns: ColumnProfile[], columnName: string) {
  const names = [columnName];
  for (const column of columns) {
    if (names.includes(column.name)) continue;
    names.push(column.name);
    if (names.length >= 4) break;
  }
  return names.map((name) => quoteIdentifier(name)).join(", ");
}
function buildRangeCondition(column: ColumnProfile, safeColumn: string, rule: ValidationRule) {
  const hasMin = rule.min.trim() !== "";
  const hasMax = rule.max.trim() !== "";
  if (!hasMin && !hasMax) return { warning: "Range rules need a minimum, maximum, or both." };
  if (column.type === "number") {
    const minValue = hasMin ? Number(rule.min) : null;
    const maxValue = hasMax ? Number(rule.max) : null;
    if ((hasMin && !Number.isFinite(minValue)) || (hasMax && !Number.isFinite(maxValue))) return { warning: "Numeric range rules need valid numeric bounds." };
    const expr = `TRY_CAST(${safeColumn} AS DOUBLE)`;
    return { detail: `Expected between ${hasMin ? rule.min : "-∞"} and ${hasMax ? rule.max : "+∞"}.`, condition: [minValue != null ? `${expr} < ${minValue}` : null, maxValue != null ? `${expr} > ${maxValue}` : null].filter(Boolean).join(" OR ") };
  }
  if (column.type === "date") {
    const expr = `TRY_CAST(${safeColumn} AS TIMESTAMP)`;
    const minValue = hasMin ? rule.min.trim() : null;
    const maxValue = hasMax ? rule.max.trim() : null;
    return { detail: `Expected between ${minValue ?? "start"} and ${maxValue ?? "end"}.`, condition: [minValue ? `${expr} < TRY_CAST(${escapeLiteral(minValue)} AS TIMESTAMP)` : null, maxValue ? `${expr} > TRY_CAST(${escapeLiteral(maxValue)} AS TIMESTAMP)` : null].filter(Boolean).join(" OR ") };
  }
  return { detail: `Expected between ${hasMin ? rule.min : "start"} and ${hasMax ? rule.max : "end"}.`, condition: [hasMin ? `CAST(${safeColumn} AS VARCHAR) < ${escapeLiteral(rule.min.trim())}` : null, hasMax ? `CAST(${safeColumn} AS VARCHAR) > ${escapeLiteral(rule.max.trim())}` : null].filter(Boolean).join(" OR ") };
}
function buildValidationTask(tableName: string, columns: ColumnProfile[], column: ColumnProfile, rule: ValidationRule): ValidationTask | ValidationWarning {
  const safeTable = quoteIdentifier(tableName);
  const safeColumn = quoteIdentifier(column.name);
  const sampleSelect = getSampleSelect(columns, column.name);
  switch (rule.type) {
    case "not_null": return { id: rule.id, columnName: column.name, label: "Not null", detail: "Every row must contain a value.", countSql: `SELECT COUNT(*) AS violations FROM ${safeTable} WHERE ${safeColumn} IS NULL`, sampleSql: `SELECT ${sampleSelect} FROM ${safeTable} WHERE ${safeColumn} IS NULL LIMIT 5` };
    case "unique": {
      const sourceSql = `SELECT ${sampleSelect}, COUNT(*) OVER (PARTITION BY ${safeColumn}) AS __duplicate_count FROM ${safeTable}`;
      return { id: rule.id, columnName: column.name, label: "Unique", detail: "Non-null values must appear only once.", countSql: `SELECT COUNT(*) AS violations FROM (${sourceSql}) AS violations WHERE ${safeColumn} IS NOT NULL AND __duplicate_count > 1`, sampleSql: `SELECT * FROM (${sourceSql}) AS violations WHERE ${safeColumn} IS NOT NULL AND __duplicate_count > 1 LIMIT 5` };
    }
    case "range": {
      const range = buildRangeCondition(column, safeColumn, rule);
      if ("warning" in range) return { id: rule.id, columnName: column.name, message: range.warning as string };
      return { id: rule.id, columnName: column.name, label: "Range", detail: (range as { detail: string; condition: string }).detail, countSql: `SELECT COUNT(*) AS violations FROM ${safeTable} WHERE ${safeColumn} IS NOT NULL AND (${(range as { detail: string; condition: string }).condition})`, sampleSql: `SELECT ${sampleSelect} FROM ${safeTable} WHERE ${safeColumn} IS NOT NULL AND (${(range as { detail: string; condition: string }).condition}) LIMIT 5` };
    }
    case "regex": {
      const pattern = rule.pattern.trim();
      if (!pattern) return { id: rule.id, columnName: column.name, message: "Regex rules need a pattern." };
      return { id: rule.id, columnName: column.name, label: "Regex pattern", detail: `Must match ${pattern}.`, countSql: `SELECT COUNT(*) AS violations FROM ${safeTable} WHERE ${safeColumn} IS NOT NULL AND NOT regexp_matches(CAST(${safeColumn} AS VARCHAR), ${escapeLiteral(pattern)})`, sampleSql: `SELECT ${sampleSelect} FROM ${safeTable} WHERE ${safeColumn} IS NOT NULL AND NOT regexp_matches(CAST(${safeColumn} AS VARCHAR), ${escapeLiteral(pattern)}) LIMIT 5` };
    }
    case "allowed_values": {
      const values = parseAllowedValues(rule.allowedValues);
      if (values.length === 0) return { id: rule.id, columnName: column.name, message: "Allowed values rules need at least one value." };
      const list = values.map((value) => escapeLiteral(value)).join(", ");
      return { id: rule.id, columnName: column.name, label: "Allowed values", detail: `Accepted: ${values.slice(0, 4).join(", ")}${values.length > 4 ? ", …" : ""}.`, countSql: `SELECT COUNT(*) AS violations FROM ${safeTable} WHERE ${safeColumn} IS NOT NULL AND CAST(${safeColumn} AS VARCHAR) NOT IN (${list})`, sampleSql: `SELECT ${sampleSelect} FROM ${safeTable} WHERE ${safeColumn} IS NOT NULL AND CAST(${safeColumn} AS VARCHAR) NOT IN (${list}) LIMIT 5` };
    }
  }
}

function RuleEditor({ column, rules, onAdd, onChange, onRemove }: {
  column: ColumnProfile;
  rules: ValidationRule[];
  onAdd: () => void;
  onChange: (ruleId: string, patch: Partial<ValidationRule>) => void;
  onRemove: (ruleId: string) => void;
}) {
  return (
    <div className={`${panelClass} p-4`}>
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-slate-950 dark:text-slate-50">{column.name}</p>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{column.type} column · {rules.length} configured {rules.length === 1 ? "rule" : "rules"}</p>
        </div>
        <button type="button" onClick={onAdd} className="inline-flex items-center gap-2 rounded-xl border border-cyan-400/30 bg-cyan-500/10 px-3 py-2 text-xs font-semibold text-cyan-700 transition hover:bg-cyan-500/20 dark:text-cyan-200">
          <Plus className="h-4 w-4" />
          Add rule
        </button>
      </div>
      <AnimatePresence initial={false}>
        {rules.length === 0 ? (
          <motion.div key="empty" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} className="rounded-xl border border-dashed border-slate-300/80 px-4 py-5 text-sm text-slate-500 dark:border-slate-700 dark:text-slate-400">
            Add checks like not null, uniqueness, range, regex, or allowed values.
          </motion.div>
        ) : (
          <div className="space-y-3">
            {rules.map((rule) => (
              <motion.div key={rule.id} layout initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} className="rounded-xl border border-slate-200/80 bg-slate-50/80 p-3 dark:border-slate-800 dark:bg-slate-900/80">
                <div className="flex items-start gap-3">
                  <select value={rule.type} onChange={(event) => onChange(rule.id, { type: event.target.value as RuleType })} className={`min-w-0 flex-1 ${fieldClass}`}>
                    {RULE_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                  </select>
                  <button type="button" onClick={() => onRemove(rule.id)} className="rounded-lg border border-rose-300/60 p-2 text-rose-600 transition hover:bg-rose-500/10 dark:border-rose-900/80 dark:text-rose-300">
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
                {rule.type === "range" && (
                  <div className="mt-3 grid gap-3 sm:grid-cols-2">
                    <input value={rule.min} onChange={(event) => onChange(rule.id, { min: event.target.value })} placeholder={`Min${column.min != null ? ` (${column.min})` : ""}`} className={fieldClass} />
                    <input value={rule.max} onChange={(event) => onChange(rule.id, { max: event.target.value })} placeholder={`Max${column.max != null ? ` (${column.max})` : ""}`} className={fieldClass} />
                  </div>
                )}
                {rule.type === "regex" && <input value={rule.pattern} onChange={(event) => onChange(rule.id, { pattern: event.target.value })} placeholder="^[A-Z]{3}-\\d+$" className={`mt-3 ${fieldClass}`} />}
                {rule.type === "allowed_values" && <textarea rows={3} value={rule.allowedValues} onChange={(event) => onChange(rule.id, { allowedValues: event.target.value })} placeholder="active, pending, archived" className={`mt-3 ${fieldClass}`} />}
              </motion.div>
            ))}
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}

function SummaryTile({ label, value, tone = "text-slate-950 dark:text-slate-50" }: { label: string; value: string | number; tone?: string }) {
  return (
    <div className={`${panelClass} px-4 py-3`}>
      <p className="text-[11px] uppercase tracking-[0.18em] text-slate-500">{label}</p>
      <p className={`mt-1 text-lg font-semibold ${tone}`}>{value}</p>
    </div>
  );
}

function ResultCard({ result }: { result: ValidationResult }) {
  const passed = result.violationCount === 0;
  const Icon = passed ? CheckCircle2 : XCircle;
  const headers = Object.keys(result.sampleRows[0] ?? {});
  const badgeClass = passed ? "border-emerald-500/20 bg-emerald-500/10 text-emerald-200" : "border-rose-500/20 bg-rose-500/10 text-rose-200";
  return (
    <motion.div layout initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} className="rounded-2xl border border-slate-800 bg-slate-950/85 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-semibold ${badgeClass}`}>
            <Icon className="h-4 w-4" />
            {passed ? "Pass" : "Fail"}
          </div>
          <p className="mt-3 text-base font-semibold text-slate-100">{result.columnName} · {result.label}</p>
          <p className="mt-1 text-sm text-slate-400">{result.detail}</p>
        </div>
        <div className="rounded-xl border border-slate-800 bg-slate-900/80 px-3 py-2 text-right">
          <p className="text-[11px] uppercase tracking-[0.18em] text-slate-500">Violations</p>
          <p className="mt-1 text-xl font-semibold text-slate-100">{formatNumber(result.violationCount)}</p>
        </div>
      </div>
      <div className="mt-4">
        {result.sampleRows.length === 0 ? (
          <p className="text-sm text-slate-400">No violating rows were found.</p>
        ) : (
          <div className="overflow-hidden rounded-xl border border-slate-800">
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-slate-800 text-sm">
                <thead className="bg-slate-900/90"><tr>{headers.map((header) => <th key={header} className="px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">{header}</th>)}</tr></thead>
                <tbody className="divide-y divide-slate-800 bg-slate-950/70">{result.sampleRows.map((row, index) => <tr key={`${result.id}-${index}`}>{headers.map((header) => <td key={header} className="px-3 py-2 text-slate-300">{renderValue(row[header])}</td>)}</tr>)}</tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </motion.div>
  );
}

export default function DataValidator({ tableName, columns }: DataValidatorProps) {
  const [rulesByColumn, setRulesByColumn] = useState<RulesByColumn>({});
  const [results, setResults] = useState<ValidationResult[]>([]);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastRunAt, setLastRunAt] = useState<number | null>(null);

  useEffect(() => { setRulesByColumn((previous) => Object.fromEntries(columns.map((column) => [column.name, previous[column.name] ?? []]))); }, [columns]);
  const plan = useMemo(() => {
    const tasks: ValidationTask[] = [];
    const warnings: ValidationWarning[] = [];
    for (const column of columns) {
      for (const rule of rulesByColumn[column.name] ?? []) {
        const entry = buildValidationTask(tableName, columns, column, rule);
        if ("message" in entry) warnings.push(entry); else tasks.push(entry);
      }
    }
    return { tasks, warnings };
  }, [columns, rulesByColumn, tableName]);
  const configuredCount = Object.values(rulesByColumn).reduce((sum, rules) => sum + rules.length, 0);
  const failingCount = results.filter((result) => result.violationCount > 0).length;
  const totalViolations = results.reduce((sum, result) => sum + result.violationCount, 0);
  useEffect(() => { setResults([]); setLastRunAt(null); setError(null); }, [rulesByColumn, tableName]);
  function updateColumnRules(columnName: string, updater: (rules: ValidationRule[]) => ValidationRule[]) {
    setRulesByColumn((previous) => ({ ...previous, [columnName]: updater(previous[columnName] ?? []) }));
  }
  async function runValidation() {
    if (plan.tasks.length === 0) return;
    setRunning(true);
    setError(null);
    try {
      const nextResults: ValidationResult[] = [];
      for (const task of plan.tasks) {
        const countRow = (await runQuery(task.countSql))[0] ?? {};
        const violationCount = Number(countRow.violations ?? 0);
        const sampleRows = violationCount > 0 ? await runQuery(task.sampleSql) : [];
        nextResults.push({ ...task, violationCount, sampleRows });
      }
      nextResults.sort((left, right) => right.violationCount - left.violationCount || left.columnName.localeCompare(right.columnName));
      startTransition(() => { setResults(nextResults); setLastRunAt(Date.now()); });
    } catch (validationError) {
      setError(validationError instanceof Error ? validationError.message : "Validation failed.");
    } finally {
      setRunning(false);
    }
  }

  return (
    <section className="space-y-6 rounded-3xl border border-slate-200/70 bg-gradient-to-br from-white via-slate-50 to-cyan-50/50 p-6 shadow-xl shadow-slate-200/50 dark:border-slate-800/80 dark:from-slate-950 dark:via-slate-900 dark:to-slate-900 dark:shadow-none">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <div className="inline-flex items-center gap-2 rounded-full border border-cyan-400/20 bg-cyan-500/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-cyan-700 dark:text-cyan-200">
            <ShieldAlert className="h-4 w-4" />
            Data Validation Rules
          </div>
          <h2 className="mt-3 text-2xl font-semibold text-slate-950 dark:text-slate-50">Configure checks for {tableName}</h2>
          <p className="mt-2 max-w-2xl text-sm text-slate-600 dark:text-slate-400">Define rules column by column, then scan the DuckDB table for nulls, duplicates, range violations, regex misses, and invalid categories.</p>
        </div>
        <div className="flex flex-wrap gap-3">
          {[{ label: "Configured", value: configuredCount }, { label: "Runnable", value: plan.tasks.length }].map((metric) => (
            <SummaryTile key={metric.label} label={metric.label} value={metric.value} />
          ))}
          <button type="button" onClick={() => void runValidation()} disabled={running || plan.tasks.length === 0} className="inline-flex items-center gap-2 rounded-2xl bg-cyan-500 px-5 py-3 text-sm font-semibold text-slate-950 transition hover:bg-cyan-400 disabled:cursor-not-allowed disabled:bg-slate-300 disabled:text-slate-500 dark:disabled:bg-slate-800 dark:disabled:text-slate-500">
            {running ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
            {running ? "Running validation…" : "Run validation"}
          </button>
        </div>
      </div>
      {plan.warnings.length > 0 && (
        <div className="rounded-2xl border border-amber-500/20 bg-amber-500/10 p-4 text-amber-900 dark:text-amber-200">
          <div className="flex items-center gap-2 text-sm font-semibold"><AlertTriangle className="h-4 w-4" />{plan.warnings.length} incomplete {plan.warnings.length === 1 ? "rule" : "rules"} will be skipped</div>
          <div className="mt-3 space-y-1 text-sm">{plan.warnings.map((warning) => <p key={warning.id}>{warning.columnName}: {warning.message}</p>)}</div>
        </div>
      )}
      <div className="grid gap-4 xl:grid-cols-2">
        {columns.map((column) => <RuleEditor key={column.name} column={column} rules={rulesByColumn[column.name] ?? []} onAdd={() => updateColumnRules(column.name, (rules) => [...rules, createRule()])} onChange={(ruleId, patch) => updateColumnRules(column.name, (rules) => rules.map((rule) => (rule.id === ruleId ? { ...rule, ...patch } : rule)))} onRemove={(ruleId) => updateColumnRules(column.name, (rules) => rules.filter((rule) => rule.id !== ruleId))} />)}
      </div>
      <div className="rounded-3xl border border-slate-800 bg-slate-950/95 p-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-500">Results</p>
            <h3 className="mt-2 text-xl font-semibold text-slate-100">Validation run output</h3>
            <p className="mt-2 text-sm text-slate-400">{lastRunAt == null ? "Run validation to compute violations and inspect sample rows." : `Last run at ${new Date(lastRunAt).toLocaleTimeString()}.`}</p>
          </div>
          {results.length > 0 && (
            <div className="flex flex-wrap gap-3">
              <SummaryTile label="Failures" value={failingCount} tone="text-rose-300" />
              <SummaryTile label="Total violations" value={formatNumber(totalViolations)} tone="text-slate-100" />
            </div>
          )}
        </div>
        {error && <div className="mt-4 rounded-2xl border border-rose-500/20 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">{error}</div>}
        <div className="mt-5">
          <AnimatePresence initial={false}>
            {results.length === 0 ? (
              <motion.div key="empty-results" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -12 }} className="rounded-2xl border border-dashed border-slate-800 px-4 py-8 text-center text-sm text-slate-500">
                {plan.tasks.length === 0 ? "Add at least one complete rule to enable validation." : "No validation results yet."}
              </motion.div>
            ) : (
              <div className="grid gap-4 xl:grid-cols-2">{results.map((result) => <ResultCard key={result.id} result={result} />)}</div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </section>
  );
}
