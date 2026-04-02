// ---------------------------------------------------------------------------
// SQL Template definitions and rendering utilities
// ---------------------------------------------------------------------------

export type TemplateCategory =
  | "Aggregation"
  | "Filtering"
  | "Window"
  | "Date"
  | "Text"
  | "Advanced";

export interface TemplateParam {
  /** Unique key used in the template string as {{key}} */
  key: string;
  /** Human-readable label shown in the form */
  label: string;
  /** "column" renders a column dropdown; "value" renders a text input */
  kind: "column" | "value";
  /** Optional column type filter -- only show columns matching this type */
  columnType?: "string" | "number" | "date" | "boolean";
  /** Placeholder text for value inputs */
  placeholder?: string;
  /** Default value */
  defaultValue?: string;
}

export interface SQLTemplate {
  id: string;
  name: string;
  description: string;
  category: TemplateCategory;
  icon: string;
  params: TemplateParam[];
  /** Template string with {{key}} placeholders and {{TABLE}} for the table name */
  template: string;
}

// ---------------------------------------------------------------------------
// Template collection
// ---------------------------------------------------------------------------

export const SQL_TEMPLATES: SQLTemplate[] = [
  // -- Aggregation ----------------------------------------------------------
  {
    id: "group-count",
    name: "Group & Count",
    description: "Count rows per unique value in a column.",
    category: "Aggregation",
    icon: "BarChart3",
    params: [
      { key: "column", label: "Group by column", kind: "column" },
    ],
    template: `SELECT "{{column}}", COUNT(*) AS count\nFROM "{{TABLE}}"\nGROUP BY "{{column}}"\nORDER BY count DESC;`,
  },
  {
    id: "sum-by-group",
    name: "Sum by Group",
    description: "Sum a numeric column grouped by a category column.",
    category: "Aggregation",
    icon: "Calculator",
    params: [
      { key: "category", label: "Group by column", kind: "column" },
      { key: "value", label: "Sum column", kind: "column", columnType: "number" },
    ],
    template: `SELECT "{{category}}", SUM("{{value}}") AS total\nFROM "{{TABLE}}"\nGROUP BY "{{category}}"\nORDER BY total DESC;`,
  },
  {
    id: "avg-min-max",
    name: "Average / Min / Max",
    description: "Compute average, minimum, and maximum of a numeric column.",
    category: "Aggregation",
    icon: "TrendingUp",
    params: [
      { key: "column", label: "Numeric column", kind: "column", columnType: "number" },
    ],
    template: `SELECT\n  AVG("{{column}}") AS average,\n  MIN("{{column}}") AS minimum,\n  MAX("{{column}}") AS maximum\nFROM "{{TABLE}}";`,
  },

  // -- Filtering ------------------------------------------------------------
  {
    id: "top-n",
    name: "Top N Rows",
    description: "Select the top N rows ordered by a column.",
    category: "Filtering",
    icon: "ArrowUpDown",
    params: [
      { key: "column", label: "Order by column", kind: "column" },
      { key: "n", label: "Number of rows", kind: "value", placeholder: "10", defaultValue: "10" },
    ],
    template: `SELECT *\nFROM "{{TABLE}}"\nORDER BY "{{column}}" DESC\nLIMIT {{n}};`,
  },
  {
    id: "filter-equals",
    name: "Filter by Value",
    description: "Select rows where a column equals a specific value.",
    category: "Filtering",
    icon: "Filter",
    params: [
      { key: "column", label: "Column", kind: "column" },
      { key: "value", label: "Equals value", kind: "value", placeholder: "some value" },
    ],
    template: `SELECT *\nFROM "{{TABLE}}"\nWHERE "{{column}}" = '{{value}}';`,
  },
  {
    id: "filter-null",
    name: "Find Nulls",
    description: "Find rows where a column is NULL.",
    category: "Filtering",
    icon: "CircleSlash",
    params: [
      { key: "column", label: "Column", kind: "column" },
    ],
    template: `SELECT *\nFROM "{{TABLE}}"\nWHERE "{{column}}" IS NULL;`,
  },

  // -- Window ---------------------------------------------------------------
  {
    id: "row-number",
    name: "Row Number",
    description: "Add a row number partitioned by a category and ordered by a column.",
    category: "Window",
    icon: "Hash",
    params: [
      { key: "partition", label: "Partition by", kind: "column" },
      { key: "order", label: "Order by", kind: "column" },
    ],
    template: `SELECT *,\n  ROW_NUMBER() OVER (\n    PARTITION BY "{{partition}}"\n    ORDER BY "{{order}}" DESC\n  ) AS row_num\nFROM "{{TABLE}}";`,
  },
  {
    id: "running-total",
    name: "Running Total",
    description: "Compute a cumulative sum over an ordered column.",
    category: "Window",
    icon: "LineChart",
    params: [
      { key: "value", label: "Sum column", kind: "column", columnType: "number" },
      { key: "order", label: "Order by", kind: "column" },
    ],
    template: `SELECT *,\n  SUM("{{value}}") OVER (\n    ORDER BY "{{order}}"\n    ROWS UNBOUNDED PRECEDING\n  ) AS running_total\nFROM "{{TABLE}}";`,
  },

  // -- Date -----------------------------------------------------------------
  {
    id: "date-trunc",
    name: "Group by Date Part",
    description: "Truncate a date column and count per period.",
    category: "Date",
    icon: "Calendar",
    params: [
      { key: "column", label: "Date column", kind: "column", columnType: "date" },
      { key: "period", label: "Period", kind: "value", placeholder: "month", defaultValue: "month" },
    ],
    template: `SELECT DATE_TRUNC('{{period}}', "{{column}}") AS period,\n  COUNT(*) AS count\nFROM "{{TABLE}}"\nGROUP BY period\nORDER BY period;`,
  },
  {
    id: "date-range",
    name: "Date Range Filter",
    description: "Select rows within a date range.",
    category: "Date",
    icon: "CalendarRange",
    params: [
      { key: "column", label: "Date column", kind: "column", columnType: "date" },
      { key: "start", label: "Start date", kind: "value", placeholder: "2024-01-01" },
      { key: "end", label: "End date", kind: "value", placeholder: "2024-12-31" },
    ],
    template: `SELECT *\nFROM "{{TABLE}}"\nWHERE "{{column}}" BETWEEN '{{start}}' AND '{{end}}'\nORDER BY "{{column}}";`,
  },

  // -- Text -----------------------------------------------------------------
  {
    id: "text-search",
    name: "Text Search (LIKE)",
    description: "Find rows where a text column contains a pattern.",
    category: "Text",
    icon: "Search",
    params: [
      { key: "column", label: "Text column", kind: "column", columnType: "string" },
      { key: "pattern", label: "Search pattern", kind: "value", placeholder: "%keyword%" },
    ],
    template: `SELECT *\nFROM "{{TABLE}}"\nWHERE "{{column}}" ILIKE '{{pattern}}';`,
  },
  {
    id: "distinct-values",
    name: "Distinct Values",
    description: "List all unique values in a column.",
    category: "Text",
    icon: "List",
    params: [
      { key: "column", label: "Column", kind: "column" },
    ],
    template: `SELECT DISTINCT "{{column}}"\nFROM "{{TABLE}}"\nORDER BY "{{column}}";`,
  },

  // -- Advanced -------------------------------------------------------------
  {
    id: "percentile",
    name: "Percentiles",
    description: "Compute the 25th, 50th, and 75th percentiles of a numeric column.",
    category: "Advanced",
    icon: "Percent",
    params: [
      { key: "column", label: "Numeric column", kind: "column", columnType: "number" },
    ],
    template: `SELECT\n  PERCENTILE_CONT(0.25) WITHIN GROUP (ORDER BY "{{column}}") AS p25,\n  PERCENTILE_CONT(0.50) WITHIN GROUP (ORDER BY "{{column}}") AS p50,\n  PERCENTILE_CONT(0.75) WITHIN GROUP (ORDER BY "{{column}}") AS p75\nFROM "{{TABLE}}";`,
  },
  {
    id: "pivot-crosstab",
    name: "Pivot / Crosstab",
    description: "Create a simple pivot counting category intersections.",
    category: "Advanced",
    icon: "Table2",
    params: [
      { key: "row", label: "Row category", kind: "column" },
      { key: "col", label: "Column category", kind: "column" },
    ],
    template: `SELECT "{{row}}",\n  COUNT(*) FILTER (WHERE "{{col}}" IS NOT NULL) AS filled,\n  COUNT(*) AS total\nFROM "{{TABLE}}"\nGROUP BY "{{row}}"\nORDER BY total DESC;`,
  },
];

// ---------------------------------------------------------------------------
// Template renderer
// ---------------------------------------------------------------------------

/**
 * Replace `{{key}}` placeholders in a template string with provided values.
 * `{{TABLE}}` is always replaced with the given table name.
 */
export function renderTemplate(
  template: string,
  tableName: string,
  values: Record<string, string>,
): string {
  let result = template.replace(/\{\{TABLE\}\}/g, tableName);

  for (const [key, value] of Object.entries(values)) {
    result = result.replace(new RegExp(`\\{\\{${key}\\}\\}`, "g"), value);
  }

  return result;
}
