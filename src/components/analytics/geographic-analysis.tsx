"use client";

import { startTransition, useMemo, useState } from "react";
import { motion } from "framer-motion";
import {
  Download,
  Globe2,
  Loader2,
  MapPinned,
} from "lucide-react";
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
import { formatNumber } from "@/lib/utils/formatters";
import type { ColumnProfile } from "@/types/dataset";

interface GeographicAnalysisProps {
  tableName: string;
  columns: ColumnProfile[];
}

interface ZoneSummary {
  zone: string;
  count: number;
  avgLat: number;
  avgLon: number;
}

interface DistributionRow {
  label: string;
  count: number;
}

interface GeoResult {
  recordCount: number;
  zones: ZoneSummary[];
  distributions: DistributionRow[];
}

interface GeoSampleRow {
  latitude: number;
  longitude: number;
  country: string | null;
  state: string | null;
}

interface SummaryCardProps {
  label: string;
  value: string;
}

function SummaryCard({ label, value }: SummaryCardProps) {
  return (
    <div className={`${GLASS_CARD_CLASS} p-4`}>
      <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
        {label}
      </div>
      <div className="mt-3 text-xl font-semibold text-slate-950 dark:text-white">
        {value}
      </div>
    </div>
  );
}

function detectCoordinateColumn(columns: ColumnProfile[], patterns: string[]) {
  return (
    columns.find((column) =>
      patterns.some((pattern) => column.name.toLowerCase().includes(pattern)),
    )?.name ?? ""
  );
}

function csvEscape(value: string | number) {
  const text = String(value);
  return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function buildZoneName(latitude: number, longitude: number) {
  const northSouth = latitude >= 0 ? "Northern" : "Southern";
  const eastWest = longitude >= 0 ? "Eastern" : "Western";
  return `${northSouth} / ${eastWest}`;
}

function toCsv(result: GeoResult) {
  const zoneSection = [
    "zone,count,avg_lat,avg_lon",
    ...result.zones.map((zone) =>
      [
        csvEscape(zone.zone),
        zone.count,
        zone.avgLat.toFixed(4),
        zone.avgLon.toFixed(4),
      ].join(","),
    ),
  ];
  const distributionSection = [
    "",
    "region_label,count",
    ...result.distributions.map((row) =>
      [csvEscape(row.label), row.count].join(","),
    ),
  ];
  return [...zoneSection, ...distributionSection].join("\n");
}

async function runGeographicAnalysis(
  tableName: string,
  latColumn: string,
  lonColumn: string,
  countryColumn: string,
  stateColumn: string,
): Promise<GeoResult> {
  const rows = await runQuery(`
    SELECT
      TRY_CAST(${quoteIdentifier(latColumn)} AS DOUBLE) AS latitude,
      TRY_CAST(${quoteIdentifier(lonColumn)} AS DOUBLE) AS longitude
      ${countryColumn ? `, CAST(${quoteIdentifier(countryColumn)} AS VARCHAR) AS country_name` : ", NULL AS country_name"}
      ${stateColumn ? `, CAST(${quoteIdentifier(stateColumn)} AS VARCHAR) AS state_name` : ", NULL AS state_name"}
    FROM ${quoteIdentifier(tableName)}
    WHERE TRY_CAST(${quoteIdentifier(latColumn)} AS DOUBLE) IS NOT NULL
      AND TRY_CAST(${quoteIdentifier(lonColumn)} AS DOUBLE) IS NOT NULL
    LIMIT 500
  `);

  const samples = rows.flatMap<GeoSampleRow>((row) => {
    const latitude = toNumber(row.latitude);
    const longitude = toNumber(row.longitude);
    if (latitude == null || longitude == null) return [];
    return [
      {
        latitude,
        longitude,
        country: typeof row.country_name === "string" ? row.country_name : null,
        state: typeof row.state_name === "string" ? row.state_name : null,
      },
    ];
  });

  const zones = new Map<string, { count: number; latTotal: number; lonTotal: number }>();
  const distributions = new Map<string, number>();

  for (const sample of samples) {
    const zoneName = buildZoneName(sample.latitude, sample.longitude);
    const zone = zones.get(zoneName) ?? { count: 0, latTotal: 0, lonTotal: 0 };
    zone.count += 1;
    zone.latTotal += sample.latitude;
    zone.lonTotal += sample.longitude;
    zones.set(zoneName, zone);

    const regionLabel = sample.country ?? sample.state ?? "Unknown region";
    distributions.set(regionLabel, (distributions.get(regionLabel) ?? 0) + 1);
  }

  return {
    recordCount: samples.length,
    zones: [...zones.entries()]
      .map<ZoneSummary>(([zone, summary]) => ({
        zone,
        count: summary.count,
        avgLat: summary.latTotal / summary.count,
        avgLon: summary.lonTotal / summary.count,
      }))
      .sort((left, right) => right.count - left.count || left.zone.localeCompare(right.zone)),
    distributions: [...distributions.entries()]
      .map<DistributionRow>(([label, count]) => ({ label, count }))
      .sort((left, right) => right.count - left.count || left.label.localeCompare(right.label))
      .slice(0, 10),
  };
}

export default function GeographicAnalysis({
  tableName,
  columns,
}: GeographicAnalysisProps) {
  const detectedLat = useMemo(
    () => detectCoordinateColumn(columns, ["latitude", "lat"]),
    [columns],
  );
  const detectedLon = useMemo(
    () => detectCoordinateColumn(columns, ["longitude", "lon", "lng"]),
    [columns],
  );
  const detectedCountry = useMemo(
    () => detectCoordinateColumn(columns, ["country"]),
    [columns],
  );
  const detectedState = useMemo(
    () => detectCoordinateColumn(columns, ["state", "province", "region"]),
    [columns],
  );
  const [latColumn, setLatColumn] = useState(detectedLat);
  const [lonColumn, setLonColumn] = useState(detectedLon);
  const [countryColumn, setCountryColumn] = useState(detectedCountry);
  const [stateColumn, setStateColumn] = useState(detectedState);
  const [result, setResult] = useState<GeoResult | null>(null);
  const [status, setStatus] = useState(
    "Auto-detect latitude and longitude columns, then compute zone and regional summaries.",
  );
  const [loading, setLoading] = useState(false);

  async function handleAnalyze() {
    if (!latColumn || !lonColumn) {
      setStatus("Latitude and longitude columns are required for geographic analysis.");
      return;
    }

    setLoading(true);
    setStatus("Analyzing geographic distribution...");

    try {
      const nextResult = await runGeographicAnalysis(
        tableName,
        latColumn,
        lonColumn,
        countryColumn,
        stateColumn,
      );
      startTransition(() => {
        setResult(nextResult);
        setStatus(
          `Grouped ${formatNumber(nextResult.recordCount)} coordinates into ${formatNumber(nextResult.zones.length)} geographic zones.`,
        );
      });
    } catch (error) {
      setStatus(
        error instanceof Error ? error.message : "Unable to analyze geographic fields.",
      );
    } finally {
      setLoading(false);
    }
  }

  function handleExport() {
    if (!result) return;
    downloadFile(
      toCsv(result),
      `${tableName}-geographic-analysis.csv`,
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
      <div className="flex flex-col gap-4 border-b border-white/20 pb-5 dark:border-white/10 xl:flex-row xl:items-center xl:justify-between">
        <div className="space-y-2">
          <div className="inline-flex items-center gap-2 rounded-full border border-sky-500/20 bg-sky-500/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.2em] text-sky-700 dark:text-sky-300">
            <MapPinned className="h-3.5 w-3.5" />
            Geographic Analysis
          </div>
          <div>
            <h2 className="text-2xl font-semibold text-slate-950 dark:text-white">
              Summarize spatial coverage by coordinate zones and available regions
            </h2>
            <p className="text-sm text-slate-600 dark:text-slate-300">
              Detect coordinate fields, group them into broad geographic zones,
              and surface the strongest country or state distributions.
            </p>
          </div>
        </div>

        <div className="flex flex-wrap gap-3">
          <button
            type="button"
            onClick={() => {
              void handleAnalyze();
            }}
            disabled={loading}
            className={`${BUTTON_CLASS} bg-sky-600 text-white hover:bg-sky-500 dark:bg-sky-600 dark:text-white`}
          >
            {loading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Globe2 className="h-4 w-4" />
            )}
            Analyze geography
          </button>
          <button
            type="button"
            onClick={handleExport}
            disabled={!result}
            className={BUTTON_CLASS}
          >
            <Download className="h-4 w-4" />
            Export analysis CSV
          </button>
        </div>
      </div>

      <div className="mt-4 rounded-2xl bg-white/60 px-4 py-3 text-sm text-slate-600 dark:bg-slate-900/40 dark:text-slate-300">
        {status}
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-[0.88fr_1.12fr]">
        <div className="space-y-6">
          <div className={`${GLASS_CARD_CLASS} p-5`}>
            <div className="grid gap-3 md:grid-cols-2">
              <select
                aria-label="Latitude column"
                value={latColumn}
                onChange={(event) => setLatColumn(event.currentTarget.value)}
                className={FIELD_CLASS}
              >
                <option value="">Latitude column</option>
                {columns.map((column) => (
                  <option key={column.name} value={column.name}>
                    {column.name}
                  </option>
                ))}
              </select>
              <select
                aria-label="Longitude column"
                value={lonColumn}
                onChange={(event) => setLonColumn(event.currentTarget.value)}
                className={FIELD_CLASS}
              >
                <option value="">Longitude column</option>
                {columns.map((column) => (
                  <option key={column.name} value={column.name}>
                    {column.name}
                  </option>
                ))}
              </select>
              <select
                aria-label="Country column"
                value={countryColumn}
                onChange={(event) => setCountryColumn(event.currentTarget.value)}
                className={FIELD_CLASS}
              >
                <option value="">Country column</option>
                {columns.map((column) => (
                  <option key={column.name} value={column.name}>
                    {column.name}
                  </option>
                ))}
              </select>
              <select
                aria-label="State column"
                value={stateColumn}
                onChange={(event) => setStateColumn(event.currentTarget.value)}
                className={FIELD_CLASS}
              >
                <option value="">State column</option>
                {columns.map((column) => (
                  <option key={column.name} value={column.name}>
                    {column.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <SummaryCard
              label="Detected Coordinates"
              value={result ? formatNumber(result.recordCount) : "0"}
            />
            <SummaryCard
              label="Zones"
              value={result ? formatNumber(result.zones.length) : "0"}
            />
          </div>
        </div>

        <div className="space-y-6">
          <div className={`${GLASS_CARD_CLASS} overflow-hidden`}>
            <div className="border-b border-white/15 px-5 py-4 font-semibold text-slate-950 dark:text-white">
              Zone summaries
            </div>
            {result ? (
              <table className="min-w-full text-left text-sm">
                <thead className="bg-white/50 dark:bg-slate-950/20">
                  <tr className="text-slate-500 dark:text-slate-400">
                    <th className="px-5 py-3 font-medium">Zone</th>
                    <th className="px-5 py-3 font-medium">Count</th>
                    <th className="px-5 py-3 font-medium">Avg lat / lon</th>
                  </tr>
                </thead>
                <tbody>
                  {result.zones.map((zone) => (
                    <tr key={zone.zone} className="border-t border-white/10 text-slate-700 dark:text-slate-200">
                      <td className="px-5 py-3">{zone.zone}</td>
                      <td className="px-5 py-3">{formatNumber(zone.count)}</td>
                      <td className="px-5 py-3">
                        {zone.avgLat.toFixed(2)} / {zone.avgLon.toFixed(2)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <div className="px-5 py-10 text-sm text-slate-500 dark:text-slate-400">
                Analyze the dataset to summarize spatial zones.
              </div>
            )}
          </div>

          <div className={`${GLASS_CARD_CLASS} overflow-hidden`}>
            <div className="border-b border-white/15 px-5 py-4 font-semibold text-slate-950 dark:text-white">
              Country / state distribution
            </div>
            {result ? (
              <table className="min-w-full text-left text-sm">
                <thead className="bg-white/50 dark:bg-slate-950/20">
                  <tr className="text-slate-500 dark:text-slate-400">
                    <th className="px-5 py-3 font-medium">Region</th>
                    <th className="px-5 py-3 font-medium">Count</th>
                  </tr>
                </thead>
                <tbody>
                  {result.distributions.map((row) => (
                    <tr key={row.label} className="border-t border-white/10 text-slate-700 dark:text-slate-200">
                      <td className="px-5 py-3">{row.label}</td>
                      <td className="px-5 py-3">{formatNumber(row.count)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <div className="px-5 py-10 text-sm text-slate-500 dark:text-slate-400">
                Regional distributions appear after coordinate analysis runs.
              </div>
            )}
          </div>
        </div>
      </div>
    </motion.section>
  );
}
