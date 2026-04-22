"use client";

import { Clipboard, Mail, Phone, Type } from "lucide-react";

import { formatNumber } from "@/lib/utils/formatters";

import { formatPercent } from "../lib";
import type { PatternMetrics } from "../types";
import { Card, MetricCell } from "./primitives";

export function PatternCard({ patterns }: { patterns: PatternMetrics }) {
  const nonNullDenom = Math.max(patterns.nonNull, 1);
  return (
    <Card
      title="Pattern Analysis"
      icon={Type}
      subtitle="Regex-based structure detection executed in SQL."
    >
      <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-4">
        <MetricCell label="Email-like" value={formatNumber(patterns.emailCount)} />
        <MetricCell label="Phone-like" value={formatNumber(patterns.phoneCount)} />
        <MetricCell label="URL-like" value={formatNumber(patterns.urlCount)} />
        <MetricCell label="Blank Strings" value={formatNumber(patterns.blankCount)} />
      </div>
      <div className="mt-5 grid gap-4 lg:grid-cols-3">
        <div className="rounded-3xl border border-cyan-400/20 bg-cyan-500/10 p-4 text-sm text-cyan-700 dark:border-cyan-400/10 dark:text-cyan-200">
          <div className="flex items-center gap-2">
            <Mail className="h-4 w-4" />
            Email coverage
          </div>
          <p className="mt-2 text-lg font-semibold">
            {formatPercent((patterns.emailCount / nonNullDenom) * 100)}
          </p>
        </div>
        <div className="rounded-3xl border border-violet-400/20 bg-violet-500/10 p-4 text-sm text-violet-700 dark:border-violet-400/10 dark:text-violet-200">
          <div className="flex items-center gap-2">
            <Phone className="h-4 w-4" />
            Phone coverage
          </div>
          <p className="mt-2 text-lg font-semibold">
            {formatPercent((patterns.phoneCount / nonNullDenom) * 100)}
          </p>
        </div>
        <div className="rounded-3xl border border-emerald-400/20 bg-emerald-500/10 p-4 text-sm text-emerald-700 dark:border-emerald-400/10 dark:text-emerald-200">
          <div className="flex items-center gap-2">
            <Clipboard className="h-4 w-4" />
            Trimmed values
          </div>
          <p className="mt-2 text-lg font-semibold">
            {formatPercent((patterns.trimmedCount / nonNullDenom) * 100)}
          </p>
        </div>
      </div>
    </Card>
  );
}
