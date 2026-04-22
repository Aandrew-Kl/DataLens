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

// TODO: update `metadataBase` once the deploy agent provisions the public URL.
export const metadata: Metadata = {
  metadataBase: new URL("https://datalens.dev"),
  title: {
    default: "DataLens — Privacy-first AI data analytics",
    template: "%s · DataLens",
  },
  description:
    "Drop a CSV, Excel, or JSON file and explore with AI-powered profiling, auto-generated dashboards, and natural-language queries. 100% local, open source, zero cost. Data never leaves your browser.",
  applicationName: "DataLens",
  authors: [{ name: "Andreas Klementidis", url: "https://github.com/Aandrew-Kl" }],
  creator: "Andreas Klementidis",
  publisher: "DataLens",
  generator: "Next.js",
  category: "technology",
  keywords: [
    "data explorer",
    "CSV viewer",
    "data profiling",
    "AI analytics",
    "DuckDB",
    "DuckDB-WASM",
    "Ollama",
    "self-hosted BI",
    "privacy-first analytics",
    "local-first",
    "open source",
  ],
  alternates: {
    canonical: "/",
  },
  openGraph: {
    type: "website",
    siteName: "DataLens",
    title: "DataLens — Privacy-first AI data analytics",
    description:
      "Drop a file. Ask anything. See everything. Open source AI-powered data explorer that runs 100% locally.",
    url: "/",
    locale: "en_US",
  },
  twitter: {
    card: "summary_large_image",
    title: "DataLens — Privacy-first AI data analytics",
    description:
      "Drop a file. Ask anything. See everything. Open source AI-powered data explorer that runs 100% locally.",
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-image-preview": "large",
      "max-snippet": -1,
      "max-video-preview": -1,
    },
  },
  formatDetection: {
    email: false,
    address: false,
    telephone: false,
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
