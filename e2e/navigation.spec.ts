import { expect, test } from "@playwright/test";

import { loginAsTestUser } from "./support";

type TopLevelNavRoute = {
  label: string;
  navLabel: string;
  path: string;
  heading: string;
  primaryCtaRole: "button" | "link";
  primaryCtaName: RegExp;
};

const TOP_LEVEL_NAV_ROUTES: TopLevelNavRoute[] = [
  {
    label: "dashboard",
    navLabel: "Dashboard",
    path: "/dashboard",
    heading: "No active dataset",
    primaryCtaRole: "link",
    primaryCtaName: /new chart/i,
  },
  {
    label: "data",
    navLabel: "Explore",
    path: "/explore",
    heading: "Explore",
    primaryCtaRole: "button",
    primaryCtaName: /new dataset/i,
  },
  {
    label: "charts",
    navLabel: "Charts",
    path: "/charts",
    heading: "Charts",
    primaryCtaRole: "button",
    primaryCtaName: /new chart/i,
  },
  {
    label: "sql",
    navLabel: "SQL",
    path: "/sql",
    heading: "SQL Editor",
    primaryCtaRole: "button",
    primaryCtaName: /new dataset/i,
  },
  {
    label: "settings",
    navLabel: "Settings",
    path: "/settings",
    heading: "Workspace Settings",
    primaryCtaRole: "button",
    primaryCtaName: /light mode/i,
  },
];

test.use({ colorScheme: "light" });

test.describe("Workspace navigation", () => {
  test.beforeEach(async ({ page }) => {
    await loginAsTestUser(page);
    await page.goto("/dashboard");
  });

  for (const route of TOP_LEVEL_NAV_ROUTES) {
    test(`opens the ${route.label} top-level workspace nav`, async ({ page }) => {
      const navLink = page.getByRole("link", { name: route.navLabel });

      if (route.path !== "/dashboard") {
        await navLink.click();
      }

      await expect(page).toHaveURL(new RegExp(`${route.path}$`), {
        timeout: 30_000,
      });
      await expect(navLink).toHaveAttribute("aria-current", "page", {
        timeout: 30_000,
      });
      await expect(
        page.getByRole("heading", { name: route.heading }),
      ).toBeVisible({ timeout: 30_000 });
      await expect(
        page.getByRole(route.primaryCtaRole, { name: route.primaryCtaName }),
      ).toBeVisible({ timeout: 30_000 });
    });
  }
});
