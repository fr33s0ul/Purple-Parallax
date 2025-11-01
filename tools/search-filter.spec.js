const { test, expect } = require('@playwright/test');
const http = require('http');
const fs = require('fs');
const path = require('path');

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon'
};

let server;
let baseURL;

async function startStaticServer(){
  const docsDir = path.resolve(__dirname, '..', 'docs');
  return new Promise((resolve) => {
    server = http.createServer((req, res) => {
      const rawPath = decodeURIComponent((req.url || '').split('?')[0] || '/');
      const relativePath = rawPath === '/' ? 'index.html' : rawPath.replace(/^\/+/, '');
      const normalised = path.normalize(relativePath);
      const filePath = path.join(docsDir, normalised);
      if (!filePath.startsWith(docsDir)){
        res.statusCode = 403;
        res.end('Forbidden');
        return;
      }
      fs.readFile(filePath, (err, data) => {
        if (err){
          res.statusCode = 404;
          res.end('Not found');
          return;
        }
        const ext = path.extname(filePath).toLowerCase();
        res.setHeader('Content-Type', MIME_TYPES[ext] || 'application/octet-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.end(data);
      });
    }).listen(0, () => {
      const address = server.address();
      baseURL = `http://127.0.0.1:${address.port}`;
      resolve();
    });
  });
}

async function stopStaticServer(){
  if (!server) return;
  await new Promise((resolve) => server.close(resolve));
  server = null;
}

test.beforeAll(async () => {
  await startStaticServer();
});

test.afterAll(async () => {
  await stopStaticServer();
});

test('search auto-focus and pans to top incremental result', async ({ page }) => {
  await page.goto(`${baseURL}/index.html`);
  await page.waitForLoadState('domcontentloaded');
  await expect(page.locator('#q')).toBeFocused();

  const initialCamera = await page.evaluate(() => ({ offsetX, offsetY }));
  await page.fill('#q', 'threat');
  await expect(page.locator('#results')).toHaveAttribute('aria-expanded', 'true');
  const firstHit = page.locator('#results .hit').first();
  await expect(firstHit).toBeVisible();
  await page.waitForFunction((initial) => {
    if (!window.currentFocusNode || !window.currentFocusNode.match) return false;
    const dx = Math.abs(window.offsetX - initial.offsetX);
    const dy = Math.abs(window.offsetY - initial.offsetY);
    return dx > 0.5 || dy > 0.5;
  }, initialCamera);
});

test('macro and tag filters persist and reset via clear control', async ({ page }) => {
  await page.goto(`${baseURL}/index.html`);
  await page.waitForSelector('#filters input[type="checkbox"]');

  const macroCheckboxes = page.locator('#filters input[type="checkbox"]');
  const firstMacro = macroCheckboxes.first();
  await expect(firstMacro).toBeChecked();
  await firstMacro.setChecked(false);
  await page.waitForFunction(() => {
    try {
      const raw = localStorage.getItem('atlas_macro_filters_v1');
      if (!raw) return false;
      const parsed = JSON.parse(raw);
      return Object.values(parsed).some(value => value === false);
    } catch (e) {
      return false;
    }
  });

  await page.reload();
  await page.waitForSelector('#filters input[type="checkbox"]');
  await expect(page.locator('#filters input[type="checkbox"]').first()).not.toBeChecked();

  const tagCheckboxes = page.locator('#tagFilters input[type="checkbox"]');
  let tagCount = 0;
  try {
    await page.waitForFunction(() => document.querySelectorAll('#tagFilters input[type="checkbox"]').length > 0, { timeout: 5000 });
    tagCount = await tagCheckboxes.count();
  } catch (e) {
    tagCount = await tagCheckboxes.count();
  }
  if (tagCount > 0){
    await tagCheckboxes.first().setChecked(true);
    await page.waitForFunction(() => {
      try {
        const raw = localStorage.getItem('atlas_tag_filters_v1');
        if (!raw) return false;
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) && parsed.length > 0;
      } catch (e) {
        return false;
      }
    });

    await page.reload();
    await page.waitForSelector('#filters input[type="checkbox"]');
    await page.waitForSelector('#tagFilters input[type="checkbox"]');
    await expect(page.locator('#filters input[type="checkbox"]').first()).not.toBeChecked();
    await expect(page.locator('#tagFilters input[type="checkbox"]').first()).toBeChecked();
  }

  await page.click('#clearFiltersBtn');
  await expect(page.locator('#filters input[type="checkbox"]').first()).toBeChecked();
  if (tagCount > 0){
    await expect(page.locator('#tagFilters input[type="checkbox"]').first()).not.toBeChecked();
  }

  await page.waitForFunction(() => {
    try {
      const macrosRaw = localStorage.getItem('atlas_macro_filters_v1');
      const tagsRaw = localStorage.getItem('atlas_tag_filters_v1');
      const macros = macrosRaw ? JSON.parse(macrosRaw) : {};
      const tags = tagsRaw ? JSON.parse(tagsRaw) : [];
      return Object.values(macros).every(Boolean) && (!Array.isArray(tags) || tags.length === 0);
    } catch (e) {
      return false;
    }
  });
});
