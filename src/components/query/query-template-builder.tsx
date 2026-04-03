"use client";

import { useMemo, useState } from "react";
import { motion } from "framer-motion";
import { Copy, Save, Sparkles } from "lucide-react";
import {
  ANALYTICS_EASE,
  BUTTON_CLASS,
  FIELD_CLASS,
  GLASS_CARD_CLASS,
  GLASS_PANEL_CLASS,
} from "@/lib/utils/advanced-analytics";

interface QueryTemplateBuilderProps {
  tableName: string;
  columns: import("@/types/dataset").ColumnProfile[];
}

interface SavedTemplate {
  id: string;
  name: string;
  template: string;
  updatedAt: number;
}

const STORAGE_KEY = "datalens:query-template-builder";

function createId() {
  return `template-${Math.random().toString(36).slice(2, 8)}`;
}

function isSavedTemplate(value: unknown): value is SavedTemplate {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as Record<string, unknown>).id === "string" &&
    typeof (value as Record<string, unknown>).name === "string" &&
    typeof (value as Record<string, unknown>).template === "string" &&
    typeof (value as Record<string, unknown>).updatedAt === "number"
  );
}

function loadTemplates() {
  if (typeof window === "undefined") return [] as SavedTemplate[];

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter(isSavedTemplate) : [];
  } catch {
    return [];
  }
}

function persistTemplates(templates: SavedTemplate[]) {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(templates));
}

function extractParameters(template: string) {
  const matches = template.match(/{{\s*([a-zA-Z0-9_]+)\s*}}/g) ?? [];
  const seen = new Set<string>();
  const parameters: string[] = [];

  matches.forEach((match) => {
    const cleaned = match.replace(/[{}]/g, "").trim();
    if (!seen.has(cleaned)) {
      seen.add(cleaned);
      parameters.push(cleaned);
    }
  });

  return parameters;
}

function renderTemplateSql(template: string, values: Record<string, string>) {
  return template.replace(/{{\s*([a-zA-Z0-9_]+)\s*}}/g, (_match, key: string) => {
    const value = values[key];
    return value?.trim() ? value : `{{${key}}}`;
  });
}

export default function QueryTemplateBuilder({
  tableName,
  columns,
}: QueryTemplateBuilderProps) {
  const [name, setName] = useState("Reusable query");
  const [template, setTemplate] = useState(
    `SELECT *\nFROM ${tableName || "{{table_name}}"}\nWHERE {{filter_clause}}\nLIMIT {{limit}};`,
  );
  const [values, setValues] = useState<Record<string, string>>({
    table_name: tableName,
    limit: "100",
  });
  const [savedTemplates, setSavedTemplates] = useState<SavedTemplate[]>(loadTemplates);
  const [notice, setNotice] = useState("");

  const parameters = useMemo(() => extractParameters(template), [template]);
  const previewSql = useMemo(() => renderTemplateSql(template, values), [template, values]);

  function updateValue(key: string, value: string) {
    setValues((current) => ({ ...current, [key]: value }));
  }

  function handleSave() {
    const nextTemplate: SavedTemplate = {
      id: createId(),
      name: name.trim() || "Reusable query",
      template,
      updatedAt: Date.now(),
    };
    const nextTemplates = [nextTemplate, ...savedTemplates].slice(0, 12);
    setSavedTemplates(nextTemplates);
    persistTemplates(nextTemplates);
    setNotice("Template saved to localStorage.");
  }

  async function handleCopy() {
    await navigator.clipboard.writeText(previewSql);
    setNotice("SQL copied to clipboard.");
  }

  function handleLoad(savedTemplate: SavedTemplate) {
    setName(savedTemplate.name);
    setTemplate(savedTemplate.template);
    setNotice(`Loaded ${savedTemplate.name}.`);
  }

  return (
    <motion.section
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.28, ease: ANALYTICS_EASE }}
      className={`${GLASS_PANEL_CLASS} p-6`}
    >
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.22em] text-cyan-700 dark:text-cyan-300">
            <Sparkles className="h-4 w-4" />
            Query Template Builder
          </div>
          <h2 className="mt-2 text-2xl font-semibold text-slate-950 dark:text-white">
            Build parameterized SQL snippets for reuse
          </h2>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={handleSave} className={BUTTON_CLASS}>
            <Save className="h-4 w-4" />
            Save template
          </button>
          <button type="button" onClick={() => void handleCopy()} className={BUTTON_CLASS}>
            <Copy className="h-4 w-4" />
            Copy SQL
          </button>
        </div>
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-[minmax(0,1.3fr)_minmax(0,0.9fr)]">
        <div className={`${GLASS_CARD_CLASS} p-4`}>
          <label className="block text-sm text-slate-600 dark:text-slate-300">
            <span className="mb-2 block">Template name</span>
            <input
              aria-label="Template name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              className={FIELD_CLASS}
            />
          </label>
          <label className="mt-4 block text-sm text-slate-600 dark:text-slate-300">
            <span className="mb-2 block">SQL template</span>
            <textarea
              aria-label="SQL template"
              value={template}
              onChange={(event) => setTemplate(event.target.value)}
              className={`${FIELD_CLASS} min-h-[260px] resize-y`}
            />
          </label>
        </div>

        <div className={`${GLASS_CARD_CLASS} p-4`}>
          <h3 className="text-sm font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
            Parameter values
          </h3>
          <div className="mt-4 space-y-3">
            {parameters.map((parameter) => (
              <label key={parameter} className="block text-sm text-slate-600 dark:text-slate-300">
                <span className="mb-2 block">{parameter}</span>
                <input
                  aria-label={parameter}
                  value={values[parameter] ?? (parameter === "table_name" ? tableName : "")}
                  onChange={(event) => updateValue(parameter, event.target.value)}
                  list={parameter.toLowerCase().includes("column") ? `${parameter}-columns` : undefined}
                  className={FIELD_CLASS}
                />
                {parameter.toLowerCase().includes("column") ? (
                  <datalist id={`${parameter}-columns`}>
                    {columns.map((column) => (
                      <option key={column.name} value={column.name} />
                    ))}
                  </datalist>
                ) : null}
              </label>
            ))}
            {!parameters.length ? (
              <div className="rounded-2xl border border-dashed border-white/25 px-4 py-6 text-sm text-slate-600 dark:text-slate-300">
                Add placeholders like {`{{limit}}`} or {`{{column_name}}`} to generate a parameter form.
              </div>
            ) : null}
          </div>
        </div>
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-[minmax(0,1.3fr)_minmax(0,0.9fr)]">
        <div className={`${GLASS_CARD_CLASS} p-4`}>
          <h3 className="text-sm font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
            Preview SQL
          </h3>
          <pre className="mt-4 overflow-x-auto rounded-3xl bg-slate-950 px-4 py-4 text-sm text-cyan-200">
            <code>{previewSql}</code>
          </pre>
          {notice ? (
            <div className="mt-4 rounded-2xl border border-emerald-500/20 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-700 dark:text-emerald-300">
              {notice}
            </div>
          ) : null}
        </div>

        <div className={`${GLASS_CARD_CLASS} p-4`}>
          <h3 className="text-sm font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
            Saved templates
          </h3>
          <div className="mt-4 space-y-3">
            {savedTemplates.map((savedTemplate) => (
              <button
                key={savedTemplate.id}
                type="button"
                onClick={() => handleLoad(savedTemplate)}
                className="flex w-full items-center justify-between rounded-2xl border border-white/15 px-4 py-3 text-left text-sm text-slate-700 transition hover:bg-white/10 dark:text-slate-200"
              >
                <span>{savedTemplate.name}</span>
                <span className="text-xs text-slate-500 dark:text-slate-400">
                  Load
                </span>
              </button>
            ))}
            {!savedTemplates.length ? (
              <div className="rounded-2xl border border-dashed border-white/25 px-4 py-6 text-sm text-slate-600 dark:text-slate-300">
                No templates saved yet.
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </motion.section>
  );
}
