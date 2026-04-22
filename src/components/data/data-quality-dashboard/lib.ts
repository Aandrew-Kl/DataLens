export function getColumnAlias(index: number, suffix: string) {
  return `c${index}_${suffix}`;
}

export function asNumber(value: unknown) {
  const numeric = value == null ? Number.NaN : Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
}

export function asText(value: unknown) {
  return value == null ? null : String(value);
}

export function clampScore(value: number) {
  return Math.max(0, Math.min(100, Number.isFinite(value) ? value : 0));
}

export function formatPercent(value: number, digits = 1) {
  return `${clampScore(value).toFixed(digits)}%`;
}

export function formatDateTime(value: string | null) {
  if (!value) return "—";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(parsed);
}

export function getGaugeColor(score: number) {
  if (score >= 90) return "#10b981";
  if (score >= 75) return "#f59e0b";
  return "#f97316";
}

export function getScoreTone(score: number) {
  if (score >= 90) {
    return "text-emerald-600 dark:text-emerald-300";
  }
  if (score >= 75) {
    return "text-amber-600 dark:text-amber-300";
  }
  return "text-orange-600 dark:text-orange-300";
}

export function getQualityLabel(score: number) {
  if (score >= 94) return "Exceptional";
  if (score >= 86) return "Strong";
  if (score >= 74) return "Watchlist";
  if (score > 0) return "Needs attention";
  return "No data";
}

export function average(values: number[]) {
  if (!values.length) return 100;
  return clampScore(values.reduce((sum, value) => sum + value, 0) / values.length);
}
