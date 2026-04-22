"use client";

import { useEffect, useMemo, useState } from "react";
import type { EChartsOption } from "echarts";
import * as echarts from "echarts";
import ReactECharts from "echarts-for-react";
import { motion } from "framer-motion";
import {
  Globe2,
  Loader2,
  MapPinned,
  Sparkles,
  TriangleAlert,
} from "lucide-react";
import { runQuery } from "@/lib/duckdb/client";
import { formatNumber } from "@/lib/utils/formatters";
import { buildMetricExpression, quoteIdentifier } from "@/lib/utils/sql";
import type { ColumnProfile } from "@/types/dataset";

interface GeoChartProps {
  tableName: string;
  columns: ColumnProfile[];
}

type Aggregation = "COUNT" | "SUM" | "AVG" | "MIN" | "MAX";
type GeoMode =
  | { kind: "coordinates"; latitudeColumn: string; longitudeColumn: string }
  | { kind: "country"; locationColumn: string }
  | { kind: "state"; locationColumn: string }
  | null;

interface GeoPoint {
  name: string;
  longitude: number;
  latitude: number;
  value: number;
}

const ease = [0.22, 1, 0.36, 1] as const;
const panelClass =
  "overflow-hidden rounded-[28px] border border-white/20 bg-white/75 shadow-[0_24px_90px_-48px_rgba(15,23,42,0.75)] backdrop-blur-2xl dark:border-white/10 dark:bg-slate-950/45";
const fieldClass =
  "w-full rounded-2xl border border-slate-200/70 bg-white/85 px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-cyan-400 focus:ring-4 focus:ring-cyan-500/10 dark:border-slate-700/70 dark:bg-slate-950/65 dark:text-slate-100";
const WORLD_MAP = "datalens-world-frame";
const USA_MAP = "datalens-usa-frame";

const WORLD_FRAME = {
  type: "FeatureCollection",
  features: [{ type: "Feature", properties: { name: "World" }, geometry: { type: "Polygon", coordinates: [[[-180, -85], [180, -85], [180, 85], [-180, 85], [-180, -85]]] } }],
} as unknown as Parameters<typeof echarts.registerMap>[1];

const USA_FRAME = {
  type: "FeatureCollection",
  features: [{ type: "Feature", properties: { name: "United States" }, geometry: { type: "Polygon", coordinates: [[[-125, 24], [-66, 24], [-66, 50], [-125, 50], [-125, 24]]] } }],
} as unknown as Parameters<typeof echarts.registerMap>[1];
function parseCentroids(value: string) {
  return Object.fromEntries(
    value.split(";").map((item) => {
      const [name, longitude, latitude] = item.split("|");
      return [name, { longitude: Number(longitude), latitude: Number(latitude) }];
    }),
  ) as Record<string, { longitude: number; latitude: number }>;
}

const COUNTRY_CENTROIDS = parseCentroids(
  "united states|-98.5795|39.8283;usa|-98.5795|39.8283;canada|-106.3468|56.1304;mexico|-102.5528|23.6345;brazil|-51.9253|-14.235;argentina|-63.6167|-38.4161;united kingdom|-3.436|55.3781;uk|-3.436|55.3781;ireland|-8.2439|53.4129;france|2.2137|46.2276;germany|10.4515|51.1657;spain|-3.7492|40.4637;italy|12.5674|41.8719;netherlands|5.2913|52.1326;belgium|4.4699|50.5039;switzerland|8.2275|46.8182;poland|19.1451|51.9194;sweden|18.6435|60.1282;norway|8.4689|60.472;finland|25.7482|61.9241;denmark|9.5018|56.2639;portugal|-8.2245|39.3999;turkey|35.2433|38.9637;ukraine|31.1656|48.3794;russia|105.3188|61.524;australia|133.7751|-25.2744;new zealand|174.886|-40.9006;india|78.9629|20.5937;china|104.1954|35.8617;japan|138.2529|36.2048;south korea|127.7669|35.9078;indonesia|113.9213|-0.7893;singapore|103.8198|1.3521;thailand|100.9925|15.87;vietnam|108.2772|14.0583;philippines|121.774|12.8797;malaysia|101.9758|4.2105;pakistan|69.3451|30.3753;saudi arabia|45.0792|23.8859;united arab emirates|53.8478|23.4241;uae|53.8478|23.4241;israel|34.8516|31.0461;south africa|22.9375|-30.5595;nigeria|8.6753|9.082;egypt|30.8025|26.8206;kenya|37.9062|-0.0236;morocco|-7.0926|31.7917;chile|-71.543| -35.6751;colombia|-74.2973|4.5709;peru|-75.0152|-9.19",
);

const STATE_CENTROIDS = parseCentroids(
  "alabama|-86.7911|32.8067;al|-86.7911|32.8067;alaska|-152.4044|61.3707;ak|-152.4044|61.3707;arizona|-111.4312|33.7298;az|-111.4312|33.7298;arkansas|-92.3731|34.9697;ar|-92.3731|34.9697;california|-119.6816|36.1162;ca|-119.6816|36.1162;colorado|-105.3111|39.0598;co|-105.3111|39.0598;connecticut|-72.7554|41.5978;ct|-72.7554|41.5978;delaware|-75.5071|39.3185;de|-75.5071|39.3185;district of columbia|-77.0369|38.9072;dc|-77.0369|38.9072;florida|-81.6868|27.7663;fl|-81.6868|27.7663;georgia|-83.6431|33.0406;ga|-83.6431|33.0406;hawaii|-157.4983|21.0943;hi|-157.4983|21.0943;idaho|-114.4788|44.2405;id|-114.4788|44.2405;illinois|-88.9861|40.3495;il|-88.9861|40.3495;indiana|-86.2583|39.8494;in|-86.2583|39.8494;iowa|-93.2105|42.0115;ia|-93.2105|42.0115;kansas|-96.7265|38.5266;ks|-96.7265|38.5266;kentucky|-84.6701|37.6681;ky|-84.6701|37.6681;louisiana|-91.8678|31.1695;la|-91.8678|31.1695;maine|-69.3819|44.6939;me|-69.3819|44.6939;maryland|-76.8021|39.0639;md|-76.8021|39.0639;massachusetts|-71.5301|42.2302;ma|-71.5301|42.2302;michigan|-84.5361|43.3266;mi|-84.5361|43.3266;minnesota|-93.9002|45.6945;mn|-93.9002|45.6945;mississippi|-89.6787|32.7416;ms|-89.6787|32.7416;missouri|-92.2884|38.4561;mo|-92.2884|38.4561;montana|-110.4544|46.9219;mt|-110.4544|46.9219;nebraska|-98.2681|41.1254;ne|-98.2681|41.1254;nevada|-117.0554|38.3135;nv|-117.0554|38.3135;new hampshire|-71.5639|43.4525;nh|-71.5639|43.4525;new jersey|-74.521|40.2989;nj|-74.521|40.2989;new mexico|-106.2485|34.8405;nm|-106.2485|34.8405;new york|-74.9481|42.1657;ny|-74.9481|42.1657;north carolina|-79.8064|35.6301;nc|-79.8064|35.6301;north dakota|-99.784|47.5289;nd|-99.784|47.5289;ohio|-82.7649|40.3888;oh|-82.7649|40.3888;oklahoma|-96.9289|35.5653;ok|-96.9289|35.5653;oregon|-122.0709|44.572;or|-122.0709|44.572;pennsylvania|-77.2098|40.5908;pa|-77.2098|40.5908;rhode island|-71.5118|41.6809;ri|-71.5118|41.6809;south carolina|-80.945|33.8569;sc|-80.945|33.8569;south dakota|-99.4388|44.2998;sd|-99.4388|44.2998;tennessee|-86.6923|35.7478;tn|-86.6923|35.7478;texas|-97.5635|31.0545;tx|-97.5635|31.0545;utah|-111.8624|40.15;ut|-111.8624|40.15;vermont|-72.7107|44.0459;vt|-72.7107|44.0459;virginia|-78.1699|37.7693;va|-78.1699|37.7693;washington|-121.4905|47.4009;wa|-121.4905|47.4009;west virginia|-80.9545|38.4912;wv|-80.9545|38.4912;wisconsin|-89.6165|44.2685;wi|-89.6165|44.2685;wyoming|-107.3025|42.756;wy|-107.3025|42.756",
);

function normalizeGeoName(value: unknown) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/\./g, "")
    .replace(/\s+/g, " ");
}

function registerMaps() {
  if (!echarts.getMap(WORLD_MAP)) echarts.registerMap(WORLD_MAP, WORLD_FRAME);
  if (!echarts.getMap(USA_MAP)) echarts.registerMap(USA_MAP, USA_FRAME);
}

function detectGeoMode(columns: ColumnProfile[]): GeoMode {
  const latitudeColumn = columns.find((column) => /(lat|latitude)/i.test(column.name) && column.type === "number");
  const longitudeColumn = columns.find((column) => /(lon|lng|longitude)/i.test(column.name) && column.type === "number");
  if (latitudeColumn && longitudeColumn) return { kind: "coordinates", latitudeColumn: latitudeColumn.name, longitudeColumn: longitudeColumn.name };
  const countryColumn = columns.find((column) => /(country|nation)/i.test(column.name));
  if (countryColumn) return { kind: "country", locationColumn: countryColumn.name };
  const stateColumn = columns.find((column) => /(state|province|territory|region)/i.test(column.name));
  if (stateColumn) return { kind: "state", locationColumn: stateColumn.name };
  return null;
}

function buildOption(points: GeoPoint[], mode: GeoMode, aggregation: Aggregation, dark: boolean): EChartsOption {
  const values = points.map((point) => point.value);
  const maxValue = Math.max(...values, 1);
  const minValue = Math.min(...values, 0);
  const mapName = mode?.kind === "state" ? USA_MAP : WORLD_MAP;
  const textColor = dark ? "#cbd5e1" : "#334155";
  const borderColor = dark ? "#1e293b" : "#cbd5e1";

  return {
    animationDuration: 520,
    tooltip: {
      trigger: "item",
      backgroundColor: dark ? "#0f172ae6" : "#ffffffe8",
      borderColor,
      textStyle: { color: dark ? "#f8fafc" : "#0f172a" },
      formatter: (params: unknown) => {
        const item = params as { name?: string; value?: [number, number, number] };
        return `${item.name ?? "Unknown"}<br/>${aggregation}: ${formatNumber(Number(item.value?.[2] ?? 0))}`;
      },
    },
    visualMap: {
      min: minValue,
      max: maxValue,
      orient: "horizontal",
      left: "center",
      bottom: 8,
      text: ["High", "Low"],
      textStyle: { color: textColor },
      calculable: true,
      inRange: { color: ["#0ea5e9", "#22c55e", "#f59e0b", "#ef4444"] },
    },
    geo: {
      map: mapName,
      roam: true,
      itemStyle: { areaColor: dark ? "#0f172a" : "#eff6ff", borderColor },
      emphasis: { itemStyle: { areaColor: dark ? "#172554" : "#dbeafe" } },
      layoutCenter: ["50%", "48%"],
      layoutSize: mode?.kind === "state" ? "115%" : "130%",
      silent: true,
    },
    series: [
      {
        name: aggregation,
        type: "scatter",
        coordinateSystem: "geo",
        data: points.map((point) => ({ name: point.name, value: [point.longitude, point.latitude, point.value] })),
        symbolSize: (value: number[]) => 8 + (Math.max(value[2], 0) / Math.max(maxValue, 1)) * 18,
        itemStyle: { borderColor: dark ? "#020617" : "#ffffff", borderWidth: 1, opacity: 0.88 },
        emphasis: { scale: true },
      },
    ],
  };
}

function DetectionSummary({
  mode,
  aggregation,
  valueColumn,
  points,
}: {
  mode: Exclude<GeoMode, null>;
  aggregation: Aggregation;
  valueColumn: string;
  points: GeoPoint[];
}) {
  const lines =
    mode.kind === "coordinates"
      ? [`Latitude: ${mode.latitudeColumn}`, `Longitude: ${mode.longitudeColumn}`, `Grouped points: ${formatNumber(points.length)}`]
      : [`Location key: ${mode.locationColumn}`, `Metric: ${aggregation}${valueColumn && aggregation !== "COUNT" ? `(${valueColumn})` : ""}`, `Mapped regions: ${formatNumber(points.length)}`];
  return (
    <div className="rounded-2xl border border-cyan-400/20 bg-cyan-500/10 px-4 py-3 text-sm text-cyan-900 dark:text-cyan-200">
      <p className="font-semibold">{mode.kind === "coordinates" ? "Coordinate scatter" : "Region intensity map"}</p>
      <div className="mt-2 flex flex-wrap gap-2">
        {lines.map((line) => <span key={line} className="rounded-full bg-white/65 px-2.5 py-1 text-xs font-medium text-cyan-800 dark:bg-slate-950/45 dark:text-cyan-200">{line}</span>)}
      </div>
    </div>
  );
}

function TopLocations({ points }: { points: GeoPoint[] }) {
  const topPoints = [...points].sort((left, right) => right.value - left.value).slice(0, 5);
  return (
    <div className="rounded-2xl border border-slate-200/70 bg-slate-50/80 px-4 py-4 dark:border-slate-800 dark:bg-slate-900/30">
      <p className="text-sm font-semibold text-slate-900 dark:text-white">Top plotted locations</p>
      <div className="mt-3 space-y-2">
        {topPoints.length === 0 ? <p className="text-sm text-slate-500 dark:text-slate-400">No mapped points yet.</p> : topPoints.map((point) => <div key={point.name} className="flex items-center justify-between gap-3 text-sm"><span className="truncate text-slate-700 dark:text-slate-200">{point.name}</span><span className="shrink-0 text-slate-500 dark:text-slate-400">{formatNumber(point.value)}</span></div>)}
      </div>
    </div>
  );
}

function MapNotes() {
  return (
    <div className="rounded-2xl border border-slate-200/70 bg-white/70 px-4 py-4 dark:border-slate-800 dark:bg-slate-950/35">
      <p className="text-sm font-semibold text-slate-900 dark:text-white">Map notes</p>
      <p className="mt-2 text-sm leading-6 text-slate-600 dark:text-slate-300">This component is intentionally offline-safe, so it renders on compact built-in geo frames and projects region values to centroids when full polygon packs are not available in the bundle.</p>
    </div>
  );
}

export default function GeoChart({ tableName, columns }: GeoChartProps) {
  const [dark, setDark] = useState(false);
  const numericColumns = useMemo(() => columns.filter((column) => column.type === "number"), [columns]);
  const detectedMode = useMemo(() => detectGeoMode(columns), [columns]);
  const [mode, setMode] = useState<GeoMode>(detectedMode);
  const [aggregation, setAggregation] = useState<Aggregation>("COUNT");
  const [valueColumn, setValueColumn] = useState(numericColumns[0]?.name ?? "");
  const [points, setPoints] = useState<GeoPoint[]>([]);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    registerMaps();
    const sync = () => setDark(document.documentElement.classList.contains("dark"));
    sync();
    const observer = new MutationObserver(sync);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    setMode(detectedMode);
    setValueColumn((current) => numericColumns.some((column) => column.name === current) ? current : numericColumns[0]?.name ?? "");
  }, [detectedMode, numericColumns]);

  useEffect(() => {
    if (!mode) {
      setPoints([]);
      setMessage("No geographic columns detected. Add a country, state, or latitude/longitude pair to render a map.");
      return;
    }
    const activeMode = mode as Exclude<GeoMode, null>;
    let cancelled = false;

    async function loadData() {
      setLoading(true);
      setMessage(null);
      try {
        const metric = buildMetricExpression(aggregation, valueColumn || undefined, quoteIdentifier);
        const rows =
          activeMode.kind === "coordinates"
            ? await runQuery(`SELECT CAST(${quoteIdentifier(activeMode.longitudeColumn)} AS DOUBLE) AS longitude, CAST(${quoteIdentifier(activeMode.latitudeColumn)} AS DOUBLE) AS latitude, ${metric} AS metric_value FROM ${quoteIdentifier(tableName)} WHERE ${quoteIdentifier(activeMode.latitudeColumn)} IS NOT NULL AND ${quoteIdentifier(activeMode.longitudeColumn)} IS NOT NULL GROUP BY 1, 2 ORDER BY metric_value DESC LIMIT 500`)
            : await runQuery(`SELECT CAST(${quoteIdentifier(activeMode.locationColumn)} AS VARCHAR) AS location_name, ${metric} AS metric_value FROM ${quoteIdentifier(tableName)} WHERE ${quoteIdentifier(activeMode.locationColumn)} IS NOT NULL GROUP BY 1 ORDER BY metric_value DESC LIMIT 250`);

        const geoRows =
          activeMode.kind === "coordinates"
            ? rows.map((row) => ({
                name: `${Number(row.latitude ?? 0).toFixed(3)}, ${Number(row.longitude ?? 0).toFixed(3)}`,
                latitude: Number(row.latitude ?? 0),
                longitude: Number(row.longitude ?? 0),
                value: Number(row.metric_value ?? 0),
              }))
            : rows.flatMap((row) => {
                const name = String(row.location_name ?? "");
                const lookup = activeMode.kind === "country" ? COUNTRY_CENTROIDS[normalizeGeoName(name)] : STATE_CENTROIDS[normalizeGeoName(name)];
                return lookup ? [{ name, latitude: lookup.latitude, longitude: lookup.longitude, value: Number(row.metric_value ?? 0) }] : [];
              });

        if (cancelled) return;
        setPoints(geoRows);
        if (!geoRows.length) setMessage(activeMode.kind === "country" || activeMode.kind === "state" ? "Geographic column detected, but none of the sampled values matched the built-in location reference used by this offline map." : "No coordinate rows were available after filtering null latitude and longitude values.");
      } catch (cause) {
        if (cancelled) return;
        setPoints([]);
        setMessage(cause instanceof Error ? cause.message : "Unable to build the geographic query.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void loadData();
    return () => {
      cancelled = true;
    };
  }, [aggregation, mode, tableName, valueColumn]);

  if (!detectedMode) {
    return (
      <motion.section initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.35, ease }} className={`${panelClass} p-6`}>
        <div className="flex min-h-[320px] flex-col items-center justify-center gap-4 text-center">
          <TriangleAlert className="h-10 w-10 text-amber-500" />
          <div className="space-y-2">
            <h2 className="text-lg font-semibold text-slate-900 dark:text-white">Geo chart needs location data</h2>
            <p className="max-w-xl text-sm leading-6 text-slate-600 dark:text-slate-300">Use a country column, a state column, or a latitude/longitude pair. Common names such as `country`, `state`, `latitude`, and `longitude` are auto-detected.</p>
          </div>
        </div>
      </motion.section>
    );
  }

  return (
    <motion.section initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.35, ease }} className={panelClass}>
      <div className="border-b border-white/15 px-6 py-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="space-y-2">
            <div className="inline-flex items-center gap-2 rounded-full border border-cyan-400/30 bg-cyan-500/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-cyan-700 dark:border-cyan-500/20 dark:text-cyan-300"><MapPinned className="h-3.5 w-3.5" />Geo chart</div>
            <h2 className="text-xl font-semibold text-slate-900 dark:text-white">Geographic view for {tableName}</h2>
            <p className="max-w-3xl text-sm leading-6 text-slate-600 dark:text-slate-300">Auto-detected {detectedMode.kind === "coordinates" ? "latitude/longitude columns" : `${detectedMode.kind} location names`} and mapped them into an offline-safe ECharts geo canvas.</p>
          </div>
          <div className="inline-flex items-center gap-2 rounded-full bg-slate-900/5 px-3 py-2 text-sm text-slate-700 dark:bg-white/5 dark:text-slate-300"><Sparkles className="h-4 w-4 text-cyan-500" />{points.length ? `${formatNumber(points.length)} plotted locations` : "Waiting for data"}</div>
        </div>
      </div>

      <div className="grid gap-5 px-6 py-6 xl:grid-cols-[0.75fr_1.25fr]">
        <div className="space-y-4 rounded-[26px] border border-slate-200/70 bg-white/65 p-5 dark:border-slate-800 dark:bg-slate-950/40">
          {detectedMode.kind !== "coordinates" && (
            <select value={mode?.kind ?? detectedMode.kind} onChange={(event) => setMode(event.target.value === "country" ? { kind: "country", locationColumn: detectedMode.locationColumn } : { kind: "state", locationColumn: detectedMode.locationColumn })} className={fieldClass}>
              <option value="country">Country map</option>
              <option value="state">State map</option>
            </select>
          )}
          <select value={aggregation} onChange={(event) => setAggregation(event.target.value as Aggregation)} className={fieldClass}>
            {["COUNT", "SUM", "AVG", "MIN", "MAX"].map((item) => <option key={item} value={item}>{item}</option>)}
          </select>
          <select value={valueColumn} onChange={(event) => setValueColumn(event.target.value)} disabled={aggregation === "COUNT" || !numericColumns.length} className={fieldClass}>
            {numericColumns.length ? numericColumns.map((column) => <option key={column.name} value={column.name}>{column.name}</option>) : <option value="">No numeric value column</option>}
          </select>

          <DetectionSummary mode={(mode ?? detectedMode) as Exclude<GeoMode, null>} aggregation={aggregation} valueColumn={valueColumn} points={points} />

          {message && <div className="rounded-2xl border border-amber-400/35 bg-amber-500/10 px-4 py-3 text-sm text-amber-800 dark:text-amber-200">{message}</div>}
          <TopLocations points={points} />
          <MapNotes />

          <div className="rounded-2xl border border-slate-200/70 bg-slate-50/80 px-4 py-4 dark:border-slate-800 dark:bg-slate-900/30">
            <p className="text-sm font-semibold text-slate-900 dark:text-white">Requirements</p>
            <ul className="mt-3 space-y-2 text-sm leading-6 text-slate-600 dark:text-slate-300">
              <li>Country and state columns are matched against a built-in offline location dictionary.</li>
              <li>Latitude and longitude columns are grouped directly on their numeric coordinates.</li>
              <li>Tooltips and color scale update from the selected aggregation.</li>
            </ul>
          </div>
        </div>

        <div className="rounded-[26px] border border-slate-200/70 bg-white/70 p-4 dark:border-slate-800 dark:bg-slate-950/40">
          <div className="mb-3 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2 text-sm font-semibold text-slate-900 dark:text-white"><Globe2 className="h-4 w-4 text-cyan-500" />Map preview</div>
            {loading && <Loader2 className="h-4 w-4 animate-spin text-cyan-500" />}
          </div>
          {points.length ? (
            <ReactECharts option={buildOption(points, mode, aggregation, dark)} style={{ height: 460, width: "100%" }} notMerge lazyUpdate opts={{ renderer: "svg" }} />
          ) : (
            <div className="flex h-[460px] items-center justify-center rounded-2xl border border-dashed border-slate-300/80 text-sm text-slate-500 dark:border-slate-700 dark:text-slate-400">
              {loading ? "Loading map data..." : "No mapped locations available for the current settings."}
            </div>
          )}
        </div>
      </div>
    </motion.section>
  );
}
