import { test, expect } from "@playwright/test";

test.describe("Navigation", () => {
  test("can navigate to /explore", async ({ page }) => {
    await page.goto("/explore");
    await expect(page.locator("body")).toBeVisible();
  });

  test("can navigate to /charts", async ({ page }) => {
    await page.goto("/charts");
    await expect(page.locator("body")).toBeVisible();
  });

  test("can navigate to /sql", async ({ page }) => {
    await page.goto("/sql");
    await expect(page.locator("body")).toBeVisible();
  });

  test("can navigate to /settings", async ({ page }) => {
    await page.goto("/settings");
    await expect(page.locator("body")).toBeVisible();
  });
});
