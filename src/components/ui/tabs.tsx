"use client";

import { motion } from "framer-motion";
import type { LucideIcon } from "lucide-react";

/* ─── Types ─── */
interface Tab {
  id: string;
  label: string;
  icon?: LucideIcon;
}

interface TabsProps {
  tabs: Tab[];
  activeTab: string;
  onTabChange: (id: string) => void;
  variant?: "full" | "compact";
  layoutId?: string;
}

export default function Tabs({
  tabs,
  activeTab,
  onTabChange,
  variant = "full",
  layoutId = "tab-underline",
}: TabsProps) {
  const isCompact = variant === "compact";

  return (
    <div className="relative flex gap-1" role="tablist">
      {tabs.map((tab) => {
        const isActive = tab.id === activeTab;
        const Icon = tab.icon;

        return (
          <button
            key={tab.id}
            role="tab"
            aria-selected={isActive}
            onClick={() => onTabChange(tab.id)}
            className={`
              relative z-10 flex items-center gap-2
              ${isCompact ? "px-3 py-1.5 text-xs" : "px-4 py-2 text-sm"}
              font-medium rounded-lg
              transition-colors duration-150
              ${
                isActive
                  ? "text-indigo-600 dark:text-indigo-400"
                  : "text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300"
              }
            `}
          >
            {Icon && (
              <Icon className={isCompact ? "w-3.5 h-3.5" : "w-4 h-4"} />
            )}
            <span>{tab.label}</span>

            {isActive && (
              <motion.div
                layoutId={layoutId}
                className="absolute inset-x-1 -bottom-px h-0.5 rounded-full bg-indigo-500 dark:bg-indigo-400"
                transition={{ type: "spring", stiffness: 400, damping: 30 }}
              />
            )}
          </button>
        );
      })}

      {/* Bottom border */}
      <div className="absolute bottom-0 left-0 right-0 h-px bg-gray-200 dark:bg-gray-700/50" />
    </div>
  );
}
