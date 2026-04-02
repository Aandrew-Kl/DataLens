"use client";

import { useState, useMemo, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Search,
  X,
  Code2,
  Play,
  BarChart3,
  Calculator,
  TrendingUp,
  ArrowUpDown,
  Filter,
  CircleSlash,
  Hash,
  LineChart,
  Calendar,
  CalendarRange,
  Percent,
  Table2,
  List,
  Layers,
  Sparkles,
  type LucideIcon,
} from "lucide-react";
import {
  SQL_TEMPLATES,
  renderTemplate,
  type SQLTemplate,
  type TemplateCategory,
} from "@/lib/utils/sql-templates";
import type { ColumnProfile } from "@/types/dataset";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface TemplatePickerProps {
  tableName: string;
  columns: ColumnProfile[];
  onSelectSQL: (sql: string) => void;
}

type CategoryFilter = "All" | TemplateCategory;

// ---------------------------------------------------------------------------
// Icon map -- resolve string names from template definitions to components
// ---------------------------------------------------------------------------

const ICON_MAP: Record<string, LucideIcon> = {
  BarChart3,
  Calculator,
  TrendingUp,
  ArrowUpDown,
  Filter,
  CircleSlash,
  Hash,
  LineChart,
  Calendar,
  CalendarRange,
  Search,
  List,
  Percent,
  Table2,
};

function resolveIcon(name: string): LucideIcon {
  return ICON_MAP[name] ?? Code2;
}

// ---------------------------------------------------------------------------
// Category metadata
// ---------------------------------------------------------------------------

const CATEGORIES: { label: CategoryFilter; icon: LucideIcon }[] = [
  { label: "All", icon: Layers },
  { label: "Aggregation", icon: BarChart3 },
  { label: "Filtering", icon: Filter },
  { label: "Window", icon: Sparkles },
  { label: "Date", icon: Calendar },
  { label: "Text", icon: Search },
  { label: "Advanced", icon: Code2 },
];

const CATEGORY_COLORS: Record<TemplateCategory, string> = {
  Aggregation:
    "bg-blue-50 text-blue-600 border-blue-200/60 dark:bg-blue-950/30 dark:text-blue-400 dark:border-blue-800/40",
  Filtering:
    "bg-emerald-50 text-emerald-600 border-emerald-200/60 dark:bg-emerald-950/30 dark:text-emerald-400 dark:border-emerald-800/40",
  Window:
    "bg-purple-50 text-purple-600 border-purple-200/60 dark:bg-purple-950/30 dark:text-purple-400 dark:border-purple-800/40",
  Date: "bg-amber-50 text-amber-600 border-amber-200/60 dark:bg-amber-950/30 dark:text-amber-400 dark:border-amber-800/40",
  Text: "bg-rose-50 text-rose-600 border-rose-200/60 dark:bg-rose-950/30 dark:text-rose-400 dark:border-rose-800/40",
  Advanced:
    "bg-gray-50 text-gray-600 border-gray-200/60 dark:bg-gray-800/40 dark:text-gray-400 dark:border-gray-700/40",
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function TemplatePicker({
  tableName,
  columns,
  onSelectSQL,
}: TemplatePickerProps) {
  const [search, setSearch] = useState("");
  const [activeCategory, setActiveCategory] = useState<CategoryFilter>("All");
  const [selectedTemplate, setSelectedTemplate] = useState<SQLTemplate | null>(
    null,
  );
  const [paramValues, setParamValues] = useState<Record<string, string>>({});

  // -------------------------------------------------------------------------
  // Derived: filtered templates
  // -------------------------------------------------------------------------

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();

    return SQL_TEMPLATES.filter((tpl) => {
      if (activeCategory !== "All" && tpl.category !== activeCategory) {
        return false;
      }
      if (!query) return true;
      return (
        tpl.name.toLowerCase().includes(query) ||
        tpl.description.toLowerCase().includes(query)
      );
    });
  }, [search, activeCategory]);

  // -------------------------------------------------------------------------
  // Derived: live SQL preview
  // -------------------------------------------------------------------------

  const previewSQL = useMemo(() => {
    if (!selectedTemplate) return "";
    return renderTemplate(selectedTemplate.template, tableName, paramValues);
  }, [selectedTemplate, tableName, paramValues]);

  // -------------------------------------------------------------------------
  // Derived: columns filtered by type for a given param
  // -------------------------------------------------------------------------

  const columnsForParam = useCallback(
    (columnType?: string) => {
      if (!columnType) return columns;
      return columns.filter((col) => col.type === columnType);
    },
    [columns],
  );

  // -------------------------------------------------------------------------
  // Handlers
  // -------------------------------------------------------------------------

  const openTemplate = useCallback(
    (tpl: SQLTemplate) => {
      setSelectedTemplate(tpl);
      // Pre-populate defaults
      const defaults: Record<string, string> = {};
      for (const p of tpl.params) {
        if (p.defaultValue) {
          defaults[p.key] = p.defaultValue;
        } else if (p.kind === "column") {
          const available = columnsForParam(p.columnType);
          if (available.length > 0) {
            defaults[p.key] = available[0].name;
          }
        }
      }
      setParamValues(defaults);
    },
    [columnsForParam],
  );

  const closeTemplate = useCallback(() => {
    setSelectedTemplate(null);
    setParamValues({});
  }, []);

  const updateParam = useCallback((key: string, value: string) => {
    setParamValues((prev) => ({ ...prev, [key]: value }));
  }, []);

  const handleUseQuery = useCallback(() => {
    if (!selectedTemplate) return;
    onSelectSQL(previewSQL);
    closeTemplate();
  }, [selectedTemplate, previewSQL, onSelectSQL, closeTemplate]);

  // -------------------------------------------------------------------------
  // Check whether all required params are filled
  // -------------------------------------------------------------------------

  const allParamsFilled = useMemo(() => {
    if (!selectedTemplate) return false;
    return selectedTemplate.params.every(
      (p) => (paramValues[p.key] ?? "").trim().length > 0,
    );
  }, [selectedTemplate, paramValues]);

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  return (
    <>
      <section className="flex h-full min-h-[420px] flex-col overflow-hidden rounded-2xl border border-gray-200/60 bg-white/70 backdrop-blur-xl dark:border-gray-700/50 dark:bg-gray-900/70">
        {/* Header */}
        <div className="border-b border-gray-200/60 px-4 py-4 dark:border-gray-700/50">
          <div className="flex items-center gap-3">
            <div className="rounded-xl bg-indigo-50 p-2.5 text-indigo-500 dark:bg-indigo-950/40 dark:text-indigo-300">
              <Code2 className="h-4 w-4" />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-gray-800 dark:text-gray-100">
                SQL Templates
              </h2>
              <p className="text-xs text-gray-500 dark:text-gray-400">
                Pick a template, fill in the parameters, and get ready-to-run
                SQL.
              </p>
            </div>
          </div>

          {/* Search */}
          <div className="relative mt-4">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400 dark:text-gray-500" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search templates..."
              className="w-full rounded-xl border border-gray-200/80 bg-white/90 py-2.5 pl-10 pr-10 text-sm text-gray-700 outline-none transition focus:border-indigo-300 focus:ring-2 focus:ring-indigo-400/20 dark:border-gray-700/70 dark:bg-gray-800/90 dark:text-gray-200 dark:focus:border-indigo-500"
            />
            {search && (
              <button
                type="button"
                onClick={() => setSearch("")}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 transition-colors hover:text-gray-600 dark:text-gray-500 dark:hover:text-gray-300"
                aria-label="Clear search"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>

          {/* Category tabs */}
          <div className="mt-4 flex flex-wrap gap-2">
            {CATEGORIES.map(({ label, icon: Icon }) => (
              <button
                key={label}
                type="button"
                onClick={() => setActiveCategory(label)}
                className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${
                  activeCategory === label
                    ? "bg-indigo-500 text-white shadow-sm"
                    : "bg-gray-100 text-gray-600 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700"
                }`}
              >
                <Icon className="h-3 w-3" />
                {label}
              </button>
            ))}
          </div>
        </div>

        {/* Template grid */}
        <div className="flex-1 overflow-y-auto px-4 py-4">
          {filtered.length === 0 ? (
            <motion.div
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              className="flex h-full flex-col items-center justify-center rounded-2xl border border-dashed border-gray-200/80 bg-gray-50/70 px-6 text-center dark:border-gray-700/60 dark:bg-gray-800/30"
            >
              <Search className="h-10 w-10 text-gray-300 dark:text-gray-600" />
              <h3 className="mt-4 text-sm font-semibold text-gray-700 dark:text-gray-200">
                No templates found
              </h3>
              <p className="mt-2 max-w-sm text-sm text-gray-500 dark:text-gray-400">
                Try a different search term or category filter.
              </p>
            </motion.div>
          ) : (
            <motion.div
              layout
              className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3"
            >
              <AnimatePresence initial={false}>
                {filtered.map((tpl, idx) => {
                  const Icon = resolveIcon(tpl.icon);
                  return (
                    <motion.button
                      key={tpl.id}
                      layout
                      type="button"
                      initial={{ opacity: 0, y: 12 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, scale: 0.96 }}
                      transition={{ duration: 0.2, delay: idx * 0.03 }}
                      onClick={() => openTemplate(tpl)}
                      className="group flex flex-col items-start gap-2 rounded-2xl border border-gray-200/70 bg-white/85 p-4 text-left transition-all hover:border-indigo-300 hover:shadow-md dark:border-gray-700/60 dark:bg-gray-800/70 dark:hover:border-indigo-600"
                    >
                      <div className="flex w-full items-center justify-between gap-2">
                        <div
                          className={`rounded-lg border p-2 ${CATEGORY_COLORS[tpl.category]}`}
                        >
                          <Icon className="h-4 w-4" />
                        </div>
                        <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-medium text-gray-500 dark:bg-gray-700/60 dark:text-gray-400">
                          {tpl.category}
                        </span>
                      </div>
                      <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-100">
                        {tpl.name}
                      </h3>
                      <p className="text-xs leading-relaxed text-gray-500 dark:text-gray-400">
                        {tpl.description}
                      </p>
                      <span className="mt-auto text-[10px] font-medium text-indigo-500 opacity-0 transition-opacity group-hover:opacity-100 dark:text-indigo-400">
                        Click to configure
                      </span>
                    </motion.button>
                  );
                })}
              </AnimatePresence>
            </motion.div>
          )}
        </div>
      </section>

      {/* ------------------------------------------------------------------ */}
      {/* Configuration modal                                                  */}
      {/* ------------------------------------------------------------------ */}

      <AnimatePresence>
        {selectedTemplate && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-gray-950/55 p-4 backdrop-blur-sm"
            onClick={closeTemplate}
          >
            <motion.div
              initial={{ opacity: 0, y: 16, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 12, scale: 0.98 }}
              transition={{ duration: 0.2 }}
              onClick={(e) => e.stopPropagation()}
              className="flex w-full max-w-2xl flex-col rounded-3xl border border-gray-200/70 bg-white shadow-2xl dark:border-gray-700/60 dark:bg-gray-900"
            >
              {/* Modal header */}
              <div className="flex items-start justify-between gap-4 border-b border-gray-200/60 px-6 py-5 dark:border-gray-700/50">
                <div className="flex items-center gap-3">
                  <div
                    className={`rounded-lg border p-2 ${CATEGORY_COLORS[selectedTemplate.category]}`}
                  >
                    {(() => {
                      const Icon = resolveIcon(selectedTemplate.icon);
                      return <Icon className="h-5 w-5" />;
                    })()}
                  </div>
                  <div>
                    <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
                      {selectedTemplate.name}
                    </h3>
                    <p className="mt-0.5 text-sm text-gray-500 dark:text-gray-400">
                      {selectedTemplate.description}
                    </p>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={closeTemplate}
                  className="rounded-xl p-2 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600 dark:text-gray-500 dark:hover:bg-gray-800 dark:hover:text-gray-300"
                  aria-label="Close"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              {/* Parameter form */}
              <div className="space-y-4 px-6 py-5">
                {selectedTemplate.params.map((param) => {
                  const available = columnsForParam(param.columnType);

                  return (
                    <div key={param.key}>
                      <label className="mb-1.5 block text-xs font-medium text-gray-600 dark:text-gray-400">
                        {param.label}
                      </label>

                      {param.kind === "column" ? (
                        <select
                          value={paramValues[param.key] ?? ""}
                          onChange={(e) =>
                            updateParam(param.key, e.target.value)
                          }
                          className="w-full rounded-xl border border-gray-200/80 bg-white/90 px-3 py-2.5 text-sm text-gray-700 outline-none transition focus:border-indigo-300 focus:ring-2 focus:ring-indigo-400/20 dark:border-gray-700/70 dark:bg-gray-800/90 dark:text-gray-200 dark:focus:border-indigo-500"
                        >
                          <option value="">Select a column...</option>
                          {available.map((col) => (
                            <option key={col.name} value={col.name}>
                              {col.name} ({col.type})
                            </option>
                          ))}
                        </select>
                      ) : (
                        <input
                          type="text"
                          value={paramValues[param.key] ?? ""}
                          onChange={(e) =>
                            updateParam(param.key, e.target.value)
                          }
                          placeholder={param.placeholder}
                          className="w-full rounded-xl border border-gray-200/80 bg-white/90 px-3 py-2.5 text-sm text-gray-700 outline-none transition focus:border-indigo-300 focus:ring-2 focus:ring-indigo-400/20 dark:border-gray-700/70 dark:bg-gray-800/90 dark:text-gray-200 dark:focus:border-indigo-500"
                        />
                      )}
                    </div>
                  );
                })}

                {/* Live SQL preview */}
                <div>
                  <label className="mb-1.5 block text-xs font-medium text-gray-600 dark:text-gray-400">
                    SQL Preview
                  </label>
                  <pre className="overflow-x-auto rounded-xl border border-gray-200/60 bg-gray-950 px-4 py-3 font-mono text-xs leading-6 text-gray-100 dark:border-gray-700/60">
                    {previewSQL}
                  </pre>
                </div>
              </div>

              {/* Modal footer */}
              <div className="flex flex-wrap justify-end gap-2 border-t border-gray-200/60 px-6 py-4 dark:border-gray-700/50">
                <button
                  type="button"
                  onClick={closeTemplate}
                  className="inline-flex items-center gap-2 rounded-xl border border-gray-200 px-3 py-2 text-sm font-medium text-gray-500 transition-colors hover:border-gray-300 hover:text-gray-700 dark:border-gray-700 dark:text-gray-400 dark:hover:border-gray-600 dark:hover:text-gray-200"
                >
                  Cancel
                </button>

                <button
                  type="button"
                  onClick={handleUseQuery}
                  disabled={!allParamsFilled}
                  className="inline-flex items-center gap-2 rounded-xl bg-indigo-500 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-indigo-600 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <Play className="h-3.5 w-3.5" />
                  Use This Query
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
