import type { MetadataRoute } from "next";

// Keep the robots surface aligned with public/robots.txt so agents using either
// source of truth land on the same allow-list. Crawlers see the marketing
// surface and the quality page; everything else is auth-gated.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: [
        "/api/",
        "/workspace/",
        "/dashboard",
        "/login",
        "/register",
        "/profile",
        "/settings",
      ],
    },
    sitemap: "https://datalens.dev/sitemap.xml",
    host: "https://datalens.dev",
  };
}
