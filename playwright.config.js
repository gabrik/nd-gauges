const { defineConfig } = require('@playwright/test');
module.exports = defineConfig({
  testDir: './tests', testMatch: 'browser.spec.js', workers: 1, timeout: 60000,
  use: { viewport: { width: 800, height: 480 },
    ...(process.env.ND_BROWSER_CHANNEL ? { channel: process.env.ND_BROWSER_CHANNEL } : {}) },
});
