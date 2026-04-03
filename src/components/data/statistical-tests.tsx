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
import { formatNumber } from "@/lib/utils/formatters";
import type { ColumnProfile } from "@/types/dataset";

interface StatisticalTestsProps {
  tableName: string;
  columns: ColumnProfile[];
  rowCount: number;
}

type TestType = "t-test" | "chi-square" | "anova" | "mann-whitney" | "kolmogorov-smirnov";
type Alternative = "two-sided" | "greater" | "less";
type RunState = { tone: "error" | "info"; message: string } | null;

interface TestResult {
  id: string;
  type: TestType;
  title: string;
  statisticLabel: string;
  statistic: number;
  pValue: number | null;
  confidenceInterval: [number, number] | null;
  effectLabel: string;
  effectSize: number | null;
  interpretation: string;
  significant: boolean;
  details: Array<{ label: string; value: string }>;
  sql: string;
  runAt: number;
}

interface GroupConfig {
  measure: string;
  group: string;
  groupA: string;
  groupB: string;
  confidence: number;
  alternative: Alternative;
}

interface ChiSquareConfig {
  left: string;
  right: string;
  confidence: number;
}

interface AnovaConfig {
  measure: string;
  group: string;
  confidence: number;
  maxGroups: number;
}

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

function quoteIdentifier(value: string) {
  return `"${value.replaceAll('"', '""')}"`;
}

function quoteLiteral(value: string) {
  return `'${value.replaceAll("'", "''")}'`;
}

function makeId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function toNumber(value: unknown) {
  const numeric = value == null ? Number.NaN : Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

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

function confidenceToCritical(confidence: number) {
  if (confidence >= 0.99) return 2.576;
  if (confidence >= 0.95) return 1.96;
  if (confidence >= 0.9) return 1.645;
  return 1.282;
}

function erf(value: number) {
  const sign = value < 0 ? -1 : 1;
  const x = Math.abs(value);
  const t = 1 / (1 + 0.3275911 * x);
  const y =
    1 -
    (((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) *
      t *
      Math.exp(-x * x));
  return sign * y;
}

function normalCdf(value: number) {
  return 0.5 * (1 + erf(value / Math.SQRT2));
}

function logGamma(value: number) {
  const coeffs = [
    676.5203681218851,
    -1259.1392167224028,
    771.3234287776531,
    -176.6150291621406,
    12.507343278686905,
    -0.13857109526572012,
    9.984369578019572e-6,
    1.5056327351493116e-7,
  ];
  if (value < 0.5) {
    return Math.log(Math.PI) - Math.log(Math.sin(Math.PI * value)) - logGamma(1 - value);
  }
  let x = 0.9999999999998099;
  const z = value - 1;
  for (let index = 0; index < coeffs.length; index += 1) x += coeffs[index] / (z + index + 1);
  const t = z + coeffs.length - 0.5;
  return 0.9189385332046727 + (z + 0.5) * Math.log(t) - t + Math.log(x);
}

function regularizedBeta(x: number, a: number, b: number) {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const logFactor = a * Math.log(x) + b * Math.log(1 - x) - Math.log(a) - logGamma(a) - logGamma(b) + logGamma(a + b);
  const front = Math.exp(logFactor);
  let c = 1;
  let d = 1 - ((a + b) * x) / (a + 1);
  if (Math.abs(d) < 1e-30) d = 1e-30;
  d = 1 / d;
  let fraction = d;
  for (let step = 1; step <= 120; step += 1) {
    const m2 = step * 2;
    let numerator = (step * (b - step) * x) / ((a + m2 - 1) * (a + m2));
    d = 1 + numerator * d;
    c = 1 + numerator / c;
    if (Math.abs(d) < 1e-30) d = 1e-30;
    if (Math.abs(c) < 1e-30) c = 1e-30;
    d = 1 / d;
    fraction *= d * c;
    numerator = -((a + step) * (a + b + step) * x) / ((a + m2) * (a + m2 + 1));
    d = 1 + numerator * d;
    c = 1 + numerator / c;
    if (Math.abs(d) < 1e-30) d = 1e-30;
    if (Math.abs(c) < 1e-30) c = 1e-30;
    d = 1 / d;
    const delta = d * c;
    fraction *= delta;
    if (Math.abs(delta - 1) < 1e-9) break;
  }
  const value = front * fraction;
  return x < (a + 1) / (a + b + 2) ? value : 1 - regularizedBeta(1 - x, b, a);
}

function tPValue(statistic: number, degreesOfFreedom: number, alternative: Alternative) {
  if (!Number.isFinite(statistic) || degreesOfFreedom <= 0) return null;
  const x = degreesOfFreedom / (degreesOfFreedom + statistic * statistic);
  const tail = 0.5 * regularizedBeta(x, degreesOfFreedom / 2, 0.5);
  if (alternative === "greater") return statistic >= 0 ? tail : 1 - tail;
  if (alternative === "less") return statistic <= 0 ? tail : 1 - tail;
  return clamp(2 * tail, 0, 1);
}

function fPValue(statistic: number, df1: number, df2: number) {
  if (!Number.isFinite(statistic) || df1 <= 0 || df2 <= 0) return null;
  const x = (df1 * statistic) / (df1 * statistic + df2);
  return clamp(1 - regularizedBeta(x, df1 / 2, df2 / 2), 0, 1);
}

function chiSquarePValue(statistic: number, degreesOfFreedom: number) {
  if (!Number.isFinite(statistic) || degreesOfFreedom <= 0) return null;
  const transformed =
    (Math.pow(statistic / degreesOfFreedom, 1 / 3) - (1 - 2 / (9 * degreesOfFreedom))) /
    Math.sqrt(2 / (9 * degreesOfFreedom));
  return clamp(1 - normalCdf(transformed), 0, 1);
}

function normalPValue(z: number, alternative: Alternative) {
  const oneTail = 1 - normalCdf(Math.abs(z));
  if (alternative === "greater") return z >= 0 ? oneTail : 1 - oneTail;
  if (alternative === "less") return z <= 0 ? oneTail : 1 - oneTail;
  return clamp(2 * oneTail, 0, 1);
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

function describeEffect(type: TestType, value: number | null) {
  if (value == null) return "Effect size unavailable";
  const magnitude = Math.abs(value);
  if (type === "chi-square") return magnitude >= 0.5 ? "Strong association" : magnitude >= 0.3 ? "Moderate association" : magnitude >= 0.1 ? "Weak association" : "Tiny association";
  if (type === "anova") return magnitude >= 0.14 ? "Large effect" : magnitude >= 0.06 ? "Medium effect" : magnitude >= 0.01 ? "Small effect" : "Tiny effect";
  if (type === "kolmogorov-smirnov") return magnitude >= 0.35 ? "Large distribution shift" : magnitude >= 0.2 ? "Moderate distribution shift" : magnitude >= 0.1 ? "Small distribution shift" : "Tiny distribution shift";
  return magnitude >= 0.8 ? "Large effect" : magnitude >= 0.5 ? "Medium effect" : magnitude >= 0.2 ? "Small effect" : "Tiny effect";
}

export default function StatisticalTests({ tableName, columns, rowCount }: StatisticalTestsProps) {
  const numericColumns = useMemo(() => columns.filter((column) => column.type === "number"), [columns]);
  const groupingColumns = useMemo(
    () => columns.filter((column) => column.uniqueCount >= 2 && column.uniqueCount <= Math.max(16, Math.min(rowCount, 28))),
    [columns, rowCount],
  );
  const categoricalColumns = useMemo(
    () => columns.filter((column) => column.type !== "number" && column.uniqueCount >= 2 && column.uniqueCount <= Math.max(24, Math.min(rowCount, 36))),
    [columns, rowCount],
  );
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
    setChiSquare((current) => ({ ...current, left: categoricalColumns.some((column) => column.name === current.left) ? current.left : categoricalColumns[0]?.name ?? "", right: categoricalColumns.some((column) => column.name === current.right) && current.right !== current.left ? current.right : categoricalColumns.find((column) => column.name !== (categoricalColumns[0]?.name ?? ""))?.name ?? categoricalColumns[0]?.name ?? "" }));
    setAnova((current) => ({ ...current, measure: numericColumns.some((column) => column.name === current.measure) ? current.measure : numericColumns[0]?.name ?? "", group: groupingColumns.some((column) => column.name === current.group) ? current.group : groupingColumns[0]?.name ?? "" }));
  }, [categoricalColumns, groupingColumns, numericColumns]);

  useEffect(() => {
    const columnsToLoad = Array.from(new Set([tTest.group, mannWhitney.group, ksTest.group, anova.group].filter(Boolean)));
    if (!columnsToLoad.length) return;
    let cancelled = false;
    async function loadValues() {
      try {
        const pairs = await Promise.all(columnsToLoad.map(async (columnName) => {
          if (groupOptions[columnName]) return [columnName, groupOptions[columnName]] as const;
          const rows = await runQuery(`SELECT CAST(${quoteIdentifier(columnName)} AS VARCHAR) AS value, COUNT(*) AS count FROM ${quoteIdentifier(tableName)} WHERE ${quoteIdentifier(columnName)} IS NOT NULL GROUP BY 1 ORDER BY count DESC, value ASC LIMIT 24`);
          return [columnName, rows.map((row) => String(row.value ?? "")).filter(Boolean)] as const;
        }));
        if (!cancelled) setGroupOptions((current) => Object.fromEntries([...Object.entries(current), ...pairs]));
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
      const groupA = values.includes(config.groupA) ? config.groupA : first;
      const groupB = values.includes(config.groupB) && config.groupB !== groupA ? config.groupB : second;
      if (groupA !== config.groupA || groupB !== config.groupB) setter({ ...config, groupA, groupB });
    };
    syncPair(tTest, setTTest);
    syncPair(mannWhitney, setMannWhitney);
    syncPair(ksTest, setKsTest);
  }, [groupOptions, ksTest, mannWhitney, tTest]);

  async function runSelectedTest() {
    setBusy(true);
    setNotice(null);
    try {
      const result =
        testType === "t-test"
          ? await runTTest(tTest)
          : testType === "chi-square"
            ? await runChiSquare()
            : testType === "anova"
              ? await runAnova()
              : testType === "mann-whitney"
                ? await runMannWhitney()
                : await runKs();
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

  async function runTTest(config: GroupConfig) {
    if (!config.measure || !config.group || !config.groupA || !config.groupB || config.groupA === config.groupB) throw new Error("Pick a numeric measure and two distinct groups for the t-test.");
    const sql = `WITH sample AS (SELECT CAST(${quoteIdentifier(config.measure)} AS DOUBLE) AS value, CAST(${quoteIdentifier(config.group)} AS VARCHAR) AS grp FROM ${quoteIdentifier(tableName)} WHERE ${quoteIdentifier(config.measure)} IS NOT NULL AND ${quoteIdentifier(config.group)} IS NOT NULL AND CAST(${quoteIdentifier(config.group)} AS VARCHAR) IN (${quoteLiteral(config.groupA)}, ${quoteLiteral(config.groupB)})) SELECT grp, COUNT(*) AS n, AVG(value) AS mean, VAR_SAMP(value) AS variance, STDDEV_SAMP(value) AS stddev FROM sample GROUP BY 1 ORDER BY grp`;
    const rows = await runQuery(sql);
    const first = rows.find((row) => String(row.grp) === config.groupA);
    const second = rows.find((row) => String(row.grp) === config.groupB);
    const n1 = Number(first?.n ?? 0);
    const n2 = Number(second?.n ?? 0);
    const mean1 = toNumber(first?.mean) ?? 0;
    const mean2 = toNumber(second?.mean) ?? 0;
    const variance1 = toNumber(first?.variance) ?? 0;
    const variance2 = toNumber(second?.variance) ?? 0;
    if (n1 < 2 || n2 < 2) throw new Error("Each group needs at least two numeric observations for a t-test.");
    const diff = mean1 - mean2;
    const standardError = Math.sqrt(variance1 / n1 + variance2 / n2);
    const statistic = standardError === 0 ? 0 : diff / standardError;
    const numerator = Math.pow(variance1 / n1 + variance2 / n2, 2);
    const denominator = (Math.pow(variance1 / n1, 2) / (n1 - 1)) + (Math.pow(variance2 / n2, 2) / (n2 - 1));
    const degreesOfFreedom = denominator === 0 ? n1 + n2 - 2 : numerator / denominator;
    const pooled = Math.sqrt((((n1 - 1) * variance1) + ((n2 - 1) * variance2)) / Math.max(n1 + n2 - 2, 1));
    const effectSize = pooled > 0 ? diff / pooled : null;
    const critical = confidenceToCritical(config.confidence);
    const confidenceInterval = standardError > 0 ? [diff - critical * standardError, diff + critical * standardError] as [number, number] : null;
    const pValue = tPValue(statistic, degreesOfFreedom, config.alternative);
    const significant = (pValue ?? 1) < 1 - config.confidence;
    return {
      id: makeId(),
      type: "t-test",
      title: `${config.measure}: ${config.groupA} vs ${config.groupB}`,
      statisticLabel: "t statistic",
      statistic,
      pValue,
      confidenceInterval,
      effectLabel: "Cohen's d",
      effectSize,
      significant,
      interpretation: significant ? `There is evidence that ${config.measure} differs between ${config.groupA} and ${config.groupB}. ${describeEffect("t-test", effectSize)}.` : `The observed mean gap in ${config.measure} is not statistically strong enough to separate ${config.groupA} from ${config.groupB}.`,
      details: [
        { label: `${config.groupA} mean`, value: formatMetric(mean1, 3) },
        { label: `${config.groupB} mean`, value: formatMetric(mean2, 3) },
        { label: "Mean difference", value: formatMetric(diff, 3) },
        { label: "Degrees of freedom", value: formatMetric(degreesOfFreedom, 2) },
      ],
      sql,
      runAt: Date.now(),
    } satisfies TestResult;
  }

  async function runChiSquare() {
    if (!chiSquare.left || !chiSquare.right || chiSquare.left === chiSquare.right) throw new Error("Choose two different categorical columns for the chi-square test.");
    const sql = `SELECT CAST(${quoteIdentifier(chiSquare.left)} AS VARCHAR) AS left_value, CAST(${quoteIdentifier(chiSquare.right)} AS VARCHAR) AS right_value, COUNT(*) AS cell_count FROM ${quoteIdentifier(tableName)} WHERE ${quoteIdentifier(chiSquare.left)} IS NOT NULL AND ${quoteIdentifier(chiSquare.right)} IS NOT NULL GROUP BY 1, 2`;
    const rows = await runQuery(sql);
    if (rows.length < 2) throw new Error("The selected columns do not form a usable contingency table.");
    const rowTotals = new Map<string, number>();
    const columnTotals = new Map<string, number>();
    let total = 0;
    for (const row of rows) {
      const left = String(row.left_value ?? "unknown");
      const right = String(row.right_value ?? "unknown");
      const count = Number(row.cell_count ?? 0);
      total += count;
      rowTotals.set(left, (rowTotals.get(left) ?? 0) + count);
      columnTotals.set(right, (columnTotals.get(right) ?? 0) + count);
    }
    const chi = rows.reduce((sum, row) => {
      const left = String(row.left_value ?? "unknown");
      const right = String(row.right_value ?? "unknown");
      const observed = Number(row.cell_count ?? 0);
      const expected = ((rowTotals.get(left) ?? 0) * (columnTotals.get(right) ?? 0)) / Math.max(total, 1);
      return expected > 0 ? sum + Math.pow(observed - expected, 2) / expected : sum;
    }, 0);
    const df = Math.max((rowTotals.size - 1) * (columnTotals.size - 1), 1);
    const pValue = chiSquarePValue(chi, df);
    const effectSize = Math.sqrt(chi / (Math.max(total, 1) * Math.max(Math.min(rowTotals.size - 1, columnTotals.size - 1), 1)));
    const significant = (pValue ?? 1) < 1 - chiSquare.confidence;
    return {
      id: makeId(),
      type: "chi-square",
      title: `${chiSquare.left} x ${chiSquare.right}`,
      statisticLabel: "Chi-square",
      statistic: chi,
      pValue,
      confidenceInterval: null,
      effectLabel: "Cramer's V",
      effectSize,
      significant,
      interpretation: significant ? `The category mix in ${chiSquare.left} changes meaningfully across ${chiSquare.right}. ${describeEffect("chi-square", effectSize)}.` : `The contingency table does not show a strong enough association between ${chiSquare.left} and ${chiSquare.right}.`,
      details: [
        { label: "Rows in table", value: formatNumber(total) },
        { label: "Distinct left values", value: String(rowTotals.size) },
        { label: "Distinct right values", value: String(columnTotals.size) },
        { label: "Degrees of freedom", value: String(df) },
      ],
      sql,
      runAt: Date.now(),
    } satisfies TestResult;
  }

  async function runAnova() {
    if (!anova.measure || !anova.group) throw new Error("Pick a numeric measure and a grouping column for ANOVA.");
    const sql = `WITH counts AS (SELECT CAST(${quoteIdentifier(anova.group)} AS VARCHAR) AS grp, COUNT(*) AS cnt FROM ${quoteIdentifier(tableName)} WHERE ${quoteIdentifier(anova.measure)} IS NOT NULL AND ${quoteIdentifier(anova.group)} IS NOT NULL GROUP BY 1 ORDER BY cnt DESC LIMIT ${clamp(anova.maxGroups, 2, 12)}), sample AS (SELECT CAST(${quoteIdentifier(anova.measure)} AS DOUBLE) AS value, CAST(${quoteIdentifier(anova.group)} AS VARCHAR) AS grp FROM ${quoteIdentifier(tableName)} WHERE ${quoteIdentifier(anova.measure)} IS NOT NULL AND ${quoteIdentifier(anova.group)} IS NOT NULL AND CAST(${quoteIdentifier(anova.group)} AS VARCHAR) IN (SELECT grp FROM counts)) SELECT grp, COUNT(*) AS n, AVG(value) AS mean, VAR_SAMP(value) AS variance FROM sample GROUP BY 1 ORDER BY n DESC, grp ASC`;
    const rows = await runQuery(sql);
    if (rows.length < 2) throw new Error("ANOVA needs at least two populated groups.");
    const groups = rows.map((row) => ({ group: String(row.grp ?? ""), n: Number(row.n ?? 0), mean: toNumber(row.mean) ?? 0, variance: toNumber(row.variance) ?? 0 })).filter((row) => row.n > 0);
    const totalN = groups.reduce((sum, row) => sum + row.n, 0);
    if (groups.length < 2 || totalN <= groups.length) throw new Error("There is not enough data to estimate within-group variance.");
    const grandMean = groups.reduce((sum, row) => sum + row.mean * row.n, 0) / totalN;
    const ssBetween = groups.reduce((sum, row) => sum + row.n * Math.pow(row.mean - grandMean, 2), 0);
    const ssWithin = groups.reduce((sum, row) => sum + Math.max(row.n - 1, 0) * row.variance, 0);
    const df1 = groups.length - 1;
    const df2 = totalN - groups.length;
    const msBetween = ssBetween / Math.max(df1, 1);
    const msWithin = ssWithin / Math.max(df2, 1);
    const statistic = msWithin === 0 ? 0 : msBetween / msWithin;
    const pValue = fPValue(statistic, df1, df2);
    const effectSize = (ssBetween + ssWithin) > 0 ? ssBetween / (ssBetween + ssWithin) : null;
    const significant = (pValue ?? 1) < 1 - anova.confidence;
    return {
      id: makeId(),
      type: "anova",
      title: `${anova.measure} by ${anova.group}`,
      statisticLabel: "F statistic",
      statistic,
      pValue,
      confidenceInterval: null,
      effectLabel: "Eta squared",
      effectSize,
      significant,
      interpretation: significant ? `At least one ${anova.group} segment has a meaningfully different mean ${anova.measure}. ${describeEffect("anova", effectSize)}.` : `The observed group means for ${anova.measure} stay within the range expected from within-group variation.`,
      details: [
        { label: "Groups tested", value: String(groups.length) },
        { label: "Grand mean", value: formatMetric(grandMean, 3) },
        { label: "Between-group SS", value: formatMetric(ssBetween, 2) },
        { label: "Residual df", value: String(df2) },
      ],
      sql,
      runAt: Date.now(),
    } satisfies TestResult;
  }

  async function runMannWhitney() {
    if (!mannWhitney.measure || !mannWhitney.group || !mannWhitney.groupA || !mannWhitney.groupB || mannWhitney.groupA === mannWhitney.groupB) throw new Error("Pick a numeric measure and two distinct groups for Mann-Whitney U.");
    const sql = `WITH sample AS (SELECT CAST(${quoteIdentifier(mannWhitney.measure)} AS DOUBLE) AS value, CAST(${quoteIdentifier(mannWhitney.group)} AS VARCHAR) AS grp FROM ${quoteIdentifier(tableName)} WHERE ${quoteIdentifier(mannWhitney.measure)} IS NOT NULL AND ${quoteIdentifier(mannWhitney.group)} IS NOT NULL AND CAST(${quoteIdentifier(mannWhitney.group)} AS VARCHAR) IN (${quoteLiteral(mannWhitney.groupA)}, ${quoteLiteral(mannWhitney.groupB)})), ranked AS (SELECT value, grp, AVG(rank_value) OVER (PARTITION BY value) AS avg_rank FROM (SELECT value, grp, RANK() OVER (ORDER BY value) AS rank_value FROM sample)) SELECT grp, COUNT(*) AS n, SUM(avg_rank) AS rank_sum, AVG(value) AS mean_value FROM ranked GROUP BY 1 ORDER BY grp`;
    const rows = await runQuery(sql);
    const first = rows.find((row) => String(row.grp) === mannWhitney.groupA);
    const second = rows.find((row) => String(row.grp) === mannWhitney.groupB);
    const n1 = Number(first?.n ?? 0);
    const n2 = Number(second?.n ?? 0);
    if (n1 === 0 || n2 === 0) throw new Error("Each group needs at least one observation for Mann-Whitney U.");
    const rankSum1 = toNumber(first?.rank_sum) ?? 0;
    const u1 = rankSum1 - (n1 * (n1 + 1)) / 2;
    const u2 = n1 * n2 - u1;
    const statistic = Math.min(u1, u2);
    const meanU = (n1 * n2) / 2;
    const stdU = Math.sqrt((n1 * n2 * (n1 + n2 + 1)) / 12);
    const z = stdU === 0 ? 0 : (statistic - meanU) / stdU;
    const pValue = normalPValue(z, mannWhitney.alternative);
    const effectSize = Math.abs(z) / Math.sqrt(n1 + n2);
    const significant = (pValue ?? 1) < 1 - mannWhitney.confidence;
    return {
      id: makeId(),
      type: "mann-whitney",
      title: `${mannWhitney.measure}: ${mannWhitney.groupA} vs ${mannWhitney.groupB}`,
      statisticLabel: "U statistic",
      statistic,
      pValue,
      confidenceInterval: null,
      effectLabel: "Rank-biserial proxy",
      effectSize,
      significant,
      interpretation: significant ? `The rank ordering of ${mannWhitney.measure} differs between ${mannWhitney.groupA} and ${mannWhitney.groupB}. ${describeEffect("mann-whitney", effectSize)}.` : `The two groups have similar rank distributions for ${mannWhitney.measure}.`,
      details: [
        { label: `${mannWhitney.groupA} rows`, value: formatNumber(n1) },
        { label: `${mannWhitney.groupB} rows`, value: formatNumber(n2) },
        { label: "z score", value: formatMetric(z, 3) },
        { label: `${mannWhitney.groupA} mean`, value: formatMetric(toNumber(first?.mean_value), 3) },
      ],
      sql,
      runAt: Date.now(),
    } satisfies TestResult;
  }

  async function runKs() {
    if (!ksTest.measure || !ksTest.group || !ksTest.groupA || !ksTest.groupB || ksTest.groupA === ksTest.groupB) throw new Error("Pick a numeric measure and two distinct groups for the Kolmogorov-Smirnov test.");
    const sql = `WITH sample AS (SELECT CAST(${quoteIdentifier(ksTest.measure)} AS DOUBLE) AS value, CAST(${quoteIdentifier(ksTest.group)} AS VARCHAR) AS grp FROM ${quoteIdentifier(tableName)} WHERE ${quoteIdentifier(ksTest.measure)} IS NOT NULL AND ${quoteIdentifier(ksTest.group)} IS NOT NULL AND CAST(${quoteIdentifier(ksTest.group)} AS VARCHAR) IN (${quoteLiteral(ksTest.groupA)}, ${quoteLiteral(ksTest.groupB)})), a AS (SELECT value, CUME_DIST() OVER (ORDER BY value) AS ecdf_a FROM sample WHERE grp = ${quoteLiteral(ksTest.groupA)}), b AS (SELECT value, CUME_DIST() OVER (ORDER BY value) AS ecdf_b FROM sample WHERE grp = ${quoteLiteral(ksTest.groupB)}), points AS (SELECT value FROM a UNION SELECT value FROM b), joined AS (SELECT p.value, COALESCE((SELECT MAX(ecdf_a) FROM a WHERE a.value <= p.value), 0) AS fa, COALESCE((SELECT MAX(ecdf_b) FROM b WHERE b.value <= p.value), 0) AS fb FROM points p) SELECT MAX(ABS(fa - fb)) AS d_stat, (SELECT COUNT(*) FROM a) AS n1, (SELECT COUNT(*) FROM b) AS n2 FROM joined`;
    const row = (await runQuery(sql))[0] ?? {};
    const dStatistic = toNumber(row.d_stat) ?? 0;
    const n1 = Number(row.n1 ?? 0);
    const n2 = Number(row.n2 ?? 0);
    if (n1 === 0 || n2 === 0) throw new Error("Each group needs data to compare distributions.");
    const effectiveN = (n1 * n2) / (n1 + n2);
    const lambda = (Math.sqrt(effectiveN) + 0.12 + 0.11 / Math.sqrt(Math.max(effectiveN, 1))) * dStatistic;
    const pValue = clamp(2 * Math.exp(-2 * lambda * lambda), 0, 1);
    const significant = pValue < 1 - ksTest.confidence;
    return {
      id: makeId(),
      type: "kolmogorov-smirnov",
      title: `${ksTest.measure}: ${ksTest.groupA} vs ${ksTest.groupB}`,
      statisticLabel: "D statistic",
      statistic: dStatistic,
      pValue,
      confidenceInterval: null,
      effectLabel: "Distribution distance",
      effectSize: dStatistic,
      significant,
      interpretation: significant ? `The full distribution of ${ksTest.measure} shifts between ${ksTest.groupA} and ${ksTest.groupB}. ${describeEffect("kolmogorov-smirnov", dStatistic)}.` : `The empirical distributions of ${ksTest.measure} stay close across the two selected groups.`,
      details: [
        { label: `${ksTest.groupA} rows`, value: formatNumber(n1) },
        { label: `${ksTest.groupB} rows`, value: formatNumber(n2) },
        { label: "Effective n", value: formatMetric(effectiveN, 1) },
        { label: "Confidence level", value: `${Math.round(ksTest.confidence * 100)}%` },
      ],
      sql,
      runAt: Date.now(),
    } satisfies TestResult;
  }

  const activeGroupOptions = groupOptions[tTest.group] ?? [];
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
          <button type="button" onClick={runSelectedTest} disabled={busy || !columns.length} className="inline-flex items-center justify-center gap-2 rounded-2xl bg-cyan-600 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-cyan-500 disabled:cursor-not-allowed disabled:opacity-60">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
            Run test
          </button>
        </div>
      </div>

      <div className="grid gap-6 px-6 py-6 xl:grid-cols-[1.15fr_0.85fr]">
        <div className="space-y-5">
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {(Object.keys(TEST_META) as TestType[]).map((type) => (
              <button key={type} type="button" onClick={() => setTestType(type)} className={`rounded-3xl border p-4 text-left transition ${testType === type ? "border-cyan-400/50 bg-cyan-500/10 text-cyan-800 dark:border-cyan-500/35 dark:bg-cyan-500/10 dark:text-cyan-200" : "border-slate-200/70 bg-white/65 text-slate-700 hover:border-slate-300 dark:border-slate-700/70 dark:bg-slate-950/35 dark:text-slate-200 dark:hover:border-slate-600"}`}>
                <p className="text-sm font-semibold">{TEST_META[type].label}</p>
                <p className="mt-1 text-xs leading-5 text-slate-500 dark:text-slate-400">{TEST_META[type].hint}</p>
              </button>
            ))}
          </div>

          <div className="rounded-[26px] border border-slate-200/70 bg-white/65 p-5 dark:border-slate-800/80 dark:bg-slate-950/40">
            {(testType === "t-test" || testType === "mann-whitney" || testType === "kolmogorov-smirnov") && (
              <div className="grid gap-4 md:grid-cols-2">
                <select value={(testType === "t-test" ? tTest : testType === "mann-whitney" ? mannWhitney : ksTest).measure} onChange={(event) => (testType === "t-test" ? setTTest({ ...tTest, measure: event.target.value }) : testType === "mann-whitney" ? setMannWhitney({ ...mannWhitney, measure: event.target.value }) : setKsTest({ ...ksTest, measure: event.target.value }))} className={fieldClass}>{numericColumns.map((column) => <option key={column.name} value={column.name}>{column.name}</option>)}</select>
                <select value={(testType === "t-test" ? tTest : testType === "mann-whitney" ? mannWhitney : ksTest).group} onChange={(event) => (testType === "t-test" ? setTTest({ ...tTest, group: event.target.value }) : testType === "mann-whitney" ? setMannWhitney({ ...mannWhitney, group: event.target.value }) : setKsTest({ ...ksTest, group: event.target.value }))} className={fieldClass}>{groupingColumns.map((column) => <option key={column.name} value={column.name}>{column.name}</option>)}</select>
                <select value={(testType === "t-test" ? tTest : testType === "mann-whitney" ? mannWhitney : ksTest).groupA} onChange={(event) => (testType === "t-test" ? setTTest({ ...tTest, groupA: event.target.value }) : testType === "mann-whitney" ? setMannWhitney({ ...mannWhitney, groupA: event.target.value }) : setKsTest({ ...ksTest, groupA: event.target.value }))} className={fieldClass}>{(groupOptions[(testType === "t-test" ? tTest : testType === "mann-whitney" ? mannWhitney : ksTest).group] ?? []).map((value) => <option key={value} value={value}>{value}</option>)}</select>
                <select value={(testType === "t-test" ? tTest : testType === "mann-whitney" ? mannWhitney : ksTest).groupB} onChange={(event) => (testType === "t-test" ? setTTest({ ...tTest, groupB: event.target.value }) : testType === "mann-whitney" ? setMannWhitney({ ...mannWhitney, groupB: event.target.value }) : setKsTest({ ...ksTest, groupB: event.target.value }))} className={fieldClass}>{(groupOptions[(testType === "t-test" ? tTest : testType === "mann-whitney" ? mannWhitney : ksTest).group] ?? []).map((value) => <option key={value} value={value}>{value}</option>)}</select>
                <select value={(testType === "t-test" ? tTest : testType === "mann-whitney" ? mannWhitney : ksTest).alternative} onChange={(event) => (testType === "t-test" ? setTTest({ ...tTest, alternative: event.target.value as Alternative }) : testType === "mann-whitney" ? setMannWhitney({ ...mannWhitney, alternative: event.target.value as Alternative }) : setKsTest({ ...ksTest, alternative: event.target.value as Alternative }))} className={fieldClass}>
                  <option value="two-sided">Two-sided</option>
                  <option value="greater">Greater</option>
                  <option value="less">Less</option>
                </select>
                <select value={String((testType === "t-test" ? tTest : testType === "mann-whitney" ? mannWhitney : ksTest).confidence)} onChange={(event) => (testType === "t-test" ? setTTest({ ...tTest, confidence: Number(event.target.value) }) : testType === "mann-whitney" ? setMannWhitney({ ...mannWhitney, confidence: Number(event.target.value) }) : setKsTest({ ...ksTest, confidence: Number(event.target.value) }))} className={fieldClass}>
                  <option value="0.9">90% confidence</option>
                  <option value="0.95">95% confidence</option>
                  <option value="0.99">99% confidence</option>
                </select>
              </div>
            )}

            {testType === "chi-square" && (
              <div className="grid gap-4 md:grid-cols-2">
                <select value={chiSquare.left} onChange={(event) => setChiSquare({ ...chiSquare, left: event.target.value })} className={fieldClass}>{categoricalColumns.map((column) => <option key={column.name} value={column.name}>{column.name}</option>)}</select>
                <select value={chiSquare.right} onChange={(event) => setChiSquare({ ...chiSquare, right: event.target.value })} className={fieldClass}>{categoricalColumns.filter((column) => column.name !== chiSquare.left).map((column) => <option key={column.name} value={column.name}>{column.name}</option>)}</select>
                <select value={String(chiSquare.confidence)} onChange={(event) => setChiSquare({ ...chiSquare, confidence: Number(event.target.value) })} className={fieldClass}>
                  <option value="0.9">90% confidence</option>
                  <option value="0.95">95% confidence</option>
                  <option value="0.99">99% confidence</option>
                </select>
              </div>
            )}

            {testType === "anova" && (
              <div className="grid gap-4 md:grid-cols-2">
                <select value={anova.measure} onChange={(event) => setAnova({ ...anova, measure: event.target.value })} className={fieldClass}>{numericColumns.map((column) => <option key={column.name} value={column.name}>{column.name}</option>)}</select>
                <select value={anova.group} onChange={(event) => setAnova({ ...anova, group: event.target.value })} className={fieldClass}>{groupingColumns.map((column) => <option key={column.name} value={column.name}>{column.name}</option>)}</select>
                <label className="space-y-2 text-sm text-slate-600 dark:text-slate-300">
                  <span className="font-medium">Max groups: {anova.maxGroups}</span>
                  <input type="range" min={2} max={12} value={anova.maxGroups} onChange={(event) => setAnova({ ...anova, maxGroups: Number(event.target.value) })} className="w-full accent-cyan-500" />
                </label>
                <select value={String(anova.confidence)} onChange={(event) => setAnova({ ...anova, confidence: Number(event.target.value) })} className={fieldClass}>
                  <option value="0.9">90% confidence</option>
                  <option value="0.95">95% confidence</option>
                  <option value="0.99">99% confidence</option>
                </select>
              </div>
            )}
          </div>

          {notice && <div className={`rounded-2xl border px-4 py-3 text-sm ${notice.tone === "error" ? "border-rose-400/40 bg-rose-500/10 text-rose-700 dark:text-rose-300" : "border-cyan-400/40 bg-cyan-500/10 text-cyan-700 dark:text-cyan-300"}`}>{notice.message}</div>}

          <AnimatePresence mode="wait">
            {result && (
              <motion.div key={result.id} initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -12 }} transition={{ duration: 0.28, ease }} className="space-y-4 rounded-[26px] border border-slate-200/70 bg-gradient-to-br from-white/75 to-slate-100/55 p-5 dark:border-slate-800 dark:from-slate-950/60 dark:to-slate-900/35">
                <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">{TEST_META[result.type].label}</p>
                    <h3 className="mt-1 text-lg font-semibold text-slate-900 dark:text-white">{result.title}</h3>
                    <p className="mt-2 text-sm leading-6 text-slate-600 dark:text-slate-300">{result.interpretation}</p>
                  </div>
                  <div className={`inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-sm font-medium ${result.significant ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300" : "bg-amber-500/10 text-amber-700 dark:text-amber-300"}`}>
                    {result.significant ? <CheckCircle2 className="h-4 w-4" /> : <AlertTriangle className="h-4 w-4" />}
                    {result.significant ? "Signal detected" : "No strong signal"}
                  </div>
                </div>

                <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                  {[{ label: result.statisticLabel, value: formatMetric(result.statistic, 4), icon: Activity }, { label: "p-value", value: formatPValue(result.pValue), icon: Sigma }, { label: result.effectLabel, value: formatMetric(result.effectSize, 4), icon: FlaskConical }, { label: "Confidence interval", value: result.confidenceInterval ? `${formatMetric(result.confidenceInterval[0], 3)} to ${formatMetric(result.confidenceInterval[1], 3)}` : "n/a", icon: CheckCircle2 }].map((card) => <div key={card.label} className="rounded-2xl border border-white/25 bg-white/70 p-4 dark:border-white/10 dark:bg-slate-950/40"><div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400"><card.icon className="h-3.5 w-3.5" />{card.label}</div><p className="mt-3 text-xl font-semibold text-slate-900 dark:text-white">{card.value}</p></div>)}
                </div>

                <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                  {result.details.map((detail) => (
                    <div key={detail.label} className="rounded-2xl border border-slate-200/70 bg-slate-50/70 px-4 py-3 dark:border-slate-800 dark:bg-slate-900/30">
                      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">{detail.label}</p>
                      <p className="mt-2 text-sm font-medium text-slate-900 dark:text-white">{detail.value}</p>
                    </div>
                  ))}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
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
            {activeGroupOptions.length > 0 && (
              <div className="mt-4 rounded-2xl border border-cyan-400/20 bg-cyan-500/10 px-4 py-3 text-xs text-cyan-800 dark:text-cyan-200">
                Loaded group values for {tTest.group}: {activeGroupOptions.slice(0, 6).join(", ")}
              </div>
            )}
          </div>
        </div>
      </div>
    </motion.section>
  );
}
