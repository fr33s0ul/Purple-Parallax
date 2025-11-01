const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
  testDir: __dirname,
  timeout: 60000,
  fullyParallel: false,
  reporter: [['list']],
  use: {
    headless: true,
  },
});
