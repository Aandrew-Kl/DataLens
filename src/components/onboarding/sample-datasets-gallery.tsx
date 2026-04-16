"use client";

import { useState } from "react";
import {
  CreditCard,
  Globe2,
  Loader2,
  ShoppingBag,
  type LucideIcon,
} from "lucide-react";
import {
  SAMPLE_DATASETS,
  type SampleDataset,
} from "@/data/sample-datasets/catalog";
import { getTableRowCount, loadCSVIntoDB } from "@/lib/duckdb/client";

type DatasetLoadArgs = {
  tableName: string;
  fileName: string;
  rowCount: number;
  columnCount: number;
  columns: string[];
};

interface SampleDatasetsGalleryProps {
  onDatasetLoaded: (args: DatasetLoadArgs) => void | Promise<void>;
  className?: string;
}

const ICONS: Record<string, LucideIcon> = {
  "ecommerce-orders": ShoppingBag,
  "stripe-payments": CreditCard,
  "web-analytics": Globe2,
};

const SURFACES: Record<string, string> = {
  "ecommerce-orders":
    "border-emerald-200/70 bg-emerald-50/70 dark:border-emerald-500/20 dark:bg-emerald-950/20",
  "stripe-payments":
    "border-sky-200/70 bg-sky-50/70 dark:border-sky-500/20 dark:bg-sky-950/20",
  "web-analytics":
    "border-violet-200/70 bg-violet-50/70 dark:border-violet-500/20 dark:bg-violet-950/20",
};

function PreviewTable({ dataset }: { dataset: SampleDataset }) {
  return (
    <div className="overflow-x-auto rounded-2xl border border-white/40 bg-white/75 dark:border-white/10 dark:bg-slate-950/50">
      <table className="min-w-full border-separate border-spacing-0 text-left text-[11px]">
        <thead>
          <tr className="bg-white/80 dark:bg-slate-900/80">
            {dataset.columns.slice(0, 4).map((column) => (
              <th
                key={column}
                className="border-b border-white/30 px-3 py-2 font-semibold text-slate-700 dark:border-white/10 dark:text-slate-200"
              >
                {column}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {dataset.previewRows.slice(0, 3).map((row, rowIndex) => (
            <tr key={`${dataset.slug}-${rowIndex}`}>
              {dataset.columns.slice(0, 4).map((column) => (
                <td
                  key={`${rowIndex}-${column}`}
                  className="border-b border-white/20 px-3 py-2 text-slate-600 last:border-b-0 dark:border-white/5 dark:text-slate-300"
                >
                  {String(row[column] ?? "")}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function SampleDatasetsGallery({
  onDatasetLoaded,
  className,
}: SampleDatasetsGalleryProps) {
  const [loadingSlug, setLoadingSlug] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});

  async function handleLoadDataset(dataset: SampleDataset) {
    setLoadingSlug(dataset.slug);
    setErrors((current) => ({ ...current, [dataset.slug]: "" }));

    try {
      const response = await fetch(`/sample-data/${dataset.fileName}`);
      if (!response.ok) {
        throw new Error(`Failed to fetch dataset (${response.status})`);
      }

      const csv = await response.text();
      await loadCSVIntoDB(dataset.tableName, csv);
      const rowCount = await getTableRowCount(dataset.tableName);

      await onDatasetLoaded({
        tableName: dataset.tableName,
        fileName: dataset.fileName,
        rowCount,
        columnCount: dataset.columnCount,
        columns: dataset.columns,
      });
    } catch (error) {
      setErrors((current) => ({
        ...current,
        [dataset.slug]:
          error instanceof Error ? error.message : "Failed to load dataset.",
      }));
    } finally {
      setLoadingSlug(null);
    }
  }

  return (
    <section
      className={[
        "rounded-[1.75rem] border border-white/20 bg-white/50 p-5 shadow-[0_20px_60px_-35px_rgba(15,23,42,0.55)] backdrop-blur-2xl dark:border-white/10 dark:bg-slate-900/35",
        className ?? "",
      ].join(" ")}
    >
      <div className="mb-4 flex items-start justify-between gap-4">
        <div>
          <p className="text-sm font-semibold uppercase tracking-[0.24em] text-slate-500 dark:text-slate-400">
            Sample datasets
          </p>
          <h3 className="mt-1 text-xl font-semibold text-slate-900 dark:text-white">
            Load realistic data in one click
          </h3>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        {SAMPLE_DATASETS.map((dataset) => {
          const isLoading = loadingSlug === dataset.slug;
          const Icon = ICONS[dataset.slug] ?? ShoppingBag;
          const surface =
            SURFACES[dataset.slug] ??
            "border-white/15 bg-white/45 dark:border-white/10 dark:bg-slate-900/30";

          return (
            <article
              key={dataset.slug}
              className={`rounded-[1.3rem] border ${surface} p-5 text-left shadow-[0_18px_40px_-28px_rgba(15,23,42,0.6)] backdrop-blur-xl transition hover:-translate-y-0.5`}
            >
              <div className="flex h-full flex-col">
                <div className="mb-3 inline-flex h-10 w-10 items-center justify-center rounded-xl border border-white/25 bg-white/70 text-slate-700 dark:border-white/10 dark:bg-slate-950/50 dark:text-slate-200">
                  <Icon className="h-5 w-5" />
                </div>
                <h4 className="text-lg font-semibold text-slate-900 dark:text-white">
                  {dataset.title}
                </h4>
                <p className="mt-2 text-sm leading-6 text-slate-600 dark:text-slate-300">
                  {dataset.description}
                </p>
                <div className="mt-3 inline-flex w-fit rounded-full border border-white/20 bg-white/70 px-3 py-1 text-xs font-medium text-slate-600 dark:border-white/10 dark:bg-slate-950/50 dark:text-slate-300">
                  {dataset.rowCount.toLocaleString()} rows ×{" "}
                  {dataset.columnCount} columns
                </div>

                <div className="mt-4">
                  <PreviewTable dataset={dataset} />
                </div>

                <button
                  type="button"
                  onClick={() => void handleLoadDataset(dataset)}
                  disabled={loadingSlug !== null}
                  className="mt-5 inline-flex items-center justify-center gap-2 rounded-xl border border-slate-200/70 bg-slate-950 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-70 dark:border-white/10 dark:bg-white dark:text-slate-950 dark:hover:bg-slate-200"
                >
                  {isLoading ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Loading…
                    </>
                  ) : (
                    "Load dataset"
                  )}
                </button>

                {errors[dataset.slug] ? (
                  <p className="mt-3 text-sm text-rose-600 dark:text-rose-400">
                    {errors[dataset.slug]}
                  </p>
                ) : null}
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}
