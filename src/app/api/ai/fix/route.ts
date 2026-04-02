import { NextResponse } from "next/server";
import { chat, checkOllamaHealth } from "@/lib/ai/ollama-client";
import type { ColumnProfile } from "@/types/dataset";

type FixResult = {
  fixedSql: string;
  explanation: string;
};

const SQL_KEYWORDS = new Set([
  "select",
  "from",
  "where",
  "group",
  "by",
  "order",
  "join",
  "left",
  "right",
  "inner",
  "outer",
  "full",
  "cross",
  "on",
  "and",
  "or",
  "as",
  "count",
  "sum",
  "avg",
  "min",
  "max",
  "limit",
  "distinct",
  "having",
  "case",
  "when",
  "then",
  "else",
  "end",
  "asc",
  "desc",
  "not",
  "null",
  "like",
  "ilike",
  "in",
  "is",
]);

function stripCodeFences(value: string): string {
  return value
    .trim()
    .replace(/^```(?:json|sql)?\s*/i, "")
    .replace(/\s*```$/, "")
    .trim();
}

function quoteIdentifier(identifier: string): string {
  return `"${identifier.replace(/"/g, "\"\"")}"`;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normalizeIdentifier(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function formatList(items: string[]): string {
  if (items.length === 0) {
    return "";
  }

  if (items.length === 1) {
    return items[0];
  }

  if (items.length === 2) {
    return `${items[0]} and ${items[1]}`;
  }

  return `${items.slice(0, -1).join(", ")}, and ${items[items.length - 1]}`;
}

function formatSchema(columns: ColumnProfile[]): string {
  return columns
    .map((column) => `- "${column.name}" (${column.type})`)
    .join("\n");
}

function needsQuoting(identifier: string): boolean {
  return !/^[A-Za-z_][A-Za-z0-9_]*$/.test(identifier) || SQL_KEYWORDS.has(identifier.toLowerCase());
}

function buildLooseIdentifierPattern(source: string): RegExp {
  const escaped = escapeRegExp(source.trim()).replace(/\s+/g, "\\s+");
  const core = /^[A-Za-z0-9_ ]+$/.test(source.trim()) ? `\\b${escaped}\\b` : escaped;
  const pattern = "(?<![\"'`\\[])" + core + "(?![\"'`\\]])";
  return new RegExp(pattern, "gi");
}

function replaceIdentifierReferences(sql: string, source: string, replacement: string): FixResult & { changed: boolean } {
  if (!source.trim()) {
    return { fixedSql: sql, explanation: "", changed: false };
  }

  let next = sql;

  for (const pattern of [
    new RegExp(`"${escapeRegExp(source)}"`, "gi"),
    new RegExp(`'${escapeRegExp(source)}'`, "gi"),
    new RegExp("`" + escapeRegExp(source) + "`", "gi"),
    new RegExp("\\[" + escapeRegExp(source) + "\\]", "gi"),
    buildLooseIdentifierPattern(source),
  ]) {
    next = next.replace(pattern, replacement);
  }

  return { fixedSql: next, explanation: "", changed: next !== sql };
}

function buildIdentifierVariants(identifier: string): string[] {
  const variants = new Set<string>([identifier]);
  const snakeCase = identifier.replace(/[^A-Za-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  const compact = identifier.replace(/[^A-Za-z0-9]+/g, "");

  if (snakeCase) {
    variants.add(snakeCase);
  }

  if (compact) {
    variants.add(compact);
  }

  return [...variants];
}

function levenshteinDistance(a: string, b: string): number {
  if (a === b) {
    return 0;
  }

  if (a.length === 0) {
    return b.length;
  }

  if (b.length === 0) {
    return a.length;
  }

  const previous = Array.from({ length: b.length + 1 }, (_, index) => index);

  for (let i = 1; i <= a.length; i += 1) {
    let diagonal = previous[0];
    previous[0] = i;

    for (let j = 1; j <= b.length; j += 1) {
      const temp = previous[j];
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      previous[j] = Math.min(previous[j] + 1, previous[j - 1] + 1, diagonal + cost);
      diagonal = temp;
    }
  }

  return previous[b.length];
}

function findBestColumnMatch(identifier: string, columns: ColumnProfile[]): ColumnProfile | null {
  const source = normalizeIdentifier(identifier);

  if (!source || SQL_KEYWORDS.has(source)) {
    return null;
  }

  let bestScore = 0;
  let bestMatch: ColumnProfile | null = null;

  for (const column of columns) {
    const target = normalizeIdentifier(column.name);

    if (!target) {
      continue;
    }

    if (source === target) {
      return column;
    }

    const distance = levenshteinDistance(source, target);
    const maxLength = Math.max(source.length, target.length, 1);
    let score = 1 - distance / maxLength;

    if (source.includes(target) || target.includes(source)) {
      score += 0.15;
    }

    if (score > bestScore) {
      bestScore = score;
      bestMatch = column;
    }
  }

  return bestScore >= 0.58 ? bestMatch : null;
}

function extractLikelyErrorIdentifiers(error: string): string[] {
  const identifiers = new Set<string>();
  const quotedMatches = error.matchAll(/"([^"]+)"|'([^']+)'|`([^`]+)`|\[([^\]]+)\]/g);

  for (const match of quotedMatches) {
    const identifier = match[1] ?? match[2] ?? match[3] ?? match[4];
    if (identifier && normalizeIdentifier(identifier)) {
      identifiers.add(identifier);
    }
  }

  const plainMatches = error.matchAll(
    /\b(?:column|table|identifier)\s+([A-Za-z_][A-Za-z0-9_ ]*)/gi
  );

  for (const match of plainMatches) {
    const identifier = match[1]?.trim();
    if (identifier && normalizeIdentifier(identifier)) {
      identifiers.add(identifier);
    }
  }

  return [...identifiers].filter((identifier) => !SQL_KEYWORDS.has(identifier.toLowerCase()));
}

function applyDuckDbCompatibilityFixes(sql: string): { fixedSql: string; fixes: string[] } {
  let fixedSql = sql;
  const fixes: string[] = [];

  const standardQuotes = fixedSql
    .replace(/`([^`]+)`/g, (_match, identifier: string) => quoteIdentifier(identifier))
    .replace(/\[([^\]]+)\]/g, (_match, identifier: string) => quoteIdentifier(identifier));

  if (standardQuotes !== fixedSql) {
    fixedSql = standardQuotes;
    fixes.push("converted identifier quotes to DuckDB double quotes");
  }

  const topMatch = fixedSql.match(/\bSELECT\s+(DISTINCT\s+)?TOP\s+(\d+)\s+/i);
  if (topMatch) {
    fixedSql = fixedSql.replace(/\bSELECT\s+(DISTINCT\s+)?TOP\s+(\d+)\s+/i, "SELECT $1");
    if (!/\bLIMIT\s+\d+\b/i.test(fixedSql)) {
      fixedSql = `${fixedSql.trim()} LIMIT ${topMatch[2]}`;
    }
    fixes.push("replaced SELECT TOP with LIMIT");
  }

  const replacements: Array<[RegExp, string, string]> = [
    [/\bLEN\s*\(/gi, "LENGTH(", "changed LEN() to DuckDB LENGTH()"],
    [/\bISNULL\s*\(/gi, "COALESCE(", "changed ISNULL() to COALESCE()"],
    [/\bNVL\s*\(/gi, "COALESCE(", "changed NVL() to COALESCE()"],
    [/\bGETDATE\s*\(\s*\)/gi, "CURRENT_TIMESTAMP", "changed GETDATE() to CURRENT_TIMESTAMP"],
    [/\bTODAY\s*\(\s*\)/gi, "CURRENT_DATE", "changed TODAY() to CURRENT_DATE"],
  ];

  for (const [pattern, replacement, explanation] of replacements) {
    const next = fixedSql.replace(pattern, replacement);
    if (next !== fixedSql) {
      fixedSql = next;
      fixes.push(explanation);
    }
  }

  const datePartFixed = fixedSql
    .replace(/\bDATEPART\s*\(\s*([A-Za-z_]+)\s*,/gi, (_match, part: string) => `DATE_PART('${part.toLowerCase()}',`)
    .replace(/\bDATEDIFF\s*\(\s*([A-Za-z_]+)\s*,/gi, (_match, part: string) => `DATE_DIFF('${part.toLowerCase()}',`);

  if (datePartFixed !== fixedSql) {
    fixedSql = datePartFixed;
    fixes.push("converted DATEPART or DATEDIFF syntax to DuckDB equivalents");
  }

  if (fixedSql.includes("==")) {
    fixedSql = fixedSql.replace(/==/g, "=");
    fixes.push("replaced == with =");
  }

  return { fixedSql, fixes };
}

function applyFallbackFixes(
  sql: string,
  error: string,
  tableName: string,
  columns: ColumnProfile[]
): FixResult {
  let fixedSql = stripCodeFences(sql);
  const fixes = new Set<string>();

  const compatibility = applyDuckDbCompatibilityFixes(fixedSql);
  fixedSql = compatibility.fixedSql;
  for (const fix of compatibility.fixes) {
    fixes.add(fix);
  }

  for (const variant of buildIdentifierVariants(tableName)) {
    const replaced = replaceIdentifierReferences(fixedSql, variant, quoteIdentifier(tableName));
    if (replaced.changed) {
      fixedSql = replaced.fixedSql;
      fixes.add("quoted the table identifier");
    }
  }

  for (const column of columns) {
    if (!needsQuoting(column.name)) {
      continue;
    }

    for (const variant of buildIdentifierVariants(column.name)) {
      const replaced = replaceIdentifierReferences(fixedSql, variant, quoteIdentifier(column.name));
      if (replaced.changed) {
        fixedSql = replaced.fixedSql;
        fixes.add(`quoted the column identifier ${quoteIdentifier(column.name)}`);
      }
    }
  }

  for (const identifier of extractLikelyErrorIdentifiers(error)) {
    const normalized = normalizeIdentifier(identifier);

    if (!normalized) {
      continue;
    }

    const tableScore =
      1 -
      levenshteinDistance(normalized, normalizeIdentifier(tableName)) /
        Math.max(normalized.length, normalizeIdentifier(tableName).length, 1);

    if (tableScore >= 0.72) {
      const replaced = replaceIdentifierReferences(fixedSql, identifier, quoteIdentifier(tableName));
      if (replaced.changed) {
        fixedSql = replaced.fixedSql;
        fixes.add(`corrected the table name to ${quoteIdentifier(tableName)}`);
        continue;
      }
    }

    const bestColumn = findBestColumnMatch(identifier, columns);
    if (!bestColumn) {
      continue;
    }

    const replacement = quoteIdentifier(bestColumn.name);
    const replaced = replaceIdentifierReferences(fixedSql, identifier, replacement);

    if (replaced.changed) {
      fixedSql = replaced.fixedSql;
      fixes.add(`corrected ${quoteIdentifier(identifier)} to ${replacement}`);
    }
  }

  if (fixes.size === 0) {
    return {
      fixedSql,
      explanation:
        "No confident schema-specific repair was found, so the SQL was only normalized for DuckDB compatibility.",
    };
  }

  return {
    fixedSql,
    explanation: `Applied fallback fixes: ${formatList([...fixes])}.`,
  };
}

function parseAiFixResponse(response: string): FixResult | null {
  const cleaned = stripCodeFences(response);
  const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
  const candidate = jsonMatch ? jsonMatch[0] : cleaned;

  try {
    const parsed = JSON.parse(candidate) as Partial<FixResult>;
    if (typeof parsed.fixedSql === "string" && typeof parsed.explanation === "string") {
      return {
        fixedSql: stripCodeFences(parsed.fixedSql).trim(),
        explanation: parsed.explanation.trim(),
      };
    }
  } catch {
    return null;
  }

  return null;
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const {
      sql,
      error,
      tableName,
      columns,
    }: {
      sql?: string;
      error?: string;
      tableName?: string;
      columns?: ColumnProfile[];
    } = body;

    if (!sql?.trim() || !error?.trim() || !tableName?.trim() || !Array.isArray(columns)) {
      return NextResponse.json(
        { error: "Missing required fields: sql, error, tableName, columns" },
        { status: 400 }
      );
    }

    const fallback = applyFallbackFixes(sql, error, tableName, columns);

    if (await checkOllamaHealth()) {
      try {
        const response = await chat([
          {
            role: "system",
            content:
              'You fix broken DuckDB SQL queries. Return ONLY a JSON object with this exact shape: {"fixedSql":"...","explanation":"..."}. Preserve the original intent, use DuckDB syntax, and always use double quotes around table and column identifiers.',
          },
          {
            role: "user",
            content: `Fix this SQL query.\n\nSQL:\n${sql}\n\nError:\n${error}\n\nTable: "${tableName}"\nColumns:\n${formatSchema(
              columns
            )}`,
          },
        ]);

        const parsed = parseAiFixResponse(response);
        if (parsed?.fixedSql && parsed.explanation) {
          return NextResponse.json({ ...parsed, mode: "ai" });
        }
      } catch (aiError) {
        console.error("AI fix error, using fallback:", aiError);
      }
    }

    return NextResponse.json({ ...fallback, mode: "fallback" });
  } catch (error) {
    console.error("AI fix route error:", error);
    return NextResponse.json({ error: "Failed to fix SQL query." }, { status: 500 });
  }
}
