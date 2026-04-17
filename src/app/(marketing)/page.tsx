import type { Metadata } from "next";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { AUTH_TOKEN_COOKIE_NAME } from "@/lib/auth/constants";
import { isDemoMode } from "@/lib/auth/demo-mode";
import MarketingPageClient from "./marketing-page-client";

export const metadata: Metadata = {
  title: "DataLens — Analyze data at the speed of thought. Privately.",
  description:
    "Open-source AI data analytics that runs entirely in your browser with DuckDB-WASM and local LLMs. No cloud. No tracking.",
  openGraph: {
    title: "DataLens — Analyze data at the speed of thought. Privately.",
    description:
      "Privacy-first AI data analytics. DuckDB in the browser, local LLMs, no telemetry, and an MIT-licensed codebase.",
  },
  twitter: {
    card: "summary_large_image",
    title: "DataLens — Analyze data at the speed of thought. Privately.",
    description:
      "Open-source AI data analytics with browser-side SQL and local AI.",
  },
};

export default async function MarketingPage() {
  if (isDemoMode()) {
    redirect("/workspace");
  }

  const cookieStore = await cookies();

  if (cookieStore.get(AUTH_TOKEN_COOKIE_NAME)?.value) {
    redirect("/dashboard");
  }

  return <MarketingPageClient />;
}
