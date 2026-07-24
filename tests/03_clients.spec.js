const { test, expect } = require('@playwright/test');
const { setupErrorListeners } = require('./test_helpers');

test.describe('Client CRUD Operations', () => {
  let listeners;

  test.beforeEach(async ({ page }) => {
    listeners = setupErrorListeners(page);
    await page.goto('/');
    await page.click('button.demo-pill.admin');
    await page.click('button[type="submit"]');
    await expect(page.locator('#dashboard-screen')).toBeVisible();

    await page.click('.subnav-item[data-page="inventory"]');
    await expect(page.locator('#page-inventory')).toHaveClass(/active/);
  });

  test.afterEach(async () => {
    listeners.assertNoErrors();
  });

  test('client CRUD flow: add client, view detail, close detail', async ({ page }) => {
    const testClientId = `RCK-TEST-${Date.now().toString().slice(-4)}`;
    const testPtName = `PT Test Playwright ${Date.now().toString().slice(-4)}`;

    await page.click('button:has-text("+ Tambah Klien Baru")');
    await expect(page.locator('#modalClient')).toHaveClass(/show/);

    await page.fill('#c_id', testClientId);
    await page.fill('#c_pt', testPtName);
    await page.selectOption('#c_layanan', 'Colocation Full Rack');
    await page.fill('#c_lokasi', 'Rack A-01');
    await page.fill('#c_pic', 'Budi Test');
    await page.fill('#c_email', 'budi@test.com');
    await page.fill('#c_telp', '08123456789');

    await page.click('#modalClient .btn-modal-primary');
    await expect(page.locator('#modalClient')).not.toHaveClass(/show/);

    await page.fill('#clientSearch', testPtName);
    await expect(page.locator('#clientTableBody')).toContainText(testPtName);

    await page.locator('#clientTableBody .clickable-pt').first().click();
    await expect(page.locator('#inventory-detail-view')).toBeVisible();

    await page.click('#inventory-detail-view .detail-back');
    await expect(page.locator('#inventory-list-view')).toBeVisible();
  });
});
