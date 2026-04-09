const { test, expect } = require('@playwright/test');
const path = require('path');
const fs = require('fs');

test('open extension popup and measure height', async () => {
  const extensionPath = path.resolve(__dirname, '..');

  // Create a fresh temporary user data dir for a persistent context to avoid reusing
  // any existing browser profile in the repo (which can contain Edge-specific prefs
  // that crash Playwright's Chromium).
  const os = require('os');
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'playwright-profile-'));

  const { chromium } = require('playwright');

  // Launch a persistent context (no extension loading). For the test we will open popup.html
  // directly as a local file and inject a lightweight mock of the `chrome` extension APIs so
  // the popup can render in a reproducible way across environments.
  const context = await chromium.launchPersistentContext(userDataDir, {
    headless: false
  });

  try {
    // Instead of loading as an installed extension, open popup.html directly via file://
    const popupPath = path.join(extensionPath, 'popup.html');
    const popupUrl = (process.platform === 'win32') ? `file:///${popupPath.replace(/\\/g, '/')}` : `file://${popupPath}`;

    const page = await context.newPage();

    // Inject a minimal mock `chrome` API before any scripts run so popup.js can call it.
    const sampleTabs = [
      { id: 101, url: 'https://example.com/a', title: 'Example A', favIconUrl: '', active: true },
      { id: 102, url: 'https://example.com/a?x=1', title: 'Example A (duplicate)', favIconUrl: '', active: false },
      { id: 103, url: 'https://example.org/b', title: 'Example B', favIconUrl: '', active: false }
    ];

    await page.addInitScript(() => {
      // Provide a safe mock for chrome.* used by the popup. Tests can expand this as needed.
    window.chrome = {
      tabs: {
        query: (q) => Promise.resolve(window.__TEST_TAB_FIXTURE__ || []),
        update: (id, opts) => Promise.resolve(),
        remove: (id) => Promise.resolve(),
        create: (opts) => Promise.resolve({})
      },
      runtime: {
        sendMessage: (msg) => {
          // simple runtime message mock that returns success for known actions
          if (msg && msg.action === 'fetchDuplicates') return Promise.resolve({ success: true, duplicates: [] });
          if (msg && msg.action === 'getSessions') return Promise.resolve({ success: true, sessions: {} });
          return Promise.resolve({});
        }
      },
      storage: {
        local: {
          get: (keys, cb) => {
            // Return both sensitivity and queryParamWhitelist when asked
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

    // Expose the sample tabs fixture to the page so the injected script can read it
    await page.evaluate((tabs) => { window.__TEST_TAB_FIXTURE__ = tabs; }, sampleTabs);

    await page.goto(popupUrl, { waitUntil: 'load' });

    // wait for UI to render
    await page.waitForSelector('.container', { timeout: 5000 });

    // measure height and take screenshot
    const height = await page.evaluate(() => document.querySelector('.container').getBoundingClientRect().height);
    console.log('Popup container height:', height);
    await page.screenshot({ path: path.join(extensionPath, 'popup-screenshot.png'), fullPage: false });

    // simple assertion so test can report
    expect(height).toBeGreaterThan(300);

    await page.close();
  } finally {
    await context.close();
  }
});
