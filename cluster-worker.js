// Worker for clustering duplicate tabs using heuristics
// Receives: { type: 'cluster', tabs: [...], thresholds: {...}, normalizeMode?: 'ignoreQueryParams' }

function normalizeUrl(url, mode = 'ignoreQueryParams', paramWhitelist = []) {
  try {
    const urlObj = new URL(url);
    switch (mode) {
      case 'exact':
        return url.toLowerCase();

      case 'ignoreFragment':
        return (urlObj.origin + urlObj.pathname + urlObj.search).toLowerCase();

      case 'ignoreQueryParams':
      case 'ignoreAll':
        // If a whitelist of query param names is provided, retain only those params (in sorted order)
        if (Array.isArray(paramWhitelist) && paramWhitelist.length > 0) {
          const names = Array.from(new Set(paramWhitelist.map(n => (n || '').toString().toLowerCase().trim()))).filter(Boolean);
          if (names.length === 0) return (urlObj.origin + urlObj.pathname).toLowerCase();
          const pairs = [];
          names.sort();
          for (const name of names) {
            if (!urlObj.searchParams.has(name)) continue;
            const vals = urlObj.searchParams.getAll(name);
            for (const v of vals) {
              pairs.push(`${encodeURIComponent(name)}=${encodeURIComponent(v)}`);
            }
          }
          const search = pairs.length ? `?${pairs.join('&')}` : '';
          return (urlObj.origin + urlObj.pathname + search).toLowerCase();
        }
        return (urlObj.origin + urlObj.pathname).toLowerCase();

      default:
        return url.toLowerCase();
    }
  } catch (e) {
    return url.toLowerCase();
  }
}

function tokenize(s) { return (s || '').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean); }
function jaccard(a, b) { const A = new Set(a); const B = new Set(b); const inter = [...A].filter(x => B.has(x)).length; const uni = new Set([...A, ...B]).size; return uni === 0 ? 0 : inter / uni; }

self.onmessage = (e) => {
  const data = e.data;
  if (!data || data.type !== 'cluster') return;

  try {
    const tabs = (data.tabs || []).filter(t => t && t.url && !t.url.startsWith('chrome://') && !t.url.startsWith('edge://') && !t.url.startsWith('about:'));
    const thresholds = data.thresholds || { titleHigh:0.75, titleMedium:0.5, path:0.6 };
    const normalizeMode = data.normalizeMode || 'ignoreQueryParams';

    const items = tabs.map(tab => {
      let norm = normalizeUrl(tab.url, normalizeMode);
      let urlObj;
      try { urlObj = new URL(tab.url); } catch (e) { urlObj = null; }
      const hostname = urlObj ? urlObj.hostname : '';
      const path = urlObj ? urlObj.pathname : '';
      return { id: tab.id, url: tab.url, title: tab.title || '', faviconUrl: tab.favIconUrl || '', normalized: norm, hostname, path, isActive: !!tab.active };
    });

    // Union-find clustering
    const n = items.length;
    const parent = Array.from({ length: n }, (_, i) => i);
    function find(x) { return parent[x] === x ? x : (parent[x] = find(parent[x])); }
    function union(a, b) { const ra = find(a); const rb = find(b); if (ra !== rb) parent[rb] = ra; }

    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const a = items[i];
        const b = items[j];
        if (!a || !b) continue;

        if (a.normalized && b.normalized && a.normalized === b.normalized) { union(i,j); continue; }

        const sameHost = a.hostname && b.hostname && a.hostname === b.hostname;
        const tokensA = tokenize(a.title + ' ' + a.path);
        const tokensB = tokenize(b.title + ' ' + b.path);
        const titleSim = jaccard(tokensA, tokensB);

        const pathSegA = a.path.split('/').filter(Boolean);
        const pathSegB = b.path.split('/').filter(Boolean);
        const pathInter = pathSegA.filter(s => pathSegB.includes(s)).length;
        const maxSeg = Math.max(pathSegA.length, pathSegB.length, 1);
        const pathSim = pathInter / maxSeg;

        if ((sameHost && (titleSim >= thresholds.titleMedium || pathSim >= thresholds.path)) || titleSim >= thresholds.titleHigh) {
          union(i, j);
        }
      }
    }

    const groupsMap = new Map();
    for (let i = 0; i < n; i++) {
      const root = find(i);
      if (!groupsMap.has(root)) groupsMap.set(root, []);
      groupsMap.get(root).push(items[i]);
    }

    const groups = [];
    for (const arr of groupsMap.values()) {
      if (arr.length > 1) {
        arr.sort((x,y) => { if (x.isActive && !y.isActive) return -1; if (!x.isActive && y.isActive) return 1; return 0; });

        // compute similarity scores relative to representative (first item)
        const rep = arr[0];
        for (const it of arr) {
          // normalized equality
          it.normalizedEqual = !!(rep.normalized && it.normalized && rep.normalized === it.normalized);

          const tokensRep = tokenize(rep.title + ' ' + rep.path);
          const tokensIt = tokenize(it.title + ' ' + it.path);
          it.titleSim = Math.round(jaccard(tokensRep, tokensIt) * 100) / 100; // two decimals

          const pathSegRep = rep.path.split('/').filter(Boolean);
          const pathSegIt = it.path.split('/').filter(Boolean);
          const pathInter = pathSegRep.filter(s => pathSegIt.includes(s)).length;
          const maxSeg2 = Math.max(pathSegRep.length, pathSegIt.length, 1);
          it.pathSim = Math.round((pathInter / maxSeg2) * 100) / 100;
        }

        groups.push({ items: arr, key: arr[0].normalized || arr[0].hostname || '' });
      }
    }

    self.postMessage({ success: true, groups });
  } catch (err) {
    self.postMessage({ success: false, message: err && err.message ? err.message : String(err) });
  }
};
