"use client";

import { useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  CheckCircle2,
  ClipboardList,
  FileBarChart,
  FileSpreadsheet,
  Layers3,
  Sparkles,
  TrendingUp,
} from "lucide-react";
import {
  ANALYTICS_EASE,
  BUTTON_CLASS,
  GLASS_CARD_CLASS,
  GLASS_PANEL_CLASS,
} from "@/lib/utils/advanced-analytics";

export type ReportTemplateId =
  | "executive-summary"
  | "data-quality-report"
  | "trend-analysis"
  | "distribution-overview"
  | "correlation-report";

interface TemplatePreviewBar {
  label: string;
  value: number;
}

interface ReportTemplateDefinition {
  id: ReportTemplateId;
  name: string;
  description: string;
  detail: string;
  accentClassName: string;
  preview: readonly TemplatePreviewBar[];
  tags: readonly string[];
}

const STORAGE_KEY = "datalens-report-template-selection";

export const REPORT_TEMPLATES = [
  {
    id: "executive-summary",
    name: "Executive Summary",
    description:
      "High-level report with KPI callouts, directional notes, and the top dataset takeaways.",
    detail:
      "Best for leadership updates, monthly reviews, and concise stakeholder snapshots.",
    accentClassName:
      "from-cyan-500/25 via-sky-400/10 to-transparent text-cyan-700 dark:text-cyan-300",
    preview: [
      { label: "KPIs", value: 92 },
      { label: "Narrative", value: 74 },
      { label: "Recommendations", value: 64 },
    ],
    tags: ["KPI-heavy", "Narrative", "Leadership"],
  },
  {
    id: "data-quality-report",
    name: "Data Quality Report",
    description:
      "Audits completeness, uniqueness, schema consistency, and validation risks in one layout.",
    detail:
      "Use when datasets need operational sign-off before downstream dashboards or ML work.",
    accentClassName:
      "from-emerald-500/25 via-lime-400/10 to-transparent text-emerald-700 dark:text-emerald-300",
    preview: [
      { label: "Completeness", value: 88 },
      { label: "Integrity", value: 81 },
      { label: "Warnings", value: 46 },
    ],
    tags: ["Validation", "Audit", "Operations"],
  },
  {
    id: "trend-analysis",
    name: "Trend Analysis",
    description:
      "Focuses on momentum, growth rate, moving averages, and change points across time.",
    detail:
      "A good fit for recency checks, performance pacing, and ongoing trend monitoring.",
    accentClassName:
      "from-violet-500/25 via-fuchsia-400/10 to-transparent text-violet-700 dark:text-violet-300",
    preview: [
      { label: "Momentum", value: 78 },
      { label: "Seasonality", value: 65 },
      { label: "Change points", value: 52 },
    ],
    tags: ["Time series", "Momentum", "Forecast prep"],
  },
  {
    id: "distribution-overview",
    name: "Distribution Overview",
    description:
      "Maps spread, skew, outliers, and bucket concentration across key numeric fields.",
    detail:
      "Useful for profiling variable shape before segmentation, testing, or model training.",
    accentClassName:
      "from-amber-500/25 via-orange-400/10 to-transparent text-amber-700 dark:text-amber-300",
    preview: [
      { label: "Spread", value: 83 },
      { label: "Skew", value: 59 },
      { label: "Outliers", value: 44 },
    ],
    tags: ["Profiling", "Shape", "Outliers"],
  },
  {
    id: "correlation-report",
    name: "Correlation Report",
    description:
      "Pairs ranked relationships with analyst notes on signal strength and interpretability.",
    detail:
      "Built for feature review, dependency spotting, and metric interaction analysis.",
    accentClassName:
      "from-rose-500/25 via-pink-400/10 to-transparent text-rose-700 dark:text-rose-300",
    preview: [
      { label: "Strong pairs", value: 69 },
      { label: "Weak pairs", value: 34 },
      { label: "Coverage", value: 91 },
    ],
    tags: ["Relationships", "ML prep", "Signals"],
  },
] as const satisfies readonly ReportTemplateDefinition[];

function isTemplateId(value: string | null): value is ReportTemplateId {
  return REPORT_TEMPLATES.some((template) => template.id === value);
}

function createId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }

  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function readSelectedTemplate() {
  if (typeof window === "undefined") return REPORT_TEMPLATES[0].id;
  const stored = window.localStorage.getItem(STORAGE_KEY);
  return isTemplateId(stored) ? stored : REPORT_TEMPLATES[0].id;
}

function TemplatePreview({
  accentClassName,
  preview,
}: {
  accentClassName: string;
  preview: readonly TemplatePreviewBar[];
}) {
  return (
    <div
      className={`relative overflow-hidden rounded-[1.35rem] border border-white/20 bg-gradient-to-br ${accentClassName}`}
    >
      <div className="absolute inset-0 bg-white/55 dark:bg-slate-950/35" />
      <div className="relative space-y-3 px-4 py-4">
        {preview.map((item) => (
          <div key={item.label}>
            <div className="mb-1 flex items-center justify-between text-[11px] font-semibold uppercase tracking-[0.18em]">
              <span>{item.label}</span>
              <span>{item.value}%</span>
            </div>
            <div className="h-2.5 overflow-hidden rounded-full bg-white/55 dark:bg-slate-950/45">
              <div
                className="h-full rounded-full bg-slate-950/75 dark:bg-white/85"
                style={{ width: `${item.value}%` }}
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function TemplateBadge({
  selected,
}: {
  selected: boolean;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] ${
        selected
          ? "bg-cyan-500/15 text-cyan-700 dark:text-cyan-300"
          : "bg-slate-200/70 text-slate-600 dark:bg-slate-800/70 dark:text-slate-300"
      }`}
    >
      <CheckCircle2 className="h-3.5 w-3.5" />
      {selected ? "Active" : "Ready"}
    </span>
  );
}

export default function ReportTemplates() {
  const [selectedTemplateId, setSelectedTemplateId] = useState<ReportTemplateId>(
    () => readSelectedTemplate(),
  );
  const [notice, setNotice] = useState<string | null>(null);
  const [noticeId, setNoticeId] = useState(() => createId());

  const selectedTemplate = useMemo(
    () =>
      REPORT_TEMPLATES.find((template) => template.id === selectedTemplateId) ??
      REPORT_TEMPLATES[0],
    [selectedTemplateId],
  );

  function applyTemplate(templateId: ReportTemplateId) {
    setSelectedTemplateId(templateId);
    if (typeof window !== "undefined") {
      window.localStorage.setItem(STORAGE_KEY, templateId);
    }
    setNoticeId(createId());
    setNotice(
      `${REPORT_TEMPLATES.find((template) => template.id === templateId)?.name ?? "Template"} is now the active report template.`,
    );
  }

  return (
    <section className={`${GLASS_PANEL_CLASS} overflow-hidden p-6`}>
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <div className="inline-flex items-center gap-2 rounded-full bg-cyan-500/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-cyan-700 dark:text-cyan-300">
            <Sparkles className="h-3.5 w-3.5" />
            Report templates
          </div>
          <h2 className="mt-3 text-2xl font-semibold text-slate-950 dark:text-white">
            Start from a structure that matches the story you need to tell
          </h2>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600 dark:text-slate-300">
            Pick a template to anchor report layout, emphasis, and default narrative flow.
            The selected template is persisted locally for the next report build.
          </p>
        </div>

        <div className={`${GLASS_CARD_CLASS} max-w-sm p-4`}>
          <div className="flex items-start gap-3">
            <div className="rounded-2xl bg-cyan-500/10 p-3 text-cyan-700 dark:text-cyan-300">
              <FileBarChart className="h-5 w-5" />
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
                Active template
              </p>
              <p className="mt-2 text-lg font-semibold text-slate-950 dark:text-white">
                {selectedTemplate.name}
              </p>
              <p className="mt-1 text-sm leading-6 text-slate-600 dark:text-slate-300">
                {selectedTemplate.detail}
              </p>
            </div>
          </div>
        </div>
      </div>

      <AnimatePresence mode="wait">
        {notice ? (
          <motion.div
            key={noticeId}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.22, ease: ANALYTICS_EASE }}
            className="mt-5 rounded-2xl border border-emerald-500/20 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-700 dark:text-emerald-300"
          >
            {notice}
          </motion.div>
        ) : null}
      </AnimatePresence>

      <div className="mt-6 grid gap-5 xl:grid-cols-5">
        {REPORT_TEMPLATES.map((template) => {
          const selected = template.id === selectedTemplateId;

          return (
            <motion.article
              key={template.id}
              initial={{ opacity: 0, y: 18 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.28, ease: ANALYTICS_EASE }}
              className={`${GLASS_CARD_CLASS} flex h-full flex-col p-4`}
            >
              <div className="mb-4 flex items-center justify-between gap-3">
                <div className="rounded-2xl bg-white/65 p-3 text-slate-700 dark:bg-slate-900/60 dark:text-slate-200">
                  {template.id === "executive-summary" ? (
                    <ClipboardList className="h-5 w-5" />
                  ) : template.id === "data-quality-report" ? (
                    <FileSpreadsheet className="h-5 w-5" />
                  ) : template.id === "trend-analysis" ? (
                    <TrendingUp className="h-5 w-5" />
                  ) : template.id === "distribution-overview" ? (
                    <Layers3 className="h-5 w-5" />
                  ) : (
                    <Sparkles className="h-5 w-5" />
                  )}
                </div>
                <TemplateBadge selected={selected} />
              </div>

              <TemplatePreview
                accentClassName={template.accentClassName}
                preview={template.preview}
              />

              <div className="mt-4">
                <h3 className="text-lg font-semibold text-slate-950 dark:text-white">
                  {template.name}
                </h3>
                <p className="mt-2 text-sm leading-6 text-slate-600 dark:text-slate-300">
                  {template.description}
                </p>
              </div>

              <div className="mt-4 flex flex-wrap gap-2">
                {template.tags.map((tag) => (
                  <span
                    key={tag}
                    className="rounded-full bg-white/70 px-2.5 py-1 text-[11px] font-medium text-slate-600 dark:bg-slate-900/60 dark:text-slate-300"
                  >
                    {tag}
                  </span>
                ))}
              </div>

              <button
                type="button"
                onClick={() => applyTemplate(template.id)}
                className={`${BUTTON_CLASS} mt-5 w-full justify-center ${
                  selected ? "border-cyan-500/30 bg-cyan-500/10 text-cyan-700 dark:text-cyan-300" : ""
                }`}
              >
                <CheckCircle2 className="h-4 w-4" />
                {selected ? "Selected" : "Apply template"}
              </button>
            </motion.article>
          );
        })}
      </div>
    </section>
  );
}
