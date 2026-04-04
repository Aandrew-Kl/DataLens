"use client";

import { ErrorBoundary } from "@/components/ui/error-boundary";
import DataFaker from "@/components/data/data-faker";
import { motion } from "framer-motion";
import type { HomeFeatureCard } from "./types";

interface FeatureShowcaseProps {
  features: HomeFeatureCard[];
  onDataGenerated: (csvContent: string, fileName: string) => void;
}

export default function FeatureShowcase({
  features,
  onDataGenerated,
}: FeatureShowcaseProps) {
  return (
    <>
      <motion.div
        initial={{ opacity: 0, y: 24 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, delay: 0.15 }}
        className="w-full max-w-6xl px-4 pt-10"
      >
        <ErrorBoundary>
          <DataFaker onDataGenerated={onDataGenerated} />
        </ErrorBoundary>
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: 30 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, delay: 0.2 }}
        className="w-full max-w-4xl mt-16 px-4"
      >
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {features.map((feature, index) => (
            <motion.div
              key={feature.title}
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.3 + index * 0.08 }}
              className="rounded-xl border border-slate-200/60 dark:border-slate-700/50 bg-white/60 dark:bg-gray-900/40 backdrop-blur-sm p-5 space-y-2"
            >
              <div className="flex items-center gap-2">
                <div className="p-1.5 rounded-lg bg-indigo-100 dark:bg-indigo-900/30">
                  <feature.icon className="h-4 w-4 text-indigo-600 dark:text-indigo-400" />
                </div>
                <h3 className="text-sm font-semibold text-slate-900 dark:text-white">
                  {feature.title}
                </h3>
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
                {feature.description}
              </p>
            </motion.div>
          ))}
        </div>
      </motion.div>
    </>
  );
}
