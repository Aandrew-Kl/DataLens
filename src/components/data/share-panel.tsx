"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Check, Code2, Copy, Download, FileCode2, FileJson, Link2, Share2, Table2, X } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { downloadFile } from "@/lib/utils/export";
import { formatBytes } from "@/lib/utils/formatters";
import type { DatasetMeta } from "@/types/dataset";

interface SharePanelProps { open: boolean; onClose: () => void; dataset: DatasetMeta; currentTab: string; currentSQL?: string; }
interface ShareArtifact { id: string; icon: LucideIcon; title: string; description: string; content: string; tone: string; fileName?: string; mimeType?: string; }

const nf = new Intl.NumberFormat();
const base64Chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

function bytesToBase64(bytes: Uint8Array) {
  let value = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i] ?? 0;
    const b = bytes[i + 1] ?? 0;
    const c = bytes[i + 2] ?? 0;
    const chunk = (a << 16) | (b << 8) | c;
    value += base64Chars[(chunk >> 18) & 63];
    value += base64Chars[(chunk >> 12) & 63];
    value += i + 1 < bytes.length ? base64Chars[(chunk >> 6) & 63] : "=";
    value += i + 2 < bytes.length ? base64Chars[chunk & 63] : "=";
  }
  return value;
}

function encodeBase64Url(value: string) {
  return bytesToBase64(new TextEncoder().encode(value))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function sanitizeName(value: string) {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48) || "dataset";
}

function escapeMarkdownCell(value: string) {
  return value.replace(/\|/g, "\\|").replace(/\n/g, " ");
}

function buildArtifacts(dataset: DatasetMeta, currentTab: string, currentSQL?: string): ShareArtifact[] {
  const sql = currentSQL?.trim() || null;
  const payload = { version: 1, datasetId: dataset.id, datasetName: dataset.name, fileName: dataset.fileName, currentTab, currentSQL: sql, generatedAt: new Date().toISOString() };
  const encodedPayload = encodeBase64Url(JSON.stringify(payload));
  const baseUrl = typeof window === "undefined" ? new URL("https://datalens.local/") : new URL(window.location.href);
  baseUrl.search = "";
  baseUrl.hash = "";
  baseUrl.searchParams.set("share", encodedPayload);

  const embedUrl = new URL(baseUrl.toString());
  embedUrl.searchParams.set("embed", "1");

  const embedHtml = [
    "<iframe",
    `  src="${embedUrl.toString()}"`,
    '  title="DataLens share embed"',
    '  width="100%"',
    '  height="640"',
    '  style="border: 1px solid #334155; border-radius: 18px; overflow: hidden;"',
    '  loading="lazy"',
    "></iframe>",
  ].join("\n");

  const markdown = [
    `# ${dataset.name}`,
    "",
    `- Dataset ID: \`${dataset.id}\``,
    `- File: \`${dataset.fileName}\``,
    `- Rows: ${nf.format(dataset.rowCount)}`,
    `- Columns: ${nf.format(dataset.columnCount)}`,
    `- Size: ${formatBytes(dataset.sizeBytes)}`,
    `- Active tab: \`${currentTab}\``,
    `- Share URL: ${baseUrl.toString()}`,
    "",
    "## Schema snapshot",
    "",
    "| Column | Type | Unique | Nulls |",
    "| --- | --- | ---: | ---: |",
    ...dataset.columns.map((column) => `| ${escapeMarkdownCell(column.name)} | ${column.type} | ${nf.format(column.uniqueCount)} | ${nf.format(column.nullCount)} |`),
    ...(sql ? ["", "## SQL", "", "```sql", sql, "```"] : []),
  ].join("\n");
  const config = JSON.stringify({ format: "datalens", version: 1, exportedAt: new Date().toISOString(), dataset, view: { currentTab, currentSQL: sql }, share: { url: baseUrl.toString(), encodedPayload }, embed: { html: embedHtml } }, null, 2);

  const baseName = sanitizeName(dataset.name);
  return [
    { id: "embed-html", icon: Code2, title: "Embed HTML", description: "Iframe snippet for docs, wikis, or internal portals.", content: embedHtml, tone: "bg-cyan-500/10 text-cyan-600 ring-cyan-500/20 dark:text-cyan-300" },
    { id: "share-url", icon: Link2, title: "Base64 URL", description: "Shareable link with a URL-safe base64 state payload.", content: baseUrl.toString(), tone: "bg-emerald-500/10 text-emerald-600 ring-emerald-500/20 dark:text-emerald-300" },
    { id: "markdown-summary", icon: FileCode2, title: "Markdown Summary", description: "Dataset handoff notes with schema and optional SQL.", content: markdown, tone: "bg-amber-500/10 text-amber-600 ring-amber-500/20 dark:text-amber-300" },
    { id: "datalens-config", icon: FileJson, title: ".datalens Config", description: "Portable JSON export you can re-import later.", content: config, tone: "bg-fuchsia-500/10 text-fuchsia-600 ring-fuchsia-500/20 dark:text-fuchsia-300", fileName: `${baseName}.datalens`, mimeType: "application/json;charset=utf-8;" },
  ];
}

function ArtifactCard({ artifact, copied, onCopy, onExport }: { artifact: ShareArtifact; copied: boolean; onCopy: (artifact: ShareArtifact) => void; onExport: (artifact: ShareArtifact) => void; }) {
  const Icon = artifact.icon;

  return (
    <article className="overflow-hidden rounded-2xl border border-gray-200/70 bg-white/75 shadow-sm dark:border-gray-700/70 dark:bg-gray-900/70">
      <div className="flex items-start gap-3 border-b border-gray-200/70 px-4 py-4 dark:border-gray-800/80">
        <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl ring-1 ${artifact.tone}`}>
          <Icon className="h-4 w-4" />
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">{artifact.title}</h3>
          <p className="mt-1 text-xs leading-5 text-gray-500 dark:text-gray-400">{artifact.description}</p>
        </div>
        <button
          type="button"
          onClick={() => onCopy(artifact)}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-xl bg-gray-950 px-3 py-2 text-xs font-medium text-white transition-colors hover:bg-gray-800 dark:bg-gray-100 dark:text-gray-950 dark:hover:bg-white"
        >
          {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <div className="bg-gray-50/80 px-4 py-3 dark:bg-gray-950/60">
        <div className="mb-2 flex items-center justify-between gap-3">
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-gray-400 dark:text-gray-500">Preview</p>
          {artifact.fileName && artifact.mimeType ? (
            <button
              type="button"
              onClick={() => onExport(artifact)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200/80 px-2.5 py-1.5 text-[11px] font-medium text-gray-600 transition-colors hover:bg-white dark:border-gray-800 dark:text-gray-300 dark:hover:bg-gray-900"
            >
              <Download className="h-3 w-3" />
              Export .datalens
            </button>
          ) : null}
        </div>
        <pre className="max-h-56 overflow-auto whitespace-pre-wrap break-words rounded-xl border border-gray-200/70 bg-white px-3 py-3 text-[11px] leading-5 text-gray-600 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-300">
          {artifact.content}
        </pre>
      </div>
    </article>
  );
}

export default function SharePanel({ open, onClose, dataset, currentTab, currentSQL }: SharePanelProps) {
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const timerRef = useRef<number | null>(null);
  const artifacts = useMemo(() => buildArtifacts(dataset, currentTab, currentSQL), [dataset, currentTab, currentSQL]);
  const stats = [
    { label: "Rows", value: nf.format(dataset.rowCount) },
    { label: "Columns", value: nf.format(dataset.columnCount), icon: <Table2 className="h-3.5 w-3.5 text-cyan-500" /> },
    { label: "Size", value: formatBytes(dataset.sizeBytes) },
    { label: "View", value: currentTab, truncate: true },
  ];

  const clearCopied = useCallback(() => {
    if (timerRef.current) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    setCopiedId(null);
  }, []);

  const handleClose = useCallback(() => {
    clearCopied();
    onClose();
  }, [clearCopied, onClose]);

  useEffect(() => {
    if (!open) return;
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") handleClose();
    };
    document.addEventListener("keydown", handleEscape);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", handleEscape);
      document.body.style.overflow = "";
    };
  }, [handleClose, open]);

  useEffect(() => () => clearCopied(), [clearCopied]);

  const handleCopy = useCallback(
    async (artifact: ShareArtifact) => {
      await navigator.clipboard.writeText(artifact.content);
      setCopiedId(artifact.id);
      if (timerRef.current) window.clearTimeout(timerRef.current);
      timerRef.current = window.setTimeout(() => setCopiedId(null), 1800);
    },
    [],
  );

  const handleExport = useCallback((artifact: ShareArtifact) => {
    if (!artifact.fileName || !artifact.mimeType) return;
    downloadFile(artifact.content, artifact.fileName, artifact.mimeType);
  }, []);

  return (
    <AnimatePresence>
      {open ? (
        <motion.div className="fixed inset-0 z-50 flex justify-end" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.18 }}>
          <motion.button
            type="button"
            aria-label="Close share panel"
            className="absolute inset-0 bg-black/45 backdrop-blur-sm"
            onClick={handleClose}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          />
          <motion.aside
            className="relative flex h-full w-full max-w-2xl flex-col border-l border-gray-200/60 bg-white/95 shadow-2xl backdrop-blur-xl dark:border-gray-700/60 dark:bg-gray-900/95"
            initial={{ x: "100%" }}
            animate={{ x: 0 }}
            exit={{ x: "100%" }}
            transition={{ type: "spring", damping: 30, stiffness: 280 }}
            onClick={(event) => event.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-label={`Share ${dataset.name}`}
          >
            <div className="border-b border-gray-200/70 px-6 py-5 dark:border-gray-700/70">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <div className="inline-flex items-center gap-2 rounded-full border border-sky-400/20 bg-sky-500/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-sky-700 dark:text-sky-300">
                    <Share2 className="h-3.5 w-3.5" />
                    Share & Embed
                  </div>
                  <h2 className="mt-3 text-xl font-semibold text-gray-900 dark:text-gray-50">{dataset.name}</h2>
                  <p className="mt-2 max-w-xl text-sm leading-6 text-gray-600 dark:text-gray-300">Generate an embed, a base64-backed share URL, markdown notes, and a portable DataLens config from the current view.</p>
                </div>
                <button
                  type="button"
                  onClick={handleClose}
                  className="rounded-xl p-2 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600 dark:text-gray-500 dark:hover:bg-gray-800 dark:hover:text-gray-300"
                  aria-label="Close share panel"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
              <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
                {stats.map((stat) => (
                  <div key={stat.label} className="rounded-xl border border-gray-200/70 bg-gray-50/80 px-3 py-3 dark:border-gray-700/70 dark:bg-gray-950/40">
                    <p className="text-[10px] uppercase tracking-[0.16em] text-gray-500 dark:text-gray-400">{stat.label}</p>
                    <p className={`mt-2 flex items-center gap-2 text-sm font-semibold text-gray-900 dark:text-gray-100 ${stat.truncate ? "truncate" : ""}`}>{stat.icon}{stat.value}</p>
                  </div>
                ))}
              </div>
            </div>
            <div className="flex-1 space-y-4 overflow-y-auto px-6 py-5">
              {artifacts.map((artifact) => (
                <ArtifactCard key={artifact.id} artifact={artifact} copied={copiedId === artifact.id} onCopy={handleCopy} onExport={handleExport} />
              ))}
            </div>
          </motion.aside>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
