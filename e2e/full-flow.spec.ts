import fs from "node:fs/promises";
import path from "node:path";

import {
  expect,
  test,
  type Locator,
  type Page,
} from "@playwright/test";

const DUCKDB_DIST_DIR = path.join(
  process.cwd(),
  "node_modules",
  "@duckdb",
  "duckdb-wasm",
  "dist"
);

const LOCAL_DUCKDB_ASSETS = new Map<string, string>([
  ["duckdb-browser-mvp.worker.js", "application/javascript"],
  ["duckdb-browser-eh.worker.js", "application/javascript"],
  ["duckdb-mvp.wasm", "application/wasm"],
  ["duckdb-eh.wasm", "application/wasm"],
]);

const WORKSPACE_TABS = [
  "Profile",
  "Dashboard",
  "Ask AI",
  "SQL Editor",
  "Charts",
  "Transforms",
  "Analytics",
  "Pivot",
  "Reports",
] as const;

async function installDuckDbAssetRoutes(page: Page) {
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
    }
  );
}

async function installAiSuggestRoute(page: Page) {
  await page.context().route("**/api/ai/suggest", async (route) => {
    let body: { type?: string } = {};

    try {
      body = route.request().postDataJSON() as { type?: string };
    } catch {
      body = {};
    }

    if (body.type === "dashboard") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          mode: "test",
          metrics: [],
          charts: [],
        }),
      });
      return;
    }

    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        mode: "test",
        questions: [
          "What are total sales by region?",
          "Which product category performs best?",
        ],
      }),
    });
  });
}

async function expectAnyVisible(locators: Locator[]) {
  await Promise.any(
    locators.map((locator) => expect(locator).toBeVisible({ timeout: 15_000 }))
  );
}

async function loadSampleDataset(page: Page) {
  await page.getByRole("button", { name: /Revenue performance/i }).click();

  await expect(
    page.getByRole("heading", { name: "Column Profiles" })
  ).toBeVisible({ timeout: 45_000 });
  await expect(page.getByText("sales_data.csv")).toBeVisible();
}

test.use({ colorScheme: "light" });

test.beforeEach(async ({ page }) => {
  await installDuckDbAssetRoutes(page);
  await installAiSuggestRoute(page);
  await page.goto("/");
});

test("renders the landing page with core onboarding elements", async ({
  page,
}) => {
  await expect(page).toHaveTitle(/DataLens/i);
  await expect(
    page.getByRole("heading", { level: 1, name: "DataLens" })
  ).toBeVisible();

  for (const feature of [
    "DuckDB-WASM",
    "AI-Powered",
    "100% Private",
    "Zero Cost",
  ]) {
    await expect(page.getByText(feature, { exact: true })).toBeVisible();
  }

  await expect(page.getByText("Drop your data here")).toBeVisible();
  await expect(page.getByText(/or click to browse/i)).toBeVisible();

  await expect(
    page.getByRole("heading", {
      level: 2,
      name: "Load a realistic dataset in one click",
    })
  ).toBeVisible();
  await expect(page.getByText("Built-in CSV examples")).toBeVisible();
});

test("toggles dark mode on the landing page", async ({ page }) => {
  const html = page.locator("html");
  const toggle = page.getByRole("button", { name: "Toggle dark mode" });

  await expect
    .poll(async () =>
      html.evaluate((element) => element.classList.contains("dark"))
    )
    .toBe(false);

  await toggle.click();

  await expect
    .poll(async () =>
      html.evaluate((element) => element.classList.contains("dark"))
    )
    .toBe(true);

  await toggle.click();

  await expect
    .poll(async () =>
      html.evaluate((element) => element.classList.contains("dark"))
    )
    .toBe(false);
});

test("loads a sample dataset and supports workspace tab navigation", async ({
  page,
}) => {
  test.slow();

  await loadSampleDataset(page);

  for (const tab of WORKSPACE_TABS) {
    await expect(page.getByRole("button", { name: tab })).toBeVisible();
  }

  await page.getByRole("button", { name: "Dashboard" }).click();
  await expectAnyVisible([
    page.getByRole("heading", { name: "Dashboard" }),
    page.getByText("Generating dashboard..."),
    page.getByText("Could not generate dashboard"),
  ]);

  await page.getByRole("button", { name: "Ask AI" }).click();
  await expect(
    page.getByRole("heading", { name: "Ask Your Data" })
  ).toBeVisible();

  await page.getByRole("button", { name: "SQL Editor" }).click();
  await expect(
    page.getByRole("heading", { name: "SQL Editor" })
  ).toBeVisible();

  await page.getByRole("button", { name: "Profile" }).click();
  await expect(
    page.getByRole("heading", { name: "Column Profiles" })
  ).toBeVisible();
});
