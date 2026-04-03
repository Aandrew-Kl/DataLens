"use client";

import { useDeferredValue, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { Filter, GitBranch, Plus, Search, Trash2 } from "lucide-react";
import { runQuery } from "@/lib/duckdb/client";
import {
  ANALYTICS_EASE,
  BUTTON_CLASS,
  FIELD_CLASS,
  GLASS_CARD_CLASS,
  GLASS_PANEL_CLASS,
  quoteIdentifier,
  quoteLiteral,
  toNumber,
} from "@/lib/utils/advanced-analytics";
import { formatNumber } from "@/lib/utils/formatters";
import type { ColumnProfile } from "@/types/dataset";

interface SmartFilterBuilderProps {
  tableName: string;
  columns: ColumnProfile[];
}

type GroupJoin = "AND" | "OR";
type FilterOperator = "=" | "!=" | ">" | "<" | "LIKE" | "IN" | "IS NULL";

interface FilterRule {
  id: string;
  column: string;
  operator: FilterOperator;
  value: string;
}

interface FilterGroup {
  id: string;
  join: GroupJoin;
  rules: FilterRule[];
}

const PREVIEW_LIMIT = 12;

function createId(): string {
  return Math.random().toString(36).slice(2, 10);
}

function createRule(columns: ColumnProfile[]): FilterRule {
  return {
    id: createId(),
    column: columns[0]?.name ?? "",
    operator: "=",
    value: "",
  };
}

function createGroup(columns: ColumnProfile[]): FilterGroup {
  return {
    id: createId(),
    join: "AND",
    rules: [createRule(columns)],
  };
}

function resolveColumn(columns: ColumnProfile[], name: string): ColumnProfile | null {
  return columns.find((column) => column.name === name) ?? null;
}

function isValueOptional(operator: FilterOperator): boolean {
  return operator === "IS NULL";
}

function buildLiteral(column: ColumnProfile, rawValue: string): string | null {
  const trimmed = rawValue.trim();

  if (trimmed.length === 0) {
    return null;
  }

  if (column.type === "number") {
    const numeric = toNumber(trimmed);
    return numeric === null ? null : String(numeric);
  }

  if (column.type === "boolean") {
    const normalized = trimmed.toLowerCase();
    if (["true", "1", "yes"].includes(normalized)) {
      return "TRUE";
    }
    if (["false", "0", "no"].includes(normalized)) {
      return "FALSE";
    }
    return null;
  }

  return quoteLiteral(trimmed);
}

function buildRuleSql(rule: FilterRule, columns: ColumnProfile[]): string | null {
  const column = resolveColumn(columns, rule.column);
  if (!column) {
    return null;
  }

  const field = quoteIdentifier(column.name);

  if (rule.operator === "IS NULL") {
    return `${field} IS NULL`;
  }

  if (rule.operator === "LIKE") {
    const pattern = rule.value.trim();
    if (pattern.length === 0) {
      return null;
    }
    const normalizedPattern =
      pattern.includes("%") || pattern.includes("_") ? pattern : `%${pattern}%`;
    return `CAST(${field} AS VARCHAR) LIKE ${quoteLiteral(normalizedPattern)}`;
  }

  if (rule.operator === "IN") {
    const parts = rule.value
      .split(",")
      .map((part) => buildLiteral(column, part))
      .filter((value): value is string => value !== null);

    return parts.length > 0 ? `${field} IN (${parts.join(", ")})` : null;
  }

  const literal = buildLiteral(column, rule.value);
  if (!literal) {
    return null;
  }

  if (column.type === "number" && (rule.operator === ">" || rule.operator === "<")) {
    return `TRY_CAST(${field} AS DOUBLE) ${rule.operator} ${literal}`;
  }

  return `${field} ${rule.operator} ${literal}`;
}

function buildWhereClause(groups: FilterGroup[], columns: ColumnProfile[], outerJoin: GroupJoin): string {
  const clauses = groups
    .map((group) => {
      const rules = group.rules
        .map((rule) => buildRuleSql(rule, columns))
        .filter((value): value is string => value !== null);

      return rules.length > 0 ? `(${rules.join(` ${group.join} `)})` : null;
    })
    .filter((value): value is string => value !== null);

  return clauses.join(` ${outerJoin} `);
}

function buildPreviewHeaders(rows: Record<string, unknown>[], columns: ColumnProfile[]): string[] {
  const knownColumns = columns.map((column) => column.name);
  const dynamicColumns = rows.flatMap((row) => Object.keys(row));
  return Array.from(new Set([...knownColumns, ...dynamicColumns]));
}

function updateGroup(
  groups: FilterGroup[],
  groupId: string,
  updater: (group: FilterGroup) => FilterGroup,
): FilterGroup[] {
  return groups.map((group) => (group.id === groupId ? updater(group) : group));
}

export default function SmartFilterBuilder({ tableName, columns }: SmartFilterBuilderProps) {
  const [groups, setGroups] = useState<FilterGroup[]>(() => [createGroup(columns)]);
  const [outerJoin, setOuterJoin] = useState<GroupJoin>("AND");
  const [matchingCount, setMatchingCount] = useState<number | null>(null);
  const [previewRows, setPreviewRows] = useState<Record<string, unknown>[]>([]);
  const [status, setStatus] = useState("Build one or more filter groups, then preview the matching rows.");
  const [error, setError] = useState<string | null>(null);
  const [counting, setCounting] = useState(false);
  const [applying, setApplying] = useState(false);

  const whereClause = useMemo(
    () => buildWhereClause(groups, columns, outerJoin),
    [columns, groups, outerJoin],
  );
  const deferredWhereClause = useDeferredValue(whereClause);
  const hasFilter = deferredWhereClause.trim().length > 0;
  const previewHeaders = useMemo(
    () => buildPreviewHeaders(previewRows, columns),
    [columns, previewRows],
  );

  if (columns.length === 0) {
    return (
      <section className={`${GLASS_PANEL_CLASS} p-6`}>
        <h2 className="text-xl font-semibold text-slate-950 dark:text-white">Smart filter builder</h2>
        <p className="mt-3 text-sm text-slate-600 dark:text-slate-300">
          Filtering requires at least one profiled column.
        </p>
      </section>
    );
  }

  async function handlePreviewCount(): Promise<void> {
    if (!hasFilter) {
      setError("Add at least one complete filter rule before previewing.");
      return;
    }

    setCounting(true);
    setError(null);

    try {
      const rows = await runQuery(`
        SELECT COUNT(*) AS matching_rows
        FROM ${quoteIdentifier(tableName)}
        WHERE ${deferredWhereClause}
      `);
      const value = Number(rows[0]?.matching_rows ?? 0);
      setMatchingCount(value);
      setStatus(`Preview count loaded for ${formatNumber(value)} matching rows.`);
    } catch (previewError) {
      setError(previewError instanceof Error ? previewError.message : "Unable to preview matching rows.");
    } finally {
      setCounting(false);
    }
  }

  async function handleApplyFilter(): Promise<void> {
    if (!hasFilter) {
      setError("Add at least one complete filter rule before applying the filter.");
      return;
    }

    setApplying(true);
    setError(null);

    try {
      const rows = await runQuery(`
        SELECT *
        FROM ${quoteIdentifier(tableName)}
        WHERE ${deferredWhereClause}
        LIMIT ${PREVIEW_LIMIT}
      `);
      setPreviewRows(rows);
      setStatus(`Loaded ${formatNumber(rows.length)} preview rows using the generated WHERE clause.`);
    } catch (applyError) {
      setError(applyError instanceof Error ? applyError.message : "Unable to apply the filter.");
    } finally {
      setApplying(false);
    }
  }

  return (
    <motion.section
      className={`${GLASS_PANEL_CLASS} space-y-6 p-6`}
      initial={{ opacity: 0, y: 18 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, ease: ANALYTICS_EASE }}
    >
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-2">
          <div className="inline-flex items-center gap-2 rounded-full bg-cyan-500/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-cyan-700 dark:text-cyan-300">
            <Filter className="h-3.5 w-3.5" />
            Visual filtering
          </div>
          <h2 className="text-2xl font-semibold text-slate-950 dark:text-white">
            Build grouped filters and run them in DuckDB
          </h2>
          <p className="max-w-3xl text-sm text-slate-600 dark:text-slate-300">{status}</p>
        </div>

        <div className="flex flex-wrap gap-3">
          <button className={BUTTON_CLASS} onClick={() => setGroups((current) => [...current, createGroup(columns)])} type="button">
            <Plus className="h-4 w-4" />
            Add group
          </button>
          <button className={BUTTON_CLASS} disabled={!hasFilter || counting} onClick={() => void handlePreviewCount()} type="button">
            <Search className="h-4 w-4" />
            {counting ? "Previewing…" : "Preview count"}
          </button>
          <button className={BUTTON_CLASS} disabled={!hasFilter || applying} onClick={() => void handleApplyFilter()} type="button">
            <GitBranch className="h-4 w-4" />
            {applying ? "Applying…" : "Apply filter"}
          </button>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(18rem,1fr)]">
        <div className="space-y-4">
          <label className="block space-y-2 text-sm font-medium text-slate-700 dark:text-slate-200">
            <span>Join groups with</span>
            <select className={FIELD_CLASS} onChange={(event) => setOuterJoin(event.target.value as GroupJoin)} value={outerJoin}>
              <option value="AND">AND</option>
              <option value="OR">OR</option>
            </select>
          </label>

          {groups.map((group, groupIndex) => (
            <article className={`${GLASS_CARD_CLASS} space-y-4 p-4`} key={group.id}>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-slate-900 dark:text-white">Group {groupIndex + 1}</p>
                  <p className="text-xs uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
                    Rows join with {group.join}
                  </p>
                </div>

                <div className="flex gap-2">
                  <select
                    aria-label={`Group ${groupIndex + 1} join`}
                    className={FIELD_CLASS}
                    onChange={(event) =>
                      setGroups((current) =>
                        updateGroup(current, group.id, (currentGroup) => ({
                          ...currentGroup,
                          join: event.target.value as GroupJoin,
                        })),
                      )
                    }
                    value={group.join}
                  >
                    <option value="AND">AND</option>
                    <option value="OR">OR</option>
                  </select>
                  <button
                    className={BUTTON_CLASS}
                    disabled={groups.length === 1}
                    onClick={() =>
                      setGroups((current) => current.filter((candidate) => candidate.id !== group.id))
                    }
                    type="button"
                  >
                    <Trash2 className="h-4 w-4" />
                    Remove
                  </button>
                </div>
              </div>

              <div className="space-y-3">
                {group.rules.map((rule, ruleIndex) => (
                  <div className="grid gap-3 lg:grid-cols-[minmax(0,1.2fr)_12rem_minmax(0,1fr)_auto]" key={rule.id}>
                    <label className="block space-y-2 text-sm text-slate-700 dark:text-slate-200">
                      <span className="font-medium">Column</span>
                      <select
                        aria-label={`Group ${groupIndex + 1} row ${ruleIndex + 1} column`}
                        className={FIELD_CLASS}
                        onChange={(event) =>
                          setGroups((current) =>
                            updateGroup(current, group.id, (currentGroup) => ({
                              ...currentGroup,
                              rules: currentGroup.rules.map((candidate) =>
                                candidate.id === rule.id
                                  ? { ...candidate, column: event.target.value }
                                  : candidate,
                              ),
                            })),
                          )
                        }
                        value={rule.column}
                      >
                        {columns.map((column) => (
                          <option key={column.name} value={column.name}>
                            {column.name}
                          </option>
                        ))}
                      </select>
                    </label>

                    <label className="block space-y-2 text-sm text-slate-700 dark:text-slate-200">
                      <span className="font-medium">Operator</span>
                      <select
                        aria-label={`Group ${groupIndex + 1} row ${ruleIndex + 1} operator`}
                        className={FIELD_CLASS}
                        onChange={(event) =>
                          setGroups((current) =>
                            updateGroup(current, group.id, (currentGroup) => ({
                              ...currentGroup,
                              rules: currentGroup.rules.map((candidate) =>
                                candidate.id === rule.id
                                  ? { ...candidate, operator: event.target.value as FilterOperator }
                                  : candidate,
                              ),
                            })),
                          )
                        }
                        value={rule.operator}
                      >
                        <option value="=">=</option>
                        <option value="!=">!=</option>
                        <option value=">">&gt;</option>
                        <option value="<">&lt;</option>
                        <option value="LIKE">LIKE</option>
                        <option value="IN">IN</option>
                        <option value="IS NULL">IS NULL</option>
                      </select>
                    </label>

                    <label className="block space-y-2 text-sm text-slate-700 dark:text-slate-200">
                      <span className="font-medium">Value</span>
                      <input
                        aria-label={`Group ${groupIndex + 1} row ${ruleIndex + 1} value`}
                        className={FIELD_CLASS}
                        disabled={isValueOptional(rule.operator)}
                        onChange={(event) =>
                          setGroups((current) =>
                            updateGroup(current, group.id, (currentGroup) => ({
                              ...currentGroup,
                              rules: currentGroup.rules.map((candidate) =>
                                candidate.id === rule.id
                                  ? { ...candidate, value: event.target.value }
                                  : candidate,
                              ),
                            })),
                          )
                        }
                        placeholder={rule.operator === "IN" ? "east, west, north" : "Enter a filter value"}
                        value={isValueOptional(rule.operator) ? "" : rule.value}
                      />
                    </label>

                    <button
                      className={`${BUTTON_CLASS} self-end`}
                      disabled={group.rules.length === 1}
                      onClick={() =>
                        setGroups((current) =>
                          updateGroup(current, group.id, (currentGroup) => ({
                            ...currentGroup,
                            rules: currentGroup.rules.filter((candidate) => candidate.id !== rule.id),
                          })),
                        )
                      }
                      type="button"
                    >
                      <Trash2 className="h-4 w-4" />
                      Delete
                    </button>
                  </div>
                ))}
              </div>

              <button
                className={BUTTON_CLASS}
                onClick={() =>
                  setGroups((current) =>
                    updateGroup(current, group.id, (currentGroup) => ({
                      ...currentGroup,
                      rules: [...currentGroup.rules, createRule(columns)],
                    })),
                  )
                }
                type="button"
              >
                <Plus className="h-4 w-4" />
                Add row
              </button>
            </article>
          ))}
        </div>

        <aside className="space-y-4">
          <div className={`${GLASS_CARD_CLASS} space-y-3 p-4`}>
            <h3 className="text-sm font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
              Generated WHERE clause
            </h3>
            <code className="block rounded-2xl bg-slate-950 px-4 py-3 text-xs leading-6 text-cyan-100" data-testid="smart-filter-sql">
              {hasFilter ? deferredWhereClause : "Add a complete rule to generate SQL."}
            </code>
          </div>

          <div className={`${GLASS_CARD_CLASS} p-4`}>
            <h3 className="text-sm font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
              Matching rows
            </h3>
            <p className="mt-2 text-3xl font-semibold text-slate-950 dark:text-white">
              {matchingCount === null ? "—" : formatNumber(matchingCount)}
            </p>
          </div>

          {error ? (
            <div className="rounded-3xl border border-rose-400/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-700 dark:text-rose-300">
              {error}
            </div>
          ) : null}
        </aside>
      </div>

      <div className={`${GLASS_CARD_CLASS} overflow-hidden`}>
        <div className="border-b border-white/10 px-4 py-3">
          <h3 className="text-sm font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
            Preview rows
          </h3>
        </div>

        {previewRows.length === 0 ? (
          <p className="px-4 py-8 text-sm text-slate-600 dark:text-slate-300">
            Apply the filter to inspect matching rows.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-left text-sm">
              <thead className="bg-slate-950/[0.03] dark:bg-white/[0.03]">
                <tr>
                  {previewHeaders.map((header) => (
                    <th className="px-4 py-3 font-semibold text-slate-700 dark:text-slate-200" key={header}>
                      {header}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {previewRows.map((row, rowIndex) => (
                  <tr className="border-t border-white/10" key={`${rowIndex}-${previewHeaders.join(":")}`}>
                    {previewHeaders.map((header) => (
                      <td className="px-4 py-3 text-slate-600 dark:text-slate-300" key={header}>
                        {String(row[header] ?? "—")}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </motion.section>
  );
}
