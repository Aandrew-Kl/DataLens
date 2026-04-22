"use client";

import { quoteIdentifier } from "@/lib/utils/sql";
import { useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  AlertTriangle,
  ArrowRightLeft,
  CheckCircle2,
  ChevronsRight,
  Database,
  Eye,
  Link2,
  Loader2,
  Save,
} from "lucide-react";
import { runQuery } from "@/lib/duckdb/client";

interface DataJoinWizardProps {
  tables: string[];
  onJoinComplete: (result: { tableName: string; sql: string; columns: string[] }) => void;
}

type JoinType = "INNER" | "LEFT" | "RIGHT" | "FULL OUTER" | "CROSS";

interface TableSchema {
  tableName: string;
  columns: string[];
}

interface JoinPair {
  id: string;
  leftTable: string;
  rightTable: string;
  leftColumn: string;
  rightColumn: string;
}

const EASE = [0.22, 1, 0.36, 1] as const;
const CARD_CLASS =
  "rounded-[1.75rem] border border-white/20 bg-white/75 shadow-xl shadow-slate-950/10 backdrop-blur-2xl dark:border-white/10 dark:bg-slate-950/45";
const STEP_META = [
  { id: 1, label: "Tables", icon: Database },
  { id: 2, label: "Type", icon: ArrowRightLeft },
  { id: 3, label: "Columns", icon: Link2 },
  { id: 4, label: "Preview", icon: Eye },
  { id: 5, label: "Confirm", icon: Save },
] as const;
const JOIN_OPTIONS: Array<{
  value: JoinType;
  label: string;
  description: string;
}> = [
  { value: "INNER", label: "Inner", description: "Keep rows that match across both sides." },
  { value: "LEFT", label: "Left", description: "Preserve all rows from the left side of each join." },
  { value: "RIGHT", label: "Right", description: "Preserve all rows from the right side of each join." },
  { value: "FULL OUTER", label: "Full", description: "Keep every row from both sides of each join." },
  { value: "CROSS", label: "Cross", description: "Produce the Cartesian product with no join key." },
] as const;
function createJoinPairId(leftTable: string, rightTable: string): string {
  return `${leftTable}::${rightTable}`;
}

function createTableAlias(index: number): string {
  return `t${index}`;
}

function sanitizeTableName(value: string): string {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9_]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 48) || "joined_table"
  );
}

function normalizeName(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function buildJoinPairs(
  selectedTables: string[],
  existingPairs: JoinPair[],
  schemas: Record<string, TableSchema>,
): JoinPair[] {
  return selectedTables.slice(1).map((rightTable, index) => {
    const leftTable = selectedTables[index];
    const existing = existingPairs.find(
      (pair) => pair.leftTable === leftTable && pair.rightTable === rightTable,
    );

    if (existing) return existing;

    const leftColumns = schemas[leftTable]?.columns ?? [];
    const rightColumns = schemas[rightTable]?.columns ?? [];
    const matchingColumn =
      leftColumns.find((column) =>
        rightColumns.some((candidate) => normalizeName(candidate) === normalizeName(column)),
      ) ?? leftColumns[0] ?? "";
    const rightMatch =
      rightColumns.find((candidate) => normalizeName(candidate) === normalizeName(matchingColumn)) ??
      rightColumns[0] ??
      "";

    return {
      id: createJoinPairId(leftTable, rightTable),
      leftTable,
      rightTable,
      leftColumn: matchingColumn,
      rightColumn: rightMatch,
    };
  });
}

function buildProjectionList(
  selectedTables: string[],
  includedColumns: Record<string, string[]>,
): string[] {
  const expressions: string[] = [];

  selectedTables.forEach((tableName, index) => {
    const alias = createTableAlias(index);
    (includedColumns[tableName] ?? []).forEach((column) => {
      expressions.push(
        `${alias}.${quoteIdentifier(column)} AS ${quoteIdentifier(`${tableName}__${column}`)}`,
      );
    });
  });

  return expressions;
}

function buildJoinSql(
  selectedTables: string[],
  joinPairs: JoinPair[],
  joinType: JoinType,
  includedColumns: Record<string, string[]>,
): string {
  const projectionList = buildProjectionList(selectedTables, includedColumns);
  const selectClause = projectionList.length > 0 ? projectionList.join(",\n  ") : "*";

  const joinFragments = selectedTables.slice(1).map((tableName, index) => {
    const rightAlias = createTableAlias(index + 1);
    const pair = joinPairs[index];
    const joinKeyword = joinType === "FULL OUTER" ? "FULL OUTER" : joinType;

    if (joinType === "CROSS") {
      return `CROSS JOIN ${quoteIdentifier(tableName)} ${rightAlias}`;
    }

    return [
      `${joinKeyword} JOIN ${quoteIdentifier(tableName)} ${rightAlias}`,
      `  ON ${createTableAlias(index)}.${quoteIdentifier(pair.leftColumn)} = ${rightAlias}.${quoteIdentifier(pair.rightColumn)}`,
    ].join("\n");
  });

  return [
    "SELECT",
    `  ${selectClause}`,
    `FROM ${quoteIdentifier(selectedTables[0])} ${createTableAlias(0)}`,
    ...joinFragments,
  ].join("\n");
}

function StepBadge({
  active,
  completed,
  label,
  step,
}: {
  active: boolean;
  completed: boolean;
  label: string;
  step: number;
}) {
  return (
    <div className="flex items-center gap-3">
      <div
        className={`flex h-9 w-9 items-center justify-center rounded-full text-sm font-semibold ${
          active
            ? "bg-cyan-500 text-white"
            : completed
              ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300"
              : "bg-slate-200/70 text-slate-600 dark:bg-slate-800/70 dark:text-slate-300"
        }`}
      >
        {step}
      </div>
      <span className="text-sm font-medium text-slate-700 dark:text-slate-200">{label}</span>
    </div>
  );
}

export default function DataJoinWizard({
  tables,
  onJoinComplete,
}: DataJoinWizardProps) {
  const [step, setStep] = useState(1);
  const [availableTables, setAvailableTables] = useState<string[]>(tables);
  const [schemas, setSchemas] = useState<Record<string, TableSchema>>({});
  const [selectedTables, setSelectedTables] = useState<string[]>(tables.slice(0, 2));
  const [joinType, setJoinType] = useState<JoinType>("INNER");
  const [joinPairs, setJoinPairs] = useState<JoinPair[]>([]);
  const [includedColumns, setIncludedColumns] = useState<Record<string, string[]>>({});
  const [previewRows, setPreviewRows] = useState<Record<string, unknown>[]>([]);
  const [resultTableName, setResultTableName] = useState("joined_result");
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState("Select two or more tables to begin.");
  const [loading, setLoading] = useState(false);

  const activeSql = useMemo(() => {
    if (selectedTables.length < 2) return "";
    if (joinType !== "CROSS" && joinPairs.length < selectedTables.length - 1) return "";
    return buildJoinSql(selectedTables, joinPairs, joinType, includedColumns);
  }, [includedColumns, joinPairs, joinType, selectedTables]);

  const suggestedPairs = useMemo(() => {
    return joinPairs.map((pair) => {
      const leftColumns = schemas[pair.leftTable]?.columns ?? [];
      const rightColumns = schemas[pair.rightTable]?.columns ?? [];
      const exactMatches = leftColumns.filter((column) =>
        rightColumns.some((candidate) => normalizeName(candidate) === normalizeName(column)),
      );
      return {
        pairId: pair.id,
        matches: exactMatches.slice(0, 6),
      };
    });
  }, [joinPairs, schemas]);

  async function refreshSchemas() {
    setLoading(true);
    setError(null);

    try {
      const tableRows = await runQuery("SHOW TABLES");
      const discoveredTables = Array.from(
        new Set(
          [
            ...tables,
            ...tableRows.map((row) => String(row.name ?? row.table_name ?? row.table ?? "")),
          ].filter(Boolean),
        ),
      );

      const schemaEntries = await Promise.all(
        discoveredTables.map(async (tableName) => {
          const rows = await runQuery(`DESCRIBE ${quoteIdentifier(tableName)}`);
          return [
            tableName,
            {
              tableName,
              columns: rows
                .map((row) => String(row.column_name ?? ""))
                .filter(Boolean),
            } satisfies TableSchema,
          ] as const;
        }),
      );

      const nextSchemas = Object.fromEntries(schemaEntries);
      const nextSelected = selectedTables.length >= 2 ? selectedTables : discoveredTables.slice(0, 2);
      const nextPairs = buildJoinPairs(nextSelected, joinPairs, nextSchemas);

      setAvailableTables(discoveredTables);
      setSchemas(nextSchemas);
      setSelectedTables(nextSelected);
      setJoinPairs(nextPairs);
      setIncludedColumns((current) => {
        const next = { ...current };
        nextSelected.forEach((tableName) => {
          if (!next[tableName] || next[tableName].length === 0) {
            next[tableName] = nextSchemas[tableName]?.columns ?? [];
          }
        });
        return next;
      });
      setStatus("Schemas refreshed from DuckDB.");
    } catch (schemaError) {
      setError(schemaError instanceof Error ? schemaError.message : "Failed to load schemas.");
    } finally {
      setLoading(false);
    }
  }

  function toggleSelectedTable(tableName: string) {
    setSelectedTables((current) => {
      const next = current.includes(tableName)
        ? current.filter((entry) => entry !== tableName)
        : [...current, tableName];
      const normalized = next.slice(0, 4);
      setJoinPairs((pairs) => buildJoinPairs(normalized, pairs, schemas));
      setIncludedColumns((currentColumns) => ({
        ...currentColumns,
        [tableName]: currentColumns[tableName] ?? schemas[tableName]?.columns ?? [],
      }));
      return normalized;
    });
  }

  function updateJoinPair(
    pairId: string,
    side: "leftColumn" | "rightColumn",
    value: string,
  ) {
    setJoinPairs((current) =>
      current.map((pair) => (pair.id === pairId ? { ...pair, [side]: value } : pair)),
    );
  }

  function toggleIncludedColumn(tableName: string, columnName: string) {
    setIncludedColumns((current) => {
      const selected = current[tableName] ?? [];
      const nextColumns = selected.includes(columnName)
        ? selected.filter((column) => column !== columnName)
        : [...selected, columnName];
      return {
        ...current,
        [tableName]: nextColumns,
      };
    });
  }

  async function previewJoin() {
    if (selectedTables.length < 2) {
      setError("Select at least two tables.");
      return;
    }

    if (!activeSql) {
      setError("Refresh schemas before previewing the join.");
      return;
    }

    if (joinType !== "CROSS" && joinPairs.some((pair) => !pair.leftColumn || !pair.rightColumn)) {
      setError("Each join needs left and right key columns.");
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const rows = await runQuery(`${activeSql}\nLIMIT 50`);
      setPreviewRows(rows);
      setStatus("Join preview loaded.");
      setStep(4);
    } catch (previewError) {
      setError(previewError instanceof Error ? previewError.message : "Preview failed.");
    } finally {
      setLoading(false);
    }
  }

  async function materializeJoin() {
    if (!resultTableName.trim()) {
      setError("Provide a result table name.");
      return;
    }

    if (!activeSql) {
      setError("Preview the join after refreshing schemas before creating a table.");
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const safeName = sanitizeTableName(resultTableName);
      await runQuery(
        `CREATE OR REPLACE TABLE ${quoteIdentifier(safeName)} AS ${activeSql}`,
      );
      setStatus(`Created ${safeName}.`);
      onJoinComplete({
        tableName: safeName,
        sql: activeSql,
        columns: Object.keys(previewRows[0] ?? {}),
      });
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : "Join creation failed.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className={`${CARD_CLASS} overflow-hidden p-5`}>
      <div className="flex flex-col gap-5 border-b border-white/15 pb-5 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex items-center gap-4">
          <div className="flex h-12 w-12 items-center justify-center rounded-[1.25rem] bg-cyan-500/10 text-cyan-700 dark:text-cyan-300">
            <ArrowRightLeft className="h-5 w-5" />
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-slate-500 dark:text-slate-400">
              Join Wizard
            </p>
            <h2 className="mt-1 text-xl font-semibold text-slate-950 dark:text-slate-50">
              Build multi-table joins with preview-first validation
            </h2>
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => void refreshSchemas()}
            className="inline-flex items-center gap-2 rounded-[1rem] border border-white/15 bg-white/45 px-4 py-3 text-sm text-slate-700 transition hover:bg-white/60 dark:bg-slate-900/30 dark:text-slate-200"
          >
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Database className="h-4 w-4" />}
            Refresh schemas
          </button>
          <div className="rounded-[1rem] border border-white/15 bg-white/45 px-4 py-3 text-sm text-slate-600 dark:bg-slate-900/30 dark:text-slate-300">
            {status}
          </div>
        </div>
      </div>

      <div className="mt-5 flex flex-wrap gap-4">
        {STEP_META.map((item) => (
          <StepBadge
            key={item.id}
            active={step === item.id}
            completed={step > item.id}
            label={item.label}
            step={item.id}
          />
        ))}
      </div>

      {error ? (
        <div className="mt-4 rounded-[1.2rem] border border-rose-400/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-700 dark:text-rose-300">
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4" />
            {error}
          </div>
        </div>
      ) : null}

      <AnimatePresence mode="wait">
        <motion.div
          key={step}
          initial={{ opacity: 0, y: 18 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -12 }}
          transition={{ duration: 0.28, ease: EASE }}
          className="mt-5 rounded-[1.4rem] border border-white/15 bg-white/45 p-4 dark:bg-slate-900/30"
        >
          {step === 1 ? (
            <div className="space-y-4">
              <p className="text-sm text-slate-600 dark:text-slate-300">
                Pick the tables to join. The order controls the join chain from left to right.
              </p>
              <div className="grid gap-3 md:grid-cols-2">
                {availableTables.map((tableName) => {
                  const selected = selectedTables.includes(tableName);
                  return (
                    <button
                      key={tableName}
                      type="button"
                      onClick={() => toggleSelectedTable(tableName)}
                      className={`rounded-[1.1rem] border px-4 py-4 text-left transition ${
                        selected
                          ? "border-cyan-400/40 bg-cyan-500/12 text-cyan-700 dark:border-cyan-400/30 dark:text-cyan-300"
                          : "border-white/15 bg-white/55 text-slate-700 hover:bg-white/70 dark:bg-slate-950/25 dark:text-slate-200"
                      }`}
                    >
                      <p className="text-sm font-semibold">{tableName}</p>
                    </button>
                  );
                })}
              </div>

              <div className="rounded-[1rem] border border-white/15 bg-white/55 px-4 py-3 dark:bg-slate-950/25">
                <p className="text-xs uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400">
                  Join chain preview
                </p>
                <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-slate-700 dark:text-slate-200">
                  {selectedTables.map((tableName, index) => (
                    <div key={tableName} className="flex items-center gap-2">
                      {index > 0 ? <ChevronsRight className="h-4 w-4 text-slate-400" /> : null}
                      <span className="rounded-full bg-white/60 px-3 py-1 dark:bg-slate-900/50">
                        {tableName}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          ) : null}

          {step === 2 ? (
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {JOIN_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => setJoinType(option.value)}
                  className={`rounded-[1.1rem] border px-4 py-4 text-left transition ${
                    joinType === option.value
                      ? "border-cyan-400/40 bg-cyan-500/12 text-cyan-700 dark:border-cyan-400/30 dark:text-cyan-300"
                      : "border-white/15 bg-white/55 text-slate-700 hover:bg-white/70 dark:bg-slate-950/25 dark:text-slate-200"
                  }`}
                >
                  <p className="text-sm font-semibold">{option.label} join</p>
                  <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{option.description}</p>
                </button>
              ))}
            </div>
          ) : null}

          {step === 3 ? (
            <div className="space-y-5">
              {joinPairs.map((pair) => {
                const leftColumns = schemas[pair.leftTable]?.columns ?? [];
                const rightColumns = schemas[pair.rightTable]?.columns ?? [];
                const suggestions = suggestedPairs.find((entry) => entry.pairId === pair.id)?.matches ?? [];

                return (
                  <div key={pair.id} className="rounded-[1.2rem] border border-white/15 bg-white/55 p-4 dark:bg-slate-950/25">
                    <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                      <div>
                        <p className="text-sm font-semibold text-slate-900 dark:text-slate-50">
                          {pair.leftTable} → {pair.rightTable}
                        </p>
                        <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                          Suggestions: {suggestions.length > 0 ? suggestions.join(", ") : "No obvious matches"}
                        </p>
                      </div>
                      <div className="grid gap-3 md:grid-cols-2">
                        <select
                          value={pair.leftColumn}
                          onChange={(event) => updateJoinPair(pair.id, "leftColumn", event.target.value)}
                          disabled={joinType === "CROSS"}
                          className="rounded-[1rem] border border-white/20 bg-white/75 px-4 py-3 text-sm text-slate-900 outline-none disabled:opacity-60 dark:bg-slate-950/60 dark:text-slate-50"
                        >
                          {leftColumns.map((column) => (
                            <option key={column} value={column}>
                              {column}
                            </option>
                          ))}
                        </select>
                        <select
                          value={pair.rightColumn}
                          onChange={(event) => updateJoinPair(pair.id, "rightColumn", event.target.value)}
                          disabled={joinType === "CROSS"}
                          className="rounded-[1rem] border border-white/20 bg-white/75 px-4 py-3 text-sm text-slate-900 outline-none disabled:opacity-60 dark:bg-slate-950/60 dark:text-slate-50"
                        >
                          {rightColumns.map((column) => (
                            <option key={column} value={column}>
                              {column}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>
                  </div>
                );
              })}

              <div className="rounded-[1.2rem] border border-white/15 bg-white/55 p-4 dark:bg-slate-950/25">
                <p className="text-sm font-semibold text-slate-900 dark:text-slate-50">
                  Output column selector
                </p>
                <div className="mt-4 grid gap-4 md:grid-cols-2">
                  {selectedTables.map((tableName) => (
                    <div key={tableName} className="rounded-[1rem] border border-white/15 bg-white/60 p-4 dark:bg-slate-900/35">
                      <p className="text-sm font-semibold text-slate-900 dark:text-slate-50">{tableName}</p>
                      <div className="mt-3 flex flex-wrap gap-2">
                        {(schemas[tableName]?.columns ?? []).map((column) => {
                          const active = (includedColumns[tableName] ?? []).includes(column);
                          return (
                            <button
                              key={`${tableName}-${column}`}
                              type="button"
                              onClick={() => toggleIncludedColumn(tableName, column)}
                              className={`rounded-full px-3 py-1 text-xs transition ${
                                active
                                  ? "bg-cyan-500/15 text-cyan-700 dark:text-cyan-300"
                                  : "bg-slate-200/70 text-slate-700 dark:bg-slate-800/70 dark:text-slate-300"
                              }`}
                            >
                              {column}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          ) : null}

          {step === 4 ? (
            <div className="space-y-4">
              <div className="rounded-[1rem] border border-white/15 bg-slate-950 px-4 py-3 text-xs text-slate-200">
                <pre className="overflow-x-auto whitespace-pre-wrap">{activeSql}</pre>
              </div>
              <div className="overflow-hidden rounded-[1rem] border border-white/15 bg-white/55 dark:bg-slate-950/25">
                <div className="overflow-x-auto">
                  <table className="min-w-full text-left text-sm">
                    <thead className="bg-white/60 dark:bg-slate-900/60">
                      <tr>
                        {Object.keys(previewRows[0] ?? {}).map((column) => (
                          <th
                            key={column}
                            className="px-4 py-3 font-semibold text-slate-700 dark:text-slate-200"
                          >
                            {column}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {previewRows.map((row, index) => (
                        <tr key={`preview-${index}`} className="border-t border-white/10">
                          {Object.keys(previewRows[0] ?? {}).map((column) => (
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
            </div>
          ) : null}

          {step === 5 ? (
            <div className="space-y-4">
              <div className="rounded-[1rem] border border-white/15 bg-white/55 p-4 dark:bg-slate-950/25">
                <label
                  htmlFor="data-join-wizard-result-name"
                  className="block text-sm font-semibold text-slate-900 dark:text-slate-50"
                >
                  Result table name
                </label>
                <input
                  id="data-join-wizard-result-name"
                  value={resultTableName}
                  onChange={(event) => setResultTableName(event.target.value)}
                  className="mt-3 w-full rounded-[1rem] border border-white/20 bg-white/75 px-4 py-3 text-sm text-slate-900 outline-none dark:bg-slate-950/60 dark:text-slate-50"
                />
              </div>

              <div className="rounded-[1rem] border border-emerald-400/20 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-800 dark:text-emerald-300">
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4" />
                  <span>The result is created as a DuckDB table and returned through the completion callback.</span>
                </div>
              </div>
            </div>
          ) : null}
        </motion.div>
      </AnimatePresence>

      <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
        <button
          type="button"
          onClick={() => setStep((current) => Math.max(current - 1, 1))}
          disabled={step === 1}
          className="rounded-[1rem] border border-white/15 bg-white/45 px-4 py-3 text-sm text-slate-700 transition disabled:opacity-40 dark:bg-slate-900/30 dark:text-slate-200"
        >
          Back
        </button>

        <div className="flex flex-wrap gap-2">
          {step < 3 ? (
            <button
              type="button"
              onClick={() => setStep((current) => Math.min(current + 1, 5))}
              className="rounded-[1rem] bg-cyan-600 px-4 py-3 text-sm font-semibold text-white transition hover:bg-cyan-500"
            >
              Next
            </button>
          ) : null}
          {step === 3 ? (
            <button
              type="button"
              onClick={() => void previewJoin()}
              className="inline-flex items-center gap-2 rounded-[1rem] bg-cyan-600 px-4 py-3 text-sm font-semibold text-white transition hover:bg-cyan-500"
            >
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Eye className="h-4 w-4" />}
              Preview join
            </button>
          ) : null}
          {step === 4 ? (
            <button
              type="button"
              onClick={() => setStep(5)}
              className="rounded-[1rem] bg-cyan-600 px-4 py-3 text-sm font-semibold text-white transition hover:bg-cyan-500"
            >
              Name result
            </button>
          ) : null}
          {step === 5 ? (
            <button
              type="button"
              onClick={() => void materializeJoin()}
              className="inline-flex items-center gap-2 rounded-[1rem] bg-emerald-600 px-4 py-3 text-sm font-semibold text-white transition hover:bg-emerald-500"
            >
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              Create joined table
            </button>
          ) : null}
        </div>
      </div>
    </section>
  );
}
