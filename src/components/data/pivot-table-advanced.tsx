"use client";

import { useMemo, useState } from "react";
import { motion } from "framer-motion";
import {
  Calculator,
  ChevronDown,
  Download,
  Plus,
  Table2,
  Trash2,
} from "lucide-react";
import { runQuery } from "@/lib/duckdb/client";
import { downloadFile } from "@/lib/utils/export";
import { formatNumber, generateId } from "@/lib/utils/formatters";
import { buildMetricExpression, quoteIdentifier } from "@/lib/utils/sql";
import type { ColumnProfile } from "@/types/dataset";

interface PivotTableAdvancedProps {
  tableName: string;
  columns: ColumnProfile[];
}

type AggFn = "SUM" | "AVG" | "COUNT" | "MIN" | "MAX" | "MEDIAN" | "STDEV";

interface ValueField {
  id: string;
  column: string;
  aggregation: AggFn;
  alias: string;
}

interface CalculatedField {
  id: string;
  name: string;
  formula: string;
}

interface PivotResult {
  rowKeys: string[];
  rowLabels: Map<string, string[]>;
  colKeys: string[];
  colLabels: Map<string, string[]>;
  cells: Map<string, Record<string, number>>;
  rowTotals: Map<string, Record<string, number>>;
  colTotals: Map<string, Record<string, number>>;
  groupSubtotals: Map<string, Record<string, number>>;
  grandTotals: Record<string, number>;
  measures: string[];
}

type Notice = string | null;

const EASE = [0.22, 1, 0.36, 1] as const;
const aggSql: Record<AggFn, string> = {
  SUM: "SUM",
  AVG: "AVG",
  COUNT: "COUNT",
  MIN: "MIN",
  MAX: "MAX",
  MEDIAN: "MEDIAN",
  STDEV: "STDDEV",
};
function quoteLiteral(value: string) {
  return `'${value.replace(/'/g, "''")}'`;
}

function sanitizeAlias(value: string) {
  const raw = value.trim().replace(/[^a-zA-Z0-9_]/g, "_");
  const nextValue = /^[a-zA-Z_]/.test(raw) ? raw : `m_${raw}`;
  return nextValue.replace(/_+/g, "_").replace(/^_+|_+$/g, "").slice(0, 48);
}

function cellKey(rowKey: string, colKey: string) {
  return `${rowKey}\u0000${colKey}`;
}

function heatColor(value: number, min: number, max: number) {
  if (max === min) return "rgba(6, 182, 212, 0.12)";
  const t = (value - min) / (max - min);
  return `rgba(6, 182, 212, ${(0.08 + t * 0.44).toFixed(3)})`;
}

function defaultValueField(columns: ColumnProfile[]): ValueField {
  const numeric = columns.find((column) => column.type === "number") ?? columns[0];
  const columnName = numeric?.name ?? "";
  return {
    id: generateId(),
    column: columnName,
    aggregation: "SUM",
    alias: sanitizeAlias(`sum_${columnName || "value"}`),
  };
}

function buildFormulaSql(formula: string, allowedAliases: Set<string>) {
  if (!/^[a-zA-Z0-9_+\-*/().\s]+$/.test(formula)) {
    throw new Error("Calculated fields only support arithmetic expressions with measure aliases.");
  }

  return formula.replace(/\b[a-zA-Z_][a-zA-Z0-9_]*\b/g, (token) => {
    if (!allowedAliases.has(token)) {
      throw new Error(`Unknown measure alias "${token}" in calculated field.`);
    }
    return quoteIdentifier(token);
  });
}

function buildPivotSql(
  tableName: string,
  rowFields: string[],
  columnFields: string[],
  valueFields: ValueField[],
  calculatedFields: CalculatedField[],
) {
  const dimensionFields = [...rowFields, ...columnFields];
  const safeDimensions = dimensionFields.map((field) => `CAST(${quoteIdentifier(field)} AS VARCHAR) AS ${quoteIdentifier(field)}`);
  const safeMeasures = valueFields.map((field) => {
    const measure =
      field.aggregation === "COUNT"
        ? "COUNT(*)"
        : buildMetricExpression(aggSql[field.aggregation], field.column, quoteIdentifier, { cast: false });
    return `${measure} AS ${quoteIdentifier(field.alias)}`;
  });
  const groupBy = safeDimensions.length > 0 ? `GROUP BY ${safeDimensions.map((_, index) => index + 1).join(", ")}` : "";
  const orderBy = safeDimensions.length > 0 ? `ORDER BY ${safeDimensions.map((_, index) => index + 1).join(", ")}` : "";
  const baseAliases = valueFields.map((field) => field.alias);
  const allowed = new Set(baseAliases);
  const computedSelect = calculatedFields.map((field) => {
    const alias = sanitizeAlias(field.name);
    allowed.add(alias);
    return `${buildFormulaSql(field.formula, new Set(baseAliases))} AS ${quoteIdentifier(alias)}`;
  });

  const baseQuery = [
    "WITH pivot_base AS (",
    `SELECT ${[...safeDimensions, ...safeMeasures].join(", ")}`,
    `FROM ${quoteIdentifier(tableName)}`,
    groupBy,
    orderBy,
    ")",
  ].join(" ");

  const outerColumns = [
    ...dimensionFields.map((field) => quoteIdentifier(field)),
    ...valueFields.map((field) => quoteIdentifier(field.alias)),
    ...computedSelect,
  ];

  return `${baseQuery} SELECT ${outerColumns.join(", ")} FROM pivot_base`;
}

function buildDrilldownSql(tableName: string, rowFields: string[], columnFields: string[], rowValues: string[], colValues: string[]) {
  const clauses = [
    ...rowFields.map((field, index) => `CAST(${quoteIdentifier(field)} AS VARCHAR) = ${quoteLiteral(rowValues[index] ?? "")}`),
    ...columnFields.map((field, index) => `CAST(${quoteIdentifier(field)} AS VARCHAR) = ${quoteLiteral(colValues[index] ?? "")}`),
  ];
  return `SELECT * FROM ${quoteIdentifier(tableName)} ${clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : ""} LIMIT 50`;
}

function csvEscape(value: unknown) {
  const text = String(value ?? "");
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export default function PivotTableAdvanced({ tableName, columns }: PivotTableAdvancedProps) {
  const [rowFields, setRowFields] = useState<string[]>(columns[0]?.name ? [columns[0].name] : []);
  const [columnFields, setColumnFields] = useState<string[]>([]);
  const [valueFields, setValueFields] = useState<ValueField[]>([defaultValueField(columns)]);
  const [calculatedFields, setCalculatedFields] = useState<CalculatedField[]>([]);
  const [calcName, setCalcName] = useState("");
  const [calcFormula, setCalcFormula] = useState("");
  const [result, setResult] = useState<PivotResult | null>(null);
  const [notice, setNotice] = useState<Notice>(null);
  const [loading, setLoading] = useState(false);
  const [drilldownRows, setDrilldownRows] = useState<Record<string, unknown>[]>([]);
  const [drilldownTitle, setDrilldownTitle] = useState("");

  const heatRange = useMemo(() => {
    if (!result) return [0, 1] as const;
    const values = Array.from(result.cells.values()).flatMap((cell) => Object.values(cell));
    if (values.length === 0) return [0, 1] as const;
    return [Math.min(...values), Math.max(...values)] as const;
  }, [result]);

  const displayColumns = useMemo(() => {
    if (!result) return [];
    return result.colKeys.flatMap((colKey) => result.measures.map((measure) => ({ colKey, measure })));
  }, [result]);

  function toggleField(field: string, kind: "row" | "column") {
    const current = kind === "row" ? rowFields : columnFields;
    const setter = kind === "row" ? setRowFields : setColumnFields;
    setter(current.includes(field) ? current.filter((value) => value !== field) : [...current, field]);
  }

  function addValueField() {
    setValueFields((current) => [...current, defaultValueField(columns)]);
  }

  function updateValueField(valueId: string, patch: Partial<ValueField>) {
    setValueFields((current) => current.map((field) => (field.id === valueId ? { ...field, ...patch } : field)));
  }

  function removeValueField(valueId: string) {
    setValueFields((current) => current.filter((field) => field.id !== valueId));
  }

  function addCalculatedField() {
    const name = sanitizeAlias(calcName);
    if (!name || !calcFormula.trim()) {
      setNotice("Calculated fields require a name and formula.");
      return;
    }

    setCalculatedFields((current) => [...current, { id: generateId(), name, formula: calcFormula.trim() }]);
    setCalcName("");
    setCalcFormula("");
    setNotice(`Added calculated field "${name}".`);
  }

  function removeCalculatedField(calcId: string) {
    setCalculatedFields((current) => current.filter((field) => field.id !== calcId));
  }

  async function runPivot() {
    if (rowFields.length === 0 && columnFields.length === 0) {
      setNotice("Choose at least one row or column field.");
      return;
    }
    if (valueFields.length === 0) {
      setNotice("Add at least one value field.");
      return;
    }

    setLoading(true);
    setNotice(null);
    try {
      const sql = buildPivotSql(tableName, rowFields, columnFields, valueFields, calculatedFields);
      const rows = await runQuery(sql);
      const cells = new Map<string, Record<string, number>>();
      const rowLabels = new Map<string, string[]>();
      const colLabels = new Map<string, string[]>();
      const rowOrder: string[] = [];
      const colOrder: string[] = [];
      const measures = [
        ...valueFields.map((field) => field.alias),
        ...calculatedFields.map((field) => sanitizeAlias(field.name)),
      ];

      for (const row of rows) {
        const rowValues = rowFields.map((field) => String(row[field] ?? "(blank)"));
        const colValues = columnFields.map((field) => String(row[field] ?? "(blank)"));
        const rowKey = rowValues.join(" / ") || "All rows";
        const colKey = colValues.join(" / ") || "Values";

        if (!rowLabels.has(rowKey)) {
          rowLabels.set(rowKey, rowValues);
          rowOrder.push(rowKey);
        }
        if (!colLabels.has(colKey)) {
          colLabels.set(colKey, colValues);
          colOrder.push(colKey);
        }

        const measureValues = Object.fromEntries(
          measures.map((measure) => [measure, Number(row[measure] ?? 0)]),
        );
        cells.set(cellKey(rowKey, colKey), measureValues);
      }

      const rowTotals = new Map<string, Record<string, number>>();
      const colTotals = new Map<string, Record<string, number>>();
      const groupSubtotals = new Map<string, Record<string, number>>();
      const grandTotals = Object.fromEntries(measures.map((measure) => [measure, 0]));

      for (const rowKey of rowOrder) {
        const rowTotal = Object.fromEntries(measures.map((measure) => [measure, 0]));
        const rowGroup = rowLabels.get(rowKey)?.[0] ?? rowKey;
        const groupTotal = groupSubtotals.get(rowGroup) ?? Object.fromEntries(measures.map((measure) => [measure, 0]));

        for (const colKey of colOrder) {
          const values = cells.get(cellKey(rowKey, colKey)) ?? Object.fromEntries(measures.map((measure) => [measure, 0]));
          const colTotal = colTotals.get(colKey) ?? Object.fromEntries(measures.map((measure) => [measure, 0]));

          for (const measure of measures) {
            rowTotal[measure] += values[measure] ?? 0;
            colTotal[measure] += values[measure] ?? 0;
            groupTotal[measure] += values[measure] ?? 0;
            grandTotals[measure] += values[measure] ?? 0;
          }

          colTotals.set(colKey, colTotal);
        }

        rowTotals.set(rowKey, rowTotal);
        groupSubtotals.set(rowGroup, groupTotal);
      }

      setResult({ rowKeys: rowOrder, rowLabels, colKeys: colOrder, colLabels, cells, rowTotals, colTotals, groupSubtotals, grandTotals, measures });
      setDrilldownRows([]);
      setDrilldownTitle("");
      setNotice(`Pivot returned ${rows.length} grouped row${rows.length === 1 ? "" : "s"}.`);
    } catch (error) {
      setResult(null);
      setNotice(error instanceof Error ? error.message : "Pivot query failed.");
    } finally {
      setLoading(false);
    }
  }

  async function drillIntoCell(rowKey: string, colKey: string) {
    const rowValues = result?.rowLabels.get(rowKey) ?? [];
    const colValues = result?.colLabels.get(colKey) ?? [];
    setLoading(true);
    try {
      const drillRows = await runQuery(buildDrilldownSql(tableName, rowFields, columnFields, rowValues, colValues));
      setDrilldownRows(drillRows);
      setDrilldownTitle(`${rowKey} • ${colKey}`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Drill-down failed.");
    } finally {
      setLoading(false);
    }
  }

  function exportCsv() {
    if (!result) {
      setNotice("Run the pivot before exporting.");
      return;
    }

    const header = ["Rows", ...displayColumns.map(({ colKey, measure }) => `${colKey} • ${measure}`), "Row total"];
    const lines = [header.map(csvEscape).join(",")];

    for (const rowKey of result.rowKeys) {
      const row: Array<string | number> = [rowKey];
      for (const column of displayColumns) {
        const cell = result.cells.get(cellKey(rowKey, column.colKey));
        row.push(cell?.[column.measure] ?? 0);
      }
      row.push(formatNumber(Object.values(result.rowTotals.get(rowKey) ?? {}).reduce((sum, value) => sum + value, 0)));
      lines.push(row.map(csvEscape).join(","));
    }

    lines.push(["Grand total", ...displayColumns.map(({ colKey, measure }) => result.colTotals.get(colKey)?.[measure] ?? 0), formatNumber(Object.values(result.grandTotals).reduce((sum, value) => sum + value, 0))].map(csvEscape).join(","));
    downloadFile(lines.join("\n"), `${tableName}-pivot.csv`, "text/csv;charset=utf-8");
  }

  return (
    <section className="overflow-hidden rounded-[2rem] border border-white/20 bg-white/60 shadow-2xl shadow-slate-950/10 backdrop-blur-2xl dark:border-white/10 dark:bg-slate-950/45">
      <div className="border-b border-white/15 px-5 py-5">
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-sky-500/10 text-sky-700 dark:text-sky-300">
            <Table2 className="h-5 w-5" />
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-500 dark:text-slate-400">Pivot Table Advanced</p>
            <h2 className="mt-1 text-xl font-semibold text-slate-950 dark:text-slate-50">DuckDB drill-down pivot for {tableName}</h2>
          </div>
        </div>
      </div>

      <div className="space-y-5 px-5 py-5">
        {notice ? <div className="rounded-2xl border border-sky-400/30 bg-sky-500/10 px-4 py-3 text-sm text-sky-700 dark:text-sky-300">{notice}</div> : null}

        <motion.div initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.35, ease: EASE }} className="grid gap-4 lg:grid-cols-[0.95fr_1.05fr]">
          <div className="space-y-4 rounded-[1.75rem] border border-white/15 bg-white/50 p-4 dark:bg-slate-900/40">
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <div className="flex items-center gap-2 text-sm font-semibold uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">
                  <ChevronDown className="h-4 w-4" />
                  Row fields
                </div>
                {columns.map((column) => (
                  <label key={`row-${column.name}`} className="flex items-center gap-3 rounded-2xl border border-white/15 bg-white/35 px-3 py-2.5 text-sm text-slate-700 dark:bg-slate-900/30 dark:text-slate-200">
                    <input type="checkbox" checked={rowFields.includes(column.name)} onChange={() => toggleField(column.name, "row")} className="h-4 w-4 rounded border-white/20 bg-transparent" />
                    {column.name}
                  </label>
                ))}
              </div>
              <div className="space-y-2">
                <div className="flex items-center gap-2 text-sm font-semibold uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">
                  <ChevronDown className="h-4 w-4" />
                  Column fields
                </div>
                {columns.map((column) => (
                  <label key={`col-${column.name}`} className="flex items-center gap-3 rounded-2xl border border-white/15 bg-white/35 px-3 py-2.5 text-sm text-slate-700 dark:bg-slate-900/30 dark:text-slate-200">
                    <input type="checkbox" checked={columnFields.includes(column.name)} onChange={() => toggleField(column.name, "column")} className="h-4 w-4 rounded border-white/20 bg-transparent" />
                    {column.name}
                  </label>
                ))}
              </div>
            </div>

            <div className="space-y-3 rounded-[1.5rem] border border-white/15 bg-white/35 p-4 dark:bg-slate-900/30">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-sm font-semibold uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">
                  <Plus className="h-4 w-4" />
                  Value fields
                </div>
                <button type="button" onClick={addValueField} className="inline-flex items-center gap-2 rounded-2xl border border-white/20 px-3 py-2 text-sm text-slate-700 transition hover:bg-white/40 dark:text-slate-200">
                  <Plus className="h-4 w-4" />
                  Add measure
                </button>
              </div>
              {valueFields.map((field) => (
                <div key={field.id} className="grid gap-2 md:grid-cols-[1fr_auto_1fr_auto]">
                  <select value={field.column} onChange={(event) => updateValueField(field.id, { column: event.target.value, alias: sanitizeAlias(`${field.aggregation.toLowerCase()}_${event.target.value}`) })} className="rounded-2xl border border-white/20 bg-white/70 px-4 py-3 text-sm text-slate-950 outline-none dark:bg-slate-950/60 dark:text-slate-50">
                    {columns.map((column) => <option key={column.name} value={column.name}>{column.name}</option>)}
                  </select>
                  <select value={field.aggregation} onChange={(event) => updateValueField(field.id, { aggregation: event.target.value as AggFn })} className="rounded-2xl border border-white/20 bg-white/70 px-4 py-3 text-sm text-slate-950 outline-none dark:bg-slate-950/60 dark:text-slate-50">
                    {Object.keys(aggSql).map((agg) => <option key={agg} value={agg}>{agg}</option>)}
                  </select>
                  <input value={field.alias} onChange={(event) => updateValueField(field.id, { alias: sanitizeAlias(event.target.value) })} placeholder="Alias" className="rounded-2xl border border-white/20 bg-white/70 px-4 py-3 text-sm text-slate-950 outline-none dark:bg-slate-950/60 dark:text-slate-50" />
                  <button type="button" onClick={() => removeValueField(field.id)} className="rounded-2xl border border-rose-300/40 bg-rose-500/10 px-3 py-3 text-rose-700 dark:text-rose-300">
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              ))}
            </div>

            <div className="space-y-3 rounded-[1.5rem] border border-white/15 bg-white/35 p-4 dark:bg-slate-900/30">
              <div className="flex items-center gap-2 text-sm font-semibold uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">
                <Calculator className="h-4 w-4" />
                Calculated fields
              </div>
              <div className="grid gap-2 md:grid-cols-[1fr_1.2fr_auto]">
                <input value={calcName} onChange={(event) => setCalcName(event.target.value)} placeholder="margin_pct" className="rounded-2xl border border-white/20 bg-white/70 px-4 py-3 text-sm text-slate-950 outline-none dark:bg-slate-950/60 dark:text-slate-50" />
                <input value={calcFormula} onChange={(event) => setCalcFormula(event.target.value)} placeholder="sum_revenue / count_revenue" className="rounded-2xl border border-white/20 bg-white/70 px-4 py-3 font-mono text-sm text-slate-950 outline-none dark:bg-slate-950/60 dark:text-slate-50" />
                <button type="button" onClick={addCalculatedField} className="rounded-2xl bg-indigo-600 px-4 py-3 text-sm font-semibold text-white transition hover:bg-indigo-500">
                  Add
                </button>
              </div>
              {calculatedFields.map((field) => (
                <div key={field.id} className="flex items-center justify-between gap-3 rounded-2xl border border-white/15 bg-white/30 px-4 py-3 dark:bg-slate-950/30">
                  <div>
                    <p className="font-semibold text-slate-950 dark:text-slate-50">{field.name}</p>
                    <p className="mt-1 font-mono text-xs text-slate-500 dark:text-slate-400">{field.formula}</p>
                  </div>
                  <button type="button" onClick={() => removeCalculatedField(field.id)} className="rounded-2xl border border-rose-300/40 bg-rose-500/10 p-2 text-rose-700 dark:text-rose-300">
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              ))}
            </div>

            <div className="grid gap-2 sm:grid-cols-2">
              <button type="button" onClick={() => void runPivot()} className="inline-flex items-center justify-center gap-2 rounded-2xl bg-sky-600 px-4 py-3 text-sm font-semibold text-white transition hover:bg-sky-500">
                <Table2 className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
                {loading ? "Running pivot" : "Run pivot"}
              </button>
              <button type="button" onClick={exportCsv} className="inline-flex items-center justify-center gap-2 rounded-2xl border border-white/20 px-4 py-3 text-sm text-slate-700 transition hover:bg-white/40 dark:text-slate-200">
                <Download className="h-4 w-4" />
                Export CSV
              </button>
            </div>
          </div>

          <div className="space-y-4 rounded-[1.75rem] border border-white/15 bg-white/50 p-4 dark:bg-slate-900/40">
            {result ? (
              <div className="overflow-auto rounded-[1.5rem] border border-white/15">
                <table className="min-w-full border-collapse text-sm">
                  <thead className="sticky top-0 bg-white/70 backdrop-blur dark:bg-slate-950/80">
                    <tr>
                      <th className="border-b border-white/10 px-4 py-3 text-left font-semibold text-slate-600 dark:text-slate-300">{rowFields.join(" / ") || "Rows"}</th>
                      {displayColumns.map(({ colKey, measure }) => (
                        <th key={`${colKey}-${measure}`} className="border-b border-white/10 px-3 py-3 text-right font-semibold text-slate-600 dark:text-slate-300">
                          <div>{colKey}</div>
                          <div className="text-[11px] uppercase tracking-[0.16em] text-slate-400">{measure}</div>
                        </th>
                      ))}
                      <th className="border-b border-white/10 px-4 py-3 text-right font-semibold text-slate-600 dark:text-slate-300">Row total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.rowKeys.map((rowKey, index) => {
                      const rowTotalSum = Object.values(result.rowTotals.get(rowKey) ?? {}).reduce((sum, value) => sum + value, 0);
                      const currentGroup = result.rowLabels.get(rowKey)?.[0] ?? rowKey;
                      const nextGroup = result.rowLabels.get(result.rowKeys[index + 1] ?? "")?.[0];
                      const showSubtotal = rowFields.length > 1 && currentGroup !== nextGroup;

                      return (
                        <FragmentRow
                          key={rowKey}
                          rowKey={rowKey}
                          currentGroup={currentGroup}
                          result={result}
                          displayColumns={displayColumns}
                          heatRange={heatRange}
                          rowTotalSum={rowTotalSum}
                          showSubtotal={showSubtotal}
                          onDrillDown={drillIntoCell}
                        />
                      );
                    })}
                    <tr className="bg-slate-950/5 dark:bg-white/5">
                      <td className="border-t border-white/10 px-4 py-3 font-semibold text-slate-950 dark:text-slate-50">Grand total</td>
                      {displayColumns.map(({ colKey, measure }) => (
                        <td key={`grand-${colKey}-${measure}`} className="border-t border-white/10 px-3 py-3 text-right font-semibold text-slate-950 dark:text-slate-50">
                          {formatNumber(result.colTotals.get(colKey)?.[measure] ?? 0)}
                        </td>
                      ))}
                      <td className="border-t border-white/10 px-4 py-3 text-right font-semibold text-slate-950 dark:text-slate-50">{formatNumber(Object.values(result.grandTotals).reduce((sum, value) => sum + value, 0))}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="rounded-[1.5rem] border border-dashed border-white/20 bg-white/35 px-5 py-12 text-center text-sm text-slate-500 dark:bg-slate-900/30 dark:text-slate-400">
                Configure row, column, and value fields, then run the pivot.
              </div>
            )}

            {drilldownRows.length > 0 ? (
              <div className="rounded-[1.5rem] border border-white/15 bg-white/35 p-4 dark:bg-slate-900/30">
                <h3 className="text-sm font-semibold uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">Drill-down</h3>
                <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">{drilldownTitle}</p>
                <div className="mt-4 overflow-auto rounded-2xl border border-white/10">
                  <table className="min-w-full text-sm">
                    <thead className="bg-white/40 dark:bg-slate-950/50">
                      <tr>{Object.keys(drilldownRows[0]).map((key) => <th key={key} className="px-3 py-2 text-left font-semibold text-slate-600 dark:text-slate-300">{key}</th>)}</tr>
                    </thead>
                    <tbody className="divide-y divide-white/10">
                      {drilldownRows.map((row, index) => (
                        <tr key={`${index}-${Object.values(row).join("|")}`}>{Object.entries(row).map(([key, value]) => <td key={key} className="px-3 py-2 text-slate-700 dark:text-slate-200">{String(value ?? "null")}</td>)}</tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ) : null}
          </div>
        </motion.div>
      </div>
    </section>
  );
}

function FragmentRow({
  rowKey,
  currentGroup,
  result,
  displayColumns,
  heatRange,
  rowTotalSum,
  showSubtotal,
  onDrillDown,
}: {
  rowKey: string;
  currentGroup: string;
  result: PivotResult;
  displayColumns: Array<{ colKey: string; measure: string }>;
  heatRange: readonly [number, number];
  rowTotalSum: number;
  showSubtotal: boolean;
  onDrillDown: (rowKey: string, colKey: string) => Promise<void>;
}) {
  return (
    <>
      <tr>
        <td className="border-b border-white/10 px-4 py-3 font-medium text-slate-950 dark:text-slate-50">{rowKey}</td>
        {displayColumns.map(({ colKey, measure }) => {
          const value = result.cells.get(cellKey(rowKey, colKey))?.[measure] ?? 0;
          return (
            <td key={`${rowKey}-${colKey}-${measure}`} className="border-b border-white/10 px-3 py-3 text-right">
              <button type="button" onClick={() => void onDrillDown(rowKey, colKey)} className="w-full rounded-xl px-2 py-1 text-right text-slate-800 transition hover:opacity-90 dark:text-slate-100" style={{ backgroundColor: heatColor(value, heatRange[0], heatRange[1]) }}>
                {formatNumber(value)}
              </button>
            </td>
          );
        })}
        <td className="border-b border-white/10 px-4 py-3 text-right font-semibold text-slate-900 dark:text-slate-100">{formatNumber(rowTotalSum)}</td>
      </tr>
      {showSubtotal ? (
        <tr className="bg-slate-950/5 dark:bg-white/5">
          <td className="border-b border-white/10 px-4 py-3 font-semibold text-slate-950 dark:text-slate-50">{currentGroup} subtotal</td>
          {displayColumns.map(({ colKey, measure }) => (
            <td key={`subtotal-${currentGroup}-${colKey}-${measure}`} className="border-b border-white/10 px-3 py-3 text-right font-semibold text-slate-950 dark:text-slate-50">
              {formatNumber(result.groupSubtotals.get(currentGroup)?.[measure] ?? 0)}
            </td>
          ))}
          <td className="border-b border-white/10 px-4 py-3 text-right font-semibold text-slate-950 dark:text-slate-50">
            {formatNumber(Object.values(result.groupSubtotals.get(currentGroup) ?? {}).reduce((sum, value) => sum + value, 0))}
          </td>
        </tr>
      ) : null}
    </>
  );
}
