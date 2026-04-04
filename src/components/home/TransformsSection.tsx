"use client";

import { useState } from "react";
import dynamic from "next/dynamic";

import type { ColumnProfile, DatasetMeta } from "@/types/dataset";
import AnomalyDetector from "@/components/data/anomaly-detector";
import ColumnGrouper from "@/components/data/column-grouper";
import ColumnRenamer from "@/components/data/column-renamer";
import ColumnTransformer from "@/components/data/column-transformer";
import DataChangelog from "@/components/data/data-changelog";
import DataCleaner from "@/components/data/data-cleaner";
import DataEnrichment from "@/components/data/data-enrichment";
import DataPipeline from "@/components/data/data-pipeline";
import DataQualityRules from "@/components/data/data-quality-rules";
import DataSampler from "@/components/data/data-sampler";
import DuplicateFinder from "@/components/data/duplicate-finder";
import FormulaEditor from "@/components/data/formula-editor";
import JoinBuilder from "@/components/data/join-builder";
import NullHandler from "@/components/data/null-handler";
import RegexTester from "@/components/data/regex-tester";
import SmartFilter from "@/components/data/smart-filter";
import TransformPanel from "@/components/data/transform-panel";
import TypeConverter from "@/components/data/type-converter";
import { ErrorBoundary } from "@/components/ui/error-boundary";

import {
  AnimatedWorkspaceSection,
  ToolSection,
} from "@/components/home/workspace-shared";

const ColumnSplitter = dynamic(() => import("@/components/data/column-splitter"), {
  ssr: false,
});
const ColumnRenameTool = dynamic(
  () => import("@/components/data/column-rename-tool"),
  { ssr: false },
);
const DataTransposeTool = dynamic(
  () => import("@/components/data/data-transpose-tool"),
  { ssr: false },
);
const DataStandardizer = dynamic(
  () => import("@/components/data/data-standardizer"),
  { ssr: false },
);
const TypeCastTool = dynamic(() => import("@/components/data/type-cast-tool"), {
  ssr: false,
});
const EncodingDetector = dynamic(
  () => import("@/components/data/encoding-detector"),
  { ssr: false },
);
const ExpressionCalculator = dynamic(
  () => import("@/components/data/expression-calculator"),
  { ssr: false },
);
const ConditionalFormatter = dynamic(
  () => import("@/components/data/conditional-formatter"),
  { ssr: false },
);
const MissingValueImputer = dynamic(
  () => import("@/components/data/missing-value-imputer"),
  { ssr: false },
);
const ConstraintChecker = dynamic(
  () => import("@/components/data/constraint-checker"),
  { ssr: false },
);
const RegexToolDyn = dynamic(() => import("@/components/data/regex-tool"), {
  ssr: false,
});
const DataMaskingTool = dynamic(
  () => import("@/components/data/data-masking-tool"),
  { ssr: false },
);
const DataAggregator = dynamic(
  () => import("@/components/data/data-aggregator"),
  { ssr: false },
);
const OutlierRemoval = dynamic(
  () => import("@/components/data/outlier-removal"),
  { ssr: false },
);

interface TransformsSectionProps {
  tableName: string;
  columns: ColumnProfile[];
  datasets: DatasetMeta[];
  onRefreshDataset: (title?: string, message?: string) => Promise<void> | void;
  onFormulaSave: (name: string, expression: string) => Promise<void> | void;
}

export default function TransformsSection({
  tableName,
  columns,
  datasets,
  onRefreshDataset,
  onFormulaSave,
}: TransformsSectionProps) {
  const [showMoreTransforms, setShowMoreTransforms] = useState(false);

  return (
    <AnimatedWorkspaceSection>
      <div className="mb-4">
        <h2 className="text-lg font-semibold text-slate-900 dark:text-white mb-1">
          Data Transforms
        </h2>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Filter, sort, group, and create computed columns on your data
        </p>
      </div>

      <div className="space-y-6">
        <ErrorBoundary>
          <DataPipeline tableName={tableName} columns={columns} />
        </ErrorBoundary>
        <ErrorBoundary>
          <ColumnTransformer tableName={tableName} columns={columns} />
        </ErrorBoundary>

        <ToolSection
          title="Smart Filters"
          description="Build reusable multi-condition filter logic and turn it into SQL-ready predicates for downstream analysis."
        >
          <ErrorBoundary>
            <SmartFilter tableName={tableName} columns={columns} />
          </ErrorBoundary>
        </ToolSection>

        <ErrorBoundary>
          <DataCleaner
            tableName={tableName}
            columns={columns}
            onCleanComplete={() =>
              void onRefreshDataset(
                "Cleaning complete",
                `Updated ${tableName} after cleaning operations.`,
              )
            }
          />
        </ErrorBoundary>

        <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
          <ErrorBoundary>
            <TransformPanel
              tableName={tableName}
              columns={columns}
              onTransformComplete={() =>
                void onRefreshDataset(
                  "Transform complete",
                  `Updated ${tableName} after the transform run.`,
                )
              }
            />
          </ErrorBoundary>
          {datasets.length > 1 && (
            <ErrorBoundary>
              <JoinBuilder
                datasets={datasets}
                onJoinComplete={() =>
                  void onRefreshDataset(
                    "Join complete",
                    `Re-profiled ${tableName} after the join finished.`,
                  )
                }
              />
            </ErrorBoundary>
          )}
        </div>

        <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
          <ErrorBoundary>
            <ColumnRenamer
              tableName={tableName}
              columns={columns}
              onComplete={() =>
                void onRefreshDataset(
                  "Columns renamed",
                  `Updated column names for ${tableName}.`,
                )
              }
            />
          </ErrorBoundary>
          <ErrorBoundary>
            <NullHandler
              tableName={tableName}
              columns={columns}
              onComplete={() =>
                void onRefreshDataset(
                  "Null handling applied",
                  `Updated null handling rules for ${tableName}.`,
                )
              }
            />
          </ErrorBoundary>
        </div>

        <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
          <ErrorBoundary>
            <TypeConverter
              tableName={tableName}
              columns={columns}
              onConvert={() =>
                void onRefreshDataset(
                  "Types converted",
                  `Column types were refreshed for ${tableName}.`,
                )
              }
            />
          </ErrorBoundary>
          <ErrorBoundary>
            <DuplicateFinder tableName={tableName} columns={columns} />
          </ErrorBoundary>
        </div>

        <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
          <ErrorBoundary>
            <ColumnGrouper tableName={tableName} columns={columns} />
          </ErrorBoundary>
          <ErrorBoundary>
            <DataChangelog tableName={tableName} />
          </ErrorBoundary>
        </div>

        <ErrorBoundary>
          <DataSampler tableName={tableName} columns={columns} />
        </ErrorBoundary>
        <ErrorBoundary>
          <FormulaEditor
            tableName={tableName}
            columns={columns}
            onSave={onFormulaSave}
          />
        </ErrorBoundary>

        <ToolSection
          title="Data Enrichment"
          description="Generate derived fields with date parts, ranking, lag/lead, binning, and running aggregates before downstream analysis."
        >
          <ErrorBoundary>
            <DataEnrichment tableName={tableName} columns={columns} />
          </ErrorBoundary>
        </ToolSection>

        <ErrorBoundary>
          <RegexTester tableName={tableName} columns={columns} />
        </ErrorBoundary>

        <ToolSection
          title="Data Quality Rules"
          description="Define validation rules, persist reusable rule sets, and quantify violations before publishing downstream assets."
        >
          <ErrorBoundary>
            <DataQualityRules tableName={tableName} columns={columns} />
          </ErrorBoundary>
        </ToolSection>

        <ToolSection
          title="Anomaly Detector"
          description="Run statistical anomaly detection with multiple methods to surface unexpected records and time-series spikes."
        >
          <ErrorBoundary>
            <AnomalyDetector tableName={tableName} columns={columns} />
          </ErrorBoundary>
        </ToolSection>

        <div className="mt-6">
          <button
            type="button"
            onClick={() => setShowMoreTransforms((current) => !current)}
            className="flex items-center gap-2 text-sm font-semibold text-slate-700 hover:text-sky-600 dark:text-slate-200"
          >
            {showMoreTransforms ? "▾" : "▸"} More Transform Tools (14 available)
          </button>
          {showMoreTransforms && (
            <div className="mt-4 grid gap-6">
              <ErrorBoundary>
                <ColumnSplitter tableName={tableName} columns={columns} />
              </ErrorBoundary>
              <ErrorBoundary>
                <ColumnRenameTool tableName={tableName} columns={columns} />
              </ErrorBoundary>
              <ErrorBoundary>
                <DataTransposeTool tableName={tableName} columns={columns} />
              </ErrorBoundary>
              <ErrorBoundary>
                <DataStandardizer tableName={tableName} columns={columns} />
              </ErrorBoundary>
              <ErrorBoundary>
                <TypeCastTool tableName={tableName} columns={columns} />
              </ErrorBoundary>
              <ErrorBoundary>
                <EncodingDetector tableName={tableName} columns={columns} />
              </ErrorBoundary>
              <ErrorBoundary>
                <ExpressionCalculator tableName={tableName} columns={columns} />
              </ErrorBoundary>
              <ErrorBoundary>
                <ConditionalFormatter tableName={tableName} columns={columns} />
              </ErrorBoundary>
              <ErrorBoundary>
                <MissingValueImputer tableName={tableName} columns={columns} />
              </ErrorBoundary>
              <ErrorBoundary>
                <ConstraintChecker tableName={tableName} columns={columns} />
              </ErrorBoundary>
              <ErrorBoundary>
                <RegexToolDyn tableName={tableName} columns={columns} />
              </ErrorBoundary>
              <ErrorBoundary>
                <DataMaskingTool tableName={tableName} columns={columns} />
              </ErrorBoundary>
              <ErrorBoundary>
                <DataAggregator tableName={tableName} columns={columns} />
              </ErrorBoundary>
              <ErrorBoundary>
                <OutlierRemoval tableName={tableName} columns={columns} />
              </ErrorBoundary>
            </div>
          )}
        </div>
      </div>
    </AnimatedWorkspaceSection>
  );
}
