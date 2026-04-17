import { expect, test, type Page } from "@playwright/test";

test.use({ colorScheme: "light" });

async function expectLoginForm(page: Page) {
  await expect(
    page.getByRole("heading", { level: 2, name: /^welcome back$/i }),
  ).toBeVisible({ timeout: 30_000 });
  await expect(page.getByLabel(/^email$/i)).toBeVisible({ timeout: 30_000 });
  await expect(page.getByLabel(/^password$/i)).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole("button", { name: /^sign in$/i })).toBeVisible({
    timeout: 30_000,
  });
}

async function expectRegisterForm(page: Page) {
  await expect(
    page.getByRole("heading", { level: 2, name: /^create your account$/i }),
  ).toBeVisible({ timeout: 30_000 });
  await expect(page.getByLabel(/^email$/i)).toBeVisible({ timeout: 30_000 });
  await expect(page.getByLabel(/^password$/i)).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.getByLabel(/^confirm password$/i)).toBeVisible({
    timeout: 30_000,
  });
  await expect(
    page.getByRole("button", { name: /^create account$/i }),
  ).toBeVisible({ timeout: 30_000 });
}

test.describe("Authentication", () => {
  test("redirects to /login when accessing workspace without auth", async ({
    page,
  }) => {
    await page.goto("/explore");

    await expectLoginForm(page);
    await expect(page).toHaveURL(/\/login\?redirect=%2Fexplore$/, {
      timeout: 30_000,
    });
  });

  test("login page renders form elements", async ({ page }) => {
    await page.goto("/login");

    await expectLoginForm(page);
    await expect(page.getByRole("link", { name: /^register$/i })).toBeVisible({
      timeout: 30_000,
    });
  });

  test("register page renders form elements", async ({ page }) => {
    await page.goto("/register");

    await expectRegisterForm(page);
    await expect(page.getByRole("link", { name: /^login$/i })).toBeVisible({
      timeout: 30_000,
    });
  });

  test("auth links preserve redirect targets", async ({ page }) => {
    await page.goto("/login?redirect=%2Freports");
    await expect(page.getByRole("link", { name: /^register$/i })).toHaveAttribute(
      "href",
      "/register?redirect=%2Freports",
    );

    await page.goto("/register?redirect=%2Fexplore");
    await expect(page.getByRole("link", { name: /^login$/i })).toHaveAttribute(
      "href",
      "/login?redirect=%2Fexplore",
    );
  });
});
