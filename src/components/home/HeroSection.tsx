"use client";

import { motion } from "framer-motion";
import { Database } from "lucide-react";

interface HeroSectionProps {
  title: string;
  tagline: string;
  description: string;
}

export default function HeroSection({
  title,
  tagline,
  description,
}: HeroSectionProps) {
  return (
    <div className="space-y-4">
      <motion.div
        initial={{ scale: 0.8 }}
        animate={{ scale: 1 }}
        transition={{ type: "spring", stiffness: 200, damping: 15 }}
        className="inline-flex items-center gap-3 mb-2"
      >
        <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-indigo-500 to-purple-600 shadow-xl shadow-indigo-500/25">
          <Database className="h-7 w-7 text-white" />
        </div>
        <h1 className="text-5xl font-bold tracking-tight text-slate-900 dark:text-white">
          {title}
        </h1>
      </motion.div>
      <p className="text-xl font-medium text-slate-700 dark:text-slate-200">
        {tagline}
      </p>
      <p className="text-base text-slate-500 dark:text-slate-400 max-w-lg mx-auto">
        {description}
      </p>
    </div>
  );
}
