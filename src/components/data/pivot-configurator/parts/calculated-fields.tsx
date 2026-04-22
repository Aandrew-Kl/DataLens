"use client";

import { Calculator, Plus, Trash2 } from "lucide-react";
import type { Dispatch, SetStateAction } from "react";

import { FIELD_CLASS, type CalculatedField } from "../types";

interface CalculatedFieldsPanelProps {
  calcName: string;
  setCalcName: Dispatch<SetStateAction<string>>;
  calcFormula: string;
  setCalcFormula: Dispatch<SetStateAction<string>>;
  calculatedFields: CalculatedField[];
  setCalculatedFields: Dispatch<SetStateAction<CalculatedField[]>>;
  onAdd: () => void;
}

export function CalculatedFieldsPanel({
  calcName,
  setCalcName,
  calcFormula,
  setCalcFormula,
  calculatedFields,
  setCalculatedFields,
  onAdd,
}: CalculatedFieldsPanelProps) {
  return (
    <div className="rounded-[1.6rem] border border-white/15 bg-white/45 p-4 dark:bg-slate-950/30">
      <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
        <Calculator className="h-3.5 w-3.5" />
        Calculated fields
      </div>
      <div className="mt-4 grid gap-2 md:grid-cols-[1fr_1.2fr_auto]">
        <input
          value={calcName}
          onChange={(event) => setCalcName(event.target.value)}
          placeholder="margin_pct"
          className={FIELD_CLASS}
        />
        <input
          value={calcFormula}
          onChange={(event) => setCalcFormula(event.target.value)}
          placeholder="sum_revenue / sum_cost"
          className={`${FIELD_CLASS} font-mono`}
        />
        <button
          type="button"
          onClick={onAdd}
          className="rounded-2xl bg-indigo-600 px-4 py-3 text-sm font-semibold text-white transition hover:bg-indigo-500"
        >
          <span className="flex items-center gap-2">
            <Plus className="h-4 w-4" />
            Add
          </span>
        </button>
      </div>
      <div className="mt-4 space-y-2">
        {calculatedFields.map((field) => (
          <div
            key={field.id}
            className="flex items-center justify-between gap-3 rounded-2xl border border-white/15 bg-white/55 px-4 py-3 dark:bg-slate-950/35"
          >
            <div>
              <div className="text-sm font-semibold text-slate-950 dark:text-white">
                {field.name}
              </div>
              <div className="mt-1 font-mono text-xs text-slate-500 dark:text-slate-400">
                {field.formula}
              </div>
            </div>
            <button
              type="button"
              onClick={() =>
                setCalculatedFields((current) =>
                  current.filter((entry) => entry.id !== field.id),
                )
              }
              className="rounded-full border border-rose-300/30 bg-rose-500/10 p-2 text-rose-700 dark:text-rose-300"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
