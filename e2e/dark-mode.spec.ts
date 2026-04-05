import { test, expect } from "@playwright/test";

test.use({ colorScheme: "light" });

test.describe("Dark Mode", () => {
  test("landing page toggles dark mode", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    const toggleButton = page.getByRole("button", { name: /toggle dark mode/i });
    await expect(toggleButton).toBeVisible({ timeout: 30_000 });

    await toggleButton.click();

    await expect(page.locator("html")).toHaveClass(/dark/, { timeout: 10_000 });

    await toggleButton.click();

    await expect(page.locator("html")).not.toHaveClass(/dark/, { timeout: 10_000 });
  });
});
