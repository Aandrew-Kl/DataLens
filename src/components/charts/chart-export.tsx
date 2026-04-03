"use client";

import NextImage from "next/image";
import { useState, type RefObject } from "react";
import ReactEChartsCore from "echarts-for-react/lib/core";
import * as echarts from "echarts/core";
import { SVGRenderer, CanvasRenderer } from "echarts/renderers";
import type { EChartsOption } from "echarts";
import { AnimatePresence, motion } from "framer-motion";
import {
  Copy,
  Download,
  ExternalLink,
  FileImage,
  History,
  Link2,
  Loader2,
  Printer,
  RefreshCw,
} from "lucide-react";
import { downloadFile } from "@/lib/utils/export";

echarts.use([SVGRenderer, CanvasRenderer]);

interface ChartExportProps {
  chartRef: RefObject<ReactEChartsCore | null>;
  chartTitle: string;
}

interface DownloadHistoryEntry {
  id: string;
  format: "png" | "svg" | "pdf" | "batch";
  title: string;
  width: number;
  height: number;
  timestamp: number;
}

type ExportFormat = "png" | "svg" | "pdf";
type BackgroundChoice = "transparent" | "white" | "dark";

const STORAGE_KEY = "datalens:chart-export-history";
const EASE = [0.22, 1, 0.36, 1] as const;
const CARD_CLASS =
  "rounded-[1.75rem] border border-white/20 bg-white/75 shadow-xl shadow-slate-950/10 backdrop-blur-2xl dark:border-white/10 dark:bg-slate-950/45";

function readHistory(): DownloadHistoryEntry[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as DownloadHistoryEntry[]) : [];
  } catch {
    return [];
  }
}

function writeHistory(history: DownloadHistoryEntry[]) {
  if (typeof window === "undefined") return;
  window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(history));
}

function createId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function backgroundToColor(choice: BackgroundChoice): string {
  if (choice === "white") return "#ffffff";
  if (choice === "dark") return "#020617";
  return "transparent";
}

function dataUrlToBlob(dataUrl: string): Blob {
  const [header, encoded] = dataUrl.split(",");
  const mimeMatch = /data:(.*?);base64/.exec(header ?? "");
  const binary = window.atob(encoded ?? "");
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return new Blob([bytes], { type: mimeMatch?.[1] ?? "image/png" });
}

async function renderOptionToCanvasDataUrl(
  option: EChartsOption,
  title: string,
  width: number,
  height: number,
  background: BackgroundChoice,
  pixelRatio: number,
  showTitle: boolean,
): Promise<string> {
  const host = document.createElement("div");
  host.style.position = "fixed";
  host.style.left = "-99999px";
  host.style.top = "0";
  host.style.width = `${width}px`;
  host.style.height = `${height}px`;
  document.body.appendChild(host);

  const instance = echarts.init(host, undefined, {
    renderer: "canvas",
    width,
    height,
  });

  try {
    instance.setOption(option);
    const baseUrl = instance.getDataURL({
      type: "png",
      pixelRatio,
      backgroundColor: backgroundToColor(background),
    });

    if (!showTitle) return baseUrl;

    const baseImage = await new Promise<HTMLImageElement>((resolve, reject) => {
      const image = new window.Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error("Unable to generate export preview."));
      image.src = baseUrl;
    });
    const canvas = document.createElement("canvas");
    canvas.width = baseImage.width;
    canvas.height = baseImage.height + 72;
    const context = canvas.getContext("2d");
    if (!context) return baseUrl;

    if (background !== "transparent") {
      context.fillStyle = backgroundToColor(background);
      context.fillRect(0, 0, canvas.width, canvas.height);
    }

    context.fillStyle = background === "dark" ? "#f8fafc" : "#0f172a";
    context.font = `600 ${Math.max(Math.round(canvas.width / 34), 22)}px ui-sans-serif`;
    context.fillText(title, 24, 42);
    context.drawImage(baseImage, 0, 72);
    context.fillStyle = background === "dark" ? "rgba(226,232,240,0.8)" : "rgba(71,85,105,0.8)";
    context.font = "500 14px ui-sans-serif";
    context.fillText("DataLens export", 24, canvas.height - 18);

    return canvas.toDataURL("image/png");
  } finally {
    instance.dispose();
    document.body.removeChild(host);
  }
}

function renderOptionToSvg(
  option: EChartsOption,
  width: number,
  height: number,
): string {
  const host = document.createElement("div");
  host.style.position = "fixed";
  host.style.left = "-99999px";
  host.style.top = "0";
  host.style.width = `${width}px`;
  host.style.height = `${height}px`;
  document.body.appendChild(host);

  const instance = echarts.init(host, undefined, { renderer: "svg", width, height });

  try {
    instance.setOption(option);
    return instance.renderToSVGString();
  } finally {
    instance.dispose();
    document.body.removeChild(host);
  }
}

function getChartInstance(chartRef: RefObject<ReactEChartsCore | null>) {
  return chartRef.current?.getEchartsInstance() ?? null;
}

function getBatchInstances() {
  const domNodes = Array.from(document.querySelectorAll<HTMLElement>(".echarts-for-react"));
  return domNodes.reduce<NonNullable<ReturnType<typeof getChartInstance>>[]>((instances, node) => {
    const instance = echarts.getInstanceByDom(node) as
      | NonNullable<ReturnType<typeof getChartInstance>>
      | undefined;
    if (instance) instances.push(instance);
    return instances;
  }, []);
}

export default function ChartExport({ chartRef, chartTitle }: ChartExportProps) {
  const [pixelRatio, setPixelRatio] = useState(2);
  const [width, setWidth] = useState(1280);
  const [height, setHeight] = useState(720);
  const [background, setBackground] = useState<BackgroundChoice>("transparent");
  const [includeTitle, setIncludeTitle] = useState(true);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const [history, setHistory] = useState<DownloadHistoryEntry[]>(() => readHistory());
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  function pushHistory(entry: DownloadHistoryEntry) {
    setHistory((current) => {
      const next = [entry, ...current].slice(0, 10);
      writeHistory(next);
      return next;
    });
  }

  async function refreshPreview() {
    const instance = getChartInstance(chartRef);
    if (!instance) {
      setNotice("Render the chart before exporting it.");
      return;
    }

    setLoading(true);
    try {
      const url = await renderOptionToCanvasDataUrl(
        instance.getOption() as EChartsOption,
        chartTitle,
        width,
        height,
        background,
        pixelRatio,
        includeTitle,
      );
      setPreviewUrl(url);
      setNotice("Preview refreshed.");
    } catch (previewError) {
      setNotice(previewError instanceof Error ? previewError.message : "Preview failed.");
    } finally {
      setLoading(false);
    }
  }

  async function exportChart(format: ExportFormat) {
    const instance = getChartInstance(chartRef);
    if (!instance) {
      setNotice("Render the chart before exporting it.");
      return;
    }

    setLoading(true);

    try {
      const option = instance.getOption() as EChartsOption;

      if (format === "png") {
        const dataUrl = await renderOptionToCanvasDataUrl(
          option,
          chartTitle,
          width,
          height,
          background,
          pixelRatio,
          includeTitle,
        );
        const blob = dataUrlToBlob(dataUrl);
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement("a");
        anchor.href = url;
        anchor.download = `${chartTitle || "chart"}.png`;
        anchor.click();
        window.setTimeout(() => URL.revokeObjectURL(url), 100);
      }

      if (format === "svg") {
        const svgMarkup = renderOptionToSvg(option, width, height);
        downloadFile(svgMarkup, `${chartTitle || "chart"}.svg`, "image/svg+xml;charset=utf-8");
      }

      if (format === "pdf") {
        const pdfImage = await renderOptionToCanvasDataUrl(
          option,
          chartTitle,
          width,
          height,
          background === "transparent" ? "white" : background,
          Math.max(pixelRatio, 2),
          includeTitle,
        );
        const printWindow = window.open("", "_blank", "noopener,noreferrer,width=1100,height=800");
        if (printWindow) {
          printWindow.document.write(`
            <html>
              <head><title>${chartTitle}</title></head>
              <body style="margin:0;padding:24px;font-family:ui-sans-serif;background:#fff;">
                <img src="${pdfImage}" alt="${chartTitle}" style="max-width:100%;height:auto;display:block;" />
                <script>window.onload = () => window.print();</script>
              </body>
            </html>
          `);
          printWindow.document.close();
        }
      }

      pushHistory({
        id: createId(),
        format,
        title: chartTitle,
        width,
        height,
        timestamp: Date.now(),
      });
      setNotice(`${format.toUpperCase()} export completed.`);
    } catch (exportError) {
      setNotice(exportError instanceof Error ? exportError.message : "Export failed.");
    } finally {
      setLoading(false);
    }
  }

  async function copyToClipboard() {
    const instance = getChartInstance(chartRef);
    if (!instance) {
      setNotice("Render the chart before copying it.");
      return;
    }

    try {
      const dataUrl = await renderOptionToCanvasDataUrl(
        instance.getOption() as EChartsOption,
        chartTitle,
        width,
        height,
        background,
        pixelRatio,
        includeTitle,
      );
      const blob = dataUrlToBlob(dataUrl);
      await navigator.clipboard.write([
        new ClipboardItem({
          [blob.type]: blob,
        }),
      ]);
      setNotice("Chart copied to clipboard.");
    } catch (clipboardError) {
      setNotice(
        clipboardError instanceof Error
          ? clipboardError.message
          : "Clipboard export failed.",
      );
    }
  }

  function generateShareUrl() {
    const currentOption = getChartInstance(chartRef)?.getOption() as EChartsOption | undefined;
    if (!currentOption) {
      setNotice("Render the chart before generating a share URL.");
      return;
    }

    const payload = window.btoa(unescape(encodeURIComponent(JSON.stringify(currentOption))));
    const url = new URL(window.location.href);
    url.searchParams.set("chart", payload);
    setShareUrl(url.toString());
    setNotice("Share URL generated.");
  }

  async function batchExport() {
    const instances = getBatchInstances();
    if (instances.length === 0) {
      setNotice("No mounted charts were found for batch export.");
      return;
    }

    setLoading(true);

    try {
      for (const [index, instance] of instances.entries()) {
        const dataUrl = await renderOptionToCanvasDataUrl(
          instance.getOption() as EChartsOption,
          `${chartTitle} ${index + 1}`,
          width,
          height,
          background,
          pixelRatio,
          includeTitle,
        );
        const blob = dataUrlToBlob(dataUrl);
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement("a");
        anchor.href = url;
        anchor.download = `${chartTitle || "chart"}-${index + 1}.png`;
        anchor.click();
        window.setTimeout(() => URL.revokeObjectURL(url), 100);
      }

      pushHistory({
        id: createId(),
        format: "batch",
        title: `${chartTitle} (batch)`,
        width,
        height,
        timestamp: Date.now(),
      });
      setNotice(`Exported ${instances.length} chart(s) as PNG.`);
    } catch (batchError) {
      setNotice(batchError instanceof Error ? batchError.message : "Batch export failed.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className={`${CARD_CLASS} overflow-hidden p-5`}>
      <div className="flex flex-col gap-5 border-b border-white/15 pb-5 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex items-center gap-4">
          <div className="flex h-12 w-12 items-center justify-center rounded-[1.25rem] bg-cyan-500/10 text-cyan-700 dark:text-cyan-300">
            <FileImage className="h-5 w-5" />
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-slate-500 dark:text-slate-400">
              Chart Export
            </p>
            <h2 className="mt-1 text-xl font-semibold text-slate-950 dark:text-slate-50">
              Export {chartTitle} with preview, history, and sharing support
            </h2>
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => void refreshPreview()}
            className="inline-flex items-center gap-2 rounded-[1rem] border border-white/15 bg-white/45 px-4 py-3 text-sm text-slate-700 transition hover:bg-white/60 dark:bg-slate-900/30 dark:text-slate-200"
          >
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            Refresh preview
          </button>
          <button
            type="button"
            onClick={() => void batchExport()}
            className="inline-flex items-center gap-2 rounded-[1rem] border border-white/15 bg-white/45 px-4 py-3 text-sm text-slate-700 transition hover:bg-white/60 dark:bg-slate-900/30 dark:text-slate-200"
          >
            <Download className="h-4 w-4" />
            Batch export
          </button>
        </div>
      </div>

      <div className="mt-5 grid gap-5 xl:grid-cols-[0.9fr_1.1fr]">
        <div className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            <div className="rounded-[1.3rem] border border-white/15 bg-white/45 p-4 dark:bg-slate-900/30">
              <label className="block text-sm font-semibold text-slate-900 dark:text-slate-50">
                Pixel ratio
              </label>
              <select
                value={pixelRatio}
                onChange={(event) => setPixelRatio(Number(event.target.value))}
                className="mt-3 w-full rounded-[1rem] border border-white/20 bg-white/75 px-4 py-3 text-sm text-slate-900 outline-none dark:bg-slate-950/60 dark:text-slate-50"
              >
                <option value={2}>PNG 2x</option>
                <option value={4}>PNG 4x</option>
              </select>
            </div>

            <div className="rounded-[1.3rem] border border-white/15 bg-white/45 p-4 dark:bg-slate-900/30">
              <label className="block text-sm font-semibold text-slate-900 dark:text-slate-50">
                Background
              </label>
              <select
                value={background}
                onChange={(event) => setBackground(event.target.value as BackgroundChoice)}
                className="mt-3 w-full rounded-[1rem] border border-white/20 bg-white/75 px-4 py-3 text-sm text-slate-900 outline-none dark:bg-slate-950/60 dark:text-slate-50"
              >
                <option value="transparent">Transparent</option>
                <option value="white">White</option>
                <option value="dark">Dark</option>
              </select>
            </div>

            <div className="rounded-[1.3rem] border border-white/15 bg-white/45 p-4 dark:bg-slate-900/30">
              <label className="block text-sm font-semibold text-slate-900 dark:text-slate-50">
                Width
              </label>
              <input
                type="number"
                min={320}
                value={width}
                onChange={(event) => setWidth(Math.max(Number(event.target.value), 320))}
                className="mt-3 w-full rounded-[1rem] border border-white/20 bg-white/75 px-4 py-3 text-sm text-slate-900 outline-none dark:bg-slate-950/60 dark:text-slate-50"
              />
            </div>

            <div className="rounded-[1.3rem] border border-white/15 bg-white/45 p-4 dark:bg-slate-900/30">
              <label className="block text-sm font-semibold text-slate-900 dark:text-slate-50">
                Height
              </label>
              <input
                type="number"
                min={240}
                value={height}
                onChange={(event) => setHeight(Math.max(Number(event.target.value), 240))}
                className="mt-3 w-full rounded-[1rem] border border-white/20 bg-white/75 px-4 py-3 text-sm text-slate-900 outline-none dark:bg-slate-950/60 dark:text-slate-50"
              />
            </div>
          </div>

          <div className="rounded-[1.3rem] border border-white/15 bg-white/45 p-4 dark:bg-slate-900/30">
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-sm font-semibold text-slate-900 dark:text-slate-50">
                  Title and watermark
                </p>
                <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                  Add the chart title and a DataLens watermark to exported PNG and PDF output.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setIncludeTitle((current) => !current)}
                className={`relative h-7 w-12 rounded-full transition ${
                  includeTitle ? "bg-cyan-500" : "bg-slate-300 dark:bg-slate-700"
                }`}
              >
                <span
                  className={`absolute top-1 h-5 w-5 rounded-full bg-white transition ${
                    includeTitle ? "left-6" : "left-1"
                  }`}
                />
              </button>
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => void exportChart("png")}
              className="inline-flex items-center gap-2 rounded-[1rem] bg-cyan-600 px-4 py-3 text-sm font-semibold text-white transition hover:bg-cyan-500"
            >
              <Download className="h-4 w-4" />
              Export PNG
            </button>
            <button
              type="button"
              onClick={() => void exportChart("svg")}
              className="inline-flex items-center gap-2 rounded-[1rem] border border-white/15 bg-white/45 px-4 py-3 text-sm text-slate-700 transition hover:bg-white/60 dark:bg-slate-900/30 dark:text-slate-200"
            >
              <ExternalLink className="h-4 w-4" />
              Export SVG
            </button>
            <button
              type="button"
              onClick={() => void exportChart("pdf")}
              className="inline-flex items-center gap-2 rounded-[1rem] border border-white/15 bg-white/45 px-4 py-3 text-sm text-slate-700 transition hover:bg-white/60 dark:bg-slate-900/30 dark:text-slate-200"
            >
              <Printer className="h-4 w-4" />
              Export PDF
            </button>
            <button
              type="button"
              onClick={() => void copyToClipboard()}
              className="inline-flex items-center gap-2 rounded-[1rem] border border-white/15 bg-white/45 px-4 py-3 text-sm text-slate-700 transition hover:bg-white/60 dark:bg-slate-900/30 dark:text-slate-200"
            >
              <Copy className="h-4 w-4" />
              Copy image
            </button>
            <button
              type="button"
              onClick={generateShareUrl}
              className="inline-flex items-center gap-2 rounded-[1rem] border border-white/15 bg-white/45 px-4 py-3 text-sm text-slate-700 transition hover:bg-white/60 dark:bg-slate-900/30 dark:text-slate-200"
            >
              <Link2 className="h-4 w-4" />
              Generate share URL
            </button>
          </div>

          {shareUrl ? (
            <div className="rounded-[1.2rem] border border-white/15 bg-white/45 p-4 dark:bg-slate-900/30">
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400">
                Share URL
              </p>
              <p className="mt-2 break-all text-sm text-slate-700 dark:text-slate-200">{shareUrl}</p>
            </div>
          ) : null}
        </div>

        <div className="space-y-4">
          <div className="rounded-[1.3rem] border border-white/15 bg-white/45 p-4 dark:bg-slate-900/30">
            <p className="text-sm font-semibold text-slate-900 dark:text-slate-50">Preview</p>
            <div className="mt-4 overflow-hidden rounded-[1.1rem] border border-white/15 bg-slate-100/70 p-3 dark:bg-slate-950/35">
              {previewUrl ? (
                <NextImage
                  src={previewUrl}
                  alt={`${chartTitle} preview`}
                  width={width}
                  height={height}
                  unoptimized
                  className="w-full rounded-[0.8rem]"
                />
              ) : (
                <div className="flex min-h-64 items-center justify-center text-sm text-slate-500 dark:text-slate-400">
                  Generate a preview before exporting.
                </div>
              )}
            </div>
          </div>

          <div className="rounded-[1.3rem] border border-white/15 bg-white/45 p-4 dark:bg-slate-900/30">
            <div className="flex items-center gap-2">
              <History className="h-4 w-4 text-slate-500 dark:text-slate-400" />
              <p className="text-sm font-semibold text-slate-900 dark:text-slate-50">Download history</p>
            </div>
            <div className="mt-4 space-y-3">
              {history.length === 0 ? (
                <p className="text-sm text-slate-500 dark:text-slate-400">
                  No export history stored in sessionStorage yet.
                </p>
              ) : (
                history.map((entry) => (
                  <div
                    key={entry.id}
                    className="rounded-[1rem] border border-white/15 bg-white/55 px-4 py-3 dark:bg-slate-950/25"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-sm font-semibold text-slate-900 dark:text-slate-50">
                        {entry.title}
                      </p>
                      <span className="text-xs text-slate-500 dark:text-slate-400">
                        {entry.format.toUpperCase()}
                      </span>
                    </div>
                    <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                      {entry.width} × {entry.height} · {new Date(entry.timestamp).toLocaleString()}
                    </p>
                  </div>
                ))
              )}
            </div>
          </div>

          <AnimatePresence mode="wait">
            {notice ? (
              <motion.div
                key={notice}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                transition={{ duration: 0.24, ease: EASE }}
                className="rounded-[1.2rem] border border-cyan-400/20 bg-cyan-500/10 px-4 py-3 text-sm text-cyan-800 dark:text-cyan-300"
              >
                {notice}
              </motion.div>
            ) : null}
          </AnimatePresence>
        </div>
      </div>
    </section>
  );
}
