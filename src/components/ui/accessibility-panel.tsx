"use client";

import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  Accessibility,
  Check,
  Eye,
  Keyboard,
  Palette,
  Sparkles,
  Type,
  X,
} from "lucide-react";

type FontSizeOption = "small" | "medium" | "large" | "extra-large";
type FocusStyle = "default" | "high-visibility";
type ColorBlindPalette = "default" | "protanopia" | "deuteranopia" | "tritanopia";

interface AccessibilitySettings {
  fontSize: FontSizeOption;
  highContrast: boolean;
  reducedMotion: boolean;
  screenReaderHints: boolean;
  focusIndicators: FocusStyle;
  colorPalette: ColorBlindPalette;
}

const STORAGE_KEY = "datalens:accessibility";
const EASE = [0.22, 1, 0.36, 1] as const;
const FONT_SCALES: Record<FontSizeOption, number> = {
  small: 0.94,
  medium: 1,
  large: 1.1,
  "extra-large": 1.2,
};
const DEFAULT_SETTINGS: AccessibilitySettings = {
  fontSize: "medium",
  highContrast: false,
  reducedMotion: false,
  screenReaderHints: false,
  focusIndicators: "default",
  colorPalette: "default",
};

function readStoredSettings(): AccessibilitySettings {
  if (typeof window === "undefined") {
    return DEFAULT_SETTINGS;
  }

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return DEFAULT_SETTINGS;
    }

    return {
      ...DEFAULT_SETTINGS,
      ...(JSON.parse(raw) as Partial<AccessibilitySettings>),
    };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

function ToggleRow({
  checked,
  description,
  label,
  onToggle,
}: {
  checked: boolean;
  description: string;
  label: string;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className="flex w-full items-center justify-between rounded-2xl border border-white/10 bg-white/10 px-4 py-3 text-left backdrop-blur-xl transition hover:border-cyan-400/25 hover:bg-white/15 dark:bg-slate-950/40"
    >
      <div>
        <p className="text-sm font-semibold text-slate-950 dark:text-slate-50">{label}</p>
        <p className="mt-1 text-xs leading-5 text-slate-500 dark:text-slate-400">{description}</p>
      </div>
      <span
        className={`relative ml-4 flex h-7 w-12 shrink-0 items-center rounded-full transition ${
          checked ? "bg-cyan-500/90" : "bg-slate-300 dark:bg-slate-700"
        }`}
        aria-hidden="true"
      >
        <span
          className={`h-5 w-5 rounded-full bg-white shadow-sm transition ${
            checked ? "translate-x-6" : "translate-x-1"
          }`}
        />
      </span>
    </button>
  );
}

export default function AccessibilityPanel() {
  const [open, setOpen] = useState(false);
  const [showKeyboardHelp, setShowKeyboardHelp] = useState(false);
  const [settings, setSettings] = useState<AccessibilitySettings>(() => readStoredSettings());
  const [announcement, setAnnouncement] = useState("Accessibility settings ready.");

  useEffect(() => {
    const root = document.documentElement;
    root.style.setProperty("--datalens-accessibility-font-scale", String(FONT_SCALES[settings.fontSize]));
    root.classList.toggle("datalens-high-contrast", settings.highContrast);
    root.classList.toggle("prefers-reduced-motion", settings.reducedMotion);
    root.classList.toggle("datalens-screen-reader-hints", settings.screenReaderHints);
    root.classList.toggle("datalens-focus-high-visibility", settings.focusIndicators === "high-visibility");
    root.dataset.datalensColorPalette = settings.colorPalette;

    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
    } catch {
      // Ignore storage failures.
    }
  }, [settings]);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent): void {
      if (event.key === "Escape") {
        setShowKeyboardHelp(false);
        setOpen(false);
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  const keyboardHints = useMemo(
    () => [
      { combo: "Tab / Shift+Tab", detail: "Move forward or backward between interactive elements." },
      { combo: "Enter / Space", detail: "Activate buttons, toggles, and cards." },
      { combo: "Arrow keys", detail: "Navigate segmented controls and menus." },
      { combo: "Esc", detail: "Close overlays such as this accessibility panel." },
    ],
    [],
  );

  function updateSettings(next: Partial<AccessibilitySettings>, spokenText: string): void {
    setSettings((current) => ({ ...current, ...next }));
    setAnnouncement(spokenText);
  }

  return (
    <>
      <style>{`
        :root {
          --datalens-accessibility-font-scale: 1;
        }

        html {
          font-size: calc(var(--datalens-font-size, 16px) * var(--datalens-accessibility-font-scale));
        }

        html.prefers-reduced-motion {
          scroll-behavior: auto;
        }

        html.prefers-reduced-motion *,
        html.prefers-reduced-motion *::before,
        html.prefers-reduced-motion *::after {
          animation-duration: 0.01ms !important;
          animation-iteration-count: 1 !important;
          scroll-behavior: auto !important;
          transition-duration: 0.01ms !important;
        }

        html.datalens-high-contrast body {
          filter: contrast(1.18) saturate(1.06);
        }

        html.datalens-high-contrast .glass {
          background: rgba(255, 255, 255, 0.92);
          border-color: rgba(15, 23, 42, 0.24);
        }

        html.dark.datalens-high-contrast .glass {
          background: rgba(2, 6, 23, 0.88);
          border-color: rgba(148, 163, 184, 0.34);
        }

        html.datalens-focus-high-visibility *:focus-visible {
          outline: 3px solid #f97316 !important;
          outline-offset: 4px !important;
          box-shadow: 0 0 0 6px rgba(249, 115, 22, 0.22);
        }

        html[data-datalens-color-palette="protanopia"] {
          --color-primary: #2563eb;
          --color-primary-light: #60a5fa;
          --color-primary-dark: #1d4ed8;
          --color-accent: #06b6d4;
        }

        html[data-datalens-color-palette="deuteranopia"] {
          --color-primary: #1d4ed8;
          --color-primary-light: #38bdf8;
          --color-primary-dark: #0f766e;
          --color-accent: #f97316;
        }

        html[data-datalens-color-palette="tritanopia"] {
          --color-primary: #0f766e;
          --color-primary-light: #14b8a6;
          --color-primary-dark: #0f172a;
          --color-accent: #f59e0b;
        }
      `}</style>

      {settings.screenReaderHints ? (
        <>
          <div className="sr-only" aria-live="polite" aria-atomic="true">
            {announcement}
          </div>
          <div className="sr-only" aria-live="assertive" aria-atomic="true">
            Keyboard navigation help is available from the accessibility panel.
          </div>
        </>
      ) : null}

      <div className="fixed bottom-5 left-5 z-50">
        <button
          type="button"
          aria-label="Open accessibility settings"
          aria-expanded={open}
          onClick={() => setOpen((current) => !current)}
          className="glass inline-flex h-14 w-14 items-center justify-center rounded-full border border-white/20 bg-white/80 text-slate-900 shadow-[0_24px_60px_-30px_rgba(15,23,42,0.9)] backdrop-blur-2xl transition hover:-translate-y-0.5 hover:bg-white dark:bg-slate-950/70 dark:text-slate-50"
        >
          <Accessibility className="h-6 w-6" />
        </button>
      </div>

      <AnimatePresence>
        {open ? (
          <motion.aside
            initial={{ opacity: 0, x: -18, y: 12 }}
            animate={{ opacity: 1, x: 0, y: 0 }}
            exit={{ opacity: 0, x: -18, y: 12 }}
            transition={{ duration: 0.28, ease: EASE }}
            className="fixed bottom-24 left-5 z-50 w-[min(92vw,24rem)] overflow-hidden rounded-[28px] border border-white/15 bg-[radial-gradient(circle_at_top_left,rgba(14,165,233,0.18),transparent_28%),linear-gradient(135deg,rgba(255,255,255,0.9),rgba(226,232,240,0.8))] shadow-[0_30px_90px_-42px_rgba(15,23,42,0.95)] backdrop-blur-2xl dark:border-white/10 dark:bg-[radial-gradient(circle_at_top_left,rgba(14,165,233,0.18),transparent_24%),linear-gradient(135deg,rgba(2,6,23,0.94),rgba(15,23,42,0.9))]"
          >
            <div className="border-b border-white/10 px-5 py-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="inline-flex items-center gap-2 rounded-full border border-cyan-400/20 bg-cyan-500/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.22em] text-cyan-700 dark:text-cyan-300">
                    <Sparkles className="h-3.5 w-3.5" />
                    Accessibility
                  </p>
                  <h2 className="mt-3 text-lg font-semibold text-slate-950 dark:text-slate-50">Comfort controls</h2>
                  <p className="mt-1 text-sm leading-6 text-slate-600 dark:text-slate-300">
                    Tune readability, motion, focus rings, and color contrast in one place.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="rounded-2xl border border-white/10 bg-white/10 p-2 text-slate-500 transition hover:text-slate-900 dark:bg-slate-950/40 dark:text-slate-400 dark:hover:text-white"
                  aria-label="Close accessibility settings"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>

            <div className="space-y-5 px-5 py-5">
              <section>
                <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-900 dark:text-slate-100">
                  <Type className="h-4 w-4 text-cyan-600 dark:text-cyan-300" />
                  Font size
                </div>
                <div className="grid grid-cols-2 gap-2">
                  {(
                    [
                      ["small", "Small"],
                      ["medium", "Medium"],
                      ["large", "Large"],
                      ["extra-large", "Extra large"],
                    ] as const
                  ).map(([value, label]) => {
                    const active = settings.fontSize === value;
                    return (
                      <button
                        key={value}
                        type="button"
                        onClick={() =>
                          updateSettings(
                            { fontSize: value },
                            `Font size set to ${label.toLowerCase()}.`,
                          )
                        }
                        className={`rounded-2xl border px-3 py-3 text-left text-sm transition ${
                          active
                            ? "border-cyan-400/30 bg-cyan-500/12 text-cyan-800 dark:text-cyan-200"
                            : "border-white/10 bg-white/10 text-slate-600 hover:border-cyan-400/20 hover:bg-white/15 dark:bg-slate-950/35 dark:text-slate-300"
                        }`}
                      >
                        <span className="flex items-center justify-between">
                          <span>{label}</span>
                          {active ? <Check className="h-4 w-4" /> : null}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </section>

              <section className="space-y-3">
                <ToggleRow
                  checked={settings.highContrast}
                  description="Boost panel contrast and sharpen text against glass surfaces."
                  label="High contrast mode"
                  onToggle={() =>
                    updateSettings(
                      { highContrast: !settings.highContrast },
                      `High contrast mode ${settings.highContrast ? "disabled" : "enabled"}.`,
                    )
                  }
                />
                <ToggleRow
                  checked={settings.reducedMotion}
                  description="Reduce animations and scrolling motion for calmer navigation."
                  label="Reduced motion"
                  onToggle={() =>
                    updateSettings(
                      { reducedMotion: !settings.reducedMotion },
                      `Reduced motion ${settings.reducedMotion ? "disabled" : "enabled"}.`,
                    )
                  }
                />
                <ToggleRow
                  checked={settings.screenReaderHints}
                  description="Enable polite live regions for important setting changes."
                  label="Screen reader hints"
                  onToggle={() =>
                    updateSettings(
                      { screenReaderHints: !settings.screenReaderHints },
                      `Screen reader hints ${settings.screenReaderHints ? "disabled" : "enabled"}.`,
                    )
                  }
                />
              </section>

              <section>
                <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-900 dark:text-slate-100">
                  <Eye className="h-4 w-4 text-cyan-600 dark:text-cyan-300" />
                  Focus indicators
                </div>
                <div className="grid grid-cols-2 gap-2">
                  {(["default", "high-visibility"] as const).map((value) => {
                    const active = settings.focusIndicators === value;
                    const label = value === "default" ? "Default" : "High visibility";
                    return (
                      <button
                        key={value}
                        type="button"
                        onClick={() =>
                          updateSettings(
                            { focusIndicators: value },
                            `Focus indicators set to ${label.toLowerCase()}.`,
                          )
                        }
                        className={`rounded-2xl border px-3 py-3 text-sm transition ${
                          active
                            ? "border-amber-400/30 bg-amber-500/10 text-amber-800 dark:text-amber-200"
                            : "border-white/10 bg-white/10 text-slate-600 hover:border-amber-400/20 dark:bg-slate-950/35 dark:text-slate-300"
                        }`}
                      >
                        {label}
                      </button>
                    );
                  })}
                </div>
              </section>

              <section>
                <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-900 dark:text-slate-100">
                  <Palette className="h-4 w-4 text-cyan-600 dark:text-cyan-300" />
                  Color-blind friendly palettes
                </div>
                <div className="grid grid-cols-2 gap-2">
                  {(
                    [
                      ["default", "Default"],
                      ["protanopia", "Protanopia"],
                      ["deuteranopia", "Deuteranopia"],
                      ["tritanopia", "Tritanopia"],
                    ] as const
                  ).map(([value, label]) => {
                    const active = settings.colorPalette === value;
                    return (
                      <button
                        key={value}
                        type="button"
                        onClick={() =>
                          updateSettings(
                            { colorPalette: value },
                            `${label} palette selected.`,
                          )
                        }
                        className={`rounded-2xl border px-3 py-3 text-left text-sm transition ${
                          active
                            ? "border-emerald-400/30 bg-emerald-500/10 text-emerald-800 dark:text-emerald-200"
                            : "border-white/10 bg-white/10 text-slate-600 hover:border-emerald-400/20 dark:bg-slate-950/35 dark:text-slate-300"
                        }`}
                      >
                        <span className="flex items-center justify-between gap-2">
                          <span>{label}</span>
                          <span className="flex items-center gap-1">
                            <span className="h-2.5 w-2.5 rounded-full bg-sky-500" />
                            <span className="h-2.5 w-2.5 rounded-full bg-emerald-500" />
                            <span className="h-2.5 w-2.5 rounded-full bg-amber-500" />
                          </span>
                        </span>
                      </button>
                    );
                  })}
                </div>
              </section>

              <button
                type="button"
                onClick={() => setShowKeyboardHelp(true)}
                className="flex w-full items-center justify-between rounded-2xl border border-white/10 bg-white/10 px-4 py-3 text-left text-slate-700 backdrop-blur-xl transition hover:border-cyan-400/25 hover:bg-white/15 dark:bg-slate-950/40 dark:text-slate-200"
              >
                <span>
                  <span className="flex items-center gap-2 text-sm font-semibold">
                    <Keyboard className="h-4 w-4 text-cyan-600 dark:text-cyan-300" />
                    Keyboard navigation help
                  </span>
                  <span className="mt-1 block text-xs leading-5 text-slate-500 dark:text-slate-400">
                    Review the most important navigation shortcuts and focus behavior.
                  </span>
                </span>
                <span className="rounded-full border border-white/10 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
                  Overlay
                </span>
              </button>
            </div>
          </motion.aside>
        ) : null}
      </AnimatePresence>

      <AnimatePresence>
        {showKeyboardHelp ? (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-950/55 p-4 backdrop-blur-md"
          >
            <motion.div
              initial={{ opacity: 0, y: 18, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 18, scale: 0.98 }}
              transition={{ duration: 0.28, ease: EASE }}
              className="w-full max-w-lg overflow-hidden rounded-[30px] border border-white/15 bg-[radial-gradient(circle_at_top_right,rgba(56,189,248,0.16),transparent_28%),linear-gradient(135deg,rgba(255,255,255,0.9),rgba(226,232,240,0.82))] shadow-[0_30px_90px_-42px_rgba(15,23,42,0.95)] dark:border-white/10 dark:bg-[radial-gradient(circle_at_top_right,rgba(56,189,248,0.18),transparent_28%),linear-gradient(135deg,rgba(2,6,23,0.94),rgba(15,23,42,0.9))]"
              role="dialog"
              aria-modal="true"
              aria-label="Keyboard navigation help"
            >
              <div className="flex items-start justify-between border-b border-white/10 px-5 py-4">
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-cyan-700 dark:text-cyan-300">
                    Keyboard help
                  </p>
                  <h3 className="mt-2 text-xl font-semibold text-slate-950 dark:text-slate-50">Move through DataLens without a mouse</h3>
                </div>
                <button
                  type="button"
                  onClick={() => setShowKeyboardHelp(false)}
                  className="rounded-2xl border border-white/10 bg-white/10 p-2 text-slate-500 transition hover:text-slate-900 dark:bg-slate-950/40 dark:text-slate-400 dark:hover:text-white"
                  aria-label="Close keyboard help"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
              <div className="space-y-3 px-5 py-5">
                {keyboardHints.map((item) => (
                  <div
                    key={item.combo}
                    className="rounded-2xl border border-white/10 bg-white/10 px-4 py-3 dark:bg-slate-950/35"
                  >
                    <p className="text-sm font-semibold text-slate-950 dark:text-slate-50">{item.combo}</p>
                    <p className="mt-1 text-sm leading-6 text-slate-600 dark:text-slate-300">{item.detail}</p>
                  </div>
                ))}
              </div>
            </motion.div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </>
  );
}
