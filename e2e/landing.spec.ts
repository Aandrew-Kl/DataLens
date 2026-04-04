import { expect, test } from "@playwright/test";

import { openKeyboardShortcuts, openLandingPage } from "./support";

test.use({ colorScheme: "light" });

test.beforeEach(async ({ page }) => {
  await openLandingPage(page);
});

test("landing page loads with onboarding UI", async ({ page }) => {
  await expect(
    page.getByRole("heading", { level: 1, name: "DataLens" }),
  ).toBeVisible();
  await expect(
    page.getByText("Drop a file. Ask anything. See everything."),
  ).toBeVisible();
  await expect(page.getByText("Drop your data here")).toBeVisible();
  await expect(page.locator('input[type="file"]')).toHaveCount(1);
});

test("dark mode toggle switches between light and dark themes", async ({
  page,
}) => {
  test.slow();

  await page.waitForLoadState("networkidle");

  const html = page.locator("html");
  const toggle = page.getByRole("button", { name: "Toggle dark mode" });
  await expect(toggle).toBeVisible({ timeout: 30_000 });

  await expect
    .poll(() =>
      html.evaluate((element) => element.classList.contains("dark")),
    )
    .toBe(false);

  await toggle.click();

  await expect
    .poll(() =>
      html.evaluate((element) => element.classList.contains("dark")),
    )
    .toBe(true);

  await toggle.click();

  await expect
    .poll(() =>
      html.evaluate((element) => element.classList.contains("dark")),
    )
    .toBe(false);
});

test("feature showcase content is visible on the landing page", async ({
  page,
}) => {
  await expect(
    page.getByRole("heading", {
      level: 2,
      name: "Load a realistic dataset in one click",
    }),
  ).toBeVisible();

  for (const feature of [
    "Auto-Dashboards",
    "Natural Language Queries",
    "SQL Editor",
    "Data Profiling",
  ]) {
    await expect(page.getByText(feature, { exact: true })).toBeVisible();
  }
});

test("keyboard shortcuts dialog opens from the global shortcut", async ({
  page,
}) => {
  test.slow();

  await openKeyboardShortcuts(page);

  await expect(
    page.getByRole("dialog", { name: /work faster without leaving the keyboard/i }),
  ).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText("Keyboard shortcuts")).toBeVisible({
    timeout: 30_000,
  });
});
