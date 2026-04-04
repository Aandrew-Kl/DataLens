import { expect, test } from "@playwright/test";

test("landing page smoke test", async ({ page }) => {
  test.slow();

  await page.goto("/");

  await expect(page).toHaveTitle(/DataLens/, { timeout: 30_000 });
  await expect(page.getByText("Drop your data here")).toBeVisible({
    timeout: 30_000,
  });

  const themeToggle = page.getByRole("button", {
    name: "Toggle dark mode",
  });
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
