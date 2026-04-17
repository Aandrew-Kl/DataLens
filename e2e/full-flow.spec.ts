import fs from "node:fs/promises";
import path from "node:path";

import { expect, test, type Page } from "@playwright/test";

// TODO(quality-to-11/task2): Re-run these three tests in a normal dev shell.
// This Codex sandbox cannot boot the app locally (`listen EPERM`), and
// `next build` also fails offline because the app fetches Google Fonts. The
// selector refresh below is source-derived and unverified end-to-end here.

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

const AUTH_COOKIE_NAME = "datalens-auth-token";
const SAMPLE_DATASET_TITLE = "Ecommerce Orders";
const SAMPLE_DATASET_FILE_NAME = "ecommerce-orders.csv";

const WORKSPACE_TABS = [
  { href: "/profile", label: "Profile" },
  { href: "/dashboard", label: "Dashboard" },
  { href: "/query", label: "Ask AI" },
  { href: "/sql", label: "SQL" },
  { href: "/charts", label: "Charts" },
  { href: "/explore", label: "Explore" },
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

function workspaceTab(page: Page, href: string) {
  return page.locator(`nav a[href="${href}"]`);
}

async function authenticateForWorkspace(page: Page) {
  await page.evaluate(() => {
    window.localStorage.removeItem("datalens.onboarding.completed");
  });

  await page.context().addCookies([
    {
      name: AUTH_COOKIE_NAME,
      value: "playwright-test-token",
      url: "http://localhost:3000/",
    },
  ]);
}

async function loadSampleDataset(page: Page) {
  await authenticateForWorkspace(page);
  await page.goto("/profile");

  const wizard = page.getByRole("dialog");
  await expect(wizard).toBeVisible({ timeout: 45_000 });
  await expect(
    wizard.getByRole("heading", { name: "Welcome to DataLens" })
  ).toBeVisible();

  await wizard.getByRole("button", { name: /^Next/ }).click();

  await expect(
    wizard.getByRole("heading", { name: "Load your first dataset" })
  ).toBeVisible();

  const datasetCard = wizard.locator("article", {
    has: wizard.getByRole("heading", { name: SAMPLE_DATASET_TITLE }),
  });

  await datasetCard.getByRole("button", { name: /Load dataset/i }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0, { timeout: 45_000 });
  await expect(
    page.getByRole("heading", { name: "Data Profile" })
  ).toBeVisible({ timeout: 45_000 });
  await expect(page.getByText(SAMPLE_DATASET_FILE_NAME)).toBeVisible();
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
    page.getByRole("heading", {
      level: 1,
      name: /Analyze data at the speed of thought\. Privately\./i,
    })
  ).toBeVisible();

  for (const badge of [
    "DuckDB-WASM on-device",
    "Local Ollama workflows",
    "MIT licensed",
  ]) {
    await expect(page.getByText(badge, { exact: true })).toBeVisible();
  }

  await expect(
    page.getByText(
      "Privacy-first AI data analytics. Your data never leaves your browser."
    )
  ).toBeVisible();

  await expect(
    page.getByRole("heading", {
      level: 2,
      name: /A local-first workflow that stays fast from first upload to final export/i,
    })
  ).toBeVisible();
  await expect(
    page.getByRole("heading", {
      level: 3,
      name: "Upload CSV, JSON, or Excel",
    })
  ).toBeVisible();
  await expect(
    page.getByRole("heading", {
      level: 3,
      name: "Visualize, transform, and export",
    })
  ).toBeVisible();
});

test("toggles dark mode on the landing page", async ({ page }) => {
  const toggle = page
    .getByRole("button", { name: /Switch to (dark|light) mode/i })
    .first();
  const initialLabel = await toggle.getAttribute("aria-label");

  await toggle.click();

  await expect
    .poll(async () => toggle.getAttribute("aria-label"))
    .not.toBe(initialLabel);

  const toggledLabel = await toggle.getAttribute("aria-label");

  await toggle.click();

  await expect
    .poll(async () => toggle.getAttribute("aria-label"))
    .toBe(initialLabel);
  expect(toggledLabel).not.toBe(initialLabel);
});

test("loads a sample dataset and supports workspace tab navigation", async ({
  page,
}) => {
  test.slow();

  await loadSampleDataset(page);

  for (const tab of WORKSPACE_TABS) {
    await expect(workspaceTab(page, tab.href)).toBeVisible();
    await expect(workspaceTab(page, tab.href)).toContainText(tab.label);
  }

  await workspaceTab(page, "/dashboard").click();
  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(page.getByText("Workspace dashboard")).toBeVisible();
  await expect(
    page.getByRole("button", { name: /Export sample/i })
  ).toBeVisible();

  await workspaceTab(page, "/query").click();
  await expect(page).toHaveURL(/\/query$/);
  await expect(
    page.getByRole("heading", { name: "Ask AI" })
  ).toBeVisible();
  await expect(page.getByText("Natural language query")).toBeVisible();

  await workspaceTab(page, "/sql").click();
  await expect(page).toHaveURL(/\/sql$/);
  await expect(
    page.getByRole("heading", { name: "SQL Editor" })
  ).toBeVisible();
  await expect(page.getByLabel(/SQL editor/i)).toBeVisible();

  await workspaceTab(page, "/charts").click();
  await expect(page).toHaveURL(/\/charts$/);
  await expect(
    page.getByRole("heading", { name: "Charts" })
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: /New chart/i })
  ).toBeVisible();

  await workspaceTab(page, "/explore").click();
  await expect(page).toHaveURL(/\/explore$/);
  await expect(
    page.getByRole("heading", { name: "Explore" })
  ).toBeVisible();
  await expect(page.getByText(SAMPLE_DATASET_FILE_NAME)).toBeVisible();

  await workspaceTab(page, "/profile").click();
  await expect(page).toHaveURL(/\/profile$/);
  await expect(
    page.getByRole("heading", { name: "Data Profile" })
  ).toBeVisible();
});
