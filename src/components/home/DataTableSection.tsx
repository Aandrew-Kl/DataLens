"use client";

import { useCallback, useState } from "react";
import { Upload } from "lucide-react";

import { formatBytes } from "@/lib/utils/formatters";
import type { ColumnProfile } from "@/types/dataset";
import DataDictionary from "@/components/data/data-dictionary";
import DataPreview from "@/components/data/data-preview";
import GaugeChart from "@/components/charts/gauge-chart";
import MetricCard from "@/components/data/metric-card";
import RowDetailModal from "@/components/data/row-detail-modal";
import SchemaViewer from "@/components/data/schema-viewer";
import SnapshotManager from "@/components/data/snapshot-manager";
import VirtualDataGrid from "@/components/data/virtual-data-grid";
import { ErrorBoundary } from "@/components/ui/error-boundary";

import { TablePreview, ToolSection } from "@/components/home/workspace-shared";

interface DataTableSectionProps {
  tableName: string;
  columns: ColumnProfile[];
  fileName: string;
  rowCount: number;
  sizeBytes: number;
  completenessPct: number;
  onOpenExportWizard: () => void;
}

export default function DataTableSection({
  tableName,
  columns,
  fileName,
  rowCount,
  sizeBytes,
  completenessPct,
  onOpenExportWizard,
}: DataTableSectionProps) {
  const [previewRows, setPreviewRows] = useState<Record<string, unknown>[]>([]);
  const [selectedPreviewRow, setSelectedPreviewRow] = useState<
    Record<string, unknown> | null
  >(null);
  const [selectedPreviewRowIndex, setSelectedPreviewRowIndex] = useState<
    number | null
  >(null);

  const handlePreviewRowsLoaded = useCallback(
    (rows: Record<string, unknown>[]) => {
      setPreviewRows(rows);
      setSelectedPreviewRow(null);
      setSelectedPreviewRowIndex(null);
    },
    [],
  );

  const handlePreviewRowClick = useCallback(
    (row: Record<string, unknown>) => {
      const nextIndex = previewRows.indexOf(row);
      setSelectedPreviewRow(row);
      setSelectedPreviewRowIndex(nextIndex >= 0 ? nextIndex : null);
    },
    [previewRows],
  );

  const handleOpenPreviousPreviewRow = useCallback(() => {
    if (selectedPreviewRowIndex == null || selectedPreviewRowIndex <= 0) {
      return;
    }

    const nextIndex = selectedPreviewRowIndex - 1;
    setSelectedPreviewRowIndex(nextIndex);
    setSelectedPreviewRow(previewRows[nextIndex] ?? null);
  }, [previewRows, selectedPreviewRowIndex]);

  const handleOpenNextPreviewRow = useCallback(() => {
    if (
      selectedPreviewRowIndex == null ||
      selectedPreviewRowIndex >= previewRows.length - 1
    ) {
      return;
    }

    const nextIndex = selectedPreviewRowIndex + 1;
    setSelectedPreviewRowIndex(nextIndex);
    setSelectedPreviewRow(previewRows[nextIndex] ?? null);
  }, [previewRows, selectedPreviewRowIndex]);

  return (
    <>
      <div className="pt-4">
        <div className="flex items-center justify-between mb-1">
          <h2 className="text-lg font-semibold text-slate-900 dark:text-white">
            Data Preview
          </h2>
          <button
            onClick={onOpenExportWizard}
            className="flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 transition-colors hover:bg-slate-50 dark:border-slate-700 dark:text-slate-400 dark:hover:bg-slate-800"
          >
            <Upload className="h-3.5 w-3.5 rotate-180" />
            Export
          </button>
        </div>
        <p className="text-sm text-slate-500 dark:text-slate-400 mb-4">
          First 200 rows
        </p>
        <ErrorBoundary>
          <TablePreview
            tableName={tableName}
            columns={columns}
            onRowsLoaded={handlePreviewRowsLoaded}
            onRowClick={handlePreviewRowClick}
          />
        </ErrorBoundary>
      </div>

      <ToolSection
        title="Interactive Preview"
        description="Browse a paginated preview with sortable headers, inline filtering, and column-level quick stats beyond the first 200 rows."
      >
        <ErrorBoundary>
          <DataPreview
            tableName={tableName}
            columns={columns}
            previewRows={previewRows}
          />
        </ErrorBoundary>
      </ToolSection>

      <div className="pt-4">
        <ErrorBoundary>
          <SchemaViewer
            tableName={tableName}
            columns={columns}
            rowCount={rowCount}
          />
        </ErrorBoundary>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        <MetricCard label="Rows" value={rowCount} emoji="📄" />
        <MetricCard label="Columns" value={columns.length} emoji="🧱" />
        <MetricCard
          label="Completeness"
          value={`${completenessPct.toFixed(1)}%`}
          emoji="✅"
        />
        <MetricCard
          label="Dataset Size"
          value={formatBytes(sizeBytes)}
          emoji="💾"
        />
      </div>

      <ToolSection
        title="Readiness Gauge"
        description="Track dataset completeness as a single operational KPI before you pivot into cleaning, reporting, or modeling work."
      >
        <ErrorBoundary>
          <GaugeChart
            value={Math.max(0, Math.min(100, completenessPct))}
            min={0}
            max={100}
            title={`${fileName} completeness`}
            thresholds={{ green: 75, yellow: 90, red: 100 }}
          />
        </ErrorBoundary>
      </ToolSection>

      <ErrorBoundary>
        <DataDictionary
          tableName={tableName}
          columns={columns}
          rowCount={rowCount}
        />
      </ErrorBoundary>

      <ErrorBoundary>
        <VirtualDataGrid
          tableName={tableName}
          columns={columns}
          totalRows={rowCount}
        />
      </ErrorBoundary>

      <ErrorBoundary>
        <SnapshotManager
          tableName={tableName}
          columns={columns}
          rowCount={rowCount}
        />
      </ErrorBoundary>

      <RowDetailModal
        open={selectedPreviewRow !== null}
        onClose={() => {
          setSelectedPreviewRow(null);
          setSelectedPreviewRowIndex(null);
        }}
        row={selectedPreviewRow ?? {}}
        columns={columns}
        onPrevious={
          selectedPreviewRowIndex != null && selectedPreviewRowIndex > 0
            ? handleOpenPreviousPreviewRow
            : undefined
        }
        onNext={
          selectedPreviewRowIndex != null &&
          selectedPreviewRowIndex < previewRows.length - 1
            ? handleOpenNextPreviewRow
            : undefined
        }
        hasPrevious={
          selectedPreviewRowIndex != null && selectedPreviewRowIndex > 0
        }
        hasNext={
          selectedPreviewRowIndex != null &&
          selectedPreviewRowIndex < previewRows.length - 1
        }
        rowIndex={selectedPreviewRowIndex ?? undefined}
        totalRows={previewRows.length || undefined}
      />
    </>
  );
}
