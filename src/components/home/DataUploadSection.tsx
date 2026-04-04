"use client";

import { motion } from "framer-motion";
import FileDropzone from "@/components/data/file-dropzone";
import type { FileDropResult } from "./types";

interface DataUploadSectionProps {
  isLoading: boolean;
  loadError: string | null;
  onFileLoaded: (result: FileDropResult) => void;
}

export default function DataUploadSection({
  isLoading,
  loadError,
  onFileLoaded,
}: DataUploadSectionProps) {
  return (
    <>
      <FileDropzone onFileLoaded={onFileLoaded} />

      {isLoading && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="flex items-center justify-center gap-3 text-sm text-slate-500"
        >
          <div className="h-4 w-4 animate-spin rounded-full border-2 border-indigo-500 border-t-transparent" />
          Loading and profiling data...
        </motion.div>
      )}

      {loadError && (
        <motion.div
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          className="rounded-lg border border-red-200 bg-red-50 dark:border-red-900/50 dark:bg-red-950/30 px-4 py-3 text-sm text-red-700 dark:text-red-400"
        >
          {loadError}
        </motion.div>
      )}
    </>
  );
}
