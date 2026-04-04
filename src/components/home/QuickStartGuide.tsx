"use client";

import { ErrorBoundary } from "@/components/ui/error-boundary";
import SampleDatasets from "@/components/data/sample-datasets";
import type { HomeFeatureBadge } from "./types";

interface QuickStartGuideProps {
  features: HomeFeatureBadge[];
  onSampleLoad: (fileName: string, csvContent: string) => void;
}

export default function QuickStartGuide({
  features,
  onSampleLoad,
}: QuickStartGuideProps) {
  return (
    <>
      <div className="pt-2">
        <p className="text-xs text-slate-400 dark:text-slate-500 mb-3">
          Or try a sample dataset:
        </p>
        <ErrorBoundary>
          <SampleDatasets onLoad={onSampleLoad} />
        </ErrorBoundary>
      </div>

      <div className="flex flex-wrap items-center justify-center gap-3 pt-4">
        {features.map((feature) => (
          <div
            key={feature.label}
            className="flex items-center gap-2 rounded-full border border-slate-200 dark:border-slate-700 bg-white/50 dark:bg-slate-800/50 px-4 py-2 text-xs font-medium text-slate-600 dark:text-slate-400 backdrop-blur-sm"
          >
            <feature.icon className="h-3.5 w-3.5" />
            {feature.label}
          </div>
        ))}
      </div>
    </>
  );
}
