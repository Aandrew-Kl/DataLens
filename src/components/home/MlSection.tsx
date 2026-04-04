"use client";

import { useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import dynamic from "next/dynamic";

import type { ColumnProfile } from "@/types/dataset";
import ClassificationView from "@/components/ml/classification-view";
import ClusteringView from "@/components/ml/clustering-view";
import FeatureImportance from "@/components/ml/feature-importance";
import RegressionView from "@/components/ml/regression-view";
import { ErrorBoundary } from "@/components/ui/error-boundary";

import {
  AnimatedWorkspaceSection,
  ToolSection,
} from "@/components/home/workspace-shared";

const MLAnomalyDetector = dynamic(
  () => import("@/components/ml/anomaly-detector"),
  { ssr: false },
);
const AssociationRules = dynamic(
  () => import("@/components/ml/association-rules"),
  { ssr: false },
);
const DecisionTreeView = dynamic(
  () => import("@/components/ml/decision-tree-view"),
  { ssr: false },
);
const FeatureEngineering = dynamic(
  () => import("@/components/ml/feature-engineering"),
  { ssr: false },
);
const KnnView = dynamic(() => import("@/components/ml/knn-view"), {
  ssr: false,
});
const LogisticRegressionView = dynamic(
  () => import("@/components/ml/logistic-regression-view"),
  { ssr: false },
);
const ModelComparison = dynamic(
  () => import("@/components/ml/model-comparison"),
  { ssr: false },
);
const ModelTrainingLog = dynamic(
  () => import("@/components/ml/model-training-log"),
  { ssr: false },
);
const NaiveBayesView = dynamic(
  () => import("@/components/ml/naive-bayes-view"),
  { ssr: false },
);
const PcaView = dynamic(() => import("@/components/ml/pca-view"), {
  ssr: false,
});
const SurvivalAnalysis = dynamic(
  () => import("@/components/ml/survival-analysis"),
  { ssr: false },
);
const TimeSeriesClassifier = dynamic(
  () => import("@/components/ml/time-series-classifier"),
  { ssr: false },
);

interface MlSectionProps {
  tableName: string;
  columns: ColumnProfile[];
  rowCount: number;
}

export default function MlSection({
  tableName,
  columns,
}: MlSectionProps) {
  const [showAdvancedMl, setShowAdvancedMl] = useState(false);

  return (
    <AnimatedWorkspaceSection>
      <div>
        <h2 className="text-lg font-semibold text-slate-900 dark:text-white mb-1">
          Machine Learning
        </h2>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Explore unsupervised clustering and regression workflows directly
          against the active dataset.
        </p>
      </div>

      <ToolSection
        title="Clustering"
        description="Group similar records into data-driven segments and inspect cluster size, centroids, and variance."
      >
        <ErrorBoundary>
          <ClusteringView tableName={tableName} columns={columns} />
        </ErrorBoundary>
      </ToolSection>

      <ToolSection
        title="Regression"
        description="Fit regression models, inspect fitted curves, and review residual behavior from the same workspace."
      >
        <ErrorBoundary>
          <RegressionView tableName={tableName} columns={columns} />
        </ErrorBoundary>
      </ToolSection>

      <ToolSection
        title="Classification"
        description="Train a KNN classifier against categorical targets and review confusion, precision, and recall for the active dataset."
      >
        <ErrorBoundary>
          <ClassificationView tableName={tableName} columns={columns} />
        </ErrorBoundary>
      </ToolSection>

      <ToolSection
        title="Feature Importance"
        description="Rank numeric predictors with a permutation-style importance pass to see which features matter most before deeper modeling."
      >
        <ErrorBoundary>
          <FeatureImportance tableName={tableName} columns={columns} />
        </ErrorBoundary>
      </ToolSection>

      <div className="overflow-hidden rounded-2xl border border-slate-200/70 dark:border-slate-800/80">
        <button
          type="button"
          onClick={() => setShowAdvancedMl((current) => !current)}
          className="flex w-full items-center justify-between gap-2 bg-slate-50/80 px-4 py-3 text-left transition-colors hover:bg-slate-100 dark:bg-slate-900/60 dark:hover:bg-slate-800/60"
        >
          <div>
            <h3 className="text-base font-semibold text-slate-900 dark:text-white">
              Advanced Models
            </h3>
            <p className="mt-0.5 text-sm text-slate-500 dark:text-slate-400">
              Supervised &amp; unsupervised learners, feature tools, and model
              utilities
            </p>
          </div>
          {showAdvancedMl ? (
            <ChevronDown className="h-5 w-5 shrink-0 text-slate-400" />
          ) : (
            <ChevronRight className="h-5 w-5 shrink-0 text-slate-400" />
          )}
        </button>

        {showAdvancedMl && (
          <div className="space-y-6 p-4">
            <ToolSection
              title="Supervised Learning"
              description="Train and evaluate models with labeled target variables."
            >
              <div className="space-y-4">
                <ErrorBoundary>
                  <KnnView tableName={tableName} columns={columns} />
                </ErrorBoundary>
                <ErrorBoundary>
                  <NaiveBayesView tableName={tableName} columns={columns} />
                </ErrorBoundary>
                <ErrorBoundary>
                  <LogisticRegressionView tableName={tableName} columns={columns} />
                </ErrorBoundary>
                <ErrorBoundary>
                  <DecisionTreeView tableName={tableName} columns={columns} />
                </ErrorBoundary>
                <ErrorBoundary>
                  <SurvivalAnalysis tableName={tableName} columns={columns} />
                </ErrorBoundary>
              </div>
            </ToolSection>

            <ToolSection
              title="Unsupervised Learning"
              description="Discover hidden structure and patterns without labeled data."
            >
              <div className="space-y-4">
                <ErrorBoundary>
                  <MLAnomalyDetector tableName={tableName} columns={columns} />
                </ErrorBoundary>
                <ErrorBoundary>
                  <PcaView tableName={tableName} columns={columns} />
                </ErrorBoundary>
                <ErrorBoundary>
                  <AssociationRules tableName={tableName} columns={columns} />
                </ErrorBoundary>
                <ErrorBoundary>
                  <TimeSeriesClassifier tableName={tableName} columns={columns} />
                </ErrorBoundary>
              </div>
            </ToolSection>

            <ToolSection
              title="Model Tools"
              description="Feature pipelines, model comparison, and training diagnostics."
            >
              <div className="space-y-4">
                <ErrorBoundary>
                  <FeatureEngineering tableName={tableName} columns={columns} />
                </ErrorBoundary>
                <ErrorBoundary>
                  <ModelComparison tableName={tableName} columns={columns} />
                </ErrorBoundary>
                <ErrorBoundary>
                  <ModelTrainingLog tableName={tableName} columns={columns} />
                </ErrorBoundary>
              </div>
            </ToolSection>
          </div>
        )}
      </div>
    </AnimatedWorkspaceSection>
  );
}
