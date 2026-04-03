"use client";

import { useMemo, useState } from "react";
import { motion } from "framer-motion";
import { ArrowRightLeft, Download, TableProperties } from "lucide-react";
import { runQuery } from "@/lib/duckdb/client";
import {
  ANALYTICS_EASE,
  BUTTON_CLASS,
  GLASS_CARD_CLASS,
  GLASS_PANEL_CLASS,
  quoteIdentifier,
  quoteLiteral,
} from "@/lib/utils/advanced-analytics";
import { downloadFile } from "@/lib/utils/export";
import type { ColumnProfile } from "@/types/dataset";

interface DataTransposeToolProps {
  tableName: string;
  columns: ColumnProfile[];
}

function escapeCsv(value: unknown): string {
  const text = String(value ?? "");
  return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function buildCsv(rows: Record<string, unknown>[]): string {
  if (rows.length === 0) {
    return "";
  }

  const headers = Array.from(new Set(rows.flatMap((row) => Object.keys(row))));
  const body = rows.map((row) => headers.map((header) => escapeCsv(row[header])).join(","));
  return [headers.join(","), ...body].join("\n");
}

function buildTransposeSql(
  tableName: string,
  idColumn: string,
  valueColumns: string[],
  ids: string[],
): string {
  const stackedSql = valueColumns
    .map(
      (valueColumn) => `
        SELECT
          CAST(${quoteIdentifier(idColumn)} AS VARCHAR) AS entity_id,
          ${quoteLiteral(valueColumn)} AS metric_name,
          CAST(${quoteIdentifier(valueColumn)} AS VARCHAR) AS metric_value
        FROM ${quoteIdentifier(tableName)}
        WHERE ${quoteIdentifier(idColumn)} IS NOT NULL
      `,
    )
    .join("\n        UNION ALL\n");

  const projectedIds = ids
    .map(
      (idValue) =>
        `MAX(CASE WHEN entity_id = ${quoteLiteral(idValue)} THEN metric_value END) AS ${quoteIdentifier(idValue)}`,
    )
    .join(",\n      ");

  return `
    WITH stacked AS (
      ${stackedSql}
    )
    SELECT
      metric_name,
      ${projectedIds}
    FROM stacked
    GROUP BY metric_name
    ORDER BY metric_name
  `;
}

function buildHeaders(rows: Record<string, unknown>[], idColumn: string): string[] {
  return rows.length === 0 ? ["metric_name", idColumn] : Array.from(new Set(rows.flatMap((row) => Object.keys(row))));
}

export default function DataTransposeTool({ tableName, columns }: DataTransposeToolProps) {
  const [idColumn, setIdColumn] = useState(columns[0]?.name ?? "");
  const [valueColumns, setValueColumns] = useState<string[]>(() => columns.slice(1, 3).map((column) => column.name));
  const [sqlPreview, setSqlPreview] = useState("");
  const [resultRows, setResultRows] = useState<Record<string, unknown>[]>([]);
  const [status, setStatus] = useState("Pick an identifier column and the measures that should be turned into transposed rows.");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const valueColumnCandidates = useMemo(
    () => columns.filter((column) => column.name !== idColumn),
    [columns, idColumn],
  );
  const headers = useMemo(() => buildHeaders(resultRows, idColumn), [idColumn, resultRows]);

  if (columns.length < 2) {
    return (
      <section className={`${GLASS_PANEL_CLASS} p-6`}>
        <h2 className="text-xl font-semibold text-slate-950 dark:text-white">Data transpose tool</h2>
        <p className="mt-3 text-sm text-slate-600 dark:text-slate-300">
          Transposition requires an identifier column plus at least one value column.
        </p>
      </section>
    );
  }

  async function handleTranspose(): Promise<void> {
    if (!idColumn || valueColumns.length === 0) {
      setError("Choose one identifier column and at least one value column.");
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const idRows = await runQuery(`
        SELECT DISTINCT CAST(${quoteIdentifier(idColumn)} AS VARCHAR) AS entity_id
        FROM ${quoteIdentifier(tableName)}
        WHERE ${quoteIdentifier(idColumn)} IS NOT NULL
        ORDER BY 1
        LIMIT 8
      `);
      const ids = idRows.map((row) => String(row.entity_id ?? "")).filter((value) => value.length > 0);

      if (ids.length === 0) {
        throw new Error("The selected identifier column does not contain usable values.");
      }

      const transposeSql = buildTransposeSql(tableName, idColumn, valueColumns, ids);
      const rows = await runQuery(transposeSql);
      setSqlPreview(transposeSql.trim());
      setResultRows(rows);
      setStatus(`Transposed ${valueColumns.length} measure columns across ${ids.length} identifier values.`);
    } catch (transposeError) {
      setError(transposeError instanceof Error ? transposeError.message : "Unable to transpose the selected columns.");
    } finally {
      setLoading(false);
    }
  }

  function handleExport(): void {
    if (resultRows.length === 0) {
      setError("Transpose the data before exporting.");
      return;
    }

    downloadFile(
      buildCsv(resultRows),
      `${tableName}-${idColumn}-transposed.csv`,
      "text/csv;charset=utf-8;",
    );
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
          <div className="inline-flex items-center gap-2 rounded-full bg-amber-500/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-amber-700 dark:text-amber-300">
            <ArrowRightLeft className="h-3.5 w-3.5" />
            Pivoting
          </div>
          <h2 className="text-2xl font-semibold text-slate-950 dark:text-white">
            Flip row values into DuckDB-generated columns
          </h2>
          <p className="max-w-3xl text-sm text-slate-600 dark:text-slate-300">{status}</p>
        </div>

        <div className="flex flex-wrap gap-3">
          <button className={BUTTON_CLASS} disabled={loading} onClick={() => void handleTranspose()} type="button">
            <TableProperties className="h-4 w-4" />
            {loading ? "Transposing…" : "Transpose data"}
          </button>
          <button className={BUTTON_CLASS} disabled={resultRows.length === 0} onClick={handleExport} type="button">
            <Download className="h-4 w-4" />
            Export CSV
          </button>
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,18rem)_minmax(0,1fr)]">
        <aside className="space-y-4">
          <div className={`${GLASS_CARD_CLASS} space-y-4 p-4`}>
            <div>
              <p className="text-sm font-medium text-slate-700 dark:text-slate-200">Identifier column</p>
              <div className="mt-3 space-y-2">
                {columns.map((column) => (
                  <label className="flex items-center gap-3 text-sm text-slate-700 dark:text-slate-200" key={column.name}>
                    <input
                      checked={idColumn === column.name}
                      name="transpose-id-column"
                      onChange={() => {
                        setIdColumn(column.name);
                        setValueColumns((current) => {
                          const filtered = current.filter((valueColumn) => valueColumn !== column.name);
                          return filtered.length > 0
                            ? filtered
                            : columns
                                .filter((candidate) => candidate.name !== column.name)
                                .slice(0, 2)
                                .map((candidate) => candidate.name);
                        });
                      }}
                      type="radio"
                    />
                    <span>{column.name}</span>
                  </label>
                ))}
              </div>
            </div>

            <div>
              <p className="text-sm font-medium text-slate-700 dark:text-slate-200">Value columns</p>
              <div className="mt-3 space-y-2">
                {valueColumnCandidates.map((column) => (
                  <label className="flex items-center gap-3 text-sm text-slate-700 dark:text-slate-200" key={column.name}>
                    <input
                      checked={valueColumns.includes(column.name)}
                      onChange={() =>
                        setValueColumns((current) =>
                          current.includes(column.name)
                            ? current.filter((valueColumn) => valueColumn !== column.name)
                            : [...current, column.name],
                        )
                      }
                      type="checkbox"
                    />
                    <span>{column.name}</span>
                  </label>
                ))}
              </div>
            </div>
          </div>

          {sqlPreview ? (
            <div className={`${GLASS_CARD_CLASS} p-4`}>
              <h3 className="text-sm font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
                Generated SQL
              </h3>
              <code className="mt-3 block rounded-2xl bg-slate-950 px-4 py-3 text-xs leading-6 text-cyan-100">
                {sqlPreview}
              </code>
            </div>
          ) : null}

          {error ? (
            <div className="rounded-3xl border border-rose-400/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-700 dark:text-rose-300">
              {error}
            </div>
          ) : null}
        </aside>

        <div className={`${GLASS_CARD_CLASS} overflow-hidden`}>
          <div className="border-b border-white/10 px-4 py-3">
            <h3 className="text-sm font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
              Transposed preview
            </h3>
          </div>

          {resultRows.length === 0 ? (
            <p className="px-4 py-8 text-sm text-slate-600 dark:text-slate-300">
              Run the transpose to preview the pivoted rows.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full text-left text-sm">
                <thead className="bg-slate-950/[0.03] dark:bg-white/[0.03]">
                  <tr>
                    {headers.map((header) => (
                      <th className="px-4 py-3 font-semibold text-slate-700 dark:text-slate-200" key={header}>
                        {header}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {resultRows.map((row, rowIndex) => (
                    <tr className="border-t border-white/10" key={`${rowIndex}-${headers.join(":")}`}>
                      {headers.map((header) => (
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
      </div>
    </motion.section>
  );
}
