const { test, expect } = require('@playwright/test');
const path = require('path');

// Smoke test for the extension popup.
test('open extension popup and measure height', async ({ page }) => {
  const extensionPath = path.resolve(__dirname, '..');

  // Open popup.html directly via file:// and inject a lightweight mock of the
  // chrome extension APIs so the popup can render in a reproducible way.
  const popupPath = path.join(extensionPath, 'popup.html');
  const popupUrl = (process.platform === 'win32') ? `file:///${popupPath.replace(/\\/g, '/')}` : `file://${popupPath}`;

  const sampleTabs = [
    { id: 101, url: 'https://example.com/a', title: 'Example A', favIconUrl: '', active: true },
    { id: 102, url: 'https://example.com/a?x=1', title: 'Example A (duplicate)', favIconUrl: '', active: false },
    { id: 103, url: 'https://example.org/b', title: 'Example B', favIconUrl: '', active: false }
  ];

  await page.addInitScript(() => {
    window.__TEST_TAB_FIXTURE__ = [];
    window.chrome = {
      tabs: {
        query: () => Promise.resolve(window.__TEST_TAB_FIXTURE__ || []),
        update: () => Promise.resolve(),
        remove: () => Promise.resolve(),
        create: () => Promise.resolve({})
      },
      runtime: {
        sendMessage: (msg) => {
          if (msg && msg.action === 'fetchDuplicates') return Promise.resolve({ success: true, duplicates: [] });
          if (msg && msg.action === 'getSessions') return Promise.resolve({ success: true, sessions: {} });
          if (msg && msg.action === 'getLists') return Promise.resolve({ success: true, lists: {} });
          return Promise.resolve({});
        }
      },
      storage: {
        local: {
          get: (keys, cb) => {
            const resp = { sensitivity: 'balanced', queryParamWhitelist: '' };
            if (typeof keys === 'string') cb({ [keys]: resp[keys] || '' });
            else if (Array.isArray(keys)) {
              const out = {};
              keys.forEach(k => { out[k] = resp[k]; });
              cb(out);
            } else cb(resp);
          },
          set: (obj, cb) => { if (typeof cb === 'function') cb(); }
        }
      },
      action: {}
    };
  });

  await page.goto(popupUrl, { waitUntil: 'load' });
  await page.waitForSelector('.container', { timeout: 5000 });
  await page.evaluate((tabs) => { window.__TEST_TAB_FIXTURE__ = tabs; }, sampleTabs);

  const height = await page.evaluate(() => document.querySelector('.container').getBoundingClientRect().height);
  console.log('Popup container height:', height);
  await page.screenshot({ path: path.join(extensionPath, 'popup-screenshot.png'), fullPage: false });

  expect(height).toBeGreaterThan(300);
});
