import { cellKey, csvEscape, sanitizeAlias } from "./lib";
import type { CalculatedField, PivotResult, ValueField } from "./types";

type PivotRow = Record<string, unknown>;

/**
 * Turns the flat result rows from `runQuery` into the nested PivotResult
 * structure the renderer consumes (cells / totals / subtotals).
 */
export function aggregatePivotRows(
  rows: PivotRow[],
  rowFields: string[],
  columnFields: string[],
  valueFields: ValueField[],
  calculatedFields: CalculatedField[],
): PivotResult {
  const measures = [
    ...valueFields.map((field) => field.alias),
    ...calculatedFields.map((field) => sanitizeAlias(field.name)),
  ];
  const cells = new Map<string, Record<string, number>>();
  const rowLabels = new Map<string, string[]>();
  const colLabels = new Map<string, string[]>();
  const rowOrder: string[] = [];
  const colOrder: string[] = [];

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
    const groupTotal =
      groupSubtotals.get(rowGroup) ??
      Object.fromEntries(measures.map((measure) => [measure, 0]));

    for (const colKey of colOrder) {
      const values =
        cells.get(cellKey(rowKey, colKey)) ??
        Object.fromEntries(measures.map((measure) => [measure, 0]));
      const colTotal =
        colTotals.get(colKey) ??
        Object.fromEntries(measures.map((measure) => [measure, 0]));

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

  return {
    rowKeys: rowOrder,
    rowLabels,
    colKeys: colOrder,
    colLabels,
    cells,
    rowTotals,
    colTotals,
    groupSubtotals,
    grandTotals,
    measures,
  };
}

/**
 * Renders a computed PivotResult to a CSV string matching the grouped-rows
 * display (respecting collapsed groups, subtotal, and grand-total toggles).
 */
export function renderPivotCsv({
  result,
  rowFields,
  displayColumns,
  groupedRows,
  collapsedGroups,
  showSubtotals,
  showGrandTotals,
}: {
  result: PivotResult;
  rowFields: string[];
  displayColumns: Array<{ colKey: string; measure: string }>;
  groupedRows: Array<{ group: string; rows: string[] }>;
  collapsedGroups: string[];
  showSubtotals: boolean;
  showGrandTotals: boolean;
}): string {
  const lines: string[] = [];
  const header = [
    rowFields.join(" / ") || "Rows",
    ...displayColumns.map(({ colKey, measure }) => `${colKey} • ${measure}`),
    "Row total",
  ];
  lines.push(header.map(csvEscape).join(","));

  for (const group of groupedRows) {
    const collapsed = collapsedGroups.includes(group.group);
    const visibleRows = collapsed ? [] : group.rows;

    for (const rowKey of visibleRows) {
      const row: Array<string | number> = [rowKey];
      for (const column of displayColumns) {
        const cell = result.cells.get(cellKey(rowKey, column.colKey));
        row.push(cell?.[column.measure] ?? 0);
      }
      row.push(
        Object.values(result.rowTotals.get(rowKey) ?? {}).reduce(
          (sum, value) => sum + value,
          0,
        ),
      );
      lines.push(row.map(csvEscape).join(","));
    }

    if (showSubtotals) {
      lines.push(
        [
          `${group.group} subtotal`,
          ...displayColumns.map(
            ({ measure }) => result.groupSubtotals.get(group.group)?.[measure] ?? 0,
          ),
          Object.values(result.groupSubtotals.get(group.group) ?? {}).reduce(
            (sum, value) => sum + value,
            0,
          ),
        ]
          .map(csvEscape)
          .join(","),
      );
    }
  }

  if (showGrandTotals) {
    lines.push(
      [
        "Grand total",
        ...displayColumns.map(
          ({ colKey, measure }) => result.colTotals.get(colKey)?.[measure] ?? 0,
        ),
        Object.values(result.grandTotals).reduce((sum, value) => sum + value, 0),
      ]
        .map(csvEscape)
        .join(","),
    );
  }

  return lines.join("\n");
}
