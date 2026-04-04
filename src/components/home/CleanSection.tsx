"use client";

import type { ColumnProfile } from "@/types/dataset";
import DataCleaner from "@/components/data/data-cleaner";
import DataValidator from "@/components/data/data-validator";
import DuplicateFinder from "@/components/data/duplicate-finder";
import NullHandler from "@/components/data/null-handler";
import TypeConverter from "@/components/data/type-converter";
import { ErrorBoundary } from "@/components/ui/error-boundary";

import {
  AnimatedWorkspaceSection,
  ToolSection,
} from "@/components/home/workspace-shared";

interface CleanSectionProps {
  tableName: string;
  columns: ColumnProfile[];
  onRefreshDataset: (title?: string, message?: string) => Promise<void> | void;
}

export default function CleanSection({
  tableName,
  columns,
  onRefreshDataset,
}: CleanSectionProps) {
  return (
    <AnimatedWorkspaceSection>
      <div>
        <h2 className="text-lg font-semibold text-slate-900 dark:text-white mb-1">
          Data Cleaning
        </h2>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Normalize, validate, and repair the active dataset with focused
          cleanup tools in one place.
        </p>
      </div>

      <ToolSection
        title="Cleaner"
        description="Run broad cleanup passes to standardize rows and remove common data quality issues."
      >
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
      </ToolSection>

      <ToolSection
        title="Duplicate Finder"
        description="Detect repeated records and inspect likely duplicate clusters before taking action."
      >
        <ErrorBoundary>
          <DuplicateFinder tableName={tableName} columns={columns} />
        </ErrorBoundary>
      </ToolSection>

      <ToolSection
        title="Null Handling"
        description="Profile missing values and apply fill, drop, or imputation strategies by column."
      >
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
      </ToolSection>

      <ToolSection
        title="Type Conversion"
        description="Convert columns to the right storage and semantic types before downstream analysis."
      >
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
      </ToolSection>

      <ToolSection
        title="Validation"
        description="Check business rules, schema assumptions, and inconsistent values before reporting."
      >
        <ErrorBoundary>
          <DataValidator tableName={tableName} columns={columns} />
        </ErrorBoundary>
      </ToolSection>
    </AnimatedWorkspaceSection>
  );
}
