"use client";

import { Filter, Trash2 } from "lucide-react";
import type { Dispatch, SetStateAction } from "react";

import {
  FIELD_CLASS,
  type ConditionalOperator,
  type ConditionalRule,
} from "../types";

interface ConditionalRulesPanelProps {
  availableMeasures: string[];
  ruleMeasure: string;
  setRuleMeasure: Dispatch<SetStateAction<string>>;
  ruleOperator: ConditionalOperator;
  setRuleOperator: Dispatch<SetStateAction<ConditionalOperator>>;
  ruleValue: string;
  setRuleValue: Dispatch<SetStateAction<string>>;
  ruleSecondValue: string;
  setRuleSecondValue: Dispatch<SetStateAction<string>>;
  ruleColor: string;
  setRuleColor: Dispatch<SetStateAction<string>>;
  conditionalRules: ConditionalRule[];
  setConditionalRules: Dispatch<SetStateAction<ConditionalRule[]>>;
  onAdd: () => void;
}

export function ConditionalRulesPanel({
  availableMeasures,
  ruleMeasure,
  setRuleMeasure,
  ruleOperator,
  setRuleOperator,
  ruleValue,
  setRuleValue,
  ruleSecondValue,
  setRuleSecondValue,
  ruleColor,
  setRuleColor,
  conditionalRules,
  setConditionalRules,
  onAdd,
}: ConditionalRulesPanelProps) {
  return (
    <div className="rounded-[1.6rem] border border-white/15 bg-white/45 p-4 dark:bg-slate-950/30">
      <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
        <Filter className="h-3.5 w-3.5" />
        Conditional formatting
      </div>
      <div className="mt-4 grid gap-2 md:grid-cols-[1fr_auto_1fr_1fr_auto]">
        <select
          value={ruleMeasure}
          onChange={(event) => setRuleMeasure(event.target.value)}
          className={FIELD_CLASS}
        >
          <option value="__all__">All measures</option>
          {availableMeasures.map((measure) => (
            <option key={measure} value={measure}>
              {measure}
            </option>
          ))}
        </select>
        <select
          value={ruleOperator}
          onChange={(event) => setRuleOperator(event.target.value as ConditionalOperator)}
          className={FIELD_CLASS}
        >
          <option value="gt">Greater than</option>
          <option value="lt">Less than</option>
          <option value="between">Between</option>
        </select>
        <input
          value={ruleValue}
          onChange={(event) => setRuleValue(event.target.value)}
          placeholder="Threshold"
          className={FIELD_CLASS}
        />
        <input
          value={ruleSecondValue}
          onChange={(event) => setRuleSecondValue(event.target.value)}
          placeholder="Upper bound"
          className={`${FIELD_CLASS} ${ruleOperator === "between" ? "" : "opacity-60"}`}
          disabled={ruleOperator !== "between"}
        />
        <div className="flex items-center gap-2 rounded-2xl border border-white/20 bg-white/60 px-3 py-2 dark:bg-slate-950/45">
          <input
            type="color"
            value={ruleColor}
            onChange={(event) => setRuleColor(event.target.value)}
            className="h-8 w-10 rounded border-0 bg-transparent"
          />
          <button
            type="button"
            onClick={onAdd}
            className="rounded-2xl bg-cyan-600 px-3 py-2 text-sm font-semibold text-white transition hover:bg-cyan-500"
          >
            Add
          </button>
        </div>
      </div>
      <div className="mt-4 space-y-2">
        {conditionalRules.map((rule) => (
          <div
            key={rule.id}
            className="flex items-center justify-between gap-3 rounded-2xl border border-white/15 bg-white/55 px-4 py-3 dark:bg-slate-950/35"
          >
            <div className="text-sm text-slate-600 dark:text-slate-300">
              <span className="font-semibold text-slate-950 dark:text-white">
                {rule.measure === "__all__" ? "All measures" : rule.measure}
              </span>{" "}
              {rule.operator === "gt"
                ? `> ${rule.value}`
                : rule.operator === "lt"
                  ? `< ${rule.value}`
                  : `between ${rule.value} and ${rule.secondValue}`}
            </div>
            <div className="flex items-center gap-3">
              <span
                className="h-5 w-5 rounded-full border border-white/20"
                style={{ backgroundColor: rule.color }}
              />
              <button
                type="button"
                onClick={() =>
                  setConditionalRules((current) =>
                    current.filter((entry) => entry.id !== rule.id),
                  )
                }
                className="rounded-full border border-rose-300/30 bg-rose-500/10 p-2 text-rose-700 dark:text-rose-300"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
