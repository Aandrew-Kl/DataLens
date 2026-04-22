"use client";

import { motion } from "framer-motion";
import { X } from "lucide-react";

import FileDropzone from "@/components/data/file-dropzone";
import type { FileDropResult } from "@/components/home/types";
import SampleDatasetsGallery from "@/components/onboarding/sample-datasets-gallery";
import { generateId } from "@/lib/utils/formatters";
import { useDatasetStore } from "@/stores/dataset-store";

interface UploadModalProps {
  isLoading: boolean;
  onClose: () => void;
  onFileLoaded: (result: FileDropResult) => void | Promise<void>;
}

export function UploadModal({ isLoading, onClose, onFileLoaded }: UploadModalProps) {
  const { addDataset } = useDatasetStore();

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
      onClick={onClose}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.95 }}
        className="mx-4 w-full max-w-xl rounded-2xl bg-white p-8 shadow-xl dark:bg-gray-900"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="mb-6 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-slate-900 dark:text-white">
            Upload New Dataset
          </h2>
          <button
            onClick={onClose}
            className="rounded-lg p-1 transition-colors hover:bg-slate-100 dark:hover:bg-slate-800"
          >
            <X className="h-5 w-5 text-slate-400" />
          </button>
        </div>

        <FileDropzone onFileLoaded={onFileLoaded} />
        <div className="mt-4">
          <SampleDatasetsGallery
            onDatasetLoaded={async ({ tableName, fileName, rowCount, columnCount }) => {
              addDataset({
                id: generateId(),
                name: tableName,
                fileName,
                rowCount,
                columnCount,
                columns: [],
                uploadedAt: Date.now(),
                sizeBytes: 0,
              });
            }}
          />
        </div>

        {isLoading && (
          <div className="mt-4 flex items-center justify-center gap-3 text-sm text-slate-500">
            <div className="h-4 w-4 animate-spin rounded-full border-2 border-indigo-500 border-t-transparent" />
            Loading and profiling...
          </div>
        )}
      </motion.div>
    </motion.div>
  );
}
