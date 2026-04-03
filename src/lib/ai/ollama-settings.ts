"use client";

export interface OllamaSettingsState {
  url: string;
  model: string;
  temperature: number;
  maxTokens: number;
  systemPrompt: string;
  availableModels: string[];
}

export interface OllamaConnectionState {
  kind: "idle" | "checking" | "connected" | "error";
  message: string;
}

export interface OllamaConnectionCheckResult {
  kind: "connected" | "error";
  message: string;
  models: string[];
}

interface OllamaTagsResponse {
  models: Array<{ name: string }>;
}

interface OllamaChatResponse {
  message: {
    content: string;
  };
}

const STORAGE_KEYS = {
  url: "datalens-ollama-url",
  model: "datalens-ollama-model",
  temperature: "datalens-ollama-temperature",
  maxTokens: "datalens-ollama-max-tokens",
  systemPrompt: "datalens-ollama-system-prompt",
  availableModels: "datalens-ollama-model-cache",
} as const;

export const DEFAULT_OLLAMA_SETTINGS: OllamaSettingsState = {
  url: "http://localhost:11434",
  model: "llama3.2",
  temperature: 0.2,
  maxTokens: 2048,
  systemPrompt:
    "You are DataLens AI. Explain datasets clearly, stay concise, and prefer actionable analytical guidance.",
  availableModels: [],
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === "string");
}

function isOllamaTagsResponse(value: unknown): value is OllamaTagsResponse {
  if (!isRecord(value) || !Array.isArray(value.models)) {
    return false;
  }

  return value.models.every((model) => isRecord(model) && typeof model.name === "string");
}

function isOllamaChatResponse(value: unknown): value is OllamaChatResponse {
  return (
    isRecord(value) &&
    isRecord(value.message) &&
    typeof value.message.content === "string"
  );
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function readString(key: string, fallback: string) {
  if (typeof window === "undefined") return fallback;
  const value = window.localStorage.getItem(key);
  return value && value.trim().length > 0 ? value : fallback;
}

function readNumber(key: string, fallback: number, min: number, max: number) {
  if (typeof window === "undefined") return fallback;
  const raw = window.localStorage.getItem(key);
  const parsed = raw ? Number(raw) : Number.NaN;
  return Number.isFinite(parsed) ? clamp(parsed, min, max) : fallback;
}

function readModelsCache() {
  if (typeof window === "undefined") return DEFAULT_OLLAMA_SETTINGS.availableModels;

  try {
    const raw = window.localStorage.getItem(STORAGE_KEYS.availableModels);
    if (!raw) return DEFAULT_OLLAMA_SETTINGS.availableModels;
    const parsed: unknown = JSON.parse(raw);
    return isStringArray(parsed) ? parsed : DEFAULT_OLLAMA_SETTINGS.availableModels;
  } catch {
    return DEFAULT_OLLAMA_SETTINGS.availableModels;
  }
}

export function sanitizeOllamaUrl(value: string) {
  const trimmed = value.trim();
  return (trimmed || DEFAULT_OLLAMA_SETTINGS.url).replace(/\/+$/, "");
}

export function loadOllamaSettings(): OllamaSettingsState {
  return {
    url: sanitizeOllamaUrl(readString(STORAGE_KEYS.url, DEFAULT_OLLAMA_SETTINGS.url)),
    model: readString(STORAGE_KEYS.model, DEFAULT_OLLAMA_SETTINGS.model),
    temperature: readNumber(
      STORAGE_KEYS.temperature,
      DEFAULT_OLLAMA_SETTINGS.temperature,
      0,
      1,
    ),
    maxTokens: readNumber(
      STORAGE_KEYS.maxTokens,
      DEFAULT_OLLAMA_SETTINGS.maxTokens,
      128,
      8192,
    ),
    systemPrompt: readString(
      STORAGE_KEYS.systemPrompt,
      DEFAULT_OLLAMA_SETTINGS.systemPrompt,
    ),
    availableModels: readModelsCache(),
  };
}

export function saveOllamaSettings(settings: OllamaSettingsState) {
  if (typeof window === "undefined") return;

  const normalized = {
    ...settings,
    url: sanitizeOllamaUrl(settings.url),
    temperature: clamp(settings.temperature, 0, 1),
    maxTokens: Math.round(clamp(settings.maxTokens, 128, 8192)),
    availableModels: Array.from(new Set(settings.availableModels)).filter(
      (model) => model.trim().length > 0,
    ),
  } satisfies OllamaSettingsState;

  window.localStorage.setItem(STORAGE_KEYS.url, normalized.url);
  window.localStorage.setItem(STORAGE_KEYS.model, normalized.model);
  window.localStorage.setItem(
    STORAGE_KEYS.temperature,
    normalized.temperature.toString(),
  );
  window.localStorage.setItem(
    STORAGE_KEYS.maxTokens,
    normalized.maxTokens.toString(),
  );
  window.localStorage.setItem(
    STORAGE_KEYS.systemPrompt,
    normalized.systemPrompt,
  );
  window.localStorage.setItem(
    STORAGE_KEYS.availableModels,
    JSON.stringify(normalized.availableModels),
  );
}

export async function fetchOllamaModels(baseUrl: string): Promise<string[]> {
  const response = await fetch(`${sanitizeOllamaUrl(baseUrl)}/api/tags`, {
    method: "GET",
    signal: AbortSignal.timeout(4000),
  });

  if (!response.ok) {
    throw new Error(`Ollama responded with ${response.status}.`);
  }

  const payload: unknown = await response.json();
  if (!isOllamaTagsResponse(payload)) {
    throw new Error("Ollama returned an unexpected model list.");
  }

  return payload.models.map((model) => model.name);
}

export async function checkOllamaConnection(
  baseUrl: string,
): Promise<OllamaConnectionCheckResult> {
  try {
    const models = await fetchOllamaModels(baseUrl);
    return {
      kind: "connected",
      message: models.length
        ? `Connected. ${models.length} model${models.length === 1 ? "" : "s"} available.`
        : "Connected, but no models were returned.",
      models,
    };
  } catch (error) {
    return {
      kind: "error",
      message:
        error instanceof Error ? error.message : "Unable to reach the Ollama server.",
      models: [],
    };
  }
}

export async function generateOllamaText({
  baseUrl,
  model,
  prompt,
  systemPrompt,
  temperature,
  maxTokens,
}: {
  baseUrl: string;
  model: string;
  prompt: string;
  systemPrompt: string;
  temperature: number;
  maxTokens: number;
}): Promise<string> {
  const response = await fetch(`${sanitizeOllamaUrl(baseUrl)}/api/chat`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      stream: false,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: prompt },
      ],
      options: {
        temperature: clamp(temperature, 0, 1),
        num_predict: Math.round(clamp(maxTokens, 128, 8192)),
      },
    }),
    signal: AbortSignal.timeout(20_000),
  });

  if (!response.ok) {
    throw new Error(`Ollama responded with ${response.status}.`);
  }

  const payload: unknown = await response.json();
  if (!isOllamaChatResponse(payload)) {
    throw new Error("Ollama returned an unexpected chat payload.");
  }

  return payload.message.content.trim();
}
