"use client";

import { quoteIdentifier } from "@/lib/utils/sql";
import { useCallback, useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  AlarmClock,
  Bell,
  BellRing,
  Loader2,
  ShieldAlert,
  Trash2,
} from "lucide-react";
import { runQuery } from "@/lib/duckdb/client";
import { formatNumber } from "@/lib/utils/formatters";
import type { ColumnProfile } from "@/types/dataset";

interface DataAlertsProps {
  tableName: string;
  columns: ColumnProfile[];
  rowCount: number;
}

type RuleType = "threshold" | "nulls" | "outliers";
type RuleCondition = ">" | "<" | "=" | "!=" | "contains";
type Severity = "info" | "warning" | "critical";
type AlertStatus = "active" | "snoozed" | "dismissed";
type Notice = { tone: "error" | "success"; message: string } | null;

interface AlertRule {
  id: string;
  type: RuleType;
  column: string;
  condition: RuleCondition;
  value: string;
  severity: Severity;
  baselineOutlierCount: number;
}

interface AlertEvent {
  id: string;
  ruleId: string;
  title: string;
  detail: string;
  severity: Severity;
  status: AlertStatus;
  signature: string;
  triggeredAt: number;
  snoozedUntil?: number;
}

const ease = [0.22, 1, 0.36, 1] as const;
const panelClass =
  "overflow-hidden rounded-[28px] border border-white/20 bg-white/75 shadow-[0_24px_90px_-48px_rgba(15,23,42,0.75)] backdrop-blur-2xl dark:border-white/10 dark:bg-slate-950/45";
const fieldClass =
  "w-full rounded-2xl border border-slate-200/70 bg-white/85 px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-cyan-400 focus:ring-4 focus:ring-cyan-500/10 dark:border-slate-700/70 dark:bg-slate-950/65 dark:text-slate-100";
const RULES_KEY = "datalens:alert-rules";
const EVENTS_KEY = "datalens:alert-events";
function quoteLiteral(value: string) {
  return `'${value.replace(/'/g, "''")}'`;
}

function makeId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function readStorage<T>(key: string, fallback: T) {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function writeStorage<T>(key: string, value: T) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(key, JSON.stringify(value));
}

function severityTone(severity: Severity) {
  return severity === "critical"
    ? "border-rose-400/40 bg-rose-500/10 text-rose-700 dark:text-rose-300"
    : severity === "warning"
      ? "border-amber-400/40 bg-amber-500/10 text-amber-700 dark:text-amber-300"
      : "border-cyan-400/40 bg-cyan-500/10 text-cyan-700 dark:text-cyan-300";
}

function buildThresholdClause(column: ColumnProfile, condition: RuleCondition, value: string) {
  const safeColumn = quoteIdentifier(column.name);
  if (condition === "contains") {
    return `${safeColumn} IS NOT NULL AND LOWER(CAST(${safeColumn} AS VARCHAR)) LIKE LOWER(${quoteLiteral(`%${value}%`)})`;
  }
  if (column.type === "number") {
    const numeric = Number(value);
    return `${safeColumn} ${condition} ${Number.isFinite(numeric) ? numeric : 0}`;
  }
  return `${safeColumn} ${condition} ${quoteLiteral(value)}`;
}

async function getOutlierCount(tableName: string, column: string) {
  const sql = `WITH stats AS (SELECT quantile_cont(${quoteIdentifier(column)}, 0.25) AS q1, quantile_cont(${quoteIdentifier(column)}, 0.75) AS q3 FROM ${quoteIdentifier(tableName)} WHERE ${quoteIdentifier(column)} IS NOT NULL), bounds AS (SELECT q1 - 1.5 * (q3 - q1) AS lower_bound, q3 + 1.5 * (q3 - q1) AS upper_bound FROM stats) SELECT COUNT(*) AS outlier_count FROM ${quoteIdentifier(tableName)}, bounds WHERE ${quoteIdentifier(column)} IS NOT NULL AND (${quoteIdentifier(column)} < lower_bound OR ${quoteIdentifier(column)} > upper_bound)`;
  const rows = await runQuery(sql);
  return Number(rows[0]?.outlier_count ?? 0);
}

export default function DataAlerts({ tableName, columns, rowCount }: DataAlertsProps) {
  const [rules, setRules] = useState<AlertRule[]>([]);
  const [events, setEvents] = useState<AlertEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);
  const [draft, setDraft] = useState<AlertRule>({
    id: "",
    type: "threshold",
    column: columns[0]?.name ?? "",
    condition: ">",
    value: "",
    severity: "warning",
    baselineOutlierCount: 0,
  });

  useEffect(() => {
    setRules(readStorage<AlertRule[]>(`${RULES_KEY}:${tableName}`, []));
    setEvents(readStorage<AlertEvent[]>(`${EVENTS_KEY}:${tableName}`, []));
  }, [tableName]);

  useEffect(() => {
    setDraft((current) => ({
      ...current,
      column: columns.some((column) => column.name === current.column) ? current.column : columns[0]?.name ?? "",
    }));
  }, [columns]);

  const activeAlerts = useMemo(
    () =>
      events.filter((event) => {
        if (event.status === "dismissed") return false;
        if (event.status === "snoozed" && (event.snoozedUntil ?? 0) > Date.now()) return false;
        return true;
      }),
    [events],
  );

  const evaluateRules = useCallback(async () => {
    setLoading(true);
    setNotice(null);
    try {
      const nextEvents = [...readStorage<AlertEvent[]>(`${EVENTS_KEY}:${tableName}`, [])];
      for (const rule of rules) {
        const column = columns.find((item) => item.name === rule.column);
        if (!column) continue;
        let signature = "";
        let title = "";
        let detail = "";

        if (rule.type === "threshold") {
          const clause = buildThresholdClause(column, rule.condition, rule.value);
          const rows = await runQuery(`SELECT COUNT(*) AS matched_count FROM ${quoteIdentifier(tableName)} WHERE ${clause}`);
          const matched = Number(rows[0]?.matched_count ?? 0);
          if (matched > 0) {
            signature = `threshold:${matched}`;
            title = `${column.name} crossed its threshold`;
            detail = `${formatNumber(matched)} rows matched ${column.name} ${rule.condition} ${rule.value}.`;
          }
        }

        if (rule.type === "nulls") {
          const rows = await runQuery(`SELECT COUNT(*) - COUNT(${quoteIdentifier(column.name)}) AS null_count FROM ${quoteIdentifier(tableName)}`);
          const nullCount = Number(rows[0]?.null_count ?? 0);
          const percent = rowCount > 0 ? (nullCount / rowCount) * 100 : 0;
          if (percent > Number(rule.value || 0)) {
            signature = `nulls:${nullCount}`;
            title = `${column.name} null rate is above target`;
            detail = `${percent.toFixed(1)}% of rows are null in ${column.name}, above the ${rule.value}% threshold.`;
          }
        }

        if (rule.type === "outliers" && column.type === "number") {
          const outlierCount = await getOutlierCount(tableName, column.name);
          if (outlierCount > rule.baselineOutlierCount) {
            signature = `outliers:${outlierCount}`;
            title = `New outliers detected in ${column.name}`;
            detail = `${formatNumber(outlierCount - rule.baselineOutlierCount)} more outliers were found than the saved baseline of ${formatNumber(rule.baselineOutlierCount)}.`;
          }
        }

        if (!signature) continue;
        const latest = nextEvents.find((event) => event.ruleId === rule.id);
        if (latest?.signature === signature && latest.status !== "dismissed") continue;
        nextEvents.unshift({
          id: makeId(),
          ruleId: rule.id,
          title,
          detail,
          severity: rule.severity,
          status: "active",
          signature,
          triggeredAt: Date.now(),
        });
      }

      setEvents(nextEvents.slice(0, 30));
      writeStorage(`${EVENTS_KEY}:${tableName}`, nextEvents.slice(0, 30));
      setNotice({ tone: "success", message: `Evaluated ${rules.length} alert rules.` });
    } catch (cause) {
      setNotice({ tone: "error", message: cause instanceof Error ? cause.message : "Alert evaluation failed." });
    } finally {
      setLoading(false);
    }
  }, [columns, rowCount, rules, tableName]);

  useEffect(() => {
    if (!rules.length) return;
    void evaluateRules();
  }, [evaluateRules, rules]);

  async function handleCreateRule() {
    const column = columns.find((item) => item.name === draft.column);
    if (!column) {
      setNotice({ tone: "error", message: "Select a valid column for the alert rule." });
      return;
    }
    let baselineOutlierCount = 0;
    if (draft.type === "outliers" && column.type === "number") {
      baselineOutlierCount = await getOutlierCount(tableName, column.name);
    }
    const nextRule: AlertRule = { ...draft, id: makeId(), baselineOutlierCount };
    const nextRules = [nextRule, ...rules];
    setRules(nextRules);
    writeStorage(`${RULES_KEY}:${tableName}`, nextRules);
    setDraft({ ...draft, value: "", baselineOutlierCount: 0 });
    setNotice({ tone: "success", message: "Alert rule saved and will be evaluated on data load." });
  }

  function updateEvent(eventId: string, patch: Partial<AlertEvent>) {
    const nextEvents = events.map((event) => (event.id === eventId ? { ...event, ...patch } : event));
    setEvents(nextEvents);
    writeStorage(`${EVENTS_KEY}:${tableName}`, nextEvents);
  }

  return (
    <motion.section initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.35, ease }} className={panelClass}>
      <div className="border-b border-white/15 px-6 py-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="space-y-2">
            <div className="inline-flex items-center gap-2 rounded-full border border-cyan-400/30 bg-cyan-500/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-cyan-700 dark:border-cyan-500/20 dark:text-cyan-300"><Bell className="h-3.5 w-3.5" />Data alerts</div>
            <h2 className="text-xl font-semibold text-slate-900 dark:text-white">Monitor {tableName} for data issues</h2>
            <p className="max-w-3xl text-sm leading-6 text-slate-600 dark:text-slate-300">Persist alert rules in localStorage, evaluate them against DuckDB on load, and keep active issues separate from historical events.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <div className="inline-flex items-center gap-2 rounded-full bg-rose-500/10 px-3 py-2 text-sm font-medium text-rose-700 dark:text-rose-300"><BellRing className="h-4 w-4" />{activeAlerts.length} active</div>
            <button type="button" onClick={() => void evaluateRules()} disabled={loading} className="inline-flex items-center gap-2 rounded-2xl bg-cyan-600 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-cyan-500 disabled:cursor-not-allowed disabled:opacity-60">{loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldAlert className="h-4 w-4" />}Evaluate alerts</button>
          </div>
        </div>
      </div>

      <div className="grid gap-6 px-6 py-6 xl:grid-cols-[0.85fr_1.15fr]">
        <div className="space-y-4">
          <div className="rounded-[26px] border border-slate-200/70 bg-white/65 p-5 dark:border-slate-800 dark:bg-slate-950/40">
            <p className="text-sm font-semibold text-slate-900 dark:text-white">Create alert rule</p>
            <div className="mt-4 grid gap-4 md:grid-cols-2">
              <select value={draft.type} onChange={(event) => setDraft({ ...draft, type: event.target.value as RuleType })} className={fieldClass}>
                <option value="threshold">Threshold match</option>
                <option value="nulls">Null percentage</option>
                <option value="outliers">New outliers</option>
              </select>
              <select value={draft.column} onChange={(event) => setDraft({ ...draft, column: event.target.value })} className={fieldClass}>{columns.map((column) => <option key={column.name} value={column.name}>{column.name}</option>)}</select>
              {draft.type === "threshold" && (
                <>
                  <select value={draft.condition} onChange={(event) => setDraft({ ...draft, condition: event.target.value as RuleCondition })} className={fieldClass}>
                    {[" >", "<", "=", "!=", "contains"].map((condition) => <option key={condition.trim()} value={condition.trim()}>{condition.trim()}</option>)}
                  </select>
                  <input value={draft.value} onChange={(event) => setDraft({ ...draft, value: event.target.value })} placeholder="Threshold value" className={fieldClass} />
                </>
              )}
              {draft.type === "nulls" && <input value={draft.value} onChange={(event) => setDraft({ ...draft, value: event.target.value })} placeholder="Null % threshold" className={`${fieldClass} md:col-span-2`} />}
              {draft.type === "outliers" && <div className="rounded-2xl border border-cyan-400/20 bg-cyan-500/10 px-4 py-3 text-sm text-cyan-900 dark:text-cyan-200 md:col-span-2">This rule compares future outlier counts against the saved baseline when you create it.</div>}
              <select value={draft.severity} onChange={(event) => setDraft({ ...draft, severity: event.target.value as Severity })} className={fieldClass}>
                <option value="info">Info</option>
                <option value="warning">Warning</option>
                <option value="critical">Critical</option>
              </select>
            </div>
            <button type="button" onClick={() => void handleCreateRule()} className="mt-4 inline-flex items-center gap-2 rounded-2xl bg-slate-900 px-4 py-2.5 text-sm font-medium text-white dark:bg-slate-100 dark:text-slate-900"><Bell className="h-4 w-4" />Add rule</button>
          </div>

          <div className="rounded-[26px] border border-slate-200/70 bg-slate-50/75 p-5 dark:border-slate-800 dark:bg-slate-950/35">
            <p className="text-sm font-semibold text-slate-900 dark:text-white">Saved rules</p>
            <div className="mt-4 space-y-3">
              {rules.length === 0 ? <p className="text-sm text-slate-500 dark:text-slate-400">No alert rules configured yet.</p> : rules.map((rule) => <div key={rule.id} className="flex flex-col gap-3 rounded-2xl border border-slate-200/70 bg-white/80 p-4 dark:border-slate-800 dark:bg-slate-950/45 lg:flex-row lg:items-center lg:justify-between"><div><p className="text-sm font-medium text-slate-900 dark:text-white">{rule.type === "threshold" ? `${rule.column} ${rule.condition} ${rule.value}` : rule.type === "nulls" ? `${rule.column} nulls > ${rule.value}%` : `${rule.column} new outliers`}</p><p className="text-xs text-slate-500 dark:text-slate-400">Severity: {rule.severity}</p></div><button type="button" onClick={() => { const nextRules = rules.filter((item) => item.id !== rule.id); setRules(nextRules); writeStorage(`${RULES_KEY}:${tableName}`, nextRules); }} className="rounded-xl border border-rose-300/60 px-3 py-2 text-sm text-rose-700 transition hover:bg-rose-500/10 dark:text-rose-300">Delete</button></div>)}
            </div>
          </div>
        </div>

        <div className="space-y-4">
          {notice && <div className={`rounded-2xl border px-4 py-3 text-sm ${notice.tone === "error" ? "border-rose-400/40 bg-rose-500/10 text-rose-700 dark:text-rose-300" : "border-emerald-400/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"}`}>{notice.message}</div>}

          <div className="rounded-[26px] border border-slate-200/70 bg-white/65 p-5 dark:border-slate-800 dark:bg-slate-950/40">
            <div className="flex items-center gap-2 text-sm font-semibold text-slate-900 dark:text-white"><BellRing className="h-4 w-4 text-rose-500" />Active alerts</div>
            <div className="mt-4 space-y-3">
              <AnimatePresence>
                {activeAlerts.length === 0 ? <p className="text-sm text-slate-500 dark:text-slate-400">No active alerts right now.</p> : activeAlerts.map((event) => <motion.div key={event.id} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} transition={{ duration: 0.22, ease }} className={`rounded-2xl border p-4 ${severityTone(event.severity)}`}><div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between"><div><p className="text-sm font-semibold">{event.title}</p><p className="mt-1 text-sm leading-6">{event.detail}</p><p className="mt-2 text-xs opacity-80">{new Date(event.triggeredAt).toLocaleString()}</p></div><div className="flex gap-2"><button type="button" onClick={() => updateEvent(event.id, { status: "snoozed", snoozedUntil: Date.now() + 60 * 60 * 1000 })} className="inline-flex items-center gap-2 rounded-xl border border-current/20 px-3 py-2 text-xs font-semibold"><AlarmClock className="h-3.5 w-3.5" />Snooze 1h</button><button type="button" onClick={() => updateEvent(event.id, { status: "dismissed" })} className="inline-flex items-center gap-2 rounded-xl border border-current/20 px-3 py-2 text-xs font-semibold"><Trash2 className="h-3.5 w-3.5" />Dismiss</button></div></div></motion.div>)}
              </AnimatePresence>
            </div>
          </div>

          <div className="rounded-[26px] border border-slate-200/70 bg-slate-50/75 p-5 dark:border-slate-800 dark:bg-slate-950/35">
            <div className="flex items-center gap-2 text-sm font-semibold text-slate-900 dark:text-white"><Bell className="h-4 w-4 text-cyan-500" />Alert history</div>
            <div className="mt-4 space-y-3">
              {events.length === 0 ? <p className="text-sm text-slate-500 dark:text-slate-400">No alert history yet.</p> : events.map((event) => <div key={event.id} className="rounded-2xl border border-slate-200/70 bg-white/80 p-4 dark:border-slate-800 dark:bg-slate-950/45"><div className="flex items-center justify-between gap-3"><p className="text-sm font-medium text-slate-900 dark:text-white">{event.title}</p><span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.12em] ${severityTone(event.severity)}`}>{event.status}</span></div><p className="mt-1 text-sm text-slate-600 dark:text-slate-300">{event.detail}</p><p className="mt-2 text-xs text-slate-500 dark:text-slate-400">{new Date(event.triggeredAt).toLocaleString()}</p></div>)}
            </div>
          </div>
        </div>
      </div>
    </motion.section>
  );
}
