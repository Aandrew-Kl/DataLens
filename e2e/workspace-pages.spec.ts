import { expect, test, type Locator, type Page } from "@playwright/test";

import { loginAsTestUser } from "./support";

type WorkspacePageRoute = {
  path: string;
  navLabel: string;
  rendered: (page: Page) => Locator;
};

const WORKSPACE_PAGE_ROUTES: WorkspacePageRoute[] = [
  {
    path: "/profile",
    navLabel: "Profile",
    rendered: (page) => page.getByRole("heading", { name: "Data Profile" }),
  },
  {
    path: "/dashboard",
    navLabel: "Dashboard",
    rendered: (page) => page.getByText("Workspace dashboard"),
  },
  {
    path: "/explore",
    navLabel: "Explore",
    rendered: (page) => page.getByRole("heading", { name: "Explore" }),
  },
  {
    path: "/query",
    navLabel: "Ask AI",
    rendered: (page) => page.getByRole("heading", { name: "Ask AI" }),
  },
  {
    path: "/sql",
    navLabel: "SQL",
    rendered: (page) => page.getByRole("heading", { name: "SQL Editor" }),
  },
  {
    path: "/charts",
    navLabel: "Charts",
    rendered: (page) => page.getByRole("heading", { name: "Charts" }),
  },
  {
    path: "/transforms",
    navLabel: "Transforms",
    rendered: (page) =>
      page.getByRole("heading", { name: "Transform Pipelines" }),
  },
  {
    path: "/ml",
    navLabel: "ML",
    rendered: (page) =>
      page.getByRole("heading", { name: "Machine Learning" }),
  },
  {
    path: "/analytics",
    navLabel: "Analytics",
    rendered: (page) => page.getByRole("heading", { name: "Analytics" }),
  },
  {
    path: "/data-ops",
    navLabel: "Data Ops",
    rendered: (page) =>
      page.getByRole("heading", { name: "Data Operations" }),
  },
  {
    path: "/pivot",
    navLabel: "Pivot",
    rendered: (page) =>
      page.getByRole("heading", { name: "Pivot Table Builder" }),
  },
  {
    path: "/reports",
    navLabel: "Reports",
    rendered: (page) => page.getByRole("heading", { name: "Reports" }),
  },
  {
    path: "/settings",
    navLabel: "Settings",
    rendered: (page) =>
      page.getByRole("heading", { name: "Workspace Settings" }),
  },
];

test.use({ colorScheme: "light" });

test.describe("Workspace pages", () => {
  test.beforeEach(async ({ page }) => {
    await loginAsTestUser(page);
  });

  test("redirects /workspace to /dashboard", async ({ page }) => {
    await page.goto("/workspace");

    await expect(page).toHaveURL(/\/dashboard$/, { timeout: 30_000 });
    await expect(page.getByRole("link", { name: "Dashboard" })).toHaveAttribute(
      "aria-current",
      "page",
      { timeout: 30_000 },
    );
    await expect(page.getByText("Workspace dashboard")).toBeVisible({
      timeout: 30_000,
    });
  });

  for (const route of WORKSPACE_PAGE_ROUTES) {
    test(`${route.path} renders its workspace page`, async ({ page }) => {
      await page.goto(route.path);

      await expect(page).toHaveURL(new RegExp(`${route.path}$`), {
        timeout: 30_000,
      });
      await expect(page.getByRole("main")).toBeVisible({ timeout: 30_000 });
      await expect(
        page.getByRole("link", { name: route.navLabel }),
      ).toHaveAttribute("aria-current", "page", { timeout: 30_000 });
      await expect(route.rendered(page)).toBeVisible({ timeout: 30_000 });
    });
  }
});
