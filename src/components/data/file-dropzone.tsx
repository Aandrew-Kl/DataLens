"use client";

import { useState, useCallback, useId, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Upload,
  FileSpreadsheet,
  FileText,
  FileJson,
  CheckCircle2,
  AlertCircle,
  X,
  Loader2,
} from "lucide-react";
import { getFileExtension, formatBytes } from "@/lib/utils/formatters";

interface FileDropResult {
  fileName: string;
  csvContent: string;
  sizeBytes: number;
}

interface FileDropzoneProps {
  onFileLoaded: (result: FileDropResult) => void;
  compact?: boolean;
  className?: string;
}

type DropzoneStatus = "idle" | "dragging" | "loading" | "success" | "error";

const ACCEPTED_EXTENSIONS = ["csv", "tsv", "json", "xlsx", "xls"];
const MAX_FILE_SIZE = 500 * 1024 * 1024; // 500MB

export default function FileDropzone({
  onFileLoaded,
  compact = false,
  className = "",
}: FileDropzoneProps) {
  const [status, setStatus] = useState<DropzoneStatus>("idle");
  const [progress, setProgress] = useState(0);
  const [errorMessage, setErrorMessage] = useState("");
  const [fileName, setFileName] = useState("");
  const [fileSize, setFileSize] = useState(0);
  const helpTextId = useId();
  const inputRef = useRef<HTMLInputElement>(null);

  const processFile = useCallback(
    async (file: File) => {
      const ext = getFileExtension(file.name);

      if (!ACCEPTED_EXTENSIONS.includes(ext)) {
        setStatus("error");
        setErrorMessage(
          `Unsupported file type: .${ext}. Accepted: ${ACCEPTED_EXTENSIONS.join(", ")}`
        );
        return;
      }

      if (file.size > MAX_FILE_SIZE) {
        setStatus("error");
        setErrorMessage(
          `File too large (${formatBytes(file.size)}). Maximum is ${formatBytes(MAX_FILE_SIZE)}.`
        );
        return;
      }

      setFileName(file.name);
      setFileSize(file.size);
      setStatus("loading");
      setProgress(0);
      setErrorMessage("");

      // Animate progress
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
          case "tsv":
            csvContent = await file.text();
            break;

          case "json": {
            const text = await file.text();
            const data = JSON.parse(text);
            const rows = Array.isArray(data) ? data : [data];

            if (rows.length === 0) throw new Error("Empty JSON data");

            // Flatten nested objects one level deep
            const flatRows = rows.map((row: Record<string, unknown>) => {
              const flat: Record<string, unknown> = {};
              for (const [key, val] of Object.entries(row)) {
                if (
                  val !== null &&
                  typeof val === "object" &&
                  !Array.isArray(val)
                ) {
                  for (const [subKey, subVal] of Object.entries(
                    val as Record<string, unknown>
                  )) {
                    flat[`${key}_${subKey}`] = subVal;
                  }
                } else {
                  flat[key] = val;
                }
              }
              return flat;
            });

            const headers = Object.keys(flatRows[0]);
            const csvLines = [
              headers.join(","),
              ...flatRows.map((row: Record<string, unknown>) =>
                headers
                  .map((h) => {
                    const val = row[h];
                    if (val === null || val === undefined) return "";
                    const str = String(val);
                    return str.includes(",") ||
                      str.includes('"') ||
                      str.includes("\n")
                      ? `"${str.replace(/"/g, '""')}"`
                      : str;
                  })
                  .join(",")
              ),
            ];
            csvContent = csvLines.join("\n");
            break;
          }

          case "xlsx":
          case "xls": {
            const { read, utils } = await import("xlsx");
            const buffer = await file.arrayBuffer();
            const wb = read(buffer, { type: "array" });
            const sheet = wb.Sheets[wb.SheetNames[0]];
            csvContent = utils.sheet_to_csv(sheet);
            break;
          }

          default:
            throw new Error(`Unsupported format: .${ext}`);
        }

        // Validate content
        const lines = csvContent.split("\n").filter((l) => l.trim());
        if (lines.length < 2) {
          throw new Error(
            "File appears empty or has no data rows. Please check the file."
          );
        }

        clearInterval(progressInterval);
        setProgress(100);
        setStatus("success");

        // Brief delay to show success animation
        setTimeout(() => {
          onFileLoaded({
            fileName: file.name,
            csvContent,
            sizeBytes: file.size,
          });
        }, 500);
      } catch (err) {
        clearInterval(progressInterval);
        setStatus("error");
        setErrorMessage(
          err instanceof Error ? err.message : "Failed to read file"
        );
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
      e.target.value = "";
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

  // Compact mode for sidebar or header
  if (compact) {
    return (
      <div className={className}>
        <button
          onClick={() => inputRef.current?.click()}
          disabled={status === "loading"}
          aria-label="Upload data file"
          aria-describedby={helpTextId}
          className="flex items-center gap-2 rounded-lg border border-dashed border-slate-300 dark:border-slate-600 px-3 py-2 text-xs font-medium text-slate-600 dark:text-slate-400 hover:border-indigo-400 dark:hover:border-indigo-600 hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors disabled:opacity-50"
        >
          {status === "loading" ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Upload className="h-3.5 w-3.5" />
          )}
          {status === "loading" ? "Processing..." : "Upload File"}
        </button>
        <span id={helpTextId} className="sr-only">
          Upload CSV, TSV, JSON, or Excel data files up to 500MB.
        </span>
        <input
          ref={inputRef}
          type="file"
          accept=".csv,.tsv,.json,.xlsx,.xls"
          onChange={handleFileSelect}
          className="hidden"
        />
      </div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4 }}
      className={`w-full max-w-xl mx-auto ${className}`}
    >
      <p id={helpTextId} className="sr-only">
        Upload CSV, TSV, JSON, or Excel data files up to 500MB.
      </p>
      <div
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onClick={() =>
          (status === "idle" || status === "error") &&
          inputRef.current?.click()
        }
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            if (status === "idle" || status === "error") {
              inputRef.current?.click();
            }
          }
        }}
        role="button"
        tabIndex={0}
        aria-label="Upload data file"
        aria-describedby={helpTextId}
        className={`
          relative overflow-hidden rounded-2xl transition-all duration-300 cursor-pointer
          backdrop-blur-xl bg-white/60 dark:bg-gray-900/60
          border-2 border-dashed
          ${
            status === "dragging"
              ? "border-indigo-400 dark:border-indigo-500 shadow-[0_0_30px_rgba(99,102,241,0.25)] scale-[1.01]"
              : status === "error"
              ? "border-red-300 dark:border-red-500/50"
              : status === "success"
              ? "border-emerald-300 dark:border-emerald-500/50"
              : "border-gray-200/50 dark:border-gray-700/50 hover:border-indigo-300 dark:hover:border-indigo-600/50"
          }
        `}
      >
        <input
          ref={inputRef}
          type="file"
          accept=".csv,.tsv,.json,.xlsx,.xls"
          onChange={handleFileSelect}
          className="hidden"
        />

        <div className="p-10 flex flex-col items-center justify-center min-h-[220px]">
          <AnimatePresence mode="wait">
            {(status === "idle" || status === "dragging") && (
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
                    p-4 rounded-2xl transition-colors
                    ${
                      status === "dragging"
                        ? "bg-indigo-100 dark:bg-indigo-900/40 text-indigo-600 dark:text-indigo-400"
                        : "bg-gray-100 dark:bg-gray-800 text-gray-400 dark:text-gray-500"
                    }
                  `}
                >
                  <Upload className="w-8 h-8" />
                </motion.div>

                <div>
                  <p className="text-lg font-medium text-gray-700 dark:text-gray-200">
                    {status === "dragging"
                      ? "Release to upload"
                      : "Drop your data here"}
                  </p>
                  <p className="mt-1 text-sm text-gray-400 dark:text-gray-500">
                    or click to browse &middot; Up to 500MB
                  </p>
                </div>

                {/* File type badges */}
                <div className="flex items-center gap-2 pt-2">
                  {[
                    { ext: "CSV", icon: FileText },
                    { ext: "Excel", icon: FileSpreadsheet },
                    { ext: "JSON", icon: FileJson },
                  ].map(({ ext, icon: FileIcon }) => (
                    <span
                      key={ext}
                      className="flex items-center gap-1 text-[10px] font-medium uppercase tracking-wider text-gray-400 dark:text-gray-500 px-2 py-1 rounded-full bg-gray-100 dark:bg-gray-800"
                    >
                      <FileIcon className="h-3 w-3" />
                      {ext}
                    </span>
                  ))}
                </div>
              </motion.div>
            )}

            {status === "loading" && (
              <motion.div
                key="loading"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="flex flex-col items-center gap-4 w-full max-w-xs"
              >
                <motion.div
                  animate={{ rotate: 360 }}
                  transition={{
                    repeat: Infinity,
                    duration: 2,
                    ease: "linear",
                  }}
                  className="p-3 rounded-xl bg-indigo-100 dark:bg-indigo-900/40 text-indigo-600 dark:text-indigo-400"
                >
                  <FileSpreadsheet className="w-7 h-7" />
                </motion.div>

                <div className="text-center">
                  <p className="text-sm font-medium text-gray-700 dark:text-gray-200 truncate max-w-[250px]">
                    {fileName}
                  </p>
                  <p className="text-xs text-gray-400 mt-0.5">
                    {formatBytes(fileSize)}
                  </p>
                </div>

                <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-1.5 overflow-hidden">
                  <motion.div
                    className="h-full bg-gradient-to-r from-indigo-500 to-purple-500 rounded-full"
                    initial={{ width: "0%" }}
                    animate={{ width: `${progress}%` }}
                    transition={{ duration: 0.3 }}
                  />
                </div>
              </motion.div>
            )}

            {status === "success" && (
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
                  Loaded successfully!
                </p>
              </motion.div>
            )}

            {status === "error" && (
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
