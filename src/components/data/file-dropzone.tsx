"use client";

import { useState, useCallback, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Upload, FileSpreadsheet, CheckCircle2, AlertCircle, X } from "lucide-react";
import { parseCSV } from "@/lib/parsers/csv-parser";
import { parseExcel } from "@/lib/parsers/excel-parser";
import { parseJSON } from "@/lib/parsers/json-parser";
import { getFileExtension, formatBytes } from "@/lib/utils/formatters";

interface FileDropzoneProps {
  onFileLoaded: (fileName: string, csvContent: string) => void;
}

type DropzoneStatus = "idle" | "dragging" | "loading" | "success" | "error";

const ACCEPTED_EXTENSIONS = ["csv", "xlsx", "xls", "json"];
const ACCEPTED_MIME_TYPES = [
  "text/csv",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-excel",
  "application/json",
];

export default function FileDropzone({ onFileLoaded }: FileDropzoneProps) {
  const [status, setStatus] = useState<DropzoneStatus>("idle");
  const [progress, setProgress] = useState(0);
  const [errorMessage, setErrorMessage] = useState("");
  const [fileName, setFileName] = useState("");
  const [fileSize, setFileSize] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const processFile = useCallback(
    async (file: File) => {
      const ext = getFileExtension(file.name);
      if (!ACCEPTED_EXTENSIONS.includes(ext)) {
        setStatus("error");
        setErrorMessage(`Unsupported file type: .${ext}. Use CSV, XLSX, or JSON.`);
        return;
      }

      setFileName(file.name);
      setFileSize(file.size);
      setStatus("loading");
      setProgress(0);
      setErrorMessage("");

      // Simulate progress for visual feedback
      const progressInterval = setInterval(() => {
        setProgress((prev) => {
          if (prev >= 90) {
            clearInterval(progressInterval);
            return 90;
          }
          return prev + Math.random() * 15;
        });
      }, 120);

      try {
        let csvContent: string;

        switch (ext) {
          case "csv":
            csvContent = await parseCSV(file);
            break;
          case "xlsx":
          case "xls":
            csvContent = await parseExcel(file);
            break;
          case "json":
            csvContent = await parseJSON(file);
            break;
          default:
            throw new Error(`Unsupported format: .${ext}`);
        }

        clearInterval(progressInterval);
        setProgress(100);
        setStatus("success");

        // Brief delay so the user sees the success state
        setTimeout(() => {
          onFileLoaded(file.name, csvContent);
        }, 600);
      } catch (err) {
        clearInterval(progressInterval);
        setStatus("error");
        setErrorMessage(err instanceof Error ? err.message : "Failed to read file");
      }
    },
    [onFileLoaded]
  );

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setStatus("dragging");
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setStatus("idle");
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const file = e.dataTransfer.files[0];
      if (file) processFile(file);
    },
    [processFile]
  );

  const handleFileSelect = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) processFile(file);
    },
    [processFile]
  );

  const reset = useCallback(() => {
    setStatus("idle");
    setProgress(0);
    setErrorMessage("");
    setFileName("");
    setFileSize(0);
    if (inputRef.current) inputRef.current.value = "";
  }, []);

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4 }}
      className="w-full"
    >
      <div
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onClick={() => status === "idle" && inputRef.current?.click()}
        className={`
          relative overflow-hidden rounded-2xl transition-all duration-300 cursor-pointer
          backdrop-blur-xl bg-white/60 dark:bg-gray-900/60
          border-2 border-dashed
          ${
            status === "dragging"
              ? "border-purple-400 dark:border-purple-500 shadow-[0_0_30px_rgba(168,85,247,0.25)] scale-[1.01]"
              : status === "error"
              ? "border-red-300 dark:border-red-500/50"
              : status === "success"
              ? "border-emerald-300 dark:border-emerald-500/50"
              : "border-gray-200/50 dark:border-gray-700/50 hover:border-purple-300 dark:hover:border-purple-600/50"
          }
        `}
      >
        <input
          ref={inputRef}
          type="file"
          accept={ACCEPTED_MIME_TYPES.join(",")}
          onChange={handleFileSelect}
          className="hidden"
        />

        <div className="p-10 flex flex-col items-center justify-center min-h-[220px]">
          <AnimatePresence mode="wait">
            {status === "idle" || status === "dragging" ? (
              <motion.div
                key="idle"
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.9 }}
                className="flex flex-col items-center gap-4 text-center"
              >
                <motion.div
                  animate={
                    status === "dragging"
                      ? { scale: 1.15, y: -4 }
                      : { scale: 1, y: 0 }
                  }
                  transition={{ type: "spring", stiffness: 300, damping: 20 }}
                  className={`
                    p-4 rounded-2xl
                    ${
                      status === "dragging"
                        ? "bg-purple-100 dark:bg-purple-900/40 text-purple-600 dark:text-purple-400"
                        : "bg-gray-100 dark:bg-gray-800 text-gray-400 dark:text-gray-500"
                    }
                  `}
                >
                  <Upload className="w-8 h-8" />
                </motion.div>

                <div>
                  <p className="text-lg font-medium text-gray-700 dark:text-gray-200">
                    {status === "dragging" ? "Release to upload" : "Drop your data here"}
                  </p>
                  <p className="mt-1 text-sm text-gray-400 dark:text-gray-500">
                    or click to browse -- CSV, XLSX, JSON
                  </p>
                </div>
              </motion.div>
            ) : status === "loading" ? (
              <motion.div
                key="loading"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="flex flex-col items-center gap-4 w-full max-w-xs"
              >
                <motion.div
                  animate={{ rotate: 360 }}
                  transition={{ repeat: Infinity, duration: 2, ease: "linear" }}
                  className="p-3 rounded-xl bg-purple-100 dark:bg-purple-900/40 text-purple-600 dark:text-purple-400"
                >
                  <FileSpreadsheet className="w-7 h-7" />
                </motion.div>

                <div className="text-center">
                  <p className="text-sm font-medium text-gray-700 dark:text-gray-200 truncate max-w-[250px]">
                    {fileName}
                  </p>
                  <p className="text-xs text-gray-400 mt-0.5">{formatBytes(fileSize)}</p>
                </div>

                <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-1.5 overflow-hidden">
                  <motion.div
                    className="h-full bg-gradient-to-r from-purple-500 to-indigo-500 rounded-full"
                    initial={{ width: "0%" }}
                    animate={{ width: `${progress}%` }}
                    transition={{ duration: 0.3 }}
                  />
                </div>
              </motion.div>
            ) : status === "success" ? (
              <motion.div
                key="success"
                initial={{ opacity: 0, scale: 0.8 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0 }}
                className="flex flex-col items-center gap-3"
              >
                <div className="p-3 rounded-xl bg-emerald-100 dark:bg-emerald-900/40 text-emerald-600 dark:text-emerald-400">
                  <CheckCircle2 className="w-7 h-7" />
                </div>
                <p className="text-sm font-medium text-emerald-600 dark:text-emerald-400">
                  Loaded successfully
                </p>
              </motion.div>
            ) : (
              <motion.div
                key="error"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="flex flex-col items-center gap-3"
              >
                <div className="p-3 rounded-xl bg-red-100 dark:bg-red-900/40 text-red-500 dark:text-red-400">
                  <AlertCircle className="w-7 h-7" />
                </div>
                <p className="text-sm text-red-500 dark:text-red-400 text-center max-w-xs">
                  {errorMessage}
                </p>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    reset();
                  }}
                  className="flex items-center gap-1 text-xs text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
                >
                  <X className="w-3 h-3" />
                  Try again
                </button>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </motion.div>
  );
}
