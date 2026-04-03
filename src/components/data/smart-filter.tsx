"use client";

import { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import {
  Filter,
  History,
  Loader2,
  Save,
  Search,
  Sparkles,
  Wand2,
} from "lucide-react";
import { useLocalStorage } from "@/hooks/use-local-storage";
import { runQuery } from "@/lib/duckdb/client";
import type { ColumnProfile } from "@/types/dataset";

interface SmartFilterProps {
  tableName: string;
  columns: ColumnProfile[];
  onFilterApplied?: (sql: string) => void;
}

interface SavedFilter {
  name: string;
  text: string;
  specialSql?: string;
}

const EASE = [0.16, 1, 0.3, 1] as const;
const HISTORY_KEY = "datalens:smart-filter:history";
const SAVED_KEY = "datalens:smart-filter:saved";

function quoteId(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

function normalize(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function resolveColumn(columns: ColumnProfile[], raw: string): ColumnProfile | null {
  return columns.find((column) => normalize(column.name) === normalize(raw.trim())) ?? null;
}

function literal(column: ColumnProfile, rawValue: string): string | null {
  const value = rawValue.trim().replace(/^["']|["']$/g, "");
  if (column.type === "number") return Number.isFinite(Number(value)) ? String(Number(value)) : null;
  if (column.type === "boolean") {
    if (/^(true|1|yes)$/i.test(value)) return "TRUE";
    if (/^(false|0|no)$/i.test(value)) return "FALSE";
    return null;
  }
  return `'${value.replaceAll("'", "''")}'`;
}

function parseFilterText(text: string, columns: ColumnProfile[]) {
  const trimmed = text.trim();
  if (!trimmed) return { whereClause: "", activeColumn: null as string | null, error: null as string | null };
  const tokens = trimmed.split(/\s+(and|or)\s+/i);
  const clauses: string[] = [];
  const connectors: string[] = [];
  let activeColumn: string | null = null;

  for (let index = 0; index < tokens.length; index += 2) {
    const segment = tokens[index]?.trim();
    const connector = tokens[index + 1]?.toUpperCase();
    const match = segment?.match(/^(.+?)\s+(is not null|is null|contains|starts with|ends with|>=|<=|!=|=|>|<)\s*(.*)$/i);
    if (!segment || !match) return { whereClause: "", activeColumn, error: `Could not parse "${segment ?? trimmed}".` };
    const column = resolveColumn(columns, match[1]);
    if (!column) return { whereClause: "", activeColumn, error: `Unknown column "${match[1]}".` };
    activeColumn = column.name;
    const operator = match[2].toLowerCase();
    const value = match[3] ?? "";
    const field = quoteId(column.name);
    if (operator === "is null") clauses.push(`${field} IS NULL`);
    else if (operator === "is not null") clauses.push(`${field} IS NOT NULL`);
    else if (operator === "contains") clauses.push(`CAST(${field} AS VARCHAR) ILIKE '%${value.replaceAll("'", "''").trim()}%'`);
    else if (operator === "starts with") clauses.push(`CAST(${field} AS VARCHAR) ILIKE '${value.replaceAll("'", "''").trim()}%'`);
    else if (operator === "ends with") clauses.push(`CAST(${field} AS VARCHAR) ILIKE '%${value.replaceAll("'", "''").trim()}'`);
    else {
      const parsed = literal(column, value);
      if (parsed === null) return { whereClause: "", activeColumn, error: `Value "${value}" is invalid for ${column.name}.` };
      clauses.push(`${field} ${operator} ${parsed}`);
    }
    if (connector) connectors.push(connector);
  }

  return {
    whereClause: clauses.reduce((sql, clause, index) => sql + (index === 0 ? clause : ` ${connectors[index - 1] ?? "AND"} ${clause}`), ""),
    activeColumn,
    error: null,
  };
}

function replaceCurrentFragment(text: string, suggestion: string): string {
  return text.replace(/([A-Za-z0-9_]+)?$/, suggestion);
}

export default function SmartFilter({ tableName, columns, onFilterApplied }: SmartFilterProps) {
  const [text, setText] = useState("");
  const [specialSql, setSpecialSql] = useState<string | null>(null);
  const [previewCount, setPreviewCount] = useState<number | null>(null);
  const [valueSuggestions, setValueSuggestions] = useState<string[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [history, setHistory] = useLocalStorage<string[]>(`${HISTORY_KEY}:${tableName}`, []);
  const [saved, setSaved] = useLocalStorage<SavedFilter[]>(`${SAVED_KEY}:${tableName}`, []);
  const parsed = useMemo(() => parseFilterText(text, columns), [columns, text]);
  const columnSuggestions = useMemo(() => {
    const fragment = text.split(/\s+/).at(-1)?.trim() ?? "";
    if (!fragment) return columns.slice(0, 8).map((column) => column.name);
    return columns.filter((column) => normalize(column.name).includes(normalize(fragment))).slice(0, 8).map((column) => column.name);
  }, [columns, text]);

  useEffect(() => {
    let cancelled = false;
    async function loadValueSuggestions() {
      if (!parsed.activeColumn) return setValueSuggestions([]);
      try {
        const rows = await runQuery(`
          SELECT CAST(${quoteId(parsed.activeColumn)} AS VARCHAR) AS value
          FROM ${quoteId(tableName)}
          WHERE ${quoteId(parsed.activeColumn)} IS NOT NULL
          GROUP BY 1
          ORDER BY COUNT(*) DESC, 1 ASC
          LIMIT 20
        `);
        if (!cancelled) setValueSuggestions(rows.map((row) => String(row.value ?? "")));
      } catch {
        if (!cancelled) setValueSuggestions([]);
      }
    }
    void loadValueSuggestions();
    return () => { cancelled = true; };
  }, [parsed.activeColumn, tableName]);

  useEffect(() => {
    let cancelled = false;
    const handle = window.setTimeout(async () => {
      if (parsed.error) return setPreviewCount(null);
      try {
        const sql = specialSql
          ? `SELECT COUNT(*) AS row_count FROM (${specialSql}) AS filtered`
          : `SELECT COUNT(*) AS row_count FROM ${quoteId(tableName)}${parsed.whereClause ? ` WHERE ${parsed.whereClause}` : ""}`;
        const rows = await runQuery(sql);
        if (!cancelled) setPreviewCount(Number(rows[0]?.row_count ?? 0));
      } catch {
        if (!cancelled) setPreviewCount(null);
      }
    }, 250);
    return () => { cancelled = true; window.clearTimeout(handle); };
  }, [parsed.error, parsed.whereClause, specialSql, tableName]);

  function applyFilter(sql: string, label: string) {
    onFilterApplied?.(sql);
    setHistory((current) => [label, ...current.filter((entry) => entry !== label)].slice(0, 8));
    setNotice("Filter SQL pushed to the parent callback.");
  }

  function quickFilter(kind: "top" | "bottom" | "nulls" | "nonnulls" | "outliers") {
    const numeric = columns.find((column) => column.type === "number");
    const focus = resolveColumn(columns, parsed.activeColumn ?? "") ?? columns[0];
    if (!focus) return;
    setSpecialSql(
      kind === "top" && numeric ? `SELECT * FROM ${quoteId(tableName)} WHERE ${quoteId(numeric.name)} IS NOT NULL ORDER BY ${quoteId(numeric.name)} DESC LIMIT 100`
      : kind === "bottom" && numeric ? `SELECT * FROM ${quoteId(tableName)} WHERE ${quoteId(numeric.name)} IS NOT NULL ORDER BY ${quoteId(numeric.name)} ASC LIMIT 100`
      : kind === "nulls" ? `SELECT * FROM ${quoteId(tableName)} WHERE ${quoteId(focus.name)} IS NULL`
      : kind === "nonnulls" ? `SELECT * FROM ${quoteId(tableName)} WHERE ${quoteId(focus.name)} IS NOT NULL`
      : numeric ? `WITH bounds AS (SELECT QUANTILE_CONT(${quoteId(numeric.name)}, 0.25) AS q1, QUANTILE_CONT(${quoteId(numeric.name)}, 0.75) AS q3 FROM ${quoteId(tableName)} WHERE ${quoteId(numeric.name)} IS NOT NULL) SELECT * FROM ${quoteId(tableName)}, bounds WHERE ${quoteId(numeric.name)} < q1 - 1.5 * (q3 - q1) OR ${quoteId(numeric.name)} > q3 + 1.5 * (q3 - q1)`
      : null,
    );
    setText("");
  }

  async function handleApply() {
    setBusy(true);
    try {
      const sql = specialSql ?? `SELECT * FROM ${quoteId(tableName)}${parsed.whereClause ? ` WHERE ${parsed.whereClause}` : ""}`;
      applyFilter(sql, specialSql ? "quick filter" : text);
    } finally {
      setBusy(false);
    }
  }

  function handleSaveCurrent() {
    const name = window.prompt("Saved filter name", parsed.whereClause ? text : "quick filter");
    if (!name) return;
    setSaved((current) => [{ name, text, specialSql: specialSql ?? undefined }, ...current].slice(0, 12));
    setNotice(`Saved "${name}" for ${tableName}.`);
  }

  return (
    <section className="overflow-hidden rounded-[30px] border border-white/15 bg-[radial-gradient(circle_at_top_right,rgba(14,165,233,0.15),transparent_24%),linear-gradient(135deg,rgba(248,250,252,0.92),rgba(226,232,240,0.78))] shadow-[0_30px_120px_-50px_rgba(15,23,42,0.9)] dark:border-white/10 dark:bg-[radial-gradient(circle_at_top_right,rgba(14,165,233,0.16),transparent_24%),linear-gradient(135deg,rgba(2,6,23,0.95),rgba(15,23,42,0.88))]">
      <div className="border-b border-white/10 px-6 py-5">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full border border-sky-400/20 bg-sky-500/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.22em] text-sky-700 dark:text-sky-300"><Sparkles className="h-3.5 w-3.5" />Smart Filter</div>
            <h2 className="mt-3 text-2xl font-semibold tracking-tight text-slate-950 dark:text-slate-50">Natural-language-like DuckDB filtering</h2>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600 dark:text-slate-300">Type filters like <span className="font-mono">revenue &gt; 1000 and region = East</span>, inspect live row counts, then push SQL upstream.</p>
          </div>
          <div className="rounded-3xl border border-white/10 bg-white/10 px-4 py-3 backdrop-blur-xl dark:bg-slate-950/45">
            <div className="text-xs uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">Preview row count</div>
            <div className="mt-2 text-xl font-semibold text-slate-950 dark:text-slate-50">{previewCount === null ? "—" : previewCount.toLocaleString()}</div>
          </div>
        </div>
      </div>

      <div className="grid gap-5 px-6 py-6 xl:grid-cols-[1.08fr_0.92fr]">
        <div className="space-y-5">
          <div className="rounded-3xl border border-white/15 bg-white/10 p-5 backdrop-blur-xl dark:border-white/10 dark:bg-slate-950/45">
            <div className="mb-4 flex items-center gap-2 text-slate-900 dark:text-slate-100"><Filter className="h-4 w-4 text-sky-600 dark:text-sky-300" />Filter builder</div>
            <textarea value={text} onChange={(event) => { setText(event.target.value); setSpecialSql(null); }} rows={4} placeholder="revenue > 1000 and region = East" className="w-full rounded-2xl border border-white/10 bg-white/40 px-4 py-3 dark:bg-slate-950/40" />
            <div className="mt-3 flex flex-wrap gap-2">
              {["revenue > 1000 and region = East", "status is not null", "country contains US or country contains CA"].map((example) => (
                <button key={example} type="button" onClick={() => { setText(example); setSpecialSql(null); }} className="rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-slate-500 dark:text-slate-400">
                  {example}
                </button>
              ))}
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              {columnSuggestions.map((suggestion) => (
                <button key={suggestion} type="button" onClick={() => setText((current) => replaceCurrentFragment(current, suggestion))} className="rounded-full border border-white/10 bg-white/10 px-3 py-1.5 text-xs font-semibold text-slate-600 dark:text-slate-300">
                  <Search className="mr-1 inline h-3 w-3" />{suggestion}
                </button>
              ))}
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              {valueSuggestions.map((value) => (
                <button key={value} type="button" onClick={() => setText((current) => `${current.trim()} ${value}`.trim())} className="rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-slate-500 dark:text-slate-400">
                  {value}
                </button>
              ))}
            </div>
            <div className="mt-4 flex flex-wrap gap-3">
              <button type="button" onClick={() => void handleApply()} disabled={busy || Boolean(parsed.error)} className="inline-flex items-center gap-2 rounded-2xl border border-sky-400/20 bg-sky-500/10 px-4 py-3 text-sm font-medium text-sky-800 disabled:opacity-60 dark:text-sky-200">
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wand2 className="h-4 w-4" />}Apply filter
              </button>
              <button type="button" onClick={handleSaveCurrent} className="inline-flex items-center gap-2 rounded-2xl border border-white/10 bg-white/10 px-4 py-3 text-sm text-slate-700 dark:text-slate-200">
                <Save className="h-4 w-4" />Save filter
              </button>
            </div>
            <p className="mt-3 text-sm leading-6 text-slate-600 dark:text-slate-300">
              Parser rules: use <span className="font-mono text-slate-900 dark:text-slate-100">and</span> / <span className="font-mono text-slate-900 dark:text-slate-100">or</span> between clauses, and operators such as <span className="font-mono text-slate-900 dark:text-slate-100">=</span>, <span className="font-mono text-slate-900 dark:text-slate-100">&gt;=</span>, <span className="font-mono text-slate-900 dark:text-slate-100">contains</span>, or <span className="font-mono text-slate-900 dark:text-slate-100">is null</span>.
            </p>
            <p className="mt-2 text-sm leading-6 text-slate-600 dark:text-slate-300">
              Value suggestions come from the top 20 distinct DuckDB results for the last parsed column, which makes quick category filters much faster to compose.
            </p>


            <div className="mt-4 rounded-2xl border border-white/10 bg-slate-950/85 p-4 text-xs leading-6 text-cyan-200">{parsed.error ? `-- ${parsed.error}` : specialSql ?? `SELECT * FROM ${quoteId(tableName)}${parsed.whereClause ? ` WHERE ${parsed.whereClause}` : ""}`}</div>

          </div>

          <div className="rounded-3xl border border-white/15 bg-white/10 p-5 backdrop-blur-xl dark:border-white/10 dark:bg-slate-950/45">
            <div className="mb-4 flex items-center gap-2 text-slate-900 dark:text-slate-100"><Sparkles className="h-4 w-4 text-sky-600 dark:text-sky-300" />Quick filters</div>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {[
                ["top", "Top 100"],
                ["bottom", "Bottom 100"],
                ["nulls", "Nulls only"],
                ["nonnulls", "Non-nulls only"],
                ["outliers", "Outliers only"],
              ].map(([kind, label]) => (
                <motion.button key={kind} type="button" whileHover={{ y: -2 }} transition={{ duration: 0.2, ease: EASE }} onClick={() => quickFilter(kind as "top" | "bottom" | "nulls" | "nonnulls" | "outliers")} className="rounded-2xl border border-white/10 bg-white/10 px-4 py-3 text-left text-sm text-slate-600 dark:text-slate-300">
                  {label}
                </motion.button>
              ))}
            </div>
          </div>
        </div>

        <div className="space-y-5">
          <div className="rounded-3xl border border-white/15 bg-white/10 p-5 backdrop-blur-xl dark:border-white/10 dark:bg-slate-950/45">
            <div className="mb-4 flex items-center gap-2 text-slate-900 dark:text-slate-100"><History className="h-4 w-4 text-sky-600 dark:text-sky-300" />Recent filters</div>
            <div className="space-y-3">
              {history.map((entry) => (
                <button key={entry} type="button" onClick={() => { setText(entry); setSpecialSql(null); }} className="w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-left text-sm text-slate-600 dark:text-slate-300">{entry}</button>
              ))}
            </div>
          </div>

          <div className="rounded-3xl border border-white/15 bg-white/10 p-5 backdrop-blur-xl dark:border-white/10 dark:bg-slate-950/45">
            <div className="mb-4 flex items-center gap-2 text-slate-900 dark:text-slate-100"><Save className="h-4 w-4 text-sky-600 dark:text-sky-300" />Saved filters</div>
            <div className="space-y-3">
              {saved.map((entry) => (
                <button key={entry.name} type="button" onClick={() => { setText(entry.text); setSpecialSql(entry.specialSql ?? null); }} className="w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-left text-sm text-slate-600 dark:text-slate-300">
                  <div className="font-semibold text-slate-900 dark:text-slate-100">{entry.name}</div>
                  <div className="mt-1 truncate">{entry.specialSql ?? entry.text}</div>
                </button>
              ))}
            </div>
          </div>

          {notice ? <div className="rounded-2xl border border-sky-400/20 bg-sky-500/10 px-4 py-3 text-sm text-sky-800 dark:text-sky-200">{notice}</div> : null}
        </div>
      </div>
    </section>
  );
}
