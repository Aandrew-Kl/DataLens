"use client";

import { useMemo, useState } from "react";
import { motion } from "framer-motion";
import { AlertTriangle, Bot, Download, GitBranch, Loader2, Table2 } from "lucide-react";
import { runQuery } from "@/lib/duckdb/client";
import {
  ANALYTICS_EASE,
  BUTTON_CLASS,
  GLASS_CARD_CLASS,
  GLASS_PANEL_CLASS,
} from "@/lib/utils/advanced-analytics";
import { downloadFile } from "@/lib/utils/export";
import { formatNumber } from "@/lib/utils/formatters";
import {
  checkOllamaConnection,
  generateOllamaText,
  loadOllamaSettings,
  type OllamaConnectionState,
} from "@/lib/ai/ollama-settings";
import type { ColumnProfile } from "@/types/dataset";

interface AiSchemaAnalyzerProps {
  tableName: string;
  columns: ColumnProfile[];
}

interface SchemaColumn {
  name: string;
  type: string;
}

interface SchemaAnalysisResult {
  schema: SchemaColumn[];
  summary: string;
  relationships: string[];
  issues: string[];
  markdown: string;
}

function inferSchemaType(column: ColumnProfile) {
  if (column.type === "number") return "DOUBLE";
  if (column.type === "boolean") return "BOOLEAN";
  if (column.type === "date") return "TIMESTAMP";
  if (column.type === "string") return "VARCHAR";
  return "UNKNOWN";
}

function buildLocalRelationships(columns: ColumnProfile[]) {
  const relationships: string[] = [];
  const numericColumns = columns.filter((column) => column.type === "number");
  const dateColumns = columns.filter((column) => column.type === "date");
  const idColumns = columns.filter((column) => /(^id$|_id$)/i.test(column.name));
  const categoricalColumns = columns.filter(
    (column) => column.type === "string" || column.type === "boolean",
  );

  if (dateColumns.length > 0 && numericColumns.length > 0) {
    relationships.push(
      `${dateColumns[0].name} can anchor time-series analysis for ${numericColumns
        .slice(0, 2)
        .map((column) => column.name)
        .join(" and ")}.`,
    );
  }

  if (categoricalColumns.length > 0 && numericColumns.length > 0) {
    relationships.push(
      `${categoricalColumns[0].name} is a likely segmentation key for ${numericColumns[0].name}.`,
    );
  }

  if (idColumns.length >= 2) {
    relationships.push(
      `${idColumns.map((column) => column.name).join(", ")} look like join-friendly identifiers or foreign-key candidates.`,
    );
  }

  if (relationships.length === 0) {
    relationships.push(
      "No obvious relationship pattern stands out yet; check business semantics or query-level joins next.",
    );
  }

  return relationships;
}

function buildPotentialIssues(columns: ColumnProfile[]) {
  const issues: string[] = [];
  const lowerCaseNames = new Set<string>();

  for (const column of columns) {
    const normalized = column.name.toLowerCase();
    if (lowerCaseNames.has(normalized)) {
      issues.push(`Column name collision detected around ${column.name}.`);
    } else {
      lowerCaseNames.add(normalized);
    }

    if (/\s/.test(column.name)) {
      issues.push(`${column.name} contains spaces, which can complicate SQL ergonomics.`);
    }

    if (column.type === "unknown") {
      issues.push(`${column.name} is still typed as unknown and may need schema cleanup.`);
    }
  }

  if (issues.length === 0) {
    issues.push("No immediate naming or typing issues were detected from the current schema profile.");
  }

  return issues;
}

function buildFallbackSummary(tableName: string, columns: ColumnProfile[]) {
  const numericCount = columns.filter((column) => column.type === "number").length;
  const dateCount = columns.filter((column) => column.type === "date").length;
  const categoricalCount = columns.length - numericCount - dateCount;

  return [
    `${tableName} contains ${formatNumber(columns.length)} columns.`,
    `${formatNumber(numericCount)} numeric, ${formatNumber(categoricalCount)} categorical, and ${formatNumber(dateCount)} temporal fields were detected.`,
    dateCount > 0 && numericCount > 0
      ? "The schema is compatible with time-series analysis."
      : "The schema looks more tabular than temporal.",
  ].join(" ");
}

async function loadSchema(tableName: string, columns: ColumnProfile[]) {
  const rows = await runQuery(`DESCRIBE ${`"${tableName.replaceAll('"', '""')}"`}`);
  const schema = rows.flatMap<SchemaColumn>((row) => {
    const name =
      typeof row.column_name === "string" && row.column_name.trim().length > 0
        ? row.column_name
        : null;
    const type =
      typeof row.column_type === "string" && row.column_type.trim().length > 0
        ? row.column_type
        : null;

    if (!name || !type) return [];
    return [{ name, type }];
  });

  if (schema.length > 0) {
    return schema;
  }

  return columns.map((column) => ({
    name: column.name,
    type: inferSchemaType(column),
  }));
}

export default function AiSchemaAnalyzer({
  tableName,
  columns,
}: AiSchemaAnalyzerProps) {
  const settings = useMemo(() => loadOllamaSettings(), []);
  const [result, setResult] = useState<SchemaAnalysisResult | null>(null);
  const [status, setStatus] = useState<OllamaConnectionState>({
    kind: "idle",
    message: "Ready to inspect the schema.",
  });
  const [loading, setLoading] = useState(false);

  async function handleAnalyze() {
    setLoading(true);
    setStatus({
      kind: "checking",
      message: "Loading schema and checking the Ollama endpoint…",
    });

    try {
      const schema = await loadSchema(tableName, columns);
      const relationships = buildLocalRelationships(columns);
      const issues = buildPotentialIssues(columns);
      const fallbackSummary = buildFallbackSummary(tableName, columns);
      const connection = await checkOllamaConnection(settings.url);

      let summary = fallbackSummary;
      if (connection.kind === "connected") {
        const schemaPrompt = [
          `Summarize the following database table schema in 3-4 concise sentences.`,
          `Table name: ${tableName}`,
          `Columns:`,
          ...schema.map((column) => `- ${column.name}: ${column.type}`),
          `Likely relationships:`,
          ...relationships.map((line) => `- ${line}`),
          `Potential issues:`,
          ...issues.map((line) => `- ${line}`),
        ].join("\n");

        summary = await generateOllamaText({
          baseUrl: settings.url,
          model: settings.model,
          prompt: schemaPrompt,
          systemPrompt: settings.systemPrompt,
          temperature: settings.temperature,
          maxTokens: settings.maxTokens,
        });

        setStatus({
          kind: "connected",
          message: connection.message,
        });
      } else {
        setStatus({
          kind: connection.kind,
          message: `${connection.message} Using a local fallback summary instead.`,
        });
      }

      const markdown = [
        `# Schema analysis for ${tableName}`,
        "",
        "## Summary",
        summary,
        "",
        "## Table structure",
        ...schema.map((column) => `- ${column.name}: ${column.type}`),
        "",
        "## Suggested relationships",
        ...relationships.map((line) => `- ${line}`),
        "",
        "## Potential issues",
        ...issues.map((line) => `- ${line}`),
      ].join("\n");

      setResult({
        schema,
        summary,
        relationships,
        issues,
        markdown,
      });
    } catch (analysisError) {
      setStatus({
        kind: "error",
        message:
          analysisError instanceof Error
            ? analysisError.message
            : "Schema analysis failed.",
      });
    } finally {
      setLoading(false);
    }
  }

  function handleExport() {
    if (!result) return;
    downloadFile(
      result.markdown,
      `${tableName}-schema-analysis.md`,
      "text/markdown;charset=utf-8;",
    );
  }

  return (
    <section className={`${GLASS_PANEL_CLASS} overflow-hidden p-6`}>
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <div className="inline-flex items-center gap-2 rounded-full bg-cyan-500/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-cyan-700 dark:text-cyan-300">
            <Bot className="h-3.5 w-3.5" />
            AI schema analyzer
          </div>
          <h2 className="mt-3 text-2xl font-semibold text-slate-950 dark:text-white">
            Explain the table structure, relationship hints, and schema risks
          </h2>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600 dark:text-slate-300">
            The analyzer reads the DuckDB schema, derives structural heuristics, and uses Ollama
            when available to generate a natural-language summary.
          </p>
        </div>

        <div className={`${GLASS_CARD_CLASS} max-w-md p-4`}>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
            Ollama status
          </p>
          <p className="mt-2 text-sm leading-6 text-slate-600 dark:text-slate-300">
            {status.message}
          </p>
        </div>
      </div>

      <div className="mt-6 flex flex-wrap gap-3">
        <button type="button" onClick={handleAnalyze} disabled={loading} className={BUTTON_CLASS}>
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Table2 className="h-4 w-4" />}
          Analyze schema
        </button>
        <button type="button" onClick={handleExport} disabled={!result} className={BUTTON_CLASS}>
          <Download className="h-4 w-4" />
          Export markdown
        </button>
      </div>

      <div className="mt-6 grid gap-5 xl:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)]">
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.24, ease: ANALYTICS_EASE }}
          className={`${GLASS_CARD_CLASS} p-5`}
        >
          <div className="mb-4 flex items-center gap-2 text-sm font-semibold text-slate-900 dark:text-white">
            <Bot className="h-4 w-4 text-cyan-500" />
            Natural-language summary
          </div>
          <div className="whitespace-pre-wrap text-sm leading-7 text-slate-700 dark:text-slate-200">
            {result?.summary ?? "Run the analyzer to generate an AI-backed schema summary."}
          </div>
        </motion.div>

        <div className="grid gap-5">
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.24, ease: ANALYTICS_EASE }}
            className={`${GLASS_CARD_CLASS} p-5`}
          >
            <div className="mb-4 flex items-center gap-2 text-sm font-semibold text-slate-900 dark:text-white">
              <GitBranch className="h-4 w-4 text-cyan-500" />
              Suggested relationships
            </div>
            <ul className="space-y-3 text-sm leading-6 text-slate-700 dark:text-slate-200">
              {(result?.relationships ?? ["No relationship suggestions yet."]).map((item) => (
                <li key={item} className="rounded-[1.1rem] border border-white/15 bg-white/55 px-4 py-3 dark:bg-slate-950/35">
                  {item}
                </li>
              ))}
            </ul>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.24, ease: ANALYTICS_EASE }}
            className={`${GLASS_CARD_CLASS} p-5`}
          >
            <div className="mb-4 flex items-center gap-2 text-sm font-semibold text-slate-900 dark:text-white">
              <AlertTriangle className="h-4 w-4 text-amber-500" />
              Potential issues
            </div>
            <ul className="space-y-3 text-sm leading-6 text-slate-700 dark:text-slate-200">
              {(result?.issues ?? ["No issue scan has been run yet."]).map((item) => (
                <li key={item} className="rounded-[1.1rem] border border-white/15 bg-white/55 px-4 py-3 dark:bg-slate-950/35">
                  {item}
                </li>
              ))}
            </ul>
          </motion.div>
        </div>
      </div>
    </section>
  );
}
