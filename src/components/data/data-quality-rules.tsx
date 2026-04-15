"use client";

import { quoteIdentifier } from "@/lib/utils/sql";
import { startTransition, useMemo, useState, useSyncExternalStore } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  CheckCircle2,
  Download,
  Loader2,
  Plus,
  Save,
  ShieldCheck,
  Sparkles,
  Trash2,
  Upload,
  XCircle,
} from "lucide-react";
import { runQuery } from "@/lib/duckdb/client";
import { exportToCSV } from "@/lib/utils/export";
import { formatNumber, generateId } from "@/lib/utils/formatters";
import type { ColumnProfile } from "@/types/dataset";

interface DataQualityRulesProps {
  tableName: string;
  columns: ColumnProfile[];
}

type RuleOperator =
  | "not_null"
  | "unique"
  | "regex"
  | "gt"
  | "gte"
  | "lt"
  | "lte"
  | "eq"
  | "neq"
  | "between";

type OperandMode = "value" | "column";

interface QualityRule {
  id: string;
  leftColumn: string;
  operator: RuleOperator;
  operandMode: OperandMode;
  rightColumn: string;
  value: string;
  secondaryValue: string;
}

interface SavedRuleSet {
  id: string;
  name: string;
  savedAt: number;
  rules: QualityRule[];
}

interface RuleTask {
  id: string;
  summary: string;
  description: string;
  countSql: string;
  sampleSql: string;
  exportSql: string;
}

interface RuleResult extends RuleTask {
  violationCount: number;
  compliance: number;
  sampleRows: Record<string, unknown>[];
}

interface RulePreset {
  id: string;
  label: string;
  description: string;
  build: (columns: ColumnProfile[]) => QualityRule | null;
}

const EASE = [0.22, 1, 0.36, 1] as const;
const PANEL_CLASS =
  "rounded-[1.75rem] border border-white/20 bg-white/75 shadow-xl shadow-slate-950/10 backdrop-blur-2xl dark:border-white/10 dark:bg-slate-950/45";
const FIELD_CLASS =
  "rounded-2xl border border-white/20 bg-white/75 px-4 py-3 text-sm text-slate-700 outline-none transition focus:border-cyan-400 dark:bg-slate-950/45 dark:text-slate-100";
const STORAGE_PREFIX = "datalens:data-quality-rules";
const storageListeners = new Set<() => void>();
const EMPTY_RULE_SETS: SavedRuleSet[] = [];
const ruleSetCache = new Map<string, { raw: string | null; parsed: SavedRuleSet[] }>();

const OPERATOR_OPTIONS: Array<{
  value: RuleOperator;
  label: string;
  requiresTarget: boolean;
  supportsColumnMode: boolean;
}> = [
  { value: "not_null", label: "Not null", requiresTarget: false, supportsColumnMode: false },
  { value: "unique", label: "Unique", requiresTarget: false, supportsColumnMode: false },
  { value: "regex", label: "Regex pattern", requiresTarget: true, supportsColumnMode: false },
  { value: "gt", label: "Greater than", requiresTarget: true, supportsColumnMode: true },
  { value: "gte", label: "Greater or equal", requiresTarget: true, supportsColumnMode: true },
  { value: "lt", label: "Less than", requiresTarget: true, supportsColumnMode: true },
  { value: "lte", label: "Less or equal", requiresTarget: true, supportsColumnMode: true },
  { value: "eq", label: "Equals", requiresTarget: true, supportsColumnMode: true },
  { value: "neq", label: "Does not equal", requiresTarget: true, supportsColumnMode: true },
  { value: "between", label: "Between range", requiresTarget: true, supportsColumnMode: false },
] as const;

function storageKey(tableName: string) {
  return `${STORAGE_PREFIX}:${tableName}`;
}

function subscribeRuleSets(listener: () => void) {
  storageListeners.add(listener);
  if (typeof window === "undefined") {
    return () => storageListeners.delete(listener);
  }

  function handleStorage(event: StorageEvent) {
    if (event.key?.startsWith(STORAGE_PREFIX)) listener();
  }

  window.addEventListener("storage", handleStorage);
  return () => {
    storageListeners.delete(listener);
    window.removeEventListener("storage", handleStorage);
  };
}

function emitStorageChange() {
  storageListeners.forEach((listener) => listener());
}

function readRuleSets(tableName: string) {
  if (typeof window === "undefined") return EMPTY_RULE_SETS;
  const key = storageKey(tableName);
  try {
    const raw = window.localStorage.getItem(key);
    const cached = ruleSetCache.get(key);
    if (cached && cached.raw === raw) {
      return cached.parsed;
    }
    const parsed = raw ? (JSON.parse(raw) as SavedRuleSet[]) : EMPTY_RULE_SETS;
    ruleSetCache.set(key, { raw, parsed });
    return parsed;
  } catch {
    ruleSetCache.set(key, { raw: null, parsed: EMPTY_RULE_SETS });
    return EMPTY_RULE_SETS;
  }
}

function writeRuleSets(tableName: string, ruleSets: SavedRuleSet[]) {
  if (typeof window === "undefined") return;
  const key = storageKey(tableName);
  const raw = JSON.stringify(ruleSets);
  window.localStorage.setItem(key, raw);
  ruleSetCache.set(key, { raw, parsed: ruleSets });
  emitStorageChange();
}
function escapeLiteral(value: string) {
  return `'${value.replaceAll("'", "''")}'`;
}

function createRule(columns: ColumnProfile[], partial: Partial<QualityRule> = {}): QualityRule {
  const defaultLeft = partial.leftColumn ?? columns[0]?.name ?? "";
  const fallbackRight = columns.find((column) => column.name !== defaultLeft)?.name ?? defaultLeft;
  return {
    id: partial.id ?? generateId(),
    leftColumn: defaultLeft,
    operator: partial.operator ?? "not_null",
    operandMode: partial.operandMode ?? "value",
    rightColumn: partial.rightColumn ?? fallbackRight,
    value: partial.value ?? "",
    secondaryValue: partial.secondaryValue ?? "",
  };
}

function normalizeRule(columns: ColumnProfile[], rule: QualityRule) {
  const columnNames = new Set(columns.map((column) => column.name));
  const fallback = columns[0]?.name ?? "";
  const leftColumn = columnNames.has(rule.leftColumn) ? rule.leftColumn : fallback;
  const rightColumn = columnNames.has(rule.rightColumn) ? rule.rightColumn : leftColumn;
  return createRule(columns, {
    ...rule,
    leftColumn,
    rightColumn,
  });
}

function toNumeric(value: string) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function buildLiteralExpression(column: ColumnProfile, value: string) {
  if (column.type === "number") {
    const numeric = toNumeric(value);
    if (numeric == null) return null;
    return { expression: `${numeric}`, printable: value.trim() };
  }

  if (column.type === "date") {
    if (!value.trim()) return null;
    return {
      expression: `TRY_CAST(${escapeLiteral(value.trim())} AS TIMESTAMP)`,
      printable: value.trim(),
    };
  }

  return {
    expression: escapeLiteral(value),
    printable: value,
  };
}

function buildComparableExpression(column: ColumnProfile, sqlExpression: string) {
  if (column.type === "number") return `TRY_CAST(${sqlExpression} AS DOUBLE)`;
  if (column.type === "date") return `TRY_CAST(${sqlExpression} AS TIMESTAMP)`;
  return `CAST(${sqlExpression} AS VARCHAR)`;
}

function getRuleSummary(rule: QualityRule) {
  const operator = OPERATOR_OPTIONS.find((option) => option.value === rule.operator);
  if (!operator) return "Custom rule";
  if (rule.operator === "not_null" || rule.operator === "unique") {
    return `${rule.leftColumn} ${operator.label.toLowerCase()}`;
  }
  if (rule.operator === "between") {
    return `${rule.leftColumn} between ${rule.value || "?"} and ${rule.secondaryValue || "?"}`;
  }
  if (rule.operator === "regex") {
    return `${rule.leftColumn} matches ${rule.value || "pattern"}`;
  }
  return `${rule.leftColumn} ${operator.label.toLowerCase()} ${rule.operandMode === "column" ? rule.rightColumn : rule.value || "?"}`;
}

function buildRuleTask(tableName: string, columns: ColumnProfile[], rule: QualityRule): RuleTask | null {
  const leftColumn = columns.find((column) => column.name === rule.leftColumn);
  if (!leftColumn) return null;

  const safeTable = quoteIdentifier(tableName);
  const safeLeft = quoteIdentifier(leftColumn.name);
  const summary = getRuleSummary(rule);

  if (rule.operator === "not_null") {
    const condition = `${safeLeft} IS NULL`;
    return {
      id: rule.id,
      summary,
      description: "The selected column must have a value on every row.",
      countSql: `SELECT COUNT(*) AS violations FROM ${safeTable} WHERE ${condition}`,
      sampleSql: `SELECT * FROM ${safeTable} WHERE ${condition} LIMIT 8`,
      exportSql: `SELECT * FROM ${safeTable} WHERE ${condition}`,
    };
  }

  if (rule.operator === "unique") {
    const duplicateSql = `
      SELECT
        *,
        COUNT(*) OVER (PARTITION BY ${safeLeft}) AS __duplicate_count
      FROM ${safeTable}
    `;
    const condition = `${safeLeft} IS NOT NULL AND __duplicate_count > 1`;
    return {
      id: rule.id,
      summary,
      description: "Every non-null value must appear only once.",
      countSql: `SELECT COUNT(*) AS violations FROM (${duplicateSql}) AS violations WHERE ${condition}`,
      sampleSql: `SELECT * FROM (${duplicateSql}) AS violations WHERE ${condition} LIMIT 8`,
      exportSql: `SELECT * FROM (${duplicateSql}) AS violations WHERE ${condition}`,
    };
  }

  if (rule.operator === "regex") {
    const pattern = rule.value.trim();
    if (!pattern) return null;
    const condition = `${safeLeft} IS NOT NULL AND NOT regexp_matches(CAST(${safeLeft} AS VARCHAR), ${escapeLiteral(pattern)})`;
    return {
      id: rule.id,
      summary,
      description: `Values must match the pattern ${pattern}.`,
      countSql: `SELECT COUNT(*) AS violations FROM ${safeTable} WHERE ${condition}`,
      sampleSql: `SELECT * FROM ${safeTable} WHERE ${condition} LIMIT 8`,
      exportSql: `SELECT * FROM ${safeTable} WHERE ${condition}`,
    };
  }

  if (rule.operator === "between") {
    const minimum = buildLiteralExpression(leftColumn, rule.value.trim());
    const maximum = buildLiteralExpression(leftColumn, rule.secondaryValue.trim());
    if (!minimum || !maximum) return null;
    const comparable = buildComparableExpression(leftColumn, safeLeft);
    const condition = `${safeLeft} IS NOT NULL AND (${comparable} < ${minimum.expression} OR ${comparable} > ${maximum.expression})`;
    return {
      id: rule.id,
      summary,
      description: `Values must stay between ${minimum.printable} and ${maximum.printable}.`,
      countSql: `SELECT COUNT(*) AS violations FROM ${safeTable} WHERE ${condition}`,
      sampleSql: `SELECT * FROM ${safeTable} WHERE ${condition} LIMIT 8`,
      exportSql: `SELECT * FROM ${safeTable} WHERE ${condition}`,
    };
  }

  const comparisonOperators: Record<Exclude<RuleOperator, "not_null" | "unique" | "regex" | "between">, string> = {
    gt: ">",
    gte: ">=",
    lt: "<",
    lte: "<=",
    eq: "=",
    neq: "!=",
  };

  const sqlOperator = comparisonOperators[rule.operator as keyof typeof comparisonOperators];
  if (!sqlOperator) return null;

  let rightExpression: string | null = null;
  let rightLabel = "";

  if (rule.operandMode === "column") {
    const rightColumn = columns.find((column) => column.name === rule.rightColumn);
    if (!rightColumn) return null;
    const numericComparison = leftColumn.type === "number" && rightColumn.type === "number";
    const dateComparison = leftColumn.type === "date" || rightColumn.type === "date";
    if (numericComparison) {
      rightExpression = `TRY_CAST(${quoteIdentifier(rightColumn.name)} AS DOUBLE)`;
    } else if (dateComparison) {
      rightExpression = `TRY_CAST(${quoteIdentifier(rightColumn.name)} AS TIMESTAMP)`;
    } else {
      rightExpression = `CAST(${quoteIdentifier(rightColumn.name)} AS VARCHAR)`;
    }
    rightLabel = rightColumn.name;
  } else {
    const literal = buildLiteralExpression(leftColumn, rule.value.trim());
    if (!literal) return null;
    rightExpression = literal.expression;
    rightLabel = literal.printable;
  }

  const leftExpression = buildComparableExpression(leftColumn, safeLeft);
  const nullGuard = rule.operandMode === "column" ? `${safeLeft} IS NOT NULL AND ${quoteIdentifier(rule.rightColumn)} IS NOT NULL` : `${safeLeft} IS NOT NULL`;
  const condition = `${nullGuard} AND NOT (${leftExpression} ${sqlOperator} ${rightExpression})`;

  return {
    id: rule.id,
    summary,
    description: `Expected ${leftColumn.name} ${sqlOperator} ${rightLabel}.`,
    countSql: `SELECT COUNT(*) AS violations FROM ${safeTable} WHERE ${condition}`,
    sampleSql: `SELECT * FROM ${safeTable} WHERE ${condition} LIMIT 8`,
    exportSql: `SELECT * FROM ${safeTable} WHERE ${condition}`,
  };
}

const RULE_PRESETS: RulePreset[] = [
  {
    id: "email",
    label: "Email format",
    description: "Validate email-like strings.",
    build: (columns) => {
      const target = columns.find((column) => column.type === "string");
      return target
        ? createRule(columns, {
            leftColumn: target.name,
            operator: "regex",
            value: "^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\\.[A-Za-z]{2,}$",
          })
        : null;
    },
  },
  {
    id: "phone",
    label: "Phone number",
    description: "Accept common international phone patterns.",
    build: (columns) => {
      const target = columns.find((column) => column.type === "string");
      return target
        ? createRule(columns, {
            leftColumn: target.name,
            operator: "regex",
            value: "^\\+?[0-9()\\-\\s]{7,}$",
          })
        : null;
    },
  },
  {
    id: "date_range",
    label: "Date range",
    description: "Lock a date column inside its profiled min and max.",
    build: (columns) => {
      const target = columns.find((column) => column.type === "date");
      return target
        ? createRule(columns, {
            leftColumn: target.name,
            operator: "between",
            value: String(target.min ?? ""),
            secondaryValue: String(target.max ?? ""),
          })
        : null;
    },
  },
  {
    id: "positive_numbers",
    label: "Positive numbers",
    description: "Require values greater than zero.",
    build: (columns) => {
      const target = columns.find((column) => column.type === "number");
      return target
        ? createRule(columns, {
            leftColumn: target.name,
            operator: "gt",
            value: "0",
          })
        : null;
    },
  },
] as const;

function ScoreBadge({ score }: { score: number }) {
  const tone =
    score >= 95
      ? "border-emerald-400/20 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
      : score >= 82
        ? "border-amber-400/20 bg-amber-500/10 text-amber-700 dark:text-amber-300"
        : "border-rose-400/20 bg-rose-500/10 text-rose-700 dark:text-rose-300";
  return (
    <div className={`inline-flex items-center gap-2 rounded-full border px-4 py-2 text-sm font-semibold ${tone}`}>
      <ShieldCheck className="h-4 w-4" />
      Overall compliance {score.toFixed(1)}%
    </div>
  );
}

function RulePresetButton({
  preset,
  onApply,
}: {
  preset: RulePreset;
  onApply: (preset: RulePreset) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onApply(preset)}
      className="rounded-2xl border border-white/20 bg-white/80 p-4 text-left transition hover:bg-white dark:bg-slate-950/45 dark:hover:bg-slate-950/65"
    >
      <div className="inline-flex items-center gap-2 rounded-full bg-cyan-500/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-cyan-700 dark:text-cyan-300">
        <Sparkles className="h-3.5 w-3.5" />
        Preset
      </div>
      <p className="mt-3 text-sm font-semibold text-slate-900 dark:text-slate-100">{preset.label}</p>
      <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{preset.description}</p>
    </button>
  );
}

function RuleBuilderCard({
  columns,
  rule,
  onChange,
  onRemove,
}: {
  columns: ColumnProfile[];
  rule: QualityRule;
  onChange: (ruleId: string, patch: Partial<QualityRule>) => void;
  onRemove: (ruleId: string) => void;
}) {
  const option = OPERATOR_OPTIONS.find((entry) => entry.value === rule.operator);
  const compatibleRightColumns = columns.filter((column) => column.name !== rule.leftColumn);

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -12 }}
      transition={{ duration: 0.24, ease: EASE }}
      className="rounded-[1.5rem] border border-white/15 bg-white/70 p-4 dark:bg-slate-950/45"
    >
      <div className="grid gap-3 lg:grid-cols-[1fr_1fr_auto]">
        <select
          value={rule.leftColumn}
          onChange={(event) => onChange(rule.id, { leftColumn: event.target.value })}
          className={FIELD_CLASS}
        >
          {columns.map((column) => (
            <option key={column.name} value={column.name}>
              {column.name}
            </option>
          ))}
        </select>
        <select
          value={rule.operator}
          onChange={(event) => onChange(rule.id, { operator: event.target.value as RuleOperator })}
          className={FIELD_CLASS}
        >
          {OPERATOR_OPTIONS.map((entry) => (
            <option key={entry.value} value={entry.value}>
              {entry.label}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={() => onRemove(rule.id)}
          className="inline-flex items-center justify-center gap-2 rounded-2xl border border-rose-300/50 bg-rose-500/10 px-4 py-3 text-sm font-semibold text-rose-700 transition hover:bg-rose-500/20 dark:border-rose-500/30 dark:text-rose-300"
        >
          <Trash2 className="h-4 w-4" />
          Remove
        </button>
      </div>

      {option?.supportsColumnMode ? (
        <div className="mt-3 grid gap-3 lg:grid-cols-[220px_1fr]">
          <select
            value={rule.operandMode}
            onChange={(event) => onChange(rule.id, { operandMode: event.target.value as OperandMode })}
            className={FIELD_CLASS}
          >
            <option value="value">Compare to a value</option>
            <option value="column">Compare to another column</option>
          </select>
          {rule.operandMode === "column" ? (
            <select
              value={rule.rightColumn}
              onChange={(event) => onChange(rule.id, { rightColumn: event.target.value })}
              className={FIELD_CLASS}
            >
              {compatibleRightColumns.map((column) => (
                <option key={column.name} value={column.name}>
                  {column.name}
                </option>
              ))}
            </select>
          ) : (
            <input
              value={rule.value}
              onChange={(event) => onChange(rule.id, { value: event.target.value })}
              placeholder="Comparison value"
              className={FIELD_CLASS}
            />
          )}
        </div>
      ) : null}

      {rule.operator === "regex" ? (
        <div className="mt-3">
          <input
            value={rule.value}
            onChange={(event) => onChange(rule.id, { value: event.target.value })}
            placeholder="Regex pattern"
            className={`w-full ${FIELD_CLASS}`}
          />
        </div>
      ) : null}

      {rule.operator === "between" ? (
        <div className="mt-3 grid gap-3 lg:grid-cols-2">
          <input
            value={rule.value}
            onChange={(event) => onChange(rule.id, { value: event.target.value })}
            placeholder="Minimum"
            className={FIELD_CLASS}
          />
          <input
            value={rule.secondaryValue}
            onChange={(event) => onChange(rule.id, { secondaryValue: event.target.value })}
            placeholder="Maximum"
            className={FIELD_CLASS}
          />
        </div>
      ) : null}

      {!option?.requiresTarget ? (
        <p className="mt-3 text-xs text-slate-500 dark:text-slate-400">
          {rule.operator === "not_null"
            ? "Violation rows are those where the selected column is blank."
            : "Violation rows are those that repeat the selected value."}
        </p>
      ) : null}
    </motion.div>
  );
}

function ResultCard({ result }: { result: RuleResult }) {
  const passed = result.violationCount === 0;
  const Icon = passed ? CheckCircle2 : XCircle;
  const headers = Object.keys(result.sampleRows[0] ?? {});

  return (
    <motion.article
      layout
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.28, ease: EASE }}
      className="rounded-[1.5rem] border border-white/15 bg-slate-950/88 p-4"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-semibold ${passed ? "border-emerald-500/20 bg-emerald-500/10 text-emerald-200" : "border-rose-500/20 bg-rose-500/10 text-rose-200"}`}>
            <Icon className="h-4 w-4" />
            {passed ? "Pass" : "Fail"}
          </div>
          <p className="mt-3 text-base font-semibold text-slate-100">{result.summary}</p>
          <p className="mt-1 text-sm text-slate-400">{result.description}</p>
        </div>
        <div className="rounded-2xl border border-slate-800 bg-slate-900/80 px-4 py-3 text-right">
          <p className="text-[11px] uppercase tracking-[0.18em] text-slate-500">Compliance</p>
          <p className="mt-1 text-lg font-semibold text-slate-100">{result.compliance.toFixed(1)}%</p>
          <p className="mt-1 text-xs text-slate-400">{formatNumber(result.violationCount)} violations</p>
        </div>
      </div>

      <div className="mt-4">
        {result.sampleRows.length === 0 ? (
          <p className="text-sm text-slate-400">No violating rows were sampled.</p>
        ) : (
          <div className="overflow-hidden rounded-2xl border border-slate-800">
            <div className="overflow-x-auto">
              <table className="min-w-full text-left text-sm">
                <thead className="bg-slate-900/85">
                  <tr>
                    {headers.map((header) => (
                      <th key={header} className="px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">
                        {header}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800 bg-slate-950/60">
                  {result.sampleRows.map((row, rowIndex) => (
                    <tr key={`${result.id}-${rowIndex}`}>
                      {headers.map((header) => (
                        <td key={header} className="px-3 py-2 text-slate-300">
                          {row[header] == null ? "null" : String(row[header])}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </motion.article>
  );
}

export default function DataQualityRules({ tableName, columns }: DataQualityRulesProps) {
  const savedRuleSets = useSyncExternalStore(
    subscribeRuleSets,
    () => readRuleSets(tableName),
    () => EMPTY_RULE_SETS,
  );
  const [rules, setRules] = useState<QualityRule[]>(() => [createRule(columns)]);
  const [ruleSetName, setRuleSetName] = useState("");
  const [results, setResults] = useState<RuleResult[]>([]);
  const [rowCount, setRowCount] = useState(0);
  const [running, setRunning] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const normalizedRules = useMemo(
    () => rules.map((rule) => normalizeRule(columns, rule)),
    [columns, rules],
  );
  const tasks = useMemo(
    () => normalizedRules.map((rule) => buildRuleTask(tableName, columns, rule)).filter((task): task is RuleTask => Boolean(task)),
    [columns, normalizedRules, tableName],
  );
  const overallCompliance = useMemo(() => {
    if (results.length === 0) return 0;
    return results.reduce((sum, result) => sum + result.compliance, 0) / results.length;
  }, [results]);

  function addRule() {
    setRules((current) => [...current, createRule(columns)]);
  }

  function updateRule(ruleId: string, patch: Partial<QualityRule>) {
    setRules((current) =>
      current.map((rule) => (rule.id === ruleId ? { ...rule, ...patch } : rule)),
    );
  }

  function removeRule(ruleId: string) {
    setRules((current) => current.filter((rule) => rule.id !== ruleId));
  }

  function applyPreset(preset: RulePreset) {
    const nextRule = preset.build(columns);
    if (!nextRule) {
      setError(`No compatible column is available for the ${preset.label.toLowerCase()} preset.`);
      return;
    }
    setError(null);
    setRules((current) => [...current, nextRule]);
  }

  function saveRuleSet() {
    const name = ruleSetName.trim();
    if (!name) {
      setError("Name the rule set before saving it.");
      return;
    }
    writeRuleSets(tableName, [
      {
        id: generateId(),
        name,
        savedAt: Date.now(),
        rules: normalizedRules,
      },
      ...savedRuleSets,
    ]);
    setRuleSetName("");
  }

  function loadRuleSet(ruleSet: SavedRuleSet) {
    startTransition(() => {
      setRules(ruleSet.rules.map((rule) => normalizeRule(columns, rule)));
      setResults([]);
      setError(null);
    });
  }

  function deleteRuleSet(ruleSetId: string) {
    writeRuleSets(
      tableName,
      savedRuleSets.filter((ruleSet) => ruleSet.id !== ruleSetId),
    );
  }

  async function runRules() {
    if (tasks.length === 0) {
      setError("Add at least one valid rule before running the engine.");
      return;
    }

    setRunning(true);
    setError(null);

    try {
      const countRow = (await runQuery(`SELECT COUNT(*) AS row_count FROM ${quoteIdentifier(tableName)}`))[0] ?? {};
      const nextRowCount = Number(countRow.row_count ?? 0);
      const nextResults = await Promise.all(
        tasks.map(async (task) => {
          const violationRow = (await runQuery(task.countSql))[0] ?? {};
          const violationCount = Number(violationRow.violations ?? 0);
          const sampleRows = violationCount > 0 ? await runQuery(task.sampleSql) : [];
          const compliance = nextRowCount === 0 ? 100 : Math.max(0, ((nextRowCount - violationCount) / nextRowCount) * 100);
          return {
            ...task,
            violationCount,
            compliance,
            sampleRows,
          } satisfies RuleResult;
        }),
      );

      startTransition(() => {
        setRowCount(nextRowCount);
        setResults(nextResults.sort((left, right) => right.violationCount - left.violationCount));
      });
    } catch (runError) {
      setResults([]);
      setError(runError instanceof Error ? runError.message : "Rule execution failed.");
    } finally {
      setRunning(false);
    }
  }

  async function exportViolations() {
    const failingRules = results.filter((result) => result.violationCount > 0);
    if (failingRules.length === 0) return;

    setExporting(true);
    setError(null);

    try {
      const exportedRows: Record<string, unknown>[] = [];
      for (const result of failingRules) {
        const rows = await runQuery(result.exportSql);
        rows.forEach((row) => {
          exportedRows.push({
            __rule: result.summary,
            __compliance: result.compliance.toFixed(1),
            ...row,
          });
        });
      }
      exportToCSV(exportedRows, `${tableName}-quality-violations.csv`);
    } catch (exportError) {
      setError(exportError instanceof Error ? exportError.message : "Failed to export violation rows.");
    } finally {
      setExporting(false);
    }
  }

  return (
    <motion.section
      initial={{ opacity: 0, y: 18 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.34, ease: EASE }}
      className={`${PANEL_CLASS} overflow-hidden p-6`}
    >
      <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <div className="inline-flex items-center gap-2 rounded-full border border-cyan-400/20 bg-cyan-500/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.16em] text-cyan-700 dark:text-cyan-300">
            <ShieldCheck className="h-4 w-4" />
            Custom Rule Engine
          </div>
          <h2 className="mt-3 text-2xl font-semibold text-slate-900 dark:text-slate-100">Define quality checks for {tableName}</h2>
          <p className="mt-2 max-w-3xl text-sm text-slate-600 dark:text-slate-300">
            Combine null checks, uniqueness, regex matching, numeric thresholds, date windows, and cross-column comparisons into reusable rule sets.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <ScoreBadge score={overallCompliance} />
          <div className="rounded-2xl border border-white/20 bg-white/70 px-4 py-3 text-sm text-slate-600 dark:bg-slate-950/45 dark:text-slate-300">
            {formatNumber(tasks.length)} rules across {formatNumber(rowCount)} rows
          </div>
        </div>
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-4">
        {RULE_PRESETS.map((preset) => (
          <RulePresetButton key={preset.id} preset={preset} onApply={applyPreset} />
        ))}
      </div>

      <div className="mt-6 grid gap-5 xl:grid-cols-[1.2fr_0.8fr]">
        <div className="space-y-4 rounded-[1.5rem] border border-white/15 bg-white/65 p-4 dark:bg-slate-950/35">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">Rule builder</p>
              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">Select a column, an operator, and either a literal value or a second column when needed.</p>
            </div>
            <button
              type="button"
              onClick={addRule}
              className="inline-flex items-center gap-2 rounded-2xl border border-cyan-400/20 bg-cyan-500/10 px-4 py-2 text-sm font-semibold text-cyan-700 transition hover:bg-cyan-500/20 dark:text-cyan-300"
            >
              <Plus className="h-4 w-4" />
              Add rule
            </button>
          </div>

          <AnimatePresence initial={false}>
            {normalizedRules.map((rule) => (
              <RuleBuilderCard
                key={rule.id}
                columns={columns}
                rule={rule}
                onChange={updateRule}
                onRemove={removeRule}
              />
            ))}
          </AnimatePresence>

          <div className="grid gap-3 lg:grid-cols-[1fr_auto]">
            <input
              value={ruleSetName}
              onChange={(event) => setRuleSetName(event.target.value)}
              placeholder="Rule set name"
              className={FIELD_CLASS}
            />
            <button
              type="button"
              onClick={saveRuleSet}
              disabled={normalizedRules.length === 0}
              className="inline-flex items-center justify-center gap-2 rounded-2xl border border-white/20 bg-white/80 px-5 py-3 text-sm font-semibold text-slate-700 transition hover:bg-white disabled:cursor-not-allowed disabled:opacity-60 dark:bg-slate-950/45 dark:text-slate-200 dark:hover:bg-slate-950/65"
            >
              <Save className="h-4 w-4" />
              Save set
            </button>
          </div>

          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              onClick={() => void runRules()}
              disabled={running || tasks.length === 0}
              className="inline-flex items-center gap-2 rounded-2xl bg-cyan-500 px-5 py-3 text-sm font-semibold text-slate-950 transition hover:bg-cyan-400 disabled:cursor-not-allowed disabled:bg-slate-300 disabled:text-slate-500 dark:disabled:bg-slate-800 dark:disabled:text-slate-500"
            >
              {running ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
              Run all rules
            </button>
            <button
              type="button"
              onClick={() => void exportViolations()}
              disabled={exporting || results.every((result) => result.violationCount === 0)}
              className="inline-flex items-center gap-2 rounded-2xl border border-white/20 bg-white/80 px-5 py-3 text-sm font-semibold text-slate-700 transition hover:bg-white disabled:cursor-not-allowed disabled:opacity-60 dark:bg-slate-950/45 dark:text-slate-200 dark:hover:bg-slate-950/65"
            >
              {exporting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
              Export violations CSV
            </button>
          </div>
        </div>

        <div className="space-y-4 rounded-[1.5rem] border border-white/15 bg-white/65 p-4 dark:bg-slate-950/35">
          <div>
            <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">Saved rule sets</p>
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">Load reusable presets from localStorage, or remove old versions you no longer need.</p>
          </div>

          {savedRuleSets.length === 0 ? (
            <div className="rounded-[1.25rem] border border-dashed border-white/20 px-4 py-10 text-center text-sm text-slate-500 dark:text-slate-400">
              No saved rule sets yet.
            </div>
          ) : (
            <div className="space-y-3">
              {savedRuleSets.map((ruleSet) => (
                <div key={ruleSet.id} className="rounded-[1.25rem] border border-white/15 bg-white/70 p-4 dark:bg-slate-950/45">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">{ruleSet.name}</p>
                      <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                        {formatNumber(ruleSet.rules.length)} rules • {new Date(ruleSet.savedAt).toLocaleString()}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => deleteRuleSet(ruleSet.id)}
                      className="rounded-xl border border-rose-300/50 bg-rose-500/10 p-2 text-rose-700 transition hover:bg-rose-500/20 dark:border-rose-500/30 dark:text-rose-300"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => loadRuleSet(ruleSet)}
                      className="inline-flex items-center gap-2 rounded-xl border border-white/20 bg-white/80 px-3 py-2 text-sm font-semibold text-slate-700 transition hover:bg-white dark:bg-slate-950/45 dark:text-slate-200 dark:hover:bg-slate-950/65"
                    >
                      <Upload className="h-4 w-4" />
                      Load
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {error ? (
        <div className="mt-5 rounded-2xl border border-rose-300/50 bg-rose-500/10 px-4 py-3 text-sm text-rose-700 dark:border-rose-500/30 dark:text-rose-300">
          {error}
        </div>
      ) : null}

      <div className="mt-6 space-y-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">Execution results</p>
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">Each rule reports a pass/fail state, violation count, and compliance rate.</p>
          </div>
        </div>

        {results.length === 0 ? (
          <div className="rounded-[1.5rem] border border-dashed border-white/20 px-4 py-12 text-center text-sm text-slate-500 dark:text-slate-400">
            Run the rule engine to see violations, compliance, and sampled failure rows.
          </div>
        ) : (
          <div className="space-y-4">
            {results.map((result) => (
              <ResultCard key={result.id} result={result} />
            ))}
          </div>
        )}
      </div>
    </motion.section>
  );
}
