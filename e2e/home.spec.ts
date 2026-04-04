import { test, expect } from "@playwright/test";

test.describe("DataLens Home", () => {
  test("loads the main page", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveTitle(/DataLens/i, { timeout: 30_000 });
  });

  test("shows file upload area", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByText(/drag.*drop|upload|choose.*file/i).first()).toBeVisible({
      timeout: 30_000,
    });
  });

  test("shows tab navigation", async ({ page }) => {
    await page.goto("/");
    await expect(
      page
        .getByRole("tab")
        .or(page.getByRole("button"))
        .filter({ hasText: /profile|dashboard|charts|query/i })
        .first(),
    ).toBeVisible({ timeout: 30_000 });
  });
});
