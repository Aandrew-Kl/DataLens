import { expect, test } from "@playwright/test";

import {
  INLINE_SALES_CSV,
  openLandingPage,
  openWorkspaceTab,
  uploadInlineCsv,
} from "./support";

test.use({ colorScheme: "light" });

test("uploads a CSV, renders the workspace, and supports tab navigation", async ({
  page,
}) => {
  test.slow();

  await openLandingPage(page);
  await uploadInlineCsv(page, {
    fileName: "sales_fixture.csv",
    csvContent: INLINE_SALES_CSV,
  });

  await expect(page.getByText("sales_fixture.csv").first()).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Column Profiles" }),
  ).toBeVisible({ timeout: 60_000 });
  await expect(page.getByRole("heading", { name: "Data Preview" })).toBeVisible({
    timeout: 60_000,
  });
  await expect(page.getByRole("table").first()).toBeVisible({ timeout: 60_000 });
  await expect(page.getByRole("table").first()).toContainText("East");
  await expect(page.getByText("region", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("amount", { exact: true }).first()).toBeVisible();

  for (const tab of ["Profile", "SQL Editor", "Charts", "Ask AI"]) {
    await expect(page.getByRole("button", { name: tab })).toBeVisible();
  }

  await openWorkspaceTab(page, "SQL Editor");
  await expect(
    page.getByRole("heading", { name: "SQL Editor" }),
  ).toBeVisible();

  await openWorkspaceTab(page, "Charts");
  await expect(
    page.getByRole("heading", { name: "Chart Builder" }),
  ).toBeVisible();

  await openWorkspaceTab(page, "Profile");
  await expect(
    page.getByRole("heading", { name: "Column Profiles" }),
  ).toBeVisible();
});
