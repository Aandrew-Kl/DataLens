"use client";

import { useCallback, useRef } from "react";
import dynamic from "next/dynamic";

import type { ColumnProfile, DatasetMeta } from "@/types/dataset";
import type { NotificationInput } from "@/components/ui/notification-center";
import AiPlayground from "@/components/ai/ai-playground";
import AiSchemaAnalyzer from "@/components/ai/ai-schema-analyzer";
import ChatInterface from "@/components/query/chat-interface";
import NaturalLanguageBar from "@/components/query/natural-language-bar";
import { ErrorBoundary } from "@/components/ui/error-boundary";

import { AnimatedWorkspaceSection } from "@/components/home/workspace-shared";

const AIAnomalyExplainer = dynamic(
  () => import("@/components/ai/ai-anomaly-explainer"),
  { ssr: false },
);
const AIChartRecommender = dynamic(
  () => import("@/components/ai/ai-chart-recommender"),
  { ssr: false },
);
const AIDataCleaner = dynamic(
  () => import("@/components/ai/ai-data-cleaner"),
  { ssr: false },
);
const AIDataNarrator = dynamic(
  () => import("@/components/ai/ai-data-narrator"),
  { ssr: false },
);
const AIInsightGenerator = dynamic(
  () => import("@/components/ai/ai-insight-generator"),
  { ssr: false },
);
const AIPromptLibrary = dynamic(
  () => import("@/components/ai/ai-prompt-library"),
  { ssr: false },
);
const AIQueryGenerator = dynamic(
  () => import("@/components/ai/ai-query-generator"),
  { ssr: false },
);

interface QuerySectionProps {
  activeDataset: DatasetMeta;
  tableName: string;
  columns: ColumnProfile[];
  onAddNotification: (input: NotificationInput) => string;
}

export default function QuerySection({
  activeDataset,
  tableName,
  columns,
  onAddNotification,
}: QuerySectionProps) {
  const queryTabRef = useRef<HTMLDivElement>(null);

  const submitNaturalLanguageQuestion = useCallback(
    (question: string) => {
      const container = queryTabRef.current;
      const input = container?.querySelector<HTMLInputElement>(
        'input[placeholder="Ask anything about your data..."]',
      );
      const form = input?.closest("form");

      if (!input || !(form instanceof HTMLFormElement)) {
        onAddNotification({
          type: "warning",
          title: "Query input unavailable",
          message: "The chat input is not mounted yet.",
        });
        return;
      }

      const setter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )?.set;

      setter?.call(input, question);
      input.dispatchEvent(new Event("input", { bubbles: true }));

      if (typeof form.requestSubmit === "function") {
        form.requestSubmit();
      } else {
        form.dispatchEvent(
          new Event("submit", { bubbles: true, cancelable: true }),
        );
      }
    },
    [onAddNotification],
  );

  return (
    <AnimatedWorkspaceSection className="max-w-4xl mx-auto">
      <div ref={queryTabRef} className="space-y-4">
        <h2 className="text-lg font-semibold text-slate-900 dark:text-white mb-1">
          Ask Your Data
        </h2>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Ask questions in plain English — AI generates SQL and shows results
          instantly
        </p>
        <ErrorBoundary>
          <NaturalLanguageBar
            tableName={tableName}
            columns={columns}
            onSubmit={submitNaturalLanguageQuestion}
          />
        </ErrorBoundary>
        <ErrorBoundary>
          <ChatInterface
            datasetId={activeDataset.id}
            tableName={tableName}
            columns={columns}
          />
        </ErrorBoundary>
        <ErrorBoundary>
          <AiSchemaAnalyzer tableName={tableName} columns={columns} />
        </ErrorBoundary>
        <ErrorBoundary>
          <AiPlayground />
        </ErrorBoundary>
        <details className="group mt-2 rounded-2xl border border-slate-200/70 bg-white/80 p-4 shadow-sm dark:border-slate-700/60 dark:bg-slate-900/60">
          <summary className="cursor-pointer list-none">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h3 className="text-sm font-semibold text-slate-900 dark:text-white">
                  AI Assistant
                </h3>
                <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                  Anomaly explanations, chart recommendations, data cleaning,
                  narration, insights, prompt library, and query generation.
                </p>
              </div>
              <span className="text-xs font-medium text-slate-400 dark:text-slate-500">
                Expand
              </span>
            </div>
          </summary>
          <div className="mt-4 space-y-6">
            <ErrorBoundary>
              <AIAnomalyExplainer tableName={tableName} columns={columns} />
            </ErrorBoundary>
            <ErrorBoundary>
              <AIChartRecommender tableName={tableName} columns={columns} />
            </ErrorBoundary>
            <ErrorBoundary>
              <AIDataCleaner tableName={tableName} columns={columns} />
            </ErrorBoundary>
            <ErrorBoundary>
              <AIDataNarrator tableName={tableName} columns={columns} />
            </ErrorBoundary>
            <ErrorBoundary>
              <AIInsightGenerator tableName={tableName} columns={columns} />
            </ErrorBoundary>
            <ErrorBoundary>
              <AIPromptLibrary tableName={tableName} columns={columns} />
            </ErrorBoundary>
            <ErrorBoundary>
              <AIQueryGenerator tableName={tableName} columns={columns} />
            </ErrorBoundary>
          </div>
        </details>
      </div>
    </AnimatedWorkspaceSection>
  );
}
