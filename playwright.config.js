// playwright.config.js
const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './tests', // Specifies the directory where tests are located
  webServer: {
    command: 'node see.js 8080', // Command to start the server
    port: 8080, // Port the server will run on
    timeout: 120 * 1000, // Timeout for server startup
    reuseExistingServer: !process.env.CI, // Reuse server when not in CI
    // Setting a higher stdout/stderr buffer to avoid [WebServer] ERROR: stdout maxBuffer exceeded
    // if the server is very verbose. Default is 10MB.
    stdout: 'pipe',
    stderr: 'pipe',
  },
  use: {
    baseURL: 'http://localhost:8080', // Base URL for tests
    // Options for headless browser, viewport size, etc. can be added here
  },
  // reporter: [['list'], ['html', { open: 'never' }]], // Optional: configure reporters
});
