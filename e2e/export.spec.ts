import { expect, test } from "@playwright/test";

import { openLandingPage, uploadInlineCsv } from "./support";

test.use({ colorScheme: "light" });

test("opens the export wizard and downloads a CSV export", async ({ page }) => {
  test.slow();

  await openLandingPage(page);
  await uploadInlineCsv(page, { fileName: "sales_fixture.csv" });

  await page.getByRole("button", { name: "Export" }).click();

  await expect(
    page.getByRole("dialog", { name: "Export Wizard" }),
  ).toBeVisible();
  await expect(page.getByText("Export Data")).toBeVisible();

  await page.getByRole("button", { name: "Next" }).click();
  await page.getByRole("button", { name: "Next" }).click();
  await page.getByRole("button", { name: "Next" }).click();

  await expect(page.getByRole("table")).toBeVisible({ timeout: 60_000 });

  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download" }).click();
  const download = await downloadPromise;

  expect(download.suggestedFilename()).toBe("sales_fixture.csv");
});
