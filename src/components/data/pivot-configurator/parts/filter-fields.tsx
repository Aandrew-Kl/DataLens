"use client";

import { Trash2 } from "lucide-react";
import type { Dispatch, SetStateAction } from "react";
import type { ColumnProfile } from "@/types/dataset";

import { FIELD_CLASS, type FilterOperator, type PivotFilter } from "../types";

interface FilterFieldRowProps {
  filterItem: PivotFilter;
  columns: ColumnProfile[];
  setFilters: Dispatch<SetStateAction<PivotFilter[]>>;
}

export function FilterFieldRow({ filterItem, columns, setFilters }: FilterFieldRowProps) {
  const column = columns.find((entry) => entry.name === filterItem.column);
  const dataListId = `pivot-filter-${filterItem.id}`;

  return (
    <div className="grid gap-2 rounded-2xl border border-white/15 bg-white/55 p-3 dark:bg-slate-950/35">
      <div className="grid gap-2 md:grid-cols-[1fr_auto_1fr_auto]">
        <input value={filterItem.column} readOnly className={FIELD_CLASS} />
        <select
          value={filterItem.operator}
          onChange={(event) =>
            setFilters((current) =>
              current.map((entry) =>
                entry.id === filterItem.id
                  ? {
                      ...entry,
                      operator: event.target.value as FilterOperator,
                    }
                  : entry,
              ),
            )
          }
          className={FIELD_CLASS}
        >
          <option value="equals">Equals</option>
          <option value="not_equals">Not equals</option>
        </select>
        <div>
          <input
            value={filterItem.value}
            onChange={(event) =>
              setFilters((current) =>
                current.map((entry) =>
                  entry.id === filterItem.id
                    ? { ...entry, value: event.target.value }
                    : entry,
                ),
              )
            }
            list={dataListId}
            placeholder="Literal value"
            className={FIELD_CLASS}
          />
          <datalist id={dataListId}>
            {(column?.sampleValues ?? []).map((sampleValue, index) => (
              <option key={`${filterItem.id}-${index}`} value={String(sampleValue ?? "")} />
            ))}
          </datalist>
        </div>
        <button
          type="button"
          onClick={() =>
            setFilters((current) =>
              current.filter((entry) => entry.id !== filterItem.id),
            )
          }
          className="rounded-2xl border border-rose-300/30 bg-rose-500/10 px-3 py-3 text-rose-700 dark:text-rose-300"
        >
          <Trash2 className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
