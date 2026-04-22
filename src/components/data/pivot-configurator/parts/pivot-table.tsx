"use client";

import { ChevronDown, ChevronRight } from "lucide-react";
import { Fragment, type Dispatch, type SetStateAction } from "react";

import { buildConditionalStyle, cellKey } from "../lib";
import type { ConditionalRule, PivotResult } from "../types";

interface PivotTableProps {
  result: PivotResult | null;
  rowFields: string[];
  displayColumns: Array<{ colKey: string; measure: string }>;
  groupedRows: Array<{ group: string; rows: string[] }>;
  collapsedGroups: string[];
  setCollapsedGroups: Dispatch<SetStateAction<string[]>>;
  showSubtotals: boolean;
  showGrandTotals: boolean;
  conditionalRules: ConditionalRule[];
}

export function PivotTable({
  result,
  rowFields,
  displayColumns,
  groupedRows,
  collapsedGroups,
  setCollapsedGroups,
  showSubtotals,
  showGrandTotals,
  conditionalRules,
}: PivotTableProps) {
  if (!result) {
    return (
      <div className="rounded-[1.4rem] border border-dashed border-white/20 bg-white/35 px-5 py-12 text-center text-sm text-slate-500 dark:bg-slate-950/30 dark:text-slate-400">
        Configure the drop zones, then run the pivot to render results here.
      </div>
    );
  }

  return (
    <div className="overflow-auto rounded-[1.4rem] border border-white/15">
      <table className="min-w-full border-collapse text-sm">
        <thead className="sticky top-0 bg-white/70 backdrop-blur dark:bg-slate-950/80">
          <tr>
            <th className="border-b border-white/10 px-4 py-3 text-left font-semibold text-slate-600 dark:text-slate-300">
              {rowFields.join(" / ") || "Rows"}
            </th>
            {displayColumns.map(({ colKey, measure }) => (
              <th
                key={`${colKey}-${measure}`}
                className="border-b border-white/10 px-3 py-3 text-right font-semibold text-slate-600 dark:text-slate-300"
              >
                <div>{colKey}</div>
                <div className="text-[11px] uppercase tracking-[0.16em] text-slate-400">
                  {measure}
                </div>
              </th>
            ))}
            <th className="border-b border-white/10 px-4 py-3 text-right font-semibold text-slate-600 dark:text-slate-300">
              Row total
            </th>
          </tr>
        </thead>
        <tbody>
          {groupedRows.map((group) => {
            const collapsed = collapsedGroups.includes(group.group);
            const subtotal = result.groupSubtotals.get(group.group) ?? {};
            return (
              <Fragment key={group.group}>
                {rowFields.length > 1 ? (
                  <tr className="bg-slate-950/5 dark:bg-white/5">
                    <td className="border-b border-white/10 px-4 py-3">
                      <button
                        type="button"
                        onClick={() =>
                          setCollapsedGroups((current) =>
                            current.includes(group.group)
                              ? current.filter((entry) => entry !== group.group)
                              : [...current, group.group],
                          )
                        }
                        className="flex items-center gap-2 font-semibold text-slate-950 dark:text-white"
                      >
                        {collapsed ? (
                          <ChevronRight className="h-4 w-4" />
                        ) : (
                          <ChevronDown className="h-4 w-4" />
                        )}
                        {group.group}
                      </button>
                    </td>
                    <td
                      colSpan={displayColumns.length + 1}
                      className="border-b border-white/10 px-4 py-3 text-right text-xs uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400"
                    >
                      {group.rows.length} row groups
                    </td>
                  </tr>
                ) : null}

                {collapsed
                  ? null
                  : group.rows.map((rowKey) => {
                      const rowTotal = Object.values(
                        result.rowTotals.get(rowKey) ?? {},
                      ).reduce((sum, value) => sum + value, 0);
                      return (
                        <tr key={rowKey}>
                          <td className="border-b border-white/10 px-4 py-3 font-medium text-slate-950 dark:text-slate-50">
                            {rowKey}
                          </td>
                          {displayColumns.map(({ colKey, measure }) => {
                            const value =
                              result.cells.get(cellKey(rowKey, colKey))?.[measure] ?? 0;
                            return (
                              <td
                                key={`${rowKey}-${colKey}-${measure}`}
                                className="border-b border-white/10 px-3 py-3 text-right"
                              >
                                <div
                                  className="rounded-xl px-2 py-1"
                                  style={buildConditionalStyle(value, measure, conditionalRules)}
                                >
                                  {value.toLocaleString()}
                                </div>
                              </td>
                            );
                          })}
                          <td className="border-b border-white/10 px-4 py-3 text-right font-semibold text-slate-900 dark:text-slate-100">
                            {rowTotal.toLocaleString()}
                          </td>
                        </tr>
                      );
                    })}

                {showSubtotals ? (
                  <tr className="bg-slate-950/5 dark:bg-white/5">
                    <td className="border-b border-white/10 px-4 py-3 font-semibold text-slate-950 dark:text-slate-50">
                      {group.group} subtotal
                    </td>
                    {displayColumns.map(({ measure }) => (
                      <td
                        key={`subtotal-${group.group}-${measure}`}
                        className="border-b border-white/10 px-3 py-3 text-right font-semibold text-slate-950 dark:text-slate-50"
                      >
                        {(subtotal[measure] ?? 0).toLocaleString()}
                      </td>
                    ))}
                    <td className="border-b border-white/10 px-4 py-3 text-right font-semibold text-slate-950 dark:text-slate-50">
                      {Object.values(subtotal).reduce((sum, value) => sum + value, 0).toLocaleString()}
                    </td>
                  </tr>
                ) : null}
              </Fragment>
            );
          })}

          {showGrandTotals ? (
            <tr className="bg-slate-950/10 dark:bg-white/10">
              <td className="border-t border-white/10 px-4 py-3 font-semibold text-slate-950 dark:text-slate-50">
                Grand total
              </td>
              {displayColumns.map(({ colKey, measure }) => (
                <td
                  key={`grand-${colKey}-${measure}`}
                  className="border-t border-white/10 px-3 py-3 text-right font-semibold text-slate-950 dark:text-slate-50"
                >
                  {(result.colTotals.get(colKey)?.[measure] ?? 0).toLocaleString()}
                </td>
              ))}
              <td className="border-t border-white/10 px-4 py-3 text-right font-semibold text-slate-950 dark:text-slate-50">
                {Object.values(result.grandTotals).reduce((sum, value) => sum + value, 0).toLocaleString()}
              </td>
            </tr>
          ) : null}
        </tbody>
      </table>
    </div>
  );
}
