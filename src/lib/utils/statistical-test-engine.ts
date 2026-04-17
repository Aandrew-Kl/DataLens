import { quoteIdentifier } from "@/lib/utils/sql";
import { runQuery } from "@/lib/duckdb/client";
import { formatNumber } from "@/lib/utils/formatters";

export type TestType = "t-test" | "chi-square" | "anova" | "mann-whitney" | "kolmogorov-smirnov";
export type Alternative = "two-sided" | "greater" | "less";

export interface TestResult {
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

export interface GroupConfig {
  measure: string;
  group: string;
  groupA: string;
  groupB: string;
  confidence: number;
  alternative: Alternative;
}

export interface ChiSquareConfig {
  left: string;
  right: string;
  confidence: number;
}

export interface AnovaConfig {
  measure: string;
  group: string;
  confidence: number;
  maxGroups: number;
}
function quoteLiteral(value: string) {
  return `'${value.replace(/'/g, "''")}'`;
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

function metric(value: number | null, digits = 3) {
  if (value == null || Number.isNaN(value)) return "n/a";
  if (Math.abs(value) >= 1000) return formatNumber(value);
  return value.toFixed(digits);
}

function criticalValue(confidence: number) {
  if (confidence >= 0.99) return 2.576;
  if (confidence >= 0.95) return 1.96;
  if (confidence >= 0.9) return 1.645;
  return 1.282;
}

function erf(value: number) {
  const sign = value < 0 ? -1 : 1;
  const x = Math.abs(value);
  const t = 1 / (1 + 0.3275911 * x);
  const y = 1 - (((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x));
  return sign * y;
}

function normalCdf(value: number) {
  return 0.5 * (1 + erf(value / Math.SQRT2));
}

function logGamma(value: number): number {
  const coeffs = [676.5203681218851, -1259.1392167224028, 771.3234287776531, -176.6150291621406, 12.507343278686905, -0.13857109526572012, 9.984369578019572e-6, 1.5056327351493116e-7];
  if (value < 0.5) return Math.log(Math.PI) - Math.log(Math.sin(Math.PI * value)) - logGamma(1 - value);
  let x = 0.9999999999998099;
  const z = value - 1;
  for (let index = 0; index < coeffs.length; index += 1) x += coeffs[index] / (z + index + 1);
  const t = z + coeffs.length - 0.5;
  return 0.9189385332046727 + (z + 0.5) * Math.log(t) - t + Math.log(x);
}

function regularizedBeta(x: number, a: number, b: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  if (x > (a + 1) / (a + b + 2)) return 1 - regularizedBeta(1 - x, b, a);
  const front = Math.exp(a * Math.log(x) + b * Math.log(1 - x) - Math.log(a) - logGamma(a) - logGamma(b) + logGamma(a + b));
  let c = 1;
  let d = 1 - ((a + b) * x) / (a + 1);
  if (Math.abs(d) < 1e-30) d = 1e-30;
  d = 1 / d;
  let fraction = d;
  for (let step = 1; step <= 120; step += 1) {
    const m2 = step * 2;
    let numerator = (step * (b - step) * x) / ((a + m2 - 1) * (a + m2));
    d = 1 + numerator * d; c = 1 + numerator / c;
    if (Math.abs(d) < 1e-30) d = 1e-30;
    if (Math.abs(c) < 1e-30) c = 1e-30;
    d = 1 / d; fraction *= d * c;
    numerator = -((a + step) * (a + b + step) * x) / ((a + m2) * (a + m2 + 1));
    d = 1 + numerator * d; c = 1 + numerator / c;
    if (Math.abs(d) < 1e-30) d = 1e-30;
    if (Math.abs(c) < 1e-30) c = 1e-30;
    d = 1 / d;
    const delta = d * c;
    fraction *= delta;
    if (Math.abs(delta - 1) < 1e-9) break;
  }
  return front * fraction;
}

function tPValue(statistic: number, degreesOfFreedom: number, alternative: Alternative) {
  if (!Number.isFinite(statistic) || degreesOfFreedom <= 0) return null;
  const tail = 0.5 * regularizedBeta(degreesOfFreedom / (degreesOfFreedom + statistic * statistic), degreesOfFreedom / 2, 0.5);
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
  const transformed = (Math.pow(statistic / degreesOfFreedom, 1 / 3) - (1 - 2 / (9 * degreesOfFreedom))) / Math.sqrt(2 / (9 * degreesOfFreedom));
  return clamp(1 - normalCdf(transformed), 0, 1);
}

function normalPValue(z: number, alternative: Alternative) {
  const oneTail = 1 - normalCdf(Math.abs(z));
  if (alternative === "greater") return z >= 0 ? oneTail : 1 - oneTail;
  if (alternative === "less") return z <= 0 ? oneTail : 1 - oneTail;
  return clamp(2 * oneTail, 0, 1);
}

function effectLabel(type: TestType, value: number | null) {
  if (value == null) return "Effect size unavailable";
  const magnitude = Math.abs(value);
  if (type === "chi-square") return magnitude >= 0.5 ? "Strong association" : magnitude >= 0.3 ? "Moderate association" : magnitude >= 0.1 ? "Weak association" : "Tiny association";
  if (type === "anova") return magnitude >= 0.14 ? "Large effect" : magnitude >= 0.06 ? "Medium effect" : magnitude >= 0.01 ? "Small effect" : "Tiny effect";
  if (type === "kolmogorov-smirnov") return magnitude >= 0.35 ? "Large distribution shift" : magnitude >= 0.2 ? "Moderate distribution shift" : magnitude >= 0.1 ? "Small distribution shift" : "Tiny distribution shift";
  return magnitude >= 0.8 ? "Large effect" : magnitude >= 0.5 ? "Medium effect" : magnitude >= 0.2 ? "Small effect" : "Tiny effect";
}

export async function runTTest(tableName: string, config: GroupConfig): Promise<TestResult> {
  if (!config.measure || !config.group || !config.groupA || !config.groupB || config.groupA === config.groupB) throw new Error("Pick a numeric measure and two distinct groups for the t-test.");
  const sql = `WITH sample AS (SELECT CAST(${quoteIdentifier(config.measure)} AS DOUBLE) AS value, CAST(${quoteIdentifier(config.group)} AS VARCHAR) AS grp FROM ${quoteIdentifier(tableName)} WHERE ${quoteIdentifier(config.measure)} IS NOT NULL AND ${quoteIdentifier(config.group)} IS NOT NULL AND CAST(${quoteIdentifier(config.group)} AS VARCHAR) IN (${quoteLiteral(config.groupA)}, ${quoteLiteral(config.groupB)})) SELECT grp, COUNT(*) AS n, AVG(value) AS mean, VAR_SAMP(value) AS variance FROM sample GROUP BY 1 ORDER BY grp`;
  const rows = await runQuery(sql);
  const first = rows.find((row) => String(row.grp) === config.groupA);
  const second = rows.find((row) => String(row.grp) === config.groupB);
  const n1 = Number(first?.n ?? 0); const n2 = Number(second?.n ?? 0);
  const mean1 = toNumber(first?.mean) ?? 0; const mean2 = toNumber(second?.mean) ?? 0;
  const variance1 = toNumber(first?.variance) ?? 0; const variance2 = toNumber(second?.variance) ?? 0;
  if (n1 < 2 || n2 < 2) throw new Error("Each group needs at least two numeric observations for a t-test.");
  const diff = mean1 - mean2;
  const standardError = Math.sqrt(variance1 / n1 + variance2 / n2);
  const statistic = standardError === 0 ? 0 : diff / standardError;
  const numerator = Math.pow(variance1 / n1 + variance2 / n2, 2);
  const denominator = (Math.pow(variance1 / n1, 2) / (n1 - 1)) + (Math.pow(variance2 / n2, 2) / (n2 - 1));
  const degreesOfFreedom = denominator === 0 ? n1 + n2 - 2 : numerator / denominator;
  const pooled = Math.sqrt((((n1 - 1) * variance1) + ((n2 - 1) * variance2)) / Math.max(n1 + n2 - 2, 1));
  const effectSize = pooled > 0 ? diff / pooled : null;
  const ci = standardError > 0 ? [diff - criticalValue(config.confidence) * standardError, diff + criticalValue(config.confidence) * standardError] as [number, number] : null;
  const pValue = tPValue(statistic, degreesOfFreedom, config.alternative);
  const significant = (pValue ?? 1) < 1 - config.confidence;
  return { id: makeId(), type: "t-test", title: `${config.measure}: ${config.groupA} vs ${config.groupB}`, statisticLabel: "t statistic", statistic, pValue, confidenceInterval: ci, effectLabel: "Cohen's d", effectSize, significant, interpretation: significant ? `There is evidence that ${config.measure} differs between ${config.groupA} and ${config.groupB}. ${effectLabel("t-test", effectSize)}.` : `The observed mean gap in ${config.measure} is not statistically strong enough to separate ${config.groupA} from ${config.groupB}.`, details: [{ label: `${config.groupA} mean`, value: metric(mean1) }, { label: `${config.groupB} mean`, value: metric(mean2) }, { label: "Mean difference", value: metric(diff) }, { label: "Degrees of freedom", value: metric(degreesOfFreedom, 2) }], sql, runAt: Date.now() };
}

export async function runChiSquare(tableName: string, config: ChiSquareConfig): Promise<TestResult> {
  if (!config.left || !config.right || config.left === config.right) throw new Error("Choose two different categorical columns for the chi-square test.");
  const sql = `SELECT CAST(${quoteIdentifier(config.left)} AS VARCHAR) AS left_value, CAST(${quoteIdentifier(config.right)} AS VARCHAR) AS right_value, COUNT(*) AS cell_count FROM ${quoteIdentifier(tableName)} WHERE ${quoteIdentifier(config.left)} IS NOT NULL AND ${quoteIdentifier(config.right)} IS NOT NULL GROUP BY 1, 2`;
  const rows = await runQuery(sql);
  if (rows.length < 2) throw new Error("The selected columns do not form a usable contingency table.");
  const rowTotals = new Map<string, number>(); const columnTotals = new Map<string, number>(); let total = 0;
  for (const row of rows) {
    const left = String(row.left_value ?? "unknown");
    const right = String(row.right_value ?? "unknown");
    const count = Number(row.cell_count ?? 0);
    total += count;
    rowTotals.set(left, (rowTotals.get(left) ?? 0) + count);
    columnTotals.set(right, (columnTotals.get(right) ?? 0) + count);
  }
  const statistic = rows.reduce((sum, row) => {
    const left = String(row.left_value ?? "unknown");
    const right = String(row.right_value ?? "unknown");
    const observed = Number(row.cell_count ?? 0);
    const expected = ((rowTotals.get(left) ?? 0) * (columnTotals.get(right) ?? 0)) / Math.max(total, 1);
    return expected > 0 ? sum + Math.pow(observed - expected, 2) / expected : sum;
  }, 0);
  const degreesOfFreedom = Math.max((rowTotals.size - 1) * (columnTotals.size - 1), 1);
  const pValue = chiSquarePValue(statistic, degreesOfFreedom);
  const effectSize = Math.sqrt(statistic / (Math.max(total, 1) * Math.max(Math.min(rowTotals.size - 1, columnTotals.size - 1), 1)));
  const significant = (pValue ?? 1) < 1 - config.confidence;
  return { id: makeId(), type: "chi-square", title: `${config.left} x ${config.right}`, statisticLabel: "Chi-square", statistic, pValue, confidenceInterval: null, effectLabel: "Cramer's V", effectSize, significant, interpretation: significant ? `The category mix in ${config.left} changes meaningfully across ${config.right}. ${effectLabel("chi-square", effectSize)}.` : `The contingency table does not show a strong enough association between ${config.left} and ${config.right}.`, details: [{ label: "Rows in table", value: formatNumber(total) }, { label: "Distinct left values", value: String(rowTotals.size) }, { label: "Distinct right values", value: String(columnTotals.size) }, { label: "Degrees of freedom", value: String(degreesOfFreedom) }], sql, runAt: Date.now() };
}

export async function runAnova(tableName: string, config: AnovaConfig): Promise<TestResult> {
  if (!config.measure || !config.group) throw new Error("Pick a numeric measure and a grouping column for ANOVA.");
  const sql = `WITH counts AS (SELECT CAST(${quoteIdentifier(config.group)} AS VARCHAR) AS grp, COUNT(*) AS cnt FROM ${quoteIdentifier(tableName)} WHERE ${quoteIdentifier(config.measure)} IS NOT NULL AND ${quoteIdentifier(config.group)} IS NOT NULL GROUP BY 1 ORDER BY cnt DESC LIMIT ${clamp(config.maxGroups, 2, 12)}), sample AS (SELECT CAST(${quoteIdentifier(config.measure)} AS DOUBLE) AS value, CAST(${quoteIdentifier(config.group)} AS VARCHAR) AS grp FROM ${quoteIdentifier(tableName)} WHERE ${quoteIdentifier(config.measure)} IS NOT NULL AND ${quoteIdentifier(config.group)} IS NOT NULL AND CAST(${quoteIdentifier(config.group)} AS VARCHAR) IN (SELECT grp FROM counts)) SELECT grp, COUNT(*) AS n, AVG(value) AS mean, VAR_SAMP(value) AS variance FROM sample GROUP BY 1 ORDER BY n DESC, grp ASC`;
  const rows = await runQuery(sql);
  if (rows.length < 2) throw new Error("ANOVA needs at least two populated groups.");
  const groups = rows.map((row) => ({ group: String(row.grp ?? ""), n: Number(row.n ?? 0), mean: toNumber(row.mean) ?? 0, variance: toNumber(row.variance) ?? 0 })).filter((row) => row.n > 0);
  const totalN = groups.reduce((sum, row) => sum + row.n, 0);
  if (groups.length < 2 || totalN <= groups.length) throw new Error("There is not enough data to estimate within-group variance.");
  const grandMean = groups.reduce((sum, row) => sum + row.mean * row.n, 0) / totalN;
  const ssBetween = groups.reduce((sum, row) => sum + row.n * Math.pow(row.mean - grandMean, 2), 0);
  const ssWithin = groups.reduce((sum, row) => sum + Math.max(row.n - 1, 0) * row.variance, 0);
  const df1 = groups.length - 1; const df2 = totalN - groups.length;
  const statistic = (ssWithin / Math.max(df2, 1)) === 0 ? 0 : (ssBetween / Math.max(df1, 1)) / (ssWithin / Math.max(df2, 1));
  const pValue = fPValue(statistic, df1, df2);
  const effectSize = (ssBetween + ssWithin) > 0 ? ssBetween / (ssBetween + ssWithin) : null;
  const significant = (pValue ?? 1) < 1 - config.confidence;
  return { id: makeId(), type: "anova", title: `${config.measure} by ${config.group}`, statisticLabel: "F statistic", statistic, pValue, confidenceInterval: null, effectLabel: "Eta squared", effectSize, significant, interpretation: significant ? `At least one ${config.group} segment has a meaningfully different mean ${config.measure}. ${effectLabel("anova", effectSize)}.` : `The observed group means for ${config.measure} stay within the range expected from within-group variation.`, details: [{ label: "Groups tested", value: String(groups.length) }, { label: "Grand mean", value: metric(grandMean) }, { label: "Between-group SS", value: metric(ssBetween, 2) }, { label: "Residual df", value: String(df2) }], sql, runAt: Date.now() };
}

export async function runMannWhitney(tableName: string, config: GroupConfig): Promise<TestResult> {
  if (!config.measure || !config.group || !config.groupA || !config.groupB || config.groupA === config.groupB) throw new Error("Pick a numeric measure and two distinct groups for Mann-Whitney U.");
  const sql = `WITH sample AS (SELECT CAST(${quoteIdentifier(config.measure)} AS DOUBLE) AS value, CAST(${quoteIdentifier(config.group)} AS VARCHAR) AS grp FROM ${quoteIdentifier(tableName)} WHERE ${quoteIdentifier(config.measure)} IS NOT NULL AND ${quoteIdentifier(config.group)} IS NOT NULL AND CAST(${quoteIdentifier(config.group)} AS VARCHAR) IN (${quoteLiteral(config.groupA)}, ${quoteLiteral(config.groupB)})), ranked AS (SELECT value, grp, AVG(rank_value) OVER (PARTITION BY value) AS avg_rank FROM (SELECT value, grp, RANK() OVER (ORDER BY value) AS rank_value FROM sample)) SELECT grp, COUNT(*) AS n, SUM(avg_rank) AS rank_sum, AVG(value) AS mean_value FROM ranked GROUP BY 1 ORDER BY grp`;
  const rows = await runQuery(sql);
  const first = rows.find((row) => String(row.grp) === config.groupA);
  const second = rows.find((row) => String(row.grp) === config.groupB);
  const n1 = Number(first?.n ?? 0); const n2 = Number(second?.n ?? 0);
  if (n1 === 0 || n2 === 0) throw new Error("Each group needs at least one observation for Mann-Whitney U.");
  const rankSum1 = toNumber(first?.rank_sum) ?? 0;
  const u1 = rankSum1 - (n1 * (n1 + 1)) / 2; const u2 = n1 * n2 - u1; const statistic = Math.min(u1, u2);
  const meanU = (n1 * n2) / 2; const stdU = Math.sqrt((n1 * n2 * (n1 + n2 + 1)) / 12); const z = stdU === 0 ? 0 : (statistic - meanU) / stdU;
  const pValue = normalPValue(z, config.alternative);
  const effectSize = Math.abs(z) / Math.sqrt(n1 + n2);
  const significant = (pValue ?? 1) < 1 - config.confidence;
  return { id: makeId(), type: "mann-whitney", title: `${config.measure}: ${config.groupA} vs ${config.groupB}`, statisticLabel: "U statistic", statistic, pValue, confidenceInterval: null, effectLabel: "Rank-biserial proxy", effectSize, significant, interpretation: significant ? `The rank ordering of ${config.measure} differs between ${config.groupA} and ${config.groupB}. ${effectLabel("mann-whitney", effectSize)}.` : `The two groups have similar rank distributions for ${config.measure}.`, details: [{ label: `${config.groupA} rows`, value: formatNumber(n1) }, { label: `${config.groupB} rows`, value: formatNumber(n2) }, { label: "z score", value: metric(z) }, { label: `${config.groupA} mean`, value: metric(toNumber(first?.mean_value)) }], sql, runAt: Date.now() };
}

export async function runKolmogorovSmirnov(tableName: string, config: GroupConfig): Promise<TestResult> {
  if (!config.measure || !config.group || !config.groupA || !config.groupB || config.groupA === config.groupB) throw new Error("Pick a numeric measure and two distinct groups for the Kolmogorov-Smirnov test.");
  const sql = `WITH sample AS (SELECT CAST(${quoteIdentifier(config.measure)} AS DOUBLE) AS value, CAST(${quoteIdentifier(config.group)} AS VARCHAR) AS grp FROM ${quoteIdentifier(tableName)} WHERE ${quoteIdentifier(config.measure)} IS NOT NULL AND ${quoteIdentifier(config.group)} IS NOT NULL AND CAST(${quoteIdentifier(config.group)} AS VARCHAR) IN (${quoteLiteral(config.groupA)}, ${quoteLiteral(config.groupB)})), a AS (SELECT value, CUME_DIST() OVER (ORDER BY value) AS ecdf_a FROM sample WHERE grp = ${quoteLiteral(config.groupA)}), b AS (SELECT value, CUME_DIST() OVER (ORDER BY value) AS ecdf_b FROM sample WHERE grp = ${quoteLiteral(config.groupB)}), points AS (SELECT value FROM a UNION SELECT value FROM b), joined AS (SELECT p.value, COALESCE((SELECT MAX(ecdf_a) FROM a WHERE a.value <= p.value), 0) AS fa, COALESCE((SELECT MAX(ecdf_b) FROM b WHERE b.value <= p.value), 0) AS fb FROM points p) SELECT MAX(ABS(fa - fb)) AS d_stat, (SELECT COUNT(*) FROM a) AS n1, (SELECT COUNT(*) FROM b) AS n2 FROM joined`;
  const row = (await runQuery(sql))[0] ?? {};
  const statistic = toNumber(row.d_stat) ?? 0; const n1 = Number(row.n1 ?? 0); const n2 = Number(row.n2 ?? 0);
  if (n1 === 0 || n2 === 0) throw new Error("Each group needs data to compare distributions.");
  const effectiveN = (n1 * n2) / (n1 + n2);
  const lambda = (Math.sqrt(effectiveN) + 0.12 + 0.11 / Math.sqrt(Math.max(effectiveN, 1))) * statistic;
  const pValue = clamp(2 * Math.exp(-2 * lambda * lambda), 0, 1);
  const significant = pValue < 1 - config.confidence;
  return { id: makeId(), type: "kolmogorov-smirnov", title: `${config.measure}: ${config.groupA} vs ${config.groupB}`, statisticLabel: "D statistic", statistic, pValue, confidenceInterval: null, effectLabel: "Distribution distance", effectSize: statistic, significant, interpretation: significant ? `The full distribution of ${config.measure} shifts between ${config.groupA} and ${config.groupB}. ${effectLabel("kolmogorov-smirnov", statistic)}.` : `The empirical distributions of ${config.measure} stay close across the two selected groups.`, details: [{ label: `${config.groupA} rows`, value: formatNumber(n1) }, { label: `${config.groupB} rows`, value: formatNumber(n2) }, { label: "Effective n", value: metric(effectiveN, 1) }, { label: "Confidence level", value: `${Math.round(config.confidence * 100)}%` }], sql, runAt: Date.now() };
}
