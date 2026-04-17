"use client";

import { AlertTriangle, BadgeInfo, CheckCircle2, Eraser, Sparkles } from "lucide-react";
import type { Dispatch, SetStateAction } from "react";

export interface PreviewSample {
  id: string;
  before: string;
  after: string;
  detail: string;
}

export interface PreviewState {
  issueId: string;
  title: string;
  sql: string;
  rows: PreviewSample[];
}

interface CleanerPreviewProps {
  preview: PreviewState | null;
  setPreview: Dispatch<SetStateAction<PreviewState | null>>;
}

export function CleanerPreview({ preview, setPreview }: CleanerPreviewProps) {
  return (
    <>
      <div className="rounded-3xl border border-white/10 bg-white/10 p-5 dark:bg-slate-950/35">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="inline-flex items-center gap-2 text-sm font-semibold text-slate-950 dark:text-slate-50">
              <Sparkles className="h-4 w-4 text-cyan-500" />
              Preview
            </p>
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">Before and after samples from the pending DuckDB rewrite.</p>
          </div>
          {preview ? (
            <button type="button" onClick={() => setPreview(null)} className="rounded-full border border-white/10 bg-white/10 px-3 py-1 text-xs font-semibold text-slate-600 transition hover:bg-white/15 dark:text-slate-300">
              Clear
            </button>
          ) : null}
        </div>

        {preview ? (
          <div className="mt-4 space-y-3">
            <div className="rounded-2xl border border-white/10 bg-black/15 px-4 py-3 text-sm text-slate-700 dark:text-slate-200">{preview.title}</div>
            {preview.rows.length ? (
              preview.rows.map((row) => (
                <div key={row.id} className="rounded-2xl border border-white/10 bg-black/10 p-4">
                  <p className="text-xs uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">{row.detail}</p>
                  <div className="mt-3 grid gap-3 md:grid-cols-2">
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">Before</p>
                      <p className="mt-2 rounded-xl border border-red-400/20 bg-red-500/10 px-3 py-2 text-sm text-red-800 dark:text-red-200">{row.before}</p>
                    </div>
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">After</p>
                      <p className="mt-2 rounded-xl border border-emerald-400/20 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-800 dark:text-emerald-200">{row.after}</p>
                    </div>
                  </div>
                </div>
              ))
            ) : (
              <div className="rounded-2xl border border-white/10 bg-black/10 px-4 py-5 text-sm text-slate-500 dark:text-slate-400">No sample rows were returned for this preview.</div>
            )}
          </div>
        ) : (
          <div className="mt-4 rounded-2xl border border-dashed border-white/10 px-4 py-8 text-sm text-slate-500 dark:text-slate-400">
            Pick an issue and preview the change set before applying it.
          </div>
        )}
      </div>

      <div className="rounded-3xl border border-white/10 bg-white/10 p-5 dark:bg-slate-950/35">
        <p className="inline-flex items-center gap-2 text-sm font-semibold text-slate-950 dark:text-slate-50">
          <BadgeInfo className="h-4 w-4 text-cyan-500" />
          Issue guide
        </p>
        <div className="mt-4 grid gap-3">
          {[
            { icon: AlertTriangle, label: "Critical", copy: "Immediate risk to completeness or row integrity." },
            { icon: Eraser, label: "Warning", copy: "Recommended cleanup that is likely safe to batch." },
            { icon: CheckCircle2, label: "Info", copy: "Low-risk drift that can be handled later." },
          ].map((item) => (
            <div key={item.label} className="rounded-2xl border border-white/10 bg-black/10 p-4">
              <p className="inline-flex items-center gap-2 text-sm font-semibold text-slate-900 dark:text-slate-100">
                <item.icon className="h-4 w-4 text-cyan-500" />
                {item.label}
              </p>
              <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">{item.copy}</p>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
