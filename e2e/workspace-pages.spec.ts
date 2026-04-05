import { test, expect } from "@playwright/test";
import { openLandingPage, uploadInlineCsv, openWorkspaceTab } from "./support";

test.use({ colorScheme: "light" });

test.describe("Workspace Pages", () => {
  test.beforeEach(async ({ page }) => {
    test.slow();
    await openLandingPage(page);
    await uploadInlineCsv(page, { fileName: "workspace_test.csv" });
  });

  test("profile tab shows column statistics", async ({ page }) => {
    await openWorkspaceTab(page, "Profile");
    await expect(page.getByText("Column Profiles")).toBeVisible({ timeout: 60_000 });
    await expect(page.getByText("region")).toBeVisible({ timeout: 60_000 });
  });

  test("dashboard tab loads", async ({ page }) => {
    await openWorkspaceTab(page, "Dashboard");
    await expect(page.getByText(/dashboard/i).first()).toBeVisible({ timeout: 60_000 });
  });

  test("charts tab shows chart builder", async ({ page }) => {
    await openWorkspaceTab(page, "Charts");
    await expect(page.getByText(/chart/i).first()).toBeVisible({ timeout: 60_000 });
  });

  test("ML tab loads machine learning tools", async ({ page }) => {
    await openWorkspaceTab(page, "ML");
    await expect(page.getByText(/machine learning|regression|cluster/i).first()).toBeVisible({ timeout: 60_000 });
  });

  test("analytics tab loads analytics tools", async ({ page }) => {
    await openWorkspaceTab(page, "Analytics");
    await expect(page.getByText(/analytics|churn|forecast/i).first()).toBeVisible({ timeout: 60_000 });
  });

  test("transforms tab loads pipeline builder", async ({ page }) => {
    await openWorkspaceTab(page, "Transforms");
    await expect(page.getByText(/transform|pipeline/i).first()).toBeVisible({ timeout: 60_000 });
  });

  test("reports tab loads", async ({ page }) => {
    await openWorkspaceTab(page, "Reports");
    await expect(page.getByText(/report/i).first()).toBeVisible({ timeout: 60_000 });
  });

  test("data-ops tab loads pipeline tools", async ({ page }) => {
    await openWorkspaceTab(page, "Data Ops");
    await expect(page.getByText(/data ops|pipeline|operation/i).first()).toBeVisible({ timeout: 60_000 });
  });

  test("query tab shows query interface", async ({ page }) => {
    await openWorkspaceTab(page, "Query");
    await expect(page.getByText(/query|sql|search/i).first()).toBeVisible({ timeout: 60_000 });
  });

  test("pivot tab loads pivot builder", async ({ page }) => {
    await openWorkspaceTab(page, "Pivot");
    await expect(page.getByText(/pivot|table|row|column/i).first()).toBeVisible({ timeout: 60_000 });
  });
});
