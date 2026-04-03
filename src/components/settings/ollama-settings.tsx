"use client";

import { useMemo, useState } from "react";
import { motion } from "framer-motion";
import {
  Bot,
  Cable,
  CheckCircle2,
  RefreshCw,
  Save,
  SlidersHorizontal,
} from "lucide-react";
import {
  ANALYTICS_EASE,
  BUTTON_CLASS,
  FIELD_CLASS,
  GLASS_CARD_CLASS,
  GLASS_PANEL_CLASS,
} from "@/lib/utils/advanced-analytics";
import {
  checkOllamaConnection,
  DEFAULT_OLLAMA_SETTINGS,
  loadOllamaSettings,
  saveOllamaSettings,
  sanitizeOllamaUrl,
  type OllamaConnectionState,
  type OllamaSettingsState,
} from "@/lib/ai/ollama-settings";

function StatusBadge({ status }: { status: OllamaConnectionState }) {
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

export default function OllamaSettings() {
  const [settings, setSettings] = useState<OllamaSettingsState>(() => loadOllamaSettings());
  const [status, setStatus] = useState<OllamaConnectionState>({
    kind: "idle",
    message: "Connection has not been checked yet.",
  });

  const modelOptions = useMemo(() => {
    const unique = new Set(settings.availableModels);
    if (settings.model.trim().length > 0) {
      unique.add(settings.model);
    }
    return Array.from(unique);
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

  async function handleConnectionTest() {
    const normalizedUrl = sanitizeOllamaUrl(settings.url);
    setStatus({
      kind: "checking",
      message: `Checking ${normalizedUrl}…`,
    });

    const result = await checkOllamaConnection(normalizedUrl);
    setStatus({
      kind: result.kind,
      message: result.message,
    });

    if (result.models.length > 0) {
      const availableModels = Array.from(result.models);

      setSettings((current): OllamaSettingsState => ({
        ...current,
        url: normalizedUrl,
        model: availableModels.includes(current.model)
          ? current.model
          : availableModels[0] ?? current.model,
        availableModels,
      }));
    }
  }

  function handleSave() {
    const normalized: OllamaSettingsState = {
      ...settings,
      url: sanitizeOllamaUrl(settings.url),
      availableModels: modelOptions,
      temperature: Number(settings.temperature.toFixed(2)),
      maxTokens: Math.round(settings.maxTokens),
      systemPrompt: settings.systemPrompt.trim() || DEFAULT_OLLAMA_SETTINGS.systemPrompt,
    };

    saveOllamaSettings(normalized);
    setSettings(normalized);
    setStatus({
      kind: "idle",
      message: "Ollama settings saved to localStorage.",
    });
  }

  return (
    <section className={`${GLASS_PANEL_CLASS} overflow-hidden p-6`}>
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <div className="inline-flex items-center gap-2 rounded-full bg-cyan-500/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-cyan-700 dark:text-cyan-300">
            <Bot className="h-3.5 w-3.5" />
            Ollama settings
          </div>
          <h2 className="mt-3 text-2xl font-semibold text-slate-950 dark:text-white">
            Configure the local model endpoint used across AI features
          </h2>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600 dark:text-slate-300">
            Set the Ollama server URL, choose a default model, tune generation options, and save
            the system prompt used by DataLens AI components.
          </p>
        </div>

        <div className={`${GLASS_CARD_CLASS} max-w-md p-4`}>
          <div className="flex items-center gap-3">
            <Cable className="h-5 w-5 text-cyan-500" />
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
                Connection status
              </p>
              <div className="mt-2 flex items-center gap-2">
                <StatusBadge status={status} />
              </div>
              <p className="mt-2 text-sm leading-6 text-slate-600 dark:text-slate-300">
                {status.message}
              </p>
            </div>
          </div>
        </div>
      </div>

      <div className="mt-6 grid gap-5 xl:grid-cols-3">
        <div className={`${GLASS_CARD_CLASS} p-5 xl:col-span-2`}>
          <div className="mb-4 flex items-center gap-3">
            <div className="rounded-2xl bg-cyan-500/10 p-2.5 text-cyan-700 dark:text-cyan-300">
              <Cable className="h-4 w-4" />
            </div>
            <h3 className="text-base font-semibold text-slate-950 dark:text-white">Connection</h3>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <label className="md:col-span-2">
              <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
                Ollama URL
              </span>
              <input
                value={settings.url}
                onChange={(event) => updateSetting("url", event.target.value)}
                className={FIELD_CLASS}
                placeholder="http://localhost:11434"
              />
            </label>

            <label>
              <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
                Default model
              </span>
              <select
                value={settings.model}
                onChange={(event) => updateSetting("model", event.target.value)}
                className={FIELD_CLASS}
              >
                {modelOptions.length === 0 ? (
                  <option value={settings.model}>{settings.model || "No models loaded"}</option>
                ) : (
                  modelOptions.map((model) => (
                    <option key={model} value={model}>
                      {model}
                    </option>
                  ))
                )}
              </select>
            </label>

            <div className="flex items-end">
              <button type="button" onClick={handleConnectionTest} className={`${BUTTON_CLASS} w-full justify-center`}>
                <RefreshCw className="h-4 w-4" />
                Test connection
              </button>
            </div>
          </div>
        </div>

        <div className={`${GLASS_CARD_CLASS} p-5`}>
          <div className="mb-4 flex items-center gap-3">
            <div className="rounded-2xl bg-cyan-500/10 p-2.5 text-cyan-700 dark:text-cyan-300">
              <SlidersHorizontal className="h-4 w-4" />
            </div>
            <h3 className="text-base font-semibold text-slate-950 dark:text-white">Generation</h3>
          </div>

          <div className="space-y-5">
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

            <label className="block">
              <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
                Max tokens
              </span>
              <input
                type="range"
                min={128}
                max={8192}
                step={128}
                value={settings.maxTokens}
                onChange={(event) => updateSetting("maxTokens", Number(event.target.value))}
                className="w-full accent-cyan-500"
              />
              <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">
                {Math.round(settings.maxTokens)} tokens
              </p>
            </label>
          </div>
        </div>
      </div>

      <div className={`${GLASS_CARD_CLASS} mt-5 p-5`}>
        <div className="mb-4 flex items-center gap-3">
          <div className="rounded-2xl bg-cyan-500/10 p-2.5 text-cyan-700 dark:text-cyan-300">
            <CheckCircle2 className="h-4 w-4" />
          </div>
          <h3 className="text-base font-semibold text-slate-950 dark:text-white">System prompt</h3>
        </div>

        <textarea
          value={settings.systemPrompt}
          onChange={(event) => updateSetting("systemPrompt", event.target.value)}
          className={`${FIELD_CLASS} min-h-36 resize-none`}
        />

        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.24, ease: ANALYTICS_EASE }}
          className="mt-5 flex flex-wrap gap-3"
        >
          <button type="button" onClick={handleSave} className={BUTTON_CLASS}>
            <Save className="h-4 w-4" />
            Save settings
          </button>
        </motion.div>
      </div>
    </section>
  );
}
