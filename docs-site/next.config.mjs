import nextra from "nextra";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const withNextra = nextra({});

// Static export for GitHub Pages deployment.
// Served at https://aandrew-kl.github.io/DataLens/docs — basePath must match.
// Override at build time (e.g. for previews or forks) via DOCS_BASE_PATH.
const basePath = process.env.DOCS_BASE_PATH ?? "/DataLens/docs";

export default withNextra({
  reactStrictMode: true,
  output: "export",
  basePath,
  trailingSlash: true,
  images: {
    unoptimized: true,
  },
  turbopack: {
    // Pin workspace root to this app — the parent DataLens repo also has a
    // package-lock.json, which otherwise gets auto-detected as the root and
    // pulls src/proxy.ts into the docs build.
    root: __dirname,
    resolveAlias: {
      "next-mdx-import-source-file": "./mdx-components.tsx",
    },
  },
});
