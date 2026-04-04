import { test, expect } from "@playwright/test";

import {
  openLandingPage,
  uploadInlineCsv,
} from "./support";

const AUTH_COOKIE = {
  name: "datalens-auth-token",
  value: "e2e-auth-token",
  url: "http://localhost:3000",
};

test.use({ colorScheme: "light" });

test.describe("Navigation", () => {
  test.beforeEach(async ({ page }) => {
    await page.context().addCookies([AUTH_COOKIE]);
  });

  test("explore page shows upload area", async ({ page }) => {
    await page.goto("/explore");

    await expect(
      page.getByRole("heading", { level: 1, name: "Explore" }),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "New Dataset" })).toBeVisible();

    await page.getByRole("button", { name: "New Dataset" }).click();
    await expect(page.getByText("Uploader")).toBeVisible();
    await expect(page.getByText("Dataset uploader will be wired here.")).toBeVisible();
  });

  test("charts page loads", async ({ page }) => {
    await page.goto("/charts");

    await expect(page.getByRole("heading", { level: 1, name: "Charts" })).toBeVisible();
    await expect(page.getByText("Saved charts")).toBeVisible();
  });

  test("sql page loads", async ({ page }) => {
    await page.goto("/sql");

    await expect(
      page.getByRole("heading", { level: 1, name: "SQL Editor" }),
    ).toBeVisible();
    await expect(
      page.getByText("Open a dataset in the workspace to start writing and running SQL."),
    ).toBeVisible();
  });

  test("settings page loads", async ({ page }) => {
    await page.goto("/settings");

    await expect(
      page.getByRole("heading", { level: 1, name: "Workspace Settings" }),
    ).toBeVisible();
    await expect(page.getByRole("heading", { level: 2, name: "Theme" })).toBeVisible();
  });

  test("workspace tabs appear after data upload", async ({ page }) => {
    test.slow();

    await openLandingPage(page);
    await uploadInlineCsv(page, { fileName: "sales_fixture.csv" });

    for (const tab of ["Profile", "SQL Editor", "Charts", "Dashboard", "Analytics"]) {
      await expect(page.getByRole("button", { name: tab })).toBeVisible({
        timeout: 60_000,
      });
    }
  });
});
