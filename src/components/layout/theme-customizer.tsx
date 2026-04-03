"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ChangeEvent,
} from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  Check,
  Download,
  Moon,
  Palette,
  Settings2,
  Sun,
  Upload,
} from "lucide-react";

type ThemeMode = "light" | "dark" | "system";
type ThemePreset =
  | "Ocean"
  | "Forest"
  | "Sunset"
  | "Midnight"
  | "Lavender"
  | "Monochrome";

interface ThemeSettings {
  preset: ThemePreset;
  accentColor: string;
  fontSize: number;
  radius: number;
  glassmorphism: boolean;
  animations: boolean;
  compactMode: boolean;
  mode: ThemeMode;
}

const STORAGE_KEY = "datalens:theme";
const EASE = [0.22, 1, 0.36, 1] as const;
const CARD_CLASS =
  "rounded-[1.75rem] border border-white/20 bg-white/75 shadow-xl shadow-slate-950/10 backdrop-blur-2xl dark:border-white/10 dark:bg-slate-950/45";
const PRESET_COLORS: Record<ThemePreset, string> = {
  Ocean: "#0891b2",
  Forest: "#15803d",
  Sunset: "#f97316",
  Midnight: "#2563eb",
  Lavender: "#8b5cf6",
  Monochrome: "#475569",
} as const;

const DEFAULT_THEME: ThemeSettings = {
  preset: "Ocean",
  accentColor: PRESET_COLORS.Ocean,
  fontSize: 16,
  radius: 18,
  glassmorphism: true,
  animations: true,
  compactMode: false,
  mode: "system",
};

function subscribeSystemTheme(listener: () => void) {
  if (typeof window === "undefined") return () => undefined;
  const media = window.matchMedia("(prefers-color-scheme: dark)");
  media.addEventListener("change", listener);
  return () => media.removeEventListener("change", listener);
}

function getSystemThemeSnapshot() {
  if (typeof window === "undefined") return false;
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

function readStoredTheme(): ThemeSettings {
  if (typeof window === "undefined") return DEFAULT_THEME;

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_THEME;
    return { ...DEFAULT_THEME, ...(JSON.parse(raw) as Partial<ThemeSettings>) };
  } catch {
    return DEFAULT_THEME;
  }
}

function persistTheme(next: ThemeSettings) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
}

function hexToRgbTriplet(hex: string): string {
  const normalized = hex.replace("#", "");
  if (normalized.length !== 6) return "8 145 178";
  const red = Number.parseInt(normalized.slice(0, 2), 16);
  const green = Number.parseInt(normalized.slice(2, 4), 16);
  const blue = Number.parseInt(normalized.slice(4, 6), 16);
  return `${red} ${green} ${blue}`;
}

function buildThemeCss(theme: ThemeSettings): string {
  const accentRgb = hexToRgbTriplet(theme.accentColor);
  const cardSurface = theme.glassmorphism
    ? "rgba(255,255,255,0.72)"
    : "rgba(255,255,255,0.98)";
  const cardSurfaceDark = theme.glassmorphism
    ? "rgba(2,6,23,0.52)"
    : "rgba(2,6,23,0.92)";

  return `
    :root {
      --datalens-accent: ${theme.accentColor};
      --datalens-accent-rgb: ${accentRgb};
      --datalens-radius: ${theme.radius}px;
      --datalens-font-size: ${theme.fontSize}px;
      --datalens-card-surface: ${cardSurface};
      --datalens-card-surface-dark: ${cardSurfaceDark};
      --datalens-card-border: rgba(var(--datalens-accent-rgb), 0.22);
      --datalens-motion-duration: ${theme.animations ? "320ms" : "0ms"};
      --datalens-space: ${theme.compactMode ? "0.72rem" : "1rem"};
    }

    html {
      font-size: var(--datalens-font-size);
    }

    html[data-datalens-compact="1"] .datalens-compact-target {
      gap: calc(var(--datalens-space) * 0.7);
    }

    .datalens-theme-preview {
      border-radius: calc(var(--datalens-radius) + 10px);
      background:
        radial-gradient(circle at top right, rgba(var(--datalens-accent-rgb), 0.18), transparent 30%),
        linear-gradient(180deg, var(--datalens-card-surface), rgba(255,255,255,0.55));
      border: 1px solid var(--datalens-card-border);
      backdrop-filter: blur(${theme.glassmorphism ? "24px" : "0px"});
      transition:
        transform var(--datalens-motion-duration) ease,
        box-shadow var(--datalens-motion-duration) ease,
        border-color var(--datalens-motion-duration) ease;
      box-shadow: 0 25px 70px rgba(15, 23, 42, 0.12);
    }

    .dark .datalens-theme-preview {
      background:
        radial-gradient(circle at top right, rgba(var(--datalens-accent-rgb), 0.22), transparent 34%),
        linear-gradient(180deg, var(--datalens-card-surface-dark), rgba(2, 6, 23, 0.42));
    }

    .datalens-theme-chip {
      border-radius: calc(var(--datalens-radius) - 6px);
      background: rgba(var(--datalens-accent-rgb), 0.12);
      color: var(--datalens-accent);
    }
  `;
}

function ThemePresetButton({
  active,
  label,
  color,
  onClick,
}: {
  active: boolean;
  label: ThemePreset;
  color: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-[1.1rem] border px-3 py-3 text-left transition ${
        active
          ? "border-white/20 bg-white/70 dark:bg-slate-900/60"
          : "border-white/15 bg-white/45 hover:bg-white/60 dark:bg-slate-900/30 dark:hover:bg-slate-900/45"
      }`}
    >
      <div className="flex items-center gap-3">
        <span
          className="h-4 w-4 rounded-full border border-white/30"
          style={{ backgroundColor: color }}
        />
        <div>
          <p className="text-sm font-semibold text-slate-900 dark:text-slate-50">{label}</p>
          <p className="text-xs text-slate-500 dark:text-slate-400">{color}</p>
        </div>
        {active ? <Check className="ml-auto h-4 w-4 text-emerald-500" /> : null}
      </div>
    </button>
  );
}

function ToggleRow({
  checked,
  description,
  label,
  onChange,
}: {
  checked: boolean;
  description: string;
  label: string;
  onChange: (checked: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between rounded-[1rem] border border-white/15 bg-white/45 px-4 py-3 dark:bg-slate-900/30">
      <div>
        <p className="text-sm font-semibold text-slate-900 dark:text-slate-50">{label}</p>
        <p className="text-xs text-slate-500 dark:text-slate-400">{description}</p>
      </div>
      <button
        type="button"
        onClick={() => onChange(!checked)}
        className={`relative h-7 w-12 rounded-full transition ${
          checked ? "bg-cyan-500" : "bg-slate-300 dark:bg-slate-700"
        }`}
      >
        <span
          className={`absolute top-1 h-5 w-5 rounded-full bg-white transition ${
            checked ? "left-6" : "left-1"
          }`}
        />
      </button>
    </div>
  );
}

function SliderRow({
  label,
  value,
  min,
  max,
  step,
  suffix,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  suffix: string;
  onChange: (value: number) => void;
}) {
  return (
    <div className="rounded-[1rem] border border-white/15 bg-white/45 px-4 py-3 dark:bg-slate-900/30">
      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold text-slate-900 dark:text-slate-50">{label}</p>
        <span className="text-xs text-slate-500 dark:text-slate-400">
          {value}
          {suffix}
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        className="mt-3 w-full accent-cyan-500"
      />
    </div>
  );
}

function ModeButton({
  active,
  icon,
  label,
  onClick,
}: {
  active: boolean;
  icon: typeof Sun;
  label: string;
  onClick: () => void;
}) {
  const Icon = icon;
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center gap-2 rounded-[1rem] border px-3 py-2 text-sm transition ${
        active
          ? "border-cyan-400/40 bg-cyan-500/12 text-cyan-700 dark:text-cyan-300"
          : "border-white/15 bg-white/45 text-slate-600 hover:bg-white/60 dark:bg-slate-900/30 dark:text-slate-300"
      }`}
    >
      <Icon className="h-4 w-4" />
      {label}
    </button>
  );
}

export default function ThemeCustomizer() {
  const importInputRef = useRef<HTMLInputElement | null>(null);
  const systemPrefersDark = useSyncExternalStore(
    subscribeSystemTheme,
    getSystemThemeSnapshot,
    () => false,
  );
  const [theme, setTheme] = useState<ThemeSettings>(() => readStoredTheme());
  const [notice, setNotice] = useState<string | null>(null);

  const resolvedMode: Exclude<ThemeMode, "system"> = useMemo(() => {
    if (theme.mode === "system") {
      return systemPrefersDark ? "dark" : "light";
    }
    return theme.mode;
  }, [systemPrefersDark, theme.mode]);

  const themeCss = useMemo(() => buildThemeCss(theme), [theme]);

  useEffect(() => {
    document.documentElement.classList.toggle("dark", resolvedMode === "dark");
    document.documentElement.dataset.datalensGlass = theme.glassmorphism ? "1" : "0";
    document.documentElement.dataset.datalensAnimations = theme.animations ? "1" : "0";
    document.documentElement.dataset.datalensCompact = theme.compactMode ? "1" : "0";
  }, [resolvedMode, theme.animations, theme.compactMode, theme.glassmorphism]);

  function updateTheme(updater: (current: ThemeSettings) => ThemeSettings) {
    setTheme((current) => {
      const next = updater(current);
      persistTheme(next);
      return next;
    });
  }

  function exportTheme() {
    const blob = new Blob([JSON.stringify(theme, null, 2)], {
      type: "application/json;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "datalens-theme.json";
    anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 100);
    setNotice("Theme exported as JSON.");
  }

  async function importTheme(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;

    try {
      const parsed = JSON.parse(await file.text()) as Partial<ThemeSettings>;
      const nextTheme = { ...DEFAULT_THEME, ...parsed };
      updateTheme(() => nextTheme);
      setNotice("Theme imported from JSON.");
    } catch {
      setNotice("Theme import failed. Check the JSON file.");
    } finally {
      event.target.value = "";
    }
  }

  return (
    <section className={`${CARD_CLASS} overflow-hidden p-5`}>
      <style>{themeCss}</style>

      <div className="flex flex-col gap-5 border-b border-white/15 pb-5 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex items-center gap-4">
          <div className="flex h-12 w-12 items-center justify-center rounded-[1.25rem] bg-cyan-500/10 text-cyan-700 dark:text-cyan-300">
            <Palette className="h-5 w-5" />
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-slate-500 dark:text-slate-400">
              Theme Customizer
            </p>
            <h2 className="mt-1 text-xl font-semibold text-slate-950 dark:text-slate-50">
              Tune DataLens visuals and persist them locally
            </h2>
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={exportTheme}
            className="inline-flex items-center gap-2 rounded-[1rem] border border-white/15 bg-white/45 px-4 py-3 text-sm text-slate-700 transition hover:bg-white/60 dark:bg-slate-900/30 dark:text-slate-200"
          >
            <Download className="h-4 w-4" />
            Export JSON
          </button>
          <button
            type="button"
            onClick={() => importInputRef.current?.click()}
            className="inline-flex items-center gap-2 rounded-[1rem] bg-cyan-600 px-4 py-3 text-sm font-semibold text-white transition hover:bg-cyan-500"
          >
            <Upload className="h-4 w-4" />
            Import JSON
          </button>
          <input
            ref={importInputRef}
            type="file"
            accept=".json,application/json"
            className="hidden"
            onChange={(event) => void importTheme(event)}
          />
        </div>
      </div>

      <div className="mt-5 grid gap-5 xl:grid-cols-[1.05fr_0.95fr]">
        <div className="space-y-4">
          <motion.div
            initial={{ opacity: 0, y: 18 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3, ease: EASE }}
            className="rounded-[1.4rem] border border-white/15 bg-white/45 p-4 dark:bg-slate-900/30"
          >
            <div className="flex items-center gap-3">
              <Settings2 className="h-4 w-4 text-slate-500 dark:text-slate-400" />
              <p className="text-sm font-semibold text-slate-900 dark:text-slate-50">
                Color scheme presets
              </p>
            </div>
            <div className="mt-4 grid gap-3 md:grid-cols-2">
              {(Object.keys(PRESET_COLORS) as ThemePreset[]).map((preset) => (
                <ThemePresetButton
                  key={preset}
                  active={theme.preset === preset}
                  label={preset}
                  color={PRESET_COLORS[preset]}
                  onClick={() =>
                    updateTheme((current) => ({
                      ...current,
                      preset,
                      accentColor: PRESET_COLORS[preset],
                    }))
                  }
                />
              ))}
            </div>
          </motion.div>

          <div className="grid gap-4 md:grid-cols-2">
            <div className="rounded-[1.4rem] border border-white/15 bg-white/45 p-4 dark:bg-slate-900/30">
              <label className="block text-sm font-semibold text-slate-900 dark:text-slate-50">
                Accent color
              </label>
              <div className="mt-3 flex items-center gap-3">
                <input
                  type="color"
                  value={theme.accentColor}
                  onChange={(event) =>
                    updateTheme((current) => ({
                      ...current,
                      accentColor: event.target.value,
                    }))
                  }
                  className="h-12 w-16 rounded-xl border border-white/20 bg-transparent"
                />
                <div>
                  <p className="text-sm font-medium text-slate-900 dark:text-slate-50">
                    {theme.accentColor}
                  </p>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    Current preset: {theme.preset}
                  </p>
                </div>
              </div>
            </div>

            <div className="rounded-[1.4rem] border border-white/15 bg-white/45 p-4 dark:bg-slate-900/30">
              <p className="text-sm font-semibold text-slate-900 dark:text-slate-50">
                Display mode
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                <ModeButton
                  active={theme.mode === "light"}
                  icon={Sun}
                  label="Light"
                  onClick={() => updateTheme((current) => ({ ...current, mode: "light" }))}
                />
                <ModeButton
                  active={theme.mode === "dark"}
                  icon={Moon}
                  label="Dark"
                  onClick={() => updateTheme((current) => ({ ...current, mode: "dark" }))}
                />
                <ModeButton
                  active={theme.mode === "system"}
                  icon={Settings2}
                  label="System"
                  onClick={() => updateTheme((current) => ({ ...current, mode: "system" }))}
                />
              </div>
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <SliderRow
              label="Font size"
              value={theme.fontSize}
              min={12}
              max={20}
              step={1}
              suffix="px"
              onChange={(value) => updateTheme((current) => ({ ...current, fontSize: value }))}
            />
            <SliderRow
              label="Border radius"
              value={theme.radius}
              min={0}
              max={24}
              step={1}
              suffix="px"
              onChange={(value) => updateTheme((current) => ({ ...current, radius: value }))}
            />
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <ToggleRow
              checked={theme.glassmorphism}
              label="Glassmorphism"
              description="Switch translucent surfaces and blur on or off."
              onChange={(checked) => updateTheme((current) => ({ ...current, glassmorphism: checked }))}
            />
            <ToggleRow
              checked={theme.animations}
              label="Animations"
              description="Disable motion-heavy transitions for a calmer UI."
              onChange={(checked) => updateTheme((current) => ({ ...current, animations: checked }))}
            />
            <ToggleRow
              checked={theme.compactMode}
              label="Compact mode"
              description="Tighten spacing for denser dashboards and data tools."
              onChange={(checked) => updateTheme((current) => ({ ...current, compactMode: checked }))}
            />
            <div className="rounded-[1rem] border border-white/15 bg-white/45 px-4 py-3 dark:bg-slate-900/30">
              <p className="text-sm font-semibold text-slate-900 dark:text-slate-50">
                Active mode
              </p>
              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                Resolved from {theme.mode} to {resolvedMode}.
              </p>
            </div>
          </div>
        </div>

        <div className="space-y-4">
          <div className="rounded-[1.4rem] border border-white/15 bg-white/45 p-4 dark:bg-slate-900/30">
            <p className="text-sm font-semibold text-slate-900 dark:text-slate-50">Preview panel</p>
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
              Live sample of cards, chips, accent usage, and typography.
            </p>

            <div className="datalens-compact-target mt-4 grid gap-4">
              <motion.div
                whileHover={theme.animations ? { y: -4, scale: 1.01 } : undefined}
                transition={{ duration: 0.28, ease: EASE }}
                className="datalens-theme-preview p-5"
              >
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-500 dark:text-slate-400">
                      Sample Insight
                    </p>
                    <h3 className="mt-2 text-xl font-semibold text-slate-950 dark:text-slate-50">
                      Revenue trend stabilized after the February spike
                    </h3>
                  </div>
                  <span className="datalens-theme-chip inline-flex px-3 py-1 text-xs font-semibold">
                    +12.8%
                  </span>
                </div>

                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                  <div className="rounded-[1rem] border border-white/15 bg-white/45 px-4 py-3 dark:bg-slate-900/25">
                    <p className="text-xs uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400">
                      Query Time
                    </p>
                    <p className="mt-1 text-lg font-semibold text-slate-950 dark:text-slate-50">
                      284 ms
                    </p>
                  </div>
                  <div className="rounded-[1rem] border border-white/15 bg-white/45 px-4 py-3 dark:bg-slate-900/25">
                    <p className="text-xs uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400">
                      Rows Scanned
                    </p>
                    <p className="mt-1 text-lg font-semibold text-slate-950 dark:text-slate-50">
                      1.42M
                    </p>
                  </div>
                </div>
              </motion.div>
            </div>
          </div>

          <AnimatePresence mode="wait">
            {notice ? (
              <motion.div
                key={notice}
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                transition={{ duration: 0.24, ease: EASE }}
                className="rounded-[1.2rem] border border-emerald-400/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-800 dark:text-emerald-300"
              >
                {notice}
              </motion.div>
            ) : null}
          </AnimatePresence>
        </div>
      </div>
    </section>
  );
}
