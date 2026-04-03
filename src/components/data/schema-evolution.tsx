"use client";

import {
  Suspense,
  startTransition,
  use,
  useMemo,
  useState,
} from "react";
import ReactEChartsCore from "echarts-for-react/lib/core";
import * as echarts from "echarts/core";
import type { EChartsOption } from "echarts";
import { BarChart as EChartsBarChart } from "echarts/charts";
import {
  GridComponent,
  LegendComponent,
  TooltipComponent,
} from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";
import { motion } from "framer-motion";
import {
  ArrowLeftRight,
  Clock3,
  Columns3,
  Download,
  FileDiff,
} from "lucide-react";
import { useDarkMode } from "@/lib/hooks/use-dark-mode";
import { runQuery } from "@/lib/duckdb/client";
import { downloadFile } from "@/lib/utils/export";
import { formatNumber } from "@/lib/utils/formatters";
import {
  ANALYTICS_EASE,
  BUTTON_CLASS,
  GLASS_CARD_CLASS,
  GLASS_PANEL_CLASS,
  isRecord,
} from "@/lib/utils/advanced-analytics";
import type { ColumnProfile } from "@/types/dataset";

echarts.use([
  EChartsBarChart,
  GridComponent,
  LegendComponent,
  TooltipComponent,
  CanvasRenderer,
]);

interface SchemaEvolutionProps {
  tableName: string;
  columns: ColumnProfile[];
}

interface SchemaField {
  name: string;
  type: string;
}

interface ChangedField {
  name: string;
  currentType: string;
  snapshotType: string;
}

interface SnapshotSchemaDiff {
  name: string;
  label: string;
  added: string[];
  removed: string[];
  changed: ChangedField[];
  unchangedCount: number;
}

interface SchemaEvolutionSummary {
  currentFieldCount: number;
  snapshots: SnapshotSchemaDiff[];
  error: string | null;
}

function SchemaEvolutionLoading() {
  return (
    <div className={`${GLASS_PANEL_CLASS} flex min-h-[32rem] items-center justify-center`}>
      <div className="text-sm text-slate-500 dark:text-slate-300">
        Comparing schema snapshots…
      </div>
    </div>
  );
}

function SchemaEvolutionEmptyState({ message }: { message: string }) {
  return (
    <section className={`${GLASS_PANEL_CLASS} p-6`}>
      <div className="flex items-start gap-4">
        <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-cyan-500/10 text-cyan-700 dark:text-cyan-300">
          <FileDiff className="h-5 w-5" />
        </div>
        <div>
          <h2 className="text-xl font-semibold text-slate-950 dark:text-white">
            Schema Evolution
          </h2>
          <p className="mt-2 text-sm leading-6 text-slate-600 dark:text-slate-300">
            {message}
          </p>
        </div>
      </div>
    </section>
  );
}

function escapeCsvCell(value: unknown) {
  if (value === null || value === undefined) return "";
  const stringValue = String(value);
  if (
    stringValue.includes(",") ||
    stringValue.includes('"') ||
    stringValue.includes("\n") ||
    stringValue.includes("\r")
  ) {
    return `"${stringValue.replace(/"/g, '""')}"`;
  }
  return stringValue;
}

function normalizeTableLabel(tableName: string) {
  return tableName.replace(/^__snapshot_/, "").replaceAll("_", " ");
}

function getFieldRows(rows: Record<string, unknown>[]) {
  return rows.flatMap<SchemaField>((row) => {
    const name =
      typeof row.column_name === "string"
        ? row.column_name
        : typeof row.name === "string"
          ? row.name
          : null;
    const type =
      typeof row.column_type === "string"
        ? row.column_type
        : typeof row.type === "string"
          ? row.type
          : null;

    if (name === null || type === null) {
      return [];
    }

    return [{ name, type }];
  });
}

function buildSnapshotDiff(currentSchema: SchemaField[], snapshotSchema: SchemaField[]) {
  const currentMap = new Map(currentSchema.map((field) => [field.name, field.type]));
  const snapshotMap = new Map(snapshotSchema.map((field) => [field.name, field.type]));
  const added = currentSchema
    .filter((field) => !snapshotMap.has(field.name))
    .map((field) => field.name)
    .sort((left, right) => left.localeCompare(right));
  const removed = snapshotSchema
    .filter((field) => !currentMap.has(field.name))
    .map((field) => field.name)
    .sort((left, right) => left.localeCompare(right));
  const changed = currentSchema
    .flatMap<ChangedField>((field) => {
      const snapshotType = snapshotMap.get(field.name);
      if (snapshotType === undefined || snapshotType === field.type) {
        return [];
      }

      return [
        {
          name: field.name,
          currentType: field.type,
          snapshotType,
        },
      ];
    })
    .sort((left, right) => left.name.localeCompare(right.name));

  const unchangedCount = currentSchema.filter(
    (field) => snapshotMap.get(field.name) === field.type,
  ).length;

  return {
    added,
    removed,
    changed,
    unchangedCount,
  };
}

async function loadSchemaEvolution(tableName: string): Promise<SchemaEvolutionSummary> {
  const tableRows = await runQuery("SHOW TABLES");
  const tableNames = tableRows
    .flatMap<string>((row) => {
      const value =
        typeof row.name === "string"
          ? row.name
          : typeof row.table_name === "string"
            ? row.table_name
            : null;
      return value ? [value] : [];
    })
    .filter((name) => name.startsWith("__snapshot_"))
    .sort((left, right) => left.localeCompare(right));

  if (tableNames.length === 0) {
    return {
      currentFieldCount: 0,
      snapshots: [],
      error: "No snapshot tables were found with the `__snapshot_` prefix.",
    };
  }

  const currentSchema = getFieldRows(await runQuery(`DESCRIBE "${tableName}"`));
  const snapshots = await Promise.all(
    tableNames.map(async (snapshotName) => {
      const snapshotSchema = getFieldRows(await runQuery(`DESCRIBE "${snapshotName}"`));
      const diff = buildSnapshotDiff(currentSchema, snapshotSchema);

      return {
        name: snapshotName,
        label: normalizeTableLabel(snapshotName),
        ...diff,
      };
    }),
  );

  return {
    currentFieldCount: currentSchema.length,
    snapshots,
    error: null,
  };
}

function buildTimelineOption(
  summary: SchemaEvolutionSummary,
  dark: boolean,
  selectedSnapshot: string | null,
): EChartsOption {
  const textColor = dark ? "#cbd5e1" : "#475569";
  const borderColor = dark ? "#334155" : "#cbd5e1";

  return {
    animationDuration: 460,
    legend: {
      top: 0,
      data: ["Added", "Removed", "Changed"],
      textStyle: { color: textColor },
    },
    grid: {
      left: 16,
      right: 16,
      top: 40,
      bottom: 18,
      containLabel: true,
    },
    tooltip: {
      trigger: "axis",
      backgroundColor: dark ? "#020617ee" : "#ffffffee",
      borderColor,
      textStyle: { color: dark ? "#f8fafc" : "#0f172a" },
      formatter: (params: unknown) => {
        const items = Array.isArray(params) ? params : [params];
        const axisLabel = isRecord(items[0]) && typeof items[0].axisValue === "string"
          ? items[0].axisValue
          : "Snapshot";
        const lines = [`<strong>${axisLabel}</strong>`];

        for (const item of items) {
          if (!isRecord(item)) continue;
          lines.push(`${String(item.seriesName ?? "Series")}: ${formatNumber(Number(item.value ?? 0))}`);
        }

        return lines.join("<br/>");
      },
    },
    xAxis: {
      type: "category",
      data: summary.snapshots.map((snapshot) => snapshot.label),
      axisLabel: {
        color: textColor,
        rotate: summary.snapshots.length > 5 ? 24 : 0,
      },
    },
    yAxis: {
      type: "value",
      name: "Columns",
      nameTextStyle: { color: textColor },
      axisLabel: { color: textColor },
    },
    series: [
      {
        name: "Added",
        type: "bar",
        data: summary.snapshots.map((snapshot) => ({
          value: snapshot.added.length,
          itemStyle: {
            opacity: selectedSnapshot === null || selectedSnapshot === snapshot.name ? 0.9 : 0.34,
          },
        })),
        itemStyle: {
          color: "#22c55e",
          borderRadius: [10, 10, 0, 0] as const,
        },
      },
      {
        name: "Removed",
        type: "bar",
        data: summary.snapshots.map((snapshot) => ({
          value: snapshot.removed.length,
          itemStyle: {
            opacity: selectedSnapshot === null || selectedSnapshot === snapshot.name ? 0.9 : 0.34,
          },
        })),
        itemStyle: {
          color: "#f97316",
          borderRadius: [10, 10, 0, 0] as const,
        },
      },
      {
        name: "Changed",
        type: "bar",
        data: summary.snapshots.map((snapshot) => ({
          value: snapshot.changed.length,
          itemStyle: {
            opacity: selectedSnapshot === null || selectedSnapshot === snapshot.name ? 0.9 : 0.34,
          },
        })),
        itemStyle: {
          color: "#38bdf8",
          borderRadius: [10, 10, 0, 0] as const,
        },
      },
    ],
  };
}

function buildDiffCsv(tableName: string, snapshot: SnapshotSchemaDiff) {
  const summaryRows = [
    "section,current_table,snapshot_table,added_count,removed_count,changed_count,unchanged_count",
    [
      "summary",
      escapeCsvCell(tableName),
      escapeCsvCell(snapshot.name),
      snapshot.added.length,
      snapshot.removed.length,
      snapshot.changed.length,
      snapshot.unchangedCount,
    ].join(","),
  ];

  const detailRows = [
    "kind,column_name,current_type,snapshot_type",
    ...snapshot.added.map((name) => ["added", escapeCsvCell(name), "", ""].join(",")),
    ...snapshot.removed.map((name) => ["removed", escapeCsvCell(name), "", ""].join(",")),
    ...snapshot.changed.map((field) =>
      [
        "changed",
        escapeCsvCell(field.name),
        escapeCsvCell(field.currentType),
        escapeCsvCell(field.snapshotType),
      ].join(","),
    ),
  ];

  return [...summaryRows, "", ...detailRows].join("\n");
}

function SchemaMetricCard({
  label,
  value,
  icon: Icon,
}: {
  label: string;
  value: string;
  icon: typeof Columns3;
}) {
  return (
    <div className={`${GLASS_CARD_CLASS} p-4`}>
      <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
        <Icon className="h-4 w-4 text-cyan-600 dark:text-cyan-300" />
        {label}
      </div>
      <div className="mt-3 text-2xl font-semibold text-slate-950 dark:text-white">{value}</div>
    </div>
  );
}

function DiffList({
  title,
  items,
  emptyMessage,
}: {
  title: string;
  items: readonly string[];
  emptyMessage: string;
}) {
  return (
    <div className={`${GLASS_CARD_CLASS} p-4`}>
      <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
        {title}
      </div>
      {items.length > 0 ? (
        <div className="mt-3 flex flex-wrap gap-2">
          {items.map((item) => (
            <span
              key={item}
              className="rounded-full border border-white/20 bg-white/70 px-3 py-1 text-xs font-medium text-slate-700 dark:bg-slate-950/45 dark:text-slate-200"
            >
              {item}
            </span>
          ))}
        </div>
      ) : (
        <div className="mt-3 text-sm text-slate-600 dark:text-slate-300">{emptyMessage}</div>
      )}
    </div>
  );
}

function ChangedTable({ fields }: { fields: readonly ChangedField[] }) {
  return (
    <div className={`${GLASS_CARD_CLASS} overflow-hidden`}>
      <div className="border-b border-white/15 px-4 py-3 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
        Type changes
      </div>
      {fields.length > 0 ? (
        <div className="divide-y divide-white/10">
          {fields.map((field) => (
            <div key={field.name} className="grid gap-2 px-4 py-3 md:grid-cols-[0.9fr_1fr_1fr]">
              <div className="text-sm font-medium text-slate-950 dark:text-white">{field.name}</div>
              <div className="text-sm text-slate-600 dark:text-slate-300">
                Current: {field.currentType}
              </div>
              <div className="text-sm text-slate-600 dark:text-slate-300">
                Snapshot: {field.snapshotType}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="px-4 py-4 text-sm text-slate-600 dark:text-slate-300">
          No type changes detected for this snapshot.
        </div>
      )}
    </div>
  );
}

function SchemaEvolutionReady({ tableName }: SchemaEvolutionProps) {
  const dark = useDarkMode();
  const [selectedSnapshotName, setSelectedSnapshotName] = useState<string | null>(null);

  const resource = useMemo(
    () =>
      loadSchemaEvolution(tableName).catch((error) => ({
        currentFieldCount: 0,
        snapshots: [],
        error: error instanceof Error ? error.message : "Unable to compare schema snapshots.",
      })),
    [tableName],
  );

  const summary = use(resource);
  const activeSnapshot =
    summary.snapshots.find((snapshot) => snapshot.name === selectedSnapshotName) ??
    summary.snapshots[0] ??
    null;
  const option = useMemo(
    () => buildTimelineOption(summary, dark, activeSnapshot?.name ?? null),
    [activeSnapshot?.name, dark, summary],
  );

  const timelineEvents = useMemo<Record<string, (params: unknown) => void>>(
    () => ({
      click: (params: unknown) => {
        if (!isRecord(params) || typeof params.name !== "string") {
          return;
        }

        const match = summary.snapshots.find((snapshot) => snapshot.label === params.name);
        if (!match) return;

        startTransition(() => setSelectedSnapshotName(match.name));
      },
    }),
    [summary.snapshots],
  );

  if (summary.error && summary.snapshots.length === 0) {
    return <SchemaEvolutionEmptyState message={summary.error} />;
  }

  if (activeSnapshot === null) {
    return <SchemaEvolutionEmptyState message="No compatible schema snapshots are available." />;
  }

  return (
    <div className="space-y-5">
      <motion.section
        initial={{ opacity: 0, y: 18 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.36, ease: ANALYTICS_EASE }}
        className={`${GLASS_PANEL_CLASS} p-5`}
      >
        <div className="grid gap-4 xl:grid-cols-[1.08fr_0.92fr]">
          <div>
            <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-cyan-600 dark:text-cyan-300">
              <FileDiff className="h-3.5 w-3.5" />
              Snapshot timeline
            </div>
            <h3 className="mt-2 text-xl font-semibold text-slate-950 dark:text-white">
              Track how the current schema diverged from historical snapshots
            </h3>
            <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">
              Every snapshot is compared directly against the current table so added,
              removed, and changed columns are visible at a glance.
            </p>
          </div>

          <div className="grid gap-3 sm:grid-cols-3 xl:grid-cols-1">
            <SchemaMetricCard
              label="Current columns"
              value={formatNumber(summary.currentFieldCount)}
              icon={Columns3}
            />
            <SchemaMetricCard
              label="Snapshots"
              value={formatNumber(summary.snapshots.length)}
              icon={Clock3}
            />
            <SchemaMetricCard
              label="Active diff"
              value={formatNumber(
                activeSnapshot.added.length +
                  activeSnapshot.removed.length +
                  activeSnapshot.changed.length,
              )}
              icon={ArrowLeftRight}
            />
          </div>
        </div>
      </motion.section>

      <motion.section
        initial={{ opacity: 0, y: 18 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.42, ease: ANALYTICS_EASE }}
        className={`${GLASS_PANEL_CLASS} p-5`}
      >
        <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
              Timeline visualization
            </div>
            <div className="mt-1 text-sm text-slate-600 dark:text-slate-300">
              Click a bar group to focus the detailed diff for that snapshot.
            </div>
          </div>

          <button
            type="button"
            aria-label="Export schema diff"
            onClick={() =>
              downloadFile(
                buildDiffCsv(tableName, activeSnapshot),
                `${tableName}-${activeSnapshot.name}-schema-diff.csv`,
                "text/csv;charset=utf-8;",
              )
            }
            className={BUTTON_CLASS}
          >
            <Download className="h-4 w-4" />
            Export diff
          </button>
        </div>

        <ReactEChartsCore
          echarts={echarts}
          option={option}
          onEvents={timelineEvents}
          notMerge
          lazyUpdate
          style={{ height: 360 }}
        />
      </motion.section>

      <motion.section
        initial={{ opacity: 0, y: 18 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.48, ease: ANALYTICS_EASE }}
        className={`${GLASS_PANEL_CLASS} p-5`}
      >
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
            Active snapshot
          </div>
          <h3 className="mt-2 text-lg font-semibold text-slate-950 dark:text-white">
            {activeSnapshot.label}
          </h3>
        </div>

        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          <DiffList
            title="Added columns"
            items={activeSnapshot.added}
            emptyMessage="No columns were added relative to this snapshot."
          />
          <DiffList
            title="Removed columns"
            items={activeSnapshot.removed}
            emptyMessage="No columns were removed relative to this snapshot."
          />
        </div>

        <div className="mt-4">
          <ChangedTable fields={activeSnapshot.changed} />
        </div>
      </motion.section>
    </div>
  );
}

export default function SchemaEvolution(props: SchemaEvolutionProps) {
  return (
    <Suspense fallback={<SchemaEvolutionLoading />}>
      <SchemaEvolutionReady {...props} />
    </Suspense>
  );
}
