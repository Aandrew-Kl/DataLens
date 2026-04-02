"use client";

/* ─── Shimmer base ─── */
const shimmerClass = `
  relative overflow-hidden
  bg-gray-200/70 dark:bg-gray-800/70
  rounded-lg
  before:absolute before:inset-0
  before:bg-gradient-to-r before:from-transparent before:via-white/40 dark:before:via-white/5 before:to-transparent
  before:animate-[shimmer_2s_ease-in-out_infinite]
  before:bg-[length:200%_100%]
`;

/* ─── SkeletonLine ─── */
interface SkeletonLineProps {
  width?: string;
  height?: string;
  className?: string;
}

export function SkeletonLine({
  width = "100%",
  height = "14px",
  className = "",
}: SkeletonLineProps) {
  return (
    <div
      className={`${shimmerClass} ${className}`}
      style={{ width, height }}
    />
  );
}

/* ─── SkeletonCard ─── */
interface SkeletonCardProps {
  className?: string;
}

export function SkeletonCard({ className = "" }: SkeletonCardProps) {
  return (
    <div
      className={`
        rounded-xl p-5
        bg-white/60 dark:bg-gray-900/60
        border border-gray-200/50 dark:border-gray-700/50
        space-y-3
        ${className}
      `}
    >
      <SkeletonLine width="40%" height="20px" />
      <SkeletonLine width="100%" />
      <SkeletonLine width="75%" />
      <SkeletonLine width="60%" />
    </div>
  );
}

/* ─── SkeletonTable ─── */
interface SkeletonTableProps {
  rows?: number;
  columns?: number;
  className?: string;
}

export function SkeletonTable({
  rows = 5,
  columns = 4,
  className = "",
}: SkeletonTableProps) {
  return (
    <div
      className={`
        rounded-xl overflow-hidden
        bg-white/60 dark:bg-gray-900/60
        border border-gray-200/50 dark:border-gray-700/50
        ${className}
      `}
    >
      {/* Header */}
      <div className="flex gap-4 px-4 py-3 border-b border-gray-200/50 dark:border-gray-700/50">
        {Array.from({ length: columns }).map((_, i) => (
          <SkeletonLine key={`h-${i}`} width={i === 0 ? "120px" : "80px"} height="12px" />
        ))}
      </div>

      {/* Rows */}
      {Array.from({ length: rows }).map((_, rowIdx) => (
        <div
          key={rowIdx}
          className="flex gap-4 px-4 py-3 border-b border-gray-100/50 dark:border-gray-800/30 last:border-b-0"
        >
          {Array.from({ length: columns }).map((_, colIdx) => (
            <SkeletonLine
              key={`r${rowIdx}-c${colIdx}`}
              width={colIdx === 0 ? "120px" : "80px"}
              height="12px"
            />
          ))}
        </div>
      ))}
    </div>
  );
}

/* ─── SkeletonChart ─── */
interface SkeletonChartProps {
  className?: string;
}

export function SkeletonChart({ className = "" }: SkeletonChartProps) {
  return (
    <div
      className={`
        rounded-xl p-5
        bg-white/60 dark:bg-gray-900/60
        border border-gray-200/50 dark:border-gray-700/50
        ${className}
      `}
    >
      {/* Title area */}
      <div className="flex items-center justify-between mb-4">
        <SkeletonLine width="140px" height="18px" />
        <SkeletonLine width="80px" height="14px" />
      </div>

      {/* Chart area with bars */}
      <div className="flex items-end gap-2 h-40">
        {[65, 40, 80, 55, 70, 35, 90, 50, 60, 75, 45, 85].map(
          (h, i) => (
            <div
              key={i}
              className={`flex-1 rounded-t-md ${shimmerClass}`}
              style={{ height: `${h}%` }}
            />
          ),
        )}
      </div>

      {/* X-axis labels */}
      <div className="flex gap-2 mt-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <SkeletonLine key={i} width="40px" height="10px" className="flex-1" />
        ))}
      </div>
    </div>
  );
}
