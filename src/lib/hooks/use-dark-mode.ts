"use client";

import { useSyncExternalStore } from "react";

function subscribeDarkMode(listener: () => void) {
  if (typeof document === "undefined") {
    return () => undefined;
  }

  const observer = new MutationObserver(listener);
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["class"],
  });

  return () => observer.disconnect();
}

function getDarkModeSnapshot() {
  return (
    typeof document !== "undefined" &&
    document.documentElement.classList.contains("dark")
  );
}

export function useDarkMode() {
  return useSyncExternalStore(
    subscribeDarkMode,
    getDarkModeSnapshot,
    () => false,
  );
}
