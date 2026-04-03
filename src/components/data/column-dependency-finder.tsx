"use client";

import {
  Suspense,
  use,
  useMemo,
} from "react";
import ReactEChartsCore from "echarts-for-react/lib/core";
import * as echarts from "echarts/core";
import type { EChartsOption } from "echarts";
import { HeatmapChart } from "echarts/charts";
import {
  GridComponent,
  TooltipComponent,
  VisualMapComponent,
} from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";
import { motion } from "framer-motion";
import {
  Download,
  KeyRound,
  Link2,
  Network,
  Sigma,
} from "lucide-react";
import { runQuery } from "@/lib/duckdb/client";
import { downloadFile } from "@/lib/utils/export";
import { formatNumber, formatPercent } from "@/lib/utils/formatters";
import {
  ANALYTICS_EASE,
  BUTTON_CLASS,
  GLASS_CARD_CLASS,
  GLASS_PANEL_CLASS,
  quoteIdentifier,
} from "@/lib/utils/advanced-analytics";
import type { ColumnProfile } from "@/types/dataset";

echarts.use([
  HeatmapChart,
  GridComponent,
  TooltipComponent,
  VisualMapComponent,
  CanvasRenderer,
]);

interface ColumnDependencyFinderProps {
  tableName: string;
  columns: ColumnProfile[];
}

type RelationshipKind = "1:1" | "N:1" | "1:N" | "M:N";

interface DependencyRow {
  determinant: string;
  dependent: string;
  strength: number;
  pairRows: number;
  determinantCount: number;
  dependentCount: number;
  pairCount: number;
  relationship: RelationshipKind;
}

interface KeyCandidate {
  column: string;
  uniquenessRatio: number;
  perfectDependencyCount: number;
  reason: string;
}

interface DependencyAnalysisResult {
  rowCount: number;
  analyzedColumns: string[];
  dependencies: DependencyRow[];
  keyCandidates: KeyCandidate[];
  strongestAverage: number;
  trimmedCount: number;
  error: string | null;
}

function DependencyLoadingState() {
  return (
    <div
      className={`${GLASS_PANEL_CLASS} flex min-h-[28rem] items-center justify-center`}
    >
      <div className="text-sm text-slate-500 dark:text-slate-300">
        Scanning functional dependencies…
      </div>
    </div>
  );
}

function DependencyEmptyState({ message }: { message: string }) {
  return (
    <section className={`${GLASS_PANEL_CLASS} p-6`}>
      <div className="flex items-start gap-4">
        <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-cyan-500/10 text-cyan-700 dark:text-cyan-300">
          <Network className="h-5 w-5" />
        </div>
        <div>
          <h2 className="text-xl font-semibold text-slate-950 dark:text-white">
            Column Dependency Finder
          </h2>
          <p className="mt-2 text-sm leading-6 text-slate-600 dark:text-slate-300">
            {message}
          </p>
        </div>
      </div>
    </section>
  );
}

function buildDependencyQuery(tableName: string, columns: string[]) {
  const orderedPairs = columns.flatMap((determinant) =>
    columns
      .filter((dependent) => dependent !== determinant)
      .map((dependent) => {
        const determinantField = quoteIdentifier(determinant);
        const dependentField = quoteIdentifier(dependent);
        return `
          SELECT
            '${determinant.replace(/'/g, "''")}' AS determinant_name,
            '${dependent.replace(/'/g, "''")}' AS dependent_name,
            COUNT(*) AS pair_rows,
            COUNT(DISTINCT determinant_value) AS determinant_count,
            COUNT(DISTINCT dependent_value) AS dependent_count,
            COUNT(DISTINCT determinant_value || '¦' || dependent_value) AS pair_count
          FROM (
            SELECT
              CAST(${determinantField} AS VARCHAR) AS determinant_value,
              CAST(${dependentField} AS VARCHAR) AS dependent_value
            FROM ${quoteIdentifier(tableName)}
            WHERE ${determinantField} IS NOT NULL
              AND ${dependentField} IS NOT NULL
          )
        `;
      }),
  );

  return orderedPairs.join(" UNION ALL ");
}

function buildRelationship(
  strength: number,
  reverseStrength: number,
): RelationshipKind {
  if (strength >= 0.999 && reverseStrength >= 0.999) return "1:1";
  if (strength >= 0.999) return "N:1";
  if (reverseStrength >= 0.999) return "1:N";
  return "M:N";
}

async function loadDependencyAnalysis(
  tableName: string,
  columns: ColumnProfile[],
): Promise<DependencyAnalysisResult> {
  try {
    const analysisColumns = columns.slice(0, 12);
    const [rowCountRows, dependencyRows] = await Promise.all([
      runQuery(`
        SELECT COUNT(*) AS row_count
        FROM ${quoteIdentifier(tableName)}
      `),
      analysisColumns.length > 1
        ? runQuery(buildDependencyQuery(tableName, analysisColumns.map((column) => column.name)))
        : Promise.resolve<Record<string, unknown>[]>([]),
    ]);

    const rowCount = Number(rowCountRows[0]?.row_count ?? 0);
    const dependencies = dependencyRows
      .map((row) => {
        const determinant = String(row.determinant_name ?? "");
        const dependent = String(row.dependent_name ?? "");
        const determinantCount = Number(row.determinant_count ?? 0);
        const dependentCount = Number(row.dependent_count ?? 0);
        const pairCount = Number(row.pair_count ?? 0);
        const pairRows = Number(row.pair_rows ?? 0);
        const strength =
          pairCount > 0 ? determinantCount / pairCount : 0;

        return {
          determinant,
          dependent,
          pairRows,
          determinantCount,
          dependentCount,
          pairCount,
          strength,
          relationship: "M:N" as RelationshipKind,
        };
      })
      .filter(
        (row) =>
          row.determinant.length > 0 &&
          row.dependent.length > 0 &&
          row.pairRows > 0,
      );

    const reverseStrengthMap = new Map<string, number>();
    dependencies.forEach((row) => {
      reverseStrengthMap.set(`${row.determinant}::${row.dependent}`, row.strength);
    });

    const decoratedDependencies = dependencies
      .map<DependencyRow>((row) => ({
        ...row,
        relationship: buildRelationship(
          row.strength,
          reverseStrengthMap.get(`${row.dependent}::${row.determinant}`) ?? 0,
        ),
      }))
      .sort((left, right) => right.strength - left.strength);

    const perfectDependencyCounts = new Map<string, number>();
    decoratedDependencies.forEach((row) => {
      if (row.strength >= 0.999) {
        perfectDependencyCounts.set(
          row.determinant,
          (perfectDependencyCounts.get(row.determinant) ?? 0) + 1,
        );
      }
    });

    const keyCandidates = analysisColumns
      .map<KeyCandidate>((column) => {
        const nonNullCount = Math.max(1, rowCount - column.nullCount);
        const uniquenessRatio = column.uniqueCount / nonNullCount;
        const perfectDependencyCount =
          perfectDependencyCounts.get(column.name) ?? 0;

        let reason = "High determinant coverage across the sampled table.";
        if (uniquenessRatio >= 0.98 && column.nullCount === 0) {
          reason = "Nearly unique and non-null, which is strong key-like behavior.";
        } else if (perfectDependencyCount >= 2) {
          reason = "Perfectly determines multiple other columns.";
        }

        return {
          column: column.name,
          uniquenessRatio,
          perfectDependencyCount,
          reason,
        };
      })
      .filter(
        (candidate) =>
          candidate.uniquenessRatio >= 0.9 ||
          candidate.perfectDependencyCount >= 2,
      )
      .sort(
        (left, right) =>
          right.perfectDependencyCount - left.perfectDependencyCount ||
          right.uniquenessRatio - left.uniquenessRatio,
      );

    const strongestAverage =
      decoratedDependencies.length > 0
        ? decoratedDependencies
            .slice(0, Math.min(10, decoratedDependencies.length))
            .reduce((sum, row) => sum + row.strength, 0) /
          Math.min(10, decoratedDependencies.length)
        : 0;

    return {
      rowCount,
      analyzedColumns: analysisColumns.map((column) => column.name),
      dependencies: decoratedDependencies,
      keyCandidates,
      strongestAverage,
      trimmedCount: Math.max(0, columns.length - analysisColumns.length),
      error: null,
    };
  } catch (error) {
    return {
      rowCount: 0,
      analyzedColumns: [],
      dependencies: [],
      keyCandidates: [],
      strongestAverage: 0,
      trimmedCount: 0,
      error:
        error instanceof Error
          ? error.message
          : "Dependency scan failed.",
    };
  }
}

function buildMatrixOption(
  columns: string[],
  dependencies: DependencyRow[],
): EChartsOption {
  const points = dependencies.map((row) => [
    columns.indexOf(row.dependent),
    columns.indexOf(row.determinant),
    Number(row.strength.toFixed(3)),
  ]);

  return {
    animationDuration: 420,
    tooltip: {
      formatter: (params: unknown) => {
        const p = params as { value?: unknown[]; name?: string };
        const value = Array.isArray(p.value) ? Number(p.value[2] ?? 0) : 0;
        return `${p.name ?? ""}: ${formatPercent(value * 100, 1)}`;
      },
    },
    grid: {
      left: 120,
      right: 24,
      top: 16,
      bottom: 80,
    },
    xAxis: {
      type: "category",
      data: columns,
      name: "Dependent",
      axisLabel: {
        interval: 0,
        rotate: 30,
      },
    },
    yAxis: {
      type: "category",
      data: columns,
      name: "Determinant",
    },
    visualMap: {
      min: 0,
      max: 1,
      orient: "horizontal",
      left: "center",
      bottom: 12,
      calculable: false,
      inRange: {
        color: [
          "#dbeafe",
          "#93c5fd",
          "#38bdf8",
          "#0ea5e9",
          "#0369a1",
        ],
      },
    },
    series: [
      {
        name: "Dependency strength",
        type: "heatmap",
        data: points,
        label: {
          show: true,
          formatter: ({ value }) =>
            Array.isArray(value)
              ? formatPercent(Number(value[2] ?? 0) * 100, 0)
              : "0%",
          color: "#0f172a",
        },
      },
    ],
  };
}

function buildExportCsv(
  dependencies: DependencyRow[],
  keyCandidates: KeyCandidate[],
) {
  const dependencyRows = [
    "section,determinant,dependent,strength,relationship,pair_rows,determinant_count,dependent_count,pair_count",
    ...dependencies.map(
      (row) =>
        `dependency,${row.determinant},${row.dependent},${row.strength},${row.relationship},${row.pairRows},${row.determinantCount},${row.dependentCount},${row.pairCount}`,
    ),
  ];
  const candidateRows = [
    "candidate,column,uniqueness_ratio,perfect_dependency_count,reason",
    ...keyCandidates.map(
      (candidate) =>
        `candidate,${candidate.column},${candidate.uniquenessRatio},${candidate.perfectDependencyCount},"${candidate.reason.replace(/"/g, '""')}"`,
    ),
  ];

  return [...dependencyRows, "", ...candidateRows].join("\n");
}

function SummaryCard({
  label,
  icon: Icon,
  value,
  detail,
}: {
  label: string;
  icon: typeof Sigma;
  value: string;
  detail: string;
}) {
  return (
    <div className={`${GLASS_CARD_CLASS} p-4`}>
      <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
        <Icon className="h-4 w-4 text-cyan-600 dark:text-cyan-300" />
        {label}
      </div>
      <div className="mt-4 text-2xl font-semibold text-slate-950 dark:text-white">
        {value}
      </div>
      <div className="mt-2 text-xs text-slate-500 dark:text-slate-400">{detail}</div>
    </div>
  );
}

function DependencyFinderPanel({
  resource,
  tableName,
}: {
  resource: Promise<DependencyAnalysisResult>;
  tableName: string;
}) {
  const result = use(resource);

  if (result.error) {
    return (
      <div className={`${GLASS_PANEL_CLASS} p-6`}>
        <p className="text-sm text-rose-600 dark:text-rose-300">{result.error}</p>
      </div>
    );
  }

  const perfectDependencies = result.dependencies.filter(
    (row) => row.strength >= 0.999,
  ).length;
  const chartOption = buildMatrixOption(
    result.analyzedColumns,
    result.dependencies,
  );

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.28, ease: ANALYTICS_EASE }}
      className="space-y-5"
    >
      <div className="grid gap-4 md:grid-cols-3">
        <SummaryCard
          label="Perfect dependencies"
          icon={Link2}
          value={formatNumber(perfectDependencies)}
          detail="Pairs where the determinant maps to exactly one dependent value"
        />
        <SummaryCard
          label="Potential keys"
          icon={KeyRound}
          value={formatNumber(result.keyCandidates.length)}
          detail="Columns with high uniqueness or determinant coverage"
        />
        <SummaryCard
          label="Top-average strength"
          icon={Sigma}
          value={formatPercent(result.strongestAverage * 100, 1)}
          detail={`Averaged across the top ${Math.min(10, result.dependencies.length)} dependencies`}
        />
      </div>

      <div className={`${GLASS_PANEL_CLASS} p-5`}>
        <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h3 className="text-lg font-semibold text-slate-950 dark:text-white">
              Dependency matrix
            </h3>
            <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
              Read across rows to see which determinant columns most strongly
              constrain the dependent columns.
            </p>
          </div>

          <button
            type="button"
            onClick={() =>
              downloadFile(
                buildExportCsv(result.dependencies, result.keyCandidates),
                `${tableName}-dependency-report.csv`,
                "text/csv;charset=utf-8;",
              )
            }
            className={BUTTON_CLASS}
          >
            <Download className="h-4 w-4" />
            Export dependency CSV
          </button>
        </div>

        <ReactEChartsCore
          echarts={echarts}
          option={chartOption}
          notMerge
          lazyUpdate
          style={{ height: 380 }}
        />
      </div>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,0.75fr)_minmax(0,1.25fr)]">
        <div className={`${GLASS_PANEL_CLASS} p-5`}>
          <h3 className="text-lg font-semibold text-slate-950 dark:text-white">
            Potential key columns
          </h3>
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
            Suggested from uniqueness and how many columns they perfectly determine.
          </p>

          {result.keyCandidates.length === 0 ? (
            <div className="mt-4 rounded-2xl border border-amber-200/60 bg-amber-500/10 px-4 py-3 text-sm text-amber-700 dark:border-amber-500/20 dark:text-amber-300">
              No clear key candidates were found in the analyzed columns.
            </div>
          ) : (
            <div className="mt-4 space-y-3">
              {result.keyCandidates.map((candidate) => (
                <div
                  key={candidate.column}
                  className="rounded-2xl border border-white/10 bg-white/50 px-4 py-3 dark:bg-slate-950/35"
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="font-semibold text-slate-950 dark:text-white">
                      {candidate.column}
                    </div>
                    <div className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500 dark:text-slate-400">
                      {formatPercent(candidate.uniquenessRatio * 100, 1)} unique
                    </div>
                  </div>
                  <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">
                    {candidate.reason}
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className={`${GLASS_PANEL_CLASS} overflow-hidden p-5`}>
          <h3 className="text-lg font-semibold text-slate-950 dark:text-white">
            Strongest dependencies
          </h3>
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
            Useful for normalization reviews and spotting hidden dimension keys.
          </p>

          <div className="mt-4 overflow-x-auto">
            <table className="min-w-full text-left text-sm">
              <thead className="text-xs uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">
                <tr>
                  <th className="px-3 py-2">Dependency</th>
                  <th className="px-3 py-2">Strength</th>
                  <th className="px-3 py-2">Relationship</th>
                  <th className="px-3 py-2">Unique combos</th>
                </tr>
              </thead>
              <tbody>
                {result.dependencies.slice(0, 18).map((row) => (
                  <tr
                    key={`${row.determinant}-${row.dependent}`}
                    className="border-t border-white/10 text-slate-700 dark:text-slate-200"
                  >
                    <td className="px-3 py-3 font-medium">
                      {`${row.determinant} -> ${row.dependent}`}
                    </td>
                    <td className="px-3 py-3">{formatPercent(row.strength * 100, 1)}</td>
                    <td className="px-3 py-3">{row.relationship}</td>
                    <td className="px-3 py-3">{formatNumber(row.pairCount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </motion.div>
  );
}

export default function ColumnDependencyFinder({
  tableName,
  columns,
}: ColumnDependencyFinderProps) {
  const resource = useMemo(
    () => loadDependencyAnalysis(tableName, columns),
    [columns, tableName],
  );

  if (columns.length < 2) {
    return (
      <DependencyEmptyState message="Add at least two columns before checking functional dependencies." />
    );
  }

  return (
    <section className="space-y-5">
      <div className={`${GLASS_PANEL_CLASS} p-5`}>
        <div className="flex flex-col gap-5 xl:flex-row xl:items-end xl:justify-between">
          <div>
            <div className="flex items-center gap-3">
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-cyan-500/10 text-cyan-700 dark:text-cyan-300">
                <Network className="h-5 w-5" />
              </div>
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-500 dark:text-slate-400">
                  Functional Dependencies
                </p>
                <h2 className="mt-1 text-xl font-semibold text-slate-950 dark:text-white">
                  Column Dependency Finder
                </h2>
              </div>
            </div>
            <p className="mt-4 max-w-2xl text-sm leading-6 text-slate-600 dark:text-slate-300">
              Estimate which columns determine other columns, classify the
              relationship shape, and surface likely keys that could support
              better normalization or cleaner joins.
            </p>
          </div>
        </div>
      </div>

      <Suspense fallback={<DependencyLoadingState />}>
        <DependencyFinderPanel resource={resource} tableName={tableName} />
      </Suspense>
    </section>
  );
}
