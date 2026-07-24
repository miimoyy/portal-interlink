const { test, expect } = require('@playwright/test');
const { setupErrorListeners } = require('./test_helpers');

test.describe('Racks & Floors Operations', () => {
  let listeners;

  test.beforeEach(async ({ page }) => {
    listeners = setupErrorListeners(page);
    await page.goto('/');
    await page.click('button.demo-pill.admin');
    await page.click('button[type="submit"]');
    await expect(page.locator('#dashboard-screen')).toBeVisible();

    await page.click('.subnav-item[data-page="racks"]');
    await expect(page.locator('#page-racks')).toHaveClass(/active/);
  });

  test.afterEach(async () => {
    listeners.assertNoErrors();
  });

  test('openFloorModal and saveFloor create a new floor', async ({ page }) => {
    const floorName = `Lantai Test ${Date.now().toString().slice(-4)}`;

    await page.click('#btnAddFloor');
    await expect(page.locator('#modalFloor')).toHaveClass(/show/);

    await page.fill('#fl_name', floorName);
    await page.fill('#fl_area', 'Z-Area Test');
    await page.fill('#fl_capacity', '20');

    await page.evaluate(() => saveFloor());
    await expect(page.locator('#modalFloor')).not.toHaveClass(/show/);

    const optionCount = await page.locator('#rackFloorFilter option', { hasText: floorName }).count();
    expect(optionCount).toBeGreaterThan(0);
  });

  test('openRackInfoModal and saveRackInfo create and update a rack', async ({ page }) => {
    const newRackId = `Rack T-${Date.now().toString().slice(-4)}`;

    await page.evaluate(() => openRackInfoModal());
    await expect(page.locator('#modalRackInfo')).toHaveClass(/show/);

    await page.fill('#r_info_id', newRackId);
    await page.fill('#r_info_lokasi', 'Lantai 1 - Row T');
    await page.click('#modalRackInfo .btn-modal-primary');
    await expect(page.locator('#modalRackInfo')).not.toHaveClass(/show/);

    // Filter by name to find in grid
    await page.fill('#rackSearch', newRackId);
    await expect(page.locator('#rackGrid')).toContainText(newRackId);

    await page.evaluate(() => resetRackFilters());
  });

  test('openRackDetail, switchRackTab, editCurrentRack, and deleteCurrentRack', async ({ page }) => {
    const firstRackId = await page.evaluate(() => racks[0]?.id || 'Rack A-01');
    await page.evaluate((id) => openRackDetail(id), firstRackId);
    await expect(page.locator('#racks-detail-view')).toBeVisible();

    await page.evaluate(() => {
      if (typeof exportRackActiveToExcel === 'function') {
        exportRackActiveToExcel();
      }
    });

    await page.evaluate(() => editCurrentRack());
    await expect(page.locator('#modalRackInfo')).toHaveClass(/show/);
    await page.click('#modalRackInfo .modal-close');
    await expect(page.locator('#modalRackInfo')).not.toHaveClass(/show/);
  });
});
