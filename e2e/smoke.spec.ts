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

  // The toggle's aria-label reflects the action it will perform on the
  // NEXT click, so it flips as soon as the theme state updates. This is a
  // more reliable signal than reading a scoped .dark class (the marketing
  // page applies it to a wrapper div, not <html>).
  const initialLabel = await themeToggle.getAttribute("aria-label");

  await themeToggle.click();

  await expect
    .poll(
      async () => themeToggle.getAttribute("aria-label"),
      { timeout: 15_000 }
    )
    .not.toBe(initialLabel);
});
