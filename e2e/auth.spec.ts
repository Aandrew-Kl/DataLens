import { test, expect } from "@playwright/test";

test.use({ colorScheme: "light" });

test.describe("Authentication", () => {
  test("redirects to /login when accessing workspace without auth", async ({
    page,
  }) => {
    await page.goto("/explore");

    await expect(page.getByLabel("Email")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByLabel("Password")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole("button", { name: /sign in/i })).toBeVisible({
      timeout: 30_000,
    });
    await expect.soft(page).toHaveURL(/\/login(?:\?|$)/, { timeout: 30_000 });
  });

  test("login page renders form elements", async ({ page }) => {
    await page.goto("/login");

    await expect(page.getByLabel("Email")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByLabel("Password")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole("button", { name: /sign in/i })).toBeVisible({
      timeout: 30_000,
    });
  });

  test("register page renders form elements", async ({ page }) => {
    await page.goto("/register");

    await expect(page.getByLabel("Email")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByLabel("Password")).toBeVisible({ timeout: 30_000 });
    await expect(
      page.getByRole("button", { name: /create account/i }),
    ).toBeVisible({ timeout: 30_000 });
  });
});
