"use client";

import { useMemo, useState } from "react";
import { motion } from "framer-motion";
import {
  Cloud,
  Download,
  Hash,
  Loader2,
  ScanSearch,
  SmilePlus,
  Table2,
  Text,
} from "lucide-react";
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
import { formatNumber } from "@/lib/utils/formatters";
import type { ColumnProfile } from "@/types/dataset";

interface TextMiningToolProps {
  tableName: string;
  columns: ColumnProfile[];
}

interface TermStat {
  term: string;
  count: number;
}

interface WordCloudDatum {
  name: string;
  value: number;
}

interface MiningResult {
  totalDocuments: number;
  totalTokens: number;
  uniqueTerms: number;
  positiveHits: number;
  negativeHits: number;
  topTerms: TermStat[];
  topNgrams: TermStat[];
  wordCloud: WordCloudDatum[];
}

const POSITIVE_TERMS = [
  "good",
  "great",
  "excellent",
  "fast",
  "love",
  "helpful",
  "easy",
  "delightful",
] as const;
const NEGATIVE_TERMS = [
  "bad",
  "slow",
  "broken",
  "hard",
  "hate",
  "error",
  "late",
  "difficult",
] as const;

function tokenizeText(value: string, minWordLength: number) {
  return (value.toLowerCase().match(/[\p{L}\p{N}][\p{L}\p{N}'_-]*/gu) ?? []).filter(
    (token) => token.length >= minWordLength,
  );
}

function buildNgrams(tokens: string[], size: number) {
  const grams: string[] = [];
  for (let index = 0; index <= tokens.length - size; index += 1) {
    grams.push(tokens.slice(index, index + size).join(" "));
  }
  return grams;
}

function sortCounts(entries: Map<string, number>, limit: number) {
  return Array.from(entries.entries())
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, limit)
    .map(([term, count]) => ({ term, count }));
}

function buildCsv(result: MiningResult) {
  const termSection = [
    "kind,term,count",
    ...result.topTerms.map((row) => `word,${row.term},${row.count}`),
    ...result.topNgrams.map((row) => `ngram,${row.term},${row.count}`),
  ];
  return termSection.join("\n");
}

function MetricCard({ label, value, icon: Icon }: { label: string; value: string; icon: typeof Text }) {
  return (
    <div className={`${GLASS_CARD_CLASS} p-4`}>
      <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
        <Icon className="h-4 w-4 text-cyan-600 dark:text-cyan-300" />
        {label}
      </div>
      <div className="mt-3 text-xl font-semibold text-slate-950 dark:text-white">{value}</div>
    </div>
  );
}

function TermsTable({
  title,
  rows,
}: {
  title: string;
  rows: TermStat[];
}) {
  return (
    <div className={`${GLASS_CARD_CLASS} p-5`}>
      <p className="text-sm font-semibold text-slate-900 dark:text-white">{title}</p>
      <div className="mt-4 overflow-hidden rounded-2xl border border-white/20">
        <table className="min-w-full text-left text-sm text-slate-700 dark:text-slate-200">
          <thead className="bg-slate-950/5 text-xs uppercase tracking-[0.16em] text-slate-500 dark:bg-white/5 dark:text-slate-400">
            <tr>
              <th className="px-4 py-3">Term</th>
              <th className="px-4 py-3">Count</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.term} className="border-t border-white/15">
                <td className="px-4 py-3">{row.term}</td>
                <td className="px-4 py-3">{formatNumber(row.count)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function TextMiningTool({
  tableName,
  columns,
}: TextMiningToolProps) {
  const stringColumns = useMemo(
    () => columns.filter((column) => column.type === "string"),
    [columns],
  );
  const [textColumn, setTextColumn] = useState(stringColumns[0]?.name ?? "");
  const [minWordLength, setMinWordLength] = useState(3);
  const [ngramSize, setNgramSize] = useState(2);
  const [result, setResult] = useState<MiningResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState(
    "Pick a string column to extract term frequency, n-grams, and a lightweight sentiment proxy.",
  );

  async function handleAnalyze() {
    if (!textColumn) {
      setNotice("Choose a string column to analyze.");
      return;
    }

    setLoading(true);
    setNotice("Analyzing text column...");

    try {
      const rows = await runQuery(`
        SELECT CAST(${quoteIdentifier(textColumn)} AS VARCHAR) AS text_value
        FROM ${quoteIdentifier(tableName)}
        WHERE ${quoteIdentifier(textColumn)} IS NOT NULL
        LIMIT 2500
      `);

      const documents = rows
        .map((row) => (typeof row.text_value === "string" ? row.text_value : String(row.text_value ?? "")))
        .filter((value) => value.trim().length > 0);

      const wordCounts = new Map<string, number>();
      const ngramCounts = new Map<string, number>();
      let totalTokens = 0;
      let positiveHits = 0;
      let negativeHits = 0;

      for (const document of documents) {
        const tokens = tokenizeText(document, minWordLength);
        totalTokens += tokens.length;

        for (const token of tokens) {
          wordCounts.set(token, (wordCounts.get(token) ?? 0) + 1);
          if (POSITIVE_TERMS.includes(token as (typeof POSITIVE_TERMS)[number])) {
            positiveHits += 1;
          }
          if (NEGATIVE_TERMS.includes(token as (typeof NEGATIVE_TERMS)[number])) {
            negativeHits += 1;
          }
        }

        for (const ngram of buildNgrams(tokens, ngramSize)) {
          ngramCounts.set(ngram, (ngramCounts.get(ngram) ?? 0) + 1);
        }
      }

      const topTerms = sortCounts(wordCounts, 12);
      const topNgrams = sortCounts(ngramCounts, 8);
      const wordCloud = topTerms.map((row) => ({ name: row.term, value: row.count }));

      setResult({
        totalDocuments: documents.length,
        totalTokens,
        uniqueTerms: wordCounts.size,
        positiveHits,
        negativeHits,
        topTerms,
        topNgrams,
        wordCloud,
      });
      setNotice(`Analyzed ${formatNumber(documents.length)} text rows successfully.`);
    } catch (error) {
      setResult(null);
      setNotice(error instanceof Error ? error.message : "Text analysis failed.");
    } finally {
      setLoading(false);
    }
  }

  function handleExport() {
    if (!result) return;
    downloadFile(
      buildCsv(result),
      `${tableName}-${textColumn || "text"}-mining.csv`,
      "text/csv;charset=utf-8;",
    );
  }

  return (
    <motion.section
      initial={{ opacity: 0, y: 18 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.28, ease: ANALYTICS_EASE }}
      className={`${GLASS_PANEL_CLASS} space-y-6 p-6`}
    >
      <div className="flex flex-col gap-4 border-b border-white/20 pb-6 dark:border-white/10 xl:flex-row xl:items-start xl:justify-between">
        <div className="space-y-3">
          <div className="inline-flex items-center gap-2 rounded-full border border-cyan-500/20 bg-cyan-500/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.2em] text-cyan-700 dark:text-cyan-300">
            <ScanSearch className="h-3.5 w-3.5" />
            Text Mining Tool
          </div>
          <div>
            <h2 className="text-2xl font-semibold text-slate-950 dark:text-white">
              Mine term frequency, n-grams, and sentiment hints from text columns
            </h2>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600 dark:text-slate-300">
              Tokenize text locally, surface high-frequency terms, generate word cloud data,
              and compare positive versus negative vocabulary counts without leaving the browser.
            </p>
          </div>
        </div>
        <div className="grid gap-3 md:grid-cols-4">
          <select
            aria-label="Text column"
            value={textColumn}
            onChange={(event) => setTextColumn(event.currentTarget.value)}
            className={FIELD_CLASS}
          >
            {stringColumns.map((column) => (
              <option key={column.name} value={column.name}>
                {column.name}
              </option>
            ))}
          </select>
          <label className="flex items-center gap-2 rounded-2xl border border-white/20 bg-white/80 px-4 py-3 text-sm text-slate-700 dark:bg-slate-950/55 dark:text-slate-100">
            Min word length
            <input
              aria-label="Minimum word length"
              type="number"
              min={1}
              max={10}
              value={minWordLength}
              onChange={(event) => setMinWordLength(Number(event.currentTarget.value))}
              className="w-16 bg-transparent text-right outline-none"
            />
          </label>
          <label className="flex items-center gap-2 rounded-2xl border border-white/20 bg-white/80 px-4 py-3 text-sm text-slate-700 dark:bg-slate-950/55 dark:text-slate-100">
            N-gram size
            <input
              aria-label="N-gram size"
              type="number"
              min={2}
              max={4}
              value={ngramSize}
              onChange={(event) => setNgramSize(Number(event.currentTarget.value))}
              className="w-16 bg-transparent text-right outline-none"
            />
          </label>
          <div className="flex gap-2">
            <button type="button" onClick={handleAnalyze} className={BUTTON_CLASS}>
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <ScanSearch className="h-4 w-4" />}
              Analyze
            </button>
            <button
              type="button"
              onClick={handleExport}
              disabled={!result}
              className={BUTTON_CLASS}
            >
              <Download className="h-4 w-4" />
              Export CSV
            </button>
          </div>
        </div>
      </div>

      <p className="text-sm text-slate-600 dark:text-slate-300">{notice}</p>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
        <MetricCard label="Documents" value={formatNumber(result?.totalDocuments ?? 0)} icon={Table2} />
        <MetricCard label="Tokens" value={formatNumber(result?.totalTokens ?? 0)} icon={Hash} />
        <MetricCard label="Unique Terms" value={formatNumber(result?.uniqueTerms ?? 0)} icon={Text} />
        <MetricCard label="Positive Hits" value={formatNumber(result?.positiveHits ?? 0)} icon={SmilePlus} />
        <MetricCard label="Negative Hits" value={formatNumber(result?.negativeHits ?? 0)} icon={SmilePlus} />
      </div>

      <div className="grid gap-6 xl:grid-cols-[1fr_0.95fr]">
        <TermsTable title="Top Terms" rows={result?.topTerms ?? []} />
        <TermsTable title="Top N-grams" rows={result?.topNgrams ?? []} />
      </div>

      <div className={`${GLASS_CARD_CLASS} p-5`}>
        <div className="flex items-center gap-2">
          <Cloud className="h-4 w-4 text-cyan-600 dark:text-cyan-300" />
          <p className="text-sm font-semibold text-slate-900 dark:text-white">Word Cloud Data</p>
        </div>
        <div className="mt-4 flex flex-wrap gap-3">
          {(result?.wordCloud ?? []).map((entry) => (
            <span
              key={entry.name}
              className="rounded-full border border-cyan-400/20 bg-cyan-500/10 px-3 py-1.5 text-cyan-700 dark:text-cyan-300"
              style={{ fontSize: `${Math.max(12, 10 + entry.value * 1.2)}px` }}
            >
              {entry.name} ({entry.value})
            </span>
          ))}
          {!result?.wordCloud.length ? (
            <p className="text-sm text-slate-500 dark:text-slate-400">
              Run an analysis to generate word cloud data.
            </p>
          ) : null}
        </div>
      </div>
    </motion.section>
  );
}
