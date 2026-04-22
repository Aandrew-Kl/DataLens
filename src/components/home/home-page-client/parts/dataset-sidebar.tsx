"use client";

import { motion } from "framer-motion";
import { Database, Menu, Upload, X } from "lucide-react";

import { formatNumber } from "@/lib/utils/formatters";
import { useDatasetStore } from "@/stores/dataset-store";

export function DatasetSidebar({
  isOpen,
  onToggle,
  onNewDataset,
}: {
  isOpen: boolean;
  onToggle: () => void;
  onNewDataset: () => void;
}) {
  const { datasets, activeDatasetId, setActiveDataset, removeDataset } =
    useDatasetStore();

  if (!isOpen) {
    return (
      <div className="flex w-14 shrink-0 flex-col items-center gap-3 border-r border-slate-200 bg-white/80 py-4 backdrop-blur-xl dark:border-slate-700/50 dark:bg-gray-900/80">
        <button
          onClick={onToggle}
          className="rounded-lg p-2 transition-colors hover:bg-slate-100 dark:hover:bg-slate-800"
          title="Expand sidebar"
        >
          <Menu className="h-4 w-4 text-slate-500" />
        </button>
        <div className="h-px w-6 bg-slate-200 dark:bg-slate-700" />
        {datasets.map((dataset) => (
          <button
            key={dataset.id}
            onClick={() => setActiveDataset(dataset.id)}
            className={`rounded-lg p-2 transition-colors ${
              dataset.id === activeDatasetId
                ? "bg-indigo-100 text-indigo-600 dark:bg-indigo-900/40 dark:text-indigo-400"
                : "text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
            }`}
            title={dataset.fileName}
          >
            <Database className="h-4 w-4" />
          </button>
        ))}
        <button
          onClick={onNewDataset}
          className="mt-auto rounded-lg p-2 text-slate-400 transition-colors hover:bg-slate-100 hover:text-indigo-500 dark:hover:bg-slate-800"
          title="Upload new dataset"
        >
          <Upload className="h-4 w-4" />
        </button>
      </div>
    );
  }

  return (
    <motion.div
      initial={{ width: 0, opacity: 0 }}
      animate={{ width: 240, opacity: 1 }}
      exit={{ width: 0, opacity: 0 }}
      transition={{ duration: 0.2 }}
      className="flex w-60 shrink-0 flex-col overflow-hidden border-r border-slate-200 bg-white/80 backdrop-blur-xl dark:border-slate-700/50 dark:bg-gray-900/80"
    >
      <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3 dark:border-slate-800">
        <div className="flex items-center gap-2">
          <div className="flex h-6 w-6 items-center justify-center rounded-lg bg-gradient-to-br from-indigo-500 to-purple-600">
            <Database className="h-3 w-3 text-white" />
          </div>
          <span className="text-sm font-semibold text-slate-900 dark:text-white">
            DataLens
          </span>
        </div>
        <button
          onClick={onToggle}
          className="rounded p-1 transition-colors hover:bg-slate-100 dark:hover:bg-slate-800"
        >
          <X className="h-3.5 w-3.5 text-slate-400" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto py-2">
        <div className="mb-2 px-3">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">
            Datasets ({datasets.length})
          </p>
        </div>

        {datasets.length === 0 ? (
          <div className="px-4 py-6 text-center">
            <Database className="mx-auto mb-2 h-8 w-8 text-slate-300 dark:text-slate-600" />
            <p className="text-xs text-slate-400 dark:text-slate-500">
              No datasets loaded
            </p>
          </div>
        ) : (
          <div className="space-y-0.5 px-2">
            {datasets.map((dataset) => (
              <div
                key={dataset.id}
                className={`group flex items-center gap-3 rounded-lg border px-2 py-2 transition-colors ${
                  dataset.id === activeDatasetId
                    ? "border-indigo-200/60 bg-indigo-50 dark:border-indigo-800/40 dark:bg-indigo-950/30"
                    : "border-transparent hover:bg-slate-50 dark:hover:bg-slate-800/50"
                }`}
              >
                <button
                  type="button"
                  onClick={() => setActiveDataset(dataset.id)}
                  className="flex min-w-0 flex-1 cursor-pointer items-center gap-3 border-0 bg-transparent p-0 text-left"
                >
                  <Database
                    className={`h-3.5 w-3.5 shrink-0 ${
                      dataset.id === activeDatasetId
                        ? "text-indigo-500"
                        : "text-slate-400"
                    }`}
                  />
                  <div className="min-w-0 flex-1">
                    <p
                      className={`truncate text-xs font-medium ${
                        dataset.id === activeDatasetId
                          ? "text-indigo-700 dark:text-indigo-300"
                          : "text-slate-700 dark:text-slate-300"
                      }`}
                    >
                      {dataset.fileName}
                    </p>
                    <p className="mt-0.5 text-[10px] text-slate-400 dark:text-slate-500">
                      {formatNumber(dataset.rowCount)} rows &middot;{" "}
                      {dataset.columnCount} cols
                    </p>
                  </div>
                </button>
                <button
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation();
                    removeDataset(dataset.id);
                  }}
                  className="rounded p-1 opacity-0 transition-all hover:bg-slate-200 group-hover:opacity-100 dark:hover:bg-slate-700"
                  title="Remove dataset"
                >
                  <X className="h-3 w-3 text-slate-400" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="border-t border-slate-100 px-3 py-3 dark:border-slate-800">
        <button
          onClick={onNewDataset}
          className="flex w-full items-center justify-center gap-2 rounded-lg border border-dashed border-slate-300 px-3 py-2 text-xs font-medium text-slate-500 transition-colors hover:border-indigo-400 hover:text-indigo-600 dark:border-slate-600 dark:text-slate-400 dark:hover:border-indigo-600 dark:hover:text-indigo-400"
        >
          <Upload className="h-3.5 w-3.5" />
          Upload Dataset
        </button>
      </div>
    </motion.div>
  );
}
