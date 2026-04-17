import { expect, test, type Page } from "@playwright/test";

import { openLandingPage, openWorkspaceTab, uploadInlineCsv } from "./support";

const PREVIEW_SELECTOR = ".echarts-for-react svg, .echarts-for-react canvas";

async function expectChartPreview(page: Page, title: string) {
  await expect(
    page.getByRole("heading", { level: 3, name: title }),
  ).toBeVisible({ timeout: 60_000 });
  await expect(page.locator(PREVIEW_SELECTOR).first()).toBeVisible({
    timeout: 60_000,
  });
}

test.use({ colorScheme: "light" });

test.beforeEach(async ({ page }) => {
  await openLandingPage(page);
  await uploadInlineCsv(page, { fileName: "sales_fixture.csv" });
  await openWorkspaceTab(page, "Charts");
  await expect(
    page.getByRole("heading", { name: "Chart Builder" }),
  ).toBeVisible({ timeout: 60_000 });
});

test("creates bar and line charts, updates the title, and renders a preview", async ({
  page,
}) => {
  test.slow();

  const generatedSql = page.locator("pre code").first();

  await page.getByRole("button", { name: /^bar\b/i }).click();
  await page.getByLabel("X-axis").selectOption("region");
  await page.getByLabel("Y-axis").selectOption("amount");
  await page.getByLabel("Aggregation").selectOption("sum");
  await page.getByLabel("Title").fill("Revenue by Region");

  await expect(generatedSql).toContainText('SELECT "region"', {
    timeout: 60_000,
  });
  await expect(generatedSql).toContainText(/sum\("amount"\)/i, {
    timeout: 60_000,
  });
  await expect(generatedSql).toContainText("ORDER BY 2 DESC", {
    timeout: 60_000,
  });
  await expectChartPreview(page, "Revenue by Region");

  await page.getByRole("button", { name: /^line\b/i }).click();
  await page.getByLabel("X-axis").selectOption("date");
  await page.getByLabel("Y-axis").selectOption("amount");
  await page.getByLabel("Aggregation").selectOption("avg");
  await page.getByLabel("Title").fill("Revenue Trend");

  await expect(generatedSql).toContainText('SELECT "date"', {
    timeout: 60_000,
  });
  await expect(generatedSql).toContainText(/avg\("amount"\)/i, {
    timeout: 60_000,
  });
  await expect(generatedSql).toContainText("ORDER BY 1 ASC", {
    timeout: 60_000,
  });
  await expectChartPreview(page, "Revenue Trend");
});
