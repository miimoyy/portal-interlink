const { test, expect } = require('@playwright/test');
const { setupErrorListeners } = require('./test_helpers');

test.describe('Account, Sub-account & Password Operations', () => {
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

  test('openAccountModal, saveAccount, resetAccountFilters, toggleAccountPassword, and toggleAccountTablePassword', async ({ page }) => {
    await page.click('#accountManagementNav');
    await expect(page.locator('#page-account-management')).toHaveClass(/active/);

    await page.click('button:has-text("+ Tambah Akun Baru")');
    await expect(page.locator('#modalAccount')).toHaveClass(/show/);

    const testEmail = `user.test.${Date.now().toString().slice(-4)}@interlink.co.id`;
    // Correct field IDs: au_name, au_email, au_role, au_password, au_confirm (not acc_*)
    await page.fill('#au_name', 'Test Account');
    await page.fill('#au_email', testEmail);
    await page.selectOption('#au_role', 'support');
    await page.fill('#au_password', 'password123');
    await page.fill('#au_confirm', 'password123');

    await page.click('#modalAccount .account-primary-button');
    await expect(page.locator('#modalAccount')).not.toHaveClass(/show/);

    // Wait for the account management section to render
    await expect(page.locator('#accountManagementSection')).toBeVisible();

    // Correct IDs: accountFilterSearch and accountManagementTableBody
    await page.fill('#accountFilterSearch', testEmail);
    await expect(page.locator('#accountManagementTableBody')).toContainText(testEmail);

    await page.evaluate(() => resetAccountFilters());
    await expect(page.locator('#accountFilterSearch')).toHaveValue('');

    await page.evaluate((email) => {
      // Uses encodeURIComponent encoding (see accountKey() in auth.js)
      const encoded = encodeURIComponent(email.toLowerCase());
      openAdminAccountPasswordModal(encoded);
    }, testEmail);
    await expect(page.locator('#modalAdminAccountPassword')).toHaveClass(/show/);

    await page.fill('#apr_password', 'newsecret123');
    await page.fill('#apr_confirm', 'newsecret123');
    await page.click('#modalAdminAccountPassword .account-primary-button');
    await expect(page.locator('#modalAdminAccountPassword')).not.toHaveClass(/show/);

    await page.evaluate((email) => {
      const encoded = encodeURIComponent(email.toLowerCase());
      openDeleteAccountModal(encoded);
    }, testEmail);
    await expect(page.locator('#modalDeleteAccount')).toHaveClass(/show/);
    await page.click('#modalDeleteAccount .account-delete-button');
    await expect(page.locator('#modalDeleteAccount')).not.toHaveClass(/show/);
    await expect(page.locator('#accountManagementTableBody')).not.toContainText(testEmail);
  });

  test('openSubAccountModal, saveSubAccount, and deleteSubAccount', async ({ page }) => {
    await page.click('#logout-btn');
    await page.click('button.demo-pill.client');
    await page.click('button[type="submit"]');
    await expect(page.locator('#dashboard-screen')).toBeVisible();

    // navigateToPage is the function defined in app.js
    await page.evaluate(() => navigateToPage('subaccount'));
    await expect(page.locator('#page-subaccount')).toHaveClass(/active/);

    await page.click('button:has-text("+ Tambah Sub-Account")');
    await expect(page.locator('#modalSubAccount')).toHaveClass(/show/);

    const subEmail = `sub.${Date.now().toString().slice(-4)}@client.com`;
    await page.fill('#su_name', 'Sub User Test');
    await page.fill('#su_email', subEmail);
    await page.fill('#su_password', 'subpass123');
    // su_confirm does not exist in sub-account modal (single password field)

    await page.click('#modalSubAccount .account-primary-button');
    await expect(page.locator('#modalSubAccount')).not.toHaveClass(/show/);

    await expect(page.locator('#subAccountTableBody')).toContainText(subEmail);

    await page.evaluate((email) => deleteSubAccount(email), subEmail);
    await expect(page.locator('#modalConfirmDialog')).toHaveClass(/show/);
    await page.click('#btnConfirmYes');

    await expect(page.locator('#subAccountTableBody')).not.toContainText(subEmail);
  });

  test('openChangePasswordModal and togglePasswordField', async ({ page }) => {
    await page.evaluate(() => openChangePasswordModal());
    await expect(page.locator('#modalChangePassword')).toHaveClass(/show/);

    await page.evaluate(() => togglePasswordField('cp_old_modal'));
    await page.click('#modalChangePassword .modal-close');
    await expect(page.locator('#modalChangePassword')).not.toHaveClass(/show/);
  });
});
