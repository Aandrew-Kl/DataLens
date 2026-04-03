"use client";

import { useEffect, useMemo, useState } from "react";
import { useDatasetStore } from "@/stores/dataset-store";
import type { ColumnProfile, DatasetMeta } from "@/types/dataset";

export type SuggestionCategory =
  | "keyword"
  | "table"
  | "column"
  | "function"
  | "snippet";

export interface AutocompleteSuggestion {
  label: string;
  insertText: string;
  category: SuggestionCategory;
  detail: string;
  score: number;
}

interface CursorContext {
  token: string;
  clause:
    | "table"
    | "column"
    | "function"
    | "condition"
    | "snippet"
    | "general";
}

interface BaseSuggestion {
  label: string;
  insertText: string;
  category: SuggestionCategory;
  detail: string;
}

const SQL_KEYWORDS = [
  "SELECT",
  "FROM",
  "WHERE",
  "GROUP BY",
  "ORDER BY",
  "HAVING",
  "JOIN",
  "LEFT JOIN",
  "RIGHT JOIN",
  "INNER JOIN",
  "FULL JOIN",
  "ON",
  "LIMIT",
  "OFFSET",
  "DISTINCT",
  "WITH",
  "UNION",
  "INSERT INTO",
  "UPDATE",
  "DELETE FROM",
  "CREATE TABLE",
  "DROP TABLE",
  "ALTER TABLE",
  "CASE",
  "WHEN",
  "THEN",
  "ELSE",
  "END",
  "AND",
  "OR",
  "NOT",
  "IN",
  "EXISTS",
  "BETWEEN",
  "LIKE",
  "IS NULL",
  "IS NOT NULL",
];

const SQL_FUNCTIONS = [
  "COUNT",
  "SUM",
  "AVG",
  "MIN",
  "MAX",
  "MEDIAN",
  "STDDEV_SAMP",
  "QUANTILE_CONT",
  "ROUND",
  "ABS",
  "COALESCE",
  "CAST",
  "LOWER",
  "UPPER",
  "LENGTH",
  "DATE_TRUNC",
  "ROW_NUMBER",
  "LAG",
  "LEAD",
];

const SQL_SNIPPETS: BaseSuggestion[] = [
  {
    label: "SELECT ... FROM ...",
    insertText: 'SELECT *\nFROM ""\nLIMIT 100;',
    category: "snippet",
    detail: "Starter query against a single table",
  },
  {
    label: "SELECT ... WHERE ...",
    insertText: 'SELECT *\nFROM ""\nWHERE "" = \'\';',
    category: "snippet",
    detail: "Filter rows with a predicate",
  },
  {
    label: "GROUP BY",
    insertText: 'SELECT "", COUNT(*) AS row_count\nFROM ""\nGROUP BY ""\nORDER BY row_count DESC;',
    category: "snippet",
    detail: "Aggregate by one dimension",
  },
  {
    label: "JOIN ... ON ...",
    insertText:
      'SELECT *\nFROM "" AS left_table\nJOIN "" AS right_table\n  ON left_table."" = right_table."";',
    category: "snippet",
    detail: "Join two tables on matching keys",
  },
  {
    label: "CTE",
    insertText: 'WITH filtered AS (\n  SELECT *\n  FROM ""\n)\nSELECT *\nFROM filtered;',
    category: "snippet",
    detail: "Common table expression for staged queries",
  },
];

function normalize(value: string): string {
  return value.trim().toLowerCase();
}

function quoteIdentifier(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

function getTextControlValue(): { value: string; cursor: number } | null {
  if (typeof document === "undefined") {
    return null;
  }

  const activeElement = document.activeElement;
  if (
    activeElement instanceof HTMLTextAreaElement ||
    (activeElement instanceof HTMLInputElement &&
      ["text", "search", "email", "url"].includes(activeElement.type))
  ) {
    return {
      value: activeElement.value,
      cursor: activeElement.selectionStart ?? activeElement.value.length,
    };
  }

  return null;
}

function readCursorContext(): CursorContext {
  const control = getTextControlValue();
  if (!control) {
    return { token: "", clause: "general" };
  }

  const beforeCursor = control.value.slice(0, control.cursor);
  const tokenMatch = beforeCursor.match(/(?:"[^"]*"|[A-Za-z_][A-Za-z0-9_$]*)$/);
  const token = tokenMatch?.[0] ?? "";
  const withoutToken = token ? beforeCursor.slice(0, -token.length).trimEnd() : beforeCursor.trimEnd();
  const upper = withoutToken.toUpperCase();

  if (/\b(?:FROM|JOIN|INTO|UPDATE|TABLE|DESCRIBE)\s*$/.test(upper)) {
    return { token, clause: "table" };
  }

  if (/\b(?:WHERE|HAVING|ON|AND|OR|WHEN)\s*$/.test(upper)) {
    return { token, clause: "condition" };
  }

  if (/\b(?:SELECT|GROUP BY|ORDER BY|PARTITION BY|BY|SET)\s*$/.test(upper)) {
    return { token, clause: "column" };
  }

  if (/\b(?:COUNT|SUM|AVG|MIN|MAX|MEDIAN|STDDEV_SAMP|QUANTILE_CONT|ROUND|ABS|COALESCE|CAST)\s*\($/.test(upper)) {
    return { token, clause: "function" };
  }

  if (beforeCursor.trim().length === 0) {
    return { token: "", clause: "snippet" };
  }

  return { token, clause: "general" };
}

function getTableSuggestions(
  datasets: DatasetMeta[],
  currentTableName: string,
): BaseSuggestion[] {
  const names = new Set<string>([currentTableName]);

  datasets.forEach((dataset) => {
    names.add(dataset.name);
  });

  return [...names]
    .filter(Boolean)
    .sort((left, right) => left.localeCompare(right))
    .map((name) => ({
      label: name,
      insertText: quoteIdentifier(name),
      category: "table" as const,
      detail: name === currentTableName ? "Current active table" : "Loaded DuckDB table",
    }));
}

function scoreSuggestion(
  suggestion: BaseSuggestion,
  context: CursorContext,
  currentTableName: string,
): number {
  const token = normalize(context.token.replaceAll('"', ""));
  const label = normalize(suggestion.label.replaceAll('"', ""));
  const insertText = normalize(suggestion.insertText.replaceAll('"', ""));

  let score = 0;

  if (!token) {
    score += suggestion.category === "snippet" ? 18 : 8;
  } else if (label.startsWith(token) || insertText.startsWith(token)) {
    score += 40;
  } else if (label.includes(token) || insertText.includes(token)) {
    score += 20;
  } else if (suggestion.category !== "snippet") {
    score -= 30;
  }

  if (context.clause === "table") {
    score += suggestion.category === "table" ? 45 : -10;
  } else if (context.clause === "column") {
    score += suggestion.category === "column" ? 42 : suggestion.category === "function" ? 24 : 0;
  } else if (context.clause === "function") {
    score += suggestion.category === "function" ? 48 : suggestion.category === "column" ? 12 : -10;
  } else if (context.clause === "condition") {
    score +=
      suggestion.category === "column"
        ? 38
        : suggestion.category === "function"
          ? 20
          : suggestion.category === "keyword"
            ? 10
            : 0;
  } else if (context.clause === "snippet") {
    score += suggestion.category === "snippet" ? 50 : 6;
  } else {
    score +=
      suggestion.category === "keyword"
        ? 20
        : suggestion.category === "column"
          ? 16
          : suggestion.category === "function"
            ? 14
            : suggestion.category === "table"
              ? 12
              : 10;
  }

  if (
    suggestion.category === "table" &&
    normalize(currentTableName) === normalize(suggestion.label)
  ) {
    score += 12;
  }

  return score;
}

export function useSQLAutocomplete(
  tableName: string,
  columns: ColumnProfile[],
): AutocompleteSuggestion[] {
  const datasets = useDatasetStore((state) => state.datasets);
  const [context, setContext] = useState<CursorContext>(() => readCursorContext());

  useEffect(() => {
    function syncContext(): void {
      setContext(readCursorContext());
    }

    syncContext();
    document.addEventListener("selectionchange", syncContext);
    document.addEventListener("keyup", syncContext);
    document.addEventListener("click", syncContext);
    document.addEventListener("focusin", syncContext);

    return () => {
      document.removeEventListener("selectionchange", syncContext);
      document.removeEventListener("keyup", syncContext);
      document.removeEventListener("click", syncContext);
      document.removeEventListener("focusin", syncContext);
    };
  }, []);

  return useMemo(() => {
    const keywordSuggestions: BaseSuggestion[] = SQL_KEYWORDS.map((keyword) => ({
      label: keyword,
      insertText: keyword,
      category: "keyword",
      detail: "SQL keyword",
    }));

    const functionSuggestions: BaseSuggestion[] = SQL_FUNCTIONS.map((fn) => ({
      label: fn,
      insertText: `${fn}()`,
      category: "function",
      detail: "SQL function",
    }));

    const columnSuggestions: BaseSuggestion[] = columns.map((column) => ({
      label: column.name,
      insertText: quoteIdentifier(column.name),
      category: "column",
      detail: `${column.type} column`,
    }));

    const tableSuggestions = getTableSuggestions(datasets, tableName);
    const mergedSuggestions = [
      ...SQL_SNIPPETS,
      ...keywordSuggestions,
      ...tableSuggestions,
      ...columnSuggestions,
      ...functionSuggestions,
    ];

    return mergedSuggestions
      .map((suggestion) => ({
        ...suggestion,
        score: scoreSuggestion(suggestion, context, tableName),
      }))
      .filter((suggestion) => suggestion.score > 0)
      .sort((left, right) => right.score - left.score || left.label.localeCompare(right.label));
  }, [columns, context, datasets, tableName]);
}
