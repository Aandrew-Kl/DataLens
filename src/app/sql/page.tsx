"use client";
import dynamic from "next/dynamic";

const DataLensApp = dynamic(() => import("@/components/layout/app-shell"), {
  ssr: false,
});

export default function SQLPage() {
  return <DataLensApp defaultTab="sql" />;
}
