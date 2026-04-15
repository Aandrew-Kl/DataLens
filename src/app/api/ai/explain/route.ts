import { NextResponse } from "next/server";
import { chat, checkOllamaHealth } from "@/lib/ai/ollama-client";
import { requireAuth } from "@/lib/auth/require-auth";
import { logger } from "@/lib/logger";

function stripCodeFences(value: string): string {
  return value
    .trim()
    .replace(/^```(?:text|markdown|sql)?\s*/i, "")
    .replace(/\s*```$/, "")
    .trim();
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

function cleanIdentifier(identifier: string): string {
  return identifier.replace(/^["`[]|["`\]]$/g, "").trim();
}

function extractTableNames(sql: string): string[] {
  const tables = new Set<string>();
  const matches = sql.matchAll(
    /\b(?:from|join)\s+((?:"[^"]+")|(?:`[^`]+`)|(?:\[[^\]]+\])|(?:[A-Za-z_][A-Za-z0-9_$.]*))/gi
  );

  for (const match of matches) {
    const identifier = cleanIdentifier(match[1] ?? "");
    if (identifier) {
      tables.add(identifier);
    }
  }

  return [...tables];
}

function generateFallbackExplanation(sql: string): string {
  const normalized = sql.replace(/\s+/g, " ").trim();
  const tables = extractTableNames(normalized);
  const actions: string[] = [];

  if (/\bjoin\b/i.test(normalized)) {
    actions.push("combining data from multiple tables");
  }

  if (/\bwhere\b/i.test(normalized)) {
    actions.push("filtering rows");
  }

  if (/\bgroup\s+by\b/i.test(normalized)) {
    actions.push("grouping similar records");
  }

  if (/\border\s+by\b/i.test(normalized)) {
    actions.push("sorting the results");
  }

  if (/\b(?:count|sum|avg)\s*\(/i.test(normalized)) {
    actions.push("calculating summary values");
  }

  if (/\blimit\b/i.test(normalized)) {
    actions.push("limiting how many rows are returned");
  }

  const sourceClause =
    tables.length > 0 ? ` from ${formatList(tables.map((table) => `"${table}"`))}` : "";
  const sentences = [`This query is fetching data${sourceClause}.`];

  if (actions.length === 0) {
    sentences.push("It returns the selected columns without additional filtering or aggregation.");
    return sentences.join(" ");
  }

  sentences.push(`It is also ${formatList(actions.slice(0, 3))}.`);

  if (actions.length > 3) {
    sentences.push(`It additionally handles ${formatList(actions.slice(3))}.`);
  }

  return sentences.join(" ");
}

export async function POST(request: Request) {
  const auth = await requireAuth(request);
  if (auth instanceof NextResponse) return auth;

  try {
    const body = await request.json();
    const { sql }: { sql?: string } = body;

    if (!sql?.trim()) {
      return NextResponse.json({ error: "Missing required field: sql" }, { status: 400 });
    }

    const fallbackExplanation = generateFallbackExplanation(sql);

    if (await checkOllamaHealth()) {
      try {
        const explanation = stripCodeFences(
          await chat([
            {
              role: "system",
              content:
                "You explain SQL queries in plain English. Reply in 2-3 concise sentences with no markdown.",
            },
            {
              role: "user",
              content: `Explain what this SQL query does:\n\n${sql}`,
            },
          ])
        );

        if (explanation) {
          return NextResponse.json({ explanation, mode: "ai" });
        }
      } catch (error) {
        logger.warn("AI explain error, using fallback", { error });
      }
    }

    return NextResponse.json({ explanation: fallbackExplanation, mode: "fallback" });
  } catch (error) {
    logger.error("AI explain route error", { error });
    return NextResponse.json({ error: "Failed to explain SQL query." }, { status: 500 });
  }
}
