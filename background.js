// Configuration for duplicate detection
const CONFIG = {
  mode: 'ignoreQueryParams', // 'exact', 'ignoreQueryParams', 'ignoreFragment', 'ignoreAll'
};

// Normalize URL based on detection mode
function normalizeUrl(url, mode = CONFIG.mode) {
  try {
    const urlObj = new URL(url);
    
    switch (mode) {
      case 'exact':
        return url.toLowerCase();
      
      case 'ignoreFragment':
        return (urlObj.origin + urlObj.pathname + urlObj.search).toLowerCase();
      
      case 'ignoreQueryParams':
        return (urlObj.origin + urlObj.pathname).toLowerCase();
      
      case 'ignoreAll':
        return (urlObj.origin + urlObj.pathname).toLowerCase();
      
      default:
        return url.toLowerCase();
    }
  } catch (e) {
    // Handle invalid URLs (e.g., chrome://, edge://)
    return url.toLowerCase();
  }
}

// Find and remove duplicate tabs
async function removeDuplicateTabs() {
  try {
    const tabs = await chrome.tabs.query({});
    
    if (tabs.length === 0) {
      return { duplicatesRemoved: 0, message: 'No tabs found' };
    }

    const seen = new Map();
    const duplicateTabIds = [];
    let activeTabId = null;

    // Get current active tab to avoid closing it
    const activeTabs = await chrome.tabs.query({ active: true });
    if (activeTabs.length > 0) {
      activeTabId = activeTabs[0].id;
    }

    // Use fuzzy detection (same logic as fetchDuplicateTabs) to identify duplicates
    const candidates = tabs.filter(tab => tab.url && !tab.url.startsWith('chrome://') && !tab.url.startsWith('edge://') && !tab.url.startsWith('about:'));
    const items = candidates.map(tab => {
      let norm = normalizeUrl(tab.url);
      let urlObj;
      try { urlObj = new URL(tab.url); } catch (e) { urlObj = null; }
      const hostname = urlObj ? urlObj.hostname : '';
      const path = urlObj ? urlObj.pathname : '';
      return { id: tab.id, url: tab.url, title: tab.title || '', faviconUrl: tab.favIconUrl, normalized: norm, hostname, path };
    });

    const used = new Set();

    // First pass: exact normalized URL duplicates
    const seenMap = new Map();
    for (const it of items) {
      if (seenMap.has(it.normalized)) {
        if (it.id !== activeTabId) { duplicateTabIds.push(it.id); used.add(it.id); }
      } else {
        seenMap.set(it.normalized, it.id);
      }
    }

    // Second pass: fuzzy matching on title/path
    function tokenize(s) { return (s||'').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean); }
    function jaccard(a,b) { const A=new Set(a), B=new Set(b); const inter=[...A].filter(x=>B.has(x)).length; const uni=new Set([...A,...B]).size; return uni===0?0:inter/uni; }

    for (let i=0;i<items.length;i++) {
      const a = items[i];
      if (used.has(a.id) || a.id === activeTabId) continue;
      for (let j=i+1;j<items.length;j++) {
        const b = items[j];
        if (used.has(b.id) || b.id === activeTabId) continue;
        const sameHost = a.hostname && b.hostname && a.hostname === b.hostname;
        const tokensA = tokenize(a.title + ' ' + a.path);
        const tokensB = tokenize(b.title + ' ' + b.path);
        const titleSim = jaccard(tokensA, tokensB);
        const pathSegA = a.path.split('/').filter(Boolean);
        const pathSegB = b.path.split('/').filter(Boolean);
        const pathInter = pathSegA.filter(s => pathSegB.includes(s)).length;
        const maxSeg = Math.max(pathSegA.length, pathSegB.length, 1);
        const pathSim = pathInter / maxSeg;
        if ((sameHost && (titleSim >= 0.5 || pathSim >= 0.6)) || titleSim >= 0.75) {
          if (b.id !== activeTabId) { duplicateTabIds.push(b.id); used.add(b.id); }
        }
      }
    }

    // Remove duplicates
    if (duplicateTabIds.length > 0) {
      await chrome.tabs.remove(duplicateTabIds);
      return {
        duplicatesRemoved: duplicateTabIds.length,
        message: `Removed ${duplicateTabIds.length} duplicate tab(s)`
      };
    } else {
      return {
        duplicatesRemoved: 0,
        message: 'No duplicate tabs found'
      };
    }
  } catch (error) {
    console.error('Error removing duplicates:', error);
    return {
      duplicatesRemoved: 0,
      message: `Error: ${error.message}`
    };
  }
}

// Fetch duplicate tabs without removing them
async function fetchDuplicateTabs() {
  try {
    const tabs = await chrome.tabs.query({});

    if (tabs.length === 0) {
      return { success: true, duplicates: [], totalTabs: 0, message: 'No tabs found' };
    }

    // Get current active tab (used to avoid auto-removal and to surface it first in groups)
    const activeTabs = await chrome.tabs.query({ active: true });
    const activeTabId = activeTabs.length > 0 ? activeTabs[0].id : null;

    // Filter out special/internal URLs
    const candidates = tabs.filter(tab => tab.url && !tab.url.startsWith('chrome://') && !tab.url.startsWith('edge://') && !tab.url.startsWith('about:'));

    // Build normalized list
    const items = candidates.map(tab => {
      let norm = normalizeUrl(tab.url);
      let urlObj;
      try { urlObj = new URL(tab.url); } catch (e) { urlObj = null; }
      const hostname = urlObj ? urlObj.hostname : '';
      const path = urlObj ? urlObj.pathname : '';
      return { id: tab.id, url: tab.url, title: tab.title || '', faviconUrl: tab.favIconUrl, normalized: norm, hostname, path, isActive: tab.id === activeTabId };
    });

    // If there are very few candidates, bail early
    if (items.length <= 1) {
      return { success: true, duplicates: [], totalTabs: tabs.length, message: 'No duplicate tabs found' };
    }

    // Use union-find (disjoint-set) to cluster tabs that are considered duplicates by pairwise heuristics
    const n = items.length;
    const parent = Array.from({ length: n }, (_, i) => i);
    function find(x) { return parent[x] === x ? x : (parent[x] = find(parent[x])); }
    function union(a, b) { const ra = find(a); const rb = find(b); if (ra !== rb) parent[rb] = ra; }

    function tokenize(s) { return (s || '').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean); }
    function jaccard(a, b) { const A = new Set(a); const B = new Set(b); const inter = [...A].filter(x => B.has(x)).length; const uni = new Set([...A, ...B]).size; return uni === 0 ? 0 : inter / uni; }

    // Pairwise comparison
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const a = items[i];
        const b = items[j];

        // Exact normalized match -> definitely same cluster
        if (a.normalized && b.normalized && a.normalized === b.normalized) {
          union(i, j);
          continue;
        }

        const sameHost = a.hostname && b.hostname && a.hostname === b.hostname;
        const tokensA = tokenize(a.title + ' ' + a.path);
        const tokensB = tokenize(b.title + ' ' + b.path);
        const titleSim = jaccard(tokensA, tokensB);

        const pathSegA = a.path.split('/').filter(Boolean);
        const pathSegB = b.path.split('/').filter(Boolean);
        const pathInter = pathSegA.filter(s => pathSegB.includes(s)).length;
        const maxSeg = Math.max(pathSegA.length, pathSegB.length, 1);
        const pathSim = pathInter / maxSeg;

        if ((sameHost && (titleSim >= 0.5 || pathSim >= 0.6)) || titleSim >= 0.75) {
          union(i, j);
        }
      }
    }

    // Group items by their root parent
    const groupsMap = new Map();
    for (let i = 0; i < n; i++) {
      const root = find(i);
      if (!groupsMap.has(root)) groupsMap.set(root, []);
      groupsMap.get(root).push(items[i]);
    }

    // Only keep groups with more than one tab (true duplicates)
    const groups = [];
    for (const arr of groupsMap.values()) {
      if (arr.length > 1) {
        // sort so active tab (if present) appears first, then stable ordering
        arr.sort((x, y) => {
          if (x.isActive && !y.isActive) return -1;
          if (!x.isActive && y.isActive) return 1;
          return 0;
        });

        groups.push({ items: arr, key: arr[0].normalized || arr[0].hostname || '' });
      }
    }

    return { success: true, duplicates: groups, totalTabs: tabs.length, message: `Found ${groups.length} duplicate group(s)` };
  } catch (error) {
    console.error('Error fetching duplicates:', error);
    return { success: false, duplicates: [], message: `Error: ${error.message}` };
  }
}

// Remove specific tabs by their IDs
async function removeDuplicatesByIds(tabIds) {
  try {
    if (!Array.isArray(tabIds) || tabIds.length === 0) {
      return {
        success: false,
        removedCount: 0,
        message: 'No tabs to remove'
      };
    }

    // Validate all IDs are valid numbers
    const validIds = tabIds.filter(id => typeof id === 'number' && id > 0);

    if (validIds.length === 0) {
      return {
        success: false,
        removedCount: 0,
        message: 'Invalid tab IDs'
      };
    }

    await chrome.tabs.remove(validIds);

    return {
      success: true,
      removedCount: validIds.length,
      message: `Removed ${validIds.length} duplicate tab(s)`
    };
  } catch (error) {
    console.error('Error removing duplicates:', error);
    return {
      success: false,
      removedCount: 0,
      message: `Error: ${error.message}`
    };
  }
}

// Listen for popup request
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'removeDuplicates') {
    removeDuplicateTabs().then(result => {
      sendResponse(result);
    });
    return true; // Keep channel open for async response
  }
});

// Listen for keyboard shortcut command
chrome.commands.onCommand.addListener((command) => {
  if (command === 'remove-duplicates') {
    // Open the panel window so user sees the confirmation modal (no default_popup present)
    const url = chrome.runtime.getURL('popup.html');
    chrome.windows.create({ url, type: 'popup', width: 720, height: 820 }).catch(err => console.error(err));
  }
});

// When the toolbar icon is clicked, open a large panel window (like LastPass)
chrome.action.onClicked.addListener(() => {
  const url = chrome.runtime.getURL('popup.html');
  const width = 720;
  const height = 820;
  chrome.windows.create({ url, type: 'popup', width, height }).catch(e => {
    console.error('Failed to open panel from action.onClicked', e);
  });
});

// ============ Session Management Features ============

// Save current tabs as a named session
async function saveSession(sessionName) {
  try {
    const tabs = await chrome.tabs.query({});
    
    const tabUrls = tabs
      .filter(tab => tab.url && !tab.url.startsWith('chrome://') && !tab.url.startsWith('edge://') && !tab.url.startsWith('about:'))
      .map(tab => ({ url: tab.url, title: tab.title }));

    if (tabUrls.length === 0) {
      return { success: false, message: 'No tabs to save' };
    }

    // Get existing sessions from storage
    const result = await chrome.storage.local.get('sessions');
    const sessions = result.sessions || {};

    // Add new session with timestamp
    sessions[sessionName] = {
      tabs: tabUrls,
      savedAt: new Date().toISOString(),
      tabCount: tabUrls.length
    };

    // Save back to storage
    await chrome.storage.local.set({ sessions });

    return {
      success: true,
      message: `Session "${sessionName}" saved with ${tabUrls.length} tab(s)`
    };
  } catch (error) {
    return { success: false, message: `Error saving session: ${error.message}` };
  }
}

// Get all saved sessions
async function getSessions() {
  try {
    const result = await chrome.storage.local.get('sessions');
    const sessions = result.sessions || {};
    return {
      success: true,
      sessions: sessions
    };
  } catch (error) {
    return { success: false, message: `Error retrieving sessions: ${error.message}` };
  }
}

// Restore/merge tabs from a saved session
async function restoreSession(sessionName) {
  try {
    const result = await chrome.storage.local.get('sessions');
    const sessions = result.sessions || {};

    if (!sessions[sessionName]) {
      return { success: false, message: `Session "${sessionName}" not found` };
    }

    const session = sessions[sessionName];
    const tabs = session.tabs;
    let openedCount = 0;

    // Open each tab URL
    for (const tab of tabs) {
      try {
        await chrome.tabs.create({ url: tab.url, active: false });
        openedCount++;
      } catch (e) {
        console.error(`Failed to open tab: ${tab.url}`, e);
      }
    }

    return {
      success: true,
      message: `Restored ${openedCount} tab(s) from "${sessionName}"`,
      openedCount: openedCount
    };
  } catch (error) {
    return { success: false, message: `Error restoring session: ${error.message}` };
  }
}

// Delete a saved session
async function deleteSession(sessionName) {
  try {
    const result = await chrome.storage.local.get('sessions');
    const sessions = result.sessions || {};

    if (!sessions[sessionName]) {
      return { success: false, message: `Session "${sessionName}" not found` };
    }

    delete sessions[sessionName];
    await chrome.storage.local.set({ sessions });

    return { success: true, message: `Session "${sessionName}" deleted` };
  } catch (error) {
    return { success: false, message: `Error deleting session: ${error.message}` };
  }
}

// ============ Lists (lightweight saved lists) ============
// Save grouped lists to chrome.storage.local and optionally close tabs
async function saveLists(groups, heuristic, closeTabs) {
  try {
    const result = await chrome.storage.local.get('lists');
    const lists = result.lists || {};

    const created = [];
    const now = new Date().toISOString();

    for (let i = 0; i < (groups || []).length; i++) {
      const g = groups[i];
      const key = g && g.key ? String(g.key) : `group-${i+1}`;
      // sanitize short key for display
      const shortKey = key.replace(/[^a-zA-Z0-9 _.-]/g, '').slice(0, 60) || `group-${i+1}`;
      let baseName = `${heuristic}-${shortKey}`.slice(0, 80);
      let name = baseName;
      let attempt = 1;
      while (lists[name]) { name = `${baseName}-${attempt++}`; }

      const tabs = (g.items || []).map(it => ({ url: it.url, title: it.title || '' }));

      lists[name] = {
        tabs: tabs,
        savedAt: now,
        tabCount: tabs.length,
        heuristic: heuristic,
        key: key
      };
      created.push(name);
    }

    await chrome.storage.local.set({ lists });

    // Optionally close tabs (exclude active tab(s))
    if (closeTabs) {
      try {
        const activeTabs = await chrome.tabs.query({ active: true });
        const activeIds = new Set((activeTabs || []).map(t => t.id));

        let toClose = [];
        for (const g of (groups || [])) {
          for (const it of (g.items || [])) {
            const id = Number(it.id);
            if (!Number.isInteger(id)) continue;
            if (!activeIds.has(id)) toClose.push(id);
          }
        }

        toClose = Array.from(new Set(toClose)).filter(Boolean);
        if (toClose.length > 0) {
          await chrome.tabs.remove(toClose);
        }
      } catch (err) {
        console.error('Error closing tabs after saveLists:', err);
      }
    }

    return { success: true, message: `Saved ${created.length} list(s)`, createdCount: created.length, created };
  } catch (error) {
    console.error('saveLists error:', error);
    return { success: false, message: `Error saving lists: ${error.message}` };
  }
}

// Get all saved lists
async function getLists() {
  try {
    const result = await chrome.storage.local.get('lists');
    const lists = result.lists || {};
    return { success: true, lists };
  } catch (error) {
    return { success: false, message: `Error retrieving lists: ${error.message}` };
  }
}

// Restore a saved list (open all URLs)
async function restoreList(listName) {
  try {
    const result = await chrome.storage.local.get('lists');
    const lists = result.lists || {};

    if (!lists[listName]) {
      return { success: false, message: `List "${listName}" not found` };
    }

    const list = lists[listName];
    const tabs = list.tabs || [];
    let openedCount = 0;
    for (const t of tabs) {
      try { await chrome.tabs.create({ url: t.url, active: false }); openedCount++; } catch (e) { console.error('Failed to open URL', t.url, e); }
    }

    return { success: true, message: `Restored ${openedCount} item(s) from "${listName}"`, openedCount };
  } catch (error) {
    return { success: false, message: `Error restoring list: ${error.message}` };
  }
}

// Delete a saved list
async function deleteList(listName) {
  try {
    const result = await chrome.storage.local.get('lists');
    const lists = result.lists || {};
    if (!lists[listName]) return { success: false, message: `List "${listName}" not found` };
    delete lists[listName];
    await chrome.storage.local.set({ lists });
    return { success: true, message: `List "${listName}" deleted` };
  } catch (error) {
    return { success: false, message: `Error deleting list: ${error.message}` };
  }
}

// Handle all extension messages
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'removeDuplicates') {
    removeDuplicateTabs().then(result => {
      sendResponse(result);
    });
    return true;
  }
  
  if (request.action === 'saveSession') {
    saveSession(request.sessionName).then(result => {
      sendResponse(result);
    });
    return true;
  }
  
  if (request.action === 'getSessions') {
    getSessions().then(result => {
      sendResponse(result);
    });
    return true;
  }
  
  if (request.action === 'restoreSession') {
    restoreSession(request.sessionName).then(result => {
      sendResponse(result);
    });
    return true;
  }
  
  if (request.action === 'deleteSession') {
    deleteSession(request.sessionName).then(result => {
      sendResponse(result);
    });
    return true;
  }

  if (request.action === 'fetchDuplicates') {
    fetchDuplicateTabs().then(result => {
      sendResponse(result);
    });
    return true;
  }

  if (request.action === 'removeDuplicatesByIds') {
    removeDuplicatesByIds(request.tabIds).then(result => {
      sendResponse(result);
    });
    return true;
  }

  if (request.action === 'saveLists') {
    saveLists(request.groups, request.heuristic, request.closeTabs).then(result => {
      sendResponse(result);
    });
    return true;
  }

  if (request.action === 'getLists') {
    getLists().then(result => {
      sendResponse(result);
    });
    return true;
  }

  if (request.action === 'restoreList') {
    restoreList(request.listName).then(result => {
      sendResponse(result);
    });
    return true;
  }

  if (request.action === 'deleteList') {
    deleteList(request.listName).then(result => {
      sendResponse(result);
    });
    return true;
  }
  
  // Open a standalone popup window (panel) with the popup HTML - useful to bypass toolbar popup size limits
  if (request.action === 'openPanelWindow') {
    (async () => {
      try {
        const url = chrome.runtime.getURL('popup.html');
        // default panel size - adjust as needed
        const width = 720;
        const height = 820;

        // Create a popup-type window that can be sized larger than toolbar popup
        await chrome.windows.create({ url, type: 'popup', width, height });
        sendResponse({ success: true, message: 'Panel opened' });
      } catch (e) {
        console.error('Error opening panel window', e);
        sendResponse({ success: false, message: e.message });
      }
    })();
    return true;
  }
});
