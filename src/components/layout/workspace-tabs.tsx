"use client";

import { useCallback, useEffect, useRef, useState, type ComponentType, type KeyboardEvent } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Check, MoreHorizontal } from "lucide-react";

type TabIcon = ComponentType<{ className?: string }>;
interface WorkspaceTab {
  id: string;
  label: string;
  icon: TabIcon;
  badge?: number | string;
}
interface WorkspaceTabsProps {
  tabs: WorkspaceTab[];
  activeTab: string;
  onChange: (id: string) => void;
}
export default function WorkspaceTabs({ tabs, activeTab, onChange }: WorkspaceTabsProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const tabRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [hiddenIds, setHiddenIds] = useState<string[]>([]);
  const hiddenTabs = tabs.filter((tab) => hiddenIds.includes(tab.id));
  const scrollToTab = useCallback((id: string) => {
    const container = scrollRef.current;
    const node = tabRefs.current[id];
    if (!container || !node) return;
    const left = node.offsetLeft;
    const right = left + node.offsetWidth;
    const viewLeft = container.scrollLeft;
    const viewRight = viewLeft + container.clientWidth;
    if (left < viewLeft) {
      container.scrollTo({ left: Math.max(left - 16, 0), behavior: "smooth" });
    } else if (right > viewRight) {
      container.scrollTo({ left: right - container.clientWidth + 16, behavior: "smooth" });
    }
  }, []);
  const measureHiddenTabs = useCallback(() => {
    const container = scrollRef.current;
    if (!container) return;
    const nextHidden = tabs
      .filter((tab) => {
        const node = tabRefs.current[tab.id];
        if (!node) return false;
        const left = node.offsetLeft;
        const right = left + node.offsetWidth;
        const viewLeft = container.scrollLeft;
        const viewRight = viewLeft + container.clientWidth;
        return left < viewLeft + 4 || right > viewRight - 4;
      })
      .map((tab) => tab.id);

    setHiddenIds((current) =>
      current.length === nextHidden.length &&
      current.every((id, index) => id === nextHidden[index])
        ? current
        : nextHidden,
    );
  }, [tabs]);
  useEffect(() => {
    const container = scrollRef.current;
    if (!container) return;
    const observer = new ResizeObserver(measureHiddenTabs);
    observer.observe(container);
    Object.values(tabRefs.current).forEach((node) => node && observer.observe(node));
    measureHiddenTabs();
    container.addEventListener("scroll", measureHiddenTabs, { passive: true });

    return () => {
      observer.disconnect();
      container.removeEventListener("scroll", measureHiddenTabs);
    };
  }, [measureHiddenTabs, tabs]);
  useEffect(() => {
    scrollToTab(activeTab);
    requestAnimationFrame(measureHiddenTabs);
  }, [activeTab, measureHiddenTabs, scrollToTab]);
  useEffect(() => {
    if (!isMenuOpen) return;
    const handlePointerDown = (event: MouseEvent) => {
      if (menuRef.current?.contains(event.target as Node)) return;
      setIsMenuOpen(false);
    };
    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, [isMenuOpen]);
  const selectTab = useCallback(
    (id: string) => {
      onChange(id);
      setIsMenuOpen(false);
      requestAnimationFrame(() => {
        tabRefs.current[id]?.focus();
        scrollToTab(id);
        measureHiddenTabs();
      });
    },
    [measureHiddenTabs, onChange, scrollToTab],
  );
  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
      if (!tabs.length) return;
      event.preventDefault();
      const currentIndex = Math.max(tabs.findIndex((tab) => tab.id === activeTab), 0);
      if (event.key === "Home") return void selectTab(tabs[0].id);
      if (event.key === "End") return void selectTab(tabs[tabs.length - 1].id);
      const nextIndex =
        event.key === "ArrowRight"
          ? (currentIndex + 1) % tabs.length
          : (currentIndex - 1 + tabs.length) % tabs.length;
      selectTab(tabs[nextIndex].id);
    },
    [activeTab, selectTab, tabs],
  );
  return (
    <div className="flex items-center gap-2">
      <div ref={scrollRef} className="relative min-w-0 flex-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        <div role="tablist" aria-orientation="horizontal" tabIndex={0} onKeyDown={handleKeyDown} className="relative flex min-w-max items-center gap-1 rounded-2xl border border-gray-200/70 bg-white/75 p-1 shadow-sm dark:border-gray-700/70 dark:bg-gray-900/65">
          {tabs.map((tab) => {
            const Icon = tab.icon;
            const isActive = tab.id === activeTab;
            const hasBadge = tab.badge !== undefined && tab.badge !== null;
            return (
              <button
                key={tab.id}
                ref={(node) => { tabRefs.current[tab.id] = node; }}
                type="button"
                role="tab"
                aria-selected={isActive}
                tabIndex={isActive ? 0 : -1}
                onClick={() => selectTab(tab.id)}
                className={`relative flex items-center gap-2 rounded-xl px-3.5 py-2 text-sm font-medium transition-colors ${
                  isActive
                    ? "text-gray-950 dark:text-gray-50"
                    : "text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-200"
                }`}
              >
                {isActive && (
                  <motion.span
                    layoutId="workspace-tabs-indicator"
                    className="absolute inset-0 rounded-xl bg-gray-950/6 dark:bg-white/10"
                    transition={{ type: "spring", stiffness: 420, damping: 34 }}
                  />
                )}
                <span className="relative z-10 flex items-center gap-2">
                  <Icon className="h-4 w-4 shrink-0" />
                  <span className="whitespace-nowrap">{tab.label}</span>
                  {hasBadge && (
                    <span
                      className={`inline-flex min-w-5 items-center justify-center rounded-full px-1.5 py-0.5 text-[11px] font-semibold ${
                        isActive
                          ? "bg-gray-950 text-white dark:bg-white dark:text-gray-950"
                          : "bg-red-500/10 text-red-600 dark:bg-red-500/15 dark:text-red-300"
                      }`}
                    >
                      {tab.badge}
                    </span>
                  )}
                </span>
              </button>
            );
          })}
        </div>
      </div>
      {hiddenTabs.length > 0 && (
        <div ref={menuRef} className="relative shrink-0">
          <button
            type="button"
            aria-label="Open overflow tabs"
            aria-haspopup="menu"
            aria-expanded={isMenuOpen}
            onClick={() => setIsMenuOpen((open) => !open)}
            className="flex h-10 w-10 items-center justify-center rounded-xl border border-gray-200/70 bg-white text-gray-600 transition-colors hover:text-gray-900 dark:border-gray-700/70 dark:bg-gray-900 dark:text-gray-300 dark:hover:text-gray-50"
          >
            <MoreHorizontal className="h-4 w-4" />
          </button>
          <AnimatePresence>
            {isMenuOpen && (
              <motion.div
                role="menu"
                initial={{ opacity: 0, scale: 0.96, y: -6 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.96, y: -6 }}
                transition={{ duration: 0.16, ease: "easeOut" }}
                className="absolute right-0 top-full z-30 mt-2 w-60 rounded-2xl border border-gray-200/70 bg-white/95 p-1 shadow-xl backdrop-blur dark:border-gray-700/70 dark:bg-gray-950/95"
              >
                {hiddenTabs.map((tab) => {
                  const Icon = tab.icon;
                  const isActive = tab.id === activeTab;
                  return (
                    <button key={tab.id} type="button" role="menuitem" onClick={() => selectTab(tab.id)} className="flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left text-sm text-gray-700 transition-colors hover:bg-gray-100 dark:text-gray-200 dark:hover:bg-gray-800">
                      <Icon className="h-4 w-4 shrink-0 text-gray-400 dark:text-gray-500" />
                      <span className="flex-1 truncate">{tab.label}</span>
                      {tab.badge !== undefined && tab.badge !== null && (
                        <span className="rounded-full bg-red-500/10 px-2 py-0.5 text-[11px] font-semibold text-red-600 dark:bg-red-500/15 dark:text-red-300">
                          {tab.badge}
                        </span>
                      )}
                      {isActive && <Check className="h-4 w-4 text-emerald-500" />}
                    </button>
                  );
                })}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      )}
    </div>
  );
}
