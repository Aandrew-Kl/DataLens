import { Head } from "nextra/components";
import { getPageMap } from "nextra/page-map";
import { Layout } from "nextra-theme-docs";
import "nextra-theme-docs/style.css";
import type { ReactNode } from "react";
import themeConfig from "../theme.config";

export const metadata = themeConfig.metadata;

export default async function RootLayout({
  children,
}: {
  children: ReactNode;
}) {
  return (
    <html lang="en" dir="ltr" suppressHydrationWarning>
      <Head faviconGlyph="D" />
      <body>
        <Layout
          banner={themeConfig.banner}
          footer={themeConfig.footer}
          navbar={themeConfig.navbar}
          pageMap={await getPageMap()}
          {...themeConfig.layout}
        >
          {children}
        </Layout>
      </body>
    </html>
  );
}
