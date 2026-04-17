import { expect, test } from "@playwright/test";

import { openLandingPage, openWorkspaceTab, uploadInlineCsv } from "./support";

test.use({ colorScheme: "light" });

test("opens the SQL workspace, runs a SELECT query, and shows results", async ({
  page,
}) => {
  test.slow();

  await openLandingPage(page);
  await uploadInlineCsv(page, { fileName: "sales_fixture.csv" });
  await openWorkspaceTab(page, "SQL Editor");

  await expect(
    page.getByRole("heading", { name: "SQL Editor" }),
  ).toBeVisible({ timeout: 60_000 });

  const sql =
    'SELECT region, amount FROM "sales_fixture" ORDER BY amount DESC LIMIT 2;';
  const editor = page.getByPlaceholder("Write your SQL query here...");

  await editor.fill(sql);
  await page.getByRole("button", { name: "Run" }).click();

  await expect(page.getByRole("heading", { name: "Results" })).toBeVisible({
    timeout: 60_000,
  });

  const resultsTable = page.getByRole("table").first();
  await expect(resultsTable).toBeVisible({ timeout: 60_000 });
  await expect(resultsTable).toContainText("West");
  await expect(resultsTable).toContainText("East");
});
