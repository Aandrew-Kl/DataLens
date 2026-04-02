import { NextResponse } from "next/server";
import { generateSQL, recommendChart, generateSummary } from "@/lib/ai/sql-generator";
import type { ColumnProfile } from "@/types/dataset";

export async function POST(request: Request) {
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

    // Generate SQL
    const sql = await generateSQL(question, tableName, columns);

    return NextResponse.json({ sql });
  } catch (error) {
    console.error("AI query error:", error);
    return NextResponse.json(
      { error: "Failed to generate query. Is Ollama running?" },
      { status: 500 }
    );
  }
}
