const { test, expect } = require('@playwright/test');
const path = require('path');

// Regression test for the new "Convert tabs to lists" flow.
test('test_regression_convert_tabs_to_lists', async ({ page }) => {
  const extensionPath = path.resolve(__dirname, '..');
  const popupPath = path.join(extensionPath, 'popup.html');
  const popupUrl = (process.platform === 'win32') ? `file:///${popupPath.replace(/\\/g, '/')}` : `file://${popupPath}`;

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

  page.on('dialog', async (dialog) => {
    await dialog.accept();
  });

  page.on('console', (msg) => {
    console.log(`[page:${msg.type()}] ${msg.text()}`);
  });

  page.on('pageerror', (err) => {
    console.log(`[pageerror] ${err.message}`);
  });

  await page.goto(popupUrl, { waitUntil: 'load' });
  await page.waitForSelector('.container', { timeout: 5000 });
  console.log('popup loaded');

  await page.evaluate((tabs) => {
    window.__TEST_TAB_FIXTURE__ = tabs;
  }, sampleTabs);
  console.log('tab fixture set');

  await page.locator('.tab-btn[data-tab="sessions"]').click();
  console.log('sessions tab clicked');

  await page.locator('#convertListsBtn').click();
  console.log('convert button clicked');

  await expect(page.locator('#listsList .session-item')).toHaveCount(2, { timeout: 5000 });
  console.log('list count verified');

  const sessionMessage = await page.evaluate(() => document.getElementById('sessionResultMessage')?.textContent || '');
  expect(sessionMessage || '').toContain('Saved');
  console.log('result text verified');

  const removedCalls = await page.evaluate(() => window.__TEST_REMOVE_CALLS__);
  expect(removedCalls.length).toBeGreaterThan(0);
  expect(removedCalls[removedCalls.length - 1]).toEqual(expect.arrayContaining([202, 203]));

  const savedLists = await page.evaluate(() => Object.keys(window.__TEST_STORAGE__.lists));
  expect(savedLists.length).toBe(2);
  console.log('saved lists verified');
});
