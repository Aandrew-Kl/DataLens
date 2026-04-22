export type AggFn = "SUM" | "AVG" | "COUNT" | "MIN" | "MAX" | "MEDIAN" | "STDEV";
export type DropZoneKind = "rows" | "columns" | "values" | "filters";
export type FilterOperator = "equals" | "not_equals";
export type ConditionalOperator = "gt" | "lt" | "between";

export interface ValueField {
  id: string;
  column: string;
  aggregation: AggFn;
  alias: string;
}

export interface PivotFilter {
  id: string;
  column: string;
  operator: FilterOperator;
  value: string;
}

export interface CalculatedField {
  id: string;
  name: string;
  formula: string;
}

export interface ConditionalRule {
  id: string;
  measure: string;
  operator: ConditionalOperator;
  value: string;
  secondValue: string;
  color: string;
}

export interface PivotResult {
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

export interface SavedPivotConfig {
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

export type NoticeTone = "success" | "error" | "info";

export interface NoticeState {
  tone: NoticeTone;
  message: string;
}

export const EASE = [0.22, 1, 0.36, 1] as const;
export const PANEL_CLASS =
  "overflow-hidden rounded-[1.9rem] border border-white/20 bg-white/75 shadow-[0_24px_90px_-48px_rgba(15,23,42,0.75)] backdrop-blur-2xl dark:border-white/10 dark:bg-slate-950/45";
export const FIELD_CLASS =
  "rounded-2xl border border-white/20 bg-white/80 px-4 py-3 text-sm text-slate-700 outline-none transition focus:border-cyan-400 focus:ring-4 focus:ring-cyan-500/10 dark:border-white/10 dark:bg-slate-950/50 dark:text-slate-100";
export const STORAGE_PREFIX = "datalens:pivot-configurator";

export const AGG_SQL: Record<AggFn, string> = {
  SUM: "SUM",
  AVG: "AVG",
  COUNT: "COUNT",
  MIN: "MIN",
  MAX: "MAX",
  MEDIAN: "MEDIAN",
  STDEV: "STDDEV",
};
