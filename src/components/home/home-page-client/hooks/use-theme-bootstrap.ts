import { useEffect } from "react";

import { useUIStore } from "@/stores/ui-store";

/**
 * On mount, picks up theme from localStorage or OS preference and
 * mirrors the Zustand theme state into localStorage for persistence.
 */
export function useThemeBootstrap(theme: "light" | "dark") {
  useEffect(() => {
    const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    const stored = localStorage.getItem("datalens-theme");
    const initial =
      stored === "dark" || (!stored && prefersDark) ? "dark" : "light";
    useUIStore.getState().setTheme(initial);
  }, []);

  useEffect(() => {
    localStorage.setItem("datalens-theme", theme);
  }, [theme]);
}
