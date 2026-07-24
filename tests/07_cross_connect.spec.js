const { test, expect } = require('@playwright/test');
const { setupErrorListeners } = require('./test_helpers');

test.describe('Cross Connect Operations', () => {
  let listeners;

  test.beforeEach(async ({ page }) => {
    listeners = setupErrorListeners(page);
    await page.goto('/');
    await page.click('button.demo-pill.admin');
    await page.click('button[type="submit"]');
    await expect(page.locator('#dashboard-screen')).toBeVisible();

    await page.click('.subnav-item[data-page="crossconnect"]');
    await expect(page.locator('#page-crossconnect')).toHaveClass(/active/);
  });

  test.afterEach(async () => {
    listeners.assertNoErrors();
  });

  test('openCrossConnectDetail, closeCrossConnectDetail, setCrossConnectFilter, and exportCrossConnects', async ({ page }) => {
    // XC uses chip buttons not a select - correct selector
    await page.click('.chip[data-xcfilter="all"]');

    await page.evaluate(() => {
      if (typeof exportCrossConnects === 'function') {
        exportCrossConnects();
      }
    });

    const xcId = await page.evaluate(() => crossConnects[0]?.id);
    if (xcId) {
      await page.evaluate((id) => openCrossConnectDetail(id), xcId);
      await expect(page.locator('#crossconnect-detail-view')).toBeVisible();

      await page.click('#crossconnect-detail-view .detail-back');
      await expect(page.locator('#crossconnect-list-view')).toBeVisible();
    }
  });

  test('editCrossConnect opens ticket modal for editing cross connect', async ({ page }) => {
    const xcId = await page.evaluate(() => crossConnects[0]?.id);
    if (xcId) {
      await page.evaluate((id) => editCrossConnect(id), xcId);
      // editCrossConnect opens modalTicket for editing CrossConnect
      await expect(page.locator('#modalTicket')).toHaveClass(/show/);

      await page.click('#modalTicket .modal-close');
      await expect(page.locator('#modalTicket')).not.toHaveClass(/show/);
    }
  });
});
