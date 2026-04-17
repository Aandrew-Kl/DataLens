import { expect, test, type Page } from "@playwright/test";

import { openLandingPage, uploadInlineCsv } from "./support";

async function openExportWizard(page: Page) {
  await page.getByRole("button", { name: "Export" }).click();

  await expect(
    page.getByRole("dialog", { name: "Export Wizard" }),
  ).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText("Export Data")).toBeVisible({ timeout: 60_000 });
}

async function advanceToDownloadStep(page: Page) {
  await page.getByRole("button", { name: "Next" }).click();
  await page.getByRole("button", { name: "Next" }).click();
  await page.getByRole("button", { name: "Next" }).click();
  await expect(page.getByRole("table")).toBeVisible({ timeout: 60_000 });
}

test.use({ colorScheme: "light" });

test.beforeEach(async ({ page }) => {
  await openLandingPage(page);
  await uploadInlineCsv(page, { fileName: "sales_fixture.csv" });
});

test("downloads a CSV export from the export wizard", async ({ page }) => {
  test.slow();

  await openExportWizard(page);
  await advanceToDownloadStep(page);

  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download" }).click();
  const download = await downloadPromise;

  expect(download.suggestedFilename()).toBe("sales_fixture.csv");
});

test("downloads a JSON export from the export wizard", async ({ page }) => {
  test.slow();

  await openExportWizard(page);
  await page.getByRole("button", { name: /^json\b/i }).click();
  await advanceToDownloadStep(page);

  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download" }).click();
  const download = await downloadPromise;

  expect(download.suggestedFilename()).toBe("sales_fixture.json");
});
