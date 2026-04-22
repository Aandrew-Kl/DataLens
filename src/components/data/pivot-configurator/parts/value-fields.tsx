"use client";

import { Trash2 } from "lucide-react";
import type { Dispatch, SetStateAction } from "react";
import type { ColumnProfile } from "@/types/dataset";

import { sanitizeAlias } from "../lib";
import { AGG_SQL, FIELD_CLASS, type AggFn, type ValueField } from "../types";

interface ValueFieldRowProps {
  field: ValueField;
  columns: ColumnProfile[];
  setValueFields: Dispatch<SetStateAction<ValueField[]>>;
}

export function ValueFieldRow({ field, columns, setValueFields }: ValueFieldRowProps) {
  return (
    <div className="grid gap-2 rounded-2xl border border-white/15 bg-white/55 p-3 dark:bg-slate-950/35">
      <div className="grid gap-2 md:grid-cols-[1fr_auto_1fr_auto]">
        <select
          value={field.column}
          onChange={(event) =>
            setValueFields((current) =>
              current.map((entry) =>
                entry.id === field.id
                  ? {
                      ...entry,
                      column: event.target.value,
                      alias: sanitizeAlias(
                        `${entry.aggregation.toLowerCase()}_${event.target.value}`,
                      ),
                    }
                  : entry,
              ),
            )
          }
          className={FIELD_CLASS}
        >
          {columns.map((column) => (
            <option key={column.name} value={column.name}>
              {column.name}
            </option>
          ))}
        </select>
        <select
          value={field.aggregation}
          onChange={(event) =>
            setValueFields((current) =>
              current.map((entry) =>
                entry.id === field.id
                  ? {
                      ...entry,
                      aggregation: event.target.value as AggFn,
                      alias: sanitizeAlias(
                        `${event.target.value.toLowerCase()}_${entry.column}`,
                      ),
                    }
                  : entry,
              ),
            )
          }
          className={FIELD_CLASS}
        >
          {Object.keys(AGG_SQL).map((aggregation) => (
            <option key={aggregation} value={aggregation}>
              {aggregation}
            </option>
          ))}
        </select>
        <input
          value={field.alias}
          onChange={(event) =>
            setValueFields((current) =>
              current.map((entry) =>
                entry.id === field.id
                  ? { ...entry, alias: sanitizeAlias(event.target.value) }
                  : entry,
              ),
            )
          }
          placeholder="Alias"
          className={FIELD_CLASS}
        />
        <button
          type="button"
          onClick={() =>
            setValueFields((current) =>
              current.filter((entry) => entry.id !== field.id),
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
