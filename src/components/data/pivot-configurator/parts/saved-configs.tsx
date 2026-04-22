"use client";

import { Save } from "lucide-react";
import type { Dispatch, SetStateAction } from "react";

import { FIELD_CLASS, type SavedPivotConfig } from "../types";

interface SavedConfigsPanelProps {
  configName: string;
  setConfigName: Dispatch<SetStateAction<string>>;
  savedConfigs: SavedPivotConfig[];
  showSubtotals: boolean;
  setShowSubtotals: Dispatch<SetStateAction<boolean>>;
  showGrandTotals: boolean;
  setShowGrandTotals: Dispatch<SetStateAction<boolean>>;
  onSave: () => void;
  onApply: (config: SavedPivotConfig) => void;
  onDelete: (configId: string) => void;
}

export function SavedConfigsPanel({
  configName,
  setConfigName,
  savedConfigs,
  showSubtotals,
  setShowSubtotals,
  showGrandTotals,
  setShowGrandTotals,
  onSave,
  onApply,
  onDelete,
}: SavedConfigsPanelProps) {
  return (
    <div className="rounded-[1.6rem] border border-white/15 bg-white/45 p-4 dark:bg-slate-950/30">
      <div className="grid gap-3 md:grid-cols-[1fr_auto_auto]">
        <input
          value={configName}
          onChange={(event) => setConfigName(event.target.value)}
          placeholder="Quarterly executive pivot"
          className={FIELD_CLASS}
        />
        <button
          type="button"
          onClick={onSave}
          className="inline-flex items-center gap-2 rounded-2xl border border-white/20 bg-white/55 px-4 py-3 text-sm text-slate-700 transition hover:border-cyan-300/40 dark:bg-slate-950/35 dark:text-slate-200"
        >
          <Save className="h-4 w-4" />
          Save layout
        </button>
        <div className="flex items-center gap-3 rounded-2xl border border-white/15 bg-white/55 px-4 py-3 text-sm text-slate-700 dark:bg-slate-950/35 dark:text-slate-200">
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={showSubtotals}
              onChange={(event) => setShowSubtotals(event.target.checked)}
              className="h-4 w-4 rounded border-white/20 bg-white/70 text-cyan-500"
            />
            Subtotals
          </label>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={showGrandTotals}
              onChange={(event) => setShowGrandTotals(event.target.checked)}
              className="h-4 w-4 rounded border-white/20 bg-white/70 text-cyan-500"
            />
            Grand totals
          </label>
        </div>
      </div>
      <div className="mt-4 grid gap-3">
        {savedConfigs.length === 0 ? (
          <p className="text-sm text-slate-500 dark:text-slate-400">
            No saved configurations yet.
          </p>
        ) : (
          savedConfigs.map((config) => (
            <div
              key={config.id}
              className="flex items-center justify-between gap-3 rounded-2xl border border-white/15 bg-white/55 px-4 py-3 dark:bg-slate-950/35"
            >
              <div>
                <div className="text-sm font-semibold text-slate-950 dark:text-white">
                  {config.name}
                </div>
                <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                  {config.rowFields.length} row, {config.columnFields.length} column, {config.valueFields.length} value fields
                </div>
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => onApply(config)}
                  className="rounded-2xl border border-white/20 bg-white/70 px-3 py-2 text-sm text-slate-700 transition hover:border-cyan-300/40 dark:bg-slate-900/60 dark:text-slate-200"
                >
                  Load
                </button>
                <button
                  type="button"
                  onClick={() => onDelete(config.id)}
                  className="rounded-2xl border border-rose-300/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-700 dark:text-rose-300"
                >
                  Delete
                </button>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
