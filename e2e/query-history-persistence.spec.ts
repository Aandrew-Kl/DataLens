import { expect, test, type Route } from "@playwright/test";

import { openLandingPage, openWorkspaceTab, uploadInlineCsv } from "./support";

interface BackendHistoryRecord {
  id: number;
  user_id: string;
  dataset_id: string;
  question: string | null;
  sql_text: string;
  duration_ms: number;
  created_at: string;
}

test.use({ colorScheme: "light" });

test("persists query history across a page refresh", async ({ page }) => {
  test.slow();

  const historyEntries: BackendHistoryRecord[] = [];

  await page.addInitScript(() => {
    window.localStorage.setItem("datalens_token", "playwright-history-token");
  });

  await page.context().route("**/api/history", async (route: Route) => {
    const method = route.request().method();

    if (method === "GET") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(historyEntries),
      });
      return;
    }

    if (method === "POST") {
      const payload = route.request().postDataJSON() as {
        dataset_id: string;
        question?: string | null;
        sql_text: string;
        duration_ms?: number;
      };
      const entry: BackendHistoryRecord = {
        id: historyEntries.length + 1,
        user_id: "playwright-user",
        dataset_id: payload.dataset_id,
        question: payload.question ?? null,
        sql_text: payload.sql_text,
        duration_ms: payload.duration_ms ?? 0,
        created_at: new Date().toISOString(),
      };
      historyEntries.unshift(entry);
      await route.fulfill({
        status: 201,
        contentType: "application/json",
        body: JSON.stringify(entry),
      });
      return;
    }

    await route.continue();
  });

  await page.context().route(/.*\/api\/history\/\d+$/, async (route: Route) => {
    if (route.request().method() !== "DELETE") {
      await route.continue();
      return;
    }

    const id = Number.parseInt(route.request().url().split("/").pop() ?? "0", 10);
    const index = historyEntries.findIndex((entry) => entry.id === id);
    if (index >= 0) {
      historyEntries.splice(index, 1);
    }

    await route.fulfill({ status: 204, body: "" });
  });

  await openLandingPage(page);
  await uploadInlineCsv(page, { fileName: "sales_fixture.csv" });
  await openWorkspaceTab(page, "SQL Editor");

  const sql = 'SELECT region, amount FROM "sales_fixture" ORDER BY amount DESC LIMIT 2;';
  const editor = page.getByLabel(/SQL editor/i);

  await editor.fill(sql);
  await page.getByRole("button", { name: "Run" }).click();

  await expect(page.getByText(/2 rows?/i).first()).toBeVisible({ timeout: 60_000 });
  await expect(historyEntries).toHaveLength(1);

  await page.reload();
  await expect(
    page.getByRole("heading", { name: "SQL Editor" }),
  ).toBeVisible({ timeout: 60_000 });

  await expect(page.getByText("Manual SQL")).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText('SELECT region, amount FROM "sales_fixture"')).toBeVisible({
    timeout: 60_000,
  });
});
