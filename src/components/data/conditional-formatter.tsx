"use client";

import { Suspense, use, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { ArrowDown, ArrowUp, Download, Paintbrush } from "lucide-react";
import { runQuery } from "@/lib/duckdb/client";
import {
  ANALYTICS_EASE,
  BUTTON_CLASS,
  FIELD_CLASS,
  GLASS_CARD_CLASS,
  GLASS_PANEL_CLASS,
  quoteIdentifier,
} from "@/lib/utils/advanced-analytics";
import { downloadFile } from "@/lib/utils/export";
import type { ColumnProfile } from "@/types/dataset";

interface ConditionalFormatterProps {
  tableName: string;
  columns: ColumnProfile[];
}

type RuleOperator = "contains" | "equals" | "greater-than" | "less-than" | "is-null";
type RuleStyle = "highlight" | "success" | "warning" | "danger";

interface FormatRule {
  id: string;
  columnName: string;
  operator: RuleOperator;
  value: string;
  style: RuleStyle;
}

interface ConditionalFormatterReadyProps extends ConditionalFormatterProps {
  promise: Promise<Record<string, unknown>[]>;
}

const STYLE_CLASS_MAP: Record<RuleStyle, string> = {
  highlight: "bg-cyan-500/15 text-cyan-800 dark:text-cyan-200",
  success: "bg-emerald-500/15 text-emerald-800 dark:text-emerald-200",
  warning: "bg-amber-500/15 text-amber-900 dark:text-amber-200",
  danger: "bg-rose-500/15 text-rose-900 dark:text-rose-200",
};

function createRule(columnName: string): FormatRule {
  return {
    id: `rule-${Math.random().toString(36).slice(2, 8)}`,
    columnName,
    operator: "contains",
    value: "",
    style: "highlight",
  };
}

function stringValue(value: unknown) {
  if (value === null || value === undefined) return "";
  return String(value);
}

function numberValue(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function matchesRule(value: unknown, rule: FormatRule) {
  if (rule.operator === "is-null") {
    return value === null || value === undefined || String(value).trim() === "";
  }

  const candidate = stringValue(value).toLowerCase();
  const expected = rule.value.toLowerCase();

  if (rule.operator === "contains") {
    return expected !== "" && candidate.includes(expected);
  }

  if (rule.operator === "equals") {
    return candidate === expected;
  }

  const candidateNumber = numberValue(value);
  const expectedNumber = numberValue(rule.value);
  if (candidateNumber === null || expectedNumber === null) {
    return false;
  }

  if (rule.operator === "greater-than") {
    return candidateNumber > expectedNumber;
  }

  return candidateNumber < expectedNumber;
}

function findMatchingRule(
  value: unknown,
  columnName: string,
  rules: FormatRule[],
) {
  return rules.find((rule) => rule.columnName === columnName && matchesRule(value, rule)) ?? null;
}

async function loadPreviewRows(tableName: string) {
  return runQuery(`SELECT * FROM ${quoteIdentifier(tableName)} LIMIT 12`);
}

function FormatterLoadingState() {
  return (
    <div className={`${GLASS_CARD_CLASS} flex min-h-[20rem] items-center justify-center p-6 text-sm text-slate-600 dark:text-slate-300`}>
      Loading preview rows…
    </div>
  );
}

function ConditionalFormatterReady({
  columns,
  promise,
}: ConditionalFormatterReadyProps) {
  const rows = use(promise);
  const [rules, setRules] = useState<FormatRule[]>([
    createRule(columns[0]?.name ?? ""),
  ]);

  function updateRule(id: string, patch: Partial<FormatRule>) {
    setRules((current) =>
      current.map((rule) => (rule.id === id ? { ...rule, ...patch } : rule)),
    );
  }

  function moveRule(id: string, direction: -1 | 1) {
    setRules((current) => {
      const index = current.findIndex((rule) => rule.id === id);
      const nextIndex = index + direction;
      if (index < 0 || nextIndex < 0 || nextIndex >= current.length) {
        return current;
      }

      const next = [...current];
      const [item] = next.splice(index, 1);
      next.splice(nextIndex, 0, item);
      return next;
    });
  }

  function addRule() {
    setRules((current) => [...current, createRule(columns[0]?.name ?? "")]);
  }

  function handleExport() {
    downloadFile(
      JSON.stringify(rules, null, 2),
      "conditional-formatting-rules.json",
      "application/json;charset=utf-8;",
    );
  }

  const headers = Object.keys(rows[0] ?? {});

  return (
    <div className="grid gap-6 xl:grid-cols-[0.9fr_1.1fr]">
      <div className={`${GLASS_CARD_CLASS} p-5`}>
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400">
              Rule stack
            </div>
            <div className="mt-1 text-sm text-slate-600 dark:text-slate-300">
              Earlier rules win when multiple conditions match the same cell.
            </div>
          </div>
          <button type="button" className={BUTTON_CLASS} onClick={handleExport}>
            <Download className="h-4 w-4" />
            Export rules JSON
          </button>
        </div>
        <div className="mt-4 space-y-4">
          {rules.map((rule, index) => (
            <div key={rule.id} className="rounded-3xl bg-slate-950/5 p-4 dark:bg-white/5">
              <div className="flex items-center justify-between gap-3">
                <div className="text-sm font-semibold text-slate-950 dark:text-white">
                  Priority {index + 1}
                </div>
                <div className="flex gap-2">
                  <button type="button" className={BUTTON_CLASS} onClick={() => moveRule(rule.id, -1)}>
                    <ArrowUp className="h-4 w-4" />
                  </button>
                  <button type="button" className={BUTTON_CLASS} onClick={() => moveRule(rule.id, 1)}>
                    <ArrowDown className="h-4 w-4" />
                  </button>
                </div>
              </div>
              <div className="mt-4 grid gap-3">
                <select
                  className={FIELD_CLASS}
                  value={rule.columnName}
                  onChange={(event) => updateRule(rule.id, { columnName: event.target.value })}
                >
                  {columns.map((column) => (
                    <option key={column.name} value={column.name}>
                      {column.name}
                    </option>
                  ))}
                </select>
                <select
                  className={FIELD_CLASS}
                  value={rule.operator}
                  onChange={(event) => updateRule(rule.id, { operator: event.target.value as RuleOperator })}
                >
                  <option value="contains">contains</option>
                  <option value="equals">equals</option>
                  <option value="greater-than">greater than</option>
                  <option value="less-than">less than</option>
                  <option value="is-null">is null</option>
                </select>
                <input
                  className={FIELD_CLASS}
                  value={rule.value}
                  onChange={(event) => updateRule(rule.id, { value: event.target.value })}
                  placeholder="Comparison value"
                  disabled={rule.operator === "is-null"}
                />
                <select
                  className={FIELD_CLASS}
                  value={rule.style}
                  onChange={(event) => updateRule(rule.id, { style: event.target.value as RuleStyle })}
                >
                  <option value="highlight">highlight</option>
                  <option value="success">success</option>
                  <option value="warning">warning</option>
                  <option value="danger">danger</option>
                </select>
              </div>
            </div>
          ))}
          <button type="button" className={BUTTON_CLASS} onClick={addRule}>
            Add rule
          </button>
        </div>
      </div>

      <div className={`${GLASS_CARD_CLASS} p-5`}>
        <div className="mb-4 text-xs font-semibold uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400">
          Formatted preview
        </div>
        <div className="overflow-hidden rounded-3xl border border-white/20">
          <table className="min-w-full text-left text-sm text-slate-700 dark:text-slate-200">
            <thead className="bg-slate-950/5 text-xs uppercase tracking-[0.16em] text-slate-500 dark:bg-white/5 dark:text-slate-400">
              <tr>
                {headers.map((header) => (
                  <th key={header} className="px-4 py-3">{header}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, rowIndex) => (
                <tr key={`row-${rowIndex}`} className="border-t border-white/15">
                  {headers.map((header) => {
                    const match = findMatchingRule(row[header], header, rules);
                    return (
                      <td
                        key={`${rowIndex}-${header}`}
                        data-testid={`cell-${rowIndex}-${header}`}
                        className={`px-4 py-3 transition ${
                          match ? STYLE_CLASS_MAP[match.style] : ""
                        }`}
                      >
                        {stringValue(row[header])}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

export default function ConditionalFormatter({
  tableName,
  columns,
}: ConditionalFormatterProps) {
  const promise = useMemo(() => loadPreviewRows(tableName), [tableName]);

  return (
    <motion.section
      initial={{ opacity: 0, y: 18 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.28, ease: ANALYTICS_EASE }}
      className={`${GLASS_PANEL_CLASS} p-6`}
    >
      <div className="mb-6">
        <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.22em] text-cyan-700 dark:text-cyan-300">
          <Paintbrush className="h-4 w-4" />
          Conditional Formatter
        </div>
        <h2 className="mt-2 text-2xl font-semibold text-slate-950 dark:text-white">
          Apply rule-based styling to preview rows
        </h2>
      </div>

      <Suspense fallback={<FormatterLoadingState />}>
        <ConditionalFormatterReady tableName={tableName} columns={columns} promise={promise} />
      </Suspense>
    </motion.section>
  );
}
