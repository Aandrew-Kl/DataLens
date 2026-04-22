import { quoteIdentifier } from "@/lib/utils/sql";
import { generateId } from "@/lib/utils/formatters";
import { buildMetricExpression } from "@/lib/utils/sql-safe";

import {
  AGG_SQL,
  STORAGE_PREFIX,
  type CalculatedField,
  type ConditionalRule,
  type PivotFilter,
  type SavedPivotConfig,
  type ValueField,
} from "./types";

export function quoteLiteral(value: string) {
  return `'${value.replaceAll("'", "''")}'`;
}

export function sanitizeAlias(value: string) {
  const raw = value.trim().replace(/[^a-zA-Z0-9_]/g, "_");
  const prefixed = /^[a-zA-Z_]/.test(raw) ? raw : `m_${raw}`;
  return prefixed.replace(/_+/g, "_").replace(/^_+|_+$/g, "").slice(0, 48);
}

export function cellKey(rowKey: string, colKey: string) {
  return `${rowKey}\u0000${colKey}`;
}

export function readSavedConfigs(tableName: string) {
  if (typeof window === "undefined") return [] as SavedPivotConfig[];
  try {
    const raw = window.localStorage.getItem(`${STORAGE_PREFIX}:${tableName}`);
    return raw ? (JSON.parse(raw) as SavedPivotConfig[]) : [];
  } catch {
    return [] as SavedPivotConfig[];
  }
}

export function writeSavedConfigs(tableName: string, configs: SavedPivotConfig[]) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(`${STORAGE_PREFIX}:${tableName}`, JSON.stringify(configs));
}

export function csvEscape(value: unknown) {
  const text = String(value ?? "");
  return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export function defaultValueField(columnName: string) {
  return {
    id: generateId(),
    column: columnName,
    aggregation: "COUNT",
    alias: sanitizeAlias(`count_${columnName || "rows"}`),
  } satisfies ValueField;
}

export function buildFormulaSql(formula: string, aliases: Set<string>) {
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

export function buildFilterClause(filters: PivotFilter[]) {
  const clauses = filters.flatMap((filter) => {
    const value = filter.value.trim();
    if (!filter.column || value === "") return [];
    const operator = filter.operator === "not_equals" ? "<>" : "=";
    return [`CAST(${quoteIdentifier(filter.column)} AS VARCHAR) ${operator} ${quoteLiteral(value)}`];
  });

  return clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
}

export function buildPivotSql(
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
        : buildMetricExpression(
            AGG_SQL[field.aggregation],
            field.column,
            (column) => `TRY_CAST(${quoteIdentifier(column)} AS DOUBLE)`,
            { cast: false },
          );
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

export function buildConditionalStyle(
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
