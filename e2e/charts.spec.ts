import { expect, test } from "@playwright/test";

import { openLandingPage, openWorkspaceTab, uploadInlineCsv } from "./support";

test.use({ colorScheme: "light" });

test.beforeEach(async ({ page }) => {
  await openLandingPage(page);
  await uploadInlineCsv(page, { fileName: "sales_fixture.csv" });
  await openWorkspaceTab(page, "Charts");
  await expect(
    page.getByRole("heading", { name: "Chart Builder" }),
  ).toBeVisible({ timeout: 60_000 });
});

test("opens the charts tab, configures a chart, and renders a preview", async ({
  page,
}) => {
  test.slow();

  await page.getByRole("button", { name: /^line\b/i }).click();
  await page.getByLabel("X-axis").selectOption("region");
  await page.getByLabel("Y-axis").selectOption("amount");
  await page.getByLabel("Aggregation").selectOption("sum");

  await expect(
    page.getByRole("heading", { level: 3, name: "Sum amount by region" }),
  ).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText(/SELECT "region", sum\("amount"\)/i)).toBeVisible({
    timeout: 60_000,
  });
  await expect(page.locator(".echarts-for-react svg")).toBeVisible({
    timeout: 60_000,
  });
  await expect(page.getByText(/preview rows/i)).toBeVisible();
});
