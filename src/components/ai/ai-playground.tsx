"use client";

import { useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Bot, ClipboardCopy, Eraser, RefreshCw, Send } from "lucide-react";
import {
  ANALYTICS_EASE,
  BUTTON_CLASS,
  FIELD_CLASS,
  GLASS_CARD_CLASS,
  GLASS_PANEL_CLASS,
} from "@/lib/utils/advanced-analytics";
import {
  checkOllamaConnection,
  generateOllamaText,
  loadOllamaSettings,
  saveOllamaSettings,
  type OllamaConnectionState,
  type OllamaSettingsState,
} from "@/lib/ai/ollama-settings";

interface PlaygroundHistoryEntry {
  id: string;
  prompt: string;
  response: string;
  model: string;
  createdAt: number;
}

const STORAGE_KEY = "datalens-ai-playground-history";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function createId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function readHistory(): PlaygroundHistoryEntry[] {
  if (typeof window === "undefined") return [];

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];

    return parsed.flatMap<PlaygroundHistoryEntry>((entry) => {
      if (!isRecord(entry)) return [];
      return [
        {
          id: typeof entry.id === "string" ? entry.id : createId(),
          prompt: typeof entry.prompt === "string" ? entry.prompt : "",
          response: typeof entry.response === "string" ? entry.response : "",
          model: typeof entry.model === "string" ? entry.model : "unknown",
          createdAt: Number.isFinite(Number(entry.createdAt))
            ? Number(entry.createdAt)
            : Date.now(),
        },
      ].filter((row) => row.prompt.trim().length > 0 || row.response.trim().length > 0);
    });
  } catch {
    return [];
  }
}

function persistHistory(history: PlaygroundHistoryEntry[]) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(history.slice(0, 12)));
}

function ConnectionBadge({ status }: { status: OllamaConnectionState }) {
  const className =
    status.kind === "connected"
      ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300"
      : status.kind === "error"
        ? "bg-rose-500/15 text-rose-700 dark:text-rose-300"
        : status.kind === "checking"
          ? "bg-amber-500/15 text-amber-700 dark:text-amber-300"
          : "bg-slate-200/70 text-slate-600 dark:bg-slate-800/70 dark:text-slate-300";

  return (
    <span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] ${className}`}>
      {status.kind}
    </span>
  );
}

export default function AiPlayground() {
  const [settings, setSettings] = useState<OllamaSettingsState>(() => loadOllamaSettings());
  const [prompt, setPrompt] = useState("Summarize the most interesting signals this dataset might contain.");
  const [response, setResponse] = useState("");
  const [history, setHistory] = useState<PlaygroundHistoryEntry[]>(() => readHistory());
  const [status, setStatus] = useState<OllamaConnectionState>({
    kind: "idle",
    message: "Connection not checked yet.",
  });
  const [loading, setLoading] = useState(false);

  const modelOptions = useMemo(() => {
    const models = new Set(settings.availableModels);
    if (settings.model.trim().length > 0) {
      models.add(settings.model);
    }
    return Array.from(models);
  }, [settings.availableModels, settings.model]);

  function updateSetting<K extends keyof OllamaSettingsState>(
    key: K,
    value: OllamaSettingsState[K],
  ) {
    setSettings((current) => ({
      ...current,
      [key]: value,
    }));
  }

  async function refreshConnection() {
    setStatus({
      kind: "checking",
      message: "Checking Ollama availability…",
    });

    const result = await checkOllamaConnection(settings.url);
    setStatus({
      kind: result.kind,
      message: result.message,
    });

    if (result.models.length > 0) {
      setSettings((current) => ({
        ...current,
        availableModels: result.models,
        model: result.models.includes(current.model) ? current.model : result.models[0] ?? current.model,
      }));
    }
  }

  async function handleRun() {
    if (!prompt.trim()) return;

    setLoading(true);
    setStatus({
      kind: "checking",
      message: "Validating Ollama connection before sending the prompt…",
    });

    const connection = await checkOllamaConnection(settings.url);
    if (connection.kind !== "connected") {
      setStatus({
        kind: connection.kind,
        message: connection.message,
      });
      setLoading(false);
      return;
    }

    setStatus({
      kind: "connected",
      message: connection.message,
    });

    const normalizedSettings: OllamaSettingsState = {
      ...settings,
      availableModels: connection.models.length > 0 ? connection.models : settings.availableModels,
      model: connection.models.includes(settings.model) ? settings.model : connection.models[0] ?? settings.model,
    };
    setSettings(normalizedSettings);
    saveOllamaSettings(normalizedSettings);

    try {
      const nextResponse = await generateOllamaText({
        baseUrl: normalizedSettings.url,
        model: normalizedSettings.model,
        prompt: prompt.trim(),
        systemPrompt: normalizedSettings.systemPrompt,
        temperature: normalizedSettings.temperature,
        maxTokens: normalizedSettings.maxTokens,
      });

      const entry: PlaygroundHistoryEntry = {
        id: createId(),
        prompt: prompt.trim(),
        response: nextResponse,
        model: normalizedSettings.model,
        createdAt: Date.now(),
      };

      setResponse(nextResponse);
      setHistory((current) => {
        const next = [entry, ...current].slice(0, 12);
        persistHistory(next);
        return next;
      });
    } catch (requestError) {
      setStatus({
        kind: "error",
        message:
          requestError instanceof Error
            ? requestError.message
            : "The playground request failed.",
      });
    } finally {
      setLoading(false);
    }
  }

  async function copyResponse() {
    if (!response.trim()) return;
    await navigator.clipboard.writeText(response);
  }

  function clearHistory() {
    setHistory([]);
    persistHistory([]);
  }

  return (
    <section className={`${GLASS_PANEL_CLASS} overflow-hidden p-6`}>
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <div className="inline-flex items-center gap-2 rounded-full bg-cyan-500/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-cyan-700 dark:text-cyan-300">
            <Bot className="h-3.5 w-3.5" />
            AI playground
          </div>
          <h2 className="mt-3 text-2xl font-semibold text-slate-950 dark:text-white">
            Experiment with prompts against the locally configured Ollama model
          </h2>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600 dark:text-slate-300">
            The playground inherits the saved Ollama URL, model, and system prompt, while letting
            you adjust temperature for one-off exploratory responses.
          </p>
        </div>

        <div className={`${GLASS_CARD_CLASS} max-w-md p-4`}>
          <div className="flex items-center gap-3">
            <RefreshCw className="h-5 w-5 text-cyan-500" />
            <div>
              <div className="flex items-center gap-2">
                <ConnectionBadge status={status} />
              </div>
              <p className="mt-2 text-sm leading-6 text-slate-600 dark:text-slate-300">
                {status.message}
              </p>
            </div>
          </div>
        </div>
      </div>

      <div className="mt-6 grid gap-5 xl:grid-cols-[22rem_minmax(0,1fr)]">
        <div className={`${GLASS_CARD_CLASS} p-5`}>
          <div className="space-y-4">
            <label className="block">
              <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
                Model
              </span>
              <select
                value={settings.model}
                onChange={(event) => updateSetting("model", event.target.value)}
                className={FIELD_CLASS}
              >
                {modelOptions.length === 0 ? (
                  <option value={settings.model}>{settings.model}</option>
                ) : (
                  modelOptions.map((model) => (
                    <option key={model} value={model}>
                      {model}
                    </option>
                  ))
                )}
              </select>
            </label>

            <label className="block">
              <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
                Temperature
              </span>
              <input
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={settings.temperature}
                onChange={(event) => updateSetting("temperature", Number(event.target.value))}
                className="w-full accent-cyan-500"
              />
              <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">
                {settings.temperature.toFixed(2)}
              </p>
            </label>

            <div className="flex flex-wrap gap-3">
              <button type="button" onClick={refreshConnection} className={BUTTON_CLASS}>
                <RefreshCw className="h-4 w-4" />
                Refresh status
              </button>
              <button type="button" onClick={clearHistory} className={BUTTON_CLASS}>
                <Eraser className="h-4 w-4" />
                Clear history
              </button>
            </div>
          </div>
        </div>

        <div className="grid gap-5">
          <div className={`${GLASS_CARD_CLASS} p-5`}>
            <label className="block">
              <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
                Prompt
              </span>
              <textarea
                value={prompt}
                onChange={(event) => setPrompt(event.target.value)}
                className={`${FIELD_CLASS} min-h-36 resize-none`}
              />
            </label>

            <div className="mt-5 flex flex-wrap gap-3">
              <button type="button" onClick={handleRun} disabled={loading} className={BUTTON_CLASS}>
                {loading ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                Run prompt
              </button>
              <button type="button" onClick={copyResponse} disabled={!response} className={BUTTON_CLASS}>
                <ClipboardCopy className="h-4 w-4" />
                Copy response
              </button>
            </div>
          </div>

          <div className={`${GLASS_CARD_CLASS} p-5`}>
            <div className="mb-3 text-sm font-semibold text-slate-900 dark:text-white">
              Response
            </div>
            <div className="min-h-48 whitespace-pre-wrap rounded-[1.25rem] border border-white/15 bg-white/55 px-4 py-4 text-sm leading-7 text-slate-700 dark:bg-slate-950/35 dark:text-slate-200">
              {response || "Run a prompt to render the model output here."}
            </div>
          </div>

          <div className={`${GLASS_CARD_CLASS} p-5`}>
            <div className="mb-3 text-sm font-semibold text-slate-900 dark:text-white">
              Prompt history
            </div>
            <AnimatePresence initial={false}>
              {history.length === 0 ? (
                <motion.p
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="text-sm text-slate-600 dark:text-slate-300"
                >
                  No prompts saved yet.
                </motion.p>
              ) : (
                <div className="space-y-3">
                  {history.map((entry) => (
                    <motion.button
                      key={entry.id}
                      type="button"
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -10 }}
                      transition={{ duration: 0.2, ease: ANALYTICS_EASE }}
                      onClick={() => {
                        setPrompt(entry.prompt);
                        setResponse(entry.response);
                      }}
                      className="w-full rounded-[1.25rem] border border-white/15 bg-white/55 px-4 py-4 text-left dark:bg-slate-950/35"
                    >
                      <p className="text-sm font-medium text-slate-900 dark:text-white">
                        {entry.prompt}
                      </p>
                      <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
                        {entry.model} · {new Date(entry.createdAt).toLocaleString()}
                      </p>
                    </motion.button>
                  ))}
                </div>
              )}
            </AnimatePresence>
          </div>
        </div>
      </div>
    </section>
  );
}
