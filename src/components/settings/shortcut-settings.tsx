"use client";

import { startTransition, useCallback, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { AlertTriangle, Command, Keyboard, RotateCcw } from "lucide-react";
import {
  ANALYTICS_EASE,
  BUTTON_CLASS,
  GLASS_CARD_CLASS,
  GLASS_PANEL_CLASS,
  isRecord,
} from "@/lib/utils/advanced-analytics";
import type { ColumnProfile } from "@/types/dataset";

interface ShortcutSettingsProps {
  tableName: string;
  columns: ColumnProfile[];
}

interface ShortcutBinding {
  id: string;
  label: string;
  keys: string;
}

type ShortcutMap = Record<string, string>;

const DEFAULT_SHORTCUTS: ShortcutBinding[] = [
  { id: "run-query", label: "Run query", keys: "Ctrl+Enter" },
  { id: "save-query", label: "Save query", keys: "Ctrl+S" },
  { id: "export-csv", label: "Export CSV", keys: "Ctrl+Shift+E" },
  { id: "toggle-sidebar", label: "Toggle sidebar", keys: "Ctrl+B" },
  { id: "new-tab", label: "New tab", keys: "Ctrl+T" },
  { id: "close-tab", label: "Close tab", keys: "Ctrl+W" },
  { id: "search", label: "Search", keys: "Ctrl+K" },
  { id: "undo", label: "Undo", keys: "Ctrl+Z" },
];

function buildDefaultMap(): ShortcutMap {
  const map: ShortcutMap = {};
  for (const shortcut of DEFAULT_SHORTCUTS) {
    map[shortcut.id] = shortcut.keys;
  }
  return map;
}

function readShortcuts(tableName: string): ShortcutMap {
  if (typeof window === "undefined") return buildDefaultMap();

  try {
    const raw = window.localStorage.getItem(`datalens:shortcuts:${tableName}`);
    if (!raw) return buildDefaultMap();

    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed)) return buildDefaultMap();

    const defaults = buildDefaultMap();
    const result: ShortcutMap = {};

    for (const key of Object.keys(defaults)) {
      const value = parsed[key];
      result[key] = typeof value === "string" && value.trim() !== "" ? value : defaults[key] ?? "";
    }

    return result;
  } catch {
    return buildDefaultMap();
  }
}

function persistShortcuts(tableName: string, shortcuts: ShortcutMap) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(
    `datalens:shortcuts:${tableName}`,
    JSON.stringify(shortcuts),
  );
}

function normalizeKeyCombo(raw: string): string {
  return raw
    .split("+")
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join("+");
}

function detectConflicts(shortcuts: ShortcutMap, currentId: string, newKeys: string): string | null {
  const normalized = normalizeKeyCombo(newKeys);
  for (const [id, keys] of Object.entries(shortcuts)) {
    if (id !== currentId && normalizeKeyCombo(keys) === normalized) {
      const label = DEFAULT_SHORTCUTS.find((s) => s.id === id)?.label ?? id;
      return `Conflicts with "${label}"`;
    }
  }
  return null;
}

export default function ShortcutSettings({
  tableName,
}: ShortcutSettingsProps) {
  const [shortcuts, setShortcuts] = useState<ShortcutMap>(() =>
    readShortcuts(tableName),
  );
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const [conflict, setConflict] = useState<string | null>(null);
  const [status, setStatus] = useState("Keyboard shortcuts are stored locally.");

  const shortcutList = useMemo(
    () =>
      DEFAULT_SHORTCUTS.map((s) => ({
        ...s,
        keys: shortcuts[s.id] ?? s.keys,
      })),
    [shortcuts],
  );

  const handleEdit = useCallback((id: string, currentKeys: string) => {
    setEditingId(id);
    setEditValue(currentKeys);
    setConflict(null);
  }, []);

  function handleSave(id: string) {
    const trimmed = editValue.trim();
    if (!trimmed) {
      setConflict("Key binding cannot be empty.");
      return;
    }

    const conflictMsg = detectConflicts(shortcuts, id, trimmed);
    if (conflictMsg) {
      setConflict(conflictMsg);
      return;
    }

    startTransition(() => {
      const next = { ...shortcuts, [id]: normalizeKeyCombo(trimmed) };
      setShortcuts(next);
      persistShortcuts(tableName, next);
      setEditingId(null);
      setEditValue("");
      setConflict(null);
      setStatus(`Updated shortcut for "${DEFAULT_SHORTCUTS.find((s) => s.id === id)?.label ?? id}".`);
    });
  }

  function handleCancel() {
    setEditingId(null);
    setEditValue("");
    setConflict(null);
  }

  function handleReset() {
    startTransition(() => {
      const defaults = buildDefaultMap();
      setShortcuts(defaults);
      persistShortcuts(tableName, defaults);
      setEditingId(null);
      setEditValue("");
      setConflict(null);
      setStatus("Reset all shortcuts to defaults.");
    });
  }

  return (
    <section className={`${GLASS_PANEL_CLASS} p-6`}>
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <div className="inline-flex items-center gap-2 rounded-full bg-amber-500/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-amber-700 dark:text-amber-300">
            <Keyboard className="h-3.5 w-3.5" />
            Keyboard shortcuts
          </div>
          <h2 className="mt-3 text-2xl font-semibold text-slate-950 dark:text-white">
            Customize keyboard shortcuts
          </h2>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600 dark:text-slate-300">
            View and rebind keyboard shortcuts for the current workspace. Conflicts
            are detected automatically.
          </p>
        </div>

        <button type="button" onClick={handleReset} className={BUTTON_CLASS}>
          <RotateCcw className="h-4 w-4" />
          Reset to defaults
        </button>
      </div>

      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.24, ease: ANALYTICS_EASE }}
        className="mt-6 space-y-3"
      >
        {shortcutList.map((shortcut) => (
          <div
            key={shortcut.id}
            className={`${GLASS_CARD_CLASS} flex items-center justify-between gap-4 p-4`}
          >
            <div className="flex items-center gap-3">
              <div className="rounded-2xl bg-amber-500/10 p-2.5 text-amber-600 dark:text-amber-300">
                <Command className="h-4 w-4" />
              </div>
              <p className="font-medium text-slate-950 dark:text-white">{shortcut.label}</p>
            </div>

            {editingId === shortcut.id ? (
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={editValue}
                  onChange={(e) => {
                    setEditValue(e.target.value);
                    setConflict(null);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleSave(shortcut.id);
                    if (e.key === "Escape") handleCancel();
                  }}
                  className="w-40 rounded-xl border border-white/20 bg-white/80 px-3 py-1.5 text-sm text-slate-700 outline-none focus:border-amber-400 dark:border-white/10 dark:bg-slate-950/55 dark:text-slate-100"
                  autoFocus
                />
                <button
                  type="button"
                  onClick={() => handleSave(shortcut.id)}
                  className="rounded-xl bg-amber-500/15 px-3 py-1.5 text-xs font-semibold text-amber-700 dark:text-amber-300"
                >
                  Save
                </button>
                <button
                  type="button"
                  onClick={handleCancel}
                  className="rounded-xl bg-slate-900/5 px-3 py-1.5 text-xs font-semibold text-slate-600 dark:bg-white/10 dark:text-slate-300"
                >
                  Cancel
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => handleEdit(shortcut.id, shortcut.keys)}
                className="rounded-xl border border-white/20 bg-white/65 px-4 py-1.5 text-sm font-mono text-slate-700 transition hover:bg-white/90 dark:border-white/10 dark:bg-slate-950/35 dark:text-slate-200 dark:hover:bg-slate-900/80"
              >
                {shortcut.keys}
              </button>
            )}
          </div>
        ))}
      </motion.div>

      {conflict ? (
        <div className="mt-4 flex items-center gap-2 rounded-2xl border border-amber-500/20 bg-amber-500/10 px-4 py-3 text-sm text-amber-700 dark:text-amber-200">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          {conflict}
        </div>
      ) : null}

      <div className="mt-6 text-sm text-slate-600 dark:text-slate-300">{status}</div>
    </section>
  );
}
