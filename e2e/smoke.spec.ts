import { expect, test } from "@playwright/test";

test("landing page smoke test", async ({ page }) => {
  await page.goto("http://localhost:3000");

  await expect(page).toHaveTitle(/DataLens/);
  await expect(page.getByText("Drop your data here")).toBeVisible();

  const themeToggle = page.getByRole("button", {
    name: "Toggle dark mode",
  });
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
