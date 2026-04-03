"use client";

import { useDeferredValue, useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  BarChart3,
  Copy,
  Filter,
  GitBranch,
  Loader2,
  Plus,
  Save,
  Sparkles,
  Trash2,
  Wand2,
} from "lucide-react";
import { useLocalStorage } from "@/hooks/use-local-storage";
import { runQuery } from "@/lib/duckdb/client";
import type { ColumnProfile, ColumnType } from "@/types/dataset";

interface SmartFilterProps {
  tableName: string;
  columns: ColumnProfile[];
}

type GroupCombinator = "AND" | "OR";
type RuleOperator =
  | "="
  | "!="
  | ">"
  | "<"
  | ">="
  | "<="
  | "between"
  | "contains"
  | "starts_with"
  | "regex"
  | "before"
  | "after"
  | "range"
  | "is_null"
  | "is_not_null";

interface FilterRule {
  id: string;
  kind: "rule";
  column: string;
  operator: RuleOperator;
  value: string;
  valueTo: string;
}

interface FilterGroup {
  id: string;
  kind: "group";
  combinator: GroupCombinator;
  children: FilterNode[];
}

type FilterNode = FilterRule | FilterGroup;

interface SavedPreset {
  id: string;
  name: string;
  filter: FilterGroup;
  naturalLanguage: string;
  createdAt: number;
}

interface QuickStatBar {
  id: string;
  label: string;
  count: number;
  value: string;
  valueTo: string;
  kind: "numeric" | "category";
}

interface ParsedLanguageResult {
  filter: FilterGroup | null;
  error: string | null;
}

const STORAGE_KEY = "datalens:smart-filter";
const EASE = [0.22, 1, 0.36, 1] as const;

function createId(): string {
  return Math.random().toString(36).slice(2, 10);
}

function quoteIdentifier(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

function normalize(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function resolveColumn(columns: ColumnProfile[], rawName: string): ColumnProfile | null {
  return columns.find((column) => normalize(column.name) === normalize(rawName)) ?? null;
}

function defaultRule(columns: ColumnProfile[]): FilterRule {
  const firstColumn = columns[0];
  return {
    id: createId(),
    kind: "rule",
    column: firstColumn?.name ?? "",
    operator:
      firstColumn?.type === "number"
        ? ">"
        : firstColumn?.type === "date"
          ? "after"
          : "contains",
    value: "",
    valueTo: "",
  };
}

function defaultGroup(columns: ColumnProfile[]): FilterGroup {
  return {
    id: createId(),
    kind: "group",
    combinator: "AND",
    children: [defaultRule(columns)],
  };
}

function operatorOptions(columnType: ColumnType): RuleOperator[] {
  if (columnType === "number") {
    return ["=", "!=", ">", "<", ">=", "<=", "between", "is_null", "is_not_null"];
  }

  if (columnType === "date") {
    return ["before", "after", "range", "is_null", "is_not_null"];
  }

  if (columnType === "boolean") {
    return ["=", "!=", "is_null", "is_not_null"];
  }

  return ["=", "!=", "contains", "starts_with", "regex", "is_null", "is_not_null"];
}

function literalForColumn(column: ColumnProfile, raw: string): string | null {
  const cleaned = raw.trim().replace(/^["']|["']$/g, "");

  if (column.type === "number") {
    const numeric = Number(cleaned);
    return Number.isFinite(numeric) ? String(numeric) : null;
  }

  if (column.type === "boolean") {
    if (/^(true|1|yes)$/i.test(cleaned)) {
      return "TRUE";
    }

    if (/^(false|0|no)$/i.test(cleaned)) {
      return "FALSE";
    }

    return null;
  }

  if (column.type === "date") {
    return `TRY_CAST('${cleaned.replaceAll("'", "''")}' AS TIMESTAMP)`;
  }

  return `'${cleaned.replaceAll("'", "''")}'`;
}

function ruleToSql(rule: FilterRule, columns: ColumnProfile[]): string | null {
  const column = resolveColumn(columns, rule.column);
  if (!column) {
    return null;
  }

  const field = quoteIdentifier(column.name);

  if (rule.operator === "is_null") {
    return `${field} IS NULL`;
  }

  if (rule.operator === "is_not_null") {
    return `${field} IS NOT NULL`;
  }

  if (rule.operator === "contains") {
    return `CAST(${field} AS VARCHAR) ILIKE '%${rule.value.replaceAll("'", "''").trim()}%'`;
  }

  if (rule.operator === "starts_with") {
    return `CAST(${field} AS VARCHAR) ILIKE '${rule.value.replaceAll("'", "''").trim()}%'`;
  }

  if (rule.operator === "regex") {
    return `regexp_matches(CAST(${field} AS VARCHAR), '${rule.value.replaceAll("'", "''")}')`;
  }

  if (rule.operator === "between" || rule.operator === "range") {
    const fromValue = literalForColumn(column, rule.value);
    const toValue = literalForColumn(column, rule.valueTo);
    if (!fromValue || !toValue) {
      return null;
    }

    return `${field} BETWEEN ${fromValue} AND ${toValue}`;
  }

  if (rule.operator === "before") {
    const value = literalForColumn(column, rule.value);
    return value ? `TRY_CAST(${field} AS TIMESTAMP) < ${value}` : null;
  }

  if (rule.operator === "after") {
    const value = literalForColumn(column, rule.value);
    return value ? `TRY_CAST(${field} AS TIMESTAMP) > ${value}` : null;
  }

  const literal = literalForColumn(column, rule.value);
  return literal ? `${field} ${rule.operator} ${literal}` : null;
}

function groupToSql(group: FilterGroup, columns: ColumnProfile[]): string {
  const parts = group.children
    .map((child) => {
      if (child.kind === "rule") {
        return ruleToSql(child, columns);
      }

      const nested = groupToSql(child, columns);
      return nested ? `(${nested})` : null;
    })
    .filter((value): value is string => Boolean(value));

  return parts.join(` ${group.combinator} `);
}

function replaceNode(group: FilterGroup, targetId: string, nextNode: FilterNode): FilterGroup {
  if (group.id === targetId && nextNode.kind === "group") {
    return nextNode;
  }

  return {
    ...group,
    children: group.children.map((child) => {
      if (child.id === targetId) {
        return nextNode;
      }

      if (child.kind === "group") {
        return replaceNode(child, targetId, nextNode);
      }

      return child;
    }),
  };
}

function appendNode(group: FilterGroup, targetGroupId: string, nextNode: FilterNode): FilterGroup {
  if (group.id === targetGroupId) {
    return { ...group, children: [...group.children, nextNode] };
  }

  return {
    ...group,
    children: group.children.map((child) =>
      child.kind === "group" ? appendNode(child, targetGroupId, nextNode) : child,
    ),
  };
}

function removeNode(group: FilterGroup, targetId: string, columns: ColumnProfile[]): FilterGroup {
  const children = group.children
    .filter((child) => child.id !== targetId)
    .map((child) => (child.kind === "group" ? removeNode(child, targetId, columns) : child));

  return {
    ...group,
    children: children.length > 0 ? children : [defaultRule(columns)],
  };
}

function parseClauseToRule(clause: string, columns: ColumnProfile[]): FilterRule | null {
  const trimmed = clause.trim();
  if (!trimmed) {
    return null;
  }

  const patterns: Array<[RegExp, (match: RegExpMatchArray) => Omit<FilterRule, "id" | "kind"> | null]> = [
    [
      /^(.+?)\s+between\s+(.+?)\s+and\s+(.+)$/i,
      (match) => ({ column: match[1], operator: "between", value: match[2], valueTo: match[3] }),
    ],
    [
      /^(.+?)\s+range\s+(.+?)\s+to\s+(.+)$/i,
      (match) => ({ column: match[1], operator: "range", value: match[2], valueTo: match[3] }),
    ],
    [
      /^(.+?)\s+starts with\s+(.+)$/i,
      (match) => ({ column: match[1], operator: "starts_with", value: match[2], valueTo: "" }),
    ],
    [
      /^(.+?)\s+contains\s+(.+)$/i,
      (match) => ({ column: match[1], operator: "contains", value: match[2], valueTo: "" }),
    ],
    [
      /^(.+?)\s+regex\s+(.+)$/i,
      (match) => ({ column: match[1], operator: "regex", value: match[2], valueTo: "" }),
    ],
    [
      /^(.+?)\s+before\s+(.+)$/i,
      (match) => ({ column: match[1], operator: "before", value: match[2], valueTo: "" }),
    ],
    [
      /^(.+?)\s+after\s+(.+)$/i,
      (match) => ({ column: match[1], operator: "after", value: match[2], valueTo: "" }),
    ],
    [
      /^(.+?)\s+is null$/i,
      (match) => ({ column: match[1], operator: "is_null", value: "", valueTo: "" }),
    ],
    [
      /^(.+?)\s+is not null$/i,
      (match) => ({ column: match[1], operator: "is_not_null", value: "", valueTo: "" }),
    ],
    [
      /^(.+?)\s*(>=|<=|!=|=|>|<)\s*(.+)$/i,
      (match) => ({
        column: match[1],
        operator: match[2] as RuleOperator,
        value: match[3],
        valueTo: "",
      }),
    ],
  ];

  for (const [pattern, build] of patterns) {
    const match = trimmed.match(pattern);
    if (!match) {
      continue;
    }

    const candidate = build(match);
    const column = resolveColumn(columns, candidate?.column ?? "");
    if (!candidate || !column) {
      return null;
    }

    return {
      id: createId(),
      kind: "rule",
      ...candidate,
      column: column.name,
    };
  }

  return null;
}

function parseNaturalLanguage(text: string, columns: ColumnProfile[]): ParsedLanguageResult {
  const trimmed = text.trim();
  if (!trimmed) {
    return { filter: null, error: null };
  }

  const orSegments = trimmed.split(/\s+OR\s+/i);
  const children: FilterNode[] = [];

  for (const orSegment of orSegments) {
    const andClauses = orSegment.split(/\s+AND\s+/i).map((value) => value.trim()).filter(Boolean);
    const rules = andClauses.map((clause) => parseClauseToRule(clause, columns));

    if (rules.some((rule) => !rule)) {
      return {
        filter: null,
        error: `Could not parse "${orSegment.trim()}". Use patterns like revenue > 1000 or region contains East.`,
      };
    }

    const validRules = rules.filter((rule): rule is FilterRule => Boolean(rule));
    if (validRules.length === 1) {
      children.push(validRules[0]);
    } else {
      children.push({
        id: createId(),
        kind: "group",
        combinator: "AND",
        children: validRules,
      });
    }
  }

  return {
    filter: {
      id: createId(),
      kind: "group",
      combinator: orSegments.length > 1 ? "OR" : "AND",
      children: children.length > 0 ? children : [defaultRule(columns)],
    },
    error: null,
  };
}

function RuleEditor({
  columns,
  onChange,
  onRemove,
  rule,
}: {
  columns: ColumnProfile[];
  onChange: (rule: FilterRule) => void;
  onRemove: () => void;
  rule: FilterRule;
}) {
  const activeColumn = resolveColumn(columns, rule.column) ?? columns[0] ?? null;
  const operators = operatorOptions(activeColumn?.type ?? "string");
  const needsRange = rule.operator === "between" || rule.operator === "range";
  const hidePrimaryValue = rule.operator === "is_null" || rule.operator === "is_not_null";

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -10 }}
      transition={{ duration: 0.24, ease: EASE }}
      className="rounded-2xl border border-white/10 bg-white/10 p-4 dark:bg-slate-950/35"
    >
      <div className="grid gap-3 lg:grid-cols-[1.1fr_0.85fr_0.8fr_auto]">
        <label className="space-y-2 text-sm text-slate-600 dark:text-slate-300">
          <span className="block text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
            Column
          </span>
          <select
            value={rule.column}
            onChange={(event) => {
              const nextColumn = resolveColumn(columns, event.target.value);
              onChange({
                ...rule,
                column: nextColumn?.name ?? event.target.value,
                operator: operatorOptions(nextColumn?.type ?? "string")[0],
                value: "",
                valueTo: "",
              });
            }}
            className="w-full rounded-2xl border border-white/10 bg-white/60 px-3 py-2.5 outline-none dark:bg-slate-950/50"
          >
            {columns.map((column) => (
              <option key={column.name} value={column.name}>
                {column.name}
              </option>
            ))}
          </select>
        </label>

        <label className="space-y-2 text-sm text-slate-600 dark:text-slate-300">
          <span className="block text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
            Operator
          </span>
          <select
            value={rule.operator}
            onChange={(event) => onChange({ ...rule, operator: event.target.value as RuleOperator, valueTo: "" })}
            className="w-full rounded-2xl border border-white/10 bg-white/60 px-3 py-2.5 outline-none dark:bg-slate-950/50"
          >
            {operators.map((operator) => (
              <option key={operator} value={operator}>
                {operator.replaceAll("_", " ")}
              </option>
            ))}
          </select>
        </label>

        <label className="space-y-2 text-sm text-slate-600 dark:text-slate-300">
          <span className="block text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
            Value
          </span>
          {hidePrimaryValue ? (
            <div className="flex h-[42px] items-center rounded-2xl border border-dashed border-white/10 px-3 text-sm text-slate-400">
              No value needed
            </div>
          ) : (
            <div className="space-y-2">
              <input
                value={rule.value}
                onChange={(event) => onChange({ ...rule, value: event.target.value })}
                placeholder={activeColumn?.type === "date" ? "2026-01-01" : "Value"}
                className="w-full rounded-2xl border border-white/10 bg-white/60 px-3 py-2.5 outline-none dark:bg-slate-950/50"
              />
              {needsRange ? (
                <input
                  value={rule.valueTo}
                  onChange={(event) => onChange({ ...rule, valueTo: event.target.value })}
                  placeholder={activeColumn?.type === "date" ? "2026-12-31" : "To"}
                  className="w-full rounded-2xl border border-white/10 bg-white/60 px-3 py-2.5 outline-none dark:bg-slate-950/50"
                />
              ) : null}
            </div>
          )}
        </label>

        <div className="flex items-end">
          <button
            type="button"
            onClick={onRemove}
            className="inline-flex h-[42px] items-center justify-center rounded-2xl border border-rose-400/20 bg-rose-500/10 px-3 text-rose-700 transition hover:bg-rose-500/15 dark:text-rose-300"
            aria-label="Remove filter rule"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      </div>
    </motion.div>
  );
}

function GroupEditor({
  columns,
  group,
  onAddGroup,
  onAddRule,
  onChangeCombinator,
  onChangeRule,
  onRemoveNode,
}: {
  columns: ColumnProfile[];
  group: FilterGroup;
  onAddGroup: (groupId: string) => void;
  onAddRule: (groupId: string) => void;
  onChangeCombinator: (groupId: string, combinator: GroupCombinator) => void;
  onChangeRule: (rule: FilterRule) => void;
  onRemoveNode: (nodeId: string) => void;
}) {
  return (
    <div className="rounded-[28px] border border-white/10 bg-white/5 p-4 dark:bg-slate-950/25">
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="inline-flex rounded-full border border-white/10 bg-white/10 p-1 dark:bg-slate-950/45">
          {(["AND", "OR"] as const).map((value) => (
            <button
              key={value}
              type="button"
              onClick={() => onChangeCombinator(group.id, value)}
              className={`rounded-full px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.18em] transition ${
                group.combinator === value
                  ? "bg-cyan-500/15 text-cyan-800 dark:text-cyan-200"
                  : "text-slate-500 dark:text-slate-400"
              }`}
            >
              {value}
            </button>
          ))}
        </div>

        <button
          type="button"
          onClick={() => onAddRule(group.id)}
          className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/10 px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.18em] text-slate-600 transition hover:border-cyan-400/20 dark:bg-slate-950/40 dark:text-slate-300"
        >
          <Plus className="h-3.5 w-3.5" />
          Rule
        </button>
        <button
          type="button"
          onClick={() => onAddGroup(group.id)}
          className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/10 px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.18em] text-slate-600 transition hover:border-cyan-400/20 dark:bg-slate-950/40 dark:text-slate-300"
        >
          <GitBranch className="h-3.5 w-3.5" />
          Group
        </button>
      </div>

      <AnimatePresence initial={false}>
        <div className="space-y-3">
          {group.children.map((child) =>
            child.kind === "rule" ? (
              <RuleEditor
                key={child.id}
                columns={columns}
                rule={child}
                onChange={onChangeRule}
                onRemove={() => onRemoveNode(child.id)}
              />
            ) : (
              <motion.div
                key={child.id}
                layout
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                transition={{ duration: 0.24, ease: EASE }}
                className="rounded-[26px] border border-white/10 bg-slate-950/10 p-3 dark:bg-slate-950/20"
              >
                <div className="mb-3 flex justify-end">
                  <button
                    type="button"
                    onClick={() => onRemoveNode(child.id)}
                    className="inline-flex items-center gap-2 rounded-full border border-rose-400/20 bg-rose-500/10 px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.18em] text-rose-700 dark:text-rose-300"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    Remove group
                  </button>
                </div>
                <GroupEditor
                  columns={columns}
                  group={child}
                  onAddGroup={onAddGroup}
                  onAddRule={onAddRule}
                  onChangeCombinator={onChangeCombinator}
                  onChangeRule={onChangeRule}
                  onRemoveNode={onRemoveNode}
                />
              </motion.div>
            ),
          )}
        </div>
      </AnimatePresence>
    </div>
  );
}

function FilterTreePreview({ group }: { group: FilterGroup }) {
  return (
    <div className="space-y-3">
      <div className="inline-flex items-center rounded-full border border-white/10 bg-white/10 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500 dark:bg-slate-950/40 dark:text-slate-400">
        {group.combinator} group
      </div>
      <div className="space-y-2 pl-3">
        {group.children.map((child) =>
          child.kind === "rule" ? (
            <div
              key={child.id}
              className="rounded-2xl border border-white/10 bg-white/10 px-3 py-2 text-sm text-slate-600 dark:bg-slate-950/35 dark:text-slate-300"
            >
              {child.column || "Column"} {child.operator.replaceAll("_", " ")}
              {child.value ? ` ${child.value}` : ""}
              {child.valueTo ? ` and ${child.valueTo}` : ""}
            </div>
          ) : (
            <div key={child.id} className="rounded-2xl border border-white/10 bg-white/5 px-3 py-3 dark:bg-slate-950/20">
              <FilterTreePreview group={child} />
            </div>
          ),
        )}
      </div>
    </div>
  );
}

export default function SmartFilter({ tableName, columns }: SmartFilterProps) {
  const [filterTree, setFilterTree] = useState<FilterGroup>(() => defaultGroup(columns));
  const [naturalLanguage, setNaturalLanguage] = useState("");
  const [quickColumn, setQuickColumn] = useState<string>(() => columns[0]?.name ?? "");
  const [quickStats, setQuickStats] = useState<QuickStatBar[]>([]);
  const [rowCountPreview, setRowCountPreview] = useState<number | null>(null);
  const [copyNotice, setCopyNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [loadingQuickStats, setLoadingQuickStats] = useState(false);
  const [savedPresets, setSavedPresets] = useLocalStorage<SavedPreset[]>(`${STORAGE_KEY}:${tableName}`, []);

  const deferredFilterTree = useDeferredValue(filterTree);
  const whereClause = useMemo(() => groupToSql(deferredFilterTree, columns), [columns, deferredFilterTree]);
  const parsedLanguage = useMemo(() => parseNaturalLanguage(naturalLanguage, columns), [columns, naturalLanguage]);

  useEffect(() => {
    let cancelled = false;
    const timeout = window.setTimeout(async () => {
      if (!whereClause) {
        setRowCountPreview(null);
        return;
      }

      setBusy(true);
      try {
        const rows = await runQuery(
          `SELECT COUNT(*) AS row_count FROM ${quoteIdentifier(tableName)} WHERE ${whereClause}`,
        );
        if (!cancelled) {
          setRowCountPreview(Number(rows[0]?.row_count ?? 0));
        }
      } catch {
        if (!cancelled) {
          setRowCountPreview(null);
        }
      } finally {
        if (!cancelled) {
          setBusy(false);
        }
      }
    }, 220);

    return () => {
      cancelled = true;
      window.clearTimeout(timeout);
    };
  }, [tableName, whereClause]);

  useEffect(() => {
    let cancelled = false;
    const activeColumn = resolveColumn(columns, quickColumn);
    if (!activeColumn) {
      setQuickStats([]);
      return;
    }

    const activeColumnName = activeColumn.name;
    const activeColumnType = activeColumn.type;

    async function loadQuickStats(): Promise<void> {
      setLoadingQuickStats(true);
      try {
        if (activeColumnType === "number") {
          const rows = await runQuery(`
            WITH ranked AS (
              SELECT
                TRY_CAST(${quoteIdentifier(activeColumnName)} AS DOUBLE) AS value,
                NTILE(8) OVER (ORDER BY TRY_CAST(${quoteIdentifier(activeColumnName)} AS DOUBLE)) AS bucket
              FROM ${quoteIdentifier(tableName)}
              WHERE ${quoteIdentifier(activeColumnName)} IS NOT NULL
            )
            SELECT
              bucket,
              MIN(value) AS min_value,
              MAX(value) AS max_value,
              COUNT(*) AS bucket_count
            FROM ranked
            GROUP BY 1
            ORDER BY 1
          `);

          if (!cancelled) {
            setQuickStats(
              rows.map((row) => ({
                id: `${activeColumnName}:${row.bucket ?? createId()}`,
                label: `${Number(row.min_value ?? 0).toFixed(1)} to ${Number(row.max_value ?? 0).toFixed(1)}`,
                count: Number(row.bucket_count ?? 0),
                value: String(row.min_value ?? ""),
                valueTo: String(row.max_value ?? ""),
                kind: "numeric",
              })),
            );
          }
        } else {
          const rows = await runQuery(`
            SELECT
              CAST(${quoteIdentifier(activeColumnName)} AS VARCHAR) AS label,
              COUNT(*) AS bucket_count
            FROM ${quoteIdentifier(tableName)}
            WHERE ${quoteIdentifier(activeColumnName)} IS NOT NULL
            GROUP BY 1
            ORDER BY 2 DESC, 1 ASC
            LIMIT 8
          `);

          if (!cancelled) {
            setQuickStats(
              rows.map((row) => ({
                id: `${activeColumnName}:${String(row.label ?? "")}`,
                label: String(row.label ?? "Empty"),
                count: Number(row.bucket_count ?? 0),
                value: String(row.label ?? ""),
                valueTo: "",
                kind: "category",
              })),
            );
          }
        }
      } catch {
        if (!cancelled) {
          setQuickStats([]);
        }
      } finally {
        if (!cancelled) {
          setLoadingQuickStats(false);
        }
      }
    }

    void loadQuickStats();
    return () => {
      cancelled = true;
    };
  }, [columns, quickColumn, tableName]);

  function updateRule(nextRule: FilterRule): void {
    setFilterTree((current) => replaceNode(current, nextRule.id, nextRule));
  }

  function addRule(groupId: string): void {
    setFilterTree((current) => appendNode(current, groupId, defaultRule(columns)));
  }

  function addGroup(groupId: string): void {
    setFilterTree((current) => appendNode(current, groupId, defaultGroup(columns)));
  }

  function removeNodeFromTree(nodeId: string): void {
    if (nodeId === filterTree.id) {
      return;
    }

    setFilterTree((current) => removeNode(current, nodeId, columns));
  }

  function resolveGroup(group: FilterGroup, targetId: string): FilterGroup | null {
    if (group.id === targetId) {
      return group;
    }

    for (const child of group.children) {
      if (child.kind !== "group") {
        continue;
      }

      const resolved = resolveGroup(child, targetId);
      if (resolved) {
        return resolved;
      }
    }

    return null;
  }

  function importNaturalLanguage(): void {
    if (parsedLanguage.filter) {
      setFilterTree(parsedLanguage.filter);
      setCopyNotice("Natural language filter imported into the builder.");
    }
  }

  function applyQuickStat(item: QuickStatBar): void {
    const activeColumn = resolveColumn(columns, quickColumn);
    if (!activeColumn) {
      return;
    }

    const nextRule: FilterRule =
      item.kind === "numeric"
        ? {
            id: createId(),
            kind: "rule",
            column: activeColumn.name,
            operator: "between",
            value: item.value,
            valueTo: item.valueTo,
          }
        : {
            id: createId(),
            kind: "rule",
            column: activeColumn.name,
            operator: activeColumn.type === "string" ? "contains" : "=",
            value: item.value,
            valueTo: "",
          };

    setFilterTree((current) => appendNode(current, current.id, nextRule));
    setCopyNotice(`Quick filter added from ${item.label}.`);
  }

  async function copyWhereClause(): Promise<void> {
    if (!whereClause) {
      return;
    }

    try {
      await navigator.clipboard.writeText(whereClause);
      setCopyNotice("SQL WHERE clause copied to the clipboard.");
    } catch {
      setCopyNotice("Clipboard access was blocked in this browser context.");
    }
  }

  function savePreset(): void {
    const name = naturalLanguage.trim() || `Preset ${savedPresets.length + 1}`;
    setSavedPresets((current) => [
      {
        id: createId(),
        name,
        filter: filterTree,
        naturalLanguage,
        createdAt: Date.now(),
      },
      ...current,
    ].slice(0, 15));
    setCopyNotice(`Saved preset "${name}".`);
  }

  return (
    <section className="overflow-hidden rounded-[30px] border border-white/15 bg-[radial-gradient(circle_at_top_right,rgba(14,165,233,0.16),transparent_24%),linear-gradient(135deg,rgba(248,250,252,0.92),rgba(226,232,240,0.78))] shadow-[0_30px_120px_-50px_rgba(15,23,42,0.9)] dark:border-white/10 dark:bg-[radial-gradient(circle_at_top_right,rgba(14,165,233,0.18),transparent_24%),linear-gradient(135deg,rgba(2,6,23,0.95),rgba(15,23,42,0.88))]">
      <div className="border-b border-white/10 px-6 py-5">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full border border-sky-400/20 bg-sky-500/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.22em] text-sky-700 dark:text-sky-300">
              <Sparkles className="h-3.5 w-3.5" />
              Smart Filter
            </div>
            <h2 className="mt-3 text-2xl font-semibold tracking-tight text-slate-950 dark:text-slate-50">
              Natural language plus visual filter groups
            </h2>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600 dark:text-slate-300">
              Parse phrases like <span className="font-mono">revenue &gt; 1000 AND region contains East</span>,
              refine the logic tree visually, and export a DuckDB-ready <span className="font-mono">WHERE</span> clause.
            </p>
          </div>

          <div className="rounded-3xl border border-white/10 bg-white/10 px-4 py-3 backdrop-blur-xl dark:bg-slate-950/45">
            <div className="text-xs uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">Preview rows</div>
            <div className="mt-2 flex items-center gap-2 text-xl font-semibold text-slate-950 dark:text-slate-50">
              {busy ? <Loader2 className="h-4 w-4 animate-spin text-sky-500" /> : null}
              {rowCountPreview === null ? "—" : rowCountPreview.toLocaleString()}
            </div>
          </div>
        </div>
      </div>

      <div className="grid gap-5 px-6 py-6 xl:grid-cols-[1.15fr_0.85fr]">
        <div className="space-y-5">
          <div className="rounded-3xl border border-white/15 bg-white/10 p-5 backdrop-blur-xl dark:border-white/10 dark:bg-slate-950/45">
            <div className="mb-4 flex items-center gap-2 text-slate-900 dark:text-slate-100">
              <Wand2 className="h-4 w-4 text-sky-600 dark:text-sky-300" />
              Natural language parser
            </div>

            <textarea
              value={naturalLanguage}
              onChange={(event) => setNaturalLanguage(event.target.value)}
              rows={4}
              placeholder="revenue > 1000 AND region contains East"
              className="w-full rounded-2xl border border-white/10 bg-white/50 px-4 py-3 text-sm outline-none transition focus:border-sky-400/30 dark:bg-slate-950/45"
            />

            <div className="mt-4 flex flex-wrap gap-3">
              <button
                type="button"
                onClick={importNaturalLanguage}
                disabled={!parsedLanguage.filter}
                className="inline-flex items-center gap-2 rounded-2xl border border-sky-400/20 bg-sky-500/10 px-4 py-3 text-sm font-medium text-sky-800 transition disabled:cursor-not-allowed disabled:opacity-60 dark:text-sky-200"
              >
                <Filter className="h-4 w-4" />
                Import parsed filters
              </button>
              <button
                type="button"
                onClick={savePreset}
                className="inline-flex items-center gap-2 rounded-2xl border border-white/10 bg-white/10 px-4 py-3 text-sm text-slate-700 transition hover:bg-white/15 dark:bg-slate-950/40 dark:text-slate-200"
              >
                <Save className="h-4 w-4" />
                Save preset
              </button>
            </div>

            <div className="mt-4 rounded-2xl border border-white/10 bg-slate-950/85 p-4 text-xs leading-6 text-cyan-200">
              {parsedLanguage.error
                ? `-- ${parsedLanguage.error}`
                : parsedLanguage.filter
                  ? groupToSql(parsedLanguage.filter, columns) || "-- Add values to generate SQL."
                  : "-- Type a natural-language filter to see the parsed SQL preview."}
            </div>
          </div>

          <div className="rounded-3xl border border-white/15 bg-white/10 p-5 backdrop-blur-xl dark:border-white/10 dark:bg-slate-950/45">
            <div className="mb-4 flex items-center gap-2 text-slate-900 dark:text-slate-100">
              <Filter className="h-4 w-4 text-sky-600 dark:text-sky-300" />
              Visual builder
            </div>
            <GroupEditor
              columns={columns}
              group={filterTree}
              onAddGroup={addGroup}
              onAddRule={addRule}
              onChangeCombinator={(groupId, combinator) => {
                const target = resolveGroup(filterTree, groupId);
                if (!target) {
                  return;
                }

                setFilterTree((current) =>
                  replaceNode(current, groupId, {
                    ...target,
                    combinator,
                  }),
                );
              }}
              onChangeRule={updateRule}
              onRemoveNode={removeNodeFromTree}
            />
          </div>
        </div>

        <div className="space-y-5">
          <div className="rounded-3xl border border-white/15 bg-white/10 p-5 backdrop-blur-xl dark:border-white/10 dark:bg-slate-950/45">
            <div className="mb-4 flex items-center gap-2 text-slate-900 dark:text-slate-100">
              <GitBranch className="h-4 w-4 text-sky-600 dark:text-sky-300" />
              Logic tree
            </div>
            <FilterTreePreview group={filterTree} />
          </div>

          <div className="rounded-3xl border border-white/15 bg-white/10 p-5 backdrop-blur-xl dark:border-white/10 dark:bg-slate-950/45">
            <div className="mb-4 flex items-center justify-between gap-3">
              <div className="flex items-center gap-2 text-slate-900 dark:text-slate-100">
                <BarChart3 className="h-4 w-4 text-sky-600 dark:text-sky-300" />
                Quick filters from column stats
              </div>
              <select
                value={quickColumn}
                onChange={(event) => setQuickColumn(event.target.value)}
                className="rounded-2xl border border-white/10 bg-white/50 px-3 py-2 text-sm outline-none dark:bg-slate-950/45"
              >
                {columns.map((column) => (
                  <option key={column.name} value={column.name}>
                    {column.name}
                  </option>
                ))}
              </select>
            </div>

            {loadingQuickStats ? (
              <div className="flex h-32 items-center justify-center text-sm text-slate-500 dark:text-slate-400">
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Loading quick stats
              </div>
            ) : (
              <div className="space-y-3">
                {quickStats.map((item) => {
                  const maxCount = Math.max(...quickStats.map((entry) => entry.count), 1);
                  const width = `${(item.count / maxCount) * 100}%`;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => applyQuickStat(item)}
                      className="w-full rounded-2xl border border-white/10 bg-white/10 px-4 py-3 text-left transition hover:border-sky-400/20 hover:bg-white/15 dark:bg-slate-950/35"
                    >
                      <div className="flex items-center justify-between gap-3 text-sm">
                        <span className="font-medium text-slate-800 dark:text-slate-100">{item.label}</span>
                        <span className="text-slate-500 dark:text-slate-400">{item.count.toLocaleString()}</span>
                      </div>
                      <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-200/80 dark:bg-slate-800/80">
                        <div className="h-full rounded-full bg-gradient-to-r from-sky-500 to-cyan-400" style={{ width }} />
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          <div className="rounded-3xl border border-white/15 bg-white/10 p-5 backdrop-blur-xl dark:border-white/10 dark:bg-slate-950/45">
            <div className="mb-4 flex items-center justify-between gap-3">
              <div className="flex items-center gap-2 text-slate-900 dark:text-slate-100">
                <Sparkles className="h-4 w-4 text-sky-600 dark:text-sky-300" />
                SQL output
              </div>
              <button
                type="button"
                onClick={() => void copyWhereClause()}
                disabled={!whereClause}
                className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/10 px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.18em] text-slate-600 disabled:opacity-50 dark:bg-slate-950/40 dark:text-slate-300"
              >
                <Copy className="h-3.5 w-3.5" />
                Copy WHERE
              </button>
            </div>
            <div className="rounded-2xl border border-white/10 bg-slate-950/85 p-4 text-xs leading-6 text-cyan-200">
              {whereClause || "-- Add valid filter rules to build a WHERE clause."}
            </div>
          </div>

          <div className="rounded-3xl border border-white/15 bg-white/10 p-5 backdrop-blur-xl dark:border-white/10 dark:bg-slate-950/45">
            <div className="mb-4 flex items-center gap-2 text-slate-900 dark:text-slate-100">
              <Save className="h-4 w-4 text-sky-600 dark:text-sky-300" />
              Saved presets
            </div>
            <div className="space-y-3">
              {savedPresets.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-white/10 px-4 py-6 text-sm text-slate-500 dark:text-slate-400">
                  Save a filter preset to reuse it across this dataset.
                </div>
              ) : (
                savedPresets.map((preset) => (
                  <button
                    key={preset.id}
                    type="button"
                    onClick={() => {
                      setFilterTree(preset.filter);
                      setNaturalLanguage(preset.naturalLanguage);
                      setCopyNotice(`Loaded preset "${preset.name}".`);
                    }}
                    className="w-full rounded-2xl border border-white/10 bg-white/10 px-4 py-3 text-left transition hover:border-sky-400/20 hover:bg-white/15 dark:bg-slate-950/35"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-sm font-semibold text-slate-900 dark:text-slate-100">{preset.name}</span>
                      <span className="text-xs text-slate-500 dark:text-slate-400">
                        {new Date(preset.createdAt).toLocaleDateString()}
                      </span>
                    </div>
                    <p className="mt-1 truncate text-sm text-slate-600 dark:text-slate-300">
                      {groupToSql(preset.filter, columns)}
                    </p>
                  </button>
                ))
              )}
            </div>
          </div>

          <AnimatePresence>
            {copyNotice ? (
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 10 }}
                className="rounded-2xl border border-sky-400/20 bg-sky-500/10 px-4 py-3 text-sm text-sky-800 dark:text-sky-200"
              >
                {copyNotice}
              </motion.div>
            ) : null}
          </AnimatePresence>
        </div>
      </div>
    </section>
  );
}
