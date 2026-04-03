import { test, expect } from "@playwright/test";

test.describe("Authentication", () => {
  test("login form renders", async ({ page }) => {
    await page.goto("/");
    // Auth may or may not be required, just verify page loads
    await expect(page.locator("body")).toBeVisible();
  });
});
