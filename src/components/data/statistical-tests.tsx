"use client";

import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  FlaskConical,
  History,
  Loader2,
  Play,
  Sigma,
} from "lucide-react";
import { runQuery } from "@/lib/duckdb/client";
import {
  runAnova,
  runChiSquare,
  runKolmogorovSmirnov,
  runMannWhitney,
  runTTest,
  type Alternative,
  type AnovaConfig,
  type ChiSquareConfig,
  type GroupConfig,
  type TestResult,
  type TestType,
} from "@/lib/utils/statistical-test-engine";
import { formatNumber } from "@/lib/utils/formatters";
import type { ColumnProfile } from "@/types/dataset";

interface StatisticalTestsProps {
  tableName: string;
  columns: ColumnProfile[];
  rowCount: number;
}

type RunState = { tone: "error" | "info"; message: string } | null;

const ease = [0.22, 1, 0.36, 1] as const;
const panelClass =
  "overflow-hidden rounded-[28px] border border-white/20 bg-white/75 shadow-[0_24px_90px_-48px_rgba(15,23,42,0.75)] backdrop-blur-2xl dark:border-white/10 dark:bg-slate-950/45";
const fieldClass =
  "w-full rounded-2xl border border-slate-200/70 bg-white/85 px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-cyan-400 focus:ring-4 focus:ring-cyan-500/10 dark:border-slate-700/70 dark:bg-slate-950/65 dark:text-slate-100";
const HISTORY_KEY = "datalens:statistical-tests";

const TEST_META: Record<TestType, { label: string; hint: string }> = {
  "t-test": { label: "t-test", hint: "Compare the mean of a numeric measure across two groups." },
  "chi-square": { label: "Chi-square", hint: "Check whether two categorical columns are associated." },
  anova: { label: "ANOVA", hint: "Measure whether multiple group means differ materially." },
  "mann-whitney": { label: "Mann-Whitney U", hint: "Rank-based alternative to the two-sample t-test." },
  "kolmogorov-smirnov": { label: "Kolmogorov-Smirnov", hint: "Compare the full distributions of two groups." },
};

const CONFIDENCE_OPTIONS = [
  { value: 0.9, label: "90% confidence" },
  { value: 0.95, label: "95% confidence" },
  { value: 0.99, label: "99% confidence" },
];

const ALTERNATIVE_OPTIONS: Array<{ value: Alternative; label: string }> = [
  { value: "two-sided", label: "Two-sided" },
  { value: "greater", label: "Greater" },
  { value: "less", label: "Less" },
];

function formatMetric(value: number | null, digits = 4) {
  if (value == null || Number.isNaN(value)) return "n/a";
  if (Math.abs(value) >= 1000) return formatNumber(value);
  return value.toFixed(digits);
}

function formatPValue(value: number | null) {
  if (value == null || Number.isNaN(value)) return "n/a";
  if (value < 0.0001) return "< 0.0001";
  return value.toFixed(4);
}

function loadHistory(tableName: string) {
  if (typeof window === "undefined") return [] as TestResult[];
  try {
    const raw = window.sessionStorage.getItem(`${HISTORY_KEY}:${tableName}`);
    const parsed = raw ? (JSON.parse(raw) as TestResult[]) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveHistory(tableName: string, history: TestResult[]) {
  if (typeof window === "undefined") return;
  window.sessionStorage.setItem(`${HISTORY_KEY}:${tableName}`, JSON.stringify(history.slice(0, 10)));
}

function ResultCards({ result }: { result: TestResult }) {
  const cards = [
    { label: result.statisticLabel, value: formatMetric(result.statistic), icon: Activity },
    { label: "p-value", value: formatPValue(result.pValue), icon: Sigma },
    { label: result.effectLabel, value: formatMetric(result.effectSize), icon: FlaskConical },
    { label: "Confidence interval", value: result.confidenceInterval ? `${formatMetric(result.confidenceInterval[0], 3)} to ${formatMetric(result.confidenceInterval[1], 3)}` : "n/a", icon: CheckCircle2 },
  ];
  return (
    <>
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        {cards.map((card) => <div key={card.label} className="rounded-2xl border border-white/25 bg-white/70 p-4 dark:border-white/10 dark:bg-slate-950/40"><div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400"><card.icon className="h-3.5 w-3.5" />{card.label}</div><p className="mt-3 text-xl font-semibold text-slate-900 dark:text-white">{card.value}</p></div>)}
      </div>
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        {result.details.map((detail) => <div key={detail.label} className="rounded-2xl border border-slate-200/70 bg-slate-50/70 px-4 py-3 dark:border-slate-800 dark:bg-slate-900/30"><p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">{detail.label}</p><p className="mt-2 text-sm font-medium text-slate-900 dark:text-white">{detail.value}</p></div>)}
      </div>
    </>
  );
}

function ParameterSummary({
  title,
  items,
}: {
  title: string;
  items: string[];
}) {
  return (
    <div className="rounded-2xl border border-cyan-400/20 bg-cyan-500/10 px-4 py-3 text-sm text-cyan-900 dark:text-cyan-200">
      <p className="font-semibold">{title}</p>
      <div className="mt-2 flex flex-wrap gap-2">
        {items.filter(Boolean).map((item) => <span key={item} className="rounded-full bg-white/65 px-2.5 py-1 text-xs font-medium text-cyan-800 dark:bg-slate-950/45 dark:text-cyan-200">{item}</span>)}
      </div>
    </div>
  );
}

function TestChecklist({ type }: { type: TestType }) {
  const tips =
    type === "chi-square"
      ? ["Use low-cardinality columns", "Expected counts should repeat", "Best for category-vs-category checks"]
      : type === "anova"
        ? ["Measure must be numeric", "Grouping column should be categorical", "Use when you have 3+ groups"]
        : type === "kolmogorov-smirnov"
          ? ["Compares full distributions", "Good for shape shifts and tails", "Most useful with moderate sample sizes"]
          : ["Works with exactly two groups", "Numeric measure required", "Confidence interval is shown for the mean gap"];

  return (
    <div className="rounded-2xl border border-slate-200/70 bg-slate-50/80 px-4 py-4 dark:border-slate-800 dark:bg-slate-900/25">
      <p className="text-sm font-semibold text-slate-900 dark:text-white">Before you run</p>
      <ul className="mt-3 space-y-2 text-sm leading-6 text-slate-600 dark:text-slate-300">
        {tips.map((tip) => <li key={tip}>{tip}</li>)}
      </ul>
    </div>
  );
}

function EmptyResultState() {
  return (
    <div className="rounded-[26px] border border-dashed border-slate-300/80 bg-slate-50/80 p-8 text-center dark:border-slate-700 dark:bg-slate-950/30">
      <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-cyan-500/10 text-cyan-700 dark:text-cyan-300">
        <FlaskConical className="h-5 w-5" />
      </div>
      <h3 className="mt-4 text-base font-semibold text-slate-900 dark:text-white">No test result yet</h3>
      <p className="mt-2 text-sm leading-6 text-slate-600 dark:text-slate-300">Pick a test, confirm the columns and groups, then run it to generate a DuckDB-backed result card and a reusable history entry.</p>
    </div>
  );
}

function AnalysisNotes() {
  const notes = [
    "A small p-value says the observed difference would be unusual under the null hypothesis.",
    "Effect size answers a different question: how large the difference or association is in practice.",
    "Confidence intervals are shown only where the current test returns a stable interval estimate in this panel.",
    "These results are fast exploratory checks, so they are best used to guide follow-up analysis rather than replace it.",
  ];

  return (
    <div className="rounded-[26px] border border-slate-200/70 bg-slate-50/70 p-5 dark:border-slate-800 dark:bg-slate-950/35">
      <p className="text-sm font-semibold text-slate-900 dark:text-white">How to read the output</p>
      <div className="mt-3 space-y-3">
        {notes.map((note, index) => (
          <div key={note} className="flex gap-3">
            <div className="mt-0.5 flex h-6 w-6 items-center justify-center rounded-full bg-cyan-500/10 text-xs font-semibold text-cyan-700 dark:text-cyan-300">{index + 1}</div>
            <p className="text-sm leading-6 text-slate-600 dark:text-slate-300">{note}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

function CaveatsCard() {
  return (
    <div className="rounded-[26px] border border-slate-200/70 bg-white/65 p-5 dark:border-slate-800 dark:bg-slate-950/40">
      <p className="text-sm font-semibold text-slate-900 dark:text-white">Interpretation caveats</p>
      <ul className="mt-3 space-y-2 text-sm leading-6 text-slate-600 dark:text-slate-300">
        <li>Large samples can make tiny differences look significant, so always read the effect size alongside the p-value.</li>
        <li>Low-cardinality grouping columns usually produce more stable comparisons than free-text dimensions.</li>
        <li>If you need publication-grade inference, validate assumptions and rerun the analysis in a dedicated statistics workflow.</li>
        <li>For distribution-heavy questions, the Kolmogorov-Smirnov test is usually a better fit than focusing on group means alone.</li>
      </ul>
    </div>
  );
}

function ResultLegend() {
  return (
    <div className="rounded-[26px] border border-slate-200/70 bg-slate-50/70 p-5 dark:border-slate-800 dark:bg-slate-950/35">
      <p className="text-sm font-semibold text-slate-900 dark:text-white">Result legend</p>
      <p className="mt-2 text-sm leading-6 text-slate-600 dark:text-slate-300">Green badges highlight tests where the selected confidence threshold was met. Amber badges mean the observed signal was too weak for the current settings or sample.</p>
    </div>
  );
}

export default function StatisticalTests({ tableName, columns, rowCount }: StatisticalTestsProps) {
  const numericColumns = useMemo(() => columns.filter((column) => column.type === "number"), [columns]);
  const groupingColumns = useMemo(() => columns.filter((column) => column.uniqueCount >= 2 && column.uniqueCount <= Math.max(16, Math.min(rowCount, 28))), [columns, rowCount]);
  const categoricalColumns = useMemo(() => columns.filter((column) => column.type !== "number" && column.uniqueCount >= 2 && column.uniqueCount <= Math.max(24, Math.min(rowCount, 36))), [columns, rowCount]);
  const [testType, setTestType] = useState<TestType>("t-test");
  const [tTest, setTTest] = useState<GroupConfig>({ measure: numericColumns[0]?.name ?? "", group: groupingColumns[0]?.name ?? "", groupA: "", groupB: "", confidence: 0.95, alternative: "two-sided" });
  const [mannWhitney, setMannWhitney] = useState<GroupConfig>({ measure: numericColumns[0]?.name ?? "", group: groupingColumns[0]?.name ?? "", groupA: "", groupB: "", confidence: 0.95, alternative: "two-sided" });
  const [ksTest, setKsTest] = useState<GroupConfig>({ measure: numericColumns[0]?.name ?? "", group: groupingColumns[0]?.name ?? "", groupA: "", groupB: "", confidence: 0.95, alternative: "two-sided" });
  const [chiSquare, setChiSquare] = useState<ChiSquareConfig>({ left: categoricalColumns[0]?.name ?? "", right: categoricalColumns[1]?.name ?? categoricalColumns[0]?.name ?? "", confidence: 0.95 });
  const [anova, setAnova] = useState<AnovaConfig>({ measure: numericColumns[0]?.name ?? "", group: groupingColumns[0]?.name ?? "", confidence: 0.95, maxGroups: 6 });
  const [groupOptions, setGroupOptions] = useState<Record<string, string[]>>({});
  const [history, setHistory] = useState<TestResult[]>([]);
  const [activeResult, setActiveResult] = useState<TestResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<RunState>(null);

  useEffect(() => {
    setHistory(loadHistory(tableName));
  }, [tableName]);

  useEffect(() => {
    setTTest((current) => ({ ...current, measure: numericColumns.some((column) => column.name === current.measure) ? current.measure : numericColumns[0]?.name ?? "", group: groupingColumns.some((column) => column.name === current.group) ? current.group : groupingColumns[0]?.name ?? "" }));
    setMannWhitney((current) => ({ ...current, measure: numericColumns.some((column) => column.name === current.measure) ? current.measure : numericColumns[0]?.name ?? "", group: groupingColumns.some((column) => column.name === current.group) ? current.group : groupingColumns[0]?.name ?? "" }));
    setKsTest((current) => ({ ...current, measure: numericColumns.some((column) => column.name === current.measure) ? current.measure : numericColumns[0]?.name ?? "", group: groupingColumns.some((column) => column.name === current.group) ? current.group : groupingColumns[0]?.name ?? "" }));
    setChiSquare((current) => ({ ...current, left: categoricalColumns.some((column) => column.name === current.left) ? current.left : categoricalColumns[0]?.name ?? "", right: categoricalColumns.some((column) => column.name === current.right && column.name !== current.left) ? current.right : categoricalColumns.find((column) => column.name !== (categoricalColumns[0]?.name ?? ""))?.name ?? categoricalColumns[0]?.name ?? "" }));
    setAnova((current) => ({ ...current, measure: numericColumns.some((column) => column.name === current.measure) ? current.measure : numericColumns[0]?.name ?? "", group: groupingColumns.some((column) => column.name === current.group) ? current.group : groupingColumns[0]?.name ?? "" }));
  }, [categoricalColumns, groupingColumns, numericColumns]);

  useEffect(() => {
    const requested = Array.from(new Set([tTest.group, mannWhitney.group, ksTest.group, anova.group].filter(Boolean)));
    const missing = requested.filter((name) => !groupOptions[name]);
    if (!missing.length) return;
    let cancelled = false;
    async function loadValues() {
      try {
        const pairs = await Promise.all(missing.map(async (columnName) => {
          const safeColumn = columnName.replace(/"/g, '""');
          const safeTable = tableName.replace(/"/g, '""');
          const rows = await runQuery(`SELECT CAST("${safeColumn}" AS VARCHAR) AS value, COUNT(*) AS count FROM "${safeTable}" WHERE "${safeColumn}" IS NOT NULL GROUP BY 1 ORDER BY count DESC, value ASC LIMIT 24`);
          return [columnName, rows.map((row) => String(row.value ?? "")).filter(Boolean)] as const;
        }));
        if (!cancelled) setGroupOptions((current) => ({ ...current, ...Object.fromEntries(pairs) }));
      } catch {
        if (!cancelled) setNotice({ tone: "info", message: "Some group values could not be loaded. You can still run tests with the current selections." });
      }
    }
    void loadValues();
    return () => {
      cancelled = true;
    };
  }, [anova.group, groupOptions, ksTest.group, mannWhitney.group, tTest.group, tableName]);

  useEffect(() => {
    const syncPair = (config: GroupConfig, setter: (next: GroupConfig) => void) => {
      const values = groupOptions[config.group] ?? [];
      const first = values[0] ?? "";
      const second = values.find((value) => value !== first) ?? values[1] ?? first;
      const nextA = values.includes(config.groupA) ? config.groupA : first;
      const nextB = values.includes(config.groupB) && config.groupB !== nextA ? config.groupB : second;
      if (nextA !== config.groupA || nextB !== config.groupB) setter({ ...config, groupA: nextA, groupB: nextB });
    };
    syncPair(tTest, setTTest);
    syncPair(mannWhitney, setMannWhitney);
    syncPair(ksTest, setKsTest);
  }, [groupOptions, ksTest, mannWhitney, tTest]);

  async function handleRun() {
    setBusy(true);
    setNotice(null);
    try {
      const result =
        testType === "t-test"
          ? await runTTest(tableName, tTest)
          : testType === "chi-square"
            ? await runChiSquare(tableName, chiSquare)
            : testType === "anova"
              ? await runAnova(tableName, anova)
              : testType === "mann-whitney"
                ? await runMannWhitney(tableName, mannWhitney)
                : await runKolmogorovSmirnov(tableName, ksTest);
      setActiveResult(result);
      setHistory((current) => {
        const next = [result, ...current.filter((entry) => entry.id !== result.id)].slice(0, 10);
        saveHistory(tableName, next);
        return next;
      });
    } catch (cause) {
      setNotice({ tone: "error", message: cause instanceof Error ? cause.message : "Statistical test failed." });
    } finally {
      setBusy(false);
    }
  }

  const activeConfig = testType === "t-test" ? tTest : testType === "mann-whitney" ? mannWhitney : ksTest;
  const result = activeResult ?? history[0] ?? null;

  return (
    <motion.section initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.38, ease }} className={panelClass}>
      <div className="border-b border-white/15 px-6 py-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="space-y-2">
            <div className="inline-flex items-center gap-2 rounded-full border border-cyan-400/30 bg-cyan-500/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-cyan-700 dark:border-cyan-500/20 dark:text-cyan-300"><FlaskConical className="h-3.5 w-3.5" />Statistical tests</div>
            <h2 className="text-xl font-semibold text-slate-900 dark:text-white">Hypothesis testing for {tableName}</h2>
            <p className="max-w-3xl text-sm leading-6 text-slate-600 dark:text-slate-300">Run quick inferential checks on {formatNumber(rowCount)} rows using DuckDB-backed summaries, then review the p-value, effect size, and an English explanation in one place.</p>
          </div>
          <button type="button" onClick={handleRun} disabled={busy || !columns.length} className="inline-flex items-center justify-center gap-2 rounded-2xl bg-cyan-600 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-cyan-500 disabled:cursor-not-allowed disabled:opacity-60">{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}Run test</button>
        </div>
      </div>

      <div className="grid gap-6 px-6 py-6 xl:grid-cols-[1.15fr_0.85fr]">
        <div className="space-y-5">
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {(Object.keys(TEST_META) as TestType[]).map((type) => <button key={type} type="button" onClick={() => setTestType(type)} className={`rounded-3xl border p-4 text-left transition ${testType === type ? "border-cyan-400/50 bg-cyan-500/10 text-cyan-800 dark:border-cyan-500/35 dark:bg-cyan-500/10 dark:text-cyan-200" : "border-slate-200/70 bg-white/65 text-slate-700 hover:border-slate-300 dark:border-slate-700/70 dark:bg-slate-950/35 dark:text-slate-200 dark:hover:border-slate-600"}`}><p className="text-sm font-semibold">{TEST_META[type].label}</p><p className="mt-1 text-xs leading-5 text-slate-500 dark:text-slate-400">{TEST_META[type].hint}</p></button>)}
          </div>

          <div className="rounded-[26px] border border-slate-200/70 bg-white/65 p-5 dark:border-slate-800/80 dark:bg-slate-950/40">
            {(testType === "t-test" || testType === "mann-whitney" || testType === "kolmogorov-smirnov") && (
              <div className="space-y-4">
                <div className="grid gap-4 md:grid-cols-2">
                <select value={activeConfig.measure} onChange={(event) => (testType === "t-test" ? setTTest({ ...tTest, measure: event.target.value }) : testType === "mann-whitney" ? setMannWhitney({ ...mannWhitney, measure: event.target.value }) : setKsTest({ ...ksTest, measure: event.target.value }))} className={fieldClass}>{numericColumns.map((column) => <option key={column.name} value={column.name}>{column.name}</option>)}</select>
                <select value={activeConfig.group} onChange={(event) => (testType === "t-test" ? setTTest({ ...tTest, group: event.target.value }) : testType === "mann-whitney" ? setMannWhitney({ ...mannWhitney, group: event.target.value }) : setKsTest({ ...ksTest, group: event.target.value }))} className={fieldClass}>{groupingColumns.map((column) => <option key={column.name} value={column.name}>{column.name}</option>)}</select>
                <select value={activeConfig.groupA} onChange={(event) => (testType === "t-test" ? setTTest({ ...tTest, groupA: event.target.value }) : testType === "mann-whitney" ? setMannWhitney({ ...mannWhitney, groupA: event.target.value }) : setKsTest({ ...ksTest, groupA: event.target.value }))} className={fieldClass}>{(groupOptions[activeConfig.group] ?? []).map((value) => <option key={value} value={value}>{value}</option>)}</select>
                <select value={activeConfig.groupB} onChange={(event) => (testType === "t-test" ? setTTest({ ...tTest, groupB: event.target.value }) : testType === "mann-whitney" ? setMannWhitney({ ...mannWhitney, groupB: event.target.value }) : setKsTest({ ...ksTest, groupB: event.target.value }))} className={fieldClass}>{(groupOptions[activeConfig.group] ?? []).map((value) => <option key={value} value={value}>{value}</option>)}</select>
                <select value={activeConfig.alternative} onChange={(event) => (testType === "t-test" ? setTTest({ ...tTest, alternative: event.target.value as Alternative }) : testType === "mann-whitney" ? setMannWhitney({ ...mannWhitney, alternative: event.target.value as Alternative }) : setKsTest({ ...ksTest, alternative: event.target.value as Alternative }))} className={fieldClass}>{ALTERNATIVE_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select>
                <select value={String(activeConfig.confidence)} onChange={(event) => (testType === "t-test" ? setTTest({ ...tTest, confidence: Number(event.target.value) }) : testType === "mann-whitney" ? setMannWhitney({ ...mannWhitney, confidence: Number(event.target.value) }) : setKsTest({ ...ksTest, confidence: Number(event.target.value) }))} className={fieldClass}>{CONFIDENCE_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select>
                </div>
                <ParameterSummary title="Current selection" items={[`Measure: ${activeConfig.measure || "none"}`, `Grouping: ${activeConfig.group || "none"}`, `${activeConfig.groupA || "?"} vs ${activeConfig.groupB || "?"}`, `Loaded groups: ${(groupOptions[activeConfig.group] ?? []).length}`]} />
              </div>
            )}

            {testType === "chi-square" && (
              <div className="space-y-4">
                <div className="grid gap-4 md:grid-cols-2">
                <select value={chiSquare.left} onChange={(event) => setChiSquare({ ...chiSquare, left: event.target.value })} className={fieldClass}>{categoricalColumns.map((column) => <option key={column.name} value={column.name}>{column.name}</option>)}</select>
                <select value={chiSquare.right} onChange={(event) => setChiSquare({ ...chiSquare, right: event.target.value })} className={fieldClass}>{categoricalColumns.filter((column) => column.name !== chiSquare.left).map((column) => <option key={column.name} value={column.name}>{column.name}</option>)}</select>
                <select value={String(chiSquare.confidence)} onChange={(event) => setChiSquare({ ...chiSquare, confidence: Number(event.target.value) })} className={fieldClass}>{CONFIDENCE_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select>
                </div>
                <ParameterSummary title="Current selection" items={[`Left column: ${chiSquare.left || "none"}`, `Right column: ${chiSquare.right || "none"}`, `Confidence: ${Math.round(chiSquare.confidence * 100)}%`]} />
              </div>
            )}

            {testType === "anova" && (
              <div className="space-y-4">
                <div className="grid gap-4 md:grid-cols-2">
                <select value={anova.measure} onChange={(event) => setAnova({ ...anova, measure: event.target.value })} className={fieldClass}>{numericColumns.map((column) => <option key={column.name} value={column.name}>{column.name}</option>)}</select>
                <select value={anova.group} onChange={(event) => setAnova({ ...anova, group: event.target.value })} className={fieldClass}>{groupingColumns.map((column) => <option key={column.name} value={column.name}>{column.name}</option>)}</select>
                <label className="space-y-2 text-sm text-slate-600 dark:text-slate-300"><span className="font-medium">Max groups: {anova.maxGroups}</span><input type="range" min={2} max={12} value={anova.maxGroups} onChange={(event) => setAnova({ ...anova, maxGroups: Number(event.target.value) })} className="w-full accent-cyan-500" /></label>
                <select value={String(anova.confidence)} onChange={(event) => setAnova({ ...anova, confidence: Number(event.target.value) })} className={fieldClass}>{CONFIDENCE_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select>
                </div>
                <ParameterSummary title="Current selection" items={[`Measure: ${anova.measure || "none"}`, `Grouping: ${anova.group || "none"}`, `Max groups: ${anova.maxGroups}`, `Confidence: ${Math.round(anova.confidence * 100)}%`]} />
              </div>
            )}
          </div>

          {notice && <div className={`rounded-2xl border px-4 py-3 text-sm ${notice.tone === "error" ? "border-rose-400/40 bg-rose-500/10 text-rose-700 dark:text-rose-300" : "border-cyan-400/40 bg-cyan-500/10 text-cyan-700 dark:text-cyan-300"}`}>{notice.message}</div>}
          <TestChecklist type={testType} />

          <AnimatePresence mode="wait">
            {result && (
              <motion.div key={result.id} initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -12 }} transition={{ duration: 0.28, ease }} className="space-y-4 rounded-[26px] border border-slate-200/70 bg-gradient-to-br from-white/75 to-slate-100/55 p-5 dark:border-slate-800 dark:from-slate-950/60 dark:to-slate-900/35">
                <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                  <div><p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">{TEST_META[result.type].label}</p><h3 className="mt-1 text-lg font-semibold text-slate-900 dark:text-white">{result.title}</h3><p className="mt-2 text-sm leading-6 text-slate-600 dark:text-slate-300">{result.interpretation}</p></div>
                  <div className={`inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-sm font-medium ${result.significant ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300" : "bg-amber-500/10 text-amber-700 dark:text-amber-300"}`}>{result.significant ? <CheckCircle2 className="h-4 w-4" /> : <AlertTriangle className="h-4 w-4" />}{result.significant ? "Signal detected" : "No strong signal"}</div>
                </div>
                <ResultCards result={result} />
              </motion.div>
            )}
          </AnimatePresence>
          {!result && <EmptyResultState />}
        </div>

        <div className="space-y-4">
          <div className="rounded-[26px] border border-slate-200/70 bg-white/65 p-5 dark:border-slate-800 dark:bg-slate-950/40">
            <div className="flex items-center gap-2 text-sm font-semibold text-slate-900 dark:text-white"><History className="h-4 w-4 text-cyan-500" />Session history</div>
            <div className="mt-4 space-y-3">
              {history.length === 0 ? <p className="text-sm text-slate-500 dark:text-slate-400">No tests have been run in this session yet.</p> : history.map((entry) => <button key={entry.id} type="button" onClick={() => setActiveResult(entry)} className="w-full rounded-2xl border border-slate-200/70 bg-white/80 p-4 text-left transition hover:border-cyan-300 dark:border-slate-800 dark:bg-slate-950/45 dark:hover:border-cyan-500/35"><div className="flex items-center justify-between gap-3"><p className="text-sm font-medium text-slate-900 dark:text-white">{entry.title}</p><span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.12em] ${entry.significant ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300" : "bg-slate-200/70 text-slate-600 dark:bg-slate-800 dark:text-slate-300"}`}>{entry.type}</span></div><div className="mt-2 flex flex-wrap gap-3 text-xs text-slate-500 dark:text-slate-400"><span>{entry.statisticLabel}: {formatMetric(entry.statistic, 3)}</span><span>p: {formatPValue(entry.pValue)}</span><span>{new Date(entry.runAt).toLocaleTimeString()}</span></div></button>)}
            </div>
          </div>

          <div className="rounded-[26px] border border-slate-200/70 bg-slate-50/70 p-5 dark:border-slate-800 dark:bg-slate-950/35">
            <p className="text-sm font-semibold text-slate-900 dark:text-white">Quick guidance</p>
            <ul className="mt-3 space-y-2 text-sm leading-6 text-slate-600 dark:text-slate-300">
              <li>Use `t-test` or `Mann-Whitney U` for two-group numeric comparisons.</li>
              <li>`ANOVA` works best when the grouping column has a small set of meaningful categories.</li>
              <li>`Chi-square` needs categorical columns with repeated combinations.</li>
              <li>`Kolmogorov-Smirnov` compares the entire distribution, not just the mean.</li>
            </ul>
            {(groupOptions[activeConfig.group] ?? []).length > 0 && <div className="mt-4 rounded-2xl border border-cyan-400/20 bg-cyan-500/10 px-4 py-3 text-xs text-cyan-800 dark:text-cyan-200">Loaded group values for {activeConfig.group}: {(groupOptions[activeConfig.group] ?? []).slice(0, 6).join(", ")}</div>}
          </div>
          <AnalysisNotes />
          <CaveatsCard />
          <ResultLegend />
        </div>
      </div>
    </motion.section>
  );
}
