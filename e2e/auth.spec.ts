import { test, expect } from "@playwright/test";

test.use({ colorScheme: "light" });

test.describe("Authentication", () => {
  test("redirects to /login when accessing workspace without auth", async ({
    page,
  }) => {
    await page.goto("/explore");

    await expect(page.getByLabel("Email")).toBeVisible();
    await expect(page.getByLabel("Password")).toBeVisible();
    await expect(page.getByRole("button", { name: /sign in/i })).toBeVisible();
    await expect.soft(page).toHaveURL(/\/login(?:\?|$)/);
  });

  test("login page renders form elements", async ({ page }) => {
    await page.goto("/login");

    await expect(page.getByLabel("Email")).toBeVisible();
    await expect(page.getByLabel("Password")).toBeVisible();
    await expect(page.getByRole("button", { name: /sign in/i })).toBeVisible();
  });

  test("register page renders form elements", async ({ page }) => {
    await page.goto("/register");

    await expect(page.getByLabel("Email")).toBeVisible();
    await expect(page.getByLabel("Password")).toBeVisible();
    await expect(
      page.getByRole("button", { name: /create account/i }),
    ).toBeVisible();
  });
});
