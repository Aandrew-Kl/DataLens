"use client";

import { startTransition, useMemo, useState } from "react";
import { motion } from "framer-motion";
import {
  Download,
  Loader2,
  ShoppingBasket,
  Sigma,
  TrendingUp,
} from "lucide-react";
import { runQuery } from "@/lib/duckdb/client";
import {
  ANALYTICS_EASE,
  BUTTON_CLASS,
  FIELD_CLASS,
  GLASS_CARD_CLASS,
  GLASS_PANEL_CLASS,
  isRecord,
  quoteIdentifier,
} from "@/lib/utils/advanced-analytics";
import { downloadFile } from "@/lib/utils/export";
import { formatNumber, formatPercent } from "@/lib/utils/formatters";
import type { ColumnProfile } from "@/types/dataset";

interface AssociationRulesProps {
  tableName: string;
  columns: ColumnProfile[];
}

interface BasketRow {
  transactionId: string;
  item: string;
}

interface AssociationRule {
  antecedent: string;
  consequent: string;
  support: number;
  confidence: number;
  lift: number;
  pairCount: number;
}

interface SummaryCardProps {
  label: string;
  value: string;
  icon: typeof Sigma;
}

function isBasketRow(value: unknown): value is Record<string, unknown> {
  return isRecord(value);
}

function csvEscape(value: unknown) {
  const text = String(value ?? "");
  return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function buildTransactions(rows: BasketRow[]) {
  const baskets = new Map<string, Set<string>>();

  rows.forEach((row) => {
    const current = baskets.get(row.transactionId) ?? new Set<string>();
    current.add(row.item);
    baskets.set(row.transactionId, current);
  });

  return baskets;
}

function mineRules(rows: BasketRow[]): AssociationRule[] {
  const baskets = buildTransactions(rows);
  const transactionCount = baskets.size;

  if (transactionCount === 0) {
    return [];
  }

  const itemCounts = new Map<string, number>();
  const pairCounts = new Map<string, number>();

  baskets.forEach((items) => {
    const values = Array.from(items).sort((left, right) => left.localeCompare(right));

    values.forEach((item) => {
      itemCounts.set(item, (itemCounts.get(item) ?? 0) + 1);
    });

    values.forEach((antecedent) => {
      values.forEach((consequent) => {
        if (antecedent === consequent) return;
        const key = `${antecedent}\u0000${consequent}`;
        pairCounts.set(key, (pairCounts.get(key) ?? 0) + 1);
      });
    });
  });

  return Array.from(pairCounts.entries())
    .map(([key, pairCount]) => {
      const [antecedent, consequent] = key.split("\u0000");
      const antecedentCount = itemCounts.get(antecedent) ?? 0;
      const consequentCount = itemCounts.get(consequent) ?? 0;
      const support = pairCount / transactionCount;
      const confidence = antecedentCount === 0 ? 0 : pairCount / antecedentCount;
      const consequentSupport = consequentCount / transactionCount;
      const lift = consequentSupport === 0 ? 0 : confidence / consequentSupport;

      return {
        antecedent,
        consequent,
        support,
        confidence,
        lift,
        pairCount,
      } satisfies AssociationRule;
    })
    .sort(
      (left, right) =>
        right.lift - left.lift ||
        right.confidence - left.confidence ||
        right.support - left.support,
    );
}

async function loadBasketRows(
  tableName: string,
  transactionColumn: string,
  itemColumn: string,
): Promise<BasketRow[]> {
  const rows = await runQuery(`
    SELECT
      CAST(${quoteIdentifier(transactionColumn)} AS VARCHAR) AS transaction_id,
      CAST(${quoteIdentifier(itemColumn)} AS VARCHAR) AS item_value
    FROM ${quoteIdentifier(tableName)}
    WHERE ${quoteIdentifier(transactionColumn)} IS NOT NULL
      AND ${quoteIdentifier(itemColumn)} IS NOT NULL
  `);

  return rows
    .filter(isBasketRow)
    .map((row) => {
      const transactionId = row.transaction_id;
      const item = row.item_value;

      if (
        (typeof transactionId !== "string" && typeof transactionId !== "number") ||
        (typeof item !== "string" && typeof item !== "number")
      ) {
        return null;
      }

      return {
        transactionId: String(transactionId),
        item: String(item),
      } satisfies BasketRow;
    })
    .filter((row): row is BasketRow => row !== null);
}

function SummaryCard({ label, value, icon: Icon }: SummaryCardProps) {
  return (
    <div className={`${GLASS_CARD_CLASS} p-4`}>
      <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
        <Icon className="h-3.5 w-3.5" />
        {label}
      </div>
      <p className="mt-3 text-xl font-semibold text-slate-950 dark:text-white">
        {value}
      </p>
    </div>
  );
}

export default function AssociationRules({
  tableName,
  columns,
}: AssociationRulesProps) {
  const transactionColumns = useMemo(
    () => columns.filter((column) => column.type !== "unknown"),
    [columns],
  );
  const itemColumns = useMemo(
    () =>
      columns.filter(
        (column) => column.type === "string" || column.type === "boolean",
      ),
    [columns],
  );
  const [selectedTransactionColumn, setSelectedTransactionColumn] = useState("");
  const [selectedItemColumn, setSelectedItemColumn] = useState("");
  const [minSupport, setMinSupport] = useState(5);
  const [rules, setRules] = useState<AssociationRule[]>([]);
  const [transactionCount, setTransactionCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  const activeTransactionColumn =
    transactionColumns.find((column) => column.name === selectedTransactionColumn)
      ?.name ??
    transactionColumns[0]?.name ??
    "";
  const activeItemColumn =
    itemColumns.find((column) => column.name === selectedItemColumn)?.name ??
    itemColumns[0]?.name ??
    "";

  const filteredRules = useMemo(
    () => rules.filter((rule) => rule.support * 100 >= minSupport).slice(0, 18),
    [minSupport, rules],
  );
  const averageLift = useMemo(() => {
    if (filteredRules.length === 0) return 0;
    return (
      filteredRules.reduce((sum, rule) => sum + rule.lift, 0) / filteredRules.length
    );
  }, [filteredRules]);

  async function handleMineRules() {
    if (!activeTransactionColumn || !activeItemColumn) {
      setStatus("Choose both a transaction column and an item column.");
      return;
    }

    setLoading(true);
    setStatus(null);

    try {
      const rows = await loadBasketRows(
        tableName,
        activeTransactionColumn,
        activeItemColumn,
      );
      const nextRules = mineRules(rows);
      const nextTransactionCount = buildTransactions(rows).size;

      startTransition(() => {
        setRules(nextRules);
        setTransactionCount(nextTransactionCount);
      });

      setStatus(
        `Mined ${formatNumber(nextRules.length)} directional rules from ${formatNumber(
          nextTransactionCount,
        )} transactions.`,
      );
    } catch (error) {
      setRules([]);
      setTransactionCount(0);
      setStatus(
        error instanceof Error
          ? error.message
          : "Association rule mining failed.",
      );
    } finally {
      setLoading(false);
    }
  }

  function handleExport() {
    if (filteredRules.length === 0) return;

    const csv = [
      "antecedent,consequent,support,confidence,lift,pair_count",
      ...filteredRules.map((rule) =>
        [
          csvEscape(rule.antecedent),
          csvEscape(rule.consequent),
          csvEscape(rule.support.toFixed(4)),
          csvEscape(rule.confidence.toFixed(4)),
          csvEscape(rule.lift.toFixed(4)),
          csvEscape(rule.pairCount),
        ].join(","),
      ),
    ].join("\n");

    downloadFile(
      csv,
      `${tableName}-association-rules.csv`,
      "text/csv;charset=utf-8;",
    );
  }

  return (
    <section className={`${GLASS_PANEL_CLASS} p-6`}>
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <div className="inline-flex items-center gap-2 rounded-full bg-cyan-500/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-cyan-700 dark:text-cyan-300">
            <ShoppingBasket className="h-3.5 w-3.5" />
            Association rules
          </div>
          <h2 className="mt-3 text-2xl font-semibold text-slate-950 dark:text-white">
            Mine market-basket patterns across transactions
          </h2>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600 dark:text-slate-300">
            Pick a transaction identifier and an item field, then compute support,
            confidence, and lift for the strongest directional rules.
          </p>
        </div>

        <div className="flex flex-wrap gap-3">
          <button
            type="button"
            onClick={() => void handleMineRules()}
            disabled={loading || !activeTransactionColumn || !activeItemColumn}
            className={BUTTON_CLASS}
          >
            {loading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <TrendingUp className="h-4 w-4" />
            )}
            Mine rules
          </button>
          <button
            type="button"
            onClick={handleExport}
            disabled={filteredRules.length === 0}
            className={BUTTON_CLASS}
          >
            <Download className="h-4 w-4" />
            Export rules CSV
          </button>
        </div>
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-[1fr_1fr_18rem]">
        <label className="block">
          <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
            Transaction column
          </span>
          <select
            aria-label="Transaction column"
            value={activeTransactionColumn}
            onChange={(event) => setSelectedTransactionColumn(event.target.value)}
            className={FIELD_CLASS}
          >
            {transactionColumns.map((column) => (
              <option key={column.name} value={column.name}>
                {column.name}
              </option>
            ))}
          </select>
        </label>

        <label className="block">
          <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
            Item column
          </span>
          <select
            aria-label="Item column"
            value={activeItemColumn}
            onChange={(event) => setSelectedItemColumn(event.target.value)}
            className={FIELD_CLASS}
          >
            {itemColumns.map((column) => (
              <option key={column.name} value={column.name}>
                {column.name}
              </option>
            ))}
          </select>
        </label>

        <label className="block">
          <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
            Minimum support
          </span>
          <div className={`${GLASS_CARD_CLASS} p-4`}>
            <input
              aria-label="Minimum support"
              type="range"
              min={1}
              max={40}
              step={1}
              value={minSupport}
              onChange={(event) => setMinSupport(Number(event.target.value))}
              className="w-full accent-cyan-500"
            />
            <p className="mt-3 text-sm text-slate-600 dark:text-slate-300">
              {formatPercent(minSupport, 0)} of transactions
            </p>
          </div>
        </label>
      </div>

      {status ? (
        <p className="mt-4 rounded-2xl border border-cyan-400/20 bg-cyan-500/10 px-4 py-3 text-sm text-cyan-700 dark:text-cyan-300">
          {status}
        </p>
      ) : null}

      <div className="mt-6 grid gap-4 xl:grid-cols-3">
        <SummaryCard
          label="Transactions"
          value={formatNumber(transactionCount)}
          icon={ShoppingBasket}
        />
        <SummaryCard
          label="Visible rules"
          value={formatNumber(filteredRules.length)}
          icon={Sigma}
        />
        <SummaryCard
          label="Average lift"
          value={averageLift > 0 ? averageLift.toFixed(2) : "0.00"}
          icon={TrendingUp}
        />
      </div>

      <motion.div
        initial={{ opacity: 0, y: 14 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.24, ease: ANALYTICS_EASE }}
        className={`${GLASS_CARD_CLASS} mt-6 overflow-hidden`}
      >
        <div className="border-b border-white/20 px-5 py-4 dark:border-white/10">
          <h3 className="text-base font-semibold text-slate-950 dark:text-white">
            Top rules table
          </h3>
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
            Sorted by lift, then confidence, with the support threshold applied.
          </p>
        </div>

        <div className="overflow-x-auto">
          <table className="min-w-full text-left text-sm">
            <thead className="bg-slate-900/5 text-xs uppercase tracking-[0.18em] text-slate-500 dark:bg-white/5 dark:text-slate-400">
              <tr>
                <th className="px-5 py-3">Rule</th>
                <th className="px-5 py-3">Support</th>
                <th className="px-5 py-3">Confidence</th>
                <th className="px-5 py-3">Lift</th>
                <th className="px-5 py-3">Pair count</th>
              </tr>
            </thead>
            <tbody>
              {filteredRules.length === 0 ? (
                <tr>
                  <td
                    colSpan={5}
                    className="px-5 py-8 text-center text-sm text-slate-500 dark:text-slate-400"
                  >
                    Mine rules to populate the table.
                  </td>
                </tr>
              ) : (
                filteredRules.map((rule) => (
                  <tr
                    key={`${rule.antecedent}-${rule.consequent}`}
                    className="border-t border-white/20 text-slate-700 dark:border-white/10 dark:text-slate-200"
                  >
                    <td className="px-5 py-4 font-medium">
                      {rule.antecedent} -&gt; {rule.consequent}
                    </td>
                    <td className="px-5 py-4">{formatPercent(rule.support * 100, 1)}</td>
                    <td className="px-5 py-4">
                      {formatPercent(rule.confidence * 100, 1)}
                    </td>
                    <td className="px-5 py-4">{rule.lift.toFixed(2)}</td>
                    <td className="px-5 py-4">{formatNumber(rule.pairCount)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </motion.div>
    </section>
  );
}
