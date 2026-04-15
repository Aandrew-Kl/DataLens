"use client";

import { quoteIdentifier } from "@/lib/utils/sql";
import { runQuery } from "@/lib/duckdb/client";
import type { ColumnProfile } from "@/types/dataset";
import { motion } from "framer-motion";
import { DatabaseZap } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { TransformStepEditor, createAggregationDraft } from "./transform-step-editor";
import type {
  ComputedDraft,
  DropDraft,
  FilterDraft,
  GroupDraft,
  RenameDraft,
  SortDraft,
  TransformKind,
  TransformStatus,
} from "./transform-step-editor";
import { TransformStepList } from "./transform-step-list";
import {
  buildTransformPreview,
  countRows,
  describeRelation,
  formatCount,
  getErrorMessage,
  type HistoryEntry,
} from "./transform-preview";
import { TransformPreview } from "./transform-preview";

export { TransformStepEditor } from "./transform-step-editor";
export type {
  AggregateFunction,
  AggregationDraft,
  ComputedDraft,
  DropDraft,
  FilterDraft,
  FilterOperator,
  GroupDraft,
  RenameDraft,
  SortDirection,
  SortDraft,
  TransformKind,
  TransformStatus,
} from "./transform-step-editor";
export { TransformPreview, buildTransformPreview, countRows, describeRelation, formatCount, getErrorMessage } from "./transform-preview";
export type { BuildResult, HistoryEntry, PreviewResult } from "./transform-preview";
export { TransformStepList } from "./transform-step-list";

interface TransformPanelProps {
  tableName: string;
  columns: ColumnProfile[];
  onTransformComplete: () => void;
}

function StatPill({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-gray-200/60 bg-white/50 px-3 py-2 dark:border-gray-700/60 dark:bg-gray-950/35">
      <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-gray-500 dark:text-gray-400">{label}</p>
      <p className="mt-1 text-sm font-semibold text-gray-900 dark:text-gray-50">{value}</p>
    </div>
  );
}

export default function TransformPanel({ tableName, columns, onTransformComplete }: TransformPanelProps) {
  const latestColumnsRef = useRef(columns);
  latestColumnsRef.current = columns;

  const [activeTab, setActiveTab] = useState<TransformKind>("filter");
  const [currentSourceName, setCurrentSourceName] = useState(tableName);
  const [currentColumns, setCurrentColumns] = useState<ColumnProfile[]>(columns);
  const [currentRowCount, setCurrentRowCount] = useState(0);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [viewVersion, setViewVersion] = useState(1);
  const [status, setStatus] = useState<TransformStatus>(null);
  const [isBootstrapping, setIsBootstrapping] = useState(false);
  const [busyAction, setBusyAction] = useState<"execute" | "undo" | null>(null);
  const [filterDraft, setFilterDraft] = useState<FilterDraft>({ column: columns[0]?.name ?? "", operator: "=", value: "" });
  const [sortDraft, setSortDraft] = useState<SortDraft>({ column: columns[0]?.name ?? "", direction: "ASC" });
  const [groupDraft, setGroupDraft] = useState<GroupDraft>({ groupBy: [], aggregates: [createAggregationDraft()] });
  const [computedDraft, setComputedDraft] = useState<ComputedDraft>({ name: "", expression: "" });
  const [renameDraft, setRenameDraft] = useState<RenameDraft>({ column: columns[0]?.name ?? "", newName: "" });
  const [dropDraft, setDropDraft] = useState<DropDraft>({ column: columns[0]?.name ?? "" });

  useEffect(() => {
    let cancelled = false;
    async function bootstrap() {
      const latestColumns = latestColumnsRef.current;
      setIsBootstrapping(true);
      setStatus(null);
      setActiveTab("filter");
      setCurrentSourceName(tableName);
      setCurrentColumns(latestColumns);
      setHistory([]);
      setViewVersion(1);
      setComputedDraft({ name: "", expression: "" });
      setFilterDraft({ column: latestColumns[0]?.name ?? "", operator: "=", value: "" });
      setSortDraft({ column: latestColumns[0]?.name ?? "", direction: "ASC" });
      setGroupDraft({ groupBy: [], aggregates: [createAggregationDraft()] });
      setRenameDraft({ column: latestColumns[0]?.name ?? "", newName: "" });
      setDropDraft({ column: latestColumns[0]?.name ?? "" });
      try {
        const [schema, rowCountResult] = await Promise.all([
          describeRelation(tableName).catch(() => latestColumns),
          countRows(tableName).catch(() => 0),
        ]);
        if (cancelled) return;
        setCurrentColumns(schema.length > 0 ? schema : latestColumns);
        setCurrentRowCount(rowCountResult);
      } catch (error) {
        if (!cancelled) setStatus({ type: "error", message: getErrorMessage(error) });
      } finally {
        if (!cancelled) setIsBootstrapping(false);
      }
    }
    void bootstrap();
    return () => {
      cancelled = true;
    };
  }, [tableName]);

  const preview = buildTransformPreview(tableName, activeTab, viewVersion, currentSourceName, currentColumns, {
    filterDraft,
    sortDraft,
    groupDraft,
    computedDraft,
    renameDraft,
    dropDraft,
  });

  async function handleExecute() {
    if (preview.error || preview.createViewSql.length === 0 || busyAction) return;
    setBusyAction("execute");
    setStatus(null);
    try {
      await runQuery(preview.createViewSql);
      const [schema, rowCountResult] = await Promise.all([describeRelation(preview.viewName), countRows(preview.viewName)]);
      setHistory((currentHistory) => [
        ...currentHistory,
        {
          id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          kind: activeTab,
          label: preview.label,
          viewName: preview.viewName,
          sourceName: currentSourceName,
          sql: preview.createViewSql,
          createdAt: Date.now(),
          rowCount: rowCountResult,
          columnCount: schema.length,
        },
      ]);
      setCurrentSourceName(preview.viewName);
      setCurrentColumns(schema);
      setCurrentRowCount(rowCountResult);
      setViewVersion((current) => current + 1);
      setComputedDraft({ name: "", expression: "" });
      setStatus({ type: "success", message: `Created view "${preview.viewName}" from ${currentSourceName}.` });
      onTransformComplete();
    } catch (error) {
      setStatus({ type: "error", message: getErrorMessage(error) });
    } finally {
      setBusyAction(null);
    }
  }

  async function handleUndo() {
    const latest = history[history.length - 1];
    if (!latest || busyAction) return;
    setBusyAction("undo");
    setStatus(null);
    try {
      await runQuery(`DROP VIEW IF EXISTS ${quoteIdentifier(latest.viewName)}`);
      const [schema, rowCountResult] = await Promise.all([describeRelation(latest.sourceName), countRows(latest.sourceName)]);
      setHistory((currentHistory) => currentHistory.slice(0, -1));
      setCurrentSourceName(latest.sourceName);
      setCurrentColumns(schema);
      setCurrentRowCount(rowCountResult);
      setComputedDraft({ name: "", expression: "" });
      setStatus({ type: "success", message: `Undid "${latest.label}" and restored "${latest.sourceName}".` });
      onTransformComplete();
    } catch (error) {
      setStatus({ type: "error", message: getErrorMessage(error) });
    } finally {
      setBusyAction(null);
    }
  }

  return (
    <motion.section initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3, ease: "easeOut" }} className="overflow-hidden rounded-2xl border border-white/30 bg-white/55 shadow-[0_20px_80px_-30px_rgba(15,23,42,0.35)] backdrop-blur-xl dark:border-white/10 dark:bg-gray-900/55">
      <div className="border-b border-gray-200/50 px-5 py-4 dark:border-gray-700/50">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="space-y-1">
            <div className="inline-flex items-center gap-2 rounded-full border border-violet-500/20 bg-violet-500/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-violet-600 dark:text-violet-300">
              <DatabaseZap className="h-3.5 w-3.5" />
              Transform panel
            </div>
            <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-50">Build chained DuckDB view transformations</h2>
            <p className="text-sm text-gray-600 dark:text-gray-300">Every action creates a new view so you can iterate, inspect the generated SQL, and roll back the latest step.</p>
          </div>
          <div className="grid min-w-[240px] gap-2 sm:grid-cols-3">
            <StatPill label="Current relation" value={currentSourceName} />
            <StatPill label="Rows" value={formatCount(currentRowCount)} />
            <StatPill label="Columns" value={formatCount(currentColumns.length)} />
          </div>
        </div>
      </div>

      <div className="grid gap-5 p-5 xl:grid-cols-[minmax(0,1.35fr)_340px]">
        <div className="space-y-5">
          <TransformStepEditor
            activeTab={activeTab}
            setActiveTab={setActiveTab}
            currentSourceName={currentSourceName}
            currentColumns={currentColumns}
            filterDraft={filterDraft}
            setFilterDraft={setFilterDraft}
            sortDraft={sortDraft}
            setSortDraft={setSortDraft}
            groupDraft={groupDraft}
            setGroupDraft={setGroupDraft}
            computedDraft={computedDraft}
            setComputedDraft={setComputedDraft}
            renameDraft={renameDraft}
            setRenameDraft={setRenameDraft}
            dropDraft={dropDraft}
            setDropDraft={setDropDraft}
            setStatus={setStatus}
          />
          <TransformPreview
            preview={preview}
            status={status}
            busyAction={busyAction}
            isBootstrapping={isBootstrapping}
            historyLength={history.length}
            onExecute={() => void handleExecute()}
            onUndo={() => void handleUndo()}
          />
        </div>
        <TransformStepList currentSourceName={currentSourceName} currentColumns={currentColumns} history={history} isBootstrapping={isBootstrapping} />
      </div>
    </motion.section>
  );
}
