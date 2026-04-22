import { useSyncExternalStore } from "react";

import { formatNumber } from "@/lib/utils/formatters";

export function toNumber(value: unknown) {
  const parsed = value == null ? Number.NaN : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function toText(value: unknown) {
  return value == null ? null : String(value);
}

export function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

export function formatPercent(value: number, digits = 1) {
  return `${value.toFixed(digits)}%`;
}

export function formatMetric(value: number | null, digits = 2) {
  if (value == null) return "—";
  if (Math.abs(value) >= 1000 || Number.isInteger(value)) return formatNumber(value);
  return value.toFixed(digits);
}

export function formatRangeValue(value: string | number | null) {
  if (value == null) return "—";
  return typeof value === "number" ? formatMetric(value) : value;
}

export function escapeCsv(value: unknown) {
  if (value == null) return "";
  const text = String(value);
  if (text.includes(",") || text.includes('"') || text.includes("\n") || text.includes("\r")) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

export function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function darkModeSubscribe(onStoreChange: () => void) {
  if (typeof document === "undefined") return () => undefined;
  const root = document.documentElement;
  const observer = new MutationObserver(onStoreChange);
  observer.observe(root, { attributes: true, attributeFilter: ["class"] });
  return () => observer.disconnect();
}

function getDarkModeSnapshot() {
  if (typeof document === "undefined") return false;
  return document.documentElement.classList.contains("dark");
}

export function useDarkMode() {
  return useSyncExternalStore(darkModeSubscribe, getDarkModeSnapshot, () => false);
}
