"use client";

import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  Database,
  Eye,
  GitMerge,
  Layers3,
  Link2,
  Loader2,
  Plus,
  RefreshCw,
  Save,
} from "lucide-react";
import { runQuery } from "@/lib/duckdb/client";
import { formatNumber } from "@/lib/utils/formatters";
import type { ColumnProfile } from "@/types/dataset";

interface MergeDatasetsProps {
  datasets: Array<{ tableName: string; columns: ColumnProfile[]; rowCount: number }>;
  onMergeComplete?: (tableName: string) => void;
}

type MergeType =
  | "UNION ALL"
  | "UNION"
  | "INNER JOIN"
  | "LEFT JOIN"
  | "RIGHT JOIN"
  | "FULL OUTER JOIN"
  | "CROSS JOIN";

interface UnionMapping {
  targetName: string;
  leftColumn: string;
  rightColumn: string;
  outputType: ColumnProfile["type"];
}

interface JoinCondition {
  id: string;
  leftColumn: string;
  operator: "=" | "!=" | ">" | "<" | ">=" | "<=";
  rightColumn: string;
}

const EASE = [0.16, 1, 0.3, 1] as const;
const STORAGE_CARD = "rounded-3xl border border-white/15 bg-white/10 backdrop-blur-xl dark:border-white/10 dark:bg-slate-950/45";
const MERGE_TYPES: MergeType[] = ["UNION ALL", "UNION", "INNER JOIN", "LEFT JOIN", "RIGHT JOIN", "FULL OUTER JOIN", "CROSS JOIN"];

function quoteId(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

function sanitizeName(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9_]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 48) || "merged_dataset";
}

function normalize(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function createId(): string {
  return Math.random().toString(36).slice(2, 9);
}

function duckLiteralType(type: ColumnProfile["type"]): string {
  if (type === "number") return "DOUBLE";
  if (type === "date") return "TIMESTAMP";
  if (type === "boolean") return "BOOLEAN";
  return "VARCHAR";
}

function readNumber(value: unknown): number {
  if (typeof value === "number") return value;
  if (typeof value === "bigint") return Number(value);
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function buildUnionMappings(
  left: MergeDatasetsProps["datasets"][number] | undefined,
  right: MergeDatasetsProps["datasets"][number] | undefined,
): UnionMapping[] {
  if (!left || !right) return [];
  const usedRight = new Set<string>();
  const mappings: UnionMapping[] = left.columns.map((column) => {
    const match = right.columns.find((candidate) => !usedRight.has(candidate.name) && normalize(candidate.name) === normalize(column.name));
    if (match) usedRight.add(match.name);
    return {
      targetName: column.name,
      leftColumn: column.name,
      rightColumn: match?.name ?? "",
      outputType: match && match.type === column.type ? column.type : "string",
    };
  });
  right.columns
    .filter((column) => !usedRight.has(column.name))
    .forEach((column) =>
      mappings.push({ targetName: column.name, leftColumn: "", rightColumn: column.name, outputType: column.type }),
    );
  return mappings;
}

function buildUnionSql(
  left: MergeDatasetsProps["datasets"][number],
  right: MergeDatasetsProps["datasets"][number],
  mergeType: MergeType,
  mappings: UnionMapping[],
): string {
  const project = (side: "left" | "right") =>
    mappings
      .map((mapping) => {
        const selected = side === "left" ? mapping.leftColumn : mapping.rightColumn;
        const expression = selected
          ? `CAST(${quoteId(selected)} AS ${duckLiteralType(mapping.outputType)})`
          : `CAST(NULL AS ${duckLiteralType(mapping.outputType)})`;
        return `${expression} AS ${quoteId(mapping.targetName)}`;
      })
      .join(",\n  ");

  return [
    `SELECT ${project("left")} FROM ${quoteId(left.tableName)}`,
    mergeType === "UNION ALL" ? "UNION ALL" : "UNION",
    `SELECT ${project("right")} FROM ${quoteId(right.tableName)}`,
  ].join("\n");
}

function buildJoinSql(
  left: MergeDatasetsProps["datasets"][number],
  right: MergeDatasetsProps["datasets"][number],
  mergeType: MergeType,
  conditions: JoinCondition[],
): string {
  const leftNormalized = new Set(left.columns.map((column) => normalize(column.name)));
  const selectList = [
    ...left.columns.map((column) => `l.${quoteId(column.name)} AS ${quoteId(column.name)}`),
    ...right.columns.map((column) => {
      const alias = leftNormalized.has(normalize(column.name)) ? `${right.tableName}__${column.name}` : column.name;
      return `r.${quoteId(column.name)} AS ${quoteId(alias)}`;
    }),
  ];
  const onClause = mergeType === "CROSS JOIN"
    ? ""
    : conditions
        .filter((condition) => condition.leftColumn && condition.rightColumn)
        .map((condition) => `l.${quoteId(condition.leftColumn)} ${condition.operator} r.${quoteId(condition.rightColumn)}`)
        .join(" AND ");
  return [
    `SELECT ${selectList.join(",\n  ")}`,
    `FROM ${quoteId(left.tableName)} l`,
    `${mergeType} ${quoteId(right.tableName)} r`,
    mergeType === "CROSS JOIN" ? "" : `ON ${onClause || "1 = 1"}`,
  ]
    .filter(Boolean)
    .join("\n");
}

function PreviewTable({ rows }: { rows: Record<string, unknown>[] }) {
  if (!rows.length) {
    return <div className="flex h-48 items-center justify-center text-sm text-slate-500 dark:text-slate-400">No preview rows returned.</div>;
  }
  const headers = Object.keys(rows[0]);
  return (
    <div className="overflow-auto">
      <table className="min-w-full text-left text-sm">
        <thead className="sticky top-0 bg-white/70 dark:bg-slate-950/70">
          <tr>{headers.map((header) => <th key={header} className="px-3 py-2 font-semibold text-slate-700 dark:text-slate-200">{header}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={index} className="border-t border-white/10">
              {headers.map((header) => <td key={header} className="max-w-56 truncate px-3 py-2 text-slate-600 dark:text-slate-300">{String(row[header] ?? "null")}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function MergeDatasets({ datasets, onMergeComplete }: MergeDatasetsProps) {
  const [leftTable, setLeftTable] = useState(datasets[0]?.tableName ?? "");
  const [rightTable, setRightTable] = useState(datasets[1]?.tableName ?? datasets[0]?.tableName ?? "");
  const [mergeType, setMergeType] = useState<MergeType>("UNION ALL");
  const [unionMappings, setUnionMappings] = useState<UnionMapping[]>([]);
  const [conditions, setConditions] = useState<JoinCondition[]>([{ id: createId(), leftColumn: "", operator: "=", rightColumn: "" }]);
  const [previewRows, setPreviewRows] = useState<Record<string, unknown>[]>([]);
  const [rowImpact, setRowImpact] = useState<number | null>(null);
  const [targetTableName, setTargetTableName] = useState("merged_dataset");
  const [busy, setBusy] = useState<"preview" | "save" | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const leftDataset = useMemo(() => datasets.find((dataset) => dataset.tableName === leftTable), [datasets, leftTable]);
  const rightDataset = useMemo(() => datasets.find((dataset) => dataset.tableName === rightTable), [datasets, rightTable]);
  const isUnion = mergeType === "UNION" || mergeType === "UNION ALL";
  const sql = useMemo(() => {
    if (!leftDataset || !rightDataset) return "";
    return isUnion
      ? buildUnionSql(leftDataset, rightDataset, mergeType, unionMappings)
      : buildJoinSql(leftDataset, rightDataset, mergeType, conditions);
  }, [conditions, isUnion, leftDataset, mergeType, rightDataset, unionMappings]);

  useEffect(() => {
    if (!leftDataset || !rightDataset) return;
    setUnionMappings(buildUnionMappings(leftDataset, rightDataset));
    setTargetTableName(`${sanitizeName(leftDataset.tableName)}_${sanitizeName(rightDataset.tableName)}_${sanitizeName(mergeType)}`);
    setConditions((current) => {
      if (current[0]?.leftColumn) return current;
      const leftJoin = leftDataset.columns.find((column) => /(_id|id|key)$/i.test(column.name)) ?? leftDataset.columns[0];
      const rightJoin = rightDataset.columns.find((column) => normalize(column.name) === normalize(leftJoin?.name ?? "")) ?? rightDataset.columns[0];
      return [{ id: createId(), leftColumn: leftJoin?.name ?? "", operator: "=", rightColumn: rightJoin?.name ?? "" }];
    });
  }, [leftDataset, rightDataset, mergeType]);

  async function runPreview() {
    if (!sql) return;
    setBusy("preview");
    setNotice(null);
    try {
      const [rows, countRows] = await Promise.all([
        runQuery(`SELECT * FROM (${sql}) AS merged_preview LIMIT 100`),
        runQuery(`SELECT COUNT(*) AS result_count FROM (${sql}) AS merged_count`),
      ]);
      setPreviewRows(rows);
      setRowImpact(readNumber(countRows[0]?.result_count));
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Preview failed.");
    } finally {
      setBusy(null);
    }
  }

  async function materializeMerge() {
    if (!sql || !targetTableName.trim()) return;
    setBusy("save");
    setNotice(null);
    try {
      await runQuery(`CREATE OR REPLACE TABLE ${quoteId(targetTableName.trim())} AS ${sql}`);
      setNotice(`Created ${targetTableName.trim()} from the current merge plan.`);
      onMergeComplete?.(targetTableName.trim());
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Create table failed.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="overflow-hidden rounded-[30px] border border-white/15 bg-[radial-gradient(circle_at_top_left,rgba(56,189,248,0.18),transparent_24%),linear-gradient(135deg,rgba(248,250,252,0.92),rgba(226,232,240,0.75))] shadow-[0_30px_120px_-50px_rgba(15,23,42,0.9)] dark:border-white/10 dark:bg-[radial-gradient(circle_at_top_left,rgba(56,189,248,0.16),transparent_22%),linear-gradient(135deg,rgba(2,6,23,0.95),rgba(15,23,42,0.88))]">
      <div className="border-b border-white/10 px-6 py-5">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full border border-cyan-400/20 bg-cyan-500/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.22em] text-cyan-700 dark:text-cyan-300">
              <GitMerge className="h-3.5 w-3.5" />
              Dataset Merge Studio
            </div>
            <h2 className="mt-3 text-2xl font-semibold tracking-tight text-slate-950 dark:text-slate-50">Combine loaded DuckDB datasets</h2>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600 dark:text-slate-300">Preview union or join plans, inspect row-count impact, then materialize the result as a new table.</p>
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <div className={`${STORAGE_CARD} px-4 py-3`}><div className="text-xs uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">Left</div><div className="mt-2 text-lg font-semibold text-slate-950 dark:text-slate-50">{leftDataset?.rowCount ? formatNumber(leftDataset.rowCount) : "0"}</div></div>
            <div className={`${STORAGE_CARD} px-4 py-3`}><div className="text-xs uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">Right</div><div className="mt-2 text-lg font-semibold text-slate-950 dark:text-slate-50">{rightDataset?.rowCount ? formatNumber(rightDataset.rowCount) : "0"}</div></div>
            <div className={`${STORAGE_CARD} px-4 py-3`}><div className="text-xs uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">Result</div><div className="mt-2 text-lg font-semibold text-slate-950 dark:text-slate-50">{rowImpact === null ? "—" : formatNumber(rowImpact)}</div></div>
          </div>
        </div>
      </div>

      <div className="grid gap-5 px-6 py-6 xl:grid-cols-[1.1fr_0.9fr]">
        <div className="space-y-5">
          <div className={`${STORAGE_CARD} p-5`}>
            <div className="grid gap-4 md:grid-cols-2">
              <label className="text-sm">
                <span className="mb-2 block font-medium text-slate-700 dark:text-slate-200">Left dataset</span>
                <select value={leftTable} onChange={(event) => setLeftTable(event.target.value)} className="w-full rounded-2xl border border-white/15 bg-white/40 px-4 py-3 dark:bg-slate-950/40">
                  {datasets.map((dataset) => <option key={dataset.tableName} value={dataset.tableName}>{dataset.tableName}</option>)}
                </select>
              </label>
              <label className="text-sm">
                <span className="mb-2 block font-medium text-slate-700 dark:text-slate-200">Right dataset</span>
                <select value={rightTable} onChange={(event) => setRightTable(event.target.value)} className="w-full rounded-2xl border border-white/15 bg-white/40 px-4 py-3 dark:bg-slate-950/40">
                  {datasets.map((dataset) => <option key={dataset.tableName} value={dataset.tableName}>{dataset.tableName}</option>)}
                </select>
              </label>
            </div>
            <div className="mt-4 grid gap-3 lg:grid-cols-4">
              {MERGE_TYPES.map((type) => (
                <button
                  key={type}
                  type="button"
                  onClick={() => setMergeType(type)}
                  className={`rounded-2xl border px-4 py-3 text-left text-sm transition ${mergeType === type ? "border-cyan-400/40 bg-cyan-500/10 text-cyan-800 dark:text-cyan-200" : "border-white/15 bg-white/5 text-slate-600 dark:text-slate-300"}`}
                >
                  <div className="font-semibold">{type}</div>
                  <div className="mt-1 text-xs opacity-75">{type.includes("UNION") ? "Stack rows" : type === "CROSS JOIN" ? "Cartesian product" : "Match rows by keys"}</div>
                </button>
              ))}
            </div>
          </div>

          {isUnion && leftDataset && rightDataset ? (
            <div className={`${STORAGE_CARD} p-5`}>
              <div className="mb-4 flex items-center gap-2 text-slate-900 dark:text-slate-100"><Layers3 className="h-4 w-4 text-cyan-600 dark:text-cyan-300" />Union column mapping</div>
              <div className="space-y-3">
                {unionMappings.map((mapping, index) => (
                  <div key={`${mapping.targetName}:${index}`} className="grid gap-3 rounded-2xl border border-white/10 bg-white/5 p-3 md:grid-cols-[1fr_1fr_1fr]">
                    <input value={mapping.targetName} onChange={(event) => setUnionMappings((current) => current.map((entry, currentIndex) => currentIndex === index ? { ...entry, targetName: event.target.value } : entry))} className="rounded-xl border border-white/10 bg-white/40 px-3 py-2 dark:bg-slate-950/40" />
                    <select value={mapping.leftColumn} onChange={(event) => setUnionMappings((current) => current.map((entry, currentIndex) => currentIndex === index ? { ...entry, leftColumn: event.target.value } : entry))} className="rounded-xl border border-white/10 bg-white/40 px-3 py-2 dark:bg-slate-950/40">
                      <option value="">NULL from left</option>
                      {leftDataset.columns.map((column) => <option key={column.name} value={column.name}>{column.name}</option>)}
                    </select>
                    <select value={mapping.rightColumn} onChange={(event) => setUnionMappings((current) => current.map((entry, currentIndex) => currentIndex === index ? { ...entry, rightColumn: event.target.value } : entry))} className="rounded-xl border border-white/10 bg-white/40 px-3 py-2 dark:bg-slate-950/40">
                      <option value="">NULL from right</option>
                      {rightDataset.columns.map((column) => <option key={column.name} value={column.name}>{column.name}</option>)}
                    </select>
                  </div>
                ))}
              </div>
            </div>
          ) : leftDataset && rightDataset ? (
            <div className={`${STORAGE_CARD} p-5`}>
              <div className="mb-4 flex items-center justify-between gap-3">
                <div className="flex items-center gap-2 text-slate-900 dark:text-slate-100"><Link2 className="h-4 w-4 text-cyan-600 dark:text-cyan-300" />ON condition builder</div>
                {mergeType !== "CROSS JOIN" ? (
                  <button type="button" onClick={() => setConditions((current) => [...current, { id: createId(), leftColumn: "", operator: "=", rightColumn: "" }])} className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/10 px-3 py-2 text-sm text-slate-600 dark:text-slate-300">
                    <Plus className="h-4 w-4" />Add clause
                  </button>
                ) : null}
              </div>
              <div className="space-y-3">
                {conditions.map((condition) => (
                  <div key={condition.id} className="grid gap-3 rounded-2xl border border-white/10 bg-white/5 p-3 md:grid-cols-[1fr_auto_1fr]">
                    <select value={condition.leftColumn} onChange={(event) => setConditions((current) => current.map((entry) => entry.id === condition.id ? { ...entry, leftColumn: event.target.value } : entry))} className="rounded-xl border border-white/10 bg-white/40 px-3 py-2 dark:bg-slate-950/40">
                      {leftDataset.columns.map((column) => <option key={column.name} value={column.name}>{column.name}</option>)}
                    </select>
                    <div className="flex gap-2">
                      <select value={condition.operator} onChange={(event) => setConditions((current) => current.map((entry) => entry.id === condition.id ? { ...entry, operator: event.target.value as JoinCondition["operator"] } : entry))} className="rounded-xl border border-white/10 bg-white/40 px-3 py-2 dark:bg-slate-950/40">
                        {["=", "!=", ">", "<", ">=", "<="].map((operator) => <option key={operator} value={operator}>{operator}</option>)}
                      </select>
                    </div>
                    <select value={condition.rightColumn} onChange={(event) => setConditions((current) => current.map((entry) => entry.id === condition.id ? { ...entry, rightColumn: event.target.value } : entry))} className="rounded-xl border border-white/10 bg-white/40 px-3 py-2 dark:bg-slate-950/40">
                      {rightDataset.columns.map((column) => <option key={column.name} value={column.name}>{column.name}</option>)}
                    </select>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </div>

        <div className="space-y-5">
          <div className={`${STORAGE_CARD} p-5`}>
            <div className="mb-3 flex items-center justify-between gap-3">
              <div className="flex items-center gap-2 text-slate-900 dark:text-slate-100"><Eye className="h-4 w-4 text-cyan-600 dark:text-cyan-300" />Merge SQL preview</div>
              <button type="button" onClick={() => void runPreview()} disabled={busy !== null || !sql} className="inline-flex items-center gap-2 rounded-2xl border border-cyan-400/20 bg-cyan-500/10 px-4 py-2 text-sm font-medium text-cyan-800 disabled:opacity-60 dark:text-cyan-200">
                {busy === "preview" ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}Preview
              </button>
            </div>
            <pre className="max-h-56 overflow-auto rounded-2xl border border-white/10 bg-slate-950/85 p-4 text-xs leading-6 text-cyan-200">{sql || "-- select tables to generate SQL"}</pre>
            {rowImpact !== null ? <p className="mt-3 text-sm text-slate-600 dark:text-slate-300">Result rows: <span className="font-semibold text-slate-900 dark:text-slate-100">{formatNumber(rowImpact)}</span>. Source totals: {formatNumber(leftDataset?.rowCount ?? 0)} + {formatNumber(rightDataset?.rowCount ?? 0)}.</p> : null}
          </div>

          <div className={`${STORAGE_CARD} overflow-hidden`}>
            <div className="border-b border-white/10 px-5 py-4 text-sm font-semibold text-slate-900 dark:text-slate-100">First 100 merged rows</div>
            <PreviewTable rows={previewRows} />
          </div>

          <div className={`${STORAGE_CARD} p-5`}>
            <label className="text-sm">
              <span className="mb-2 block font-medium text-slate-700 dark:text-slate-200">New table name</span>
              <input value={targetTableName} onChange={(event) => setTargetTableName(event.target.value)} className="w-full rounded-2xl border border-white/15 bg-white/40 px-4 py-3 dark:bg-slate-950/40" />
            </label>
            <div className="mt-4 flex flex-wrap gap-3">
              <button type="button" onClick={() => void materializeMerge()} disabled={busy !== null || !sql || !targetTableName.trim()} className="inline-flex items-center gap-2 rounded-2xl border border-emerald-400/20 bg-emerald-500/10 px-4 py-3 text-sm font-medium text-emerald-800 disabled:opacity-60 dark:text-emerald-200">
                {busy === "save" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}Create merged table
              </button>
              <div className="inline-flex items-center gap-2 rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-slate-600 dark:text-slate-300"><Database className="h-4 w-4" />DuckDB materialization uses <span className="font-mono">CREATE OR REPLACE TABLE</span>.</div>
            </div>
            <AnimatePresence>
              {notice ? (
                <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.2, ease: EASE }} className="mt-4 rounded-2xl border border-cyan-400/20 bg-cyan-500/10 px-4 py-3 text-sm text-cyan-800 dark:text-cyan-200">
                  {notice}
                </motion.div>
              ) : null}
            </AnimatePresence>
          </div>
        </div>
      </div>
    </section>
  );
}
