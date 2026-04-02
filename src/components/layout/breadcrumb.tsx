"use client";

import { AnimatePresence, motion } from "framer-motion";
import { ChevronRight, Home } from "lucide-react";

type BreadcrumbItem = {
  label: string;
  onClick?: () => void;
};

interface BreadcrumbProps {
  items: BreadcrumbItem[];
}

export default function Breadcrumb({ items }: BreadcrumbProps) {
  if (items.length === 0) {
    return null;
  }

  const mobileStartIndex = Math.max(items.length - 2, 0);

  return (
    <nav aria-label="Breadcrumb" className="w-full overflow-hidden">
      <motion.ol
        layout
        className="flex min-w-0 items-center gap-1 rounded-2xl border border-gray-200/70 bg-white/70 px-2.5 py-2 text-sm shadow-sm backdrop-blur-xl dark:border-gray-700/70 dark:bg-gray-900/60 md:px-3"
        transition={{ type: "spring", stiffness: 420, damping: 34 }}
      >
        <AnimatePresence initial={false} mode="popLayout">
          {items.map((item, index) => {
            const isLast = index === items.length - 1;
            const hideOnMobile = index < mobileStartIndex;
            const showMobileSeparator = index > mobileStartIndex;
            const sharedClasses =
              "inline-flex min-w-0 items-center gap-1.5 rounded-lg px-2 py-1 transition-colors";

            const content = (
              <>
                {index === 0 && <Home className="h-3.5 w-3.5 shrink-0" />}
                <span className="truncate">{item.label}</span>
              </>
            );

            return (
              <motion.li
                key={`${item.label}-${index}`}
                layout
                initial={{ opacity: 0, x: 10, scale: 0.98 }}
                animate={{ opacity: 1, x: 0, scale: 1 }}
                exit={{ opacity: 0, x: -10, scale: 0.98 }}
                transition={{ duration: 0.18, ease: "easeOut" }}
                className={`min-w-0 items-center gap-1 ${
                  hideOnMobile ? "hidden md:flex" : "flex"
                }`}
              >
                {index > 0 && (
                  <ChevronRight
                    aria-hidden="true"
                    className="hidden h-3.5 w-3.5 shrink-0 text-gray-300 dark:text-gray-600 md:block"
                  />
                )}

                {showMobileSeparator && (
                  <ChevronRight
                    aria-hidden="true"
                    className="h-3.5 w-3.5 shrink-0 text-gray-300 dark:text-gray-600 md:hidden"
                  />
                )}

                {isLast ? (
                  <motion.span
                    layout
                    aria-current="page"
                    className={`${sharedClasses} max-w-[11rem] bg-gray-100 text-gray-900 dark:bg-gray-800 dark:text-gray-50 md:max-w-[14rem]`}
                  >
                    {content}
                  </motion.span>
                ) : item.onClick ? (
                  <motion.button
                    layout
                    type="button"
                    onClick={item.onClick}
                    className={`${sharedClasses} max-w-[9rem] text-gray-500 hover:bg-gray-100 hover:text-gray-900 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-gray-100 md:max-w-[12rem]`}
                  >
                    {content}
                  </motion.button>
                ) : (
                  <motion.span
                    layout
                    className={`${sharedClasses} max-w-[9rem] text-gray-500 dark:text-gray-400 md:max-w-[12rem]`}
                  >
                    {content}
                  </motion.span>
                )}
              </motion.li>
            );
          })}
        </AnimatePresence>
      </motion.ol>
    </nav>
  );
}
