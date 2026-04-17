import fs from "node:fs/promises";
import path from "node:path";

import { expect, type Page } from "@playwright/test";

export const AUTH_COOKIE = {
  name: "datalens-auth-token",
  value: "e2e-auth-token",
  url: "http://localhost:3000",
} as const;

const DUCKDB_DIST_DIR = path.join(
  process.cwd(),
  "node_modules",
  "@duckdb",
  "duckdb-wasm",
  "dist",
);

const LOCAL_DUCKDB_ASSETS = new Map<string, string>([
  ["duckdb-browser-mvp.worker.js", "application/javascript"],
  ["duckdb-browser-eh.worker.js", "application/javascript"],
  ["duckdb-mvp.wasm", "application/wasm"],
  ["duckdb-eh.wasm", "application/wasm"],
]);

export const INLINE_SALES_CSV = [
  "region,category,amount,profit,date",
  "East,Hardware,12,3,2025-01-01",
  "West,Software,18,6,2025-01-02",
  "East,Hardware,5,1,2025-01-03",
  "North,Services,9,2,2025-01-04",
].join("\n");

export async function installDuckDbAssetRoutes(page: Page) {
  await page.context().route(
    /https:\/\/cdn\.jsdelivr\.net\/npm\/@duckdb\/duckdb-wasm@[^/]+\/dist\/.+/,
    async (route) => {
      const fileName = new URL(route.request().url()).pathname.split("/").pop();

      if (!fileName || !LOCAL_DUCKDB_ASSETS.has(fileName)) {
        await route.continue();
        return;
      }

      const assetPath = path.join(DUCKDB_DIST_DIR, fileName);
      const body = await fs.readFile(assetPath);

      await route.fulfill({
        status: 200,
        contentType: LOCAL_DUCKDB_ASSETS.get(fileName),
        body,
      });
    },
  );
}

export async function openLandingPage(page: Page) {
  await installDuckDbAssetRoutes(page);
  await page.goto("/");
  await page.waitForLoadState("networkidle");
  await expect(page).toHaveTitle(/DataLens/i);
}

export async function loginAsTestUser(page: Page) {
  await page.context().addCookies([AUTH_COOKIE]);
}

export async function uploadInlineCsv(
  page: Page,
  {
    fileName = "sales_fixture.csv",
    csvContent = INLINE_SALES_CSV,
  }: {
    fileName?: string;
    csvContent?: string;
  } = {},
) {
  await page.locator('input[type="file"]').setInputFiles({
    name: fileName,
    mimeType: "text/csv",
    buffer: Buffer.from(csvContent, "utf8"),
  });

  await waitForDatasetWorkspace(page, fileName);
}

export async function waitForDatasetWorkspace(page: Page, fileName: string) {
  await expect(
    page.getByRole("heading", { name: "Column Profiles" }),
  ).toBeVisible({ timeout: 90_000 });
  await expect(page.getByText(fileName).first()).toBeVisible({ timeout: 90_000 });
  await expect(page.getByRole("button", { name: "Profile" })).toBeVisible({
    timeout: 90_000,
  });
  await expect(page.getByRole("button", { name: "SQL Editor" })).toBeVisible({
    timeout: 90_000,
  });
  await expect(page.getByRole("button", { name: "Charts" })).toBeVisible({
    timeout: 90_000,
  });
}

export async function openWorkspaceTab(page: Page, tabName: string) {
  await page.getByRole("button", { name: tabName }).click();
}

export async function openKeyboardShortcuts(page: Page) {
  const modifier = await page.evaluate(() =>
    /mac/i.test(navigator.platform) ? "Meta" : "Control",
  );

  await page.keyboard.down(modifier);
  await page.keyboard.press("/");
  await page.keyboard.up(modifier);
}
