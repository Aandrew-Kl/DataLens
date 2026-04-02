import { NextResponse } from "next/server";
import { checkOllamaHealth, listModels } from "@/lib/ai/ollama-client";

export async function GET() {
  const ollamaOk = await checkOllamaHealth();
  const models = ollamaOk ? await listModels() : [];

  return NextResponse.json({
    status: ollamaOk ? "connected" : "disconnected",
    ollama: ollamaOk,
    models,
  });
}
