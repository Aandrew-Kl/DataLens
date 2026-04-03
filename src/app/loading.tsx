import type { ReactNode } from "react";

export default function Loading(): ReactNode {
  return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="animate-pulse flex flex-col items-center">
        <div className="h-12 w-12 rounded-full bg-cyan-500/30" />
        <p className="mt-4 text-sm text-slate-500">Loading DataLens...</p>
      </div>
    </div>
  );
}
