"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
} from "react";
import { CalendarRange, X } from "lucide-react";

const GLASS_PANEL_CLASS =
  "bg-white/75 backdrop-blur-2xl dark:bg-slate-950/45 border border-white/20";

export interface DateRangeValue {
  start: string | null;
  end: string | null;
}

interface DateRangePickerProps {
  value?: DateRangeValue | null;
  defaultValue?: DateRangeValue | null;
  onChange?: (value: DateRangeValue | null) => void;
  today?: Date;
}

interface PresetDefinition {
  id: string;
  label: string;
  getRange: (today: Date) => DateRangeValue;
}

const DATE_FORMATTER = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
  timeZone: "UTC",
});

function parseDateValue(value: string | null) {
  if (!value) {
    return null;
  }

  const [year, month, day] = value.split("-").map(Number);

  if (!year || !month || !day) {
    return null;
  }

  return new Date(Date.UTC(year, month - 1, day));
}

function toDateInputValue(date: Date) {
  return date.toISOString().slice(0, 10);
}

function addDays(date: Date, amount: number) {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + amount);
  return next;
}

function normalizeRange(range: DateRangeValue | null) {
  if (!range || (!range.start && !range.end)) {
    return null;
  }

  if (!range.start || !range.end) {
    return range;
  }

  const startDate = parseDateValue(range.start);
  const endDate = parseDateValue(range.end);

  if (!startDate || !endDate) {
    return range;
  }

  if (startDate.getTime() <= endDate.getTime()) {
    return range;
  }

  return {
    start: range.end,
    end: range.start,
  };
}

function formatRangeLabel(range: DateRangeValue | null) {
  if (!range?.start && !range?.end) {
    return "Select date range";
  }

  if (range?.start && range?.end) {
    return `${DATE_FORMATTER.format(parseDateValue(range.start) ?? new Date())} - ${DATE_FORMATTER.format(
      parseDateValue(range.end) ?? new Date(),
    )}`;
  }

  if (range?.start) {
    return `From ${DATE_FORMATTER.format(parseDateValue(range.start) ?? new Date())}`;
  }

  return `Until ${DATE_FORMATTER.format(parseDateValue(range?.end ?? null) ?? new Date())}`;
}

const PRESETS: PresetDefinition[] = [
  {
    id: "last-7",
    label: "Last 7 days",
    getRange: (today) => ({
      start: toDateInputValue(addDays(today, -6)),
      end: toDateInputValue(today),
    }),
  },
  {
    id: "last-30",
    label: "Last 30 days",
    getRange: (today) => ({
      start: toDateInputValue(addDays(today, -29)),
      end: toDateInputValue(today),
    }),
  },
  {
    id: "this-month",
    label: "This month",
    getRange: (today) => ({
      start: toDateInputValue(new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1))),
      end: toDateInputValue(today),
    }),
  },
  {
    id: "this-year",
    label: "This year",
    getRange: (today) => ({
      start: toDateInputValue(new Date(Date.UTC(today.getUTCFullYear(), 0, 1))),
      end: toDateInputValue(today),
    }),
  },
];

export default function DateRangePicker({
  value,
  defaultValue = null,
  onChange,
  today = new Date(),
}: DateRangePickerProps) {
  const isControlled = value !== undefined;
  const [internalRange, setInternalRange] = useState<DateRangeValue | null>(defaultValue);
  const [open, setOpen] = useState(false);
  const [draftRange, setDraftRange] = useState<DateRangeValue>({
    start: defaultValue?.start ?? value?.start ?? null,
    end: defaultValue?.end ?? value?.end ?? null,
  });
  const popoverRef = useRef<HTMLDivElement>(null);

  const currentRange = isControlled ? value ?? null : internalRange;
  const buttonLabel = useMemo(() => formatRangeLabel(currentRange), [currentRange]);

  const commitRange = useCallback(
    (nextRange: DateRangeValue | null) => {
      const normalized = normalizeRange(nextRange);

      if (!isControlled) {
        setInternalRange(normalized);
      }

      onChange?.(normalized);
    },
    [isControlled, onChange],
  );

  const syncDraftFromCurrent = useCallback(() => {
    setDraftRange({
      start: currentRange?.start ?? null,
      end: currentRange?.end ?? null,
    });
  }, [currentRange]);

  const handleToggleOpen = useCallback(() => {
    setOpen((currentOpen) => {
      const nextOpen = !currentOpen;
      if (nextOpen) {
        syncDraftFromCurrent();
      }
      return nextOpen;
    });
  }, [syncDraftFromCurrent]);

  const handlePresetClick = useCallback(
    (preset: PresetDefinition) => {
      const normalizedToday = parseDateValue(toDateInputValue(today)) ?? today;
      const nextRange = preset.getRange(normalizedToday);
      commitRange(nextRange);
      setDraftRange(nextRange);
      setOpen(false);
    },
    [commitRange, today],
  );

  const handleDraftChange = useCallback(
    (field: keyof DateRangeValue) => (event: ChangeEvent<HTMLInputElement>) => {
      const nextValue = event.target.value || null;
      setDraftRange((current) => ({
        ...current,
        [field]: nextValue,
      }));
    },
    [],
  );

  const handleApply = useCallback(() => {
    commitRange(draftRange);
    setOpen(false);
  }, [commitRange, draftRange]);

  const handleClear = useCallback(() => {
    setDraftRange({ start: null, end: null });
    commitRange(null);
    setOpen(false);
  }, [commitRange]);

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
    <div className="relative inline-flex" ref={popoverRef}>
      <button
        type="button"
        onClick={handleToggleOpen}
        aria-haspopup="dialog"
        aria-expanded={open}
        className={`inline-flex min-w-[16rem] items-center justify-between gap-3 rounded-2xl px-4 py-3 text-left text-sm font-medium text-slate-900 shadow-sm dark:text-slate-100 ${GLASS_PANEL_CLASS}`}
      >
        <span className="inline-flex items-center gap-2">
          <CalendarRange className="h-4 w-4 text-cyan-600 dark:text-cyan-300" />
          <span>{buttonLabel}</span>
        </span>
        {currentRange ? (
          <span className="rounded-full bg-cyan-100 px-2 py-0.5 text-xs font-semibold text-cyan-700 dark:bg-cyan-950/50 dark:text-cyan-300">
            Active
          </span>
        ) : null}
      </button>

      {open ? (
        <div
          role="dialog"
          aria-label="Date range picker"
          className={`absolute left-0 top-[calc(100%+0.75rem)] z-20 w-[22rem] rounded-3xl p-4 shadow-2xl shadow-slate-900/10 ${GLASS_PANEL_CLASS}`}
        >
          <div className="space-y-4">
            <div>
              <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">Quick presets</p>
              <div className="mt-3 grid grid-cols-2 gap-2">
                {PRESETS.map((preset) => (
                  <button
                    key={preset.id}
                    type="button"
                    onClick={() => handlePresetClick(preset)}
                    className="rounded-2xl border border-white/20 bg-white/60 px-3 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-white dark:bg-slate-900/55 dark:text-slate-100 dark:hover:bg-slate-900"
                  >
                    {preset.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <label className="space-y-2 text-sm text-slate-600 dark:text-slate-300">
                <span className="font-medium">Start date</span>
                <input
                  type="date"
                  value={draftRange.start ?? ""}
                  onChange={handleDraftChange("start")}
                  className="w-full rounded-2xl border border-white/20 bg-white/60 px-3 py-2 text-sm text-slate-900 outline-none focus:border-cyan-300 dark:bg-slate-900/55 dark:text-slate-100"
                />
              </label>
              <label className="space-y-2 text-sm text-slate-600 dark:text-slate-300">
                <span className="font-medium">End date</span>
                <input
                  type="date"
                  value={draftRange.end ?? ""}
                  onChange={handleDraftChange("end")}
                  className="w-full rounded-2xl border border-white/20 bg-white/60 px-3 py-2 text-sm text-slate-900 outline-none focus:border-cyan-300 dark:bg-slate-900/55 dark:text-slate-100"
                />
              </label>
            </div>

            <div className="flex items-center justify-between gap-3">
              <button
                type="button"
                onClick={handleClear}
                className="inline-flex items-center gap-2 rounded-2xl border border-white/20 bg-white/60 px-3 py-2 text-sm font-medium text-slate-600 transition-colors hover:bg-white dark:bg-slate-900/55 dark:text-slate-300 dark:hover:bg-slate-900"
              >
                <X className="h-4 w-4" />
                Clear range
              </button>

              <button
                type="button"
                onClick={handleApply}
                className="rounded-2xl bg-cyan-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-cyan-500"
              >
                Apply custom range
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
