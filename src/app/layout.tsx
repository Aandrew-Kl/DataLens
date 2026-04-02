import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  metadataBase: new URL("https://datalens.dev"),
  title: "DataLens — AI-Powered Data Explorer",
  description:
    "Drop a CSV, Excel, or JSON file and instantly explore your data with AI-powered profiling, auto-generated dashboards, and natural language queries. 100% local, open source, zero cost.",
  keywords: [
    "data explorer",
    "CSV viewer",
    "data profiling",
    "AI analytics",
    "DuckDB",
    "open source",
  ],
  openGraph: {
    title: "DataLens — AI-Powered Data Explorer",
    description:
      "Drop a file. Ask anything. See everything. Open source AI-powered data explorer that runs 100% locally.",
    siteName: "DataLens",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "DataLens — AI-Powered Data Explorer",
    description:
      "Drop a file. Ask anything. See everything. Open source AI-powered data explorer.",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f8fafc" },
    { media: "(prefers-color-scheme: dark)", color: "#0f172a" },
  ],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
