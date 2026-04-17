import { expect, test } from "@playwright/test";

import { INLINE_SALES_CSV, openLandingPage, waitForDatasetWorkspace } from "./support";

test.use({ colorScheme: "light" });

test("uploads a CSV with setInputFiles and shows the data preview", async ({
  page,
}) => {
  test.slow();

  await openLandingPage(page);

  await page.locator('input[type="file"]').setInputFiles({
    name: "upload_fixture.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(INLINE_SALES_CSV, "utf8"),
  });

  await waitForDatasetWorkspace(page, "upload_fixture.csv");

  await expect(
    page.getByRole("heading", { name: "Data Preview" }),
  ).toBeVisible({ timeout: 60_000 });

  const previewTable = page.getByRole("table").first();
  await expect(previewTable).toBeVisible({ timeout: 60_000 });
  await expect(previewTable).toContainText("East");
  await expect(previewTable).toContainText("West");
  await expect(page.getByText("region", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("amount", { exact: true }).first()).toBeVisible();
});
