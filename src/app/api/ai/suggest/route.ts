import { NextResponse } from "next/server";
import { chat, checkOllamaHealth } from "@/lib/ai/ollama-client";
import { suggestQuestionsPrompt, autoDashboardPrompt } from "@/lib/ai/prompts";
import { generateFallbackQuestions, generateFallbackDashboard } from "@/lib/ai/fallback";
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

    const ollamaOk = await checkOllamaHealth();

    if (type === "questions") {
      if (!ollamaOk) {
        // Fallback: generate questions from schema analysis
        const questions = generateFallbackQuestions(tableName, columns);
        return NextResponse.json({ questions, mode: "fallback" });
      }

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
        questions = generateFallbackQuestions(tableName, columns);
      }

      return NextResponse.json({ questions, mode: "ai" });
    }

    if (type === "dashboard") {
      if (!ollamaOk) {
        // Fallback: generate dashboard from schema analysis
        const dashboard = generateFallbackDashboard(tableName, columns, rowCount);
        return NextResponse.json({ ...dashboard, mode: "fallback" });
      }

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
        dashboard = generateFallbackDashboard(tableName, columns, rowCount);
      }

      return NextResponse.json({ ...dashboard, mode: ollamaOk ? "ai" : "fallback" });
    }

    return NextResponse.json({ error: "Invalid type" }, { status: 400 });
  } catch (error) {
    console.error("AI suggest error:", error);
    // On any error, try fallback
    try {
      const body = await request.clone().json();
      const { type, tableName, columns, rowCount } = body;
      if (type === "questions") {
        return NextResponse.json({ questions: generateFallbackQuestions(tableName, columns), mode: "fallback" });
      }
      if (type === "dashboard") {
        return NextResponse.json({ ...generateFallbackDashboard(tableName, columns, rowCount), mode: "fallback" });
      }
    } catch {
      // ignore
    }
    return NextResponse.json(
      { error: "Failed to generate suggestions." },
      { status: 500 }
    );
  }
}
