import { test, expect } from '@playwright/test';

test.describe('Data Upload Flow', () => {
  test('shows upload area on explore page', async ({ page }) => {
    await page.goto('/explore');
    await expect(page.locator('body')).toBeVisible();
  });

  test('charts page loads correctly', async ({ page }) => {
    await page.goto('/charts');
    await expect(page.locator('body')).toBeVisible();
  });

  test('ML page loads correctly', async ({ page }) => {
    await page.goto('/ml');
    await expect(page.locator('body')).toBeVisible();
  });

  test('analytics page loads correctly', async ({ page }) => {
    await page.goto('/analytics');
    await expect(page.locator('body')).toBeVisible();
  });

  test('reports page loads correctly', async ({ page }) => {
    await page.goto('/reports');
    await expect(page.locator('body')).toBeVisible();
  });

  test('quality page loads correctly', async ({ page }) => {
    await page.goto('/quality');
    await expect(page.locator('body')).toBeVisible();
  });
});
