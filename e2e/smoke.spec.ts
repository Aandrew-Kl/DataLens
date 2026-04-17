import { expect, test } from "@playwright/test";

test("landing page smoke test", async ({ page }) => {
  test.slow();

  await page.goto("/");

  await expect(page).toHaveTitle(/DataLens/, { timeout: 30_000 });

  // Marketing hero CTA is the canonical "above the fold" call-to-action on
  // the landing page — it's always rendered for unauthenticated visitors.
  await expect(
    page.getByRole("link", { name: /Try it free/i }).first()
  ).toBeVisible({ timeout: 30_000 });

  // Theme toggle on the marketing page swaps its aria-label based on the
  // current theme. Match either direction so the test is resilient to the
  // initial theme chosen by the system / prior visit.
  const themeToggle = page
    .getByRole("button", { name: /Switch to (dark|light) mode/ })
    .first();
  await expect(themeToggle).toBeVisible({ timeout: 30_000 });

  const html = page.locator("html");
  const initialDarkMode = await html.evaluate((element) =>
    element.classList.contains("dark")
  );

  await themeToggle.click();

  await expect
    .poll(async () =>
      html.evaluate((element) => element.classList.contains("dark"))
    )
    .toBe(!initialDarkMode);
});
