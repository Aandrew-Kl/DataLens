import { expect, test } from "@playwright/test";

import { openLandingPage, openWorkspaceTab, uploadInlineCsv } from "./support";

test.use({ colorScheme: "light" });

test.beforeEach(async ({ page }) => {
  await openLandingPage(page);
  await uploadInlineCsv(page, { fileName: "sales_fixture.csv" });
  await openWorkspaceTab(page, "SQL Editor");
  await expect(
    page.getByRole("heading", { name: "SQL Editor" }),
  ).toBeVisible({ timeout: 60_000 });
});

test("opens the SQL editor, runs a query, and records it in history", async ({
  page,
}) => {
  test.slow();

  const sql = 'SELECT region, amount FROM "sales_fixture" ORDER BY amount DESC LIMIT 2;';
  const editor = page.getByPlaceholder("Write your SQL query here...");

  await editor.fill(sql);
  await expect(editor).toHaveValue(sql);

  await page.getByRole("button", { name: "Run" }).click();

  await expect(page.getByRole("heading", { name: "Results" })).toBeVisible({
    timeout: 60_000,
  });
  await expect(page.getByRole("table").first()).toBeVisible({ timeout: 60_000 });
  await expect(page.getByRole("table").first()).toContainText("West");
  await expect(page.getByText(/2 rows?/i).first()).toBeVisible();

  await page.getByRole("button", { name: "History" }).click();
  await expect(page.getByText(sql, { exact: true })).toBeVisible();
});
