import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Banner } from "nextra/components";
import { Footer, Navbar } from "nextra-theme-docs";

const metadata: Metadata = {
  title: {
    default: "DataLens Docs",
    template: "%s | DataLens Docs",
  },
  description: "Documentation for DataLens, the privacy-first AI data analytics platform.",
};

const banner = (
  <Banner storageKey="datalens-docs-privacy-banner">
    DataLens keeps the analytics loop local-first with DuckDB in the browser and Ollama for optional AI.
  </Banner>
);

const navbar = (
  <Navbar
    logo={
      <span style={{ fontSize: "1rem", fontWeight: 800, letterSpacing: "-0.02em" }}>
        DataLens
      </span>
    }
    projectLink="https://github.com/Aandrew-Kl/DataLens"
  />
);

const footer = (
  <Footer>
    <span>MIT License</span>
  </Footer>
);

const layout = {
  darkMode: true,
  docsRepositoryBase: "https://github.com/Aandrew-Kl/DataLens/tree/main/docs-site/content",
  editLink: "Edit this page on GitHub",
  feedback: {
    content: null,
  },
  navigation: true,
  search: null,
  sidebar: {
    autoCollapse: true,
    defaultMenuCollapseLevel: 1,
    defaultOpen: true,
    toggleButton: true,
  },
  themeSwitch: {
    dark: "Dark",
    light: "Light",
    system: "System",
  },
  toc: {
    backToTop: "Back to top",
    float: true,
    title: "On this page",
  },
} as const;

const themeConfig: {
  metadata: Metadata;
  banner: ReactNode;
  navbar: ReactNode;
  footer: ReactNode;
  layout: typeof layout;
} = {
  metadata,
  banner,
  navbar,
  footer,
  layout,
};

export default themeConfig;
