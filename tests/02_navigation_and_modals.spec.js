const { test, expect } = require('@playwright/test');
const { setupErrorListeners } = require('./test_helpers');

test.describe('Navigation & General Modals', () => {
  let listeners;

  test.beforeEach(async ({ page }) => {
    listeners = setupErrorListeners(page);
    await page.goto('/');
    await page.click('button.demo-pill.admin');
    await page.click('button[type="submit"]');
    await expect(page.locator('#dashboard-screen')).toBeVisible();
  });

  test.afterEach(async () => {
    listeners.assertNoErrors();
  });

  test('openTopNavPage navigates between top nav pages', async ({ page }) => {
    await page.evaluate(() => openTopNavPage('home'));
    await expect(page.locator('#navHome')).toHaveClass(/active/);

    await page.evaluate(() => openTopNavPage('contact'));
    await expect(page.locator('#navContact')).toHaveClass(/active/);
    await expect(page.locator('#modalTopbarInfo')).toHaveClass(/show/);
    await page.evaluate(() => closeModal('modalTopbarInfo'));

    await page.evaluate(() => openTopNavPage('dashboard'));
    await expect(page.locator('#navDashboard')).toHaveClass(/active/);
  });

  test('openTopbarModal and closeModal open and close topbar modals', async ({ page }) => {
    await page.click('.icon-pill.i3');
    await expect(page.locator('#modalTopbarInfo')).toHaveClass(/show/);
    await expect(page.locator('#topbarInfoTitle')).toHaveText('📱 Kontak & Support');

    await page.click('#modalTopbarInfo .modal-close');
    await expect(page.locator('#modalTopbarInfo')).not.toHaveClass(/show/);
  });

  test('subnav switching between pages works', async ({ page }) => {
    await page.click('.subnav-item[data-page="racks"]');
    await expect(page.locator('#page-racks')).toHaveClass(/active/);

    await page.click('.subnav-item[data-page="inventory"]');
    await expect(page.locator('#page-inventory')).toHaveClass(/active/);

    await page.click('.subnav-item[data-page="tickets"]');
    await expect(page.locator('#page-tickets')).toHaveClass(/active/);

    await page.click('.subnav-item[data-page="crossconnect"]');
    await expect(page.locator('#page-crossconnect')).toHaveClass(/active/);

    await page.click('#accountManagementNav');
    await expect(page.locator('#page-account-management')).toHaveClass(/active/);

    await page.click('.subnav-item[data-page="profile"]');
    await expect(page.locator('#page-profile')).toHaveClass(/active/);
  });

  test('exportData functions without crashing', async ({ page }) => {
    await page.click('.subnav-item[data-page="inventory"]');
    await page.evaluate(() => {
      if (typeof exportData === 'function') {
        exportData();
      }
    });
  });
});
