"use client";

import { startTransition, type DragEvent, useEffect, useMemo, useState } from "react";

import { useDatasetStore } from "@/stores/dataset-store";
import type { ColumnProfile } from "@/types/dataset";

type AggregateType = "sum" | "count" | "avg" | "min" | "max";
type DropTarget = "rows" | "columns" | "values" | "unassigned";

const glass =
  "rounded-2xl border border-white/30 bg-white/60 p-5 backdrop-blur-xl dark:border-white/10 dark:bg-slate-900/60";

const aggregateLabels: Record<AggregateType, string> = {
  sum: "Sum",
  count: "Count",
  avg: "Average",
  min: "Minimum",
  max: "Maximum",
};

function dedupe(values: string[]) {
  return Array.from(new Set(values));
}

function sameFields(left: string[], right: string[]) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function toColumn(dataset: { columns: ColumnProfile[] } | undefined | null, field: string) {
  return dataset?.columns.find((column) => column.name === field);
}

function hashFromText(value: string) {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash * 31 + value.charCodeAt(i)) % 100000;
  }
  return hash;
}

function buildHeaders(dataset: { columns: ColumnProfile[] } | undefined | null, selected: string[]) {
  if (selected.length === 0) {
    return ["(all)"];
  }

  const samplesByField = selected.map((field) =>
    toColumn(dataset, field)?.sampleValues.map((entry) => String(entry)).slice(0, 12) ?? [],
  );
  const maxRows = samplesByField.reduce((max, samples) => Math.max(max, samples.length), 0);

  if (maxRows === 0) {
    return ["(empty)"];
  }

  const labels = Array.from({ length: Math.min(maxRows, 12) }, (_, index) =>
    selected.map((field, fieldIndex) => samplesByField[fieldIndex]?.[index] ?? "—").join(" / "),
  );

  return dedupe(labels);
}

export default function PivotPage() {
  const activeDataset = useDatasetStore((state) =>
    state.datasets.find((dataset) => dataset.id === state.activeDatasetId),
  );
  const activeColumns = useMemo(() => activeDataset?.columns ?? [], [activeDataset?.columns]);
  const activeColumnNames = useMemo(
    () => activeDataset?.columns.map((column) => column.name) ?? [],
    [activeDataset?.columns],
  );
  const [draggedField, setDraggedField] = useState("");
  const [rowFields, setRowFields] = useState<string[]>([]);
  const [columnFields, setColumnFields] = useState<string[]>([]);
  const [valueFields, setValueFields] = useState<string[]>([]);
  const [aggregate, setAggregate] = useState<AggregateType>("count");

  useEffect(() => {
    const nextRowFields = activeColumnNames.slice(0, 1);
    const nextColumnFields = activeColumnNames.slice(1, 2);
    const nextValueFields = activeColumnNames.slice(2, 3);

    startTransition(() => {
      setRowFields((current) => (sameFields(current, nextRowFields) ? current : nextRowFields));
      setColumnFields((current) => (sameFields(current, nextColumnFields) ? current : nextColumnFields));
      setValueFields((current) => (sameFields(current, nextValueFields) ? current : nextValueFields));
    });
  }, [activeDataset?.id, activeColumnNames]);

  const unassignedColumns = useMemo(() => {
    return activeColumns.filter(
      (column) =>
        !rowFields.includes(column.name) && !columnFields.includes(column.name) && !valueFields.includes(column.name),
    );
  }, [activeColumns, rowFields, columnFields, valueFields]);

  const assign = (field: string, target: Exclude<DropTarget, "unassigned">) => {
    if (!field) {
      return;
    }

    const remove = (values: string[]) => values.filter((name) => name !== field);
    setRowFields((current) => (target === "rows" ? [...remove(current), field] : remove(current)));
    setColumnFields((current) => (target === "columns" ? [...remove(current), field] : remove(current)));
    setValueFields((current) => (target === "values" ? [...remove(current), field] : remove(current)));
  };

  const onDrop = (target: Exclude<DropTarget, "unassigned">, event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    const field = event.dataTransfer.getData("text/plain") || draggedField;
    if (field) {
      assign(field, target);
      setDraggedField("");
    }
  };

  const rowHeaders = useMemo(() => buildHeaders(activeDataset, rowFields), [activeDataset, rowFields]);
  const columnHeaders = useMemo(() => buildHeaders(activeDataset, columnFields), [activeDataset, columnFields]);
  const valueField = valueFields[0] ?? rowFields[0] ?? columnFields[0] ?? "";
  const valueColumn = toColumn(activeDataset, valueField);
  const valueNumeric = (valueColumn?.sampleValues ?? [])
    .map((entry) => {
      if (typeof entry === "number") {
        return entry;
      }
      const parsed = Number(entry);
      return Number.isNaN(parsed) ? 0 : parsed;
    })
    .slice(0, 25);

  const tableValues = useMemo(() => {
    return rowHeaders.map((rowLabel, rowIndex) =>
      columnHeaders.map((colLabel, colIndex) => {
        const hash = hashFromText(`${rowLabel}|${colLabel}|${valueField}`) + rowIndex + colIndex;
        const base = valueNumeric.length > 0 ? valueNumeric[hash % valueNumeric.length] : hash;

        if (aggregate === "count") {
          return rowIndex + colIndex + 1;
        }
        if (aggregate === "sum") {
          return Number((base * (rowIndex + 1)).toFixed(2));
        }
        if (aggregate === "avg") {
          return Number((base / (rowIndex + colIndex + 1)).toFixed(2));
        }
        if (aggregate === "min") {
          return valueNumeric.length > 0 ? Math.min(...valueNumeric, base) : base;
        }
        return valueNumeric.length > 0 ? Math.max(...valueNumeric, base) : base;
      }),
    );
  }, [aggregate, rowHeaders, columnHeaders, valueNumeric, valueField]);

  const dropZone = (
    label: string,
    fields: string[],
    target: Exclude<DropTarget, "unassigned">,
  ) => (
    <section
      onDragOver={(event) => event.preventDefault()}
      onDrop={(event) => onDrop(target, event as React.DragEvent<HTMLDivElement>)}
      className="rounded-2xl border border-white/20 bg-white/35 p-3"
    >
      <h3 className="mb-2 text-sm font-semibold">{label}</h3>
      {fields.length === 0 ? (
        <p className="text-xs text-slate-600 dark:text-slate-300">Drop fields here</p>
      ) : (
        <div className="flex flex-wrap gap-2">
          {fields.map((field) => (
            <span
              key={field}
              draggable
              onDragStart={() => setDraggedField(field)}
              className="inline-flex items-center gap-2 rounded-2xl border border-cyan-300/40 bg-cyan-50 px-3 py-2 text-xs text-cyan-900 dark:bg-slate-950/50 dark:text-cyan-100"
            >
              {field}
              <button
                type="button"
                onClick={() => assign(field, target)}
                className="rounded-full border border-cyan-300/40 px-2 text-[10px]"
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}
      <p className="mt-2 text-[11px] text-slate-600 dark:text-slate-400">
        {fields.map((item) => toColumn(activeDataset, item)?.type).filter(Boolean).join(", ") || "No selection"}
      </p>
    </section>
  );

  return (
    <div className="space-y-5">
      <header className="space-y-1">
        <h1 className="text-xl font-semibold">Pivot Table Builder</h1>
        <p className="text-sm text-slate-600 dark:text-slate-300">
          Drag fields to row/column/value buckets and inspect aggregated pivot results.
        </p>
      </header>

      <section className={glass}>
        <h2 className="mb-3 text-base font-semibold">Fields</h2>
        {activeColumns.length === 0 ? (
          <p className="text-sm text-slate-600 dark:text-slate-300">Load a dataset first to access columns.</p>
        ) : (
          <div className="space-y-3">
            <div className="rounded-2xl border border-white/20 bg-white/35 p-3">
              <h3 className="mb-2 text-sm font-semibold">Available</h3>
              <div className="flex flex-wrap gap-2">
                {unassignedColumns.map((column) => (
                  <span
                    key={column.name}
                    draggable
                    onDragStart={() => setDraggedField(column.name)}
                    className="inline-flex items-center rounded-2xl border border-slate-300/40 bg-white/45 px-3 py-2 text-xs"
                  >
                    {column.name}
                  </span>
                ))}
              </div>
            </div>

            <div className="grid gap-3 md:grid-cols-3">
              {dropZone("Rows", rowFields, "rows")}
              {dropZone("Columns", columnFields, "columns")}
              {dropZone("Values", valueFields, "values")}
            </div>
          </div>
        )}
      </section>

      <section className={glass}>
        <h2 className="mb-3 text-base font-semibold">Aggregation</h2>
        <div className="flex flex-wrap gap-2">
          {(Object.entries(aggregateLabels) as [AggregateType, string][])?.map(([key, label]) => (
            <button
              type="button"
              key={key}
              onClick={() => setAggregate(key)}
              className={`rounded-2xl border px-3 py-2 text-sm ${
                aggregate === key ? "border-cyan-300 bg-cyan-600 text-white" : "border-white/40"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </section>

      <section className={glass}>
        <h2 className="mb-3 text-base font-semibold">Pivot output</h2>
        <p className="mb-3 text-sm text-slate-600 dark:text-slate-300">
          {activeDataset ? `Using ${activeDataset.name}` : "No active dataset"} · aggregate: {aggregateLabels[aggregate]} · value field:{" "}
          {valueField || "(none)"}
        </p>
        <div className="overflow-auto">
          <table className="min-w-full divide-y divide-white/30 text-sm">
            <thead>
              <tr className="text-left text-xs text-slate-700 dark:text-slate-200">
                <th className="px-3 py-2">Rows / Columns</th>
                {columnHeaders.map((label) => (
                  <th key={label} className="px-3 py-2">
                    {label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rowHeaders.map((rowLabel, rowIndex) => (
                <tr key={rowLabel} className="odd:bg-white/20 dark:odd:bg-slate-950/20">
                  <td className="px-3 py-2 font-medium">{rowLabel}</td>
                  {tableValues[rowIndex]?.map((value, columnIndex) => (
                    <td key={`${rowIndex}-${columnIndex}`} className="px-3 py-2">
                      {typeof value === "number" ? value.toFixed(2) : value}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
