"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import { Pipette } from "lucide-react";

const GLASS_PANEL_CLASS =
  "bg-white/75 backdrop-blur-2xl dark:bg-slate-950/45 border border-white/20";
const DEFAULT_COLORS = [
  "#0F172A",
  "#0EA5E9",
  "#14B8A6",
  "#22C55E",
  "#F59E0B",
  "#F97316",
  "#EF4444",
  "#8B5CF6",
];

interface ColorPickerProps {
  value?: string;
  defaultValue?: string;
  palette?: string[];
  onChange?: (value: string) => void;
}

function normalizeHex(value: string) {
  const trimmed = value.trim().replace(/^#/, "");

  if (/^[0-9a-fA-F]{3}$/.test(trimmed)) {
    return `#${trimmed
      .split("")
      .map((char) => `${char}${char}`)
      .join("")
      .toUpperCase()}`;
  }

  if (/^[0-9a-fA-F]{6}$/.test(trimmed)) {
    return `#${trimmed.toUpperCase()}`;
  }

  return null;
}

export default function ColorPicker({
  value,
  defaultValue = "#0EA5E9",
  palette = DEFAULT_COLORS,
  onChange,
}: ColorPickerProps) {
  const isControlled = value !== undefined;
  const [internalValue, setInternalValue] = useState(defaultValue);
  const [draftValue, setDraftValue] = useState(defaultValue);
  const [recentColors, setRecentColors] = useState<string[]>([]);
  const [open, setOpen] = useState(false);
  const popoverRef = useRef<HTMLDivElement>(null);

  const currentValue = isControlled ? value ?? defaultValue : internalValue;
  const normalizedDraft = useMemo(() => normalizeHex(draftValue), [draftValue]);

  const applyColor = useCallback(
    (nextColor: string) => {
      if (!isControlled) {
        setInternalValue(nextColor);
      }

      setDraftValue(nextColor);
      setRecentColors((current) => [nextColor, ...current.filter((color) => color !== nextColor)].slice(0, 5));
      onChange?.(nextColor);
    },
    [isControlled, onChange],
  );

  const handleToggleOpen = useCallback(() => {
    setOpen((currentOpen) => {
      const nextOpen = !currentOpen;
      if (nextOpen) {
        setDraftValue(currentValue);
      }
      return nextOpen;
    });
  }, [currentValue]);

  const handleInputChange = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    setDraftValue(event.target.value);
  }, []);

  const handleApplyDraft = useCallback(() => {
    if (!normalizedDraft) {
      return;
    }

    applyColor(normalizedDraft);
    setOpen(false);
  }, [applyColor, normalizedDraft]);

  useEffect(() => {
    if (!open) {
      return;
    }

    const handleMouseDown = (event: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };

    document.addEventListener("mousedown", handleMouseDown);
    return () => document.removeEventListener("mousedown", handleMouseDown);
  }, [open]);

  return (
    <div ref={popoverRef} className="relative inline-flex">
      <button
        type="button"
        onClick={handleToggleOpen}
        aria-haspopup="dialog"
        aria-expanded={open}
        className={`inline-flex items-center gap-3 rounded-2xl px-4 py-3 text-sm font-medium text-slate-900 shadow-sm dark:text-slate-100 ${GLASS_PANEL_CLASS}`}
      >
        <span className="h-5 w-5 rounded-full border border-white/30" style={{ backgroundColor: currentValue }} />
        <span>{currentValue}</span>
      </button>

      {open ? (
        <div
          role="dialog"
          aria-label="Color picker"
          className={`absolute left-0 top-[calc(100%+0.75rem)] z-20 w-[18rem] rounded-3xl p-4 shadow-2xl shadow-slate-900/10 ${GLASS_PANEL_CLASS}`}
        >
          <div className="space-y-4">
            <div>
              <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">Preset palette</p>
              <div className="mt-3 grid grid-cols-4 gap-2">
                {palette.map((color) => (
                  <button
                    key={color}
                    type="button"
                    aria-label={`Pick ${color}`}
                    onClick={() => {
                      applyColor(color);
                      setOpen(false);
                    }}
                    className="h-10 rounded-2xl border border-white/20 transition-transform hover:scale-105"
                    style={{ backgroundColor: color }}
                  />
                ))}
              </div>
            </div>

            <label className="space-y-2 text-sm text-slate-600 dark:text-slate-300">
              <span className="font-medium">Hex color</span>
              <div className="flex items-center gap-2 rounded-2xl border border-white/20 bg-white/60 px-3 py-2 dark:bg-slate-900/55">
                <Pipette className="h-4 w-4 text-slate-400" />
                <input
                  value={draftValue}
                  onChange={handleInputChange}
                  aria-label="Hex color"
                  className="w-full bg-transparent text-sm text-slate-900 outline-none placeholder:text-slate-400 dark:text-slate-100"
                  placeholder="#0EA5E9"
                />
              </div>
            </label>

            {!normalizedDraft && draftValue.trim() ? (
              <p className="text-xs font-medium text-rose-500">Enter a valid 3 or 6 digit hex color.</p>
            ) : null}

            {recentColors.length ? (
              <div>
                <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">Recent colors</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  {recentColors.map((color) => (
                    <button
                      key={color}
                      type="button"
                      onClick={() => {
                        applyColor(color);
                        setOpen(false);
                      }}
                      className="inline-flex items-center gap-2 rounded-2xl border border-white/20 bg-white/60 px-3 py-2 text-sm font-medium text-slate-700 dark:bg-slate-900/55 dark:text-slate-100"
                    >
                      <span className="h-4 w-4 rounded-full border border-white/30" style={{ backgroundColor: color }} />
                      {color}
                    </button>
                  ))}
                </div>
              </div>
            ) : null}

            <button
              type="button"
              onClick={handleApplyDraft}
              disabled={!normalizedDraft}
              className="w-full rounded-2xl bg-cyan-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-cyan-500 disabled:cursor-not-allowed disabled:bg-slate-300 disabled:text-slate-500 dark:disabled:bg-slate-700 dark:disabled:text-slate-400"
            >
              Apply color
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
