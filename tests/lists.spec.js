const { test, expect } = require('@playwright/test');
const path = require('path');
const fs = require('fs');

// Regression test for the new "Convert tabs to lists" flow.
test('test_regression_convert_tabs_to_lists', async () => {
  const extensionPath = path.resolve(__dirname, '..');
  const os = require('os');
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'playwright-profile-lists-'));
  const { chromium } = require('playwright');

  const context = await chromium.launchPersistentContext(userDataDir, {
    headless: false
  });

  try {
    const popupPath = path.join(extensionPath, 'popup.html');
    const popupUrl = (process.platform === 'win32') ? `file:///${popupPath.replace(/\\/g, '/')}` : `file://${popupPath}`;
    const page = await context.newPage();

    const sampleTabs = [
      { id: 201, url: 'https://example.com/docs/intro', title: 'Example Docs Intro', favIconUrl: '', active: true, windowId: 1 },
      { id: 202, url: 'https://example.com/docs/install', title: 'Example Docs Install', favIconUrl: '', active: false, windowId: 1 },
      { id: 203, url: 'https://example.org/blog/post', title: 'Example Blog Post', favIconUrl: '', active: false, windowId: 2 }
    ];

    await page.addInitScript(() => {
      window.__TEST_TAB_FIXTURE__ = [];
      window.__TEST_STORAGE__ = { sensitivity: 'balanced', queryParamWhitelist: '', lists: {} };
      window.__TEST_REMOVE_CALLS__ = [];

      window.chrome = {
        tabs: {
          query: () => Promise.resolve(window.__TEST_TAB_FIXTURE__ || []),
          update: () => Promise.resolve(),
          remove: (ids) => {
            const arr = Array.isArray(ids) ? ids.slice() : [ids];
            window.__TEST_REMOVE_CALLS__.push(arr);
            return Promise.resolve();
          },
          create: () => Promise.resolve({})
        },
        runtime: {
          sendMessage: (msg) => {
            if (!msg || !msg.action) return Promise.resolve({});

            if (msg.action === 'getSessions') return Promise.resolve({ success: true, sessions: {} });
            if (msg.action === 'saveLists') {
              const groups = msg.groups || [];
              const created = [];
              groups.forEach((g, index) => {
                const key = (g && g.key) ? String(g.key) : `group-${index + 1}`;
                const name = `${msg.heuristic}-${key}`.replace(/[^a-zA-Z0-9 _.-]/g, '').slice(0, 80);
                window.__TEST_STORAGE__.lists[name] = {
                  tabs: (g.items || []).map(it => ({ url: it.url, title: it.title || '' })),
                  savedAt: '2026-04-09T12:00:00.000Z',
                  tabCount: (g.items || []).length,
                  heuristic: msg.heuristic,
                  key
                };
                created.push(name);
              });

              if (msg.closeTabs) {
                const activeIds = new Set((window.__TEST_TAB_FIXTURE__ || []).filter(t => t.active).map(t => t.id));
                const toClose = [];
                (groups || []).forEach(g => {
                  (g.items || []).forEach(it => {
                    if (!activeIds.has(it.id)) toClose.push(it.id);
                  });
                });
                if (toClose.length) {
                  window.__TEST_REMOVE_CALLS__.push(Array.from(new Set(toClose)));
                }
              }

              return Promise.resolve({ success: true, createdCount: created.length, created });
            }

            if (msg.action === 'getLists') return Promise.resolve({ success: true, lists: window.__TEST_STORAGE__.lists });
            if (msg.action === 'restoreList') return Promise.resolve({ success: true, message: 'restored' });
            if (msg.action === 'deleteList') {
              delete window.__TEST_STORAGE__.lists[msg.listName];
              return Promise.resolve({ success: true, message: 'deleted' });
            }

            return Promise.resolve({ success: true });
          }
        },
        storage: {
          local: {
            get: (keys, cb) => {
              const storage = window.__TEST_STORAGE__ || {};
              let result = {};
              if (typeof keys === 'string') {
                result[keys] = storage[keys];
              } else if (Array.isArray(keys)) {
                keys.forEach(key => { result[key] = storage[key]; });
              } else if (keys && typeof keys === 'object') {
                result = { ...keys };
                Object.keys(keys).forEach(key => {
                  if (storage[key] !== undefined) result[key] = storage[key];
                });
              } else {
                result = { ...storage };
              }
              cb(result);
            },
            set: (obj, cb) => {
              window.__TEST_STORAGE__ = { ...(window.__TEST_STORAGE__ || {}), ...(obj || {}) };
              if (typeof cb === 'function') cb();
            }
          }
        },
        action: {}
      };
    });

    await page.evaluate((tabs) => {
      window.__TEST_TAB_FIXTURE__ = tabs;
    }, sampleTabs);

    page.on('dialog', async (dialog) => {
      await dialog.accept();
    });

    await page.goto(popupUrl, { waitUntil: 'load' });
    await page.waitForSelector('.container', { timeout: 5000 });

    await page.locator('.tab-btn[data-tab="sessions"]').click();

    await page.locator('#convertListsBtn').click();

    await expect(page.locator('#listsList .session-item')).toHaveCount(2, { timeout: 5000 });
    await expect(page.locator('#sessionResult .result-message')).toContainText('Saved', { timeout: 5000 });

    const removedCalls = await page.evaluate(() => window.__TEST_REMOVE_CALLS__);
    expect(removedCalls.length).toBeGreaterThan(0);
    expect(removedCalls[removedCalls.length - 1]).toEqual(expect.arrayContaining([202, 203]));

    const savedLists = await page.evaluate(() => Object.keys(window.__TEST_STORAGE__.lists));
    expect(savedLists.length).toBe(2);

    await page.close();
  } finally {
    await context.close();
  }
});
