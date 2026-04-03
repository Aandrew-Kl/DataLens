interface LoadingSkeletonProps {
  lines?: number;
  className?: string;
}

export default function LoadingSkeleton({
  lines = 3,
  className = "",
}: LoadingSkeletonProps) {
  const safeLines = Math.max(1, Math.floor(lines));

  return (
    <div
      className={`bg-white/75 backdrop-blur-2xl dark:bg-slate-950/45 border border-white/20 rounded-3xl p-6 space-y-3 ${className}`}
    >
      {Array.from({ length: safeLines }).map((_, index) => (
        <div
          key={index}
          className={`h-4 rounded-lg bg-slate-200/60 dark:bg-slate-700/40 animate-pulse ${
            index === safeLines - 1 ? "w-2/3" : "w-full"
          }`}
        />
      ))}
    </div>
  );
}
