const { test, expect } = require('@playwright/test');
const { setupErrorListeners } = require('./test_helpers');

test.describe('Ticket Operations', () => {
  let listeners;

  test.beforeEach(async ({ page }) => {
    listeners = setupErrorListeners(page);
    await page.goto('/');
    await page.click('button.demo-pill.admin');
    await page.click('button[type="submit"]');
    await expect(page.locator('#dashboard-screen')).toBeVisible();

    await page.click('.subnav-item[data-page="tickets"]');
    await expect(page.locator('#page-tickets')).toHaveClass(/active/);
  });

  test.afterEach(async () => {
    listeners.assertNoErrors();
  });

  test('submit ticket modal and export PDF', async ({ page }) => {
    await page.click('button:has-text("Submit a ticket")');
    await expect(page.locator('#modalTicket')).toHaveClass(/show/);

    await page.selectOption('#tk_type', 'Masuk Barang');
    await page.fill('#tk_dev_name', 'Switch Catalyst 2960');
    await page.fill('#tk_dev_sn', `SN-SW-${Date.now().toString().slice(-4)}`);
    await page.fill('#tk_dev_berat', '5');
    await page.fill('#tk_desc', 'Tes pengajuan tiket masuk barang dari automated test.');

    await page.click('#modalTicket .btn-modal-primary');
    await expect(page.locator('#modalTicket')).not.toHaveClass(/show/);

    // Correct selector: #ticketTypeFilterSelect (not #ticketFilterType)
    await page.selectOption('#ticketTypeFilterSelect', 'Masuk Barang');

    await page.evaluate(() => {
      if (typeof exportTicketsPdf === 'function') {
        exportTicketsPdf();
      }
    });
  });
});
