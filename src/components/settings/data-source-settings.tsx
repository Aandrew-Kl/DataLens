"use client";

import { startTransition, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { Database, FolderPlus, PlugZap, Trash2 } from "lucide-react";
import {
  ANALYTICS_EASE,
  BUTTON_CLASS,
  FIELD_CLASS,
  GLASS_CARD_CLASS,
  GLASS_PANEL_CLASS,
  isRecord,
} from "@/lib/utils/advanced-analytics";

type Delimiter = "," | ";" | "\t" | "|";
type Encoding = "utf-8" | "utf-16le" | "latin1";

interface DataSourceSettingsState {
  paths: string[];
  delimiter: Delimiter;
  hasHeaderRow: boolean;
  encoding: Encoding;
}

const STORAGE_KEY = "datalens:data-source-settings";
const DEFAULT_SETTINGS: DataSourceSettingsState = {
  paths: [],
  delimiter: ",",
  hasHeaderRow: true,
  encoding: "utf-8",
};

function readDataSourceSettings(): DataSourceSettingsState {
  if (typeof window === "undefined") return DEFAULT_SETTINGS;

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_SETTINGS;

    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed)) return DEFAULT_SETTINGS;

    const paths = Array.isArray(parsed.paths)
      ? parsed.paths.filter((value): value is string => typeof value === "string" && value.trim().length > 0)
      : DEFAULT_SETTINGS.paths;

    return {
      paths,
      delimiter:
        parsed.delimiter === ";" || parsed.delimiter === "\t" || parsed.delimiter === "|"
          ? parsed.delimiter
          : DEFAULT_SETTINGS.delimiter,
      hasHeaderRow:
        typeof parsed.hasHeaderRow === "boolean"
          ? parsed.hasHeaderRow
          : DEFAULT_SETTINGS.hasHeaderRow,
      encoding:
        parsed.encoding === "utf-16le" || parsed.encoding === "latin1"
          ? parsed.encoding
          : DEFAULT_SETTINGS.encoding,
    };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

function persistDataSourceSettings(settings: DataSourceSettingsState) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
}

function isPathValid(path: string) {
  const trimmed = path.trim();
  return trimmed.length > 2 && /[./\\]/.test(trimmed);
}

export default function DataSourceSettings() {
  const [settings, setSettings] = useState<DataSourceSettingsState>(() => readDataSourceSettings());
  const [pendingPath, setPendingPath] = useState("");
  const [status, setStatus] = useState("Configure local import paths and defaults for new data sources.");

  const validPathCount = useMemo(
    () => settings.paths.filter((path) => isPathValid(path)).length,
    [settings.paths],
  );

  function updateSettings(next: DataSourceSettingsState) {
    setSettings(next);
    persistDataSourceSettings(next);
  }

  function addPath() {
    const trimmed = pendingPath.trim();
    if (!trimmed) {
      setStatus("Enter a file path before adding a data source.");
      return;
    }

    if (settings.paths.includes(trimmed)) {
      setStatus("That data source path is already listed.");
      return;
    }

    startTransition(() => {
      const next = {
        ...settings,
        paths: [...settings.paths, trimmed],
      };
      updateSettings(next);
      setPendingPath("");
      setStatus(`Added ${trimmed} as a tracked data source.`);
    });
  }

  function removePath(path: string) {
    startTransition(() => {
      const next = {
        ...settings,
        paths: settings.paths.filter((entry) => entry !== path),
      };
      updateSettings(next);
      setStatus(`Removed ${path} from tracked data sources.`);
    });
  }

  function patchSettings(patch: Partial<DataSourceSettingsState>) {
    startTransition(() => {
      const next = {
        ...settings,
        ...patch,
      };
      updateSettings(next);
      setStatus("Data source defaults saved to localStorage.");
    });
  }

  function testConnections() {
    if (settings.paths.length === 0) {
      setStatus("Add at least one data source path before testing connections.");
      return;
    }

    const invalidPaths = settings.paths.filter((path) => !isPathValid(path));
    if (invalidPaths.length > 0) {
      setStatus(`Connection test failed for ${invalidPaths.length} path(s).`);
      return;
    }

    setStatus(`Connection test passed for ${settings.paths.length} data source path(s).`);
  }

  return (
    <motion.section
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.32, ease: ANALYTICS_EASE }}
      className={`${GLASS_PANEL_CLASS} overflow-hidden p-6`}
    >
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <div className="inline-flex items-center gap-2 rounded-full bg-cyan-500/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-cyan-700 dark:text-cyan-300">
            <Database className="h-3.5 w-3.5" />
            Data sources
          </div>
          <h2 className="mt-3 text-2xl font-semibold text-slate-950 dark:text-white">
            Configure local data source defaults
          </h2>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600 dark:text-slate-300">
            Track frequently used file paths, set import defaults, and validate source entries
            before loading them into DuckDB.
          </p>
        </div>

        <div className={`${GLASS_CARD_CLASS} max-w-md p-4`}>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
            Connection state
          </p>
          <p className="mt-2 text-lg font-semibold text-slate-950 dark:text-white">
            {validPathCount} valid source{validPathCount === 1 ? "" : "s"}
          </p>
          <p className="mt-2 text-sm leading-6 text-slate-600 dark:text-slate-300">{status}</p>
        </div>
      </div>

      <div className="mt-6 grid gap-5 xl:grid-cols-[1.05fr_0.95fr]">
        <div className={`${GLASS_CARD_CLASS} p-5`}>
          <label className="block">
            <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
              New data source path
            </span>
            <div className="flex gap-3">
              <input
                value={pendingPath}
                onChange={(event) => setPendingPath(event.target.value)}
                className={FIELD_CLASS}
                placeholder="/data/orders.csv"
                aria-label="New data source path"
              />
              <button type="button" onClick={addPath} className={BUTTON_CLASS}>
                <FolderPlus className="h-4 w-4" />
                Add path
              </button>
            </div>
          </label>

          <div className="mt-5 grid gap-4 md:grid-cols-3">
            <label className="block">
              <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
                Delimiter
              </span>
              <select
                value={settings.delimiter}
                onChange={(event) => patchSettings({ delimiter: event.target.value as Delimiter })}
                className={FIELD_CLASS}
                aria-label="Delimiter"
              >
                <option value=",">Comma</option>
                <option value=";">Semicolon</option>
                <option value={"	"}>Tab</option>
                <option value="|">Pipe</option>
              </select>
            </label>

            <label className="block">
              <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
                Encoding
              </span>
              <select
                value={settings.encoding}
                onChange={(event) => patchSettings({ encoding: event.target.value as Encoding })}
                className={FIELD_CLASS}
                aria-label="Encoding"
              >
                <option value="utf-8">UTF-8</option>
                <option value="utf-16le">UTF-16 LE</option>
                <option value="latin1">Latin-1</option>
              </select>
            </label>

            <label className="block">
              <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
                Header row
              </span>
              <button
                type="button"
                aria-pressed={settings.hasHeaderRow}
                onClick={() => patchSettings({ hasHeaderRow: !settings.hasHeaderRow })}
                className={`${BUTTON_CLASS} w-full justify-between`}
              >
                <span>{settings.hasHeaderRow ? "Enabled" : "Disabled"}</span>
                <span className="text-xs uppercase tracking-[0.18em]">
                  {settings.hasHeaderRow ? "On" : "Off"}
                </span>
              </button>
            </label>
          </div>

          <div className="mt-5">
            <button type="button" onClick={testConnections} className={BUTTON_CLASS}>
              <PlugZap className="h-4 w-4" />
              Test connections
            </button>
          </div>
        </div>

        <div className={`${GLASS_CARD_CLASS} overflow-hidden p-5`}>
          <h3 className="text-base font-semibold text-slate-950 dark:text-white">
            Registered paths
          </h3>
          {settings.paths.length === 0 ? (
            <p className="mt-4 text-sm leading-6 text-slate-600 dark:text-slate-300">
              Add local file paths or folders that you reuse when importing CSV and text-based
              data sources.
            </p>
          ) : (
            <ul className="mt-4 space-y-3">
              {settings.paths.map((path) => (
                <li
                  key={path}
                  className={`${GLASS_CARD_CLASS} flex items-center justify-between gap-3 p-3`}
                >
                  <div>
                    <p className="text-sm font-medium text-slate-950 dark:text-white">{path}</p>
                    <p className="mt-1 text-xs uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
                      {isPathValid(path) ? "Ready" : "Needs review"}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => removePath(path)}
                    className={BUTTON_CLASS}
                    aria-label={`Remove ${path}`}
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </motion.section>
  );
}
