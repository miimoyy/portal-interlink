const { test, expect } = require('@playwright/test');
const { setupErrorListeners } = require('./test_helpers');

test.describe('Device / Inventory Operations', () => {
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

  test('quickAddDevice, saveDevice, switchDeviceTab, editDevice, and deleteDevice', async ({ page }) => {
    const firstClientId = await page.evaluate(() => clients[0]?.id || 'RCK-A01-01');
    await page.evaluate((id) => openClientDetail(id), firstClientId);
    await expect(page.locator('#inventory-detail-view')).toBeVisible();

    await page.evaluate(() => switchDeviceTab('masuk'));
    await expect(page.locator('.device-tab[data-tab="masuk"]')).toHaveClass(/active/);

    await page.evaluate(() => switchDeviceTab('keluar'));
    await expect(page.locator('.device-tab[data-tab="keluar"]')).toHaveClass(/active/);

    await page.evaluate(() => switchDeviceTab('masuk'));

    const deviceName = `Server Test ${Date.now().toString().slice(-4)}`;
    await page.evaluate((id) => quickAddDevice(id, 'masuk'), firstClientId);
    await expect(page.locator('#modalDevice')).toHaveClass(/show/);

    await page.fill('#d_nama', deviceName);
    await page.fill('#d_sn', `SN-${Date.now().toString().slice(-4)}`);
    await page.click('#btnSaveDevice');
    await expect(page.locator('#modalDevice')).not.toHaveClass(/show/);

    await expect(page.locator('#deviceTableBody')).toContainText(deviceName);

    const deviceObj = await page.evaluate((name) => devices.find(d => d.nama === name), deviceName);
    expect(deviceObj).toBeTruthy();

    await page.evaluate((id) => editDevice(id), deviceObj.id);
    await expect(page.locator('#modalDevice')).toHaveClass(/show/);

    const editedName = `${deviceName} Edited`;
    await page.fill('#d_nama', editedName);
    await page.click('#btnSaveDevice');
    await expect(page.locator('#modalDevice')).not.toHaveClass(/show/);

    await expect(page.locator('#deviceTableBody')).toContainText(editedName);

    await page.evaluate((id) => deleteDevice(id), deviceObj.id);
    await expect(page.locator('#modalConfirmDialog')).toHaveClass(/show/);
    await page.click('#btnConfirmYes');

    await expect(page.locator('#deviceTableBody')).not.toContainText(editedName);
  });
});
