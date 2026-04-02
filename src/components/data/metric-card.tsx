"use client";

import { motion } from "framer-motion";
import { formatNumber } from "@/lib/utils/formatters";

interface MetricCardProps {
  label: string;
  value: string | number;
  emoji: string;
}

export default function MetricCard({ label, value, emoji }: MetricCardProps) {
  const formattedValue = typeof value === "number" ? formatNumber(value) : value;

  return (
    <motion.div
      initial={{ opacity: 0, y: 12, scale: 0.96 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: 0.35, ease: "easeOut" }}
      whileHover={{ scale: 1.03, transition: { duration: 0.2 } }}
      className="
        rounded-xl p-5
        backdrop-blur-xl bg-white/60 dark:bg-gray-900/60
        border border-gray-200/50 dark:border-gray-700/50
        shadow-sm hover:shadow-md
        transition-shadow duration-300
        cursor-default
      "
    >
      <div className="flex items-center gap-3">
        <span className="text-2xl flex-shrink-0" role="img">
          {emoji}
        </span>
        <div className="min-w-0">
          <p className="text-2xl font-bold text-gray-800 dark:text-gray-50 tracking-tight truncate">
            {formattedValue}
          </p>
          <p className="text-xs font-medium text-gray-400 dark:text-gray-500 mt-0.5 truncate uppercase tracking-wide">
            {label}
          </p>
        </div>
      </div>
    </motion.div>
  );
}
