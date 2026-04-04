import { test, expect } from "@playwright/test";

import {
  openLandingPage,
  openWorkspaceTab,
  uploadInlineCsv,
} from "./support";

test.use({ colorScheme: "light" });

test.describe("Data Upload Flow", () => {
  test("uploads inline CSV and shows column profiles", async ({ page }) => {
    test.slow();

    await openLandingPage(page);
    await uploadInlineCsv(page, { fileName: "sales_fixture.csv" });

    await expect(
      page.getByRole("heading", { name: "Column Profiles" }),
    ).toBeVisible({ timeout: 60_000 });

    for (const columnName of ["region", "category", "amount", "profit", "date"]) {
      await expect(page.getByText(columnName, { exact: true }).first()).toBeVisible({
        timeout: 60_000,
      });
    }

    await expect(page.getByText(/4 rows/i).first()).toBeVisible({
      timeout: 60_000,
    });
  });

  test("data table shows uploaded rows", async ({ page }) => {
    test.slow();

    await openLandingPage(page);
    await uploadInlineCsv(page, { fileName: "sales_fixture.csv" });

    await expect(page.getByRole("heading", { name: "Data Preview" })).toBeVisible({
      timeout: 60_000,
    });

    const previewTable = page.getByRole("table").first();
    await expect(previewTable).toBeVisible({ timeout: 60_000 });
    await expect(previewTable).toContainText("East");
    await expect(previewTable).toContainText("West");
    await expect(previewTable).toContainText("Hardware");
    await expect(previewTable).toContainText("Software");
  });

  test("workspace tabs are navigable after upload", async ({ page }) => {
    test.slow();

    await openLandingPage(page);
    await uploadInlineCsv(page, { fileName: "sales_fixture.csv" });

    await openWorkspaceTab(page, "SQL Editor");
    await expect(
      page.getByRole("heading", { name: "SQL Editor" }),
    ).toBeVisible({ timeout: 60_000 });

    await openWorkspaceTab(page, "Profile");
    await expect(
      page.getByRole("heading", { name: "Column Profiles" }),
    ).toBeVisible({ timeout: 60_000 });
  });
});
