import { useSyncExternalStore } from "react";

export const TELEMETRY_STORAGE_KEY = "datalens.telemetry.enabled";
export const TELEMETRY_BANNER_STORAGE_KEY = "datalens.telemetry.banner.dismissed";
export const TELEMETRY_CHANGE_EVENT = "datalens:telemetry-changed";

const telemetryEnabledByDefault =
  process.env.NEXT_PUBLIC_TELEMETRY_ENABLED?.trim() !== "false";

function canUseStorage() {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

function emitTelemetryChange() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(TELEMETRY_CHANGE_EVENT));
}

function readStoredBoolean(key: string): boolean | null {
  if (!canUseStorage()) return null;

  try {
    const value = window.localStorage.getItem(key);
    if (value === null) return null;
    return value !== "false";
  } catch {
    return null;
  }
}

export function getTelemetryDefaultEnabled() {
  return telemetryEnabledByDefault;
}

export function isTelemetryEnabled() {
  return readStoredBoolean(TELEMETRY_STORAGE_KEY) ?? telemetryEnabledByDefault;
}

export function setTelemetryEnabled(enabled: boolean) {
  if (!canUseStorage()) return;

  try {
    window.localStorage.setItem(TELEMETRY_STORAGE_KEY, String(enabled));
  } catch {
    return;
  }

  emitTelemetryChange();
}

export function hasDismissedTelemetryBanner() {
  return readStoredBoolean(TELEMETRY_BANNER_STORAGE_KEY) ?? false;
}

export function dismissTelemetryBanner() {
  if (!canUseStorage()) return;

  try {
    window.localStorage.setItem(TELEMETRY_BANNER_STORAGE_KEY, "true");
  } catch {
    return;
  }

  emitTelemetryChange();
}

function subscribe(onStoreChange: () => void) {
  if (typeof window === "undefined") {
    return () => undefined;
  }

  const handleStorage = (event: StorageEvent) => {
    if (
      event.key === TELEMETRY_STORAGE_KEY ||
      event.key === TELEMETRY_BANNER_STORAGE_KEY
    ) {
      onStoreChange();
    }
  };

  window.addEventListener("storage", handleStorage);
  window.addEventListener(TELEMETRY_CHANGE_EVENT, onStoreChange);

  return () => {
    window.removeEventListener("storage", handleStorage);
    window.removeEventListener(TELEMETRY_CHANGE_EVENT, onStoreChange);
  };
}

export function useTelemetryEnabled() {
  return useSyncExternalStore(
    subscribe,
    isTelemetryEnabled,
    getTelemetryDefaultEnabled,
  );
}

export function useTelemetryBannerDismissed() {
  return useSyncExternalStore(
    subscribe,
    hasDismissedTelemetryBanner,
    () => false,
  );
}
