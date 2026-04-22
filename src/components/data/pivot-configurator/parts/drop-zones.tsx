"use client";

import { GripVertical, Trash2 } from "lucide-react";
import type { ReactNode } from "react";
import type { ColumnProfile } from "@/types/dataset";

import type { DropZoneKind, NoticeState } from "../types";

export function NoticeBanner({ notice }: { notice: NoticeState | null }) {
  if (!notice) return null;

  const toneClass =
    notice.tone === "error"
      ? "border-rose-400/30 bg-rose-500/10 text-rose-700 dark:text-rose-300"
      : notice.tone === "success"
        ? "border-emerald-400/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
        : "border-cyan-400/30 bg-cyan-500/10 text-cyan-700 dark:text-cyan-300";

  return <div className={`rounded-2xl border px-4 py-3 text-sm ${toneClass}`}>{notice.message}</div>;
}

export function DraggableColumn({ column }: { column: ColumnProfile }) {
  function handleDragStart(event: React.DragEvent<HTMLButtonElement>) {
    event.dataTransfer.setData("text/plain", column.name);
    event.dataTransfer.effectAllowed = "copy";
  }

  return (
    <button
      type="button"
      draggable
      onDragStart={handleDragStart}
      className="flex items-center justify-between gap-3 rounded-2xl border border-white/15 bg-white/45 px-3 py-2 text-left text-sm text-slate-700 transition hover:border-cyan-300/40 dark:bg-slate-950/35 dark:text-slate-200"
    >
      <span className="truncate">{column.name}</span>
      <span className="shrink-0 rounded-full bg-white/70 px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500 dark:bg-slate-900/70 dark:text-slate-300">
        {column.type}
      </span>
    </button>
  );
}

export function DropZone({
  title,
  kind,
  subtitle,
  onDropColumn,
  children,
}: {
  title: string;
  kind: DropZoneKind;
  subtitle: string;
  onDropColumn: (columnName: string, kind: DropZoneKind) => void;
  children: ReactNode;
}) {
  function handleDrop(event: React.DragEvent<HTMLDivElement>) {
    event.preventDefault();
    const columnName = event.dataTransfer.getData("text/plain");
    if (columnName) {
      onDropColumn(columnName, kind);
    }
  }

  return (
    <div
      onDragOver={(event) => event.preventDefault()}
      onDrop={handleDrop}
      className="rounded-[1.4rem] border border-dashed border-white/20 bg-white/35 p-4 dark:bg-slate-950/30"
    >
      <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
        <GripVertical className="h-3.5 w-3.5" />
        {title}
      </div>
      <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">{subtitle}</div>
      <div className="mt-4 space-y-3">{children}</div>
    </div>
  );
}

export function ZonePill({
  label,
  onRemove,
}: {
  label: string;
  onRemove: () => void;
}) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-2xl border border-white/15 bg-white/55 px-3 py-2 text-sm text-slate-700 dark:bg-slate-950/35 dark:text-slate-200">
      <span className="truncate">{label}</span>
      <button
        type="button"
        onClick={onRemove}
        className="rounded-full border border-rose-300/30 bg-rose-500/10 p-1 text-rose-700 dark:text-rose-300"
      >
        <Trash2 className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
