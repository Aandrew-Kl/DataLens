import { NextResponse } from "next/server";
import { chat } from "@/lib/ai/ollama-client";
import { suggestQuestionsPrompt, autoDashboardPrompt } from "@/lib/ai/prompts";
import type { ColumnProfile } from "@/types/dataset";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const {
      type,
      tableName,
      columns,
      rowCount,
    }: {
      type: "questions" | "dashboard";
      tableName: string;
      columns: ColumnProfile[];
      rowCount: number;
    } = body;

    if (type === "questions") {
      const messages = suggestQuestionsPrompt(tableName, columns, rowCount);
      const response = await chat(messages);

      let questions: string[];
      try {
        let json = response.trim();
        if (json.startsWith("```")) {
          json = json.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "");
        }
        questions = JSON.parse(json);
      } catch {
        questions = [
          `How many rows are in the dataset?`,
          `What are the unique values in the first column?`,
          `Show the top 10 records.`,
        ];
      }

      return NextResponse.json({ questions });
    }

    if (type === "dashboard") {
      const messages = autoDashboardPrompt(tableName, columns, rowCount);
      const response = await chat(messages);

      let dashboard;
      try {
        let json = response.trim();
        if (json.startsWith("```")) {
          json = json.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "");
        }
        dashboard = JSON.parse(json);
      } catch {
        dashboard = { metrics: [], charts: [] };
      }

      return NextResponse.json(dashboard);
    }

    return NextResponse.json({ error: "Invalid type" }, { status: 400 });
  } catch (error) {
    console.error("AI suggest error:", error);
    return NextResponse.json(
      { error: "Failed to generate suggestions. Is Ollama running?" },
      { status: 500 }
    );
  }
}
