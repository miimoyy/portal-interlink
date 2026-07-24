const { expect } = require('@playwright/test');

function setupErrorListeners(page) {
  const consoleErrors = [];
  const apiFailures = [];

  page.on('console', msg => {
    if (msg.type() === 'error') {
      const text = msg.text();
      // Ignore 404 resource errors for missing legacy Cloudflare script (/cdn-cgi/...)
      if (
        text.includes('Failed to load resource') ||
        text.includes('cdn-cgi') ||
        text.includes('cloudflare') ||
        text.includes('email-decode')
      ) {
        return;
      }
      consoleErrors.push(text);
    }
  });

  // Known 404s that are expected/non-breaking during normal usage
  const IGNORED_API_PATHS = [
    '/api/termination-notifications/bulk',
  ];

  page.on('response', response => {
    const url = response.url();
    if (url.includes('/api/') && response.status() >= 400) {
      const isIgnored = IGNORED_API_PATHS.some(p => url.includes(p));
      if (!isIgnored) {
        apiFailures.push(`${response.status()} ${url}`);
      }
    }
  });

  return {
    assertNoErrors: () => {
      expect(consoleErrors, `Console errors found: ${consoleErrors.join('; ')}`).toHaveLength(0);
      expect(apiFailures, `API failures found: ${apiFailures.join('; ')}`).toHaveLength(0);
    }
  };
}

module.exports = { setupErrorListeners };
