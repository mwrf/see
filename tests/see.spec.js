const { test, expect } = require('@playwright/test');
const fs = require('fs').promises; // Using promises version of fs
const path = require('path');

const BASE_URL = 'http://localhost:8080'; // Assuming server runs on port 8080
const MAPPINGS_FILE = path.join(__dirname, '../mappings.json'); // Correct path to mappings.json

// Load mappings to use in tests - this will be the initial state
const initialMappings = require('../mappings.json');

// Function to wait
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

test.describe('URL Shortener Tests', () => {
  test('should redirect a known short URL to its long URL', async ({ page }) => {
    const shortUrl = '/google';
    const response = await page.goto(BASE_URL + shortUrl);
    expect(response.status()).toBe(302);
    expect(page.url()).toContain('google.com');
  });

  test('should display a not found page for an unknown short URL', async ({ page }) => {
    const unknownShortUrl = '/thisdoesnotexist';
    const response = await page.goto(BASE_URL + unknownShortUrl);
    expect(response.status()).toBe(200);
    await expect(page.locator('body')).toContainText(`${unknownShortUrl}, does not exist!`);
    await expect(page.locator('body')).toContainText('Available URLs:');
    const tableLocator = page.locator('table');
    await expect(tableLocator).toBeVisible();
    const firstKey = Object.keys(initialMappings)[0];
    await expect(tableLocator).toContainText(firstKey);
  });

  test('should dynamically reload updated mappings', async ({ page }) => {
    const dynamicShortUrl = '/test-dynamic-reload'; // Unique name for this test
    const dynamicTargetUrl = 'http://example.com/dynamic-page';

    // 1. Ensure the mapping does not exist initially
    let response = await page.goto(BASE_URL + dynamicShortUrl, { waitUntil: 'domcontentloaded' });
    expect(response.status()).toBe(200);
    await expect(page.locator('body')).toContainText(`${dynamicShortUrl}, does not exist!`);

    // 2. Modify mappings.json to add the new mapping
    let currentMappingsContent = await fs.readFile(MAPPINGS_FILE, 'utf8');
    let currentMappingsObject = JSON.parse(currentMappingsContent);

    // Store a copy of the original content to restore it later
    const originalMappingsContent = currentMappingsContent;

    currentMappingsObject[dynamicShortUrl] = dynamicTargetUrl;
    await fs.writeFile(MAPPINGS_FILE, JSON.stringify(currentMappingsObject, null, 2));

    // 3. Wait for server to reload (server reloads every 5s)
    await delay(7000); // Wait 7 seconds

    // 4. Test the new mapping
    response = await page.goto(BASE_URL + dynamicShortUrl);
    expect(response.status()).toBe(302);
    expect(page.url()).toContain('example.com/dynamic-page');

    // 5. Clean up: Restore the original content of mappings.json
    await fs.writeFile(MAPPINGS_FILE, originalMappingsContent);

    // 6. Wait for server to reload again
    await delay(7000);

    // 7. Verify the mapping is gone
    response = await page.goto(BASE_URL + dynamicShortUrl, { waitUntil: 'domcontentloaded' });
    expect(response.status()).toBe(200);
    await expect(page.locator('body')).toContainText(`${dynamicShortUrl}, does not exist!`);
  });
});
