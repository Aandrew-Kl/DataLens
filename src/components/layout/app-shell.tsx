"use client";

import { useEffect, useRef } from "react";
import DataLensPage from "@/app/page";

type AppTab =
  | "profile"
  | "dashboard"
  | "connectors"
  | "catalog"
  | "query"
  | "sql"
  | "charts"
  | "forecast"
  | "ml"
  | "explore"
  | "builder"
  | "transforms"
  | "wrangler"
  | "lineage"
  | "quality"
  | "clean"
  | "advanced"
  | "analytics"
  | "reports"
  | "pivot"
  | "compare"
  | "settings";

interface DataLensAppShellProps {
  defaultTab?: AppTab | string;
}

const TAB_LABEL_BY_ID: Readonly<Record<string, string>> = {
  profile: "Profile",
  dashboard: "Dashboard",
  connectors: "Connectors",
  catalog: "Catalog",
  query: "Ask AI",
  sql: "SQL Editor",
  charts: "Charts",
  forecast: "Forecast",
  ml: "ML",
  explore: "Explore",
  builder: "Builder",
  transforms: "Transforms",
  wrangler: "Wrangler",
  lineage: "Lineage",
  quality: "Quality",
  clean: "Clean",
  advanced: "Advanced",
  analytics: "Analytics",
  compare: "Compare",
  pivot: "Pivot",
  reports: "Reports",
  settings: "Settings",
};

const findTabButtonByLabel = (label: string): HTMLButtonElement | null => {
  const buttons = Array.from(document.querySelectorAll("button"));

  const matchesLabel = (button: HTMLButtonElement) =>
    button.textContent?.trim() === label;

  const tabRowContainer = (button: HTMLButtonElement) => {
    const parent = button.parentElement;
    if (!parent) {
      return false;
    }
    return (
      parent.classList.contains("overflow-x-auto") &&
      parent.classList.contains("flex") &&
      parent.classList.contains("gap-1") &&
      parent.classList.contains("px-4")
    );
  };

  const button = buttons.find((item) => {
    const candidate = item as HTMLButtonElement;
    return matchesLabel(candidate) && tabRowContainer(candidate);
  });

  return button ?? null;
};

export default function DataLensApp({ defaultTab }: DataLensAppShellProps) {
  const appliedTabRef = useRef<string | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    if (!defaultTab) {
      return;
    }

    const normalized = defaultTab.toLowerCase();
    const label = TAB_LABEL_BY_ID[normalized];

    if (!label) {
      return;
    }

    if (appliedTabRef.current === normalized) {
      return;
    }

    try {
      window.localStorage.setItem("datalens-default-tab", normalized);
    } catch {
      // Ignore storage errors.
    }

    const timer = window.setInterval(() => {
      const tabButton = findTabButtonByLabel(label);
      if (!tabButton) {
        return;
      }

      if (tabButton.getAttribute("aria-selected") === "true") {
        appliedTabRef.current = normalized;
        clearInterval(timer);
        return;
      }

      tabButton.click();
      appliedTabRef.current = normalized;
      clearInterval(timer);
    }, 120);

    const timeout = window.setTimeout(() => {
      clearInterval(timer);
    }, 2500);

    return () => {
      clearInterval(timer);
      clearTimeout(timeout);
    };
  }, [defaultTab]);

  return <DataLensPage />;
}
