"use client";

import { motion } from "framer-motion";
import type { LucideIcon } from "lucide-react";

interface EmptyStateAction {
  label: string;
  onClick: () => void;
}

interface EmptyStateProps {
  icon: LucideIcon;
  title: string;
  description: string;
  action?: EmptyStateAction;
}

export default function EmptyState({
  icon: Icon,
  title,
  description,
  action,
}: EmptyStateProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: "easeOut" }}
      className="flex flex-col items-center justify-center py-16 px-6 text-center"
    >
      <motion.div
        initial={{ scale: 0.8 }}
        animate={{ scale: 1 }}
        transition={{ duration: 0.4, delay: 0.1, ease: "easeOut" }}
        className="
          w-16 h-16 rounded-2xl mb-5
          flex items-center justify-center
          bg-gray-100 dark:bg-gray-800/80
          border border-gray-200/50 dark:border-gray-700/50
        "
      >
        <Icon className="w-7 h-7 text-gray-400 dark:text-gray-500" />
      </motion.div>

      <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-1.5">
        {title}
      </h3>

      <p className="text-sm text-gray-500 dark:text-gray-400 max-w-xs mb-5">
        {description}
      </p>

      {action && (
        <motion.button
          whileHover={{ scale: 1.03 }}
          whileTap={{ scale: 0.97 }}
          onClick={action.onClick}
          className="
            px-4 py-2 rounded-lg text-sm font-medium
            bg-indigo-500 hover:bg-indigo-600
            dark:bg-indigo-600 dark:hover:bg-indigo-500
            text-white
            shadow-sm hover:shadow-md
            transition-colors duration-150
          "
        >
          {action.label}
        </motion.button>
      )}
    </motion.div>
  );
}
