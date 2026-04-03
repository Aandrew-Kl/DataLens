"use client";

import { startTransition, useMemo, useState } from "react";
import { motion } from "framer-motion";
import {
  Bot,
  Copy,
  Lightbulb,
  Loader2,
  Sparkles,
  TrendingUp,
} from "lucide-react";
import { runQuery } from "@/lib/duckdb/client";
import {
  ANALYTICS_EASE,
  BUTTON_CLASS,
  GLASS_CARD_CLASS,
  GLASS_PANEL_CLASS,
} from "@/lib/utils/advanced-analytics";
import { formatNumber, formatPercent } from "@/lib/utils/formatters";
import {
  generateOllamaText,
  loadOllamaSettings,
} from "@/lib/ai/ollama-settings";
import type { ColumnProfile } from "@/types/dataset";

interface AIInsightGeneratorProps {
  tableName: string;
  columns: ColumnProfile[];
}

type InsightCategory =
  | "trends"
  | "anomalies"
  | "correlations"
  | "recommendations";

interface InsightSection {
  category: InsightCategory;
  title: string;
  bullets: string[];
}

const CATEGORY_META: Record<
  InsightCategory,
  { title: string; accent: string; icon: typeof Sparkles }
> = {
  trends: {
    title: "Trends",
    accent: "text-cyan-700 dark:text-cyan-300",
    icon: TrendingUp,
  },
  anomalies: {
    title: "Anomalies",
    accent: "text-amber-700 dark:text-amber-300",
    icon: Lightbulb,
  },
  correlations: {
    title: "Correlations",
    accent: "text-violet-700 dark:text-violet-300",
    icon: Sparkles,
  },
  recommendations: {
    title: "Recommendations",
    accent: "text-emerald-700 dark:text-emerald-300",
    icon: Bot,
  },
};

function buildColumnSummary(columns: ColumnProfile[]) {
  return columns
    .slice(0, 12)
    .map((column) => {
      const stats: string[] = [
        `${column.name} (${column.type})`,
        `${column.nullCount} nulls`,
        `${column.uniqueCount} unique`,
      ];

      if (column.type === "number") {
        if (typeof column.mean === "number") {
          stats.push(`mean ${column.mean.toFixed(2)}`);
        }
        if (typeof column.min === "number" && typeof column.max === "number") {
          stats.push(`range ${column.min}..${column.max}`);
        }
      }

      if (column.sampleValues.length > 0) {
        stats.push(
          `samples ${column.sampleValues
            .slice(0, 3)
            .map((value) => String(value ?? "null"))
            .join(", ")}`,
        );
      }

      return `- ${stats.join(" | ")}`;
    })
    .join("\n");
}

function buildPrompt(
  tableName: string,
  columns: ColumnProfile[],
  rowCount: number,
) {
  const numericColumns = columns.filter((column) => column.type === "number").length;
  const dateColumns = columns.filter((column) => column.type === "date").length;
  const completeness =
    rowCount > 0
      ? 100 -
        (columns.reduce((sum, column) => sum + column.nullCount, 0) /
          (rowCount * Math.max(columns.length, 1))) *
          100
      : 100;

  return [
    "You are DataLens AI.",
    `Dataset: ${tableName}`,
    `Rows: ${rowCount}`,
    `Columns: ${columns.length}`,
    `Numeric columns: ${numericColumns}`,
    `Date columns: ${dateColumns}`,
    `Overall completeness: ${completeness.toFixed(1)}%`,
    "Column profile summary:",
    buildColumnSummary(columns),
    "",
    "Return exactly four markdown sections with these headings:",
    "Trends",
    "Anomalies",
    "Correlations",
    "Recommendations",
    "",
    "Under each heading, return 2-3 concise bullet points grounded in the provided stats.",
  ].join("\n");
}

function parseInsightSections(text: string): InsightSection[] {
  const baseSections: InsightSection[] = (
    Object.keys(CATEGORY_META) as InsightCategory[]
  ).map((category) => ({
    category,
    title: CATEGORY_META[category].title,
    bullets: [],
  }));

  const sectionMap = new Map(baseSections.map((section) => [section.category, section]));
  let currentCategory: InsightCategory | null = null;

  text.split(/\r?\n/).forEach((line) => {
    const trimmed = line.trim();
    const normalized = trimmed.toLowerCase().replace(/[:#]/g, "");

    const matchedCategory = (Object.keys(CATEGORY_META) as InsightCategory[]).find(
      (category) => normalized === category,
    );

    if (matchedCategory) {
      currentCategory = matchedCategory;
      return;
    }

    if (trimmed.startsWith("- ") && currentCategory) {
      sectionMap.get(currentCategory)?.bullets.push(trimmed.slice(2).trim());
    }
  });

  return baseSections.map((section) => ({
    ...section,
    bullets:
      section.bullets.length > 0
        ? section.bullets
        : ["No model output was returned for this category."],
  }));
}

function SectionCard({ section }: { section: InsightSection }) {
  const meta = CATEGORY_META[section.category];
  const Icon = meta.icon;

  return (
    <div className={`${GLASS_CARD_CLASS} p-4`}>
      <div className={`flex items-center gap-2 text-sm font-semibold ${meta.accent}`}>
        <Icon className="h-4 w-4" />
        {section.title}
      </div>
      <ul className="mt-3 space-y-2 text-sm leading-6 text-slate-600 dark:text-slate-300">
        {section.bullets.map((bullet) => (
          <li key={`${section.category}-${bullet}`}>- {bullet}</li>
        ))}
      </ul>
    </div>
  );
}

export default function AIInsightGenerator({
  tableName,
  columns,
}: AIInsightGeneratorProps) {
  const [sections, setSections] = useState<InsightSection[]>([]);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  const overallCompleteness = useMemo(() => {
    const syntheticRowCount = Math.max(
      1,
      columns.reduce((max, column) => Math.max(max, column.uniqueCount), 1),
    );
    return (
      100 -
      (columns.reduce((sum, column) => sum + column.nullCount, 0) /
        (syntheticRowCount * Math.max(columns.length, 1))) *
        100
    );
  }, [columns]);

  async function handleGenerateInsights() {
    setLoading(true);
    setStatus(null);

    try {
      const rowCountRows = await runQuery(
        `SELECT COUNT(*) AS row_count FROM ${JSON.stringify(tableName).replace(/^"|"$/g, "")}`,
      );
      const rowCount =
        typeof rowCountRows[0]?.row_count === "number"
          ? rowCountRows[0].row_count
          : Number(rowCountRows[0]?.row_count ?? 0);
      const settings = loadOllamaSettings();
      const response = await generateOllamaText({
        baseUrl: settings.url,
        model: settings.model,
        prompt: buildPrompt(tableName, columns, Number.isFinite(rowCount) ? rowCount : 0),
        systemPrompt: settings.systemPrompt,
        temperature: settings.temperature,
        maxTokens: settings.maxTokens,
      });

      startTransition(() => {
        setSections(parseInsightSections(response));
      });
      setStatus("Generated insight categories with Ollama.");
    } catch (error) {
      setSections([]);
      setStatus(
        error instanceof Error ? error.message : "Insight generation failed.",
      );
    } finally {
      setLoading(false);
    }
  }

  async function handleCopyAll() {
    if (sections.length === 0) return;

    const content = sections
      .map((section) => [section.title, ...section.bullets.map((bullet) => `- ${bullet}`)].join("\n"))
      .join("\n\n");

    await navigator.clipboard.writeText(content);
    setStatus("Copied all insights to the clipboard.");
  }

  return (
    <section className={`${GLASS_PANEL_CLASS} p-6`}>
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <div className="inline-flex items-center gap-2 rounded-full bg-cyan-500/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-cyan-700 dark:text-cyan-300">
            <Sparkles className="h-3.5 w-3.5" />
            AI insight generator
          </div>
          <h2 className="mt-3 text-2xl font-semibold text-slate-950 dark:text-white">
            Turn profiled dataset stats into analyst-ready bullet points
          </h2>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600 dark:text-slate-300">
            DataLens sends summarized schema and completeness signals to Ollama,
            then groups the response into trends, anomalies, correlations, and
            recommendations.
          </p>
        </div>

        <div className="flex flex-wrap gap-3">
          <button
            type="button"
            onClick={() => void handleGenerateInsights()}
            disabled={loading}
            className={BUTTON_CLASS}
          >
            {loading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Sparkles className="h-4 w-4" />
            )}
            Generate insights
          </button>
          <button
            type="button"
            onClick={() => void handleCopyAll()}
            disabled={sections.length === 0}
            className={BUTTON_CLASS}
          >
            <Copy className="h-4 w-4" />
            Copy all insights
          </button>
        </div>
      </div>

      <div className="mt-6 grid gap-4 xl:grid-cols-3">
        <div className={`${GLASS_CARD_CLASS} p-4`}>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
            Table
          </p>
          <p className="mt-3 text-xl font-semibold text-slate-950 dark:text-white">
            {tableName}
          </p>
        </div>
        <div className={`${GLASS_CARD_CLASS} p-4`}>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
            Profiled columns
          </p>
          <p className="mt-3 text-xl font-semibold text-slate-950 dark:text-white">
            {formatNumber(columns.length)}
          </p>
        </div>
        <div className={`${GLASS_CARD_CLASS} p-4`}>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
            Estimated completeness
          </p>
          <p className="mt-3 text-xl font-semibold text-slate-950 dark:text-white">
            {formatPercent(overallCompleteness, 1)}
          </p>
        </div>
      </div>

      {status ? (
        <p className="mt-4 rounded-2xl border border-cyan-400/20 bg-cyan-500/10 px-4 py-3 text-sm text-cyan-700 dark:text-cyan-300">
          {status}
        </p>
      ) : null}

      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.24, ease: ANALYTICS_EASE }}
        className="mt-6 grid gap-4 md:grid-cols-2"
      >
        {sections.length === 0 ? (
          <div className={`${GLASS_CARD_CLASS} md:col-span-2 p-6 text-sm text-slate-600 dark:text-slate-300`}>
            Generate insights to populate the four AI analysis categories.
          </div>
        ) : (
          sections.map((section) => <SectionCard key={section.category} section={section} />)
        )}
      </motion.div>
    </section>
  );
}
