"use client";

import { quoteIdentifier } from "@/lib/utils/sql";
import { getTableRowCount, runQuery } from "@/lib/duckdb/client";
import { profileTable } from "@/lib/duckdb/profiler";
import { appendLineageEvent } from "@/components/data/data-lineage-graph";
import { generateId } from "@/lib/utils/formatters";
import type { ColumnProfile } from "@/types/dataset";
import { startTransition, useState } from "react";
import {
  WranglerFilters,
  buildWranglerOperation,
  getTextColumns,
  type BuiltOperation,
  type DateFormState,
  type DedupeFormState,
  type FillFormState,
  type MergeFormState,
  type PreviewRequest,
  type RegexFormState,
  type SplitFormState,
  type TrimFormState,
} from "./wrangler-filters";
import { WranglerGrid, type HistoryEntry } from "./wrangler-grid";
import { WranglerToolbar, type OperationType, type StatusState } from "./wrangler-toolbar";

export { WranglerFilters, buildWranglerOperation, getNumericColumns, getTextColumns } from "./wrangler-filters";
export type {
  BuiltOperation,
  DateFormState,
  DedupeFormState,
  FillFormState,
  FillStrategy,
  MergeFormState,
  PreviewRequest,
  RegexFormState,
  SplitFormState,
  TrimFormState,
} from "./wrangler-filters";
export { WranglerGrid } from "./wrangler-grid";
export type { HistoryEntry, PreviewResult } from "./wrangler-grid";
export { WranglerToolbar } from "./wrangler-toolbar";
export type { OperationType, StatusState } from "./wrangler-toolbar";

interface DataWranglerProps {
  tableName: string;
  columns: ColumnProfile[];
}

const PANEL_CLASS =
  "rounded-[1.85rem] border border-white/15 bg-white/60 shadow-[0_24px_90px_-46px_rgba(15,23,42,0.78)] backdrop-blur-2xl dark:border-white/10 dark:bg-slate-950/45";

export default function DataWrangler({ tableName, columns }: DataWranglerProps) {
  const [workingColumns, setWorkingColumns] = useState(columns);
  const textColumns = getTextColumns(workingColumns);
  const [activeTab, setActiveTab] = useState<OperationType>("split");
  const [previewRequest, setPreviewRequest] = useState<PreviewRequest | null>(null);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [status, setStatus] = useState<StatusState>(null);
  const [busy, setBusy] = useState(false);
  const [splitForm, setSplitForm] = useState<SplitFormState>({
    column: textColumns[0]?.name ?? "",
    delimiter: ",",
    parts: 2,
    prefix: `${textColumns[0]?.name ?? "part"}_split`,
  });
  const [mergeForm, setMergeForm] = useState<MergeFormState>({
    columns: workingColumns.slice(0, 2).map((column) => column.name),
    separator: " ",
    output: "merged_column",
  });
  const [fillForm, setFillForm] = useState<FillFormState>({ column: workingColumns[0]?.name ?? "", strategy: "constant", constantValue: "" });
  const [dateForm, setDateForm] = useState<DateFormState>({
    column: textColumns[0]?.name ?? "",
    format: "%Y-%m-%d",
    output: `${textColumns[0]?.name ?? "date"}_parsed`,
  });
  const [regexForm, setRegexForm] = useState<RegexFormState>({ column: textColumns[0]?.name ?? "", pattern: "", groupNames: "group_1" });
  const [trimForm, setTrimForm] = useState<TrimFormState>({ columns: textColumns.map((column) => column.name) });
  const [dedupeForm, setDedupeForm] = useState<DedupeFormState>({ columns: workingColumns.map((column) => column.name) });
  const latestUndoableEntry = history.find((entry) => entry.status === "applied") ?? null;

  function buildOperation(): BuiltOperation {
    return buildWranglerOperation({
      tableName,
      workingColumns,
      activeTab,
      splitForm,
      mergeForm,
      fillForm,
      dateForm,
      regexForm,
      trimForm,
      dedupeForm,
    });
  }

  function queuePreview() {
    try {
      setPreviewRequest({ ...buildOperation(), requestId: generateId() });
      setStatus(null);
    } catch (error) {
      setStatus({ tone: "error", message: error instanceof Error ? error.message : "Preview could not be created." });
    }
  }

  async function refreshProfiles() {
    const nextProfiles = await profileTable(tableName);
    startTransition(() => setWorkingColumns(nextProfiles));
  }

  async function applyOperation() {
    let built: BuiltOperation;
    try {
      built = buildOperation();
    } catch (error) {
      setStatus({ tone: "error", message: error instanceof Error ? error.message : "Operation is not valid." });
      return;
    }

    setBusy(true);
    setStatus(null);
    const historyId = generateId();
    const backupTableName = `${tableName}__wrangler_backup_${historyId}`;
    const safeBackup = quoteIdentifier(backupTableName);
    const safeTable = quoteIdentifier(tableName);

    try {
      const beforeCount = await getTableRowCount(tableName);
      await runQuery(`DROP TABLE IF EXISTS ${safeBackup}`);
      await runQuery(`CREATE TABLE ${safeBackup} AS SELECT * FROM ${safeTable}`);
      await runQuery(built.applySql);
      const afterCount = await getTableRowCount(tableName);
      await refreshProfiles();
      const entry: HistoryEntry = {
        id: historyId,
        operation: built.operation,
        label: built.label,
        sql: built.applySql,
        backupTable: backupTableName,
        beforeCount,
        afterCount,
        timestamp: Date.now(),
        status: "applied",
      };

      appendLineageEvent(tableName, {
        type: "transform",
        label: built.label,
        description: built.label,
        sql: built.applySql,
        rowsBefore: beforeCount,
        rowsAfter: afterCount,
        metadata: { operation: built.operation },
      });

      startTransition(() => {
        setHistory((current) => [entry, ...current]);
        setPreviewRequest({ ...built, requestId: generateId() });
        setStatus({ tone: "success", message: `${built.label} applied to ${tableName}.` });
      });
    } catch (error) {
      setStatus({ tone: "error", message: error instanceof Error ? error.message : "DuckDB rejected the transformation." });
    } finally {
      setBusy(false);
    }
  }

  async function undoLatest() {
    if (!latestUndoableEntry) return;
    setBusy(true);
    setStatus(null);
    try {
      const beforeCount = await getTableRowCount(tableName);
      await runQuery(`CREATE OR REPLACE TABLE ${quoteIdentifier(tableName)} AS SELECT * FROM ${quoteIdentifier(latestUndoableEntry.backupTable)}`);
      const afterCount = await getTableRowCount(tableName);
      await refreshProfiles();
      appendLineageEvent(tableName, {
        type: "transform",
        label: `Undo ${latestUndoableEntry.label}`,
        description: `Undo ${latestUndoableEntry.label}`,
        sql: `CREATE OR REPLACE TABLE ${quoteIdentifier(tableName)} AS SELECT * FROM ${quoteIdentifier(latestUndoableEntry.backupTable)}`,
        rowsBefore: beforeCount,
        rowsAfter: afterCount,
        metadata: { undoOf: latestUndoableEntry.id },
      });
      startTransition(() => {
        setHistory((current) => current.map((entry) => (entry.id === latestUndoableEntry.id ? { ...entry, status: "undone" } : entry)));
        setPreviewRequest(null);
        setStatus({ tone: "success", message: `Undid ${latestUndoableEntry.label}.` });
      });
    } catch (error) {
      setStatus({ tone: "error", message: error instanceof Error ? error.message : "Undo failed." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className={`${PANEL_CLASS} p-6`}>
      <WranglerToolbar
        activeTab={activeTab}
        busy={busy}
        columnsLength={workingColumns.length}
        hasUndoableEntry={Boolean(latestUndoableEntry)}
        status={status}
        onTabChange={setActiveTab}
        onUndoLatest={() => void undoLatest()}
      />

      <div className="mt-5 grid gap-6 xl:grid-cols-[0.9fr_1.1fr]">
        <div className="space-y-6">
          <WranglerFilters
            activeTab={activeTab}
            busy={busy}
            workingColumns={workingColumns}
            textColumns={textColumns}
            splitForm={splitForm}
            setSplitForm={setSplitForm}
            mergeForm={mergeForm}
            setMergeForm={setMergeForm}
            fillForm={fillForm}
            setFillForm={setFillForm}
            dateForm={dateForm}
            setDateForm={setDateForm}
            regexForm={regexForm}
            setRegexForm={setRegexForm}
            trimForm={trimForm}
            setTrimForm={setTrimForm}
            dedupeForm={dedupeForm}
            setDedupeForm={setDedupeForm}
            onPreview={queuePreview}
            onApply={() => void applyOperation()}
          />
          <WranglerGrid
            tableName={tableName}
            previewRequest={previewRequest}
            history={history}
            latestUndoableEntry={latestUndoableEntry}
            busy={busy}
            onUndoLatest={() => void undoLatest()}
            showHistory={false}
          />
        </div>
        <WranglerGrid
          tableName={tableName}
          previewRequest={previewRequest}
          history={history}
          latestUndoableEntry={latestUndoableEntry}
          busy={busy}
          onUndoLatest={() => void undoLatest()}
          showPreview={false}
        />
      </div>
    </section>
  );
}
