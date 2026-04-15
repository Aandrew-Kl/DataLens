"use client";

import { quoteIdentifier } from "@/lib/utils/sql";
import { motion } from "framer-motion";
import {
  Calculator,
  ChevronDown,
  ChevronRight,
  Database,
  Download,
  Filter,
  GripVertical,
  LayoutGrid,
  Plus,
  Save,
  Table2,
  Trash2,
} from "lucide-react";
import {
  Fragment,
  startTransition,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { runQuery } from "@/lib/duckdb/client";
import { downloadFile } from "@/lib/utils/export";
import { generateId } from "@/lib/utils/formatters";
import type { ColumnProfile } from "@/types/dataset";

interface PivotConfiguratorProps {
  tableName: string;
  columns: ColumnProfile[];
}

type AggFn = "SUM" | "AVG" | "COUNT" | "MIN" | "MAX" | "MEDIAN" | "STDEV";
type DropZoneKind = "rows" | "columns" | "values" | "filters";
type FilterOperator = "equals" | "not_equals";
type ConditionalOperator = "gt" | "lt" | "between";

interface ValueField {
  id: string;
  column: string;
  aggregation: AggFn;
  alias: string;
}

interface PivotFilter {
  id: string;
  column: string;
  operator: FilterOperator;
  value: string;
}

interface CalculatedField {
  id: string;
  name: string;
  formula: string;
}

interface ConditionalRule {
  id: string;
  measure: string;
  operator: ConditionalOperator;
  value: string;
  secondValue: string;
  color: string;
}

interface PivotResult {
  rowKeys: string[];
  rowLabels: Map<string, string[]>;
  colKeys: string[];
  colLabels: Map<string, string[]>;
  cells: Map<string, Record<string, number>>;
  rowTotals: Map<string, Record<string, number>>;
  colTotals: Map<string, Record<string, number>>;
  groupSubtotals: Map<string, Record<string, number>>;
  grandTotals: Record<string, number>;
  measures: string[];
}

interface SavedPivotConfig {
  id: string;
  name: string;
  rowFields: string[];
  columnFields: string[];
  valueFields: ValueField[];
  filters: PivotFilter[];
  calculatedFields: CalculatedField[];
  conditionalRules: ConditionalRule[];
  showSubtotals: boolean;
  showGrandTotals: boolean;
}

type NoticeTone = "success" | "error" | "info";

interface NoticeState {
  tone: NoticeTone;
  message: string;
}

const EASE = [0.22, 1, 0.36, 1] as const;
const PANEL_CLASS =
  "overflow-hidden rounded-[1.9rem] border border-white/20 bg-white/75 shadow-[0_24px_90px_-48px_rgba(15,23,42,0.75)] backdrop-blur-2xl dark:border-white/10 dark:bg-slate-950/45";
const FIELD_CLASS =
  "rounded-2xl border border-white/20 bg-white/80 px-4 py-3 text-sm text-slate-700 outline-none transition focus:border-cyan-400 focus:ring-4 focus:ring-cyan-500/10 dark:border-white/10 dark:bg-slate-950/50 dark:text-slate-100";
const STORAGE_PREFIX = "datalens:pivot-configurator";

const AGG_SQL: Record<AggFn, string> = {
  SUM: "SUM",
  AVG: "AVG",
  COUNT: "COUNT",
  MIN: "MIN",
  MAX: "MAX",
  MEDIAN: "MEDIAN",
  STDEV: "STDDEV_SAMP",
};
function quoteLiteral(value: string) {
  return `'${value.replaceAll("'", "''")}'`;
}

function sanitizeAlias(value: string) {
  const raw = value.trim().replace(/[^a-zA-Z0-9_]/g, "_");
  const prefixed = /^[a-zA-Z_]/.test(raw) ? raw : `m_${raw}`;
  return prefixed.replace(/_+/g, "_").replace(/^_+|_+$/g, "").slice(0, 48);
}

function cellKey(rowKey: string, colKey: string) {
  return `${rowKey}\u0000${colKey}`;
}

function readSavedConfigs(tableName: string) {
  if (typeof window === "undefined") return [] as SavedPivotConfig[];
  try {
    const raw = window.localStorage.getItem(`${STORAGE_PREFIX}:${tableName}`);
    return raw ? (JSON.parse(raw) as SavedPivotConfig[]) : [];
  } catch {
    return [] as SavedPivotConfig[];
  }
}

function writeSavedConfigs(tableName: string, configs: SavedPivotConfig[]) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(`${STORAGE_PREFIX}:${tableName}`, JSON.stringify(configs));
}

function csvEscape(value: unknown) {
  const text = String(value ?? "");
  return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function defaultValueField(columnName: string) {
  return {
    id: generateId(),
    column: columnName,
    aggregation: "COUNT",
    alias: sanitizeAlias(`count_${columnName || "rows"}`),
  } satisfies ValueField;
}

function buildFormulaSql(formula: string, aliases: Set<string>) {
  if (!/^[a-zA-Z0-9_+\-*/().\s]+$/.test(formula)) {
    throw new Error("Calculated fields only support arithmetic expressions and aliases.");
  }

  return formula.replace(/\b[a-zA-Z_][a-zA-Z0-9_]*\b/g, (token) => {
    if (!aliases.has(token)) {
      throw new Error(`Unknown measure alias "${token}" in calculated field.`);
    }
    return quoteIdentifier(token);
  });
}

function buildFilterClause(filters: PivotFilter[]) {
  const clauses = filters.flatMap((filter) => {
    const value = filter.value.trim();
    if (!filter.column || value === "") return [];
    const operator = filter.operator === "not_equals" ? "<>" : "=";
    return [`CAST(${quoteIdentifier(filter.column)} AS VARCHAR) ${operator} ${quoteLiteral(value)}`];
  });

  return clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
}

function buildPivotSql(
  tableName: string,
  rowFields: string[],
  columnFields: string[],
  valueFields: ValueField[],
  filters: PivotFilter[],
  calculatedFields: CalculatedField[],
) {
  const dimensionFields = [...rowFields, ...columnFields];
  const safeDimensions = dimensionFields.map(
    (field) => `CAST(${quoteIdentifier(field)} AS VARCHAR) AS ${quoteIdentifier(field)}`,
  );
  const safeMeasures = valueFields.map((field) => {
    const expression =
      field.aggregation === "COUNT"
        ? "COUNT(*)"
        : `${AGG_SQL[field.aggregation]}(TRY_CAST(${quoteIdentifier(field.column)} AS DOUBLE))`;
    return `${expression} AS ${quoteIdentifier(field.alias)}`;
  });
  const baseAliases = valueFields.map((field) => field.alias);
  const calculatedSelect = calculatedFields.map((field) => {
    const alias = sanitizeAlias(field.name);
    return `${buildFormulaSql(field.formula, new Set(baseAliases))} AS ${quoteIdentifier(alias)}`;
  });
  const filterClause = buildFilterClause(filters);
  const groupBy = safeDimensions.length > 0 ? `GROUP BY ${safeDimensions.map((_, index) => index + 1).join(", ")}` : "";
  const orderBy = safeDimensions.length > 0 ? `ORDER BY ${safeDimensions.map((_, index) => index + 1).join(", ")}` : "";

  const baseQuery = [
    "WITH pivot_base AS (",
    `SELECT ${[...safeDimensions, ...safeMeasures].join(", ")}`,
    `FROM ${quoteIdentifier(tableName)}`,
    filterClause,
    groupBy,
    orderBy,
    ")",
  ].join(" ");

  const outerColumns = [
    ...dimensionFields.map((field) => quoteIdentifier(field)),
    ...valueFields.map((field) => quoteIdentifier(field.alias)),
    ...calculatedSelect,
  ];

  return `${baseQuery} SELECT ${outerColumns.join(", ")} FROM pivot_base`;
}

function buildConditionalStyle(
  value: number,
  measure: string,
  rules: ConditionalRule[],
) {
  const matchedRule = rules.find((rule) => {
    if (rule.measure !== "__all__" && rule.measure !== measure) {
      return false;
    }
    const left = Number(rule.value);
    const right = Number(rule.secondValue);

    if (rule.operator === "gt") {
      return Number.isFinite(left) && value > left;
    }
    if (rule.operator === "lt") {
      return Number.isFinite(left) && value < left;
    }
    return Number.isFinite(left) && Number.isFinite(right) && value >= left && value <= right;
  });

  if (!matchedRule) return undefined;
  return {
    backgroundColor: `${matchedRule.color}33`,
    color: matchedRule.color,
  };
}

function NoticeBanner({ notice }: { notice: NoticeState | null }) {
  if (!notice) return null;

  const toneClass =
    notice.tone === "error"
      ? "border-rose-400/30 bg-rose-500/10 text-rose-700 dark:text-rose-300"
      : notice.tone === "success"
        ? "border-emerald-400/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
        : "border-cyan-400/30 bg-cyan-500/10 text-cyan-700 dark:text-cyan-300";

  return <div className={`rounded-2xl border px-4 py-3 text-sm ${toneClass}`}>{notice.message}</div>;
}

function DraggableColumn({
  column,
}: {
  column: ColumnProfile;
}) {
  function handleDragStart(event: React.DragEvent<HTMLButtonElement>) {
    event.dataTransfer.setData("text/plain", column.name);
    event.dataTransfer.effectAllowed = "copy";
  }

  return (
    <button
      type="button"
      draggable
      onDragStart={handleDragStart}
      className="flex items-center justify-between gap-3 rounded-2xl border border-white/15 bg-white/45 px-3 py-2 text-left text-sm text-slate-700 transition hover:border-cyan-300/40 dark:bg-slate-950/35 dark:text-slate-200"
    >
      <span className="truncate">{column.name}</span>
      <span className="shrink-0 rounded-full bg-white/70 px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500 dark:bg-slate-900/70 dark:text-slate-300">
        {column.type}
      </span>
    </button>
  );
}

function DropZone({
  title,
  kind,
  subtitle,
  onDropColumn,
  children,
}: {
  title: string;
  kind: DropZoneKind;
  subtitle: string;
  onDropColumn: (columnName: string, kind: DropZoneKind) => void;
  children: ReactNode;
}) {
  function handleDrop(event: React.DragEvent<HTMLDivElement>) {
    event.preventDefault();
    const columnName = event.dataTransfer.getData("text/plain");
    if (columnName) {
      onDropColumn(columnName, kind);
    }
  }

  return (
    <div
      onDragOver={(event) => event.preventDefault()}
      onDrop={handleDrop}
      className="rounded-[1.4rem] border border-dashed border-white/20 bg-white/35 p-4 dark:bg-slate-950/30"
    >
      <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
        <GripVertical className="h-3.5 w-3.5" />
        {title}
      </div>
      <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">{subtitle}</div>
      <div className="mt-4 space-y-3">{children}</div>
    </div>
  );
}

function ZonePill({
  label,
  onRemove,
}: {
  label: string;
  onRemove: () => void;
}) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-2xl border border-white/15 bg-white/55 px-3 py-2 text-sm text-slate-700 dark:bg-slate-950/35 dark:text-slate-200">
      <span className="truncate">{label}</span>
      <button
        type="button"
        onClick={onRemove}
        className="rounded-full border border-rose-300/30 bg-rose-500/10 p-1 text-rose-700 dark:text-rose-300"
      >
        <Trash2 className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

function PivotConfiguratorInner({ tableName, columns }: PivotConfiguratorProps) {
  const [rowFields, setRowFields] = useState<string[]>([]);
  const [columnFields, setColumnFields] = useState<string[]>([]);
  const [valueFields, setValueFields] = useState<ValueField[]>(
    columns[0]?.name ? [defaultValueField(columns[0].name)] : [],
  );
  const [filters, setFilters] = useState<PivotFilter[]>([]);
  const [calculatedFields, setCalculatedFields] = useState<CalculatedField[]>([]);
  const [conditionalRules, setConditionalRules] = useState<ConditionalRule[]>([]);
  const [calcName, setCalcName] = useState("");
  const [calcFormula, setCalcFormula] = useState("");
  const [ruleMeasure, setRuleMeasure] = useState("__all__");
  const [ruleOperator, setRuleOperator] = useState<ConditionalOperator>("gt");
  const [ruleValue, setRuleValue] = useState("");
  const [ruleSecondValue, setRuleSecondValue] = useState("");
  const [ruleColor, setRuleColor] = useState("#06b6d4");
  const [showSubtotals, setShowSubtotals] = useState(true);
  const [showGrandTotals, setShowGrandTotals] = useState(true);
  const [result, setResult] = useState<PivotResult | null>(null);
  const [collapsedGroups, setCollapsedGroups] = useState<string[]>([]);
  const [notice, setNotice] = useState<NoticeState | null>(null);
  const [loading, setLoading] = useState(false);
  const [savedConfigs, setSavedConfigs] = useState<SavedPivotConfig[]>(() =>
    readSavedConfigs(tableName),
  );
  const [configName, setConfigName] = useState("");

  const availableMeasures = useMemo(
    () => [
      ...valueFields.map((field) => field.alias),
      ...calculatedFields.map((field) => sanitizeAlias(field.name)),
    ],
    [calculatedFields, valueFields],
  );

  const displayColumns = useMemo(() => {
    if (!result) return [];
    return result.colKeys.flatMap((colKey) =>
      result.measures.map((measure) => ({ colKey, measure })),
    );
  }, [result]);

  const groupedRows = useMemo(() => {
    if (!result) return [] as Array<{ group: string; rows: string[] }>;
    const groups = new Map<string, string[]>();
    for (const rowKey of result.rowKeys) {
      const label = result.rowLabels.get(rowKey)?.[0] ?? rowKey;
      const bucket = groups.get(label) ?? [];
      bucket.push(rowKey);
      groups.set(label, bucket);
    }
    return Array.from(groups.entries()).map(([group, rows]) => ({ group, rows }));
  }, [result]);

  function applyConfig(config: SavedPivotConfig) {
    startTransition(() => {
      setRowFields(config.rowFields);
      setColumnFields(config.columnFields);
      setValueFields(config.valueFields);
      setFilters(config.filters);
      setCalculatedFields(config.calculatedFields);
      setConditionalRules(config.conditionalRules);
      setShowSubtotals(config.showSubtotals);
      setShowGrandTotals(config.showGrandTotals);
      setResult(null);
      setCollapsedGroups([]);
    });
    setNotice({ tone: "success", message: `Loaded "${config.name}".` });
  }

  function persistConfigs(nextConfigs: SavedPivotConfig[]) {
    setSavedConfigs(nextConfigs);
    writeSavedConfigs(tableName, nextConfigs);
  }

  function handleDropColumn(columnName: string, kind: DropZoneKind) {
    if (!columns.some((column) => column.name === columnName)) return;

    startTransition(() => {
      if (kind === "rows") {
        setRowFields((current) =>
          current.includes(columnName) ? current : [...current, columnName],
        );
      } else if (kind === "columns") {
        setColumnFields((current) =>
          current.includes(columnName) ? current : [...current, columnName],
        );
      } else if (kind === "values") {
        setValueFields((current) =>
          current.some((field) => field.column === columnName)
            ? current
            : [...current, defaultValueField(columnName)],
        );
      } else {
        setFilters((current) =>
          current.some((filter) => filter.column === columnName)
            ? current
            : [
                ...current,
                {
                  id: generateId(),
                  column: columnName,
                  operator: "equals",
                  value: "",
                },
              ],
        );
      }
    });
  }

  function addCalculatedField() {
    const name = sanitizeAlias(calcName);
    if (!name || !calcFormula.trim()) {
      setNotice({ tone: "error", message: "Calculated fields require both a name and a formula." });
      return;
    }

    setCalculatedFields((current) => [
      ...current,
      {
        id: generateId(),
        name,
        formula: calcFormula.trim(),
      },
    ]);
    setCalcName("");
    setCalcFormula("");
    setNotice({ tone: "success", message: `Added calculated field "${name}".` });
  }

  function addConditionalRule() {
    if (ruleValue.trim() === "") {
      setNotice({ tone: "error", message: "Conditional formatting needs at least one threshold value." });
      return;
    }

    if (ruleOperator === "between" && ruleSecondValue.trim() === "") {
      setNotice({ tone: "error", message: "Between rules need both lower and upper bounds." });
      return;
    }

    setConditionalRules((current) => [
      ...current,
      {
        id: generateId(),
        measure: ruleMeasure,
        operator: ruleOperator,
        value: ruleValue,
        secondValue: ruleSecondValue,
        color: ruleColor,
      },
    ]);
    setRuleValue("");
    setRuleSecondValue("");
  }

  async function runPivot() {
    if (rowFields.length === 0 && columnFields.length === 0) {
      setNotice({ tone: "error", message: "Drag at least one field into rows or columns." });
      return;
    }
    if (valueFields.length === 0) {
      setNotice({ tone: "error", message: "Add at least one value field." });
      return;
    }

    setLoading(true);
    setNotice(null);

    try {
      const sql = buildPivotSql(
        tableName,
        rowFields,
        columnFields,
        valueFields,
        filters,
        calculatedFields,
      );
      const rows = await runQuery(sql);
      const measures = [
        ...valueFields.map((field) => field.alias),
        ...calculatedFields.map((field) => sanitizeAlias(field.name)),
      ];
      const cells = new Map<string, Record<string, number>>();
      const rowLabels = new Map<string, string[]>();
      const colLabels = new Map<string, string[]>();
      const rowOrder: string[] = [];
      const colOrder: string[] = [];

      for (const row of rows) {
        const rowValues = rowFields.map((field) => String(row[field] ?? "(blank)"));
        const colValues = columnFields.map((field) => String(row[field] ?? "(blank)"));
        const rowKey = rowValues.join(" / ") || "All rows";
        const colKey = colValues.join(" / ") || "Values";

        if (!rowLabels.has(rowKey)) {
          rowLabels.set(rowKey, rowValues);
          rowOrder.push(rowKey);
        }
        if (!colLabels.has(colKey)) {
          colLabels.set(colKey, colValues);
          colOrder.push(colKey);
        }

        const measureValues = Object.fromEntries(
          measures.map((measure) => [measure, Number(row[measure] ?? 0)]),
        );
        cells.set(cellKey(rowKey, colKey), measureValues);
      }

      const rowTotals = new Map<string, Record<string, number>>();
      const colTotals = new Map<string, Record<string, number>>();
      const groupSubtotals = new Map<string, Record<string, number>>();
      const grandTotals = Object.fromEntries(measures.map((measure) => [measure, 0]));

      for (const rowKey of rowOrder) {
        const rowTotal = Object.fromEntries(measures.map((measure) => [measure, 0]));
        const rowGroup = rowLabels.get(rowKey)?.[0] ?? rowKey;
        const groupTotal =
          groupSubtotals.get(rowGroup) ??
          Object.fromEntries(measures.map((measure) => [measure, 0]));

        for (const colKey of colOrder) {
          const values =
            cells.get(cellKey(rowKey, colKey)) ??
            Object.fromEntries(measures.map((measure) => [measure, 0]));
          const colTotal =
            colTotals.get(colKey) ??
            Object.fromEntries(measures.map((measure) => [measure, 0]));

          for (const measure of measures) {
            rowTotal[measure] += values[measure] ?? 0;
            colTotal[measure] += values[measure] ?? 0;
            groupTotal[measure] += values[measure] ?? 0;
            grandTotals[measure] += values[measure] ?? 0;
          }

          colTotals.set(colKey, colTotal);
        }

        rowTotals.set(rowKey, rowTotal);
        groupSubtotals.set(rowGroup, groupTotal);
      }

      setCollapsedGroups([]);
      setResult({
        rowKeys: rowOrder,
        rowLabels,
        colKeys: colOrder,
        colLabels,
        cells,
        rowTotals,
        colTotals,
        groupSubtotals,
        grandTotals,
        measures,
      });
      setNotice({
        tone: "success",
        message: `Pivot returned ${rows.length} grouped row${rows.length === 1 ? "" : "s"}.`,
      });
    } catch (error) {
      setResult(null);
      setNotice({
        tone: "error",
        message: error instanceof Error ? error.message : "Pivot query failed.",
      });
    } finally {
      setLoading(false);
    }
  }

  function saveCurrentConfig() {
    const name = configName.trim();
    if (!name) {
      setNotice({ tone: "error", message: "Name the configuration before saving it." });
      return;
    }

    const nextConfig: SavedPivotConfig = {
      id: generateId(),
      name,
      rowFields,
      columnFields,
      valueFields,
      filters,
      calculatedFields,
      conditionalRules,
      showSubtotals,
      showGrandTotals,
    };

    const nextConfigs = [nextConfig, ...savedConfigs].slice(0, 12);
    persistConfigs(nextConfigs);
    setConfigName("");
    setNotice({ tone: "success", message: `Saved "${name}" to localStorage.` });
  }

  function deleteConfig(configId: string) {
    const nextConfigs = savedConfigs.filter((config) => config.id !== configId);
    persistConfigs(nextConfigs);
  }

  function exportPivotCsv() {
    if (!result) {
      setNotice({ tone: "error", message: "Run the pivot before exporting it." });
      return;
    }

    const lines: string[] = [];
    const header = [
      rowFields.join(" / ") || "Rows",
      ...displayColumns.map(({ colKey, measure }) => `${colKey} • ${measure}`),
      "Row total",
    ];
    lines.push(header.map(csvEscape).join(","));

    for (const group of groupedRows) {
      const collapsed = collapsedGroups.includes(group.group);
      const visibleRows = collapsed ? [] : group.rows;

      for (const rowKey of visibleRows) {
        const row: Array<string | number> = [rowKey];
        for (const column of displayColumns) {
          const cell = result.cells.get(cellKey(rowKey, column.colKey));
          row.push(cell?.[column.measure] ?? 0);
        }
        row.push(
          Object.values(result.rowTotals.get(rowKey) ?? {}).reduce(
            (sum, value) => sum + value,
            0,
          ),
        );
        lines.push(row.map(csvEscape).join(","));
      }

      if (showSubtotals) {
        lines.push(
          [
            `${group.group} subtotal`,
            ...displayColumns.map(
              ({ measure }) => result.groupSubtotals.get(group.group)?.[measure] ?? 0,
            ),
            Object.values(result.groupSubtotals.get(group.group) ?? {}).reduce(
              (sum, value) => sum + value,
              0,
            ),
          ]
            .map(csvEscape)
            .join(","),
        );
      }
    }

    if (showGrandTotals) {
      lines.push(
        [
          "Grand total",
          ...displayColumns.map(
            ({ colKey, measure }) => result.colTotals.get(colKey)?.[measure] ?? 0,
          ),
          Object.values(result.grandTotals).reduce((sum, value) => sum + value, 0),
        ]
          .map(csvEscape)
          .join(","),
      );
    }

    downloadFile(
      lines.join("\n"),
      `${tableName}-pivot-configured.csv`,
      "text/csv;charset=utf-8",
    );
    setNotice({ tone: "success", message: "Exported pivot as CSV." });
  }

  return (
    <section className={PANEL_CLASS}>
      <div className="border-b border-white/15 px-5 py-5">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
          <div>
            <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-cyan-600 dark:text-cyan-300">
              <LayoutGrid className="h-3.5 w-3.5" />
              Advanced pivot configurator
            </div>
            <h2 className="mt-2 text-xl font-semibold text-slate-950 dark:text-white">
              Drag fields into rows, columns, values, and filters
            </h2>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600 dark:text-slate-300">
              Combine multiple aggregations, saved layouts, calculated measures, row-group
              expansion, conditional formatting, and CSV export in one DuckDB-driven panel.
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => void runPivot()}
              className="inline-flex items-center gap-2 rounded-2xl bg-cyan-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-cyan-500"
            >
              <Database className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
              {loading ? "Running pivot" : "Run pivot"}
            </button>
            <button
              type="button"
              onClick={exportPivotCsv}
              className="inline-flex items-center gap-2 rounded-2xl border border-white/20 bg-white/55 px-4 py-2 text-sm text-slate-700 transition hover:border-cyan-300/40 dark:bg-slate-950/35 dark:text-slate-200"
            >
              <Download className="h-4 w-4" />
              Export CSV
            </button>
          </div>
        </div>
      </div>

      <div className="space-y-5 px-5 py-5">
        <NoticeBanner notice={notice} />

        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.36, ease: EASE }}
          className="grid gap-5 xl:grid-cols-[0.95fr_1.05fr]"
        >
          <div className="space-y-5">
            <div className="rounded-[1.6rem] border border-white/15 bg-white/45 p-4 dark:bg-slate-950/30">
              <div className="mb-4 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
                <Table2 className="h-3.5 w-3.5" />
                Available columns
              </div>
              <div className="grid gap-2 md:grid-cols-2">
                {columns.map((column) => (
                  <DraggableColumn key={column.name} column={column} />
                ))}
              </div>
            </div>

            <div className="grid gap-4 lg:grid-cols-2">
              <DropZone
                title="Rows"
                kind="rows"
                subtitle="Drop dimensions that should define row groups."
                onDropColumn={handleDropColumn}
              >
                {rowFields.length === 0 ? (
                  <p className="text-sm text-slate-500 dark:text-slate-400">No row fields yet.</p>
                ) : (
                  rowFields.map((field) => (
                    <ZonePill
                      key={field}
                      label={field}
                      onRemove={() =>
                        setRowFields((current) => current.filter((entry) => entry !== field))
                      }
                    />
                  ))
                )}
              </DropZone>

              <DropZone
                title="Columns"
                kind="columns"
                subtitle="Drop dimensions that should form column headers."
                onDropColumn={handleDropColumn}
              >
                {columnFields.length === 0 ? (
                  <p className="text-sm text-slate-500 dark:text-slate-400">No column fields yet.</p>
                ) : (
                  columnFields.map((field) => (
                    <ZonePill
                      key={field}
                      label={field}
                      onRemove={() =>
                        setColumnFields((current) =>
                          current.filter((entry) => entry !== field),
                        )
                      }
                    />
                  ))
                )}
              </DropZone>

              <DropZone
                title="Values"
                kind="values"
                subtitle="Drop numeric fields here, then configure multiple aggregations."
                onDropColumn={handleDropColumn}
              >
                {valueFields.length === 0 ? (
                  <p className="text-sm text-slate-500 dark:text-slate-400">No value fields yet.</p>
                ) : (
                  valueFields.map((field) => (
                    <div
                      key={field.id}
                      className="grid gap-2 rounded-2xl border border-white/15 bg-white/55 p-3 dark:bg-slate-950/35"
                    >
                      <div className="grid gap-2 md:grid-cols-[1fr_auto_1fr_auto]">
                        <select
                          value={field.column}
                          onChange={(event) =>
                            setValueFields((current) =>
                              current.map((entry) =>
                                entry.id === field.id
                                  ? {
                                      ...entry,
                                      column: event.target.value,
                                      alias: sanitizeAlias(
                                        `${entry.aggregation.toLowerCase()}_${event.target.value}`,
                                      ),
                                    }
                                  : entry,
                              ),
                            )
                          }
                          className={FIELD_CLASS}
                        >
                          {columns.map((column) => (
                            <option key={column.name} value={column.name}>
                              {column.name}
                            </option>
                          ))}
                        </select>
                        <select
                          value={field.aggregation}
                          onChange={(event) =>
                            setValueFields((current) =>
                              current.map((entry) =>
                                entry.id === field.id
                                  ? {
                                      ...entry,
                                      aggregation: event.target.value as AggFn,
                                      alias: sanitizeAlias(
                                        `${event.target.value.toLowerCase()}_${entry.column}`,
                                      ),
                                    }
                                  : entry,
                              ),
                            )
                          }
                          className={FIELD_CLASS}
                        >
                          {Object.keys(AGG_SQL).map((aggregation) => (
                            <option key={aggregation} value={aggregation}>
                              {aggregation}
                            </option>
                          ))}
                        </select>
                        <input
                          value={field.alias}
                          onChange={(event) =>
                            setValueFields((current) =>
                              current.map((entry) =>
                                entry.id === field.id
                                  ? { ...entry, alias: sanitizeAlias(event.target.value) }
                                  : entry,
                              ),
                            )
                          }
                          placeholder="Alias"
                          className={FIELD_CLASS}
                        />
                        <button
                          type="button"
                          onClick={() =>
                            setValueFields((current) =>
                              current.filter((entry) => entry.id !== field.id),
                            )
                          }
                          className="rounded-2xl border border-rose-300/30 bg-rose-500/10 px-3 py-3 text-rose-700 dark:text-rose-300"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    </div>
                  ))
                )}
              </DropZone>

              <DropZone
                title="Filters"
                kind="filters"
                subtitle="Drop a field here and set a literal filter value."
                onDropColumn={handleDropColumn}
              >
                {filters.length === 0 ? (
                  <p className="text-sm text-slate-500 dark:text-slate-400">No filters yet.</p>
                ) : (
                  filters.map((filterItem) => {
                    const column = columns.find((entry) => entry.name === filterItem.column);
                    const dataListId = `pivot-filter-${filterItem.id}`;
                    return (
                      <div
                        key={filterItem.id}
                        className="grid gap-2 rounded-2xl border border-white/15 bg-white/55 p-3 dark:bg-slate-950/35"
                      >
                        <div className="grid gap-2 md:grid-cols-[1fr_auto_1fr_auto]">
                          <input value={filterItem.column} readOnly className={FIELD_CLASS} />
                          <select
                            value={filterItem.operator}
                            onChange={(event) =>
                              setFilters((current) =>
                                current.map((entry) =>
                                  entry.id === filterItem.id
                                    ? {
                                        ...entry,
                                        operator: event.target.value as FilterOperator,
                                      }
                                    : entry,
                                ),
                              )
                            }
                            className={FIELD_CLASS}
                          >
                            <option value="equals">Equals</option>
                            <option value="not_equals">Not equals</option>
                          </select>
                          <div>
                            <input
                              value={filterItem.value}
                              onChange={(event) =>
                                setFilters((current) =>
                                  current.map((entry) =>
                                    entry.id === filterItem.id
                                      ? { ...entry, value: event.target.value }
                                      : entry,
                                  ),
                                )
                              }
                              list={dataListId}
                              placeholder="Literal value"
                              className={FIELD_CLASS}
                            />
                            <datalist id={dataListId}>
                              {(column?.sampleValues ?? []).map((sampleValue, index) => (
                                <option key={`${filterItem.id}-${index}`} value={String(sampleValue ?? "")} />
                              ))}
                            </datalist>
                          </div>
                          <button
                            type="button"
                            onClick={() =>
                              setFilters((current) =>
                                current.filter((entry) => entry.id !== filterItem.id),
                              )
                            }
                            className="rounded-2xl border border-rose-300/30 bg-rose-500/10 px-3 py-3 text-rose-700 dark:text-rose-300"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </div>
                      </div>
                    );
                  })
                )}
              </DropZone>
            </div>

            <div className="rounded-[1.6rem] border border-white/15 bg-white/45 p-4 dark:bg-slate-950/30">
              <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
                <Calculator className="h-3.5 w-3.5" />
                Calculated fields
              </div>
              <div className="mt-4 grid gap-2 md:grid-cols-[1fr_1.2fr_auto]">
                <input
                  value={calcName}
                  onChange={(event) => setCalcName(event.target.value)}
                  placeholder="margin_pct"
                  className={FIELD_CLASS}
                />
                <input
                  value={calcFormula}
                  onChange={(event) => setCalcFormula(event.target.value)}
                  placeholder="sum_revenue / sum_cost"
                  className={`${FIELD_CLASS} font-mono`}
                />
                <button
                  type="button"
                  onClick={addCalculatedField}
                  className="rounded-2xl bg-indigo-600 px-4 py-3 text-sm font-semibold text-white transition hover:bg-indigo-500"
                >
                  <span className="flex items-center gap-2">
                    <Plus className="h-4 w-4" />
                    Add
                  </span>
                </button>
              </div>
              <div className="mt-4 space-y-2">
                {calculatedFields.map((field) => (
                  <div
                    key={field.id}
                    className="flex items-center justify-between gap-3 rounded-2xl border border-white/15 bg-white/55 px-4 py-3 dark:bg-slate-950/35"
                  >
                    <div>
                      <div className="text-sm font-semibold text-slate-950 dark:text-white">
                        {field.name}
                      </div>
                      <div className="mt-1 font-mono text-xs text-slate-500 dark:text-slate-400">
                        {field.formula}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() =>
                        setCalculatedFields((current) =>
                          current.filter((entry) => entry.id !== field.id),
                        )
                      }
                      className="rounded-full border border-rose-300/30 bg-rose-500/10 p-2 text-rose-700 dark:text-rose-300"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-[1.6rem] border border-white/15 bg-white/45 p-4 dark:bg-slate-950/30">
              <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
                <Filter className="h-3.5 w-3.5" />
                Conditional formatting
              </div>
              <div className="mt-4 grid gap-2 md:grid-cols-[1fr_auto_1fr_1fr_auto]">
                <select
                  value={ruleMeasure}
                  onChange={(event) => setRuleMeasure(event.target.value)}
                  className={FIELD_CLASS}
                >
                  <option value="__all__">All measures</option>
                  {availableMeasures.map((measure) => (
                    <option key={measure} value={measure}>
                      {measure}
                    </option>
                  ))}
                </select>
                <select
                  value={ruleOperator}
                  onChange={(event) => setRuleOperator(event.target.value as ConditionalOperator)}
                  className={FIELD_CLASS}
                >
                  <option value="gt">Greater than</option>
                  <option value="lt">Less than</option>
                  <option value="between">Between</option>
                </select>
                <input
                  value={ruleValue}
                  onChange={(event) => setRuleValue(event.target.value)}
                  placeholder="Threshold"
                  className={FIELD_CLASS}
                />
                <input
                  value={ruleSecondValue}
                  onChange={(event) => setRuleSecondValue(event.target.value)}
                  placeholder="Upper bound"
                  className={`${FIELD_CLASS} ${ruleOperator === "between" ? "" : "opacity-60"}`}
                  disabled={ruleOperator !== "between"}
                />
                <div className="flex items-center gap-2 rounded-2xl border border-white/20 bg-white/60 px-3 py-2 dark:bg-slate-950/45">
                  <input
                    type="color"
                    value={ruleColor}
                    onChange={(event) => setRuleColor(event.target.value)}
                    className="h-8 w-10 rounded border-0 bg-transparent"
                  />
                  <button
                    type="button"
                    onClick={addConditionalRule}
                    className="rounded-2xl bg-cyan-600 px-3 py-2 text-sm font-semibold text-white transition hover:bg-cyan-500"
                  >
                    Add
                  </button>
                </div>
              </div>
              <div className="mt-4 space-y-2">
                {conditionalRules.map((rule) => (
                  <div
                    key={rule.id}
                    className="flex items-center justify-between gap-3 rounded-2xl border border-white/15 bg-white/55 px-4 py-3 dark:bg-slate-950/35"
                  >
                    <div className="text-sm text-slate-600 dark:text-slate-300">
                      <span className="font-semibold text-slate-950 dark:text-white">
                        {rule.measure === "__all__" ? "All measures" : rule.measure}
                      </span>{" "}
                      {rule.operator === "gt"
                        ? `> ${rule.value}`
                        : rule.operator === "lt"
                          ? `< ${rule.value}`
                          : `between ${rule.value} and ${rule.secondValue}`}
                    </div>
                    <div className="flex items-center gap-3">
                      <span
                        className="h-5 w-5 rounded-full border border-white/20"
                        style={{ backgroundColor: rule.color }}
                      />
                      <button
                        type="button"
                        onClick={() =>
                          setConditionalRules((current) =>
                            current.filter((entry) => entry.id !== rule.id),
                          )
                        }
                        className="rounded-full border border-rose-300/30 bg-rose-500/10 p-2 text-rose-700 dark:text-rose-300"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-[1.6rem] border border-white/15 bg-white/45 p-4 dark:bg-slate-950/30">
              <div className="grid gap-3 md:grid-cols-[1fr_auto_auto]">
                <input
                  value={configName}
                  onChange={(event) => setConfigName(event.target.value)}
                  placeholder="Quarterly executive pivot"
                  className={FIELD_CLASS}
                />
                <button
                  type="button"
                  onClick={saveCurrentConfig}
                  className="inline-flex items-center gap-2 rounded-2xl border border-white/20 bg-white/55 px-4 py-3 text-sm text-slate-700 transition hover:border-cyan-300/40 dark:bg-slate-950/35 dark:text-slate-200"
                >
                  <Save className="h-4 w-4" />
                  Save layout
                </button>
                <div className="flex items-center gap-3 rounded-2xl border border-white/15 bg-white/55 px-4 py-3 text-sm text-slate-700 dark:bg-slate-950/35 dark:text-slate-200">
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={showSubtotals}
                      onChange={(event) => setShowSubtotals(event.target.checked)}
                      className="h-4 w-4 rounded border-white/20 bg-white/70 text-cyan-500"
                    />
                    Subtotals
                  </label>
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={showGrandTotals}
                      onChange={(event) => setShowGrandTotals(event.target.checked)}
                      className="h-4 w-4 rounded border-white/20 bg-white/70 text-cyan-500"
                    />
                    Grand totals
                  </label>
                </div>
              </div>
              <div className="mt-4 grid gap-3">
                {savedConfigs.length === 0 ? (
                  <p className="text-sm text-slate-500 dark:text-slate-400">
                    No saved configurations yet.
                  </p>
                ) : (
                  savedConfigs.map((config) => (
                    <div
                      key={config.id}
                      className="flex items-center justify-between gap-3 rounded-2xl border border-white/15 bg-white/55 px-4 py-3 dark:bg-slate-950/35"
                    >
                      <div>
                        <div className="text-sm font-semibold text-slate-950 dark:text-white">
                          {config.name}
                        </div>
                        <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                          {config.rowFields.length} row, {config.columnFields.length} column, {config.valueFields.length} value fields
                        </div>
                      </div>
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={() => applyConfig(config)}
                          className="rounded-2xl border border-white/20 bg-white/70 px-3 py-2 text-sm text-slate-700 transition hover:border-cyan-300/40 dark:bg-slate-900/60 dark:text-slate-200"
                        >
                          Load
                        </button>
                        <button
                          type="button"
                          onClick={() => deleteConfig(config.id)}
                          className="rounded-2xl border border-rose-300/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-700 dark:text-rose-300"
                        >
                          Delete
                        </button>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>

          <div className="space-y-5">
            <div className="rounded-[1.6rem] border border-white/15 bg-white/45 p-4 dark:bg-slate-950/30">
              {result ? (
                <div className="overflow-auto rounded-[1.4rem] border border-white/15">
                  <table className="min-w-full border-collapse text-sm">
                    <thead className="sticky top-0 bg-white/70 backdrop-blur dark:bg-slate-950/80">
                      <tr>
                        <th className="border-b border-white/10 px-4 py-3 text-left font-semibold text-slate-600 dark:text-slate-300">
                          {rowFields.join(" / ") || "Rows"}
                        </th>
                        {displayColumns.map(({ colKey, measure }) => (
                          <th
                            key={`${colKey}-${measure}`}
                            className="border-b border-white/10 px-3 py-3 text-right font-semibold text-slate-600 dark:text-slate-300"
                          >
                            <div>{colKey}</div>
                            <div className="text-[11px] uppercase tracking-[0.16em] text-slate-400">
                              {measure}
                            </div>
                          </th>
                        ))}
                        <th className="border-b border-white/10 px-4 py-3 text-right font-semibold text-slate-600 dark:text-slate-300">
                          Row total
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {groupedRows.map((group) => {
                        const collapsed = collapsedGroups.includes(group.group);
                        const subtotal = result.groupSubtotals.get(group.group) ?? {};
                        return (
                          <Fragment key={group.group}>
                            {rowFields.length > 1 ? (
                              <tr className="bg-slate-950/5 dark:bg-white/5">
                                <td className="border-b border-white/10 px-4 py-3">
                                  <button
                                    type="button"
                                    onClick={() =>
                                      setCollapsedGroups((current) =>
                                        current.includes(group.group)
                                          ? current.filter((entry) => entry !== group.group)
                                          : [...current, group.group],
                                      )
                                    }
                                    className="flex items-center gap-2 font-semibold text-slate-950 dark:text-white"
                                  >
                                    {collapsed ? (
                                      <ChevronRight className="h-4 w-4" />
                                    ) : (
                                      <ChevronDown className="h-4 w-4" />
                                    )}
                                    {group.group}
                                  </button>
                                </td>
                                <td
                                  colSpan={displayColumns.length + 1}
                                  className="border-b border-white/10 px-4 py-3 text-right text-xs uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400"
                                >
                                  {group.rows.length} row groups
                                </td>
                              </tr>
                            ) : null}

                            {collapsed
                              ? null
                              : group.rows.map((rowKey) => {
                                  const rowTotal = Object.values(
                                    result.rowTotals.get(rowKey) ?? {},
                                  ).reduce((sum, value) => sum + value, 0);
                                  return (
                                    <tr key={rowKey}>
                                      <td className="border-b border-white/10 px-4 py-3 font-medium text-slate-950 dark:text-slate-50">
                                        {rowKey}
                                      </td>
                                      {displayColumns.map(({ colKey, measure }) => {
                                        const value =
                                          result.cells.get(cellKey(rowKey, colKey))?.[measure] ?? 0;
                                        return (
                                          <td
                                            key={`${rowKey}-${colKey}-${measure}`}
                                            className="border-b border-white/10 px-3 py-3 text-right"
                                          >
                                            <div
                                              className="rounded-xl px-2 py-1"
                                              style={buildConditionalStyle(value, measure, conditionalRules)}
                                            >
                                              {value.toLocaleString()}
                                            </div>
                                          </td>
                                        );
                                      })}
                                      <td className="border-b border-white/10 px-4 py-3 text-right font-semibold text-slate-900 dark:text-slate-100">
                                        {rowTotal.toLocaleString()}
                                      </td>
                                    </tr>
                                  );
                                })}

                            {showSubtotals ? (
                              <tr className="bg-slate-950/5 dark:bg-white/5">
                                <td className="border-b border-white/10 px-4 py-3 font-semibold text-slate-950 dark:text-slate-50">
                                  {group.group} subtotal
                                </td>
                                {displayColumns.map(({ measure }) => (
                                  <td
                                    key={`subtotal-${group.group}-${measure}`}
                                    className="border-b border-white/10 px-3 py-3 text-right font-semibold text-slate-950 dark:text-slate-50"
                                  >
                                    {(subtotal[measure] ?? 0).toLocaleString()}
                                  </td>
                                ))}
                                <td className="border-b border-white/10 px-4 py-3 text-right font-semibold text-slate-950 dark:text-slate-50">
                                  {Object.values(subtotal).reduce((sum, value) => sum + value, 0).toLocaleString()}
                                </td>
                              </tr>
                            ) : null}
                          </Fragment>
                        );
                      })}

                      {showGrandTotals ? (
                        <tr className="bg-slate-950/10 dark:bg-white/10">
                          <td className="border-t border-white/10 px-4 py-3 font-semibold text-slate-950 dark:text-slate-50">
                            Grand total
                          </td>
                          {displayColumns.map(({ colKey, measure }) => (
                            <td
                              key={`grand-${colKey}-${measure}`}
                              className="border-t border-white/10 px-3 py-3 text-right font-semibold text-slate-950 dark:text-slate-50"
                            >
                              {(result.colTotals.get(colKey)?.[measure] ?? 0).toLocaleString()}
                            </td>
                          ))}
                          <td className="border-t border-white/10 px-4 py-3 text-right font-semibold text-slate-950 dark:text-slate-50">
                            {Object.values(result.grandTotals).reduce((sum, value) => sum + value, 0).toLocaleString()}
                          </td>
                        </tr>
                      ) : null}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="rounded-[1.4rem] border border-dashed border-white/20 bg-white/35 px-5 py-12 text-center text-sm text-slate-500 dark:bg-slate-950/30 dark:text-slate-400">
                  Configure the drop zones, then run the pivot to render results here.
                </div>
              )}
            </div>
          </div>
        </motion.div>
      </div>
    </section>
  );
}

export default function PivotConfigurator({
  tableName,
  columns,
}: PivotConfiguratorProps) {
  return <PivotConfiguratorInner key={tableName} tableName={tableName} columns={columns} />;
}
