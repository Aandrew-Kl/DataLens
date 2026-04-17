"use client";

import { quoteIdentifier } from "@/lib/utils/sql";
import { useMemo, useState, type ReactNode } from "react";
import { motion } from "framer-motion";
import {
  Check,
  ChevronRight,
  Copy,
  Filter,
  Layers3,
  Play,
  Plus,
  Rows3,
  Sparkles,
  Trash2,
} from "lucide-react";
import type { ColumnProfile } from "@/types/dataset";

interface QueryBuilderProps {
  tableName: string;
  columns: ColumnProfile[];
  onQueryGenerated: (sql: string) => void;
}

type AggregateFn =
  | "NONE"
  | "COUNT"
  | "SUM"
  | "AVG"
  | "MIN"
  | "MAX"
  | "COUNT_DISTINCT";

type Operator =
  | "="
  | "!="
  | ">"
  | "<"
  | ">="
  | "<="
  | "LIKE"
  | "IN"
  | "IS NULL"
  | "IS NOT NULL";

type JoinOperator = "AND" | "OR";
type SortDirection = "ASC" | "DESC";

interface FilterCondition {
  id: string;
  column: string;
  operator: Operator;
  value: string;
}

interface HavingCondition {
  id: string;
  column: string;
  aggregate: AggregateFn;
  operator: Operator;
  value: string;
}

interface OrderRule {
  id: string;
  column: string;
  direction: SortDirection;
}

const EASE = [0.22, 1, 0.36, 1] as const;
const AGGREGATES: AggregateFn[] = ["NONE", "COUNT", "SUM", "AVG", "MIN", "MAX", "COUNT_DISTINCT"];
const OPERATORS: Operator[] = ["=", "!=", ">", "<", ">=", "<=", "LIKE", "IN", "IS NULL", "IS NOT NULL"];
function quoteLiteral(value: string) {
  return `'${value.replace(/'/g, "''")}'`;
}

function createId(prefix: string) {
  return `${prefix}-${Math.random().toString(36).slice(2, 9)}`;
}

function buildAggregateExpression(columnName: string, aggregate: AggregateFn) {
  const field = quoteIdentifier(columnName);
  switch (aggregate) {
    case "COUNT":
      return `COUNT(${field})`;
    case "SUM":
      return `SUM(${field})`;
    case "AVG":
      return `AVG(${field})`;
    case "MIN":
      return `MIN(${field})`;
    case "MAX":
      return `MAX(${field})`;
    case "COUNT_DISTINCT":
      return `COUNT(DISTINCT ${field})`;
    default:
      return field;
  }
}

function buildSelectAlias(columnName: string, aggregate: AggregateFn) {
  if (aggregate === "NONE") return quoteIdentifier(columnName);
  const prefix = aggregate === "COUNT_DISTINCT" ? "count_distinct" : aggregate.toLowerCase();
  return `${buildAggregateExpression(columnName, aggregate)} AS ${quoteIdentifier(`${prefix}_${columnName}`)}`;
}

function formatValueForColumn(value: string, column: ColumnProfile | undefined) {
  if (!column) return quoteLiteral(value);

  if (column.type === "number") {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? String(numeric) : "NULL";
  }

  if (column.type === "boolean") {
    if (/^(true|1|yes)$/i.test(value)) return "TRUE";
    if (/^(false|0|no)$/i.test(value)) return "FALSE";
  }

  return quoteLiteral(value);
}

function buildConditionClause(
  condition: FilterCondition,
  columnMap: Map<string, ColumnProfile>,
) {
  const field = quoteIdentifier(condition.column);
  if (condition.operator === "IS NULL" || condition.operator === "IS NOT NULL") {
    return `${field} ${condition.operator}`;
  }
  if (!condition.value.trim()) return null;

  if (condition.operator === "IN") {
    const items = condition.value
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
    if (items.length === 0) return null;
    const formatted = items.map((item) => formatValueForColumn(item, columnMap.get(condition.column)));
    return `${field} IN (${formatted.join(", ")})`;
  }

  return `${field} ${condition.operator} ${formatValueForColumn(condition.value, columnMap.get(condition.column))}`;
}

function buildHavingClause(
  condition: HavingCondition,
  columnMap: Map<string, ColumnProfile>,
) {
  const expression = buildAggregateExpression(condition.column, condition.aggregate);
  if (condition.operator === "IS NULL" || condition.operator === "IS NOT NULL") {
    return `${expression} ${condition.operator}`;
  }
  if (!condition.value.trim()) return null;

  if (condition.operator === "IN") {
    const items = condition.value
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
    if (items.length === 0) return null;
    const formatted = items.map((item) => formatValueForColumn(item, columnMap.get(condition.column)));
    return `${expression} IN (${formatted.join(", ")})`;
  }

  return `${expression} ${condition.operator} ${formatValueForColumn(condition.value, columnMap.get(condition.column))}`;
}

function StepCard({
  index,
  title,
  description,
  children,
}: {
  index: number;
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <motion.section
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.34, delay: index * 0.04, ease: EASE }}
      className="rounded-[1.75rem] border border-white/20 bg-white/70 p-5 shadow-xl shadow-slate-950/5 backdrop-blur-xl dark:border-white/10 dark:bg-slate-950/45"
    >
      <div className="mb-4 flex items-start gap-3">
        <div className="flex h-9 w-9 items-center justify-center rounded-2xl bg-cyan-500/15 text-sm font-semibold text-cyan-700 dark:text-cyan-300">
          {index}
        </div>
        <div>
          <h3 className="text-lg font-semibold text-slate-950 dark:text-white">{title}</h3>
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">{description}</p>
        </div>
      </div>
      {children}
    </motion.section>
  );
}

function TogglePill({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.16em] transition ${
        active
          ? "bg-cyan-500 text-white"
          : "bg-slate-200/70 text-slate-600 hover:bg-slate-300/70 dark:bg-slate-800/70 dark:text-slate-300 dark:hover:bg-slate-700/70"
      }`}
    >
      {children}
    </button>
  );
}

export default function QueryBuilder({
  tableName,
  columns,
  onQueryGenerated,
}: QueryBuilderProps) {
  const columnMap = useMemo(() => new Map(columns.map((column) => [column.name, column])), [columns]);
  const [selectedColumns, setSelectedColumns] = useState<string[]>([]);
  const [aggregates, setAggregates] = useState<Record<string, AggregateFn>>({});
  const [filters, setFilters] = useState<FilterCondition[]>([]);
  const [whereJoin, setWhereJoin] = useState<JoinOperator>("AND");
  const [groupBy, setGroupBy] = useState<string[]>([]);
  const [havingConditions, setHavingConditions] = useState<HavingCondition[]>([]);
  const [havingJoin, setHavingJoin] = useState<JoinOperator>("AND");
  const [orderRules, setOrderRules] = useState<OrderRule[]>([]);
  const [limit, setLimit] = useState("1000");
  const [copied, setCopied] = useState(false);

  const selectedSet = useMemo(() => new Set(selectedColumns), [selectedColumns]);
  const hasAggregates = useMemo(
    () => selectedColumns.some((column) => (aggregates[column] ?? "NONE") !== "NONE"),
    [aggregates, selectedColumns],
  );

  const effectiveGroupBy = useMemo(() => {
    const manual = new Set(groupBy);
    if (!hasAggregates) return Array.from(manual);
    selectedColumns.forEach((column) => {
      if ((aggregates[column] ?? "NONE") === "NONE") manual.add(column);
    });
    return Array.from(manual);
  }, [aggregates, groupBy, hasAggregates, selectedColumns]);

  const sql = useMemo(() => {
    const quotedTable = quoteIdentifier(tableName);
    const selectExpressions =
      selectedColumns.length > 0
        ? selectedColumns.map((column) => buildSelectAlias(column, aggregates[column] ?? "NONE"))
        : ["*"];

    const whereClauses = filters
      .map((condition) => buildConditionClause(condition, columnMap))
      .filter((clause): clause is string => Boolean(clause));
    const havingClauses = havingConditions
      .map((condition) => buildHavingClause(condition, columnMap))
      .filter((clause): clause is string => Boolean(clause));

    const clauses = [
      `SELECT ${selectExpressions.join(",\n       ")}`,
      `FROM ${quotedTable}`,
    ];

    if (whereClauses.length > 0) {
      clauses.push(`WHERE ${whereClauses.join(` ${whereJoin} `)}`);
    }

    if (effectiveGroupBy.length > 0) {
      clauses.push(`GROUP BY ${effectiveGroupBy.map(quoteIdentifier).join(", ")}`);
    }

    if (havingClauses.length > 0) {
      clauses.push(`HAVING ${havingClauses.join(` ${havingJoin} `)}`);
    }

    if (orderRules.length > 0) {
      clauses.push(
        `ORDER BY ${orderRules
          .map((rule) => `${quoteIdentifier(rule.column)} ${rule.direction}`)
          .join(", ")}`,
      );
    }

    const parsedLimit = Number(limit);
    if (Number.isFinite(parsedLimit) && parsedLimit > 0) {
      clauses.push(`LIMIT ${Math.floor(parsedLimit)}`);
    }

    return `${clauses.join("\n")};`;
  }, [aggregates, columnMap, effectiveGroupBy, filters, havingConditions, havingJoin, limit, orderRules, selectedColumns, tableName, whereJoin]);

  const selectionSummary = useMemo(() => {
    if (selectedColumns.length === 0) return "Selecting all columns implicitly.";
    const aggregateCount = selectedColumns.filter((column) => (aggregates[column] ?? "NONE") !== "NONE").length;
    return `${selectedColumns.length} selected columns, ${aggregateCount} with aggregation.`;
  }, [aggregates, selectedColumns]);

  const addFilter = () => {
    const firstColumn = columns[0]?.name ?? "";
    setFilters((current) => [
      ...current,
      { id: createId("where"), column: firstColumn, operator: "=", value: "" },
    ]);
  };

  const addHaving = () => {
    const firstColumn = columns[0]?.name ?? "";
    setHavingConditions((current) => [
      ...current,
      { id: createId("having"), column: firstColumn, aggregate: "COUNT", operator: ">", value: "" },
    ]);
  };

  const addOrderRule = () => {
    const firstColumn = columns[0]?.name ?? "";
    setOrderRules((current) => [
      ...current,
      { id: createId("order"), column: firstColumn, direction: "ASC" },
    ]);
  };

  const handleCopy = async () => {
    await navigator.clipboard.writeText(sql);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  };

  return (
    <section className="rounded-[2rem] border border-white/20 bg-white/70 p-6 shadow-xl shadow-slate-950/5 backdrop-blur-xl dark:border-white/10 dark:bg-slate-950/45">
      <div className="flex flex-col gap-4 border-b border-slate-200/70 pb-5 dark:border-slate-800/70 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-cyan-600 dark:text-cyan-400">
            Query Builder
          </p>
          <h2 className="mt-2 text-2xl font-semibold text-slate-950 dark:text-white">
            Visual SQL composer for {tableName}
          </h2>
          <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">
            Choose columns, add filters, aggregate where needed, and inspect the generated SQL live.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={handleCopy}
            className="inline-flex items-center gap-2 rounded-2xl border border-slate-200/70 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 transition hover:border-cyan-300 hover:text-cyan-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:border-cyan-500/40 dark:hover:text-cyan-300"
          >
            {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
            {copied ? "Copied" : "Copy SQL"}
          </button>
          <button
            type="button"
            onClick={() => onQueryGenerated(sql)}
            className="inline-flex items-center gap-2 rounded-2xl bg-cyan-500 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-cyan-400"
          >
            <Play className="h-4 w-4" />
            Run Query
          </button>
        </div>
      </div>

      <div className="mt-6 grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(340px,0.95fr)]">
        <div className="grid gap-4">
          <StepCard index={1} title="Select" description="Pick the columns you want and optionally assign an aggregate per field.">
            <div className="mb-4 flex flex-wrap items-center gap-2">
              <TogglePill active={selectedColumns.length === columns.length && columns.length > 0} onClick={() => setSelectedColumns(columns.map((column) => column.name))}>
                Select All
              </TogglePill>
              <TogglePill active={selectedColumns.length === 0} onClick={() => setSelectedColumns([])}>
                Deselect All
              </TogglePill>
              <span className="ml-auto text-sm text-slate-600 dark:text-slate-300">{selectionSummary}</span>
            </div>

            <div className="grid gap-3 md:grid-cols-2">
              {columns.map((column) => (
                <label
                  key={column.name}
                  className="flex items-center gap-3 rounded-2xl border border-white/20 bg-slate-50/80 px-4 py-3 dark:border-white/10 dark:bg-slate-900/45"
                >
                  <input
                    type="checkbox"
                    checked={selectedSet.has(column.name)}
                    onChange={(event) =>
                      setSelectedColumns((current) =>
                        event.target.checked
                          ? current.includes(column.name)
                            ? current
                            : [...current, column.name]
                          : current.filter((name) => name !== column.name),
                      )
                    }
                    className="h-4 w-4 rounded border-slate-300 text-cyan-500 focus:ring-cyan-500"
                  />
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium text-slate-950 dark:text-white">{column.name}</p>
                    <p className="text-xs uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">
                      {column.type}
                    </p>
                  </div>
                  <select
                    value={aggregates[column.name] ?? "NONE"}
                    onChange={(event) =>
                      setAggregates((current) => ({
                        ...current,
                        [column.name]: event.target.value as AggregateFn,
                      }))
                    }
                    className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200"
                  >
                    {AGGREGATES.map((aggregate) => (
                      <option key={aggregate} value={aggregate}>
                        {aggregate.replaceAll("_", " ")}
                      </option>
                    ))}
                  </select>
                </label>
              ))}
            </div>
          </StepCard>

          <StepCard index={2} title="Where" description="Add one or more filter conditions and choose how they combine.">
            <div className="mb-4 flex flex-wrap items-center gap-2">
              <div className="inline-flex rounded-full bg-slate-200/70 p-1 dark:bg-slate-800/70">
                {(["AND", "OR"] as const).map((join) => (
                  <button
                    key={join}
                    type="button"
                    onClick={() => setWhereJoin(join)}
                    className={`rounded-full px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.16em] ${
                      whereJoin === join ? "bg-cyan-500 text-white" : "text-slate-600 dark:text-slate-300"
                    }`}
                  >
                    {join}
                  </button>
                ))}
              </div>
              <button
                type="button"
                onClick={addFilter}
                className="inline-flex items-center gap-2 rounded-2xl border border-dashed border-slate-300 px-4 py-2 text-sm text-slate-600 transition hover:border-cyan-300 hover:text-cyan-700 dark:border-slate-700 dark:text-slate-300 dark:hover:border-cyan-500/40 dark:hover:text-cyan-300"
              >
                <Plus className="h-4 w-4" />
                Add Filter
              </button>
            </div>

            <div className="space-y-3">
              {filters.length > 0 ? filters.map((condition) => (
                <div
                  key={condition.id}
                  className="grid gap-3 rounded-2xl border border-white/20 bg-slate-50/80 p-4 dark:border-white/10 dark:bg-slate-900/45 lg:grid-cols-[minmax(0,1fr)_180px_minmax(0,1fr)_auto]"
                >
                  <select
                    value={condition.column}
                    onChange={(event) =>
                      setFilters((current) =>
                        current.map((item) => item.id === condition.id ? { ...item, column: event.target.value } : item),
                      )
                    }
                    className="rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none dark:border-slate-700 dark:bg-slate-950"
                  >
                    {columns.map((column) => (
                      <option key={column.name} value={column.name}>
                        {column.name}
                      </option>
                    ))}
                  </select>
                  <select
                    value={condition.operator}
                    onChange={(event) =>
                      setFilters((current) =>
                        current.map((item) => item.id === condition.id ? { ...item, operator: event.target.value as Operator } : item),
                      )
                    }
                    className="rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none dark:border-slate-700 dark:bg-slate-950"
                  >
                    {OPERATORS.map((operator) => (
                      <option key={operator} value={operator}>
                        {operator}
                      </option>
                    ))}
                  </select>
                  <input
                    value={condition.value}
                    disabled={condition.operator === "IS NULL" || condition.operator === "IS NOT NULL"}
                    onChange={(event) =>
                      setFilters((current) =>
                        current.map((item) => item.id === condition.id ? { ...item, value: event.target.value } : item),
                      )
                    }
                    placeholder={condition.operator === "IN" ? "comma,separated,values" : "Value"}
                    className="rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none disabled:opacity-50 dark:border-slate-700 dark:bg-slate-950"
                  />
                  <button
                    type="button"
                    onClick={() => setFilters((current) => current.filter((item) => item.id !== condition.id))}
                    className="inline-flex items-center justify-center rounded-xl border border-slate-200 px-3 py-2.5 text-slate-500 transition hover:border-rose-300 hover:text-rose-600 dark:border-slate-700 dark:text-slate-300 dark:hover:border-rose-500/40 dark:hover:text-rose-300"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              )) : (
                <div className="rounded-2xl border border-dashed border-slate-300 px-4 py-6 text-sm text-slate-600 dark:border-slate-700 dark:text-slate-300">
                  No WHERE filters yet.
                </div>
              )}
            </div>
          </StepCard>

          <StepCard index={3} title="Group & Having" description="Choose grouping keys and aggregate-aware HAVING constraints.">
            <div className="grid gap-5 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
              <div>
                <p className="mb-3 text-sm font-medium text-slate-700 dark:text-slate-200">Group By</p>
                <div className="flex flex-wrap gap-2">
                  {columns.map((column) => {
                    const active = effectiveGroupBy.includes(column.name);
                    const auto = hasAggregates && (aggregates[column.name] ?? "NONE") === "NONE" && selectedSet.has(column.name);
                    return (
                      <button
                        key={column.name}
                        type="button"
                        onClick={() =>
                          setGroupBy((current) =>
                            current.includes(column.name)
                              ? current.filter((name) => name !== column.name)
                              : [...current, column.name],
                          )
                        }
                        className={`rounded-full px-3 py-2 text-sm transition ${
                          active
                            ? "bg-cyan-500 text-white"
                            : "bg-slate-200/70 text-slate-600 dark:bg-slate-800/70 dark:text-slate-300"
                        }`}
                      >
                        {column.name}
                        {auto ? " · auto" : ""}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div>
                <div className="mb-3 flex flex-wrap items-center gap-2">
                  <div className="inline-flex rounded-full bg-slate-200/70 p-1 dark:bg-slate-800/70">
                    {(["AND", "OR"] as const).map((join) => (
                      <button
                        key={join}
                        type="button"
                        onClick={() => setHavingJoin(join)}
                        className={`rounded-full px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.16em] ${
                          havingJoin === join ? "bg-cyan-500 text-white" : "text-slate-600 dark:text-slate-300"
                        }`}
                      >
                        {join}
                      </button>
                    ))}
                  </div>
                  <button
                    type="button"
                    onClick={addHaving}
                    className="inline-flex items-center gap-2 rounded-2xl border border-dashed border-slate-300 px-4 py-2 text-sm text-slate-600 transition hover:border-cyan-300 hover:text-cyan-700 dark:border-slate-700 dark:text-slate-300 dark:hover:border-cyan-500/40 dark:hover:text-cyan-300"
                  >
                    <Plus className="h-4 w-4" />
                    Add Having
                  </button>
                </div>

                <div className="space-y-3">
                  {havingConditions.length > 0 ? havingConditions.map((condition) => (
                    <div
                      key={condition.id}
                      className="grid gap-3 rounded-2xl border border-white/20 bg-slate-50/80 p-4 dark:border-white/10 dark:bg-slate-900/45 lg:grid-cols-[180px_minmax(0,1fr)_150px_minmax(0,1fr)_auto]"
                    >
                      <select
                        value={condition.aggregate}
                        onChange={(event) =>
                          setHavingConditions((current) =>
                            current.map((item) => item.id === condition.id ? { ...item, aggregate: event.target.value as AggregateFn } : item),
                          )
                        }
                        className="rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none dark:border-slate-700 dark:bg-slate-950"
                      >
                        {AGGREGATES.filter((aggregate) => aggregate !== "NONE").map((aggregate) => (
                          <option key={aggregate} value={aggregate}>
                            {aggregate.replaceAll("_", " ")}
                          </option>
                        ))}
                      </select>
                      <select
                        value={condition.column}
                        onChange={(event) =>
                          setHavingConditions((current) =>
                            current.map((item) => item.id === condition.id ? { ...item, column: event.target.value } : item),
                          )
                        }
                        className="rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none dark:border-slate-700 dark:bg-slate-950"
                      >
                        {columns.map((column) => (
                          <option key={column.name} value={column.name}>
                            {column.name}
                          </option>
                        ))}
                      </select>
                      <select
                        value={condition.operator}
                        onChange={(event) =>
                          setHavingConditions((current) =>
                            current.map((item) => item.id === condition.id ? { ...item, operator: event.target.value as Operator } : item),
                          )
                        }
                        className="rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none dark:border-slate-700 dark:bg-slate-950"
                      >
                        {OPERATORS.map((operator) => (
                          <option key={operator} value={operator}>
                            {operator}
                          </option>
                        ))}
                      </select>
                      <input
                        value={condition.value}
                        disabled={condition.operator === "IS NULL" || condition.operator === "IS NOT NULL"}
                        onChange={(event) =>
                          setHavingConditions((current) =>
                            current.map((item) => item.id === condition.id ? { ...item, value: event.target.value } : item),
                          )
                        }
                        placeholder={condition.operator === "IN" ? "comma,separated,values" : "Value"}
                        className="rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none disabled:opacity-50 dark:border-slate-700 dark:bg-slate-950"
                      />
                      <button
                        type="button"
                        onClick={() => setHavingConditions((current) => current.filter((item) => item.id !== condition.id))}
                        className="inline-flex items-center justify-center rounded-xl border border-slate-200 px-3 py-2.5 text-slate-500 transition hover:border-rose-300 hover:text-rose-600 dark:border-slate-700 dark:text-slate-300 dark:hover:border-rose-500/40 dark:hover:text-rose-300"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  )) : (
                    <div className="rounded-2xl border border-dashed border-slate-300 px-4 py-6 text-sm text-slate-600 dark:border-slate-700 dark:text-slate-300">
                      No HAVING clauses yet.
                    </div>
                  )}
                </div>
              </div>
            </div>
          </StepCard>

          <StepCard index={4} title="Order & Limit" description="Choose result ordering and set the row cap.">
            <div className="mb-4 flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={addOrderRule}
                className="inline-flex items-center gap-2 rounded-2xl border border-dashed border-slate-300 px-4 py-2 text-sm text-slate-600 transition hover:border-cyan-300 hover:text-cyan-700 dark:border-slate-700 dark:text-slate-300 dark:hover:border-cyan-500/40 dark:hover:text-cyan-300"
              >
                <Plus className="h-4 w-4" />
                Add Sort Rule
              </button>
              <label className="ml-auto flex items-center gap-2 rounded-2xl border border-white/20 bg-slate-50/80 px-4 py-2.5 text-sm dark:border-white/10 dark:bg-slate-900/45">
                Limit
                <input
                  type="number"
                  min={1}
                  value={limit}
                  onChange={(event) => setLimit(event.target.value)}
                  className="w-24 bg-transparent text-right outline-none"
                />
              </label>
            </div>

            <div className="space-y-3">
              {orderRules.length > 0 ? orderRules.map((rule) => (
                <div
                  key={rule.id}
                  className="grid gap-3 rounded-2xl border border-white/20 bg-slate-50/80 p-4 dark:border-white/10 dark:bg-slate-900/45 lg:grid-cols-[minmax(0,1fr)_160px_auto]"
                >
                  <select
                    value={rule.column}
                    onChange={(event) =>
                      setOrderRules((current) =>
                        current.map((item) => item.id === rule.id ? { ...item, column: event.target.value } : item),
                      )
                    }
                    className="rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none dark:border-slate-700 dark:bg-slate-950"
                  >
                    {columns.map((column) => (
                      <option key={column.name} value={column.name}>
                        {column.name}
                      </option>
                    ))}
                  </select>
                  <select
                    value={rule.direction}
                    onChange={(event) =>
                      setOrderRules((current) =>
                        current.map((item) => item.id === rule.id ? { ...item, direction: event.target.value as SortDirection } : item),
                      )
                    }
                    className="rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none dark:border-slate-700 dark:bg-slate-950"
                  >
                    <option value="ASC">ASC</option>
                    <option value="DESC">DESC</option>
                  </select>
                  <button
                    type="button"
                    onClick={() => setOrderRules((current) => current.filter((item) => item.id !== rule.id))}
                    className="inline-flex items-center justify-center rounded-xl border border-slate-200 px-3 py-2.5 text-slate-500 transition hover:border-rose-300 hover:text-rose-600 dark:border-slate-700 dark:text-slate-300 dark:hover:border-rose-500/40 dark:hover:text-rose-300"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              )) : (
                <div className="rounded-2xl border border-dashed border-slate-300 px-4 py-6 text-sm text-slate-600 dark:border-slate-700 dark:text-slate-300">
                  Results will keep DuckDB&apos;s default ordering.
                </div>
              )}
            </div>
          </StepCard>
        </div>

        <div className="grid gap-4">
          <StepCard index={5} title="Preview" description="Inspect the generated SQL before sending it to the editor or execution pipeline.">
            <div className="rounded-[1.5rem] border border-slate-200/70 bg-slate-950 p-4 shadow-inner shadow-black/20">
              <pre className="overflow-x-auto whitespace-pre-wrap text-sm leading-7 text-slate-100">
                <code>{sql}</code>
              </pre>
            </div>

            <div className="mt-4 space-y-3">
              {[
                { icon: Rows3, label: "Selected", value: selectedColumns.length === 0 ? "*" : String(selectedColumns.length) },
                { icon: Filter, label: "Where", value: String(filters.length) },
                { icon: Layers3, label: "Group By", value: String(effectiveGroupBy.length) },
                { icon: Sparkles, label: "Having", value: String(havingConditions.length) },
              ].map((item) => (
                <div
                  key={item.label}
                  className="flex items-center justify-between rounded-2xl border border-white/20 bg-slate-50/80 px-4 py-3 dark:border-white/10 dark:bg-slate-900/45"
                >
                  <div className="flex items-center gap-3 text-sm text-slate-700 dark:text-slate-200">
                    <item.icon className="h-4 w-4 text-cyan-500" />
                    {item.label}
                  </div>
                  <div className="inline-flex items-center gap-2 font-semibold text-slate-950 dark:text-white">
                    {item.value}
                    <ChevronRight className="h-4 w-4 text-slate-400" />
                  </div>
                </div>
              ))}
            </div>
          </StepCard>
        </div>
      </div>
    </section>
  );
}
