import { NextResponse } from "next/server";
import { generateSQL } from "@/lib/ai/sql-generator";
import { generateFallbackSQL } from "@/lib/ai/fallback";
import { checkOllamaHealth } from "@/lib/ai/ollama-client";
import { requireAuth } from "@/lib/auth/require-auth";
import { logger } from "@/lib/logger";
import type { ColumnProfile } from "@/types/dataset";

export async function POST(request: Request) {
  const auth = await requireAuth(request);
  if (auth instanceof NextResponse) return auth;

  try {
    const body = await request.json();
    const {
      question,
      tableName,
      columns,
    }: {
      question: string;
      tableName: string;
      columns: ColumnProfile[];
    } = body;

    if (!question || !tableName || !columns) {
      return NextResponse.json(
        { error: "Missing required fields" },
        { status: 400 }
      );
    }

    // Try Ollama first, fall back to rule-based SQL generation
    const ollamaOk = await checkOllamaHealth();

    let sql: string;
    if (ollamaOk) {
      sql = await generateSQL(question, tableName, columns);
    } else {
      const fallback = generateFallbackSQL(question, tableName, columns);
      if (!fallback) {
        return NextResponse.json(
          { error: "Could not generate query. Try rephrasing or start Ollama for AI-powered queries." },
          { status: 400 }
        );
      }
      sql = fallback;
    }

    return NextResponse.json({ sql, mode: ollamaOk ? "ai" : "fallback" });
  } catch (error) {
    logger.error("AI query error", { error });
    return NextResponse.json(
      { error: "Failed to generate query. Is Ollama running?" },
      { status: 500 }
    );
  }
}
