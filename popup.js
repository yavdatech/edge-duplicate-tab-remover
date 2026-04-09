// ============ Tab Navigation ============
document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        const tabName = btn.dataset.tab;
        
        // Hide all tabs
        document.querySelectorAll('.tab-content').forEach(tab => {
            tab.classList.remove('active');
        });
        
        // Remove active from all buttons
        document.querySelectorAll('.tab-btn').forEach(b => {
            b.classList.remove('active');
        });
        
        // Show selected tab
        document.getElementById(tabName).classList.add('active');
        btn.classList.add('active');
        
        // Load sessions if Sessions tab
        if (tabName === 'sessions') {
            loadSessions();
            try { loadLists(); } catch (e) { /* ignore if function not ready yet */ }
        }
    });
});

// ============ Cleanup Tab ============

// Search and tab activation features
let allOpenTabs = [];
const tabSearchInput = document.getElementById('tabSearch');
const tabSearchResults = document.getElementById('tabSearchResults');
const sensitivitySelect = document.getElementById('sensitivitySelect');
const queryWhitelistInput = document.getElementById('queryWhitelistInput');

// Initialize sensitivity select from storage
if (sensitivitySelect) {
    (async () => {
        try {
            const val = await new Promise(res => {
                if (!chrome.storage || !chrome.storage.local) return res('balanced');
                chrome.storage.local.get(['sensitivity'], (obj) => { res((obj && obj.sensitivity) ? obj.sensitivity : 'balanced'); });
            });
            sensitivitySelect.value = val || 'balanced';
        } catch (e) { sensitivitySelect.value = 'balanced'; }
    })();

    sensitivitySelect.addEventListener('change', (e) => {
        const v = e.target.value;
        try { if (chrome.storage && chrome.storage.local) chrome.storage.local.set({ sensitivity: v }); } catch (e) { /* ignore */ }
    });
}
// Initialize query whitelist from storage
if (queryWhitelistInput) {
    (async () => {
        try {
            const val = await new Promise(res => {
                if (!chrome.storage || !chrome.storage.local) return res('');
                chrome.storage.local.get(['queryParamWhitelist'], (obj) => { res((obj && obj.queryParamWhitelist) ? obj.queryParamWhitelist : ''); });
            });
            queryWhitelistInput.value = val || '';
        } catch (e) { queryWhitelistInput.value = ''; }
    })();

    queryWhitelistInput.addEventListener('change', (e) => {
        const v = e.target.value || '';
        try { if (chrome.storage && chrome.storage.local) chrome.storage.local.set({ queryParamWhitelist: v }); } catch (e) { /* ignore */ }
    });
}

// Debounce helper
function debounce(fn, delay = 200) {
    let t;
    return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), delay); };
}

async function refreshOpenTabs() {
    try {
        const tabs = await chrome.tabs.query({});
        // filter out special/internal tabs
        allOpenTabs = tabs.filter(t => t.url && !t.url.startsWith('chrome://') && !t.url.startsWith('edge://') && !t.url.startsWith('about:'));
        renderTabSearchResults(allOpenTabs);
    } catch (e) {
        tabSearchResults.innerHTML = `<p class="empty-message">Failed to list tabs: ${e.message}</p>`;
    }
}

function renderTabSearchResults(tabs) {
    if (!tabs || tabs.length === 0) {
        tabSearchResults.innerHTML = '<p class="empty-message">No tabs found.</p>';
        return;
    }

    tabSearchResults.innerHTML = '';

    tabs.forEach(t => {
        const item = document.createElement('div');
        item.className = 'tab-item';

        const fav = document.createElement('div');
        fav.className = 'tab-favicon';
        if (t.favIconUrl) {
            const img = document.createElement('img');
            img.src = t.favIconUrl;
            img.onerror = () => { img.style.display = 'none'; };
            fav.appendChild(img);
        } else {
            fav.textContent = '📄';
        }

        const meta = document.createElement('div');
        meta.className = 'tab-meta';
        const title = document.createElement('div');
        title.className = 'tab-title';
        title.textContent = t.title || 'Untitled';
        const url = document.createElement('div');
        url.className = 'tab-url';
        url.textContent = t.url;
        meta.appendChild(title);
        meta.appendChild(url);

        const actions = document.createElement('div');
        actions.className = 'tab-actions';

        const openBtn = document.createElement('button');
        openBtn.className = 'tab-btn-small tab-btn-activate';
        openBtn.textContent = 'Open';
        openBtn.addEventListener('click', async (e) => {
            e.stopPropagation();
            try {
                await chrome.tabs.update(t.id, { active: true });
                window.close();
            } catch (err) {
                console.error('Failed to activate tab', err);
            }
        });

        const closeBtn = document.createElement('button');
        closeBtn.className = 'tab-btn-small tab-btn-close';
        closeBtn.textContent = 'Close';
        closeBtn.addEventListener('click', async (e) => {
            e.stopPropagation();
            try {
                await chrome.tabs.remove(t.id);
                // remove from list instantly
                allOpenTabs = allOpenTabs.filter(x => x.id !== t.id);
                renderTabSearchResults(filterTabsByQuery(tabSearchInput.value || ''));
            } catch (err) {
                console.error('Failed to close tab', err);
            }
        });

        actions.appendChild(openBtn);
        actions.appendChild(closeBtn);

        // Overflow button for compact/toolbar mode — shows a small menu with actions
        const overflowBtn = document.createElement('button');
        overflowBtn.className = 'tab-btn-small overflow-btn';
        overflowBtn.type = 'button';
        overflowBtn.innerHTML = '⋯';
        overflowBtn.title = 'More actions';
        overflowBtn.addEventListener('click', (ev) => {
            ev.stopPropagation();
            // remove existing menus first
            document.querySelectorAll('.popup-menu').forEach(m => m.remove());

            const menu = document.createElement('div');
            menu.className = 'popup-menu';

            const openItem = document.createElement('button');
            openItem.className = 'menu-item';
            openItem.textContent = 'Open';
            openItem.addEventListener('click', (e) => { e.stopPropagation(); openBtn.click(); menu.remove(); });

            const closeItem = document.createElement('button');
            closeItem.className = 'menu-item';
            closeItem.textContent = 'Close';
            closeItem.addEventListener('click', (e) => { e.stopPropagation(); closeBtn.click(); menu.remove(); });

            menu.appendChild(openItem);
            menu.appendChild(closeItem);

            actions.appendChild(menu);

            // Close menu when clicking outside
            setTimeout(() => {
                const onDocClick = (evt) => {
                    if (!menu.contains(evt.target) && evt.target !== overflowBtn) {
                        menu.remove();
                        document.removeEventListener('click', onDocClick);
                    }
                };
                document.addEventListener('click', onDocClick);
            }, 0);
        });

        actions.appendChild(overflowBtn);

        item.appendChild(fav);
        item.appendChild(meta);
        item.appendChild(actions);

        // clicking row activates tab
        item.addEventListener('click', async () => {
            try {
                await chrome.tabs.update(t.id, { active: true });
                window.close();
            } catch (err) { console.error(err); }
        });

        tabSearchResults.appendChild(item);
    });

        // After rendering, update compact mode to toggle overflow buttons if needed
        try { updateCompactMode(); } catch (e) { /* ignore */ }
}

function filterTabsByQuery(query) {
    const q = (query || '').trim().toLowerCase();
    if (!q) return allOpenTabs.slice();
    return allOpenTabs.filter(t => {
        return (t.title && t.title.toLowerCase().includes(q)) || (t.url && t.url.toLowerCase().includes(q));
    });
}

const debouncedSearch = debounce((e) => {
    const q = e.target.value || '';
    const filtered = filterTabsByQuery(q);
    renderTabSearchResults(filtered);
}, 180);

if (tabSearchInput) {
    tabSearchInput.addEventListener('input', debouncedSearch);
    tabSearchInput.addEventListener('focus', () => { if (!allOpenTabs.length) refreshOpenTabs(); });
}

// initialize tab list on load
document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') refreshOpenTabs();
});

// refresh immediately
refreshOpenTabs();

// Open full panel window (like LastPass)
const openPanelBtn = document.getElementById('openPanelBtn');
if (openPanelBtn) {
    openPanelBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        try {
            await chrome.runtime.sendMessage({ action: 'openPanelWindow' });
            // close the toolbar popup so the new window is visible
            window.close();
        } catch (err) {
            console.error('Failed to open panel window', err);
        }
    });
}

// Modal state management
let currentDuplicates = [];
let selectedDuplicateIds = new Set();

document.getElementById('removeBtn').addEventListener('click', showDuplicatesConfirmation);

// Show confirmation modal with list of duplicates
async function showDuplicatesConfirmation() {
    const removeBtn = document.getElementById('removeBtn');
    removeBtn.disabled = true;
    removeBtn.innerHTML = '<span class="btn-icon">⏳</span><span>Scanning...</span>';

    try {
        // Get open tabs in the popup context (permissions exist) and run clustering in a WebWorker
        const tabs = await chrome.tabs.query({});
        const candidates = tabs.filter(t => t.url && !t.url.startsWith('chrome://') && !t.url.startsWith('edge://') && !t.url.startsWith('about:'));

        if (!candidates || candidates.length === 0) {
            showResult('info', 'No tabs found', '');
            resetRemoveButton();
            return;
        }

        // get sensitivity preset from storage
        const preset = await (async () => {
            try {
                return await new Promise(res => {
                    if (!chrome.storage || !chrome.storage.local) return res('balanced');
                    chrome.storage.local.get(['sensitivity'], (obj) => { res((obj && obj.sensitivity) ? obj.sensitivity : 'balanced'); });
                });
            } catch (e) { return 'balanced'; }
        })();

        const PRESETS = {
            conservative: { titleHigh: 0.90, titleMedium: 0.75, path: 0.75 },
            balanced: { titleHigh: 0.75, titleMedium: 0.50, path: 0.60 },
            aggressive: { titleHigh: 0.65, titleMedium: 0.40, path: 0.45 }
        };

        const thresholds = PRESETS[preset] || PRESETS.balanced;

        // Spawn worker (worker script path relative to popup.html)
        const worker = new Worker('cluster-worker.js');

        const result = await new Promise((resolve) => {
            const timeout = setTimeout(() => {
                worker.terminate();
                resolve({ success: false, message: 'Clustering timed out' });
            }, 15000);

            worker.onmessage = (ev) => {
                clearTimeout(timeout);
                resolve(ev.data);
            };
            worker.onerror = (err) => {
                clearTimeout(timeout);
                resolve({ success: false, message: err && err.message ? err.message : String(err) });
            };

            // parse whitelist into array
            const raw = (queryWhitelistInput && queryWhitelistInput.value) ? queryWhitelistInput.value : '';
            const qp = raw.split(',').map(s => s.trim().toLowerCase()).filter(Boolean);

            // Send tabs and thresholds to worker
            worker.postMessage({ type: 'cluster', tabs: candidates, thresholds, normalizeMode: 'ignoreQueryParams', queryParams: qp });
        });

        if (result.success && result.groups && result.groups.length > 0) {
            currentDuplicates = result.groups;
            selectedDuplicateIds.clear();
            renderDuplicatesModal();
            openModal();
        } else {
            showResult('info', 'No duplicate tabs found', result.message || '');
            resetRemoveButton();
        }
    } catch (error) {
        showResult('error', 'Error scanning duplicates', error.message);
        resetRemoveButton();
    }
}

// Render duplicate list in modal
function renderDuplicatesModal() {
    const duplicateList = document.querySelector('.duplicate-list');
    duplicateList.innerHTML = '';

    // currentDuplicates is now an array of groups { key, items: [...] }
    const totalGroups = currentDuplicates.length;
    const totalTabs = currentDuplicates.reduce((sum, g) => sum + (g.items ? g.items.length : 0), 0);
    const duplicateTabs = totalTabs - totalGroups;

    // Update duplicate count info
    document.getElementById('duplicateCount').textContent =
        `Found ${totalGroups} duplicate group(s) involving ${totalTabs} tab(s) — ${duplicateTabs} duplicate(s). Select which ones to remove:`;

    // Build UI per group
    currentDuplicates.forEach((group, groupIndex) => {
        const groupDiv = document.createElement('div');
        groupDiv.className = 'duplicate-group';

        const header = document.createElement('div');
        header.className = 'group-header';

        const groupFavicon = document.createElement('div');
        groupFavicon.className = 'duplicate-tab-favicon';
        const rep = group.items[0];
        if (rep && rep.faviconUrl) {
            const img = document.createElement('img');
            img.src = rep.faviconUrl;
            img.onerror = () => { img.style.display = 'none'; };
            groupFavicon.appendChild(img);
        } else {
            groupFavicon.textContent = '📄';
        }

        const titleWrap = document.createElement('div');
        titleWrap.className = 'group-title-wrap';
        const titleEl = document.createElement('div');
        titleEl.className = 'group-title';
        titleEl.textContent = rep && rep.title ? rep.title : (rep && rep.url ? rep.url : 'Duplicate group');

        const countEl = document.createElement('div');
        countEl.className = 'group-count';
        countEl.textContent = `${group.items.length} page(s)`;

        // Expand/collapse toggle
        const toggleBtn = document.createElement('button');
        toggleBtn.type = 'button';
        toggleBtn.className = 'group-toggle';
        toggleBtn.textContent = `Show ${group.items.length} page(s)`;

        header.appendChild(groupFavicon);
        titleWrap.appendChild(titleEl);
        header.appendChild(titleWrap);
        header.appendChild(countEl);
        header.appendChild(toggleBtn);

        groupDiv.appendChild(header);

        const details = document.createElement('div');
        details.className = 'group-details hidden';
        // list individual tabs
        group.items.forEach((tabItem, idx) => {
            const itemDiv = document.createElement('div');
            itemDiv.className = 'duplicate-item duplicate-row';

            const checkbox = document.createElement('input');
            checkbox.type = 'checkbox';
            checkbox.value = tabItem.id;
            // never allow active tab to be selected for removal
            if (tabItem.isActive) {
                checkbox.checked = false;
                checkbox.disabled = true;
            } else {
                // default: keep first item (representative), select others for removal
                checkbox.checked = idx !== 0;
                if (checkbox.checked) selectedDuplicateIds.add(parseInt(tabItem.id, 10));
            }

            checkbox.addEventListener('change', (e) => {
                const id = parseInt(tabItem.id, 10);
                if (e.target.checked) selectedDuplicateIds.add(id);
                else selectedDuplicateIds.delete(id);
                updateSelectAllCheckbox();
            });

            const faviconDiv = document.createElement('div');
            faviconDiv.className = 'duplicate-tab-favicon';
            if (tabItem.faviconUrl) {
                const img = document.createElement('img');
                img.src = tabItem.faviconUrl;
                img.onerror = () => { img.style.display = 'none'; };
                faviconDiv.appendChild(img);
            } else {
                faviconDiv.textContent = '📄';
            }

            const infoDiv = document.createElement('div');
            infoDiv.className = 'duplicate-tab-info';
            const titleP = document.createElement('p');
            titleP.className = 'duplicate-tab-title';
            titleP.textContent = tabItem.title || 'Untitled';
            const urlP = document.createElement('p');
            urlP.className = 'duplicate-tab-url';
            urlP.textContent = tabItem.url;

            // similarity scores (if provided by worker)
            if (typeof tabItem.titleSim === 'number' || typeof tabItem.pathSim === 'number' || tabItem.normalizedEqual) {
                const simDiv = document.createElement('div');
                simDiv.className = 'duplicate-similarity';
                const parts = [];
                if (tabItem.normalizedEqual) parts.push('normalized match');
                if (typeof tabItem.titleSim === 'number') parts.push(`title: ${tabItem.titleSim}`);
                if (typeof tabItem.pathSim === 'number') parts.push(`path: ${tabItem.pathSim}`);
                simDiv.textContent = parts.join(' • ');
                infoDiv.appendChild(simDiv);
            }

            infoDiv.appendChild(titleP);
            infoDiv.appendChild(urlP);

            itemDiv.appendChild(checkbox);
            itemDiv.appendChild(faviconDiv);
            itemDiv.appendChild(infoDiv);

            details.appendChild(itemDiv);
        });

        // Toggle behavior
        toggleBtn.addEventListener('click', () => {
            const hidden = details.classList.toggle('hidden');
            toggleBtn.textContent = hidden ? `Show ${group.items.length} page(s)` : 'Hide pages';
        });

        groupDiv.appendChild(details);
        duplicateList.appendChild(groupDiv);
    });

    // Reset Select All checkbox
    document.getElementById('selectAllCheckbox').checked = false;
}

// Open modal
function openModal() {
    document.getElementById('confirmationModal').style.display = 'flex';
    // allow layout to settle then attempt auto-resize for standalone panel windows
    setTimeout(() => { try { updateCompactMode(); debouncedAutoResize(); } catch (e) {} }, 80);
}

// Close modal
function closeModal() {
    document.getElementById('confirmationModal').style.display = 'none';
    selectedDuplicateIds.clear();
    currentDuplicates = [];
    resetRemoveButton();
    // resize back to content after closing modal
    setTimeout(() => { try { updateCompactMode(); debouncedAutoResize(); } catch (e) {} }, 80);
}

// Update Select All checkbox state
function updateSelectAllCheckbox() {
    const checkboxes = document.querySelectorAll('.duplicate-item input[type="checkbox"]');
    const allChecked = Array.from(checkboxes).every(cb => cb.checked);
    const someChecked = Array.from(checkboxes).some(cb => cb.checked);

    const selectAllCheckbox = document.getElementById('selectAllCheckbox');
    selectAllCheckbox.checked = allChecked;
    selectAllCheckbox.indeterminate = someChecked && !allChecked;
}

// Toggle all duplicates
document.getElementById('selectAllCheckbox').addEventListener('change', (e) => {
    const isChecked = e.target.checked;
    document.querySelectorAll('.duplicate-item input[type="checkbox"]').forEach(checkbox => {
        checkbox.checked = isChecked;
        if (isChecked) {
            selectedDuplicateIds.add(parseInt(checkbox.value));
        } else {
            selectedDuplicateIds.delete(parseInt(checkbox.value));
        }
    });
});

// Confirm removal button
document.getElementById('confirmRemoveBtn').addEventListener('click', async () => {
    if (selectedDuplicateIds.size === 0) {
        alert('Please select at least one tab to remove');
        return;
    }

    await performRemoval(Array.from(selectedDuplicateIds));
});

// Cancel button
document.getElementById('cancelRemoveBtn').addEventListener('click', closeModal);

// Modal close (×) button
document.querySelector('.modal-close').addEventListener('click', closeModal);

// Close modal on Escape key
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && document.getElementById('confirmationModal').style.display === 'flex') {
        closeModal();
    }
});

// Perform actual removal of selected tabs
async function performRemoval(tabIds) {
    const confirmBtn = document.getElementById('confirmRemoveBtn');
    const cancelBtn = document.getElementById('cancelRemoveBtn');

    confirmBtn.disabled = true;
    cancelBtn.disabled = true;
    confirmBtn.innerHTML = '<span class="btn-icon">⏳</span><span>Removing...</span>';

    try {
        const response = await chrome.runtime.sendMessage({
            action: 'removeDuplicatesByIds',
            tabIds: tabIds
        });

        closeModal();

        if (response.success) {
            showResult('success',
                `Removed ${response.removedCount} duplicate tab(s)`,
                '');
        } else {
            showResult('error', 'Error removing tabs', response.message);
        }
    } catch (error) {
        showResult('error', 'Error occurred', error.message);
        closeModal();
    } finally {
        confirmBtn.disabled = false;
        cancelBtn.disabled = false;
        confirmBtn.innerHTML = '<span class="btn-icon">✓</span><span>Remove Selected</span>';
    }
}

// Reset remove button to original state
function resetRemoveButton() {
    const removeBtn = document.getElementById('removeBtn');
    removeBtn.disabled = false;
    removeBtn.innerHTML = '<span class="btn-icon">🧹</span><span>Remove Duplicates</span>';
}

// Show result message
function showResult(type, message, details) {
    const resultDiv = document.getElementById('result');
    const resultMessage = document.getElementById('resultMessage');
    const resultDetails = document.getElementById('resultDetails');

    resultDiv.style.display = 'block';
    resultDiv.className = `result-container ${type}`;
    resultMessage.textContent = message;
    resultDetails.textContent = details;

    // Auto-hide after 5 seconds
    setTimeout(() => {
        resultDiv.style.display = 'none';
    }, 5000);
}

// ============ Sessions Tab ============

// Save session
document.getElementById('saveSessionBtn').addEventListener('click', async () => {
    const sessionName = document.getElementById('sessionName').value.trim();
    const saveBtn = document.getElementById('saveSessionBtn');
    const resultDiv = document.getElementById('sessionResult');
    const resultMessage = document.getElementById('sessionResultMessage');

    if (!sessionName) {
        resultDiv.style.display = 'block';
        resultDiv.className = 'result-container error';
        resultMessage.textContent = 'Please enter a session name';
        return;
    }

    saveBtn.disabled = true;
    saveBtn.innerHTML = '<span class="btn-icon">⏳</span><span>Saving...</span>';

    try {
        const response = await chrome.runtime.sendMessage({
            action: 'saveSession',
            sessionName: sessionName
        });

        resultDiv.style.display = 'block';
        
        if (response.success) {
            resultDiv.className = 'result-container success';
            resultMessage.textContent = response.message;
            document.getElementById('sessionName').value = '';
            
            // Reload sessions list
            setTimeout(() => {
                loadSessions();
            }, 500);
        } else {
            resultDiv.className = 'result-container error';
            resultMessage.textContent = response.message;
        }

        // Reset button
        setTimeout(() => {
            saveBtn.disabled = false;
            saveBtn.innerHTML = '<span class="btn-icon">💾</span><span>Save</span>';
        }, 1500);

    } catch (error) {
        resultDiv.style.display = 'block';
        resultDiv.className = 'result-container error';
        resultMessage.textContent = `Error: ${error.message}`;

        saveBtn.disabled = false;
        saveBtn.innerHTML = '<span class="btn-icon">💾</span><span>Save</span>';
    }
});

// Load and display sessions
async function loadSessions() {
    const sessionsList = document.getElementById('sessionsList');
    sessionsList.innerHTML = '<p class="loading">Loading sessions...</p>';

    try {
        const response = await chrome.runtime.sendMessage({ action: 'getSessions' });

        if (response.success) {
            const sessions = response.sessions;
            const sessionNames = Object.keys(sessions);

            if (sessionNames.length === 0) {
                sessionsList.innerHTML = '<p class="empty-message">No saved sessions. Create one to get started!</p>';
                return;
            }

            sessionsList.innerHTML = '';
            sessionNames.forEach(name => {
                const session = sessions[name];
                const savedDate = new Date(session.savedAt).toLocaleDateString('en-US', {
                    month: 'short',
                    day: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit'
                });

                const sessionItem = document.createElement('div');
                sessionItem.className = 'session-item';
                sessionItem.innerHTML = `
                    <div class="session-info">
                        <div class="session-name">${escapeHtml(name)}</div>
                        <div class="session-meta">${session.tabCount} tab(s) • ${savedDate}</div>
                    </div>
                    <div class="session-actions">
                        <button class="session-btn session-btn-restore" data-session="${escapeHtml(name)}">Restore</button>
                        <button class="session-btn session-btn-delete" data-session="${escapeHtml(name)}">Delete</button>
                    </div>
                `;

                // Restore button
                sessionItem.querySelector('.session-btn-restore').addEventListener('click', async () => {
                    await restoreSessionAction(name);
                });

                // Delete button
                sessionItem.querySelector('.session-btn-delete').addEventListener('click', async () => {
                    if (confirm(`Delete session "${name}"?`)) {
                        await deleteSessionAction(name);
                    }
                });

                sessionsList.appendChild(sessionItem);
            });
        } else {
            sessionsList.innerHTML = `<p class="empty-message">Error: ${response.message}</p>`;
        }
    } catch (error) {
        sessionsList.innerHTML = `<p class="empty-message">Error loading sessions: ${error.message}</p>`;
    }
}

// Restore session action
async function restoreSessionAction(sessionName) {
    try {
        const response = await chrome.runtime.sendMessage({
            action: 'restoreSession',
            sessionName: sessionName
        });

        const resultDiv = document.getElementById('sessionResult');
        const resultMessage = document.getElementById('sessionResultMessage');
        resultDiv.style.display = 'block';

        if (response.success) {
            resultDiv.className = 'result-container success';
            resultMessage.textContent = response.message;
        } else {
            resultDiv.className = 'result-container error';
            resultMessage.textContent = response.message;
        }
    } catch (error) {
        const resultDiv = document.getElementById('sessionResult');
        resultDiv.style.display = 'block';
        resultDiv.className = 'result-container error';
        document.getElementById('sessionResultMessage').textContent = `Error: ${error.message}`;
    }
}

// Delete session action
async function deleteSessionAction(sessionName) {
    try {
        const response = await chrome.runtime.sendMessage({
            action: 'deleteSession',
            sessionName: sessionName
        });

        const resultDiv = document.getElementById('sessionResult');
        const resultMessage = document.getElementById('sessionResultMessage');
        resultDiv.style.display = 'block';

        if (response.success) {
            resultDiv.className = 'result-container success';
            resultMessage.textContent = response.message;
            
            // Reload sessions list
            setTimeout(() => {
                loadSessions();
            }, 500);
        } else {
            resultDiv.className = 'result-container error';
            resultMessage.textContent = response.message;
        }
    } catch (error) {
        const resultDiv = document.getElementById('sessionResult');
        resultDiv.style.display = 'block';
        resultDiv.className = 'result-container error';
        document.getElementById('sessionResultMessage').textContent = `Error: ${error.message}`;
    }
}

// ------------ Lists (Convert tabs -> lists) -------------
// Load and display saved lists
async function loadLists() {
    const listsList = document.getElementById('listsList');
    if (!listsList) return;
    listsList.innerHTML = '<p class="loading">Loading lists...</p>';

    try {
        const response = await chrome.runtime.sendMessage({ action: 'getLists' });

        if (response.success) {
            const lists = response.lists || {};
            const listNames = Object.keys(lists);

            if (listNames.length === 0) {
                listsList.innerHTML = '<p class="empty-message">No saved lists. Convert tabs to lists to get started!</p>';
                return;
            }

            listsList.innerHTML = '';
            listNames.forEach(name => {
                const list = lists[name];
                const savedDate = new Date(list.savedAt).toLocaleDateString('en-US', {
                    month: 'short',
                    day: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit'
                });

                const item = document.createElement('div');
                item.className = 'session-item';
                item.innerHTML = `
                    <div class="session-info">
                        <div class="session-name">${escapeHtml(name)}</div>
                        <div class="session-meta">${list.tabCount} item(s) • ${savedDate}</div>
                    </div>
                    <div class="session-actions">
                        <button class="session-btn session-btn-restore" data-list="${escapeHtml(name)}">Restore</button>
                        <button class="session-btn session-btn-delete" data-list="${escapeHtml(name)}">Delete</button>
                    </div>
                `;

                item.querySelector('.session-btn-restore').addEventListener('click', async () => {
                    await restoreListAction(name);
                });

                item.querySelector('.session-btn-delete').addEventListener('click', async () => {
                    if (confirm(`Delete list "${name}"?`)) {
                        await deleteListAction(name);
                    }
                });

                listsList.appendChild(item);
            });
        } else {
            listsList.innerHTML = `<p class="empty-message">Error: ${response.message}</p>`;
        }
    } catch (error) {
        listsList.innerHTML = `<p class="empty-message">Error loading lists: ${error.message}</p>`;
    }
}

// Restore list action
async function restoreListAction(listName) {
    try {
        const response = await chrome.runtime.sendMessage({ action: 'restoreList', listName });

        const resultDiv = document.getElementById('sessionResult');
        const resultMessage = document.getElementById('sessionResultMessage');
        resultDiv.style.display = 'block';

        if (response.success) {
            resultDiv.className = 'result-container success';
            resultMessage.textContent = response.message;
        } else {
            resultDiv.className = 'result-container error';
            resultMessage.textContent = response.message;
        }
    } catch (error) {
        const resultDiv = document.getElementById('sessionResult');
        resultDiv.style.display = 'block';
        resultDiv.className = 'result-container error';
        document.getElementById('sessionResultMessage').textContent = `Error: ${error.message}`;
    }
}

// Delete list action
async function deleteListAction(listName) {
    try {
        const response = await chrome.runtime.sendMessage({ action: 'deleteList', listName });

        const resultDiv = document.getElementById('sessionResult');
        const resultMessage = document.getElementById('sessionResultMessage');
        resultDiv.style.display = 'block';

        if (response.success) {
            resultDiv.className = 'result-container success';
            resultMessage.textContent = response.message;
            setTimeout(() => { loadLists(); }, 500);
        } else {
            resultDiv.className = 'result-container error';
            resultMessage.textContent = response.message;
        }
    } catch (error) {
        const resultDiv = document.getElementById('sessionResult');
        resultDiv.style.display = 'block';
        resultDiv.className = 'result-container error';
        document.getElementById('sessionResultMessage').textContent = `Error: ${error.message}`;
    }
}

// Convert current open tabs into grouped lists and save
document.getElementById('convertListsBtn')?.addEventListener('click', async () => {
    const btn = document.getElementById('convertListsBtn');
    const heuristic = (document.getElementById('listsHeuristicSelect') && document.getElementById('listsHeuristicSelect').value) || 'domain';
    const closeTabs = !!(document.getElementById('closeTabsCheckbox') && document.getElementById('closeTabsCheckbox').checked);

    btn.disabled = true;
    const oldHtml = btn.innerHTML;
    btn.innerHTML = '<span class="btn-icon">⏳</span><span>Processing...</span>';

    try {
        const tabs = await chrome.tabs.query({});
        const candidates = tabs.filter(t => t.url && !t.url.startsWith('chrome://') && !t.url.startsWith('edge://') && !t.url.startsWith('about:'));

        if (!candidates || candidates.length === 0) {
            showResult('info', 'No tabs found', '');
            return;
        }

        let groups = [];

        if (heuristic === 'title') {
            // Use cluster worker for similarity-based grouping
            const PRESETS = {
                conservative: { titleHigh: 0.90, titleMedium: 0.75, path: 0.75 },
                balanced: { titleHigh: 0.75, titleMedium: 0.50, path: 0.60 },
                aggressive: { titleHigh: 0.65, titleMedium: 0.40, path: 0.45 }
            };

            const preset = (sensitivitySelect && sensitivitySelect.value) ? sensitivitySelect.value : 'balanced';
            const thresholds = PRESETS[preset] || PRESETS.balanced;

            const worker = new Worker('cluster-worker.js');
            const result = await new Promise((resolve) => {
                const timeout = setTimeout(() => { worker.terminate(); resolve({ success: false, message: 'Clustering timed out' }); }, 15000);
                worker.onmessage = (ev) => { clearTimeout(timeout); resolve(ev.data); };
                worker.onerror = (err) => { clearTimeout(timeout); resolve({ success: false, message: err && err.message ? err.message : String(err) }); };

                // parse whitelist into array (reuse queryWhitelistInput if present)
                const raw = (queryWhitelistInput && queryWhitelistInput.value) ? queryWhitelistInput.value : '';
                const qp = raw.split(',').map(s => s.trim().toLowerCase()).filter(Boolean);

                worker.postMessage({ type: 'cluster', tabs: candidates, thresholds, normalizeMode: 'ignoreQueryParams', queryParams: qp });
            });

            if (result.success && result.groups && result.groups.length > 0) {
                groups = result.groups.map(g => ({ key: g.key, items: g.items.map(it => ({ id: it.id, url: it.url, title: it.title, faviconUrl: it.faviconUrl, windowId: it.windowId })) }));
            } else {
                showResult('info', 'No meaningful groups found', result.message || '');
                return;
            }
        } else {
            // group by domain/window/domain-window
            const items = candidates.map(tab => {
                let urlObj;
                try { urlObj = new URL(tab.url); } catch (e) { urlObj = null; }
                return { id: tab.id, url: tab.url, title: tab.title || '', faviconUrl: tab.favIconUrl || '', hostname: urlObj ? urlObj.hostname : '', windowId: tab.windowId };
            });

            const groupsMap = new Map();
            for (const it of items) {
                let key = 'misc';
                if (heuristic === 'domain') key = it.hostname || 'misc';
                else if (heuristic === 'window') key = `window-${it.windowId}`;
                else if (heuristic === 'domain-window') key = `${it.hostname || 'misc'}::${it.windowId}`;

                if (!groupsMap.has(key)) groupsMap.set(key, []);
                groupsMap.get(key).push(it);
            }

            for (const [k, arr] of groupsMap.entries()) {
                if (arr && arr.length > 0) groups.push({ key: k, items: arr });
            }
        }

        const totalTabs = groups.reduce((s, g) => s + (g.items ? g.items.length : 0), 0);
        const confirmMsg = `About to save ${groups.length} list(s) containing ${totalTabs} tab(s). Close tabs after saving: ${closeTabs ? 'Yes' : 'No'}.\n\nProceed?`;
        if (!confirm(confirmMsg)) return;

        // Send groups to background to persist and optionally close tabs
        const sendGroups = groups.map(g => ({ key: g.key, items: g.items.map(it => ({ id: it.id, url: it.url, title: it.title || '', faviconUrl: it.faviconUrl || '', windowId: it.windowId })) }));

        const response = await chrome.runtime.sendMessage({ action: 'saveLists', groups: sendGroups, heuristic, closeTabs });

        if (response && response.success) {
            showResult('success', `Saved ${response.createdCount || response.created?.length || 0} list(s)`, 'Lists saved to local storage');
            // Refresh UI lists
            setTimeout(() => { loadLists(); }, 400);
        } else {
            showResult('error', 'Failed to save lists', (response && response.message) || 'Unknown error');
        }

    } catch (error) {
        showResult('error', 'Error converting tabs to lists', error.message || String(error));
    } finally {
        btn.disabled = false;
        btn.innerHTML = oldHtml;
    }
});

// Utility function to escape HTML
function escapeHtml(text) {
    const map = {
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#039;'
    };
    return text.replace(/[&<>"']/g, m => map[m]);
}

// ---------- Compact mode / overflow menu support ----------
function setCompactModeOnItems(enable) {
    document.querySelectorAll('.tab-item').forEach(it => {
        if (enable) it.classList.add('compact'); else it.classList.remove('compact');
    });
}

function updateCompactMode() {
    const containerEl = document.querySelector('.container') || document.body;
    const width = (containerEl && typeof containerEl.clientWidth === 'number') ? containerEl.clientWidth : window.innerWidth;
    const compact = width && width < 420;
    setCompactModeOnItems(!!compact);
}

// Debounced resize handler
// Auto-resize panel + debounced compact-mode update
function autoResizePanel() {
    try {
        const container = document.querySelector('.container') || document.documentElement;
        // measure content size
        const contentHeight = Math.max(
            container.scrollHeight || 0,
            container.offsetHeight || 0,
            document.documentElement.scrollHeight || 0
        );
        const contentWidth = Math.max(
            container.scrollWidth || 0,
            container.offsetWidth || 0,
            document.documentElement.clientWidth || 0
        );

        // apply some padding to compensate for window chrome
        const desiredHeight = Math.min(Math.max(Math.ceil(contentHeight + 48), 300), Math.floor(screen.availHeight * 0.96));
        const desiredWidth = Math.min(Math.max(Math.ceil(contentWidth + 48), 360), Math.floor(screen.availWidth * 0.96));

        // Only attempt to resize when running in a popup-type window created by the extension
        chrome.windows.getCurrent({}, (win) => {
            try {
                if (!win || win.type !== 'popup') return;
                // Avoid tiny updates
                const heightDiff = Math.abs((win.height || 0) - desiredHeight);
                const widthDiff = Math.abs((win.width || 0) - desiredWidth);
                if (heightDiff < 8 && widthDiff < 8) return;
                chrome.windows.update(win.id, { height: desiredHeight, width: desiredWidth }, () => { /* ignore callback errors */ });
            } catch (e) { /* ignore */ }
        });
    } catch (e) { /* ignore */ }
}

const debouncedAutoResize = debounce(autoResizePanel, 160);

window.addEventListener('resize', debounce(() => { updateCompactMode(); debouncedAutoResize(); }, 120));

// Observe changes to the container and adjust compact mode + resize when content changes
try {
    const observer = new MutationObserver(debounce(() => { updateCompactMode(); debouncedAutoResize(); }, 150));
    const watchEl = document.querySelector('.container') || document.body;
    if (watchEl) observer.observe(watchEl, { childList: true, subtree: true, attributes: true, characterData: true });
} catch (e) { /* ignore */ }

// Initial mode update and resize shortly after load so images/favicons settle
setTimeout(() => { try { updateCompactMode(); debouncedAutoResize(); } catch (e) {} }, 200);
