"use client";

import {
  useState,
  useRef,
  useEffect,
  useCallback,
  type ReactNode,
} from "react";
import { motion, AnimatePresence } from "framer-motion";
import type { LucideIcon } from "lucide-react";

/* ─── Types ─── */
interface DropdownItemAction {
  type?: "item";
  label: string;
  icon?: LucideIcon;
  onClick: () => void;
  danger?: boolean;
  disabled?: boolean;
}

interface DropdownSeparator {
  type: "separator";
}

type DropdownItem = DropdownItemAction | DropdownSeparator;

interface DropdownProps {
  trigger: ReactNode;
  items: DropdownItem[];
}

export default function Dropdown({ trigger, items }: DropdownProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [focusIndex, setFocusIndex] = useState(-1);
  const [above, setAbove] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  // Actionable items for keyboard navigation
  const actionItems = items
    .map((item, i) => ({ item, index: i }))
    .filter((e) => e.item.type !== "separator" && !(e.item as DropdownItemAction).disabled);

  // Close on outside click
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setIsOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [isOpen]);

  // Position calculation
  useEffect(() => {
    if (!isOpen || !containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const spaceBelow = window.innerHeight - rect.bottom;
    setAbove(spaceBelow < 200);
  }, [isOpen]);

  // Keyboard handling
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (!isOpen) {
        if (e.key === "Enter" || e.key === " " || e.key === "ArrowDown") {
          e.preventDefault();
          setIsOpen(true);
          setFocusIndex(0);
        }
        return;
      }

      switch (e.key) {
        case "Escape":
          e.preventDefault();
          setIsOpen(false);
          setFocusIndex(-1);
          break;
        case "ArrowDown":
          e.preventDefault();
          setFocusIndex((prev) => {
            const currentActionIdx = actionItems.findIndex(
              (a) => a.index === prev,
            );
            const nextIdx =
              currentActionIdx + 1 >= actionItems.length
                ? 0
                : currentActionIdx + 1;
            return actionItems[nextIdx].index;
          });
          break;
        case "ArrowUp":
          e.preventDefault();
          setFocusIndex((prev) => {
            const currentActionIdx = actionItems.findIndex(
              (a) => a.index === prev,
            );
            const nextIdx =
              currentActionIdx - 1 < 0
                ? actionItems.length - 1
                : currentActionIdx - 1;
            return actionItems[nextIdx].index;
          });
          break;
        case "Enter":
          e.preventDefault();
          if (focusIndex >= 0) {
            const item = items[focusIndex];
            if (item.type !== "separator" && !(item as DropdownItemAction).disabled) {
              (item as DropdownItemAction).onClick();
              setIsOpen(false);
              setFocusIndex(-1);
            }
          }
          break;
      }
    },
    [isOpen, focusIndex, actionItems, items],
  );

  return (
    <div
      ref={containerRef}
      className="relative inline-block"
      onKeyDown={handleKeyDown}
    >
      {/* Trigger */}
      <div
        onClick={() => {
          setIsOpen((prev) => !prev);
          if (!isOpen) setFocusIndex(-1);
        }}
        role="button"
        tabIndex={0}
        aria-haspopup="menu"
        aria-expanded={isOpen}
      >
        {trigger}
      </div>

      {/* Menu */}
      <AnimatePresence>
        {isOpen && (
          <motion.div
            ref={menuRef}
            role="menu"
            className={`
              absolute right-0 z-50
              min-w-[180px] py-1
              rounded-xl
              bg-white/95 dark:bg-gray-900/95
              backdrop-blur-xl
              border border-gray-200/60 dark:border-gray-700/60
              shadow-lg
              ${above ? "bottom-full mb-1" : "top-full mt-1"}
            `}
            initial={{ opacity: 0, scale: 0.95, y: above ? 6 : -6 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: above ? 6 : -6 }}
            transition={{ duration: 0.15, ease: "easeOut" }}
          >
            {items.map((item, idx) => {
              if (item.type === "separator") {
                return (
                  <div
                    key={`sep-${idx}`}
                    className="my-1 h-px bg-gray-200 dark:bg-gray-700/50"
                    role="separator"
                  />
                );
              }

              const actionItem = item as DropdownItemAction;
              const Icon = actionItem.icon;
              const isFocused = focusIndex === idx;

              return (
                <button
                  key={idx}
                  role="menuitem"
                  disabled={actionItem.disabled}
                  onClick={() => {
                    if (actionItem.disabled) return;
                    actionItem.onClick();
                    setIsOpen(false);
                    setFocusIndex(-1);
                  }}
                  onMouseEnter={() => setFocusIndex(idx)}
                  className={`
                    w-full flex items-center gap-2.5 px-3 py-2 text-sm text-left
                    transition-colors duration-100
                    ${
                      actionItem.disabled
                        ? "opacity-40 cursor-not-allowed"
                        : actionItem.danger
                          ? isFocused
                            ? "bg-red-50 dark:bg-red-950/40 text-red-600 dark:text-red-400"
                            : "text-red-600 dark:text-red-400"
                          : isFocused
                            ? "bg-gray-100 dark:bg-gray-800 text-gray-900 dark:text-gray-100"
                            : "text-gray-700 dark:text-gray-300"
                    }
                  `}
                >
                  {Icon && <Icon className="w-4 h-4 shrink-0 opacity-70" />}
                  <span>{actionItem.label}</span>
                </button>
              );
            })}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
