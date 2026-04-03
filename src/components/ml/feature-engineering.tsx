"use client";

import { startTransition, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { Download, FlaskConical, Layers3, Loader2, PlusSquare } from "lucide-react";
import { runQuery } from "@/lib/duckdb/client";
import { downloadFile } from "@/lib/utils/export";
import {
  ANALYTICS_EASE,
  BUTTON_CLASS,
  FIELD_CLASS,
  GLASS_CARD_CLASS,
  GLASS_PANEL_CLASS,
  quoteIdentifier,
  toNumber,
} from "@/lib/utils/advanced-analytics";
import type { ColumnProfile } from "@/types/dataset";

interface FeatureEngineeringProps {
  tableName: string;
  columns: ColumnProfile[];
}

type Transformation = "log" | "sqrt" | "square" | "interaction" | "polynomial";

interface FeaturePreviewRow {
  rowNumber: number;
  primaryValue: number | null;
  secondaryValue: number | null;
  featureValue: number | null;
}

interface FeatureSummaryCardProps {
  label: string;
  value: string;
}

const SAMPLE_LIMIT = 40;
const TRANSFORMATIONS = [
  { value: "log", label: "Log transform" },
  { value: "sqrt", label: "Square root" },
  { value: "square", label: "Square" },
  { value: "interaction", label: "Interaction term" },
  { value: "polynomial", label: "Polynomial" },
] as const satisfies ReadonlyArray<{ value: Transformation; label: string }>;

function FeatureSummaryCard({ label, value }: FeatureSummaryCardProps) {
  return (
    <div className={`${GLASS_CARD_CLASS} p-4`}>
      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
        {label}
      </p>
      <p className="mt-2 text-xl font-semibold text-slate-950 dark:text-white">{value}</p>
    </div>
  );
}

function getNumericColumns(columns: ColumnProfile[]) {
  return columns.filter((column) => column.type === "number");
}

function buildFeatureName(
  transformation: Transformation,
  primaryColumn: string,
  secondaryColumn: string,
  degree: number,
) {
  switch (transformation) {
    case "log":
      return `log_${primaryColumn}`;
    case "sqrt":
      return `sqrt_${primaryColumn}`;
    case "square":
      return `${primaryColumn}_squared`;
    case "interaction":
      return `${primaryColumn}_x_${secondaryColumn}`;
    case "polynomial":
      return `${primaryColumn}_pow_${degree}`;
    default:
      return `${primaryColumn}_feature`;
  }
}

function buildPreviewQuery(
  tableName: string,
  primaryColumn: string,
  secondaryColumn: string,
  transformation: Transformation,
) {
  const primary = quoteIdentifier(primaryColumn);
  const secondary = quoteIdentifier(secondaryColumn);

  return `
    SELECT
      TRY_CAST(${primary} AS DOUBLE) AS primary_value,
      ${
        transformation === "interaction"
          ? `TRY_CAST(${secondary} AS DOUBLE) AS secondary_value`
          : "NULL AS secondary_value"
      }
    FROM ${quoteIdentifier(tableName)}
    WHERE TRY_CAST(${primary} AS DOUBLE) IS NOT NULL
      ${
        transformation === "interaction"
          ? `AND TRY_CAST(${secondary} AS DOUBLE) IS NOT NULL`
          : ""
      }
    LIMIT ${SAMPLE_LIMIT}
  `;
}

function computeFeatureValue(
  transformation: Transformation,
  primaryValue: number | null,
  secondaryValue: number | null,
  degree: number,
) {
  if (primaryValue === null) return null;

  switch (transformation) {
    case "log":
      return primaryValue > -1 ? Math.log1p(primaryValue) : null;
    case "sqrt":
      return primaryValue >= 0 ? Math.sqrt(primaryValue) : null;
    case "square":
      return primaryValue ** 2;
    case "interaction":
      return secondaryValue === null ? null : primaryValue * secondaryValue;
    case "polynomial":
      return primaryValue ** degree;
    default:
      return null;
  }
}

function buildSqlExpression(
  transformation: Transformation,
  primaryColumn: string,
  secondaryColumn: string,
  degree: number,
) {
  const primary = `TRY_CAST(${quoteIdentifier(primaryColumn)} AS DOUBLE)`;
  const secondary = `TRY_CAST(${quoteIdentifier(secondaryColumn)} AS DOUBLE)`;

  switch (transformation) {
    case "log":
      return `CASE WHEN ${primary} > -1 THEN LN(1 + ${primary}) ELSE NULL END`;
    case "sqrt":
      return `CASE WHEN ${primary} >= 0 THEN SQRT(${primary}) ELSE NULL END`;
    case "square":
      return `POWER(${primary}, 2)`;
    case "interaction":
      return `${primary} * ${secondary}`;
    case "polynomial":
      return `POWER(${primary}, ${degree})`;
    default:
      return primary;
  }
}

function buildPreviewRows(
  rows: Record<string, unknown>[],
  transformation: Transformation,
  degree: number,
) {
  return rows.flatMap<FeaturePreviewRow>((row, index) => {
    const primaryValue = toNumber(row.primary_value);
    const secondaryValue = toNumber(row.secondary_value);
    const featureValue = computeFeatureValue(
      transformation,
      primaryValue,
      secondaryValue,
      degree,
    );

    if (featureValue === null && transformation !== "log" && transformation !== "sqrt") {
      return [];
    }

    return [
      {
        rowNumber: index + 1,
        primaryValue,
        secondaryValue,
        featureValue,
      },
    ];
  });
}

function csvEscape(value: unknown) {
  const text = String(value ?? "");
  return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function buildPreviewCsv(featureName: string, rows: FeaturePreviewRow[]) {
  const header = ["row_number", "primary_value", "secondary_value", featureName];
  const body = rows.map((row) =>
    [row.rowNumber, row.primaryValue, row.secondaryValue, row.featureValue]
      .map(csvEscape)
      .join(","),
  );
  return [header.join(","), ...body].join("\n");
}

export default function FeatureEngineering({
  tableName,
  columns,
}: FeatureEngineeringProps) {
  const numericColumns = useMemo(() => getNumericColumns(columns), [columns]);
  const defaultPrimary = numericColumns[0]?.name ?? "";
  const defaultSecondary = numericColumns[1]?.name ?? numericColumns[0]?.name ?? "";

  const [transformation, setTransformation] = useState<Transformation>("log");
  const [primaryColumn, setPrimaryColumn] = useState(defaultPrimary);
  const [secondaryColumn, setSecondaryColumn] = useState(defaultSecondary);
  const [degree, setDegree] = useState(2);
  const [previewRows, setPreviewRows] = useState<FeaturePreviewRow[]>([]);
  const [appliedFeatures, setAppliedFeatures] = useState<string[]>([]);
  const [isPreviewLoading, setIsPreviewLoading] = useState(false);
  const [isApplying, setIsApplying] = useState(false);
  const [status, setStatus] = useState(
    "Choose numeric columns, preview the engineered feature, then apply it to DuckDB.",
  );

  const featureName = useMemo(
    () => buildFeatureName(transformation, primaryColumn, secondaryColumn, degree),
    [degree, primaryColumn, secondaryColumn, transformation],
  );

  const previewAverage = useMemo(() => {
    if (previewRows.length === 0) return "No preview";

    const values = previewRows
      .map((row) => row.featureValue)
      .filter((value): value is number => value !== null && Number.isFinite(value));

    if (values.length === 0) return "No valid values";

    const average = values.reduce((sum, value) => sum + value, 0) / values.length;
    return average.toFixed(3);
  }, [previewRows]);

  const requiresSecondary = transformation === "interaction";
  const hasNumericColumns = numericColumns.length > 0;

  async function handlePreview() {
    if (!primaryColumn) {
      setStatus("Select a primary numeric column before previewing.");
      return;
    }

    if (requiresSecondary && !secondaryColumn) {
      setStatus("Choose a secondary column for the interaction term.");
      return;
    }

    setIsPreviewLoading(true);

    try {
      const rows = await runQuery(
        buildPreviewQuery(tableName, primaryColumn, secondaryColumn, transformation),
      );
      const nextRows = buildPreviewRows(rows, transformation, degree);

      startTransition(() => {
        setPreviewRows(nextRows);
        setStatus(`Previewed ${nextRows.length} rows for ${featureName}.`);
      });
    } catch {
      setStatus("Preview failed. Check the selected columns and try again.");
    } finally {
      setIsPreviewLoading(false);
    }
  }

  async function handleApply() {
    if (!primaryColumn) {
      setStatus("Select a primary numeric column before applying a feature.");
      return;
    }

    if (requiresSecondary && !secondaryColumn) {
      setStatus("Choose a secondary column before applying the interaction term.");
      return;
    }

    setIsApplying(true);

    try {
      const expression = buildSqlExpression(
        transformation,
        primaryColumn,
        secondaryColumn,
        degree,
      );
      const columnIdentifier = quoteIdentifier(featureName);
      const tableIdentifier = quoteIdentifier(tableName);

      await runQuery(
        `ALTER TABLE ${tableIdentifier} ADD COLUMN IF NOT EXISTS ${columnIdentifier} DOUBLE`,
      );
      await runQuery(
        `UPDATE ${tableIdentifier} SET ${columnIdentifier} = ${expression}`,
      );

      startTransition(() => {
        setAppliedFeatures((current) =>
          current.includes(featureName) ? current : [...current, featureName],
        );
        setStatus(`Applied ${featureName} to ${tableName}.`);
      });
    } catch {
      setStatus("Applying the engineered feature failed.");
    } finally {
      setIsApplying(false);
    }
  }

  function handleExport() {
    if (previewRows.length === 0) return;
    downloadFile(
      buildPreviewCsv(featureName, previewRows),
      `${tableName}-${featureName}-preview.csv`,
      "text/csv;charset=utf-8;",
    );
  }

  return (
    <motion.section
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.32, ease: ANALYTICS_EASE }}
      className={`${GLASS_PANEL_CLASS} overflow-hidden p-6`}
    >
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <div className="inline-flex items-center gap-2 rounded-full bg-cyan-500/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-cyan-700 dark:text-cyan-300">
            <FlaskConical className="h-3.5 w-3.5" />
            Feature engineering
          </div>
          <h2 className="mt-3 text-2xl font-semibold text-slate-950 dark:text-white">
            Create derived features from numeric columns
          </h2>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600 dark:text-slate-300">
            Build log, root, squared, interaction, and polynomial features before applying them
            to the active DuckDB table.
          </p>
        </div>

        <div className={`${GLASS_CARD_CLASS} max-w-md p-4`}>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
            Current feature
          </p>
          <p className="mt-2 text-lg font-semibold text-slate-950 dark:text-white">
            {featureName || "Awaiting column selection"}
          </p>
          <p className="mt-2 text-sm leading-6 text-slate-600 dark:text-slate-300">{status}</p>
        </div>
      </div>

      <div className="mt-6 grid gap-5 xl:grid-cols-[1.25fr_0.95fr]">
        <div className={`${GLASS_CARD_CLASS} p-5`}>
          <div className="grid gap-4 md:grid-cols-2">
            <label className="block">
              <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
                Transformation
              </span>
              <select
                value={transformation}
                onChange={(event) => setTransformation(event.target.value as Transformation)}
                className={FIELD_CLASS}
                aria-label="Transformation"
              >
                {TRANSFORMATIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>

            <label className="block">
              <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
                Primary column
              </span>
              <select
                value={primaryColumn}
                onChange={(event) => setPrimaryColumn(event.target.value)}
                className={FIELD_CLASS}
                aria-label="Primary column"
              >
                {numericColumns.map((column) => (
                  <option key={column.name} value={column.name}>
                    {column.name}
                  </option>
                ))}
              </select>
            </label>

            <label className="block">
              <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
                Secondary column
              </span>
              <select
                value={secondaryColumn}
                onChange={(event) => setSecondaryColumn(event.target.value)}
                className={FIELD_CLASS}
                aria-label="Secondary column"
                disabled={!requiresSecondary}
              >
                {numericColumns.map((column) => (
                  <option key={column.name} value={column.name}>
                    {column.name}
                  </option>
                ))}
              </select>
            </label>

            <label className="block">
              <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
                Polynomial degree
              </span>
              <input
                type="number"
                min={2}
                max={5}
                value={degree}
                onChange={(event) => setDegree(Math.max(2, Math.min(5, Number(event.target.value))))}
                className={FIELD_CLASS}
                aria-label="Polynomial degree"
                disabled={transformation !== "polynomial"}
              />
            </label>
          </div>

          <div className="mt-5 flex flex-wrap gap-3">
            <button
              type="button"
              onClick={() => void handlePreview()}
              className={BUTTON_CLASS}
              disabled={!hasNumericColumns || isPreviewLoading}
            >
              {isPreviewLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Layers3 className="h-4 w-4" />}
              Preview features
            </button>
            <button
              type="button"
              onClick={() => void handleApply()}
              className={BUTTON_CLASS}
              disabled={!hasNumericColumns || isApplying}
            >
              {isApplying ? <Loader2 className="h-4 w-4 animate-spin" /> : <PlusSquare className="h-4 w-4" />}
              Apply feature
            </button>
            <button
              type="button"
              onClick={handleExport}
              className={BUTTON_CLASS}
              disabled={previewRows.length === 0}
            >
              <Download className="h-4 w-4" />
              Export CSV
            </button>
          </div>
        </div>

        <div className="grid gap-4">
          <FeatureSummaryCard label="Preview rows" value={previewRows.length.toString()} />
          <FeatureSummaryCard label="Average derived value" value={previewAverage} />
          <FeatureSummaryCard
            label="Applied features"
            value={appliedFeatures.length === 0 ? "None yet" : appliedFeatures.join(", ")}
          />
        </div>
      </div>

      <div className="mt-6 grid gap-5 xl:grid-cols-[1.2fr_0.8fr]">
        <div className={`${GLASS_CARD_CLASS} overflow-hidden p-5`}>
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-base font-semibold text-slate-950 dark:text-white">
              Preview new features
            </h3>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
              {featureName}
            </p>
          </div>

          {!hasNumericColumns ? (
            <p className="mt-4 text-sm text-slate-600 dark:text-slate-300">
              Add at least one numeric column before engineering features.
            </p>
          ) : previewRows.length === 0 ? (
            <p className="mt-4 text-sm text-slate-600 dark:text-slate-300">
              Preview the engineered column to inspect derived values before applying it.
            </p>
          ) : (
            <div className="mt-4 overflow-x-auto">
              <table className="min-w-full divide-y divide-white/20 text-sm">
                <thead>
                  <tr className="text-left text-slate-500 dark:text-slate-400">
                    <th className="px-3 py-2 font-medium">Row</th>
                    <th className="px-3 py-2 font-medium">{primaryColumn}</th>
                    <th className="px-3 py-2 font-medium">{secondaryColumn || "Secondary"}</th>
                    <th className="px-3 py-2 font-medium">{featureName}</th>
                  </tr>
                </thead>
                <tbody>
                  {previewRows.map((row) => (
                    <tr key={row.rowNumber} className="border-t border-white/10">
                      <td className="px-3 py-2 text-slate-600 dark:text-slate-300">
                        {row.rowNumber}
                      </td>
                      <td className="px-3 py-2 text-slate-950 dark:text-white">
                        {row.primaryValue?.toFixed(3) ?? "—"}
                      </td>
                      <td className="px-3 py-2 text-slate-600 dark:text-slate-300">
                        {row.secondaryValue?.toFixed(3) ?? "—"}
                      </td>
                      <td className="px-3 py-2 text-cyan-700 dark:text-cyan-300">
                        {row.featureValue?.toFixed(4) ?? "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className={`${GLASS_CARD_CLASS} p-5`}>
          <h3 className="text-base font-semibold text-slate-950 dark:text-white">
            Transformation guide
          </h3>
          <ul className="mt-4 space-y-3 text-sm leading-6 text-slate-600 dark:text-slate-300">
            <li>`Log` uses `log1p(x)` so zeros remain valid.</li>
            <li>`Sqrt` skips negative inputs and keeps positive scale relationships.</li>
            <li>`Square` amplifies large values for nonlinear separation.</li>
            <li>`Interaction` multiplies two numeric signals into one combined feature.</li>
            <li>`Polynomial` raises the selected column to degree 2 through 5.</li>
          </ul>
        </div>
      </div>
    </motion.section>
  );
}
