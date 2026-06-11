"use client";

import {
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { motion } from "framer-motion";

export interface GlassTabItem {
  id: string;
  label: string;
  content: ReactNode;
  badge?: string;
  disabled?: boolean;
}

export interface GlassTabsProps {
  tabs: GlassTabItem[];
  activeTab?: string;
  defaultTab?: string;
  onTabChange?: (tabId: string) => void;
  lazy?: boolean;
}

const GLASS_PANEL =
  "bg-white dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800";
const TAB_EASE = [0.22, 1, 0.36, 1] as const;

function getFirstAvailableTab(tabs: GlassTabItem[], requested?: string): string {
  if (requested) {
    const found = tabs.find((tab) => tab.id === requested && !tab.disabled);
    if (found) {
      return found.id;
    }
  }

  return tabs.find((tab) => !tab.disabled)?.id ?? "";
}

function getEnabledTabIds(tabs: GlassTabItem[]): string[] {
  return tabs.filter((tab) => !tab.disabled).map((tab) => tab.id);
}

export default function GlassTabs({
  tabs,
  activeTab,
  defaultTab,
  onTabChange,
  lazy = true,
}: GlassTabsProps) {
  const tabsId = useId();
  const tabRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const isControlled = activeTab !== undefined;
  const initialTab = getFirstAvailableTab(tabs, defaultTab);
  const [internalActiveTab, setInternalActiveTab] = useState(initialTab);
  const [visitedTabs, setVisitedTabs] = useState<string[]>(
    initialTab ? [initialTab] : [],
  );

  const resolvedActiveTab = useMemo(
    () => getFirstAvailableTab(tabs, isControlled ? activeTab : internalActiveTab),
    [activeTab, internalActiveTab, isControlled, tabs],
  );
  const enabledTabIds = useMemo(() => getEnabledTabIds(tabs), [tabs]);
  const renderedTabIds = useMemo(() => {
    if (!lazy) {
      return tabs.map((tab) => tab.id);
    }

    return Array.from(new Set([...visitedTabs, resolvedActiveTab]));
  }, [lazy, resolvedActiveTab, tabs, visitedTabs]);

  function selectTab(tabId: string) {
    if (!isControlled) {
      setInternalActiveTab(tabId);
    }

    setVisitedTabs((current) =>
      current.includes(tabId) ? current : [...current, tabId],
    );
    onTabChange?.(tabId);
  }

  function focusTab(tabId: string) {
    tabRefs.current[tabId]?.focus();
  }

  function moveFocus(targetIndex: number) {
    const targetId = enabledTabIds[targetIndex];
    if (!targetId) {
      return;
    }

    selectTab(targetId);
    focusTab(targetId);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (enabledTabIds.length === 0) {
      return;
    }

    const currentIndex = Math.max(
      0,
      enabledTabIds.findIndex((tabId) => tabId === resolvedActiveTab),
    );

    if (event.key === "ArrowRight") {
      event.preventDefault();
      moveFocus((currentIndex + 1) % enabledTabIds.length);
      return;
    }

    if (event.key === "ArrowLeft") {
      event.preventDefault();
      moveFocus((currentIndex - 1 + enabledTabIds.length) % enabledTabIds.length);
      return;
    }

    if (event.key === "Home") {
      event.preventDefault();
      moveFocus(0);
      return;
    }

    if (event.key === "End") {
      event.preventDefault();
      moveFocus(enabledTabIds.length - 1);
    }
  }

  return (
    <div className={`overflow-hidden rounded-lg ${GLASS_PANEL}`}>
      <div
        role="tablist"
        aria-label="Glass tabs"
        tabIndex={0}
        onKeyDown={handleKeyDown}
        className="flex flex-wrap gap-1 border-b border-zinc-200 p-2 dark:border-zinc-800"
      >
        {tabs.map((tab) => {
          const isActive = tab.id === resolvedActiveTab;

          return (
            <button
              key={tab.id}
              ref={(element) => {
                tabRefs.current[tab.id] = element;
              }}
              id={`${tabsId}-${tab.id}-tab`}
              type="button"
              role="tab"
              tabIndex={isActive ? 0 : -1}
              aria-selected={isActive}
              aria-controls={`${tabsId}-${tab.id}-panel`}
              disabled={tab.disabled}
              onClick={() => selectTab(tab.id)}
              className={`relative inline-flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors ${
                isActive
                  ? "text-zinc-900 dark:text-zinc-50"
                  : "text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
              } ${tab.disabled ? "cursor-not-allowed opacity-50" : ""}`}
            >
              {isActive ? (
                <motion.span
                  layoutId="glass-tabs-indicator"
                  className="absolute inset-0 rounded-md bg-zinc-100 dark:bg-zinc-900/60"
                  transition={{ duration: 0.2, ease: TAB_EASE }}
                />
              ) : null}
              <span className="relative z-10">{tab.label}</span>
              {tab.badge ? (
                <span className="relative z-10 rounded-full bg-zinc-100 px-2 py-0.5 text-[11px] dark:bg-zinc-800">
                  {tab.badge}
                </span>
              ) : null}
            </button>
          );
        })}
      </div>

      <div className="p-4">
        {tabs.map((tab) => {
          const shouldRender = renderedTabIds.includes(tab.id);
          const hidden = tab.id !== resolvedActiveTab;

          return shouldRender ? (
            <div
              key={tab.id}
              id={`${tabsId}-${tab.id}-panel`}
              role="tabpanel"
              aria-labelledby={`${tabsId}-${tab.id}-tab`}
              hidden={hidden}
              className="rounded-md border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950"
            >
              {tab.content}
            </div>
          ) : null;
        })}
      </div>
    </div>
  );
}
