const { test, expect } = require('@playwright/test');
const { setupErrorListeners } = require('./test_helpers');

test.describe('Auth & Login Features', () => {
  let listeners;

  test.beforeEach(async ({ page }) => {
    listeners = setupErrorListeners(page);
    await page.goto('/');
  });

  test.afterEach(async () => {
    listeners.assertNoErrors();
  });

  test('fillDemoCredentials fills form correctly for ADMIN, SUPPORT, and CLIENT', async ({ page }) => {
    await page.click('button.demo-pill.admin');
    await expect(page.locator('#email')).toHaveValue('admin@interlink.co.id');
    await expect(page.locator('#password')).toHaveValue('admin123');

    await page.click('button.demo-pill.support');
    await expect(page.locator('#email')).toHaveValue('support@interlink.co.id');
    await expect(page.locator('#password')).toHaveValue('support123');

    await page.click('button.demo-pill.client');
    await expect(page.locator('#email')).toHaveValue('client.nusantara@pt.com');
    await expect(page.locator('#password')).toHaveValue('client123');
  });

  test('toggleLoginPassword toggles input type between password and text', async ({ page }) => {
    const passwordInput = page.locator('#password');
    const toggleBtn = page.locator('#loginPasswordToggle');

    await expect(passwordInput).toHaveAttribute('type', 'password');
    await toggleBtn.click();
    await expect(passwordInput).toHaveAttribute('type', 'text');
    await toggleBtn.click();
    await expect(passwordInput).toHaveAttribute('type', 'password');
  });

  test('quickLogin and login submit work, then logoutUser returns to login screen', async ({ page }) => {
    await page.click('button.demo-pill.admin');
    await page.click('button[type="submit"]');

    await expect(page.locator('#dashboard-screen')).toBeVisible();

    await page.click('#logout-btn');
    await expect(page.locator('#login-screen')).toBeVisible();
  });
});
