"use client";

import {
  AnimatePresence,
  motion,
} from "framer-motion";
import {
  Suspense,
  startTransition,
  use,
  useMemo,
  useState,
} from "react";
import {
  ArrowLeft,
  ArrowRight,
  BarChart3,
  Binary,
  CheckCircle2,
  Loader2,
  ScanSearch,
  SkipForward,
  Sparkles,
} from "lucide-react";
import { runQuery } from "@/lib/duckdb/client";
import { formatNumber, formatPercent } from "@/lib/utils/formatters";
import type { ColumnProfile } from "@/types/dataset";

interface DataTourProps {
  tableName: string;
  columns: ColumnProfile[];
}

interface CorrelationInsight {
  left: string;
  right: string;
  correlation: number;
  pairCount: number;
}

interface CategoryDistribution {
  column: string;
  rows: Array<{ label: string; count: number }>;
}

interface TourInsights {
  rowCount: number;
  completeness: number;
  nullHotspots: Array<{ name: string; nullCount: number; missingRate: number }>;
  correlation: CorrelationInsight | null;
  categoryDistribution: CategoryDistribution | null;
  numericHighlight: ColumnProfile | null;
  dateHighlight: ColumnProfile | null;
  identifierColumn: ColumnProfile | null;
  typeMix: Array<{ label: string; value: number; color: string }>;
  patternHint: string | null;
}

type TourVisual =
  | {
      kind: "type-mix";
      items: Array<{ label: string; value: number; color: string }>;
    }
  | {
      kind: "missing";
      items: Array<{ label: string; rate: number; count: number }>;
    }
  | {
      kind: "correlation";
      correlation: number;
      left: string;
      right: string;
      coverage: number;
    }
  | {
      kind: "distribution";
      column: string;
      items: Array<{ label: string; value: number }>;
    }
  | {
      kind: "identifier";
      samples: string[];
    }
  | {
      kind: "timeline";
      start: string;
      end: string;
    }
  | {
      kind: "actions";
      items: string[];
    };

interface TourStep {
  id: string;
  eyebrow: string;
  title: string;
  description: string;
  factoid: string;
  visual: TourVisual;
}

const EASE = [0.22, 1, 0.36, 1] as const;
const PANEL_CLASS =
  "overflow-hidden rounded-[1.9rem] border border-white/20 bg-white/75 shadow-[0_24px_90px_-48px_rgba(15,23,42,0.75)] backdrop-blur-2xl dark:border-white/10 dark:bg-slate-950/45";

function quoteIdentifier(value: string) {
  return `"${value.replaceAll('"', '""')}"`;
}

function toNumber(value: unknown) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function detectPatternHint(column: ColumnProfile | undefined) {
  const samples = column?.sampleValues ?? [];
  if (samples.some((value) => /@/.test(String(value ?? "")))) {
    return `${column?.name ?? "This field"} contains email-like patterns.`;
  }
  if (samples.some((value) => /^https?:\/\//i.test(String(value ?? "")))) {
    return `${column?.name ?? "This field"} contains URL-like patterns.`;
  }
  if (samples.some((value) => /^[A-Z]{2,5}-\d+/i.test(String(value ?? "")))) {
    return `${column?.name ?? "This field"} looks like a coded identifier column.`;
  }
  return null;
}

function correlationNarrative(value: number) {
  const magnitude = Math.abs(value);
  if (magnitude >= 0.75) {
    return value > 0 ? "a strong positive relationship" : "a strong negative relationship";
  }
  if (magnitude >= 0.45) {
    return value > 0 ? "a moderate positive relationship" : "a moderate negative relationship";
  }
  if (magnitude >= 0.2) {
    return value > 0 ? "a weak positive relationship" : "a weak negative relationship";
  }
  return "very little linear relationship";
}

async function loadTourInsights(
  tableName: string,
  columns: ColumnProfile[],
): Promise<TourInsights> {
  const numericColumns = columns
    .filter((column) => column.type === "number")
    .sort((left, right) => left.nullCount - right.nullCount)
    .slice(0, 6);
  const categoryCandidate = columns.find(
    (column) =>
      (column.type === "string" || column.type === "boolean") &&
      column.uniqueCount > 1 &&
      column.uniqueCount <= 12,
  );
  const rowCountRows = await runQuery(
    `SELECT COUNT(*) AS row_count FROM ${quoteIdentifier(tableName)}`,
  );
  const rowCount = Number(rowCountRows[0]?.row_count ?? 0);
  const totalCells = rowCount * Math.max(columns.length, 1);
  const totalNulls = columns.reduce((sum, column) => sum + column.nullCount, 0);
  const completeness = totalCells > 0 ? ((totalCells - totalNulls) / totalCells) * 100 : 100;

  const correlationPairs = numericColumns.flatMap((left, leftIndex) =>
    numericColumns.slice(leftIndex + 1).map((right) => ({ left, right })),
  );
  const correlation =
    correlationPairs.length === 0
      ? null
      : await (async () => {
          const unionSql = correlationPairs
            .map(
              ({ left, right }) => `
                SELECT
                  ${quoteLiteral(left.name)} AS left_name,
                  ${quoteLiteral(right.name)} AS right_name,
                  CORR(TRY_CAST(${quoteIdentifier(left.name)} AS DOUBLE), TRY_CAST(${quoteIdentifier(right.name)} AS DOUBLE)) AS corr_value,
                  COUNT(*) AS pair_count
                FROM ${quoteIdentifier(tableName)}
                WHERE ${quoteIdentifier(left.name)} IS NOT NULL
                  AND ${quoteIdentifier(right.name)} IS NOT NULL
                  AND TRY_CAST(${quoteIdentifier(left.name)} AS DOUBLE) IS NOT NULL
                  AND TRY_CAST(${quoteIdentifier(right.name)} AS DOUBLE) IS NOT NULL
              `,
            )
            .join(" UNION ALL ");

          const rows = await runQuery(
            `SELECT * FROM (${unionSql}) AS corr_pairs ORDER BY ABS(corr_value) DESC NULLS LAST LIMIT 1`,
          );
          const first = rows[0];
          const corrValue = toNumber(first?.corr_value);
          if (!first || corrValue == null) return null;
          return {
            left: String(first.left_name ?? ""),
            right: String(first.right_name ?? ""),
            correlation: corrValue,
            pairCount: Number(first.pair_count ?? 0),
          } satisfies CorrelationInsight;
        })();

  const categoryDistribution =
    categoryCandidate == null
      ? null
      : await (async () => {
          const rows = await runQuery(`
            SELECT
              CAST(${quoteIdentifier(categoryCandidate.name)} AS VARCHAR) AS label,
              COUNT(*) AS value_count
            FROM ${quoteIdentifier(tableName)}
            WHERE ${quoteIdentifier(categoryCandidate.name)} IS NOT NULL
            GROUP BY 1
            ORDER BY value_count DESC, label
            LIMIT 5
          `);

          return {
            column: categoryCandidate.name,
            rows: rows.map((row) => ({
              label: String(row.label ?? "(blank)"),
              count: Number(row.value_count ?? 0),
            })),
          } satisfies CategoryDistribution;
        })();

  return {
    rowCount,
    completeness,
    nullHotspots: [...columns]
      .sort((left, right) => right.nullCount - left.nullCount)
      .slice(0, 4)
      .filter((column) => column.nullCount > 0)
      .map((column) => ({
        name: column.name,
        nullCount: column.nullCount,
        missingRate: rowCount > 0 ? (column.nullCount / rowCount) * 100 : 0,
      })),
    correlation,
    categoryDistribution,
    numericHighlight:
      [...numericColumns].sort((left, right) => {
        const leftRange =
          typeof left.min === "number" && typeof left.max === "number" ? left.max - left.min : 0;
        const rightRange =
          typeof right.min === "number" && typeof right.max === "number"
            ? right.max - right.min
            : 0;
        return rightRange - leftRange;
      })[0] ?? null,
    dateHighlight: columns.find((column) => column.type === "date") ?? null,
    identifierColumn:
      columns.find(
        (column) => rowCount > 0 && column.uniqueCount / rowCount >= 0.85,
      ) ?? null,
    typeMix: [
      {
        label: "Numeric",
        value: columns.filter((column) => column.type === "number").length,
        color: "#06b6d4",
      },
      {
        label: "Text",
        value: columns.filter((column) => column.type === "string").length,
        color: "#34d399",
      },
      {
        label: "Date",
        value: columns.filter((column) => column.type === "date").length,
        color: "#f59e0b",
      },
      {
        label: "Other",
        value: columns.filter(
          (column) => column.type === "boolean" || column.type === "unknown",
        ).length,
        color: "#a78bfa",
      },
    ],
    patternHint: detectPatternHint(columns.find((column) => column.type === "string")),
  };
}

function buildNextMoves(insights: TourInsights, columns: ColumnProfile[]) {
  const moves: string[] = [];
  if (insights.nullHotspots.length > 0) {
    moves.push(`Clean ${insights.nullHotspots[0].name} before final reporting.`);
  }
  if (insights.correlation) {
    moves.push(
      `Plot ${insights.correlation.left} against ${insights.correlation.right} to confirm the correlation visually.`,
    );
  }
  if (insights.categoryDistribution) {
    moves.push(`Use ${insights.categoryDistribution.column} as a first segment for pivots or heatmaps.`);
  }
  if (insights.dateHighlight && columns.some((column) => column.type === "number")) {
    moves.push(`Pair ${insights.dateHighlight.name} with a numeric metric for a trend line.`);
  }
  if (moves.length === 0) {
    moves.push("Start with a column profile pass, then validate distributions and missingness.");
    moves.push("Use pivots to discover segments before building a dashboard.");
  }
  return moves.slice(0, 4);
}

function buildTourSteps(
  tableName: string,
  columns: ColumnProfile[],
  insights: TourInsights,
): TourStep[] {
  const primaryNull = insights.nullHotspots[0];
  const typeMixStep: TourStep = {
    id: "overview",
    eyebrow: "Dataset shape",
    title: `${tableName} at a glance`,
    description: `This table loads ${formatNumber(insights.rowCount)} rows across ${formatNumber(columns.length)} columns. The schema mixes ${insights.typeMix[0]?.value ?? 0} numeric fields, ${insights.typeMix[1]?.value ?? 0} text fields, and ${insights.typeMix[2]?.value ?? 0} date fields.`,
    factoid: `Did you know? Estimated completeness is ${formatPercent(insights.completeness, 1)} across the full cell grid.`,
    visual: {
      kind: "type-mix",
      items: insights.typeMix,
    },
  };

  const missingStep: TourStep = {
    id: "quality",
    eyebrow: "Data quality",
    title: primaryNull
      ? `${primaryNull.name} is the biggest missing-data hotspot`
      : "Missingness is relatively contained",
    description: primaryNull
      ? `${primaryNull.name} is missing in ${formatPercent(primaryNull.missingRate, 1)} of rows, which makes it the first field worth validating before you trust downstream summaries.`
      : "None of the tracked columns currently show obvious null concentration, so you can move quickly into distributions and segmentation.",
    factoid: primaryNull
      ? `Did you know? ${formatNumber(primaryNull.nullCount)} cells are null in ${primaryNull.name} alone.`
      : "Did you know? This table currently looks clean enough to explore without immediate imputation work.",
    visual: {
      kind: "missing",
      items: insights.nullHotspots.map((entry) => ({
        label: entry.name,
        rate: entry.missingRate,
        count: entry.nullCount,
      })),
    },
  };

  const relationshipStep: TourStep =
    insights.correlation != null
      ? {
          id: "correlation",
          eyebrow: "Interesting relationship",
          title: `${insights.correlation.left} and ${insights.correlation.right} move together`,
          description: `The strongest numeric pairing in the table is between ${insights.correlation.left} and ${insights.correlation.right}, with ${correlationNarrative(insights.correlation.correlation)} based on ${formatNumber(insights.correlation.pairCount)} paired rows.`,
          factoid: `Did you know? The measured correlation is ${insights.correlation.correlation.toFixed(3)}.`,
          visual: {
            kind: "correlation",
            correlation: insights.correlation.correlation,
            left: insights.correlation.left,
            right: insights.correlation.right,
            coverage:
              insights.rowCount > 0
                ? insights.correlation.pairCount / insights.rowCount
                : 0,
          },
        }
      : {
          id: "numeric-range",
          eyebrow: "Metric spread",
          title: insights.numericHighlight
            ? `${insights.numericHighlight.name} has the widest numeric spread`
            : "Numeric signals are limited",
          description: insights.numericHighlight
            ? `${insights.numericHighlight.name} ranges from ${String(insights.numericHighlight.min ?? "n/a")} to ${String(insights.numericHighlight.max ?? "n/a")}, which makes it a good target for histogram and outlier review.`
            : "There are not enough numeric fields to surface a meaningful correlation or range story yet.",
          factoid: insights.numericHighlight?.median != null
            ? `Did you know? The median of ${insights.numericHighlight.name} is ${formatNumber(insights.numericHighlight.median)}.`
            : "Did you know? Adding just two clean numeric columns unlocks correlation and box plot analysis immediately.",
          visual: {
            kind: "actions",
            items: ["Run a histogram", "Compare quartiles", "Check outliers"],
          },
        };

  const patternStep: TourStep =
    insights.categoryDistribution != null
      ? {
          id: "distribution",
          eyebrow: "Unique pattern",
          title: `${insights.categoryDistribution.column} is already a good slice`,
          description: `${insights.categoryDistribution.column} has a compact category footprint, which makes it a natural dimension for pivots, cohort comparisons, and heatmaps.`,
          factoid: `Did you know? The leading category currently accounts for ${formatPercent(
            insights.rowCount > 0
              ? (insights.categoryDistribution.rows[0]?.count ?? 0) / insights.rowCount * 100
              : 0,
            1,
          )} of rows.`,
          visual: {
            kind: "distribution",
            column: insights.categoryDistribution.column,
            items: insights.categoryDistribution.rows.map((row) => ({
              label: row.label,
              value: row.count,
            })),
          },
        }
      : insights.identifierColumn != null
        ? {
            id: "identifier",
            eyebrow: "Unique pattern",
            title: `${insights.identifierColumn.name} looks like a reliable key`,
            description: `${insights.identifierColumn.name} is unique across most rows, which is a strong sign that it can anchor joins, deduplication, and audit trails.`,
            factoid:
              insights.patternHint ??
              `Did you know? ${insights.identifierColumn.name} is unique in roughly ${formatPercent(
                insights.rowCount > 0
                  ? (insights.identifierColumn.uniqueCount / insights.rowCount) * 100
                  : 0,
                1,
              )} of rows.`,
            visual: {
              kind: "identifier",
              samples: insights.identifierColumn.sampleValues
                .slice(0, 5)
                .map((value) => String(value ?? "null")),
            },
          }
        : insights.dateHighlight != null
          ? {
              id: "timeline",
              eyebrow: "Unique pattern",
              title: `${insights.dateHighlight.name} unlocks a timeline view`,
              description: `${insights.dateHighlight.name} gives the dataset a natural temporal spine, which means trends, seasonality, and freshness checks are all available next.`,
              factoid: `Did you know? The observed range runs from ${String(insights.dateHighlight.min ?? "n/a")} to ${String(insights.dateHighlight.max ?? "n/a")}.`,
              visual: {
                kind: "timeline",
                start: String(insights.dateHighlight.min ?? "Start"),
                end: String(insights.dateHighlight.max ?? "End"),
              },
            }
          : {
              id: "next-up",
              eyebrow: "Unique pattern",
              title: "The next signal needs a manual slice",
              description: "No single category or identifier stands out immediately, so the best next step is to test a few pivots or filtered profiles to uncover structure.",
              factoid: "Did you know? Low-cardinality segments often emerge once text columns are cleaned or grouped.",
              visual: {
                kind: "actions",
                items: ["Try a pivot", "Group text values", "Scan top frequencies"],
              },
            };

  const actionStep: TourStep = {
    id: "actions",
    eyebrow: "What next",
    title: "Recommended next moves",
    description: "The fastest way to turn this tour into analysis is to start with one cleanup task, one relationship check, and one segmentation cut.",
    factoid: "Did you know? The best first dashboard usually comes after one pass through missingness and one pass through grouping.",
    visual: {
      kind: "actions",
      items: buildNextMoves(insights, columns),
    },
  };

  return [typeMixStep, missingStep, relationshipStep, patternStep, actionStep];
}

function TypeMixVisual({
  items,
}: {
  items: Array<{ label: string; value: number; color: string }>;
}) {
  const maxValue = Math.max(...items.map((item) => item.value), 1);
  return (
    <div className="space-y-3">
      {items.map((item) => (
        <div key={item.label}>
          <div className="mb-1 flex items-center justify-between text-sm text-slate-600 dark:text-slate-300">
            <span>{item.label}</span>
            <span className="font-semibold text-slate-950 dark:text-white">{item.value}</span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-white/70 dark:bg-slate-900/70">
            <div
              className="h-full rounded-full"
              style={{
                width: `${(item.value / maxValue) * 100}%`,
                backgroundColor: item.color,
              }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

function MissingVisual({
  items,
}: {
  items: Array<{ label: string; rate: number; count: number }>;
}) {
  if (items.length === 0) {
    return (
      <div className="rounded-2xl border border-emerald-400/25 bg-emerald-500/10 px-4 py-4 text-sm text-emerald-700 dark:text-emerald-300">
        No major null clusters were detected from the column profile.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {items.map((item) => (
        <div key={item.label}>
          <div className="mb-1 flex items-center justify-between text-sm text-slate-600 dark:text-slate-300">
            <span>{item.label}</span>
            <span className="font-semibold text-slate-950 dark:text-white">
              {formatPercent(item.rate, 1)}
            </span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-white/70 dark:bg-slate-900/70">
            <div
              className="h-full rounded-full bg-amber-500"
              style={{ width: `${Math.min(item.rate, 100)}%` }}
            />
          </div>
          <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            {formatNumber(item.count)} nulls
          </div>
        </div>
      ))}
    </div>
  );
}

function CorrelationVisual({
  correlation,
  left,
  right,
  coverage,
}: {
  correlation: number;
  left: string;
  right: string;
  coverage: number;
}) {
  const fill = `${Math.max(0, Math.min(Math.abs(correlation), 1)) * 100}%`;
  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-white/15 bg-white/55 p-4 dark:bg-slate-950/35">
        <div className="text-sm font-semibold text-slate-950 dark:text-white">
          {left} ↔ {right}
        </div>
        <div className="mt-3 h-3 overflow-hidden rounded-full bg-white/70 dark:bg-slate-900/70">
          <div
            className={`h-full rounded-full ${correlation >= 0 ? "bg-cyan-500" : "bg-rose-500"}`}
            style={{ width: fill }}
          />
        </div>
        <div className="mt-2 flex items-center justify-between text-sm text-slate-600 dark:text-slate-300">
          <span>Correlation</span>
          <span className="font-semibold text-slate-950 dark:text-white">
            {correlation.toFixed(3)}
          </span>
        </div>
        <div className="mt-1 flex items-center justify-between text-sm text-slate-600 dark:text-slate-300">
          <span>Coverage</span>
          <span>{formatPercent(coverage * 100, 1)}</span>
        </div>
      </div>
    </div>
  );
}

function DistributionVisual({
  column,
  items,
}: {
  column: string;
  items: Array<{ label: string; value: number }>;
}) {
  const maxValue = Math.max(...items.map((item) => item.value), 1);
  return (
    <div className="space-y-3">
      <div className="text-sm font-semibold text-slate-950 dark:text-white">{column}</div>
      {items.map((item) => (
        <div key={item.label}>
          <div className="mb-1 flex items-center justify-between gap-3 text-sm text-slate-600 dark:text-slate-300">
            <span className="truncate">{item.label}</span>
            <span className="shrink-0 font-semibold text-slate-950 dark:text-white">
              {formatNumber(item.value)}
            </span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-white/70 dark:bg-slate-900/70">
            <div
              className="h-full rounded-full bg-fuchsia-500"
              style={{ width: `${(item.value / maxValue) * 100}%` }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

function IdentifierVisual({ samples }: { samples: string[] }) {
  return (
    <div className="flex flex-wrap gap-2">
      {samples.map((sample) => (
        <span
          key={sample}
          className="rounded-full border border-white/15 bg-white/55 px-3 py-2 text-xs font-medium text-slate-600 dark:bg-slate-950/35 dark:text-slate-300"
        >
          {sample}
        </span>
      ))}
    </div>
  );
}

function TimelineVisual({ start, end }: { start: string; end: string }) {
  return (
    <div className="rounded-2xl border border-white/15 bg-white/55 p-4 dark:bg-slate-950/35">
      <div className="flex items-center justify-between text-sm text-slate-600 dark:text-slate-300">
        <span>{start}</span>
        <span>{end}</span>
      </div>
      <div className="mt-3 h-2 overflow-hidden rounded-full bg-white/70 dark:bg-slate-900/70">
        <div className="h-full w-full rounded-full bg-gradient-to-r from-cyan-500 via-emerald-500 to-fuchsia-500" />
      </div>
    </div>
  );
}

function ActionsVisual({ items }: { items: string[] }) {
  return (
    <div className="space-y-3">
      {items.map((item) => (
        <div
          key={item}
          className="flex items-start gap-3 rounded-2xl border border-white/15 bg-white/55 px-4 py-3 text-sm text-slate-600 dark:bg-slate-950/35 dark:text-slate-300"
        >
          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-cyan-500" />
          <span>{item}</span>
        </div>
      ))}
    </div>
  );
}

function MiniVisualization({ visual }: { visual: TourVisual }) {
  switch (visual.kind) {
    case "type-mix":
      return <TypeMixVisual items={visual.items} />;
    case "missing":
      return <MissingVisual items={visual.items} />;
    case "correlation":
      return (
        <CorrelationVisual
          correlation={visual.correlation}
          left={visual.left}
          right={visual.right}
          coverage={visual.coverage}
        />
      );
    case "distribution":
      return <DistributionVisual column={visual.column} items={visual.items} />;
    case "identifier":
      return <IdentifierVisual samples={visual.samples} />;
    case "timeline":
      return <TimelineVisual start={visual.start} end={visual.end} />;
    case "actions":
      return <ActionsVisual items={visual.items} />;
  }
}

function TourLoading() {
  return (
    <div className={`${PANEL_CLASS} flex min-h-[24rem] items-center justify-center`}>
      <div className="flex items-center gap-3 text-sm text-slate-500 dark:text-slate-300">
        <Loader2 className="h-4 w-4 animate-spin" />
        Generating the dataset tour…
      </div>
    </div>
  );
}

function DataTourReady({ tableName, columns }: DataTourProps) {
  const insightsPromise = useMemo(
    () =>
      loadTourInsights(tableName, columns).catch((error) => ({
        rowCount: 0,
        completeness: 100,
        nullHotspots: [],
        correlation: null,
        categoryDistribution: null,
        numericHighlight: null,
        dateHighlight: null,
        identifierColumn: null,
        typeMix: [],
        patternHint:
          error instanceof Error ? error.message : "Unable to generate tour insights.",
      })),
    [columns, tableName],
  );
  const insights = use(insightsPromise);
  const steps = useMemo(
    () => buildTourSteps(tableName, columns, insights),
    [columns, insights, tableName],
  );
  const [activeIndex, setActiveIndex] = useState(0);
  const [dismissed, setDismissed] = useState(false);
  const safeIndex = Math.min(activeIndex, steps.length - 1);
  const activeStep = steps[safeIndex];
  const progress = ((safeIndex + 1) / steps.length) * 100;

  if (dismissed) {
    return (
      <section className={PANEL_CLASS}>
        <div className="flex items-center justify-between gap-4 px-5 py-5">
          <div>
            <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-cyan-600 dark:text-cyan-300">
              <Sparkles className="h-3.5 w-3.5" />
              Guided data tour
            </div>
            <div className="mt-2 text-sm text-slate-600 dark:text-slate-300">
              The tour is hidden. Reopen it any time to revisit the strongest data signals.
            </div>
          </div>
          <button
            type="button"
            onClick={() => setDismissed(false)}
            className="rounded-2xl border border-white/20 bg-white/55 px-4 py-2 text-sm text-slate-700 transition hover:border-cyan-300/40 dark:bg-slate-950/35 dark:text-slate-200"
          >
            Reopen
          </button>
        </div>
      </section>
    );
  }

  return (
    <section className={PANEL_CLASS}>
      <div className="border-b border-white/15 px-5 py-5">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
          <div>
            <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-cyan-600 dark:text-cyan-300">
              <ScanSearch className="h-3.5 w-3.5" />
              Interactive data tour
            </div>
            <h2 className="mt-2 text-xl font-semibold text-slate-950 dark:text-white">
              Walkthrough for {tableName}
            </h2>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600 dark:text-slate-300">
              The steps below are generated from the current dataset profile and a small set of
              live DuckDB checks.
            </p>
          </div>

          <div className="min-w-[14rem]">
            <div className="mb-2 flex items-center justify-between text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
              <span>Progress</span>
              <span>
                {safeIndex + 1} / {steps.length}
              </span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-white/70 dark:bg-slate-900/70">
              <div
                className="h-full rounded-full bg-gradient-to-r from-cyan-500 via-emerald-500 to-fuchsia-500"
                style={{ width: `${progress}%` }}
              />
            </div>
          </div>
        </div>
      </div>

      <div className="grid gap-5 px-5 py-5 xl:grid-cols-[0.78fr_1.22fr]">
        <div className="space-y-3">
          {steps.map((step, index) => {
            const active = index === safeIndex;
            return (
              <button
                key={step.id}
                type="button"
                onClick={() => startTransition(() => setActiveIndex(index))}
                className={`w-full rounded-[1.35rem] border px-4 py-4 text-left transition ${
                  active
                    ? "border-cyan-400/40 bg-cyan-500/12 text-cyan-800 dark:text-cyan-200"
                    : "border-white/15 bg-white/45 text-slate-600 hover:border-cyan-300/30 dark:bg-slate-950/30 dark:text-slate-300"
                }`}
              >
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="text-[11px] font-semibold uppercase tracking-[0.18em] opacity-75">
                      {step.eyebrow}
                    </div>
                    <div className="mt-1 text-sm font-semibold">{step.title}</div>
                  </div>
                  <div className="text-xs font-semibold opacity-70">{index + 1}</div>
                </div>
              </button>
            );
          })}
        </div>

        <div className="rounded-[1.6rem] border border-white/15 bg-white/45 p-5 dark:bg-slate-950/30">
          <AnimatePresence mode="wait">
            <motion.div
              key={activeStep.id}
              initial={{ opacity: 0, y: 16, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -10, scale: 0.99 }}
              transition={{ duration: 0.34, ease: EASE }}
              className="space-y-5"
            >
              <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-cyan-600 dark:text-cyan-300">
                <BarChart3 className="h-3.5 w-3.5" />
                {activeStep.eyebrow}
              </div>
              <div className="grid gap-5 lg:grid-cols-[0.92fr_1.08fr]">
                <div>
                  <h3 className="text-2xl font-semibold text-slate-950 dark:text-white">
                    {activeStep.title}
                  </h3>
                  <p className="mt-3 text-sm leading-7 text-slate-600 dark:text-slate-300">
                    {activeStep.description}
                  </p>
                  <div className="mt-4 rounded-2xl border border-white/15 bg-white/55 px-4 py-4 text-sm text-slate-700 dark:bg-slate-950/35 dark:text-slate-200">
                    <div className="flex items-center gap-2 font-semibold text-slate-950 dark:text-white">
                      <Binary className="h-4 w-4 text-cyan-500" />
                      Did you know?
                    </div>
                    <p className="mt-2 leading-6">{activeStep.factoid}</p>
                  </div>
                </div>

                <div className="rounded-[1.35rem] border border-white/15 bg-white/55 p-4 dark:bg-slate-950/35">
                  <MiniVisualization visual={activeStep.visual} />
                </div>
              </div>
            </motion.div>
          </AnimatePresence>

          <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
            <button
              type="button"
              onClick={() =>
                startTransition(() => setDismissed(true))
              }
              className="inline-flex items-center gap-2 rounded-2xl border border-white/20 bg-white/55 px-4 py-2 text-sm text-slate-700 transition hover:border-cyan-300/40 dark:bg-slate-950/35 dark:text-slate-200"
            >
              <SkipForward className="h-4 w-4" />
              Skip tour
            </button>

            <div className="flex gap-2">
              <button
                type="button"
                disabled={safeIndex === 0}
                onClick={() =>
                  startTransition(() =>
                    setActiveIndex((current) => Math.max(current - 1, 0)),
                  )
                }
                className="inline-flex items-center gap-2 rounded-2xl border border-white/20 bg-white/55 px-4 py-2 text-sm text-slate-700 transition disabled:cursor-not-allowed disabled:opacity-50 dark:bg-slate-950/35 dark:text-slate-200"
              >
                <ArrowLeft className="h-4 w-4" />
                Back
              </button>
              <button
                type="button"
                onClick={() =>
                  startTransition(() =>
                    setActiveIndex((current) =>
                      current >= steps.length - 1 ? current : current + 1,
                    ),
                  )
                }
                className="inline-flex items-center gap-2 rounded-2xl bg-cyan-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-cyan-500"
              >
                {safeIndex === steps.length - 1 ? "Stay on last step" : "Next"}
                <ArrowRight className="h-4 w-4" />
              </button>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

export default function DataTour({ tableName, columns }: DataTourProps) {
  return (
    <Suspense fallback={<TourLoading />}>
      <DataTourReady key={tableName} tableName={tableName} columns={columns} />
    </Suspense>
  );
}

function quoteLiteral(value: string) {
  return `'${value.replaceAll("'", "''")}'`;
}
